// Etapa 2: multiplayer (usuários, sessões, salas) em Postgres via DATABASE_URL
const {Pool}=require('pg'),crypto=require('crypto'),fs=require('fs');
module.exports=(app,uni)=>{
 const url=process.env.DATABASE_URL;if(!url){console.warn('DATABASE_URL ausente: multiplayer desativado');return;}
 const SCH0=process.env.PGSCHEMA&&/^[a-z_][a-z0-9_]*$/.test(process.env.PGSCHEMA)?process.env.PGSCHEMA:null;
 const pool=new Pool({max:10,idleTimeoutMillis:0,keepAlive:true,connectionString:url,ssl:(()=>{const h=new URL(url).hostname;return process.env.PGSSL==='0'||(!process.env.PGSSL&&(!h.includes('.')||h==='localhost'))?false:{rejectUnauthorized:false};})()});
 pool.on('error',e=>console.error('pg pool (cliente ocioso):',e.message));
 const q=(s,a)=>pool.query(s,a).then(r=>r.rows);
 // PGSCHEMA: isola as tabelas num schema próprio (permite dividir a instância Postgres free com outro app sem colisão)
 const SCH=process.env.PGSCHEMA&&/^[a-z_][a-z0-9_]*$/.test(process.env.PGSCHEMA)?process.env.PGSCHEMA:null;
 
 if(SCH)pool.on('connect',c=>c.query(`SET search_path TO ${SCH}`).catch(()=>{}));
 const ready=(SCH?pool.query(`CREATE SCHEMA IF NOT EXISTS ${SCH}`):Promise.resolve()).then(()=>pool.query(fs.readFileSync(__dirname+'/pg.sql','utf8'))).then(()=>console.log('Postgres OK')).then(purgeTest).then(migClubs2610).then(migVerbas2610).then(migIdadesBR2610).then(migLeilaoPre2610).then(migLeilaoSurpresa2910).then(syncIdades).then(()=>purgeRooms());
 // Limpeza de usuários de teste: defina PURGE_TEST_USERS (regex de apelidos) nas variáveis do Render, faça deploy e depois remova.
 // Migração única: primeiro leilão (config/leilao-pre.json) -> jogadores vão para o clube "Leilão ZC" com over/pot/idade do Robson e viram lotes do leilão de pré-temporada (bloqueado até um admin desbloquear)
 async function migLeilaoPre2610(){if((await pool.query("SELECT 1 FROM lib_migrations WHERE name='leilao-pre-2610'")).rows.length)return;
  const auc=uni.prepare("SELECT id FROM clubs WHERE name='Leilão ZC'").get()?.id;if(!auc)return console.error('leilao-pre-2610: clube Leilão ZC ausente');
  const ps=uni.prepare("SELECT p.id,p.name,p.overall,p.potential,p.age,p.market_value FROM lib_auction a JOIN players p ON p.id=a.player_id WHERE a.stage='pre' ORDER BY a.ord").all();
  const lib=new Set(uni.prepare('SELECT club_id FROM lib_clubs').all().map(x=>x.club_id));const cn=id=>uni.prepare('SELECT name FROM clubs WHERE id=?').get(id)?.name||id;
  const pct=(()=>{try{return JSON.parse(fs.readFileSync(__dirname+'/config/libertadores.json','utf8')).auction?.min_bid_pct??.5}catch(e){return .5}})();
  const c=await pool.connect();try{await c.query('BEGIN');
   const rooms=(await c.query("SELECT * FROM rooms WHERE (mkt_stage='pre' OR (mkt_stage IS NULL AND status='lobby')) AND COALESCE(mkt_state,'waiting')='waiting' AND NOT auction_open FOR UPDATE")).rows;
   for(const room of rooms){const moved=[];let lots=0;
    for(const p of ps){const [o]=(await c.query('SELECT club_id FROM room_players WHERE room_id=$1 AND player_id=$2',[room.id,p.id])).rows;if(o&&lib.has(o.club_id))moved.push(`${p.name} (${cn(o.club_id)})`);
     await c.query(`INSERT INTO room_players(room_id,player_id,club_id,overall,potential,age,market_value) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(room_id,player_id) DO UPDATE SET club_id=$3,overall=$4,potential=$5,age=$6,market_value=$7,loan_from=NULL,loan_until=NULL,role=NULL,listed=false,wants_out=false,release_clause=NULL`,[room.id,p.id,auc,p.overall,p.potential,p.age,p.market_value]);
     await c.query('UPDATE lineups SET starters=array_remove(starters,$2) WHERE room_id=$1 AND $2=ANY(starters)',[room.id,p.id]);
     await c.query("UPDATE offers SET status='expired',reason='Jogador foi para o leilão',updated_at=now() WHERE room_id=$1 AND player_id=$2 AND status IN ('pending','countered','club_accepted')",[room.id,p.id]);
     const [d]=(await c.query("SELECT 1 FROM auction_lots WHERE room_id=$1 AND season=$2 AND player_id=$3 AND status='open'",[room.id,room.season,p.id])).rows;
     if(!d){await c.query("INSERT INTO auction_lots(room_id,season,player_id,from_club,min_bid,created_round,stage) VALUES($1,$2,$3,$4,$5,0,'pre')",[room.id,room.season,p.id,auc,Math.max(1e5,Math.round(p.market_value*pct/1e5)*1e5)]);lots++;}
     else await c.query("UPDATE auction_lots SET from_club=$4 WHERE room_id=$1 AND season=$2 AND player_id=$3 AND status='open'",[room.id,room.season,p.id,auc]);}
    await c.query("UPDATE rooms SET mkt_stage='pre',mkt_state='waiting',version=version+1 WHERE id=$1",[room.id]);
    await c.query('INSERT INTO room_events(room_id,text) VALUES($1,$2)',[room.id,`🔨 Os ${ps.length} jogadores do leilão de pré-temporada foram definidos. Leilão BLOQUEADO até um administrador desbloquear na Central da liga.`+(moved.length?` Saíram dos clubes para o leilão: ${moved.join(', ')}.`:'')]);
    console.log('leilao-pre-2610 sala',room.code,'lotes novos',lots,'saíram de clubes:',moved.join(', ')||'nenhum');}
   await c.query("INSERT INTO lib_migrations(name) VALUES('leilao-pre-2610')");await c.query('COMMIT');console.log('Migração leilao-pre-2610 OK',rooms.length,'sala(s)');}catch(e){await c.query('ROLLBACK');console.error('leilao-pre-2610',e)}finally{c.release()}}
 // Migração única: leilão surpresa (config/leilao-surpresa.json, Robson 29/10) -> só na sala LIGA: jogadores vão para o "Leilão ZC" e viram lotes 'surpresa' com abertura/fechamento próprios (não mexe no calendário do mercado)
 async function migLeilaoSurpresa2910(){if((await pool.query("SELECT 1 FROM lib_migrations WHERE name='leilao-surpresa-2910'")).rows.length)return;
  const CS=JSON.parse(fs.readFileSync(__dirname+'/config/leilao-surpresa.json','utf8'));const auc=uni.prepare("SELECT id FROM clubs WHERE name='Leilão ZC'").get()?.id;if(!auc)return console.error('leilao-surpresa-2910: clube Leilão ZC ausente');
  const ps=uni.prepare("SELECT p.id,p.name,p.overall,p.potential,p.age,p.market_value FROM lib_auction a JOIN players p ON p.id=a.player_id WHERE a.stage='surpresa' ORDER BY a.ord").all();if(!ps.length)return console.error('leilao-surpresa-2910: sem jogadores');
  const lib=new Set(uni.prepare('SELECT club_id FROM lib_clubs').all().map(x=>x.club_id));const cn=id=>uni.prepare('SELECT name FROM clubs WHERE id=?').get(id)?.name||id;
  const pct=(()=>{try{return JSON.parse(fs.readFileSync(__dirname+'/config/libertadores.json','utf8')).auction?.min_bid_pct??.5}catch(e){return .5}})();
  const c=await pool.connect();try{await c.query('BEGIN');const [room]=(await c.query('SELECT * FROM rooms WHERE code=$1 FOR UPDATE',[CS.room])).rows;
   if(room){const moved=[];let lots=0;
    for(const p of ps){const [o]=(await c.query('SELECT club_id FROM room_players WHERE room_id=$1 AND player_id=$2',[room.id,p.id])).rows;const cur=o?o.club_id:uni.prepare('SELECT club_id FROM players WHERE id=?').get(p.id)?.club_id;
     if(o&&lib.has(o.club_id))moved.push(`${p.name} (${cn(o.club_id)})`);
     await c.query(`INSERT INTO room_players(room_id,player_id,club_id,overall,potential,age,market_value) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(room_id,player_id) DO UPDATE SET club_id=$3,overall=$4,potential=$5,age=$6,market_value=$7,loan_from=NULL,loan_until=NULL,role=NULL,listed=false,wants_out=false,release_clause=NULL`,[room.id,p.id,auc,p.overall,p.potential,p.age,p.market_value]);
     await c.query('UPDATE lineups SET starters=array_remove(starters,$2) WHERE room_id=$1 AND $2=ANY(starters)',[room.id,p.id]);
     await c.query("UPDATE offers SET status='expired',reason='Jogador foi para o leilão surpresa',updated_at=now() WHERE room_id=$1 AND player_id=$2 AND status IN ('pending','countered','club_accepted')",[room.id,p.id]);
     const [d]=(await c.query("SELECT 1 FROM auction_lots WHERE room_id=$1 AND season=$2 AND player_id=$3 AND stage='surpresa'",[room.id,room.season,p.id])).rows;
     if(!d){await c.query("INSERT INTO auction_lots(room_id,season,player_id,from_club,min_bid,created_round,stage,opens_at,closes_at) VALUES($1,$2,$3,$4,$5,0,'surpresa',$6,$7)",[room.id,room.season,p.id,auc,Math.max(1e5,Math.round(p.market_value*pct/1e5)*1e5),CS.opens_at,CS.closes_at]);lots++;}}
    await c.query('UPDATE rooms SET version=version+1 WHERE id=$1',[room.id]);
    await c.query('INSERT INTO room_events(room_id,text) VALUES($1,$2)',[room.id,`🔨 Leilão surpresa: ${ps.length} jogadores definidos. Abre ${new Date(CS.opens_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})} e fecha ${new Date(CS.closes_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})} (Brasília).`+(moved.length?` Saíram dos clubes para o leilão: ${moved.join(', ')}.`:'')]);
    console.log('leilao-surpresa-2910 sala',room.code,'lotes novos',lots,'saíram de clubes:',moved.join(', ')||'nenhum');}
   await c.query("INSERT INTO lib_migrations(name) VALUES('leilao-surpresa-2910')");await c.query('COMMIT');console.log('Migração leilao-surpresa-2910 OK');}catch(e){await c.query('ROLLBACK');console.error('leilao-surpresa-2910',e)}finally{c.release()}}
 // Migração única: idade real (Transfermarkt) dos elencos brasileiros -> atualiza idade, potencial (34+ = over) e valor de mercado nas salas
 // Idade = data de nascimento (roda a cada start e a cada 6h; só a coluna age, não mexe em over/potencial)
 async function syncIdades(){try{const BD=require('./birth');BD.load(uni);const ids=(await pool.query('SELECT DISTINCT player_id FROM room_players')).rows.map(r=>r.player_id);
  const u=ids.map(i=>[i,BD.ageOf(i)]).filter(x=>x[1]!=null);
  const r=await pool.query('UPDATE room_players rp SET age=u.a FROM unnest($1::int[],$2::int[]) u(i,a) WHERE rp.player_id=u.i AND rp.age IS DISTINCT FROM u.a',[u.map(x=>x[0]),u.map(x=>x[1])]);
  console.log('syncIdades OK',r.rowCount);}catch(e){console.error('syncIdades',e.message)}}
 setInterval(()=>syncIdades(),6*3600e3).unref();
 async function migIdadesBR2610(){if((await pool.query("SELECT 1 FROM lib_migrations WHERE name='idades-br-2610'")).rows.length)return;
  const ps=uni.prepare('SELECT id,age,potential,market_value FROM players WHERE id>=95000000 AND id<96000000').all();
  const c=await pool.connect();try{await c.query('BEGIN');
   const r=await c.query('UPDATE room_players rp SET age=u.a,potential=GREATEST(rp.overall,LEAST(u.p,CASE WHEN u.a>33 THEN rp.overall ELSE u.p END)),market_value=u.v FROM unnest($1::int[],$2::int[],$3::int[],$4::bigint[]) u(i,a,p,v) WHERE rp.player_id=u.i',[ps.map(x=>x.id),ps.map(x=>x.age),ps.map(x=>x.potential),ps.map(x=>x.market_value)]);
   await c.query("INSERT INTO lib_migrations(name) VALUES('idades-br-2610')");await c.query('COMMIT');console.log('Migração idades-br-2610 OK',r.rowCount);}catch(e){await c.query('ROLLBACK');console.error('idades-br-2610',e)}finally{c.release()}}
 // Migração única: verba inicial por ranking da média dos 18 maiores overs (config/libertadores.json clubs[].budget). Preserva movimentações já feitas (saldo - 20M + verba nova).
 async function migVerbas2610(){if((await pool.query("SELECT 1 FROM lib_migrations WHERE name='verbas-2610'")).rows.length)return;
  const ids=uni.prepare('SELECT club_id FROM lib_clubs').all().map(x=>x.club_id);const nb=ids.map(id=>+(uni.prepare('SELECT budget FROM clubs WHERE id=?').get(id)?.budget||0));
  const c=await pool.connect();try{await c.query('BEGIN');
   await c.query('UPDATE room_clubs rc SET budget=rc.budget-20000000+u.b FROM unnest($1::int[],$2::bigint[]) u(c,b) WHERE rc.club_id=u.c',[ids,nb]);
   await c.query("INSERT INTO lib_migrations(name) VALUES('verbas-2610')");await c.query('COMMIT');console.log('Migração verbas-2610 OK');}catch(e){await c.query('ROLLBACK');console.error('verbas-2610',e)}finally{c.release()}}
 // Migração única: troca Belgrano/Always Ready por Atlético Nacional/Nacional (URU) nas salas existentes
 async function migClubs2610(){await pool.query('CREATE TABLE IF NOT EXISTS lib_migrations(name TEXT PRIMARY KEY,at TIMESTAMPTZ DEFAULT now())');
  if((await pool.query("SELECT 1 FROM lib_migrations WHERE name='clubs-2610'")).rows.length)return;
  const CF=JSON.parse(require('fs').readFileSync(__dirname+'/config/libertadores.json','utf8'));const NEW=[692,774],OLD=[328,287];
  const nac=CF.clubs.find(x=>x.split_from)?.players||[];const c=await pool.connect();
  try{await c.query('BEGIN');for(const room of (await c.query('SELECT * FROM rooms')).rows){
    for(const id of NEW){const w=uni.prepare('SELECT wage_bill FROM clubs WHERE id=?').get(id)?.wage_bill||0;
     await c.query('INSERT INTO room_clubs(room_id,club_id,budget,wage_budget) VALUES($1,$2,$3,$4) ON CONFLICT(room_id,club_id) DO UPDATE SET budget=$3,wage_budget=$4',[room.id,id,CF.default_budget,Math.round(w*1.1)]);}
    const mv=await c.query('UPDATE room_players SET club_id=774 WHERE room_id=$1 AND club_id=455 AND player_id=ANY($2)',[room.id,nac]);
    const hm=await c.query('UPDATE room_managers SET club_id=NULL WHERE room_id=$1 AND club_id=ANY($2) RETURNING user_id',[room.id,OLD]);
    await c.query("UPDATE offers SET status='expired' WHERE room_id=$1 AND status IN ('pending','countered','club_accepted') AND (buyer_club=ANY($2) OR seller_club=ANY($2))",[room.id,OLD]).catch(()=>{});
    const comps=(await c.query('SELECT count(*)::int n FROM competitions WHERE room_id=$1',[room.id])).rows[0].n;
    console.log('migClubs2610 room',room.code,'status',room.status,'comps',comps,'room_players movidos',mv.rowCount,'técnicos desvinculados',hm.rowCount);
    await c.query('INSERT INTO room_events(room_id,text) VALUES($1,$2)',[room.id,'🔁 Belgrano e Always Ready saíram; Atlético Nacional e Nacional (URU) entraram na Libertadores ZC.']);await c.query('UPDATE rooms SET version=version+1 WHERE id=$1',[room.id]);}
   await c.query("INSERT INTO lib_migrations(name) VALUES('clubs-2610')");await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');console.error('migClubs2610 falhou',e);}finally{c.release();}}
 async function purgeTest(){const re=process.env.PURGE_TEST_USERS;if(!re)return;const us=(await pool.query('SELECT id,nick FROM users WHERE nick ~ $1',[re])).rows;
  for(const u of us){await pool.query('DELETE FROM rooms WHERE owner_id=$1',[u.id]);await pool.query('DELETE FROM room_managers WHERE user_id=$1',[u.id]);await pool.query('DELETE FROM watchlist WHERE user_id=$1',[u.id]);await pool.query('DELETE FROM users WHERE id=$1',[u.id]);}
  console.log('Usuários de teste apagados:',us.map(u=>u.nick).join(', ')||'nenhum');}
 async function purgeRooms(){if(process.env.PURGE_ROOMS!=='1')return;const rs=(await pool.query("DELETE FROM rooms WHERE code<>'LIGA' RETURNING code,name")).rows;console.log('Salas apagadas:',rs.map(x=>x.code+' '+x.name).join(', ')||'nenhuma');
  const ru=(await pool.query('SELECT nick FROM users ORDER BY id')).rows;console.log('Restam usuários:',ru.map(x=>x.nick).join(', ')||'—');}
 let SQ=Promise.resolve();const hash=(p,salt=crypto.randomBytes(16).toString('hex'))=>{const r=SQ.then(()=>new Promise((ok,ko)=>crypto.scrypt(p,salt,32,(e,k)=>e?ko(e):ok(salt+':'+k.toString('hex')))));SQ=r.catch(()=>{});return r;}; // assíncrono: não trava o servidor (CPU 0,1 no Render free)
 const check=async(p,h)=>{const [s]=h.split(':');const x=Buffer.from(await hash(p,s));const y=Buffer.from(h);return x.length===y.length&&crypto.timingSafeEqual(x,y);};
 const tokenOf=r=>(r.headers.authorization||'').replace('Bearer ','')||(r.headers.cookie||'').match(/mc_token=([a-f0-9]+)/)?.[1];
 const AUTHC=new Map();
 const auth=async(r,s,n)=>{await ready;const t=tokenOf(r);let u=null;if(t){const c=AUTHC.get(t);if(c&&c.exp>Date.now())u={...c.u};else{u=(await q('SELECT u.id,u.nick,u.is_admin FROM sessions s JOIN users u ON u.id=s.user_id WHERE token=$1',[t]))[0]||null;if(u)AUTHC.set(t,{u:{...u},exp:Date.now()+60000});}}if(!u)return s.status(401).json({error:'Faça login'});u.admin=!!u.is_admin||require('./admins')().includes(String(u.nick).toLowerCase());r.user=u;n();};
 const wrap=f=>(r,s)=>f(r,s).catch(e=>{console.error(e);s.status(e.status||500).json({error:e.expose?e.message:'Erro interno'})});
 const fail=(m,st=400)=>Object.assign(new Error(m),{status:st,expose:true});
 const login=async(s,uid)=>{const t=crypto.randomBytes(24).toString('hex');await q('INSERT INTO sessions(token,user_id) VALUES($1,$2)',[t,uid]);s.setHeader('Set-Cookie',`mc_token=${t}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=31536000`);return t;};
 app.post('/api/auth/register',wrap(async(r,s)=>{await ready;const {nick,pin}=r.body||{};
  if(!/^[\wÀ-ú .-]{3,20}$/.test(nick||''))throw fail('Apelido de 3 a 20 caracteres');if(!pin||String(pin).length<4)throw fail('PIN/senha com pelo menos 4 caracteres');
  const ex=await q('SELECT 1 FROM users WHERE lower(nick)=lower($1)',[nick.trim()]);if(ex.length)throw fail('Apelido já existe',409);
  const [u]=await q('INSERT INTO users(nick,pass_hash) VALUES($1,$2) RETURNING id,nick',[nick.trim(),await hash(String(pin))]);s.json({user:u,token:await login(s,u.id)});}));
 app.post('/api/auth/login',wrap(async(r,s)=>{await ready;const {nick,pin}=r.body||{};const [u]=await q('SELECT * FROM users WHERE lower(nick)=lower($1)',[String(nick||'').trim()]);
  if(!u||!(await check(String(pin||''),u.pass_hash)))throw fail('Apelido ou PIN inválido',401);s.json({user:{id:u.id,nick:u.nick},token:await login(s,u.id)});}));
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
 app.delete('/api/me',auth,wrap(async(r,s)=>{const [u]=await q('SELECT * FROM users WHERE id=$1',[r.user.id]);if(!(await check(String(r.body?.pin||''),u.pass_hash)))throw fail('PIN incorreto',401);
  await q('DELETE FROM rooms WHERE owner_id=$1',[u.id]);await q('DELETE FROM room_managers WHERE user_id=$1',[u.id]);await q('DELETE FROM watchlist WHERE user_id=$1',[u.id]);await q('DELETE FROM users WHERE id=$1',[u.id]);s.json({ok:1});}));
};
