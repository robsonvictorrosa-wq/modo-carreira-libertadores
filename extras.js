const TRX=require('./dt').trx;
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

 const signedSet=async(db,room,cid)=>new Set((await db.query("SELECT player_id FROM transfers WHERE room_id=$1 AND to_club=$2 AND kind<>'empréstimo' AND status<>'cancelled'",[room.id,cid])).rows.map(x=>x.player_id));
 async function meta(db,room,cid){const x=await app.locals.xiFor(db,room.id,cid);const s=await signedSet(db,room,cid);const n=x.xi.filter(p=>s.has(p.id)).length;return {n,need:CF.meta_onze||6,ok:n>=(CF.meta_onze||6)};}
 // ---------- ganchos de rodada ----------
 (app.locals.afterRound??=[]).push(async(c,room,comp,step)=>{const out=[];const round=comp.current_round;
  // empréstimos por rodadas: devolve quem cumpriu o prazo
  const back=(await c.query('UPDATE room_players SET club_id=loan_from,loan_from=NULL,loan_until=NULL,role=NULL WHERE room_id=$1 AND loan_from IS NOT NULL AND loan_until IS NOT NULL AND loan_until<=$2 RETURNING player_id,club_id',[room.id,round])).rows;
  for(const x of back){await c.query('UPDATE lineups SET starters=NULL WHERE room_id=$1 AND $2=ANY(starters)',[room.id,x.player_id]);await note(c,room.id,`↩️ Fim do empréstimo: ${pname(x.player_id)} voltou ao ${cname(x.club_id)}.`);}
  // premiação por jogo (Robson 27/10): 1 mi por vitória, 0,3 mi por empate, 0 por derrota. Cada jogo paga uma vez só (prize_paid).
  {const MP=await c.query('UPDATE matches SET prize_paid=true WHERE comp_id=$1 AND round=$2 AND played AND prize_paid IS NULL RETURNING home,away,hg,ag',[comp.id,round]);const pay=new Map();
   for(const m of MP.rows){const [h,a]=m.hg>m.ag?[1e6,0]:m.hg<m.ag?[0,1e6]:[3e5,3e5];if(h)pay.set(m.home,(pay.get(m.home)||0)+h);if(a)pay.set(m.away,(pay.get(m.away)||0)+a);}
   for(const [cid,v] of pay)await c.query('UPDATE room_clubs SET budget=budget+$3 WHERE room_id=$1 AND club_id=$2',[room.id,cid,v]);
   if(MP.rows.length)await note(c,room.id,`💰 Premiação por jogo da rodada ${round}: vitória € 1 mi, empate € 0,3 mi, derrota € 0 (${pay.size} clubes premiados).`);}
  // fim da fase de liga: premiação + abertura do leilão
  if(step.stage==='league'&&round===LEAGUE_END&&!comp.prizes_paid){const ms=(await c.query("SELECT * FROM matches WHERE comp_id=$1 AND played AND stage='league'",[comp.id])).rows;
   const tb=L.standings(ms,L.CLUBS,cname,new Map((await c.query('SELECT club_id,penalty_pts FROM room_clubs WHERE room_id=$1 AND penalty_pts<>0',[room.id])).rows.map(x=>[x.club_id,x.penalty_pts])));for(const t of tb){const v=prizeOf(t.pos);if(v)await c.query('UPDATE room_clubs SET budget=budget+$3 WHERE room_id=$1 AND club_id=$2',[room.id,t.club_id,v]);}
   await c.query('UPDATE competitions SET prizes_paid=true WHERE id=$1',[comp.id]);await note(c,room.id,`💰 Premiações da fase de liga pagas! ${tb[0].name} levou € ${(prizeOf(1)/1e6)} mi.`);out.push({info:'💰 Premiações da fase de liga pagas.'});
   await c.query("UPDATE rooms SET mkt_stage='end',mkt_state='waiting',auction_open=false WHERE id=$1",[room.id]);await note(c,room.id,'🔨 Fim da fase de liga: rodadas paradas até o leilão de fim da fase de liga (11 jogadores) e o mercado de 24 h.');out.push({info:'🔨 Leilão de fim da fase de liga pendente.'});}
  if(step.stage==='league'&&round===MID_ROUND&&round<LEAGUE_END){await c.query("UPDATE rooms SET mkt_stage='mid',mkt_state='waiting',auction_open=false WHERE id=$1",[room.id]);await note(c,room.id,`🔨 Rodada ${MID_ROUND} concluída: rodadas paradas até o leilão do meio da fase de liga (22 jogadores) e o mercado de 3 dias.`);out.push({info:'🔨 Leilão do meio da fase de liga pendente.'});}
  out.push(...((await EVO.afterRound(c,room,comp,step))||[]));return out;});
 // ---------- leitura ----------
 const OVC=new Map();app.locals.zcOvCacheClear=id=>OVC.delete(id);
 app.get('/api/rooms/:code/zc/overview',auth,wrap(async(r,s)=>{const room=await member(r);const comp=await comp0(pool,room);
  const mans=await q('SELECT m.user_id,m.club_id,u.nick FROM room_managers m JOIN users u ON u.id=m.user_id WHERE room_id=$1 ORDER BY joined_at',[room.id]);const by=new Map(mans.filter(m=>m.club_id).map(m=>[m.club_id,m.nick]));
  const rc=new Map((await q('SELECT club_id,budget FROM room_clubs WHERE room_id=$1',[room.id])).map(x=>[x.club_id,+x.budget]));
  // parte pesada (XI de 40 clubes): cache por sala+versão por até 45 s e uma única computação simultânea (antes levava ~17 s por chamada e derrubava o servidor)
  const ck=room.id+':'+room.version;let hv=OVC.get(room.id);if(!hv||hv.k!==ck||(!hv.busy&&Date.now()-hv.t>45000)){const p=(async()=>{const [ps,ms]=await Promise.all([M.preStatus(pool,room),Promise.all(L.CLUBS.map(cid=>meta(pool,room,cid)))]);const PS=new Map(ps.map(x=>[x.club_id,x]));const out=new Map();L.CLUBS.forEach((cid,i)=>out.set(cid,{pre:PS.get(cid),meta:ms[i]}));return out})();const nh={k:ck,t:Date.now(),p,busy:true};const prev=hv;OVC.set(room.id,nh);p.then(()=>{nh.t=Date.now();nh.busy=false},()=>{if(OVC.get(room.id)===nh)OVC.delete(room.id)});hv=(prev&&!prev.busy&&Date.now()-prev.t<120000)?prev:nh;}
  const H=await hv.p;const clubs=[];for(const cid of L.CLUBS){const lc=uni.prepare('SELECT country,squad FROM lib_clubs WHERE club_id=?').get(cid);const h=H.get(cid);clubs.push({pre:h.pre,id:cid,name:cname(cid),country:lc.country,squad:lc.squad,manager:by.get(cid)||null,budget:rc.get(cid)??null,initial:+(uni.prepare('SELECT budget FROM clubs WHERE id=?').get(cid)?.budget||0),meta:h.meta});}
  const me=mans.find(m=>m.user_id===r.user.id);let win=null;try{win=M.windowOf(room,await M.mainComp(pool,room));}catch(e){}
  s.json({room:{code:room.code,name:room.name,status:room.status,season:room.season,market_day:room.market_day},admin:room.owner_id===r.user.id||!!r.user.admin,me:{nick:r.user.nick,club_id:me?.club_id||null},comp,phase:phase(comp),window:win,cal:await calInfo(pool,room),clubs,managers:mans,prizes:CF.prizes,meta_need:CF.meta_onze||6,pre_need:M.PRE_NEED,evolution:{enabled:EVO.enabled,description:EVO.description}});}));
 app.get('/api/rooms/:code/zc/signings',auth,wrap(async(r,s)=>{const room=await member(r);const [m]=await q('SELECT club_id FROM room_managers WHERE room_id=$1 AND user_id=$2',[room.id,r.user.id]);if(!m?.club_id)return s.json({in:[],out:[]});
  const t=await q('SELECT * FROM transfers WHERE room_id=$1 AND (to_club=$2 OR from_club=$2) AND status<>\'cancelled\' ORDER BY id DESC',[room.id,m.club_id]);const sq=new Set((await R.squad(pool,room.id,m.club_id,false)).map(p=>p.id));const x=await app.locals.xiFor(pool,room.id,m.club_id);const xi=new Set(x.xi.map(p=>p.id));
  const cr=(await comp0(pool,room))?.current_round||0;const LN=new Map((await q('SELECT player_id,club_id,loan_until FROM room_players WHERE room_id=$1 AND loan_from IS NOT NULL',[room.id])).map(y=>[y.player_id,y]));
  const f=x2=>({...x2,...TRX(x2),loan_left:(x2.kind==='empréstimo'&&LN.get(x2.player_id)?.club_id===x2.to_club&&LN.get(x2.player_id).loan_until!=null)?Math.max(0,LN.get(x2.player_id).loan_until-cr):null,fee:+x2.fee,wage:+x2.wage,player:pname(x2.player_id),pos:R.P.get(x2.player_id)?.primary_position,ovr:R.P.get(x2.player_id)?.overall,from:cname(x2.from_club),to:cname(x2.to_club),in_squad:sq.has(x2.player_id),starter:xi.has(x2.player_id)});
  s.json({in:t.filter(x2=>x2.to_club===m.club_id).map(f),out:t.filter(x2=>x2.from_club===m.club_id).map(f),meta:await meta(pool,room,m.club_id)});}));
 app.get('/api/rooms/:code/zc/stats',auth,wrap(async(r,s)=>{const room=await member(r);const comp=await comp0(pool,room);if(!comp)return s.json({players:[],matches:0});
  const st=r.query.stage||'',club=+r.query.club||0;const ms=await q(`SELECT home,away,details FROM matches WHERE comp_id=$1 AND played ${st==='ko'?"AND stage<>'league'":st?'AND stage=$2':''}`,st&&st!=='ko'?[comp.id,st]:[comp.id]);
  const P={};const g=(id,cid)=>P[id]??={id,name:pname(id),pos:R.P.get(id)?.primary_position||'—',club_id:cid,club:cname(cid),apps:0,goals:0,assists:0,rs:0};
  for(const m of ms){const d=m.details||{};for(const side of ['home','away'])for(const p of (d.lineups?.[side]||[])){const x=g(p.id,m[side]);x.apps++;x.rs+=+(d.ratings?.[p.id]||0);}
   for(const e of d.events||[]){if(e.scorer)g(e.scorer,e.club).goals++;if(e.assist)g(e.assist,e.club).assists++;}}
  let L2=Object.values(P).filter(p=>p.id>0&&(!club||p.club_id===club)).map(p=>({...p,rating:p.apps?+(p.rs/p.apps).toFixed(2):0}));
  const MA=Math.max(1,Math.round(Math.max(0,...L2.map(p=>p.apps))*0.3));
  const top=(k,n=15)=>[...L2].sort((a,b)=>b[k]-a[k]||b.rating-a.rating).filter(p=>p[k]>0).slice(0,n);
  s.json({matches:ms.length,goals:top('goals'),assists:top('assists'),min_apps:MA,ratings:[...L2].filter(p=>p.apps>=MA).sort((a,b)=>b.rating-a.rating||b.apps-a.apps).slice(0,20),
   clubs:L.CLUBS.map(id=>({id,name:cname(id)}))});}));
 app.get('/api/rooms/:code/zc/loanable',auth,wrap(async(r,s)=>{const room=await member(r);const hum=new Set((await q('SELECT club_id FROM room_managers WHERE room_id=$1 AND club_id IS NOT NULL',[room.id])).map(x=>x.club_id));const out=[];
  for(const cid of L.CLUBS.filter(x=>!hum.has(x))){const sq=await R.squad(pool,room.id,cid,false);if(!sq.length)continue;const x=await app.locals.xiFor(pool,room.id,cid);const xi=new Set(x.xi.map(p=>p.id));sq.filter(p=>!xi.has(p.id)&&!p.loan_from).forEach(p=>out.push({id:p.id,name:p.name,pos:p.primary_position,overall:p.overall,age:p.age,club:cname(cid)}));}
  s.json(out.sort((a,b)=>b.overall-a.overall).slice(0,300));}));
 // ---------- calendário de mercado + leilão ----------
 // pre: leilão 22 (top 5 de over fora) -> mercado 7 dias; mid (após a rodada 19): leilão 22 -> 3 dias; end (fim da liga): leilão 11 -> 24 h
 const CAL={pre:{lots:22,hours:168,label:'Leilão de pré-temporada',mlabel:'Mercado da pré-temporada'},mid:{lots:22,hours:72,label:'Leilão do meio da fase de liga',mlabel:'Mercado do meio da fase de liga'},end:{lots:11,hours:24,label:'Leilão de fim da fase de liga',mlabel:'Mercado de fim da fase de liga'}};
 const MID_ROUND=CF.mid_window_round||19;
 const stOf=room=>room.mkt_stage||(room.status==='lobby'?'pre':null);
 const stateOf=room=>{const s=room.mkt_state||(room.status==='lobby'?'waiting':'done');if(s==='market'&&room.mkt_until&&new Date(room.mkt_until)<=Date.now())return 'done';return s;};
 async function top5(db,room){const rows=[];for(const cid of L.CLUBS){const sq=(await R.squad(db,room.id,cid,false)).map(p=>+p.overall||0).sort((a,b)=>b-a).slice(0,18);rows.push({cid,avg:sq.reduce((a,b)=>a+b,0)/(sq.length||1)});}
  return rows.sort((a,b)=>b.avg-a.avg).slice(0,5).map(x=>x.cid);}
 const T5C=new Map();
 async function calInfo(db,room){const st=stOf(room),state=stateOf(room),c=CAL[st]||null;const [n]=(await db.query("SELECT count(*)::int n FROM auction_lots WHERE room_id=$1 AND season=$2 AND status='open'",[room.id,room.season])).rows;
  let excl=(room.auction_excl||[]),excl_preview=false;if(st==='pre'&&state==='waiting'){const k=room.id+':'+room.season,h=T5C.get(k);if(h&&h.t>Date.now()-60000)excl=h.v;else{excl=await top5(db,room);T5C.set(k,{t:Date.now(),v:excl});}excl_preview=true;}let next=null;if(state==='done'&&room.status==='season')next=st==='pre'?`Próximo: leilão após a rodada ${MID_ROUND}`:st==='mid'?'Próximo: leilão ao fim da fase de liga':'Sem mais janelas nesta temporada';
  return {stage:st,state,label:c?.label||null,mlabel:c?.mlabel||null,lots_max:c?.lots||0,hours:c?.hours||0,lots:n.n,until:state==='market'?new Date(room.mkt_until).toISOString():null,until_txt:state==='market'?M.brt(room.mkt_until):null,excl:st==='pre'?excl:[],excl_names:st==='pre'?excl.map(cname):[],excl_preview,next,mid_round:MID_ROUND,
   auction_open:!!room.auction_open,blocks_rounds:room.status==='season'&&['waiting','auction','market'].includes(state)};}
 app.locals.canStart=async room=>{const s=stateOf(room);if(s==='auction')throw fail('O leilão de pré-temporada ainda está aberto. Encerre o leilão e espere o mercado fechar.');
  if(s==='market')throw fail(`O mercado da pré-temporada está aberto até ${M.brt(room.mkt_until)}. Espere fechar ou feche na Central.`);
  if(s==='waiting')throw fail('Primeiro faça o leilão de pré-temporada e o mercado (ou pule pela Central).');};
 (app.locals.beforeRound??=[]).push(async(c,room)=>{let s=stateOf(room);
  if(room.mkt_state==='market'&&s==='done'){await c.query("UPDATE rooms SET mkt_state='done' WHERE id=$1",[room.id]);await M.after(c,room);}
  if(s==='waiting')throw fail(`As rodadas estão paradas: falta o ${CAL[stOf(room)]?.label||'leilão'} (Central da liga).`);
  if(s==='auction')throw fail('As rodadas estão paradas enquanto o leilão estiver aberto.');
  if(s==='market')throw fail(`As rodadas estão paradas: mercado aberto até ${M.brt(room.mkt_until)}.`);});
 app.get('/api/rooms/:code/zc/auction',auth,wrap(async(r,s)=>{const room=await member(r);const [m]=await q('SELECT club_id FROM room_managers WHERE room_id=$1 AND user_id=$2',[room.id,r.user.id]);
  const lots=await q('SELECT l.*,(SELECT count(*)::int FROM auction_bid_log b WHERE b.lot_id=l.id AND b.removed_at IS NULL) bids,(SELECT amount FROM auction_bids b WHERE b.lot_id=l.id AND b.club_id=$3) mine FROM auction_lots l WHERE room_id=$1 AND season=$2 ORDER BY status,id',[room.id,room.season,m?.club_id||0]);
  const hist=lots.length?await q('SELECT lot_id,club_id,amount,created_at FROM auction_bid_log WHERE lot_id=ANY($1) AND removed_at IS NULL ORDER BY amount DESC,id',[lots.map(l=>l.id)]):[];const H=new Map();for(const h of hist){if(!H.has(h.lot_id))H.set(h.lot_id,[]);H.get(h.lot_id).push({club:cname(h.club_id),club_id:h.club_id,amount:+h.amount,at:h.created_at});}
  const cal=await calInfo(pool,room);
  const AUCX=[...R.C.values()].find(x=>x.name==='Leilão ZC')?.id;const TR=new Map();for(const l of lots)if(l.status==='unsold'){const p=await R.player(pool,room.id,l.player_id);if(p)TR.set(l.player_id,p.club_id);}s.json({open:!!room.auction_open,locked:!room.auction_open&&stateOf(room)==='waiting'&&lots.some(l=>l.status==='open'),admin:room.owner_id===r.user.id||!!r.user.admin,league_end:LEAGUE_END,cal,my_club:m?.club_id||null,excluded:!!(m?.club_id&&room.auction_open&&(room.auction_excl||[]).includes(m.club_id)),lots:lots.map(l=>{const p=R.P.get(l.player_id)||{};const hs=H.get(l.id)||[];return {...l,top:hs[0]||null,leader_mine:!!(hs[0]&&hs[0].club_id===m?.club_id),history:hs.slice(0,15),bids:hs.length,min_bid:+l.min_bid,price:l.price&&+l.price,mine:l.mine&&+l.mine,name:p.name,pos:p.primary_position,overall:p.overall,potential:p.potential,age:p.age,from:cname(l.from_club),winner:l.winner_club?cname(l.winner_club):null,locked:l.status==='unsold'&&AUCX!=null&&(TR.get(l.player_id)===AUCX),stage_label:CAL[l.stage]?.label||'Leilão'};})});}));
 const avail=async(db,room,cid)=>{const [rc]=(await db.query('SELECT budget FROM room_clubs WHERE room_id=$1 AND club_id=$2',[room.id,cid])).rows;const res=(await M.reservedMap(db,room.id)).get(cid)||0;return (+rc?.budget||0)-res;};
 // leilão aberto: lances visíveis, novo lance precisa superar o maior; cada clube lidera no máx 1 lote (leva no máx 1); o lance líder fica reservado e volta quando superado
 const leaderOf=async(db,lotId)=>(await db.query('SELECT club_id,amount FROM auction_bids WHERE lot_id=$1 ORDER BY amount DESC,created_at LIMIT 1',[lotId])).rows[0];
 app.post('/api/rooms/:code/zc/auction/bid',auth,wrap(async(r,s)=>{const room=await member(r);const [m]=await q('SELECT club_id FROM room_managers WHERE room_id=$1 AND user_id=$2',[room.id,r.user.id]);if(!m?.club_id)throw fail('Escolha um clube');
  const c=await pool.connect();try{await c.query('BEGIN');const [rm]=(await c.query('SELECT * FROM rooms WHERE id=$1 FOR UPDATE',[room.id])).rows;
   if(!rm.auction_open)throw fail(stateOf(rm)==='waiting'?'O leilão está bloqueado: aguarde um administrador desbloquear':'O leilão não está aberto');if((rm.auction_excl||[]).includes(m.club_id))throw fail('Seu clube está entre os 5 maiores overs e não pode dar lance neste leilão');
   const [l]=(await c.query("SELECT * FROM auction_lots WHERE id=$1 AND room_id=$2 AND status='open'",[+r.body?.lot_id,room.id])).rows;if(!l)throw fail('Lote fechado');if(l.from_club===m.club_id)throw fail('Não dá pra dar lance no seu próprio jogador');
   const a=Math.round(+r.body?.amount||0);if(a<+l.min_bid)throw fail(`Lance abaixo do mínimo (€ ${(l.min_bid/1e6).toFixed(1)} mi)`);
   const top=await leaderOf(c,l.id);if(top&&top.club_id===m.club_id)throw fail('Você já tem o maior lance deste jogador');if(top&&a<=+top.amount)throw fail(`O lance precisa superar o atual: € ${(top.amount/1e6).toFixed(1)} mi (${cname(top.club_id)})`);
   const lead=(await c.query("SELECT l.id,l.player_id FROM auction_lots l WHERE l.room_id=$1 AND l.season=$2 AND l.status='open' AND l.id<>$3 AND (SELECT b.club_id FROM auction_bids b WHERE b.lot_id=l.id ORDER BY b.amount DESC,b.created_at LIMIT 1)=$4",[room.id,room.season,l.id,m.club_id])).rows[0];
   if(lead)throw fail(`Você já tem o maior lance pelo ${pname(lead.player_id)}. Cada clube leva no máximo 1 jogador: só dá pra dar lance em outro se for superado.`);
   const av=await avail(c,rm,m.club_id);if(a>av)throw fail(`Saldo insuficiente: você tem ${(av/1e6).toFixed(1)} mi disponíveis (orçamento menos o reservado)`);
   await c.query('INSERT INTO auction_bids(lot_id,club_id,user_id,amount) VALUES($1,$2,$3,$4) ON CONFLICT(lot_id,club_id) DO UPDATE SET amount=$4,user_id=$3,created_at=now()',[l.id,m.club_id,r.user.id,a]);
   await c.query('INSERT INTO auction_bid_log(lot_id,club_id,user_id,amount) VALUES($1,$2,$3,$4)',[l.id,m.club_id,r.user.id,a]);
   await c.query('INSERT INTO room_events(room_id,text) VALUES($1,$2)',[room.id,`🔨 ${cname(m.club_id)} deu € ${(a/1e6).toFixed(1)} mi por ${pname(l.player_id)}`+(top?` (superou ${cname(top.club_id)})`:'')+'.']);
   await c.query('UPDATE rooms SET version=version+1 WHERE id=$1',[room.id]);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  s.json({ok:1});}));
 app.post('/api/rooms/:code/zc/auction/unbid',auth,wrap(async(r,s)=>{const room=await member(r);const [m]=await q('SELECT club_id FROM room_managers WHERE room_id=$1 AND user_id=$2',[room.id,r.user.id]);const adm=room.owner_id===r.user.id||!!r.user.admin;
  const cid=r.body?.club_id!=null&&+r.body.club_id!==m?.club_id?(adm?+r.body.club_id:(()=>{throw fail('Só administradores podem remover lances de outros clubes',403)})()):m?.club_id;if(!cid)throw fail('Escolha um clube');
  const c=await pool.connect();let out;try{await c.query('BEGIN');const [rm]=(await c.query('SELECT * FROM rooms WHERE id=$1 FOR UPDATE',[room.id])).rows;if(!rm.auction_open)throw fail('O leilão está fechado: não dá mais pra remover lances');
   const [l]=(await c.query("SELECT * FROM auction_lots WHERE id=$1 AND room_id=$2 AND status='open'",[+r.body?.lot_id,room.id])).rows;if(!l)throw fail('Lote fechado');
   const [b]=(await c.query('DELETE FROM auction_bids WHERE lot_id=$1 AND club_id=$2 RETURNING amount',[l.id,cid])).rows;if(!b)throw fail('Não há lance desse clube neste jogador');
   await c.query('UPDATE auction_bid_log SET removed_at=now() WHERE lot_id=$1 AND club_id=$2 AND removed_at IS NULL',[l.id,cid]);
   const top=await leaderOf(c,l.id);const who=cid===m?.club_id?cname(cid):`${r.user.nick} (admin)`;
   await c.query('INSERT INTO room_events(room_id,text) VALUES($1,$2)',[room.id,`↩️ ${who} removeu o lance de € ${(b.amount/1e6).toFixed(1)} mi ${cid===m?.club_id?'':'do '+cname(cid)+' '}em ${pname(l.player_id)}.`+(top?` Agora lidera: ${cname(top.club_id)} (€ ${(top.amount/1e6).toFixed(1)} mi).`:' Sem lances agora.')]);
   await c.query('UPDATE rooms SET version=version+1 WHERE id=$1',[room.id]);await c.query('COMMIT');out={ok:1,leader:top?{club:cname(top.club_id),amount:+top.amount}:null};}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  s.json(out);}));
 // resolve: maiores lances primeiro; cada clube leva no máximo 1 jogador; lance só vale se couber no disponível (orçamento - reservado)
 async function resolveAuction(c,room){const lots=new Map((await c.query("SELECT * FROM auction_lots WHERE room_id=$1 AND season=$2 AND status='open'",[room.id,room.season])).rows.map(l=>[l.id,l]));let n=0;const won=new Set(),done=new Set();const excl=new Set(room.auction_excl||[]);
  const bids=lots.size?(await c.query('SELECT DISTINCT ON (lot_id) * FROM auction_bids WHERE lot_id=ANY($1) ORDER BY lot_id,amount DESC,created_at',[[...lots.keys()]])).rows.sort((a,b)=>b.amount-a.amount):[];
  for(const b of bids){const l=lots.get(b.lot_id);if(done.has(l.id)||won.has(b.club_id)||excl.has(b.club_id)||b.club_id===l.from_club)continue;const p=await R.player(c,room.id,l.player_id);if(!p||p.club_id!==l.from_club)continue;
   if(await avail(c,room,b.club_id)<+b.amount)continue;
   await M.execute(c,room,{pid:l.player_id,from:l.from_club,to:b.club_id,fee:+b.amount,kind:'leilão'});await c.query("UPDATE auction_lots SET status='sold',winner_club=$2,price=$3 WHERE id=$1",[l.id,b.club_id,b.amount]);n++;won.add(b.club_id);done.add(l.id);
   await note(c,room.id,`🔨 Leilão: ${pname(l.player_id)} foi para o ${cname(b.club_id)} por € ${(b.amount/1e6).toFixed(1)} mi (maior lance).`);}
  const AUCZ=[...R.C.values()].find(x=>x.name==='Leilão ZC')?.id;
  for(const l of lots.values())if(!done.has(l.id)){await c.query("UPDATE auction_lots SET status='unsold' WHERE id=$1",[l.id]);
   if(AUCZ){const p=await R.player(c,room.id,l.player_id);if(p&&p.club_id===AUCZ)await note(c,room.id,`🔒 Leilão: ${pname(l.player_id)} ficou sem lance e está TRAVADO (aguardando leilão no grupo). Ninguém pode contratá-lo até a administração definir o clube.`);}}
  return n;}
 const tx=async(room,fn)=>{const c=await pool.connect();try{await c.query('BEGIN');const v=await fn(c);await c.query('UPDATE rooms SET version=version+1 WHERE id=$1',[room.id]);await c.query('COMMIT');return v;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}};
 // jogador travado (leilão sem lance) -> clube definido pela administração (leilão no grupo). Só move esse jogador.
 app.post('/api/rooms/:code/zc/admin/auction/assign',auth,wrap(async(r,s)=>{const room=await member(r);own(room,r);const pid=+r.body?.player_id,nm=String(r.body?.club_name||'').trim().toLowerCase(),to=+r.body?.club_id||(nm&&require('./libertadores').CLUBS.find(id=>(cname(id)||'').toLowerCase()===nm))||0,fee=Math.max(0,Math.round(+r.body?.fee||0));
  if(!require('./libertadores').CLUBS.includes(to))throw fail('Clube inválido (tem que ser um dos 40 da liga)');const AUCZ=[...R.C.values()].find(x=>x.name==='Leilão ZC')?.id;
  const out=await tx(room,async c=>{const [rm]=(await c.query('SELECT * FROM rooms WHERE id=$1 FOR UPDATE',[room.id])).rows;const [l]=(await c.query("SELECT * FROM auction_lots WHERE room_id=$1 AND player_id=$2 AND status='unsold' ORDER BY id DESC LIMIT 1",[room.id,pid])).rows;if(!l)throw fail('Esse jogador não está travado (sem lote sem lance)');
   const p=await R.player(c,room.id,pid);if(!p||p.club_id!==AUCZ)throw fail('Esse jogador não está mais travado');
   await M.execute(c,rm,{pid,from:AUCZ,to,fee,kind:'leilão no grupo'});await c.query("UPDATE auction_lots SET winner_club=$2,price=$3 WHERE id=$1",[l.id,to,fee||null]);
   await note(c,room.id,`🔨 Leilão no grupo: ${pname(pid)} foi para o ${cname(to)}${fee?` por € ${(fee/1e6).toFixed(1)} mi`:''}.`);return {ok:1,player:pname(pid),club:cname(to)};});s.json(out);}));
 app.post('/api/rooms/:code/zc/admin/auction/add',auth,wrap(async(r,s)=>{const room=await member(r);own(room,r);const st=stOf(room),state=stateOf(room);if(!CAL[st]||!['waiting','auction'].includes(state))throw fail('Agora não é período de leilão');
  const [cnt]=await q("SELECT count(*)::int n FROM auction_lots WHERE room_id=$1 AND season=$2 AND status='open'",[room.id,room.season]);if(cnt.n>=CAL[st].lots)throw fail(`O ${CAL[st].label} já tem ${CAL[st].lots} jogadores (máximo)`);
  const p=await R.player(pool,room.id,+r.body?.player_id);if(!p)throw fail('Jogador não encontrado');
  if(!L.CLUBS.includes(p.club_id))throw fail('Só jogadores dos 40 clubes');if(p.loan_from)throw fail('Jogador emprestado não pode ir a leilão');
  const [d]=await q("SELECT id FROM auction_lots WHERE room_id=$1 AND season=$2 AND player_id=$3 AND status='open'",[room.id,room.season,p.id]);if(d)throw fail('Jogador já está no leilão');const [d2]=await q("SELECT id FROM auction_lots WHERE room_id=$1 AND season=$2 AND from_club=$3 AND status='open'",[room.id,room.season,p.club_id]);if(d2)throw fail(`Já há um jogador do ${cname(p.club_id)} neste leilão (máximo 1 por clube)`);
  const min=+r.body?.min_bid>0?Math.round(+r.body.min_bid):Math.max(1e5,Math.round((+p.market_value||1e6)*(CF.auction?.min_bid_pct??.5)));const comp=await comp0(pool,room);
  await q('INSERT INTO auction_lots(room_id,season,player_id,from_club,min_bid,created_round,stage) VALUES($1,$2,$3,$4,$5,$6,$7)',[room.id,room.season,p.id,p.club_id,min,comp?.current_round||0,st]);await note(pool,room.id,`🔨 ${r.user.nick} colocou ${p.name} (${cname(p.club_id)}) no ${CAL[st].label}.`);s.json({ok:1});}));
 app.post('/api/rooms/:code/zc/admin/auction/remove',auth,wrap(async(r,s)=>{const room=await member(r);own(room,r);await q("DELETE FROM auction_lots WHERE id=$1 AND room_id=$2 AND status='open'",[+r.body?.lot_id,room.id]);s.json({ok:1});}));
 async function calAction(room,a,nick){const st=stOf(room),C=CAL[st];
  return tx(room,async c=>{const [rm]=(await c.query('SELECT * FROM rooms WHERE id=$1 FOR UPDATE',[room.id])).rows;const state=stateOf(rm);
   const openMarket=async()=>{await c.query("UPDATE rooms SET auction_open=false,mkt_stage=$2,mkt_state='market',mkt_until=now()+make_interval(hours=>$3),window_was_open=true WHERE id=$1",[room.id,st,C.hours]);
    const [x]=(await c.query('SELECT mkt_until FROM rooms WHERE id=$1',[room.id])).rows;await note(c,room.id,`🔓 ${C.mlabel} aberto até ${M.brt(x.mkt_until)} (horário de Brasília). Fecha sozinho no prazo.`);};
   if(a==='auction_start'){if(!C||state!=='waiting')throw fail('Não há leilão pendente agora');const [n]=(await c.query("SELECT count(*)::int n FROM auction_lots WHERE room_id=$1 AND season=$2 AND status='open'",[room.id,room.season])).rows;if(!n.n)throw fail('Adicione os jogadores do leilão antes de iniciar');
    const ex=st==='pre'?await top5(c,rm):[];await note(c,room.id,`🔓 ${nick} desbloqueou o ${C.label}.`);await c.query("UPDATE rooms SET auction_open=true,mkt_stage=$2,mkt_state='auction',auction_excl=$3 WHERE id=$1",[room.id,st,ex]);
    await note(c,room.id,`🔨 ${C.label} aberto com ${n.n} jogador(es)! Leilão aberto: lances visíveis, cada novo lance precisa superar o maior, cada clube leva no máximo 1.`+(ex.length?` Não podem dar lance (5 maiores overs): ${ex.map(cname).join(', ')}.`:''));return {ok:1};}
   if(a==='auction_close'){if(state!=='auction')throw fail('O leilão não está aberto');await c.query('UPDATE rooms SET auction_open=false WHERE id=$1',[room.id]);const n=await resolveAuction(c,{...rm,auction_open:false});
    await note(c,room.id,`🔨 ${C.label} encerrado: ${n} jogador(es) arrematado(s).`);await openMarket();return {ok:1,sold:n};}
   if(a==='open_market'){if(!C||state!=='waiting')throw fail('Só dá pra pular o leilão quando ele ainda não começou');await c.query("UPDATE auction_lots SET status='unsold' WHERE room_id=$1 AND season=$2 AND status='open'",[room.id,room.season]);await note(c,room.id,`⏭️ ${nick} pulou o ${C.label}.`);await openMarket();return {ok:1};}
   if(a==='market_close'){if(rm.mkt_state!=='market')throw fail('O mercado não está aberto');await c.query("UPDATE rooms SET mkt_state='done',mkt_until=LEAST(mkt_until,now()) WHERE id=$1",[room.id]);await note(c,room.id,`🔒 ${nick} fechou o mercado antes do prazo.`);await M.after(c,{...rm,mkt_state:'done'});return {ok:1};}
   throw fail('Ação inválida');});}
 app.post('/api/rooms/:code/zc/admin/cal',auth,wrap(async(r,s)=>{const room=await member(r);own(room,r);s.json(await calAction(room,r.body?.action,r.user.nick));}));
 app.post('/api/rooms/:code/zc/admin/auction/state',auth,wrap(async(r,s)=>{const room=await member(r);own(room,r);const a=r.body?.action;s.json(await calAction(room,a==='open'?'auction_start':a==='close'?'auction_close':a,r.user.nick));}));
 // fechamento automático no prazo
 const sweepSkip=new Set();let sweepN=0;
 async function sweep(){try{if(++sweepN%10===0)sweepSkip.clear();const rs=(await pool.query("SELECT * FROM rooms WHERE (mkt_state='market' AND mkt_until<=now()) OR (window_was_open AND coalesce(mkt_state,'')<>'market')")).rows;
  for(const rm of rs){if(sweepSkip.has(rm.id)&&!(rm.mkt_state==='market'))continue;const c=await pool.connect();try{await c.query('BEGIN');const [x]=(await c.query('SELECT * FROM rooms WHERE id=$1 FOR UPDATE',[rm.id])).rows;
    let ch=false;if(x.mkt_state==='market'&&new Date(x.mkt_until)<=Date.now()){await c.query("UPDATE rooms SET mkt_state='done' WHERE id=$1",[x.id]);x.mkt_state='done';ch=true;}
    await M.after(c,x);const [y]=(await c.query('SELECT window_was_open FROM rooms WHERE id=$1',[x.id])).rows;if(y.window_was_open!==x.window_was_open)ch=true;
    // só incrementa a versão se algo mudou (antes: +1 a cada 30 s, fazendo todo celular recarregar tudo e travando o servidor)
    if(ch)await c.query('UPDATE rooms SET version=version+1 WHERE id=$1',[x.id]);await c.query('COMMIT');if(!ch)sweepSkip.add(x.id);}catch(e){await c.query('ROLLBACK');console.error('sweep',e.message)}finally{c.release()}}}catch(e){console.error('sweep',e.message)}}
 setInterval(sweep,+process.env.SWEEP_MS||30000);setTimeout(sweep,5000);
 // agenda automática (config/agenda-zc.json): desbloqueia o leilão, fecha o leilão (abre o mercado) e fixa o fim do mercado, mesmo sem ninguém online
 const AG=JSON.parse(require('fs').readFileSync(__dirname+'/config/agenda-zc.json','utf8'));
 async function agenda(){try{const [rm]=(await pool.query('SELECT * FROM rooms WHERE code=$1',[AG.room])).rows;if(!rm)return;const now=Date.now(),st=stOf(rm),state=stateOf(rm);
  if(st==='pre'&&state==='waiting'&&now>=Date.parse(AG.auction_start)&&now<Date.parse(AG.auction_close)){await calAction(rm,'auction_start','Agenda automática');await pool.query('UPDATE rooms SET version=version+1 WHERE id=$1',[rm.id]);console.log('agenda: leilão aberto');}
  else if(st==='pre'&&state==='auction'&&rm.auction_open&&now>=Date.parse(AG.auction_close)){await tx(rm,async c=>{const [x]=(await c.query('SELECT * FROM rooms WHERE id=$1 FOR UPDATE',[rm.id])).rows;if(!x.auction_open)return;await c.query('UPDATE rooms SET auction_open=false WHERE id=$1',[rm.id]);const n=await resolveAuction(c,{...x,auction_open:false});
    await note(c,rm.id,`🔨 Leilão de pré-temporada encerrado: ${n} jogador(es) arrematado(s). ${AG.market_open?`O mercado abre ${M.brt(AG.market_open)} (horário de Brasília).`:'Abertura do mercado a definir.'}`);});console.log('agenda: leilão fechado');}
  else if(st==='pre'&&state==='auction'&&!rm.auction_open&&AG.market_open&&now>=Date.parse(AG.market_open)){await calAction(rm,'auction_close','Agenda automática');console.log('agenda: mercado aberto');}
  const [x]=(await pool.query('SELECT * FROM rooms WHERE id=$1',[rm.id])).rows;if(x.mkt_stage==='pre'&&x.mkt_state==='market'&&new Date(x.mkt_until).getTime()!==Date.parse(AG.market_close)){await pool.query('UPDATE rooms SET mkt_until=$2,version=version+1 WHERE id=$1',[x.id,AG.market_close]);console.log('agenda: fim do mercado ajustado');}
  const W=(AG.windows||{})[st];if(W&&rm.status==='season'){const [y]=(await pool.query('SELECT * FROM rooms WHERE id=$1',[rm.id])).rows,sy=stateOf(y);
   if(sy==='waiting'&&now>=Date.parse(W.auction_start)){try{await calAction(y,now<Date.parse(W.auction_close)?'auction_start':'open_market','Agenda automática');}catch(e){if(now>=Date.parse(W.auction_close))await calAction(y,'open_market','Agenda automática');}await pool.query('UPDATE rooms SET version=version+1 WHERE id=$1',[y.id]);console.log('agenda: janela',st);}
   else if(sy==='auction'&&now>=Date.parse(W.auction_close)){await calAction(y,'auction_close','Agenda automática');console.log('agenda: leilão fechado',st);}
   else if(y.mkt_state==='market'&&y.mkt_stage===st&&new Date(y.mkt_until).getTime()!==Date.parse(W.market_close)&&!y.zc_mkt_fixed){await pool.query('UPDATE rooms SET mkt_until=$2,version=version+1 WHERE id=$1',[y.id,W.market_close]);console.log('agenda: fim do mercado',st);}}
 }catch(e){console.error('agenda',e.message)}}
 setInterval(agenda,15000);setTimeout(agenda,3000);
 // correção pontual (pedido do Robson 26/10): vale o maior lance removido. Idempotente: só age se o valor antigo ainda estiver lá.
 async function fixLancesRemovidos(){const FX=[{lot:9,pid:76624,club:758,old:20e6,fee:50e6},{lot:10,pid:247257,club:123,old:76e6,fee:80e6}];
  for(const f of FX){const c=await pool.connect();try{await c.query('BEGIN');
   const [l]=(await c.query("SELECT * FROM auction_lots WHERE id=$1 AND player_id=$2 AND winner_club=$3 AND status='sold' FOR UPDATE",[f.lot,f.pid,f.club])).rows;
   if(!l||+l.price!==f.old){await c.query('ROLLBACK');continue;}
   const [t]=(await c.query("SELECT id FROM transfers WHERE room_id=$1 AND player_id=$2 AND to_club=$3 AND fee=$4 AND kind='leilão' ORDER BY id DESC LIMIT 1",[l.room_id,f.pid,f.club,f.old])).rows;
   if(!t){await c.query('ROLLBACK');console.log('fixLances: transfer não achado',f.lot);continue;}
   const d=f.fee-f.old;
   await c.query('UPDATE transfers SET fee=$2 WHERE id=$1',[t.id,f.fee]);
   await c.query('UPDATE auction_lots SET price=$2 WHERE id=$1',[l.id,f.fee]);
   await c.query('UPDATE room_clubs SET budget=budget-$3 WHERE room_id=$1 AND club_id=$2',[l.room_id,f.club,d]);
   if(!R.isFree||!R.isFree(l.from_club))await c.query('UPDATE room_clubs SET budget=budget+$3 WHERE room_id=$1 AND club_id=$2',[l.room_id,l.from_club,d]);
   await c.query('UPDATE auction_bids SET amount=$3 WHERE lot_id=$1 AND club_id=$2',[l.id,f.club,f.fee]);
   await c.query('UPDATE auction_bid_log SET removed_at=NULL WHERE id=(SELECT id FROM auction_bid_log WHERE lot_id=$1 AND club_id=$2 AND amount=$3 ORDER BY id DESC LIMIT 1)',[l.id,f.club,f.fee]);
   await c.query('UPDATE rooms SET version=version+1 WHERE id=$1',[l.room_id]);
   await c.query('COMMIT');console.log('fixLances: lote',f.lot,'corrigido');}catch(e){await c.query('ROLLBACK').catch(()=>{});console.log('fixLances erro',e.message);}finally{c.release();}}}
 setTimeout(()=>fixLancesRemovidos().catch(e=>console.log('fixLances',e.message)),8000);

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
 app.post('/api/rooms/:code/zc/admin/window',auth,wrap(async(r,s)=>{const room=await member(r);own(room,r);const a=r.body?.action;if(a==='close'||a==='finalize')return s.json(await calAction(room,'market_close',r.user.nick));throw fail('O mercado agora segue o calendário: use o leilão na Central da liga');}));
 app.get('/api/rooms/:code/zc/admin/transfers',auth,wrap(async(r,s)=>{const room=await member(r);own(room,r);const t=String(r.query.q||'').toLowerCase();
  const rows=await q("SELECT * FROM transfers WHERE room_id=$1 AND fee>0 ORDER BY id DESC LIMIT 300",[room.id]);
  s.json(rows.map(x=>({...x,...TRX(x),contested:x.status==='contested',fee:+x.fee,player:pname(x.player_id),from:cname(x.from_club),to:cname(x.to_club)})).filter(x=>!t||(x.player+' '+x.from+' '+x.to).toLowerCase().includes(t)).slice(0,50));}));
 // Contestação de transferência (admins): contestar -> manter | cancelar (reverte tudo)
 const trAct=async(r,fn)=>{const room=await member(r);own(room,r);const c=await pool.connect();
  try{await c.query('BEGIN');const [t]=(await c.query('SELECT * FROM transfers WHERE id=$1 AND room_id=$2 FOR UPDATE',[+r.body?.transfer_id||+r.params.id,room.id])).rows;if(!t)throw fail('Transferência não encontrada');
   await fn(c,room,t);await c.query('UPDATE rooms SET version=version+1 WHERE id=$1',[room.id]);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}};
 const desc=t=>`${pname(t.player_id)} (${cname(t.from_club)} → ${cname(t.to_club)}${+t.fee?`, € ${(t.fee/1e6).toFixed(1)} mi`:''})`;
 const contest=wrap(async(r,s)=>{await trAct(r,async(c,room,t)=>{if(t.status==='cancelled')throw fail('Transferência já cancelada');if(t.status==='contested')throw fail('Já está contestada');
   await c.query("UPDATE transfers SET status='contested',contested_by=$2,contested_at=now() WHERE id=$1",[t.id,r.user.nick]);await note(c,room.id,`⚖️ ${r.user.nick} contestou a transferência de ${desc(t)}.`);});s.json({ok:1});});
 app.post('/api/rooms/:code/zc/admin/contest',auth,contest);app.post('/api/rooms/:code/zc/admin/transfer/:id/contest',auth,contest);
 app.post('/api/rooms/:code/zc/admin/transfer/:id/keep',auth,wrap(async(r,s)=>{await trAct(r,async(c,room,t)=>{if(t.status!=='contested')throw fail('A transferência não está contestada');
   await c.query("UPDATE transfers SET status='ok',contested_by=NULL,contested_at=NULL WHERE id=$1",[t.id]);await note(c,room.id,`✅ ${r.user.nick} manteve a transferência de ${desc(t)}.`);});s.json({ok:1});}));
 app.post('/api/rooms/:code/zc/admin/transfer/:id/cancel',auth,wrap(async(r,s)=>{await trAct(r,async(c,room,t)=>{if(t.status==='cancelled')throw fail('Transferência já cancelada');if(t.status!=='contested')throw fail('Conteste a transferência antes de cancelar');
   const later=(await c.query("SELECT 1 FROM transfers WHERE room_id=$1 AND player_id=$2 AND id>$3 AND status<>'cancelled'",[room.id,t.player_id,t.id])).rows.length;
   const p=await R.player(c,room.id,t.player_id);if(later||p.club_id!==t.to_club)throw fail('Não dá para cancelar: o jogador já foi transferido de novo depois desta transferência. Cancele a mais recente primeiro.');
   const pv=t.prev;if(pv&&pv.none)await c.query('DELETE FROM room_players WHERE room_id=$1 AND player_id=$2',[room.id,t.player_id]);
   else if(pv){const cols=Object.keys(pv).filter(k=>!['room_id','player_id'].includes(k));await c.query(`UPDATE room_players SET ${cols.map((k,i)=>`${k}=$${i+3}`).join(',')} WHERE room_id=$1 AND player_id=$2`,[room.id,t.player_id,...cols.map(k=>pv[k])]);}
   else await c.query('UPDATE room_players SET club_id=$3,loan_from=NULL,loan_until=NULL WHERE room_id=$1 AND player_id=$2',[room.id,t.player_id,t.from_club]);
   if(+t.fee){await c.query('UPDATE room_clubs SET budget=budget+$3 WHERE room_id=$1 AND club_id=$2',[room.id,t.to_club,t.fee]);if(!R.isFree||!R.isFree(t.from_club))await c.query('UPDATE room_clubs SET budget=budget-$3 WHERE room_id=$1 AND club_id=$2',[room.id,t.from_club,t.fee]);}
   await c.query('UPDATE lineups SET starters=NULL WHERE room_id=$1 AND club_id=$2 AND $3=ANY(starters)',[room.id,t.to_club,t.player_id]);
   await c.query("UPDATE transfers SET status='cancelled',cancelled_by=$2,cancelled_at=now() WHERE id=$1",[t.id,r.user.nick]);
   await note(c,room.id,`↩️ ${r.user.nick} cancelou a transferência de ${desc(t)}: jogador voltou e valores devolvidos.`);});s.json({ok:1});}));
 app.get('/api/rooms/:code/zc/log',auth,wrap(async(r,s)=>{const room=await member(r);s.json(await q('SELECT id,text,created_at FROM room_events WHERE room_id=$1 ORDER BY id DESC LIMIT 150',[room.id]));}));
 // correção pontual (Robson 26/10): Kaiki Bruno -> Universitario 23,2 mi; Talisca -> LDU Quito 95 mi. Idempotente.
 async function moveLot(f){const c=await pool.connect();const T='FIXMOVE '+f.tag;try{await c.query('BEGIN');
  const FROMC=L.CLUBS.find(id=>cname(id)===f.from),TOC=L.CLUBS.find(id=>cname(id)===f.to);
  const ls=(await c.query("SELECT * FROM auction_lots WHERE status='sold' AND winner_club=$1 AND price=$2 FOR UPDATE",[FROMC,f.old])).rows.filter(l=>f.re.test(pname(l.player_id)||''));
  if(ls.length!==1){console.log(T,'SKIP',ls.length);await c.query('ROLLBACK');return;}const l=ls[0];const pn=pname(l.player_id);
  const bud=async id=>+(await c.query('SELECT budget FROM room_clubs WHERE room_id=$1 AND club_id=$2',[l.room_id,id])).rows[0]?.budget;
  const p=await R.player(c,l.room_id,l.player_id);const av=await avail(c,{id:l.room_id},TOC);
  const sqT=await R.squad(c,l.room_id,TOC,false),sqF=await R.squad(c,l.room_id,FROMC,false);
  const wonT=(await c.query("SELECT id FROM auction_lots WHERE room_id=$1 AND season=$2 AND status='sold' AND winner_club=$3 AND id<>$4",[l.room_id,l.season,TOC,l.id])).rows;
  const [t]=(await c.query("SELECT id FROM transfers WHERE room_id=$1 AND player_id=$2 AND to_club=$3 AND fee=$4 AND kind='leilão' ORDER BY id DESC LIMIT 1",[l.room_id,l.player_id,FROMC,f.old])).rows;
  const free=!!(R.isFree&&R.isFree(l.from_club));
  const info={lot:l.id,player:pn,before:{[f.from]:await bud(FROMC),[f.to]:await bud(TOC),[cname(l.from_club)]:free?'não contabilizado':await bud(l.from_club)},to_avail:av,to_squad:sqT.length,from_squad:sqF.length,to_other_wins:wonT.map(x=>x.id),shielded:!!p?.shielded};
  const bad=[];if(!TOC)bad.push('clube destino não achado');if(p?.club_id!==FROMC)bad.push('jogador não está no clube');if(p?.shielded)bad.push('blindado');if(av<f.fee)bad.push('sem caixa');if(sqF.length-1<11)bad.push('origem abaixo do mínimo');if(wonT.length)bad.push('destino já levou outro lote');if(!t)bad.push('transferência não achada');
  if(bad.length){console.log(T,'STOP',JSON.stringify({bad,...info}));await c.query('ROLLBACK');return;}
  await c.query('UPDATE room_players SET club_id=$3 WHERE room_id=$1 AND player_id=$2',[l.room_id,l.player_id,TOC]);
  await c.query('UPDATE lineups SET starters=NULL WHERE room_id=$1 AND club_id=$2 AND $3=ANY(starters)',[l.room_id,FROMC,l.player_id]);
  await c.query('UPDATE room_clubs SET budget=budget+$3 WHERE room_id=$1 AND club_id=$2',[l.room_id,FROMC,f.old]);
  await c.query('UPDATE room_clubs SET budget=budget-$3 WHERE room_id=$1 AND club_id=$2',[l.room_id,TOC,f.fee]);
  if(!free)await c.query('UPDATE room_clubs SET budget=budget+$3 WHERE room_id=$1 AND club_id=$2',[l.room_id,l.from_club,f.fee-f.old]);
  await c.query('UPDATE transfers SET to_club=$2,fee=$3 WHERE id=$1',[t.id,TOC,f.fee]);
  await c.query('UPDATE auction_lots SET winner_club=$2,price=$3 WHERE id=$1',[l.id,TOC,f.fee]);
  // lances do clube perdedor acima do novo valor saem do histórico
  await c.query('DELETE FROM auction_bids WHERE lot_id=$1 AND club_id=$2 AND amount>=$3',[l.id,FROMC,f.fee]);
  await c.query('UPDATE auction_bid_log SET removed_at=now() WHERE lot_id=$1 AND club_id=$2 AND amount>=$3 AND removed_at IS NULL',[l.id,FROMC,f.fee]);
  if(f.fee>f.old){await c.query('UPDATE auction_bids SET amount=$3 WHERE lot_id=$1 AND club_id=$2',[l.id,TOC,f.fee]);}
  await note(c,l.room_id,`⚖️ Correção da administração: ${pn} vai para o ${f.to} por € ${(f.fee/1e6).toFixed(1)} mi. O ${f.from} recebeu de volta € ${(f.old/1e6).toFixed(1)} mi.`);
  await c.query('UPDATE rooms SET version=version+1 WHERE id=$1',[l.room_id]);await c.query('COMMIT');
  info.after={[f.from]:await bud(FROMC),[f.to]:await bud(TOC)};if(!free)info.after[cname(l.from_club)]=await bud(l.from_club);console.log(T,'OK',JSON.stringify(info));
 }catch(e){await c.query('ROLLBACK').catch(()=>{});console.log(T,'ERR',e.message);}finally{c.release();}}
 // lotes SUSPENSOS (Robson 26/10): desfaz a venda e volta ao estado TRAVADO (unsold no Leilão ZC), mantendo o histórico de lances
 const SUSP=[['Vanderson','Grêmio',18.1e6],['Yan Couto','Cerro Porteño',20e6],['Valentín Gómez','Vasco',26e6],['Gabriel Sara','Bahia',67e6],['Luiz Henrique','Barcelona',55e6],['David Neres','Racing',65e6],['Brian Rodr','Olimpia',50e6]].map(([n,c,v])=>({n,c,v}));
 async function suspendLot(f){const c=await pool.connect();const T='FIXSUSP '+f.n;try{await c.query('BEGIN');
  const ls=(await c.query("SELECT * FROM auction_lots WHERE status='sold' AND price=$1 FOR UPDATE",[f.v])).rows.filter(l=>(pname(l.player_id)||'').startsWith(f.n)&&(cname(l.winner_club)||'').startsWith(f.c));
  if(ls.length!==1){console.log(T,'SKIP',ls.length);await c.query('ROLLBACK');return;}const l=ls[0],W=l.winner_club,rid=l.room_id;
  const bud=async id=>+(await c.query('SELECT budget FROM room_clubs WHERE room_id=$1 AND club_id=$2',[rid,id])).rows[0]?.budget;
  const p=await R.player(c,rid,l.player_id);const [t]=(await c.query("SELECT * FROM transfers WHERE room_id=$1 AND player_id=$2 AND to_club=$3 AND fee=$4 AND kind='leilão' AND status IS DISTINCT FROM 'cancelled' ORDER BY id DESC LIMIT 1",[rid,l.player_id,W,f.v])).rows;
  const later=t?(await c.query("SELECT 1 FROM transfers WHERE room_id=$1 AND player_id=$2 AND id>$3 AND status IS DISTINCT FROM 'cancelled'",[rid,l.player_id,t.id])).rows.length:0;
  const free=!!(R.isFree&&R.isFree(l.from_club));const info={lot:l.id,player:pname(l.player_id),club:cname(W),before:{[cname(W)]:await bud(W),'Leilão ZC':free?'n/c':await bud(l.from_club)}};
  const bad=[];if(p?.club_id!==W)bad.push('jogador não está no comprador');if(!t)bad.push('transferência não achada');if(later)bad.push('transferido depois');
  if(bad.length){console.log(T,'STOP',JSON.stringify({bad,...info}));await c.query('ROLLBACK');return;}
  const pv=t.prev;if(pv&&!pv.none){const cols=Object.keys(pv).filter(k=>!['room_id','player_id'].includes(k));await c.query(`UPDATE room_players SET ${cols.map((k,i)=>`${k}=$${i+3}`).join(',')} WHERE room_id=$1 AND player_id=$2`,[rid,l.player_id,...cols.map(k=>pv[k])]);}
  await c.query('UPDATE room_players SET club_id=$3,loan_from=NULL,loan_until=NULL,listed=false,shielded=false WHERE room_id=$1 AND player_id=$2',[rid,l.player_id,l.from_club]);
  await c.query('UPDATE lineups SET starters=NULL WHERE room_id=$1 AND club_id=$2 AND $3=ANY(starters)',[rid,W,l.player_id]);
  await c.query('UPDATE room_clubs SET budget=budget+$3 WHERE room_id=$1 AND club_id=$2',[rid,W,f.v]);
  if(!free)await c.query('UPDATE room_clubs SET budget=budget-$3 WHERE room_id=$1 AND club_id=$2',[rid,l.from_club,f.v]);
  await c.query("UPDATE transfers SET status='cancelled',cancelled_by='admin (lote suspenso)',cancelled_at=now() WHERE id=$1",[t.id]);
  await c.query("UPDATE auction_lots SET status='unsold',winner_club=NULL,price=NULL WHERE id=$1",[l.id]);
  await note(c,rid,`🔒 Lote SUSPENSO pela administração: ${pname(l.player_id)} volta a ficar TRAVADO (venda ao ${cname(W)} desfeita, € ${(f.v/1e6).toFixed(1)} mi devolvidos). A administração vai definir o clube.`);
  await c.query('UPDATE rooms SET version=version+1 WHERE id=$1',[rid]);await c.query('COMMIT');
  info.after={[cname(W)]:await bud(W),'Leilão ZC':free?'n/c':await bud(l.from_club)};console.log(T,'OK',JSON.stringify(info));
 }catch(e){await c.query('ROLLBACK').catch(()=>{});console.log(T,'ERR',e.message);}finally{c.release();}}
 // Jair: suspensão desfeita (Robson 26/10) -> volta vendido ao São Paulo por 40 mi. Idempotente.
 async function unsuspend(LOT,RE,CN,FEE){const c=await pool.connect();const T='FIXUNSUSP '+LOT;try{await c.query('BEGIN');
  const SP=L.CLUBS.find(id=>cname(id)===CN);const [l]=(await c.query("SELECT * FROM auction_lots WHERE id=$1 AND status='unsold' FOR UPDATE",[LOT])).rows;
  if(!l||!RE.test(pname(l.player_id)||'')){console.log(T,'SKIP');await c.query('ROLLBACK');return;}const rid=l.room_id;
  const p=await R.player(c,rid,l.player_id);const [t]=(await c.query("SELECT * FROM transfers WHERE room_id=$1 AND player_id=$2 AND to_club=$3 AND fee=$4 AND status='cancelled' ORDER BY id DESC LIMIT 1",[rid,l.player_id,SP,FEE])).rows;
  const bud=async id=>+(await c.query('SELECT budget FROM room_clubs WHERE room_id=$1 AND club_id=$2',[rid,id])).rows[0]?.budget;const b0=await bud(SP);
  if(p?.club_id!==l.from_club||!t){console.log(T,'STOP',JSON.stringify({club:cname(p?.club_id),t:!!t}));await c.query('ROLLBACK');return;}
  await c.query('UPDATE room_players SET club_id=$3,wage=$4,contract_end=$5,morale=75,wants_out=false,listed=false,loan_from=NULL,loan_until=NULL,release_clause=NULL WHERE room_id=$1 AND player_id=$2',[rid,l.player_id,SP,t.wage,l.season+3]);
  await c.query('UPDATE room_clubs SET budget=budget-$3 WHERE room_id=$1 AND club_id=$2',[rid,SP,FEE]);
  if(!(R.isFree&&R.isFree(l.from_club)))await c.query('UPDATE room_clubs SET budget=budget+$3 WHERE room_id=$1 AND club_id=$2',[rid,l.from_club,FEE]);
  await c.query("UPDATE transfers SET status='ok',cancelled_by=NULL,cancelled_at=NULL WHERE id=$1",[t.id]);
  await c.query("UPDATE auction_lots SET status='sold',winner_club=$2,price=$3 WHERE id=$1",[l.id,SP,FEE]);
  await note(c,rid,`↩️ Correção da administração: a suspensão do ${pname(l.player_id)} foi desfeita. Ele continua no ${CN} por € ${(FEE/1e6).toFixed(1)} mi.`);
  await c.query('UPDATE rooms SET version=version+1 WHERE id=$1',[rid]);await c.query('COMMIT');console.log(T,'OK',JSON.stringify({before:b0,after:await bud(SP)}));
 }catch(e){await c.query('ROLLBACK').catch(()=>{});console.log(T,'ERR',e.message);}finally{c.release();}}
 // Talisca: site mostra LDU como vencedora (lances do Santa Fe removidos do histórico; lance de 95 mi da LDU volta se tiver sido removido)
 async function taliscaLog(){try{const SF=L.CLUBS.find(id=>cname(id)==='Indep. Santa Fe'),LDU=L.CLUBS.find(id=>cname(id)==='LDU Quito');
  const [l]=await q("SELECT id FROM auction_lots WHERE id=16 AND status='sold' AND winner_club=$1 AND price=95000000",[LDU]);if(!l){console.log('FIXTALOG SKIP');return;}
  const a=await q('UPDATE auction_bid_log SET removed_at=now() WHERE lot_id=16 AND club_id=$1 AND removed_at IS NULL RETURNING id',[SF]);
  const b=await q('UPDATE auction_bid_log SET removed_at=NULL WHERE id=(SELECT id FROM auction_bid_log WHERE lot_id=16 AND club_id=$1 AND amount=95000000 ORDER BY id DESC LIMIT 1) AND removed_at IS NOT NULL RETURNING id',[LDU]);
  await q('DELETE FROM auction_bids WHERE lot_id=16 AND club_id=$1',[SF]);await pool.query('UPDATE rooms SET version=version+1 WHERE id=(SELECT room_id FROM auction_lots WHERE id=16)');console.log('FIXTALOG OK',a.length,b.length);}catch(e){console.log('FIXTALOG ERR',e.message);}}
 // Savinho (lote 19): Universidad Católica paga 90 mi em vez de 95 mi (Robson 26/10). Idempotente.
 async function savinho90(){const c=await pool.connect();const T='FIXSAV';try{await c.query('BEGIN');
  const UC=L.CLUBS.find(id=>cname(id)==='Universidad Católica');const [l]=(await c.query("SELECT * FROM auction_lots WHERE id=19 AND status='sold' AND winner_club=$1 AND price=95000000 FOR UPDATE",[UC])).rows;
  if(!l||!/^savinho/i.test(pname(l.player_id)||'')){console.log(T,'SKIP');await c.query('ROLLBACK');return;}
  const [t]=(await c.query("SELECT id FROM transfers WHERE room_id=$1 AND player_id=$2 AND to_club=$3 AND fee=95000000 AND kind='leilão' AND status IS DISTINCT FROM 'cancelled' ORDER BY id DESC LIMIT 1",[l.room_id,l.player_id,UC])).rows;
  if(!t){console.log(T,'STOP sem transferência');await c.query('ROLLBACK');return;}
  const bud=async()=>+(await c.query('SELECT budget FROM room_clubs WHERE room_id=$1 AND club_id=$2',[l.room_id,UC])).rows[0]?.budget;const b0=await bud();
  await c.query('UPDATE transfers SET fee=90000000 WHERE id=$1',[t.id]);await c.query('UPDATE auction_lots SET price=90000000 WHERE id=$1',[l.id]);
  await c.query('UPDATE room_clubs SET budget=budget+5000000 WHERE room_id=$1 AND club_id=$2',[l.room_id,UC]);
  await c.query('UPDATE rooms SET version=version+1 WHERE id=$1',[l.room_id]);await c.query('COMMIT');console.log(T,'OK',JSON.stringify({before:b0,after:await bud()}));
 }catch(e){await c.query('ROLLBACK').catch(()=>{});console.log(T,'ERR',e.message);}finally{c.release();}}
 // Yan Couto (lote 4, travado) -> Atlético Nacional por 16 mi, como o botão "Definir clube" (Robson 26/10). Idempotente.
 // definir clube de lote travado (Robson 26/10): Yan Couto, Luiz Henrique, David Neres, Gabriel Sara, Brian Rodríguez, Vanderson (27/10). Idempotente.
 async function assignLot(LOT,RE,CN,FEE){const c=await pool.connect();const T='FIXASSIGN '+LOT;try{await c.query('BEGIN');
  const AN=L.CLUBS.find(id=>cname(id)===CN);const AUCZ=[...R.C.values()].find(x=>x.name==='Leilão ZC')?.id;
  const [l]=(await c.query("SELECT * FROM auction_lots WHERE id=$1 AND status='unsold' AND winner_club IS NULL FOR UPDATE",[LOT])).rows;
  if(!l||!RE.test(pname(l.player_id)||'')){console.log(T,'SKIP');await c.query('ROLLBACK');return;}const rid=l.room_id;
  const [rm]=(await c.query('SELECT * FROM rooms WHERE id=$1 FOR UPDATE',[rid])).rows;const p=await R.player(c,rid,l.player_id);
  const bud=async()=>+(await c.query('SELECT budget FROM room_clubs WHERE room_id=$1 AND club_id=$2',[rid,AN])).rows[0]?.budget;const b0=await bud();const av=await avail(c,rm,AN);
  const won=(await c.query("SELECT id FROM auction_lots WHERE room_id=$1 AND season=$2 AND winner_club=$3",[rid,l.season,AN])).rows;
  const lastBid=(await c.query('SELECT amount FROM auction_bid_log WHERE lot_id=$1 AND club_id=$2 ORDER BY id DESC LIMIT 1',[l.id,AN])).rows[0];
  const info={before:b0,avail:av,other_wins:won.map(x=>x.id),last_bid:lastBid&&+lastBid.amount,club_now:cname(p?.club_id),shielded:!!p?.shielded};
  const bad=[];if(!AN)bad.push('clube não achado');if(p?.club_id!==AUCZ)bad.push('não está travado');if(av<FEE)bad.push('sem caixa');if(won.length)bad.push('já levou outro lote');
  if(bad.length){console.log(T,'STOP',JSON.stringify({bad,...info}));await c.query('ROLLBACK');return;}
  await M.execute(c,rm,{pid:l.player_id,from:AUCZ,to:AN,fee:FEE,kind:'leilão no grupo'});
  await c.query("UPDATE auction_lots SET status='sold',winner_club=$2,price=$3 WHERE id=$1",[l.id,AN,FEE]);
  await note(c,rid,`🔨 Leilão no grupo: ${pname(l.player_id)} foi para o ${CN} por € ${(FEE/1e6).toFixed(1)} mi.`);
  await c.query('UPDATE rooms SET version=version+1 WHERE id=$1',[rid]);await c.query('COMMIT');info.after=await bud();console.log(T,'OK',JSON.stringify(info));
 }catch(e){await c.query('ROLLBACK').catch(()=>{});console.log(T,'ERR',e.message);}finally{c.release();}}

 // Robson 26/10 22:00: cancela propostas zeradas pendentes desde a abertura do mercado (21:40). Idempotente; não apaga linhas; não desfaz concluídas.
 async function zeroOffers(){const T='FIXZERO';try{const W="room_id=(SELECT id FROM rooms WHERE code='LIGA') AND COALESCE(fee,0)<=0 AND swap_player_id IS NULL AND NOT loan AND created_at>='2026-10-26T21:40:00-03:00'";
  const fmt=o=>({id:o.id,jogador:pname(o.player_id),de:cname(o.buyer_club),para:cname(o.seller_club),status:o.status,quando:new Date(o.created_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})});
  const rows=(await pool.query(`SELECT * FROM offers WHERE ${W} ORDER BY id`)).rows.filter(o=>!(R.isFree&&R.isFree(o.seller_club)));
  const pend=rows.filter(o=>['pending','countered','club_accepted'].includes(o.status)).map(o=>o.id);
  const done=rows.filter(o=>o.status==='done').map(fmt);
  let canc=[];if(pend.length)canc=(await pool.query("UPDATE offers SET status='withdrawn',reason='Cancelada pela administração (proposta zerada)',updated_at=now() WHERE id=ANY($1) AND status IN ('pending','countered','club_accepted') RETURNING *",[pend])).rows;
  console.log(T,'OK',JSON.stringify({canceladas:canc.length,lista:canc.map(fmt),concluidas_zeradas:done,todas_zeradas:rows.map(fmt)}));
 }catch(e){console.log(T,'ERR',e.message);}}

 // Auditoria somente leitura (Robson 26/10 22:03/22:04): negociações aceitas sem dinheiro movimentado e rescisões (salários cobrados) — não corrige nada.
 async function auditMoney(){const T='FIXAUDIT';try{const RID="(SELECT id FROM rooms WHERE code='LIGA')";const br=d=>new Date(d).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
  const acc=(await pool.query(`SELECT * FROM offers WHERE room_id=${RID} AND status='club_accepted' ORDER BY id`)).rows.map(o=>({id:o.id,jogador:pname(o.player_id),comprador:cname(o.buyer_club),vendedor:cname(o.seller_club),valor:+o.fee,aceita_em:br(o.updated_at),criada:br(o.created_at)}));
  const tr=(await pool.query(`SELECT * FROM transfers WHERE room_id=${RID} AND created_at>='2026-10-26T21:40:00-03:00' ORDER BY id`).catch(()=>pool.query(`SELECT * FROM transfers WHERE room_id=${RID} ORDER BY id DESC LIMIT 40`))).rows.map(t=>({id:t.id,jogador:pname(t.player_id),de:cname(t.from_club),para:cname(t.to_club),valor:+t.fee,tipo:t.kind,quando:t.created_at?br(t.created_at):null}));
  const resc=(await pool.query(`SELECT * FROM transfers WHERE room_id=${RID} AND kind='rescisão' ORDER BY id`)).rows.map(t=>({jogador:pname(t.player_id),clube:cname(t.from_club),salario_sem:+t.wage}));
  console.log(T,JSON.stringify({aceitas_sem_dinheiro:acc,transferencias_desde_2140:tr,rescisoes:resc}));
 }catch(e){console.log(T,'ERR',e.message);}}

 // Robson 26/10 22:09: cancela TODAS as propostas/negociações em aberto criadas até 22:09 (Brasília). Não apaga linhas; caixa reservado é liberado pela mudança de status. Concluídas não são tocadas.
 async function cancelAll2209(){const T='FIXCANCEL2209';try{const RID="(SELECT id FROM rooms WHERE code='LIGA')";
  const r=await pool.query(`UPDATE offers SET status='withdrawn',reason='Cancelada pela administração (todas as propostas até 26/10 22:09)',updated_at=now() WHERE room_id=${RID} AND status IN ('pending','countered','club_accepted') AND created_at<='2026-10-26T22:09:00-03:00' RETURNING *`);
  const lista=r.rows.map(o=>({id:o.id,jogador:pname(o.player_id),de:cname(o.seller_club),para:cname(o.buyer_club),valor:+o.fee,etapa_anterior:'aberta'}));
  if(r.rowCount)await pool.query(`UPDATE rooms SET version=version+1 WHERE id=${RID}`).catch(()=>{});
  const tudo=(await pool.query(`SELECT * FROM offers WHERE room_id=${RID} AND reason LIKE '%até 26/10 22:09%' ORDER BY id`)).rows.map(o=>`${o.id} ${pname(o.player_id)}: ${cname(o.seller_club)} -> ${cname(o.buyer_club)}`);
  console.log(T,JSON.stringify({canceladas_agora:r.rowCount,lista,total_canceladas_por_esta_ordem:tudo.length,todas:tudo}));
 }catch(e){console.log(T,'ERR',e.message);}}

 // Robson 26/10 22:18: fim do esfriamento — zera bloqueios ativos (só a coluna blocked_until).
 async function clearCooldowns(){const T='FIXCOOL';try{const r=await pool.query(`UPDATE negotiations n SET blocked_until=-1,club_fails=0,player_fails=0 FROM rooms r WHERE r.id=n.room_id AND n.blocked_until>=r.market_day RETURNING n.player_id,n.buyer_club`);const left=(await pool.query(`SELECT count(*)::int c FROM negotiations n JOIN rooms r ON r.id=n.room_id WHERE n.blocked_until>=r.market_day`)).rows[0].c;console.log(T,JSON.stringify({limpos:r.rowCount,lista:r.rows.map(x=>`${pname(x.player_id)} / ${cname(x.buyer_club)}`),ativos_restantes:left}));}catch(e){console.log(T,'ERR',e.message);}}

 // Robson 26/10 22:33: lista (somente leitura) propostas com troca ainda abertas criadas depois de 22:09.
 async function auditSwaps(){const T='FIXSWAPLIST';try{const r=await pool.query(`SELECT * FROM offers WHERE room_id=(SELECT id FROM rooms WHERE code='LIGA') AND swap_player_id IS NOT NULL AND status IN ('pending','countered','club_accepted') AND created_at>'2026-10-26T22:09:00-03:00' ORDER BY id`);console.log(T,JSON.stringify({total:r.rowCount,lista:r.rows.map(o=>({id:o.id,jogador:pname(o.player_id),de:cname(o.seller_club),para:cname(o.buyer_club),valor:+o.fee,troca:pname(o.swap_player_id),status:o.status,criada:new Date(o.created_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}))}));}catch(e){console.log(T,'ERR',e.message);}}

 // Robson 27/10 09:10: Hugo Bueno (261224, ex-Wolves) no Santos por 25,5 mi (valor do Kaiki no leilão). Decisão da administração; o valor não é creditado a ninguém.
 async function hugoBueno(){const T='FIXHUGO';const PID=261224,SAN=766,FEE=25.5e6;const c=await pool.connect();try{await c.query('BEGIN');
  const [rm]=(await c.query("SELECT * FROM rooms WHERE code='LIGA' FOR UPDATE")).rows;const rid=rm.id;
  const [ex]=(await c.query('SELECT club_id FROM room_players WHERE room_id=$1 AND player_id=$2',[rid,PID])).rows;
  const bud=async()=>+(await c.query('SELECT budget FROM room_clubs WHERE room_id=$1 AND club_id=$2',[rid,SAN])).rows[0]?.budget;const b0=await bud();
  if(ex){console.log(T,'SKIP já aplicado',JSON.stringify({clube:cname(ex.club_id),caixa_santos:b0}));await c.query('ROLLBACK');return;}
  const av=await avail(c,rm,SAN);if(!(b0>=FEE)){console.log(T,'STOP sem caixa',JSON.stringify({caixa_santos:b0,disponivel:av}));await c.query('ROLLBACK');return;}
  const w0=+(await c.query('SELECT budget FROM room_clubs WHERE room_id=$1 AND club_id=626',[rid])).rows[0]?.budget;
  await M.execute(c,rm,{pid:PID,from:626,to:SAN,fee:0,kind:'decisão da administração'}); // fee 0: nada é creditado ao Wolves
  await c.query('UPDATE room_clubs SET budget=budget-$3 WHERE room_id=$1 AND club_id=$2',[rid,SAN,FEE]);
  await c.query("UPDATE transfers SET fee=$3 WHERE id=(SELECT max(id) FROM transfers WHERE room_id=$1 AND player_id=$2)",[rid,PID,FEE]).catch(()=>{});
  const w1=+(await c.query('SELECT budget FROM room_clubs WHERE room_id=$1 AND club_id=626',[rid])).rows[0]?.budget;if(w0!==w1)throw new Error('caixa do Wolves mudou');
  const born=new Date('2002-09-18'),now=new Date();const age=now.getFullYear()-born.getFullYear()-((now.getMonth()<8||(now.getMonth()===8&&now.getDate()<18))?1:0);
  await c.query('UPDATE room_players SET age=$3 WHERE room_id=$1 AND player_id=$2',[rid,PID,age]);
  await note(c,rid,`🛡️ Decisão da administração: Hugo Bueno (LE, 75) foi para o Santos por € 25,5 mi.`);
  await c.query('UPDATE rooms SET version=version+1 WHERE id=$1',[rid]);const b1=await bud();
  const [rp]=(await c.query('SELECT * FROM room_players WHERE room_id=$1 AND player_id=$2',[rid,PID])).rows;
  await c.query('COMMIT');console.log(T,'OK',JSON.stringify({caixa_antes:b0,caixa_depois:b1,disponivel_antes:av,clube:cname(rp?.club_id),idade:rp?.age}));
 }catch(e){await c.query('ROLLBACK').catch(()=>{});console.log(T,'ERR',e.message);}finally{c.release();}}
 setTimeout(async()=>{await moveLot({tag:'kaiki',re:/kaiki/i,from:'Santos',to:'Universitario',old:25.5e6,fee:23.2e6});
  await moveLot({tag:'talisca',re:/talisca/i,from:'Indep. Santa Fe',to:'LDU Quito',old:46e6,fee:95e6});
  for(const f of SUSP)await suspendLot(f);await unsuspend(7,/^jair/i,'São Paulo',40e6);await unsuspend(22,/^marcos leonardo/i,'Vélez Sarsfield',130e6);await taliscaLog();await savinho90();await assignLot(4,/^yan couto/i,'Atlético Nacional',16e6);await assignLot(17,/^luiz henrique/i,'Barcelona de Guayaquil',55e6);await assignLot(18,/^david neres/i,'Racing',65e6);await assignLot(15,/^gabriel sara/i,'Lanús',130e6);await assignLot(20,/^brian rodr/i,'Olimpia',100e6);await assignLot(3,/^vanderson/i,'Cruzeiro',50e6);await zeroOffers();await auditMoney();await cancelAll2209();await clearCooldowns();await auditSwaps();await hugoBueno();},15000);
};
