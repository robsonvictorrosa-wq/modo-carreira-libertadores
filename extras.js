// Zero Clubistas: visão geral dos clubes (meta do onze), contratações, estatísticas, empréstimos, leilão, premiações e Central da liga
const L=require('./libertadores'),EVO=require('./evolution'),CF=require('./config/libertadores.json');
module.exports=({app,uni,q,pool,auth,wrap,fail,member,bump,R,M})=>{
 const PLAN=L.plan();const LEAGUE_END=PLAN.filter(s=>s.stage==='league').length;
 const cname=id=>R.C.get(id)?.name||uni.prepare('SELECT name FROM clubs WHERE id=?').get(id)?.name||'Livre';
 const pname=id=>id<0?'Provisório':(R.P.get(id)?.name||'?');
 const own=(room,r)=>{if(room.owner_id!==r.user.id&&!r.user.admin)throw fail('Só administradores',403);};
 const comp0=async(db,room)=>(await db.query('SELECT * FROM competitions WHERE room_id=$1 AND season=$2 ORDER BY id LIMIT 1',[room.id,room.season])).rows[0];
 const note=(db,rid,t)=>db.query('INSERT INTO room_events(room_id,text) VALUES($1,$2)',[rid,t]);
 const prizeOf=pos=>(CF.prizes||[]).find(p=>pos>=p.from&&pos<=p.to)?.amount||0;
 const phase=comp=>{if(!comp)return 'Pré-temporada';const s=PLAN[comp.current_round];if(!s)return 'Temporada encerrada';return s.stage==='league'?`Fase de liga – rodada ${s.round??comp.current_round+1}/${LEAGUE_END}`:L.STAGE_NAMES[s.stage]+(s.leg===1&&s.stage!=='playin'&&s.stage!=='final'?' (ida)':s.leg===2?' (volta)':'');};

 const signedSet=async(db,room,cid)=>new Set((await db.query('SELECT player_id FROM transfers WHERE room_id=$1 AND to_club=$2',[room.id,cid])).rows.map(x=>x.player_id));
 async function meta(db,room,cid){const x=await app.locals.xiFor(db,room.id,cid);const s=await signedSet(db,room,cid);const n=x.xi.filter(p=>s.has(p.id)).length;return {n,need:CF.meta_onze||6,ok:n>=(CF.meta_onze||6)};}
 // ---------- ganchos de rodada ----------
 (app.locals.afterRound??=[]).push(async(c,room,comp,step)=>{const out=[];const round=comp.current_round;
  // empréstimos por rodadas: devolve quem cumpriu o prazo
  const back=(await c.query('UPDATE room_players SET club_id=loan_from,loan_from=NULL,loan_until=NULL,role=NULL WHERE room_id=$1 AND loan_from IS NOT NULL AND loan_until IS NOT NULL AND loan_until<=$2 RETURNING player_id,club_id',[room.id,round])).rows;
  for(const x of back){await c.query('UPDATE lineups SET starters=NULL WHERE room_id=$1 AND $2=ANY(starters)',[room.id,x.player_id]);await note(c,room.id,`↩️ Fim do empréstimo: ${pname(x.player_id)} voltou ao ${cname(x.club_id)}.`);}
  // fim da fase de liga: premiação + abertura do leilão
  if(step.stage==='league'&&round===LEAGUE_END&&!comp.prizes_paid){const ms=(await c.query("SELECT * FROM matches WHERE comp_id=$1 AND played AND stage='league'",[comp.id])).rows;
   const tb=L.standings(ms,L.CLUBS,cname);for(const t of tb){const v=prizeOf(t.pos);if(v)await c.query('UPDATE room_clubs SET budget=budget+$3 WHERE room_id=$1 AND club_id=$2',[room.id,t.club_id,v]);}
   await c.query('UPDATE competitions SET prizes_paid=true WHERE id=$1',[comp.id]);await note(c,room.id,`💰 Premiações da fase de liga pagas! ${tb[0].name} levou € ${(prizeOf(1)/1e6)} mi.`);out.push({info:'💰 Premiações da fase de liga pagas.'});
   // leilão: abre automaticamente se os administradores já cadastraram lotes
   const [nl]=(await c.query("SELECT count(*)::int n FROM auction_lots WHERE room_id=$1 AND season=$2 AND status='open'",[room.id,room.season])).rows;
   if(nl.n){await c.query('UPDATE rooms SET auction_open=true WHERE id=$1',[room.id]);await note(c,room.id,`🔨 O leilão abriu com ${nl.n} lote(s)! Lances cegos até os administradores encerrarem.`);}}
  out.push(...((await EVO.afterRound(c,room,comp,step))||[]));return out;});
 // ---------- leitura ----------
 app.get('/api/rooms/:code/zc/overview',auth,wrap(async(r,s)=>{const room=await member(r);const comp=await comp0(pool,room);
  const mans=await q('SELECT m.user_id,m.club_id,u.nick FROM room_managers m JOIN users u ON u.id=m.user_id WHERE room_id=$1 ORDER BY joined_at',[room.id]);const by=new Map(mans.filter(m=>m.club_id).map(m=>[m.club_id,m.nick]));
  const rc=new Map((await q('SELECT club_id,budget FROM room_clubs WHERE room_id=$1',[room.id])).map(x=>[x.club_id,+x.budget]));
  const clubs=[];for(const cid of L.CLUBS){const lc=uni.prepare('SELECT country,squad FROM lib_clubs WHERE club_id=?').get(cid);const m=await meta(pool,room,cid);clubs.push({id:cid,name:cname(cid),country:lc.country,squad:lc.squad,manager:by.get(cid)||null,budget:rc.get(cid)??null,initial:+(uni.prepare('SELECT budget FROM clubs WHERE id=?').get(cid)?.budget||0),meta:m});}
  const me=mans.find(m=>m.user_id===r.user.id);let win=null;try{win=M.windowOf(room,await M.mainComp(pool,room));}catch(e){}
  s.json({room:{code:room.code,name:room.name,status:room.status,season:room.season,market_day:room.market_day},admin:room.owner_id===r.user.id||!!r.user.admin,me:{nick:r.user.nick,club_id:me?.club_id||null},comp,phase:phase(comp),window:win,clubs,managers:mans,prizes:CF.prizes,meta_need:CF.meta_onze||6,evolution:{enabled:EVO.enabled,description:EVO.description}});}));
 app.get('/api/rooms/:code/zc/signings',auth,wrap(async(r,s)=>{const room=await member(r);const [m]=await q('SELECT club_id FROM room_managers WHERE room_id=$1 AND user_id=$2',[room.id,r.user.id]);if(!m?.club_id)return s.json({in:[],out:[]});
  const t=await q('SELECT * FROM transfers WHERE room_id=$1 AND (to_club=$2 OR from_club=$2) ORDER BY id DESC',[room.id,m.club_id]);const sq=new Set((await R.squad(pool,room.id,m.club_id,false)).map(p=>p.id));const x=await app.locals.xiFor(pool,room.id,m.club_id);const xi=new Set(x.xi.map(p=>p.id));
  const cr=(await comp0(pool,room))?.current_round||0;const LN=new Map((await q('SELECT player_id,club_id,loan_until FROM room_players WHERE room_id=$1 AND loan_from IS NOT NULL',[room.id])).map(y=>[y.player_id,y]));
  const f=x2=>({...x2,loan_left:(x2.kind==='empréstimo'&&LN.get(x2.player_id)?.club_id===x2.to_club&&LN.get(x2.player_id).loan_until!=null)?Math.max(0,LN.get(x2.player_id).loan_until-cr):null,fee:+x2.fee,wage:+x2.wage,player:pname(x2.player_id),pos:R.P.get(x2.player_id)?.primary_position,ovr:R.P.get(x2.player_id)?.overall,from:cname(x2.from_club),to:cname(x2.to_club),in_squad:sq.has(x2.player_id),starter:xi.has(x2.player_id)});
  s.json({in:t.filter(x2=>x2.to_club===m.club_id).map(f),out:t.filter(x2=>x2.from_club===m.club_id).map(f),meta:await meta(pool,room,m.club_id)});}));
 app.get('/api/rooms/:code/zc/stats',auth,wrap(async(r,s)=>{const room=await member(r);const comp=await comp0(pool,room);if(!comp)return s.json({players:[],matches:0});
  const st=r.query.stage||'',club=+r.query.club||0;const ms=await q(`SELECT home,away,details FROM matches WHERE comp_id=$1 AND played ${st==='ko'?"AND stage<>'league'":st?'AND stage=$2':''}`,st&&st!=='ko'?[comp.id,st]:[comp.id]);
  const P={};const g=(id,cid)=>P[id]??={id,name:pname(id),pos:R.P.get(id)?.primary_position||'—',club_id:cid,club:cname(cid),apps:0,goals:0,assists:0,rs:0};
  for(const m of ms){const d=m.details||{};for(const side of ['home','away'])for(const p of (d.lineups?.[side]||[])){const x=g(p.id,m[side]);x.apps++;x.rs+=+(d.ratings?.[p.id]||0);}
   for(const e of d.events||[]){if(e.scorer)g(e.scorer,e.club).goals++;if(e.assist)g(e.assist,e.club).assists++;}}
  let L2=Object.values(P).filter(p=>p.id>0&&(!club||p.club_id===club)).map(p=>({...p,rating:p.apps?+(p.rs/p.apps).toFixed(2):0}));
  const top=(k,n=15)=>[...L2].sort((a,b)=>b[k]-a[k]||b.rating-a.rating).filter(p=>p[k]>0).slice(0,n);
  s.json({matches:ms.length,goals:top('goals'),assists:top('assists'),ratings:[...L2].filter(p=>p.apps>=Math.max(1,Math.floor(ms.length/40/2))).sort((a,b)=>b.rating-a.rating).slice(0,15),
   clubs:L.CLUBS.map(id=>({id,name:cname(id)}))});}));
 app.get('/api/rooms/:code/zc/loanable',auth,wrap(async(r,s)=>{const room=await member(r);const hum=new Set((await q('SELECT club_id FROM room_managers WHERE room_id=$1 AND club_id IS NOT NULL',[room.id])).map(x=>x.club_id));const out=[];
  for(const cid of L.CLUBS.filter(x=>!hum.has(x))){const sq=await R.squad(pool,room.id,cid,false);if(!sq.length)continue;const x=await app.locals.xiFor(pool,room.id,cid);const xi=new Set(x.xi.map(p=>p.id));sq.filter(p=>!xi.has(p.id)&&!p.loan_from).forEach(p=>out.push({id:p.id,name:p.name,pos:p.primary_position,overall:p.overall,age:p.age,club:cname(cid)}));}
  s.json(out.sort((a,b)=>b.overall-a.overall).slice(0,300));}));
 // ---------- leilão ----------
 app.get('/api/rooms/:code/zc/auction',auth,wrap(async(r,s)=>{const room=await member(r);const comp=await comp0(pool,room);const [m]=await q('SELECT club_id FROM room_managers WHERE room_id=$1 AND user_id=$2',[room.id,r.user.id]);
  const lots=await q('SELECT l.*,(SELECT count(*)::int FROM auction_bids b WHERE b.lot_id=l.id) bids,(SELECT amount FROM auction_bids b WHERE b.lot_id=l.id AND b.club_id=$3) mine FROM auction_lots l WHERE room_id=$1 AND season=$2 ORDER BY status,id',[room.id,room.season,m?.club_id||0]);
  s.json({open:!!room.auction_open,admin:room.owner_id===r.user.id||!!r.user.admin,league_end:LEAGUE_END,lots:lots.map(l=>{const p=R.P.get(l.player_id)||{};return {...l,min_bid:+l.min_bid,price:l.price&&+l.price,mine:l.mine&&+l.mine,name:p.name,pos:p.primary_position,overall:p.overall,age:p.age,from:cname(l.from_club),winner:l.winner_club?cname(l.winner_club):null};})});}));
 app.post('/api/rooms/:code/zc/auction/bid',auth,wrap(async(r,s)=>{const room=await member(r);const [m]=await q('SELECT club_id FROM room_managers WHERE room_id=$1 AND user_id=$2',[room.id,r.user.id]);if(!m?.club_id)throw fail('Escolha um clube');
  const [l]=await q("SELECT * FROM auction_lots WHERE id=$1 AND room_id=$2 AND status='open'",[+r.body?.lot_id,room.id]);if(!l)throw fail('Lote fechado');if(!room.auction_open)throw fail('O leilão não está aberto');const a=Math.round(+r.body?.amount||0);if(a<+l.min_bid)throw fail('Lance abaixo do mínimo');
  const [rc]=await q('SELECT budget FROM room_clubs WHERE room_id=$1 AND club_id=$2',[room.id,m.club_id]);if(a>+rc.budget)throw fail('Saldo insuficiente');
  await q('INSERT INTO auction_bids(lot_id,club_id,user_id,amount) VALUES($1,$2,$3,$4) ON CONFLICT(lot_id,club_id) DO UPDATE SET amount=$4,created_at=now()',[l.id,m.club_id,r.user.id,a]);s.json({ok:1});}));

 async function resolveAuction(c,room){const lots=(await c.query("SELECT * FROM auction_lots WHERE room_id=$1 AND season=$2 AND status='open'",[room.id,room.season])).rows;let n=0;
  for(const l of lots){const bids=(await c.query('SELECT * FROM auction_bids WHERE lot_id=$1 ORDER BY amount DESC,created_at',[l.id])).rows;let won=null;const p=await R.player(c,room.id,l.player_id);
   for(const b of bids){const [rc]=(await c.query('SELECT budget FROM room_clubs WHERE room_id=$1 AND club_id=$2',[room.id,b.club_id])).rows;if(rc&&+rc.budget>=+b.amount&&p.club_id===l.from_club&&b.club_id!==l.from_club){won=b;break;}}
   if(won){await M.execute(c,room,{pid:l.player_id,from:l.from_club,to:won.club_id,fee:+won.amount,kind:'leilão'});await c.query("UPDATE auction_lots SET status='sold',winner_club=$2,price=$3 WHERE id=$1",[l.id,won.club_id,won.amount]);n++;await note(c,room.id,`🔨 Leilão: ${pname(l.player_id)} foi para o ${cname(won.club_id)} por € ${(won.amount/1e6).toFixed(1)} mi (lance cego).`);}
   else await c.query("UPDATE auction_lots SET status='unsold' WHERE id=$1",[l.id]);}return n;}
 const tx=async(room,fn)=>{const c=await pool.connect();try{await c.query('BEGIN');const v=await fn(c);await c.query('UPDATE rooms SET version=version+1 WHERE id=$1',[room.id]);await c.query('COMMIT');return v;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}};
 app.post('/api/rooms/:code/zc/admin/auction/add',auth,wrap(async(r,s)=>{const room=await member(r);own(room,r);const p=await R.player(pool,room.id,+r.body?.player_id);if(!p)throw fail('Jogador não encontrado');
  if(!L.CLUBS.includes(p.club_id))throw fail('Só jogadores dos 40 clubes');if(p.loan_from)throw fail('Jogador emprestado não pode ir a leilão');
  const [d]=await q("SELECT id FROM auction_lots WHERE room_id=$1 AND season=$2 AND player_id=$3 AND status='open'",[room.id,room.season,p.id]);if(d)throw fail('Jogador já está no leilão');
  const min=+r.body?.min_bid>0?Math.round(+r.body.min_bid):Math.max(1e5,Math.round((+p.market_value||1e6)*(CF.auction?.min_bid_pct??.5)));const comp=await comp0(pool,room);
  await q('INSERT INTO auction_lots(room_id,season,player_id,from_club,min_bid,created_round) VALUES($1,$2,$3,$4,$5,$6)',[room.id,room.season,p.id,p.club_id,min,comp?.current_round||0]);await note(pool,room.id,`🔨 ${r.user.nick} colocou ${p.name} (${cname(p.club_id)}) no leilão.`);s.json({ok:1});}));
 app.post('/api/rooms/:code/zc/admin/auction/remove',auth,wrap(async(r,s)=>{const room=await member(r);own(room,r);await q("DELETE FROM auction_lots WHERE id=$1 AND room_id=$2 AND status='open'",[+r.body?.lot_id,room.id]);s.json({ok:1});}));
 app.post('/api/rooms/:code/zc/admin/auction/state',auth,wrap(async(r,s)=>{const room=await member(r);own(room,r);const a=r.body?.action;
  if(a==='open'){await q('UPDATE rooms SET auction_open=true WHERE id=$1',[room.id]);await note(pool,room.id,'🔨 Os administradores abriram o leilão. Lances cegos!');return s.json({ok:1});}
  if(a==='close'){const n=await tx(room,async c=>{await c.query('UPDATE rooms SET auction_open=false WHERE id=$1',[room.id]);const n=await resolveAuction(c,room);await note(c,room.id,`🔨 Leilão encerrado: ${n} jogador(es) arrematado(s).`);return n;});return s.json({ok:1,sold:n});}
  throw fail('Ação inválida');}));
 app.get('/api/rooms/:code/zc/loans',auth,wrap(async(r,s)=>{const room=await member(r);const comp=await comp0(pool,room);const cr=comp?.current_round||0;
  const rows=await q('SELECT player_id,club_id,loan_from,loan_until FROM room_players WHERE room_id=$1 AND loan_from IS NOT NULL',[room.id]);
  s.json(rows.filter(x=>L.CLUBS.includes(x.club_id)||L.CLUBS.includes(x.loan_from)).map(x=>({player_id:x.player_id,player:pname(x.player_id),pos:R.P.get(x.player_id)?.primary_position,overall:R.P.get(x.player_id)?.overall,to:cname(x.club_id),to_id:x.club_id,from:cname(x.loan_from),from_id:x.loan_from,loan_until:x.loan_until,remaining:x.loan_until==null?null:Math.max(0,x.loan_until-cr)})));}));
 // administradores globais
 const envAdmins=require('./admins');
 const gadmin=r=>{if(!r.user.admin)throw fail('Só administradores',403);};
 app.get('/api/zc/admin/users',auth,wrap(async(r,s)=>{gadmin(r);const E=envAdmins();s.json((await q('SELECT id,nick,is_admin FROM users ORDER BY nick')).map(u=>({id:u.id,nick:u.nick,admin:u.is_admin||E.includes(u.nick.toLowerCase()),env:E.includes(u.nick.toLowerCase())})));}));
 app.post('/api/zc/admin/role',auth,wrap(async(r,s)=>{gadmin(r);const uid=+r.body?.user_id,on=!!r.body?.admin;if(uid===r.user.id&&!on)throw fail('Você não pode remover o seu próprio acesso');
  const [u]=await q('UPDATE users SET is_admin=$2 WHERE id=$1 RETURNING nick',[uid,on]);if(!u)throw fail('Usuário não encontrado');if(!on&&envAdmins().includes(u.nick.toLowerCase()))throw fail('Este apelido é admin pela variável ADMIN_APELIDOS no Render');s.json({ok:1});}));
 // ---------- central da liga (admin) ----------
 app.post('/api/rooms/:code/zc/admin/assign',auth,wrap(async(r,s)=>{const room=await member(r);own(room,r);const uid=+r.body?.user_id,cid=r.body?.club_id?+r.body.club_id:null;
  if(cid&&!L.CLUBS.includes(cid))throw fail('Clube fora da Libertadores ZC');if(cid&&room.status!=='lobby'){const [t]=await q('SELECT 1 FROM room_managers WHERE room_id=$1 AND club_id=$2',[room.id,cid]);if(t)throw fail('Clube já tem técnico');}
  try{await q('UPDATE room_managers SET club_id=$3 WHERE room_id=$1 AND user_id=$2',[room.id,uid,cid]);}catch(e){if(e.code==='23505')throw fail('Clube já tem técnico',409);throw e;}
  await bump(room.id,`Admin definiu clube de um técnico: ${cid?cname(cid):'sem clube'}`);s.json({ok:1});}));
 app.post('/api/rooms/:code/zc/admin/remove',auth,wrap(async(r,s)=>{const room=await member(r);own(room,r);const uid=+r.body?.user_id;if(uid===room.owner_id)throw fail('O administrador não pode se remover');
  await q('DELETE FROM room_managers WHERE room_id=$1 AND user_id=$2',[room.id,uid]);await bump(room.id,'Admin removeu um técnico da sala');s.json({ok:1});}));
 app.post('/api/rooms/:code/zc/admin/window',auth,wrap(async(r,s)=>{const room=await member(r);own(room,r);const a=r.body?.action;if(!['open','close','finalize'].includes(a))throw fail('Ação inválida');
  const c=await pool.connect();try{await c.query('BEGIN');await c.query('UPDATE rooms SET window_override=$2,version=version+1 WHERE id=$1',[room.id,a==='open'?'open':'closed']);
   if(a==='finalize')await c.query("UPDATE offers SET status='expired',reason='Janela finalizada pelo admin',updated_at=now() WHERE room_id=$1 AND status IN ('pending','countered','club_accepted')",[room.id]);
   await note(c,room.id,a==='open'?'🔓 Admin abriu a janela':a==='close'?'🔒 Admin fechou a janela':'🏁 Admin finalizou a janela (negociações pendentes expiradas)');await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}s.json({ok:1});}));
 app.get('/api/rooms/:code/zc/admin/transfers',auth,wrap(async(r,s)=>{const room=await member(r);own(room,r);const t=String(r.query.q||'').toLowerCase();
  const rows=await q("SELECT * FROM transfers WHERE room_id=$1 AND fee>0 ORDER BY id DESC LIMIT 300",[room.id]);
  s.json(rows.map(x=>({...x,fee:+x.fee,player:pname(x.player_id),from:cname(x.from_club),to:cname(x.to_club)})).filter(x=>!t||(x.player+' '+x.from+' '+x.to).toLowerCase().includes(t)).slice(0,50));}));
 app.post('/api/rooms/:code/zc/admin/contest',auth,wrap(async(r,s)=>{const room=await member(r);own(room,r);const c=await pool.connect();
  try{await c.query('BEGIN');const [t]=(await c.query('SELECT * FROM transfers WHERE id=$1 AND room_id=$2',[+r.body?.transfer_id,room.id])).rows;if(!t)throw fail('Venda não encontrada');
   const p=await R.player(c,room.id,t.player_id);if(p.club_id!==t.to_club)throw fail('O jogador já mudou de clube de novo – desfaça a transferência mais recente primeiro');
   await c.query('UPDATE room_players SET club_id=$3,loan_from=NULL WHERE room_id=$1 AND player_id=$2',[room.id,t.player_id,t.from_club]);
   await c.query('UPDATE room_clubs SET budget=budget+$3 WHERE room_id=$1 AND club_id=$2',[room.id,t.to_club,t.fee]);await c.query('UPDATE room_clubs SET budget=budget-$3 WHERE room_id=$1 AND club_id=$2',[room.id,t.from_club,t.fee]);
   await c.query('UPDATE lineups SET starters=NULL WHERE room_id=$1 AND club_id=$2 AND $3=ANY(starters)',[room.id,t.to_club,t.player_id]);await c.query('DELETE FROM transfers WHERE id=$1',[t.id]);
   await note(c,room.id,`⚖️ Admin contestou e desfez a venda de ${pname(t.player_id)} (${cname(t.from_club)} → ${cname(t.to_club)}, € ${(t.fee/1e6).toFixed(1)} mi devolvidos).`);await c.query('UPDATE rooms SET version=version+1 WHERE id=$1',[room.id]);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}s.json({ok:1});}));
 app.get('/api/rooms/:code/zc/log',auth,wrap(async(r,s)=>{const room=await member(r);s.json(await q('SELECT id,text,created_at FROM room_events WHERE room_id=$1 ORDER BY id DESC LIMIT 150',[room.id]));}));
};
