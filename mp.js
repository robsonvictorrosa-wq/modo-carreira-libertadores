// Etapa 2: multiplayer (usuários, sessões, salas) em Postgres via DATABASE_URL
const {Pool}=require('pg'),crypto=require('crypto'),fs=require('fs');
module.exports=(app,uni)=>{
 const url=process.env.DATABASE_URL;if(!url){console.warn('DATABASE_URL ausente: multiplayer desativado');return;}
 const SCH0=process.env.PGSCHEMA&&/^[a-z_][a-z0-9_]*$/.test(process.env.PGSCHEMA)?process.env.PGSCHEMA:null;
 const pool=new Pool({max:10,idleTimeoutMillis:0,keepAlive:true,connectionString:url,ssl:(()=>{const h=new URL(url).hostname;return process.env.PGSSL==='0'||(!process.env.PGSSL&&(!h.includes('.')||h==='localhost'))?false:{rejectUnauthorized:false};})()});
 const q=(s,a)=>pool.query(s,a).then(r=>r.rows);
 // PGSCHEMA: isola as tabelas num schema próprio (permite dividir a instância Postgres free com outro app sem colisão)
 const SCH=process.env.PGSCHEMA&&/^[a-z_][a-z0-9_]*$/.test(process.env.PGSCHEMA)?process.env.PGSCHEMA:null;
 
 if(SCH)pool.on('connect',c=>c.query(`SET search_path TO ${SCH}`).catch(()=>{}));
 const ready=(SCH?pool.query(`CREATE SCHEMA IF NOT EXISTS ${SCH}`):Promise.resolve()).then(()=>pool.query(fs.readFileSync(__dirname+'/pg.sql','utf8'))).then(()=>console.log('Postgres OK')).then(purgeTest).then(()=>purgeRooms());
 // Limpeza de usuários de teste: defina PURGE_TEST_USERS (regex de apelidos) nas variáveis do Render, faça deploy e depois remova.
 async function purgeTest(){const re=process.env.PURGE_TEST_USERS;if(!re)return;const us=(await pool.query('SELECT id,nick FROM users WHERE nick ~ $1',[re])).rows;
  for(const u of us){await pool.query('DELETE FROM rooms WHERE owner_id=$1',[u.id]);await pool.query('DELETE FROM room_managers WHERE user_id=$1',[u.id]);await pool.query('DELETE FROM watchlist WHERE user_id=$1',[u.id]);await pool.query('DELETE FROM users WHERE id=$1',[u.id]);}
  console.log('Usuários de teste apagados:',us.map(u=>u.nick).join(', ')||'nenhum');}
 async function purgeRooms(){if(process.env.PURGE_ROOMS!=='1')return;const rs=(await pool.query("DELETE FROM rooms WHERE code<>'LIGA' RETURNING code,name")).rows;console.log('Salas apagadas:',rs.map(x=>x.code+' '+x.name).join(', ')||'nenhuma');
  const ru=(await pool.query('SELECT nick FROM users ORDER BY id')).rows;console.log('Restam usuários:',ru.map(x=>x.nick).join(', ')||'—');}
 const hash=(p,salt=crypto.randomBytes(16).toString('hex'))=>salt+':'+crypto.scryptSync(p,salt,32).toString('hex');
 const check=(p,h)=>{const [s]=h.split(':');return crypto.timingSafeEqual(Buffer.from(hash(p,s)),Buffer.from(h));};
 const tokenOf=r=>(r.headers.authorization||'').replace('Bearer ','')||(r.headers.cookie||'').match(/mc_token=([a-f0-9]+)/)?.[1];
 const AUTHC=new Map();
 const auth=async(r,s,n)=>{await ready;const t=tokenOf(r);let u=null;if(t){const c=AUTHC.get(t);if(c&&c.exp>Date.now())u={...c.u};else{u=(await q('SELECT u.id,u.nick,u.is_admin FROM sessions s JOIN users u ON u.id=s.user_id WHERE token=$1',[t]))[0]||null;if(u)AUTHC.set(t,{u:{...u},exp:Date.now()+60000});}}if(!u)return s.status(401).json({error:'Faça login'});u.admin=!!u.is_admin||require('./admins')().includes(String(u.nick).toLowerCase());r.user=u;n();};
 const wrap=f=>(r,s)=>f(r,s).catch(e=>{console.error(e);s.status(e.status||500).json({error:e.expose?e.message:'Erro interno'})});
 const fail=(m,st=400)=>Object.assign(new Error(m),{status:st,expose:true});
 const login=async(s,uid)=>{const t=crypto.randomBytes(24).toString('hex');await q('INSERT INTO sessions(token,user_id) VALUES($1,$2)',[t,uid]);s.setHeader('Set-Cookie',`mc_token=${t}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=31536000`);return t;};
 app.post('/api/auth/register',wrap(async(r,s)=>{await ready;const {nick,pin}=r.body||{};
  if(!/^[\wÀ-ú .-]{3,20}$/.test(nick||''))throw fail('Apelido de 3 a 20 caracteres');if(!pin||String(pin).length<4)throw fail('PIN/senha com pelo menos 4 caracteres');
  const ex=await q('SELECT 1 FROM users WHERE lower(nick)=lower($1)',[nick.trim()]);if(ex.length)throw fail('Apelido já existe',409);
  const [u]=await q('INSERT INTO users(nick,pass_hash) VALUES($1,$2) RETURNING id,nick',[nick.trim(),hash(String(pin))]);s.json({user:u,token:await login(s,u.id)});}));
 app.post('/api/auth/login',wrap(async(r,s)=>{await ready;const {nick,pin}=r.body||{};const [u]=await q('SELECT * FROM users WHERE lower(nick)=lower($1)',[String(nick||'').trim()]);
  if(!u||!check(String(pin||''),u.pass_hash))throw fail('Apelido ou PIN inválido',401);s.json({user:{id:u.id,nick:u.nick},token:await login(s,u.id)});}));
 app.post('/api/auth/logout',wrap(async(r,s)=>{AUTHC.delete(tokenOf(r)||'');await q('DELETE FROM sessions WHERE token=$1',[tokenOf(r)||'']);s.setHeader('Set-Cookie','mc_token=; Path=/; Max-Age=0');s.json({ok:1});}));
 app.get('/api/me',auth,wrap(async(r,s)=>s.json({user:r.user,rooms:await q(`SELECT r.id,r.code,r.name,r.max_managers,m.club_id,(SELECT count(*)::int FROM room_managers x WHERE x.room_id=r.id) n FROM room_managers m JOIN rooms r ON r.id=m.room_id WHERE m.user_id=$1 ORDER BY r.id DESC`,[r.user.id])})));
 const code=()=>Array.from(crypto.randomBytes(6),b=>'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b%32]).join('');
 app.post('/api/rooms',auth,wrap(async(r,s)=>{const name=String(r.body?.name||'').trim().slice(0,40)||'Sala de '+r.user.nick;const max=Math.min(Math.max(parseInt(r.body?.max_managers)||5,2),20);
  throw fail('Salas desativadas: há um campeonato único',410);
  const c=await pool.connect();try{await c.query('BEGIN');
   const {rows:[room]}=await c.query('INSERT INTO rooms(code,name,owner_id,max_managers) VALUES($1,$2,$3,$4) RETURNING *',[code(),name,r.user.id,max]);
   await c.query('INSERT INTO room_managers(room_id,user_id) VALUES($1,$2)',[room.id,r.user.id]);
   const clubs=uni.prepare('SELECT id,budget,wage_bill FROM clubs').all();
   await c.query('INSERT INTO room_clubs(room_id,club_id,budget,wage_budget) SELECT $1,* FROM unnest($2::int[],$3::bigint[],$4::bigint[])',[room.id,clubs.map(x=>x.id),clubs.map(x=>x.budget),clubs.map(x=>Math.round(x.wage_bill*1.1))]);
   await c.query('INSERT INTO room_events(room_id,text) VALUES($1,$2)',[room.id,r.user.nick+' criou a sala']);
   await c.query('COMMIT');s.json(room);}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}}));
 app.post('/api/rooms/join',auth,wrap(async(r,s)=>{const cd=String(r.body?.code||'').trim().toUpperCase();const [room]=await q('SELECT * FROM rooms WHERE code=$1',[cd]);if(!room)throw fail('Código não encontrado',404);
  const ms=await q('SELECT user_id FROM room_managers WHERE room_id=$1',[room.id]);if(ms.some(m=>m.user_id===r.user.id))return s.json(room);
  if(room.status!=='lobby'&&!r.user.admin)throw fail('A temporada já começou nesta sala');if(ms.length>=room.max_managers&&!r.user.admin)throw fail('Sala cheia ('+room.max_managers+' técnicos)');
  await q('INSERT INTO room_managers(room_id,user_id) VALUES($1,$2)',[room.id,r.user.id]);await bump(room.id,r.user.nick+' entrou na sala');s.json(room);}));
 const bump=(id,t)=>q('INSERT INTO room_events(room_id,text) VALUES($1,$2)',[id,t]).then(()=>q('UPDATE rooms SET version=version+1 WHERE id=$1',[id]));
 const member=async(r)=>{const [room]=await q('SELECT r.*,(m.user_id IS NOT NULL) is_member FROM rooms r LEFT JOIN room_managers m ON m.room_id=r.id AND m.user_id=$2 WHERE r.code=$1',[String(r.params.code).toUpperCase(),r.user.id]);if(!room||(!room.is_member&&!r.user.admin))throw fail('Você não está nessa sala',403);return room;};
 const clubInfo=id=>id&&uni.prepare('SELECT c.id,c.name,c.overall,l.name league FROM clubs c JOIN leagues l ON l.id=c.league_id WHERE c.id=?').get(id);

 // Campeonato único: uma sala interna fixa (código LIGA); todo usuário logado entra nela automaticamente.
 let ligaP=null;
 const ensureLiga=()=>ligaP||(ligaP=(async()=>{await ready;const [x]=await q("SELECT * FROM rooms WHERE code='LIGA'");if(x)return x;
  const c=await pool.connect();try{await c.query('BEGIN');
   const {rows:[room]}=await c.query("INSERT INTO rooms(code,name,owner_id,max_managers) VALUES('LIGA','Libertadores ZC',NULL,40) ON CONFLICT(code) DO NOTHING RETURNING *");
   if(room){const clubs=uni.prepare('SELECT id,budget,wage_bill FROM clubs').all();
    await c.query('INSERT INTO room_clubs(room_id,club_id,budget,wage_budget) SELECT $1,* FROM unnest($2::int[],$3::bigint[],$4::bigint[])',[room.id,clubs.map(x=>x.id),clubs.map(x=>x.budget),clubs.map(x=>Math.round(x.wage_bill*1.1))]);
    await c.query('INSERT INTO room_events(room_id,text) VALUES($1,$2)',[room.id,'Campeonato criado']);}
   await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');ligaP=null;throw e}finally{c.release()}
  return (await q("SELECT * FROM rooms WHERE code='LIGA'"))[0];})().catch(e=>{ligaP=null;throw e}));
 app.get('/api/liga',auth,wrap(async(r,s)=>{const room=await ensureLiga();
  const ins=await q('INSERT INTO room_managers(room_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING user_id',[room.id,r.user.id]);
  if(ins.length)await bump(room.id,r.user.nick+' entrou no campeonato');s.json({code:room.code,name:room.name});}));
 app.get('/api/rooms/:code',auth,wrap(async(r,s)=>{const room=await member(r);
  if(r.query.v&&+r.query.v===room.version)return s.json({version:room.version,unchanged:true});
  const ms=await q('SELECT m.user_id,u.nick,m.club_id FROM room_managers m JOIN users u ON u.id=m.user_id WHERE room_id=$1 ORDER BY joined_at',[room.id]);
  const ev=await q('SELECT text,created_at FROM room_events WHERE room_id=$1 ORDER BY id DESC LIMIT 20',[room.id]);
  s.json({...room,me:r.user.id,managers:ms.map(m=>({...m,club:clubInfo(m.club_id)})),events:ev});}));
 app.post('/api/rooms/:code/club',auth,wrap(async(r,s)=>{const room=await member(r);const club=clubInfo(+r.body?.club_id);if(!club)throw fail('Clube inválido');
  if(!r.user.admin)throw fail('Os clubes são definidos pelos administradores na Central da liga',403);if(room.status!=='lobby')throw fail('A temporada já começou');if(!uni.prepare('SELECT 1 FROM lib_clubs WHERE club_id=?').get(club.id))throw fail('Na Libertadores ZC só valem os 40 clubes da competição');
  const taken=await q('SELECT u.nick FROM room_managers m JOIN users u ON u.id=m.user_id WHERE room_id=$1 AND club_id=$2 AND user_id<>$3',[room.id,club.id,r.user.id]);if(taken.length)throw fail(club.name+' já é de '+taken[0].nick,409);
  try{await q('UPDATE room_managers SET club_id=$3 WHERE room_id=$1 AND user_id=$2',[room.id,r.user.id,club.id]);}catch(e){if(e.code==='23505')throw fail('Clube já escolhido',409);throw e;}
  await bump(room.id,`${r.user.nick} assumiu o ${club.name} (${club.league})`);s.json({ok:1,club});}));
 app.post('/api/rooms/:code/settings',auth,wrap(async(r,s)=>{const room=await member(r);if(room.owner_id!==r.user.id&&!r.user.admin)throw fail('Só o dono da sala',403);
  const max=Math.min(Math.max(parseInt(r.body?.max_managers)||room.max_managers,2),20);const [{n}]=await q('SELECT count(*)::int n FROM room_managers WHERE room_id=$1',[room.id]);if(max<n)throw fail('Já há '+n+' técnicos');
  await q('UPDATE rooms SET max_managers=$2 WHERE id=$1',[room.id,max]);await bump(room.id,'Limite de técnicos: '+max);s.json({ok:1});}));
 app.delete('/api/rooms/:code',auth,wrap(async(r,s)=>{const room=await member(r);if(room.owner_id!==r.user.id&&!r.user.admin)throw fail('Só o dono da sala',403);await q('DELETE FROM rooms WHERE id=$1',[room.id]);s.json({ok:1});}));
 // Minha carreira: elenco da sala = universo + overrides da sala
 app.get('/api/rooms/:code/career',auth,wrap(async(r,s)=>{const room=await member(r);const [m]=await q('SELECT club_id FROM room_managers WHERE room_id=$1 AND user_id=$2',[room.id,r.user.id]);
  if(!m.club_id)return s.json({room,club:null});
  const pl=(await R.squad(pool,room.id,m.club_id)).sort((a,b)=>b.overall-a.overall);
  const [rc]=await q('SELECT budget,wage_budget FROM room_clubs WHERE room_id=$1 AND club_id=$2',[room.id,m.club_id]);
  const c=uni.prepare('SELECT c.*,l.name league FROM clubs c JOIN leagues l ON l.id=c.league_id WHERE c.id=?').get(m.club_id);
  s.json({room,club:{...c,budget:+rc.budget,wage_budget:+rc.wage_budget,wage_bill:pl.reduce((a,p)=>a+(+p.wage||0),0),squad_value:pl.reduce((a,p)=>a+(+p.market_value||0),0),players:pl}});}));
 const R=require('./roster')(uni);
 const M=require('./market')({app,uni,q,pool,auth,wrap,fail,member,bump,R});
 require('./season')({app,uni,q,pool,auth,wrap,fail,member,bump,R,M});
 require('./extras')({app,uni,q,pool,auth,wrap,fail,member,bump,R,M});
 require('./bolao')({app,uni,q,pool,auth,wrap,fail,member});
 // apagar a própria conta (usado também para limpar usuários de teste): exige PIN
 app.delete('/api/me',auth,wrap(async(r,s)=>{const [u]=await q('SELECT * FROM users WHERE id=$1',[r.user.id]);if(!check(String(r.body?.pin||''),u.pass_hash))throw fail('PIN incorreto',401);
  await q('DELETE FROM rooms WHERE owner_id=$1',[u.id]);await q('DELETE FROM room_managers WHERE user_id=$1',[u.id]);await q('DELETE FROM watchlist WHERE user_id=$1',[u.id]);await q('DELETE FROM users WHERE id=$1',[u.id]);s.json({ok:1});}));
};
