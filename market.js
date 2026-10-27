const TRX=require('./dt').trx;
// Etapa 4: mercado de transferências por sala (ver CRITERIOS_MERCADO.md)
const S=require('./sim'),X=require('./rules');
module.exports=({app,uni,q,pool,auth,wrap,fail,member,bump,R})=>{
 const {C,L,FREE,isFree}=R;const LIB={has:id=>require('./libertadores').CLUBS.includes(id)};const clubName=id=>C.get(id)?.name||'Sem clube';const pname=id=>R.P.get(id)?.name||'?';
 const freeOf=g=>FREE[g==='F'?'F':'M'];
 // só existem no jogo jogadores dos 40 clubes (base): FC27 sem clube/fora da liga nunca entram no mercado, livres ou IA
 const AUC=[...C.values()].find(c=>c.name==='Leilão ZC')?.id; // jogadores do leilão (config/leilao-pre.json) também existem no jogo
 const inGame=id=>{const b=R.P.get(id)?.club_id;return LIB.has(b)||(AUC!=null&&b===AUC);};
 const repOf=c=>X.rep(c,L);const la=c=>L.get(c.league_id)?.attr||60;
 // ---------- janela ----------
 async function mainComp(db,room){return (await db.query('SELECT * FROM competitions WHERE room_id=$1 AND season=$2 ORDER BY rounds_total DESC,id LIMIT 1',[room.id,room.season])).rows[0];}
 // calendário: leilão (admins) -> mercado aberto com prazo (horário de Brasília) -> fechado. Fora disso, fechado.
 const CAL_LBL={pre:'pré-temporada',mid:'meio da fase de liga',end:'fim da fase de liga'};
 const brt=d=>new Date(d).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).replace(',','');
 function windowOf(room,comp){const st=room.mkt_stage||(room.status==='lobby'?'pre':null),lb=CAL_LBL[st]||'';
  if(room.auction_open)return {open:false,auction:true,stage:st,name:('Leilão '+(lb?'de '+lb:'')).trim()+' em andamento',day:0,days:3};
  const u=room.mkt_until?new Date(room.mkt_until):null;
  if(room.mkt_state==='market'&&u&&u>Date.now())return {open:true,stage:st,name:`Mercado aberto até ${brt(u)}`,until:u.toISOString(),closes:brt(u),day:0,days:3};
  return {open:false,stage:st,name:'Mercado fechado',day:0,days:3};}
 const note=(db,roomId,text,uid=null)=>db.query('INSERT INTO room_events(room_id,text,user_id) VALUES($1,$2,$3)',[roomId,text,uid]);
 const humans=async(db,roomId)=>new Map((await db.query('SELECT m.club_id,m.user_id,u.nick FROM room_managers m JOIN users u ON u.id=m.user_id WHERE room_id=$1 AND club_id IS NOT NULL',[roomId])).rows.map(x=>[x.club_id,x]));
 const myClub=async(db,room,uid)=>{const [m]=(await db.query('SELECT club_id FROM room_managers WHERE room_id=$1 AND user_id=$2',[room.id,uid])).rows;if(!m?.club_id)throw fail('Escolha um clube');return m.club_id;};
 const OPEN="('pending','countered','club_accepted')";
 const reservedOf=async(db,roomId,clubId)=>+(await db.query(`SELECT COALESCE(sum(fee),0) s FROM offers WHERE room_id=$1 AND buyer_club=$2 AND status IN ${OPEN}`,[roomId,clubId])).rows[0].s;
 const reservedMap=async(db,roomId)=>new Map((await db.query(`SELECT buyer_club,sum(fee) s FROM offers WHERE room_id=$1 AND status IN ${OPEN} GROUP BY buyer_club`,[roomId])).rows.map(x=>[x.buyer_club,+x.s]));
 const PRE_NEED=6;const signCount=async(db,room,cid)=>+(await db.query("SELECT count(*) n FROM transfers WHERE room_id=$1 AND season=$2 AND to_club=$3 AND status<>'cancelled' AND kind NOT IN ('dispensa','rescisão','empréstimo')",[room.id,room.season,cid])).rows[0].n;
 const noMoney=(v,f)=>fail(f.available<=0?`Sem dinheiro disponível: orçamento ${X.fmt(f.budget)}, reservado em propostas ${X.fmt(f.reserved)}. O clube não pode gastar nada.`:`Orçamento insuficiente: você tem ${X.fmt(f.available)} disponível (orçamento ${X.fmt(f.budget)} − reservado ${X.fmt(f.reserved)}) e precisa de ${X.fmt(v)}`);
 const finances=async(db,roomId,clubId)=>{const sq=await R.squad(db,roomId,clubId,false);const [rc]=(await db.query('SELECT budget,wage_budget FROM room_clubs WHERE room_id=$1 AND club_id=$2',[roomId,clubId])).rows;
  const reserved=await reservedOf(db,roomId,clubId);return {squad:sq,budget:+rc.budget,reserved,available:+rc.budget-reserved,wage_budget:+rc.wage_budget,wage_bill:sq.reduce((a,p)=>a+(+p.wage||0),0)};};
 const CAP=p=>6*(+p.market_value||0);const capChk=(p,v)=>{if(v>CAP(p))throw fail(`Proposta acima do limite: o máximo permitido é 6x o valor do jogador (${X.fmt(CAP(p))}).`);};
 const addH=(db,id,arr)=>db.query("UPDATE offers SET history=COALESCE(history,'[]'::jsonb)||$2::jsonb WHERE id=$1",[id,JSON.stringify(arr.map(e=>({...e,at:new Date().toISOString()})))]);
 const neg=async(db,roomId,buyer,pid)=>(await db.query('INSERT INTO negotiations(room_id,buyer_club,player_id) VALUES($1,$2,$3) ON CONFLICT(room_id,buyer_club,player_id) DO UPDATE SET room_id=EXCLUDED.room_id RETURNING *',[roomId,buyer,pid])).rows[0];
 // ---------- execução de transferência ----------
 async function execute(db,room,t){const p=await R.player(db,room.id,t.pid);const day=room.market_day;
  const prev=(await db.query('SELECT * FROM room_players WHERE room_id=$1 AND player_id=$2',[room.id,t.pid])).rows[0]||{none:true};
  const contract=t.loan?p.contract_end:room.season+(t.years||3);
  await db.query(`INSERT INTO room_players(room_id,player_id,club_id,wage,contract_end,morale,wants_out,listed,loan_from,release_clause,role) VALUES($1,$2,$3,$4,$5,75,false,false,$6,NULL,$7)
   ON CONFLICT(room_id,player_id) DO UPDATE SET club_id=$3,wage=$4,contract_end=$5,morale=75,wants_out=false,listed=false,loan_from=$6,release_clause=NULL,role=$7`,[room.id,t.pid,t.to,t.wage||p.wage,contract,t.loan?t.from:null,t.role||null]);
  {let lu=null;if(t.loan){const mc=await mainComp(db,room);lu=(mc?.current_round||0)+(+t.loan_rounds||10);}await db.query('UPDATE room_players SET loan_until=$3 WHERE room_id=$1 AND player_id=$2',[room.id,t.pid,lu]);}
  if(t.fee){await db.query('UPDATE room_clubs SET budget=budget-$3 WHERE room_id=$1 AND club_id=$2',[room.id,t.to,t.fee]);if(!isFree(t.from))await db.query('UPDATE room_clubs SET budget=budget+$3 WHERE room_id=$1 AND club_id=$2',[room.id,t.from,t.fee]);}
  await db.query('UPDATE lineups SET starters=NULL WHERE room_id=$1 AND club_id=$2 AND $3=ANY(starters)',[room.id,t.from,t.pid]);
  await db.query("UPDATE offers SET status='expired',reason='O jogador já se transferiu',updated_at=now() WHERE room_id=$1 AND player_id=$2 AND status IN ('pending','countered','club_accepted')",[room.id,t.pid]);
  await db.query('INSERT INTO transfers(room_id,season,day,player_id,from_club,to_club,fee,wage,kind,human,prev) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10)',[room.id,room.season,day,t.pid,t.from,t.to,t.fee||0,t.wage||p.wage,t.kind,JSON.stringify(prev)]);}
 // ---------- reação do jogador a uma oferta grande recusada ----------
 async function upsetPlayer(db,room,o,hum){const p=await R.player(db,room.id,o.player_id);const buyer=C.get(o.buyer_club),seller=C.get(o.seller_club);
  if(!(o.fee>=1.25*p.market_value&&repOf(buyer)>repOf(seller)+3))return;const morale=Math.max(0,p.morale-25),out=morale<50;
  await db.query(`INSERT INTO room_players(room_id,player_id,club_id,morale,wants_out) VALUES($1,$2,$3,$4,$5) ON CONFLICT(room_id,player_id) DO UPDATE SET morale=$4,wants_out=room_players.wants_out OR $5`,[room.id,p.id,p.club_id,morale,out]);
  await note(db,room.id,out?`😠 ${p.name} ficou insatisfeito por não ir para o ${buyer.name} e pediu para sair do ${seller.name}.`:`😕 A moral de ${p.name} caiu após a recusa da proposta do ${buyer.name}.`,hum?.get(o.seller_club)?.user_id);}
 // ---------- tick dos bots (um "dia" de janela) ----------
 const SEC_TARGET={GK:3,DEF:8,MID:8,ATT:5};
 async function tick(db,room,win){const day=room.market_day;const hum=await humans(db,room.id);const rnd=Math.random;const W=await R.world(db,room.id);
  // ofertas vencidas
  const exp=(await db.query("UPDATE offers SET status='expired',reason='Prazo esgotado',updated_at=now() WHERE room_id=$1 AND status IN ('pending','countered','club_accepted') AND deadline_day<$2 RETURNING *",[room.id,day])).rows;
  for(const o of exp)if(!o.buyer_user&&o.seller_user)await upsetPlayer(db,room,o,hum);
  const moved=new Set(),rows=[],touched=new Set(),news=[];
  const summer=win.days===4;const pBuy=summer?0.55:0.25;
  // índice por setor+gênero ordenado por OVR
  const dism=new Set((await db.query('SELECT player_id FROM room_players WHERE room_id=$1 AND club_id=ANY($2::int[])',[room.id,[FREE.M,FREE.F].filter(Boolean)])).rows.map(x=>x.player_id));
  const idx={};for(const p of W.players.values()){const c=W.clubs.get(p.club_id);if(!c||!inGame(p.id)||!(LIB.has(p.club_id)||(isFree(p.club_id)&&dism.has(p.id)))||hum.has(p.club_id)||p.loan_from)continue;const k=c.gender+S.sec(p);(idx[k]=idx[k]||[]).push(p);}
  for(const k in idx)idx[k].sort((a,b)=>a.overall-b.overall);
  const lower=(a,v)=>{let l=0,h=a.length;while(l<h){const m=(l+h)>>1;if(a[m].overall<v)l=m+1;else h=m;}return l;};
  const move=(p,from,to,fee,wage,kind,loan)=>{const fc=W.clubs.get(from),tc=W.clubs.get(to);if(fc){const i=fc.squad.indexOf(p);if(i>=0)fc.squad.splice(i,1);}if(tc)tc.squad.push(p);tc&&tc.squad.sort((a,b)=>b.overall-a.overall);
   if(fee&&tc)tc.budget-=fee;if(fee&&fc&&!isFree(from))fc.budget+=fee;if(fc)fc.wage_bill-=p.wage||0;p.wage=wage;if(tc)tc.wage_bill+=wage;p.club_id=to;moved.add(p.id);touched.add(from);touched.add(to);
   rows.push({pid:p.id,from,to,fee,wage,kind,loan:loan?from:null,contract:loan?p.contract_end:room.season+(p.age>=31?1:p.age>=28?2:p.age<=21?5:4)});};
  const RES=await reservedMap(db,room.id);const av=c=>c.budget-(RES.get(c.id)||0);
  const bots=[...W.clubs.values()].filter(c=>LIB.has(c.id)&&!hum.has(c.id)&&!isFree(c.id)&&c.kind!=='special'&&c.squad.length);
  for(const c of bots.sort(()=>rnd()-.5)){if(win.pre){if((win.signed?.get(c.id)||0)>=PRE_NEED)continue;}else if(rnd()>pBuy)continue;const n=c.squad.length;
   if(n>=X.BOT_MAX_SQ){const out=[...c.squad].filter(p=>!moved.has(p.id)&&!p.loan_from).sort((a,b)=>(a.overall-(a.age>=31?3:0))-(b.overall-(b.age>=31?3:0)))[0];
    if(!win.pre||!out)continue;const mv=Math.round(+out.market_value||0);move(out,c.id,freeOf(c.gender),0,out.wage||0,'dispensa');rows[rows.length-1].fee=mv;c.budget+=mv;news.push(`🗑️ ${c.name} dispensou ${out.name} (+${X.fmt(mv)}) para abrir vaga.`);}
   const cnt={GK:0,DEF:0,MID:0,ATT:0};for(const p of c.squad)cnt[S.sec(p)]++;let need=null,def=0;for(const s in SEC_TARGET){const d=SEC_TARGET[s]-cnt[s];if(d>def){def=d;need=s;}}
   if(!need){if(!win.pre&&(n>=26||rnd()<0.5))continue;const xi=S.autoXI(c.squad);const by={};for(const p of xi)(by[S.sec(p)]=by[S.sec(p)]||[]).push(p.overall);need=Object.entries(by).filter(([s])=>s!=='GK').sort((a,b)=>Math.min(...a[1])-Math.min(...b[1]))[0]?.[0]||'MID';}
   const pool=idx[c.gender+need]||[];const lo=c.xiavg-(win.pre?16:def>1?7:3),hi=c.xiavg+(win.pre?2:5);const a=lower(pool,lo),b=lower(pool,hi+1);if(b<=a)continue;
   let best=null;for(let i=0;i<(win.pre?80:30);i++){const p=pool[a+Math.floor(rnd()*(b-a))];if(!p||moved.has(p.id)||p.club_id===c.id||hum.has(p.club_id))continue;const s=W.clubs.get(p.club_id);if(!s)continue;
    const free=isFree(s.id);if(!free&&s.squad.length<=X.MIN_SQ+1)continue;
    const rank=free?99:s.squad.indexOf(p)+1;const imp=free?{k:'reserva',f:0}:rank<=3?{k:'chave',f:1.55}:rank<=11?{k:'titular',f:1.3}:rank<=18?{k:'rotação',f:1.05}:{k:'reserva',f:.85};
    const dClub=free?0:repOf(c)-repOf(s),dLeague=free?0:la(c)-la(s);
    if(!free&&p.overall>=78&&dClub<=-6&&p.age<30)continue;if(!free&&p.age<29&&dLeague<=-6)continue;
    if(!free&&imp.k==='chave'&&(dClub<3||rnd()<0.75))continue;if(!free&&p.age>=33&&!X.VET_DEST.has(c.country)&&rnd()<0.85)continue;                          // titular-chave só sai para clube maior
    let loan=false,price=free?Math.round(+p.market_value||0):X.askPrice(p,{imp,season:room.season,day:win.day,days:win.days,sellerBudget:s.budget,salt:room.id});
    
    if(av(c)<=0||price>av(c)*(win.pre?0.9:0.7)||price>av(c))continue;const wage=X.wround((p.wage||1000)*(free?1:1.15+(dClub<-3?0.04*(-dClub-3):0)));
    let sc=(p.overall-c.xiavg)+(p.potential-p.overall)*0.15-3*price/Math.max(1,c.budget)+rnd()*2;
    if(X.EXPORT.has(s.country)&&p.age<=23&&la(c)>la(s)+3)sc+=4;if(p.age>=31&&X.VET_DEST.has(c.country))sc+=4;if(dLeague<-3&&p.age<30)sc-=4;if(loan)sc+=1;if(p.wants_out||p.listed)sc+=2;
    if(!best||sc>best.sc)best={p,s,price,wage,loan,sc};}
   if(best&&(best.sc>-3||win.pre)){if(win.pre)win.signed.set(c.id,(win.signed.get(c.id)||0)+1);move(best.p,best.s.id,c.id,best.price,best.wage,best.loan?'empréstimo':isFree(best.s.id)?'livre':'compra',best.loan);}}
  // propostas dos bots para os humanos
  const pend=new Set((await db.query("SELECT player_id FROM offers WHERE room_id=$1 AND status IN ('pending','countered')",[room.id])).rows.map(x=>x.player_id));
  if(!win.pre)for(const [hc,h] of hum){const club=W.clubs.get(hc);if(!club)continue;const listed=club.squad.filter(p=>(p.listed||p.wants_out)&&!p.shielded);
   const tries=(rnd()<(summer?0.6:0.45)?1:0)+(listed.length&&rnd()<0.6?1:0);
   for(let t=0;t<tries;t++){const cand=(club.squad.filter(p=>!pend.has(p.id)&&!p.loan_from)).filter(p=>!p.shielded);if(club.squad.length<=X.MIN_SQ||!cand.length)break;
    const w=cand.map(p=>(p.listed?5:p.wants_out?3:1)*Math.sqrt(p.market_value||1));let x=rnd()*w.reduce((a,b)=>a+b,0),p=cand[0];for(let i=0;i<cand.length;i++){x-=w[i];if(x<=0){p=cand[i];break;}}
    const rank=club.squad.indexOf(p)+1;const impF=rank<=3?1.15:rank<=11?1.07:1;
    const fee=X.mround(p.market_value*X.ageF(p.age)*X.potF(p)*impF*(p.listed?0.8:p.wants_out?0.85:0.88+0.24*rnd()));if(!fee)continue;
    let buyer=null;for(let i=0;i<80;i++){const b=bots[Math.floor(rnd()*bots.length)];if(b.gender!==club.gender||av(b)<fee*1.1||b.squad.length>=X.BOT_MAX_SQ)continue;
     if(b.xiavg<p.overall-4||repOf(b)<repOf(club)-2)continue;if(!buyer||repOf(b)+rnd()*3>repOf(buyer))buyer=b;}
    if(!buyer||fee>av(buyer))continue;const max=Math.min(X.mround(fee*(1.08+0.15*rnd())),av(buyer));RES.set(buyer.id,(RES.get(buyer.id)||0)+fee);pend.add(p.id);
    await db.query("INSERT INTO offers(room_id,player_id,buyer_club,seller_club,seller_user,fee,wage,status,bot_max,deadline_day,created_day,reason) VALUES($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9,$10,$11)",[room.id,p.id,buyer.id,hc,h.user_id,fee,X.wround(p.wage*1.2),max,day+2,day,`Proposta do ${buyer.name}: responda em até 2 dias de mercado.`]);
    await note(db,room.id,`📩 O ${buyer.name} fez uma proposta de ${X.fmt(fee)} por ${p.name} (${club.name}).`,h.user_id);}}
  // grava em lote
  if(rows.length){await db.query(`INSERT INTO room_players(room_id,player_id,club_id,wage,contract_end,loan_from,morale,wants_out,listed) SELECT $1,u.p,u.c,u.w,u.ce,u.l,70,false,false FROM unnest($2::int[],$3::int[],$4::bigint[],$5::int[],$6::int[]) u(p,c,w,ce,l)
    ON CONFLICT(room_id,player_id) DO UPDATE SET club_id=EXCLUDED.club_id,wage=EXCLUDED.wage,contract_end=EXCLUDED.contract_end,loan_from=EXCLUDED.loan_from,morale=70,wants_out=false,listed=false,release_clause=NULL`,
    [room.id,rows.map(r=>r.pid),rows.map(r=>r.to),rows.map(r=>r.wage),rows.map(r=>r.contract),rows.map(r=>r.loan)]);
   await db.query('INSERT INTO transfers(room_id,season,day,player_id,from_club,to_club,fee,wage,kind) SELECT $1,$2,$3,* FROM unnest($4::int[],$5::int[],$6::int[],$7::bigint[],$8::bigint[],$9::text[])',[room.id,room.season,day,rows.map(r=>r.pid),rows.map(r=>r.from),rows.map(r=>r.to),rows.map(r=>r.fee),rows.map(r=>r.wage),rows.map(r=>r.kind)]);
   const tc=[...touched].filter(id=>!isFree(id));await db.query('UPDATE room_clubs rc SET budget=u.b FROM unnest($2::int[],$3::bigint[]) u(c,b) WHERE rc.room_id=$1 AND rc.club_id=u.c',[room.id,tc,tc.map(id=>Math.round(W.clubs.get(id).budget))]);
   const top=rows.filter(r=>r.fee).sort((a,b)=>b.fee-a.fee).slice(0,3);
   await note(db,room.id,`📰 Mercado (dia ${day}): ${rows.length} movimentações entre clubes bots.`+(top.length?' Destaques: '+top.map(r=>`${pname(r.pid)} → ${clubName(r.to)} (${X.fmt(r.fee)})`).join(' · '):''));}
  return {bot_moves:rows.length};}
 // ganchos chamados pelo avanço de rodada (dentro da transação)
 async function before(db,room){const comp=await mainComp(db,room);const win=windowOf(room,comp);if(!win.open)return;
  await db.query('UPDATE rooms SET market_day=market_day+1 WHERE id=$1',[room.id]);room.market_day++;await tick(db,room,win);}
 async function after(db,room){const [r]=(await db.query('SELECT * FROM rooms WHERE id=$1',[room.id])).rows;const win=windowOf(r,await mainComp(db,r));
  if(r.window_was_open&&!win.open){const n=(await db.query("UPDATE offers SET status='expired',reason='Janela fechada',updated_at=now() WHERE room_id=$1 AND status IN ('pending','countered','club_accepted') RETURNING id",[r.id])).rowCount;
   await note(db,r.id,`🔒 Janela de transferências fechada.${n?` ${n} negociação(ões) em aberto expiraram.`:''}`);}
  if(!r.window_was_open&&win.open)await note(db,r.id,`🔓 ${win.name} aberta (fecha ${win.closes||'quando o dono decidir'}).`);
  await db.query('UPDATE rooms SET window_was_open=$2 WHERE id=$1',[r.id,win.open]);}
 async function onStart(db,room){await db.query("UPDATE rooms SET market_day=1,window_was_open=false,mkt_stage='pre',mkt_state='done',auction_open=false WHERE id=$1",[room.id]);}
 // ---------- rotas ----------
 const tx=async f=>{const c=await pool.connect();try{await c.query('BEGIN');const r=await f(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}};
 const lockRoom=async(c,r)=>{const [room]=(await c.query('SELECT r.* FROM rooms r JOIN room_managers m ON m.room_id=r.id AND m.user_id=$2 WHERE r.code=$1 FOR UPDATE OF r',[String(r.params.code).toUpperCase(),r.user.id])).rows;if(!room)throw fail('Você não está nessa sala',403);return room;};
 const needOpen=async(c,room)=>{const w=windowOf(room,await mainComp(c,room));if(!w.open)throw fail('A janela de transferências está fechada');return w;};
 const view=(p,hum)=>({id:p.id,name:p.name,primary_position:p.primary_position,overall:p.overall,potential:p.potential,age:p.age,nationality:p.nationality,market_value:+p.market_value,wage:+p.wage,contract_end:p.contract_end,release_clause:p.release_clause,club_id:p.club_id,club:isFree(p.club_id)?'Livre':clubName(p.club_id),league:L.get(C.get(p.club_id)?.league_id)?.name,manager:hum?.get(p.club_id)?.nick||null,listed:p.listed,shielded:!!p.shielded,wants_out:p.wants_out,morale:p.morale,loan_from:p.loan_from?clubName(p.loan_from):null});

 app.get('/api/rooms/:code/market',auth,wrap(async(r,s)=>{const room=await member(r);const comp=await mainComp(pool,room);const win=windowOf(room,comp);let me=null;
  try{const cid=await myClub(pool,room,r.user.id);const f=await finances(pool,room.id,cid);me={club_id:cid,club:clubName(cid),budget:f.budget,reserved:f.reserved,available:f.available,wage_budget:f.wage_budget,wage_bill:f.wage_bill,squad_size:f.squad.length};}catch(e){}
  const [cnt]=await q("SELECT count(*) FILTER (WHERE seller_club=$2 AND status='pending')::int received,count(*) FILTER (WHERE buyer_club=$2 AND status IN ('countered','club_accepted'))::int to_act FROM offers WHERE room_id=$1",[room.id,me?.club_id||0]);
  const [tc]=await q('SELECT count(*)::int n FROM transfers WHERE room_id=$1 AND season=$2',[room.id,room.season]);
  s.json({window:win,owner:room.owner_id===r.user.id||!!r.user.admin,me,limits:{min_squad:X.MIN_SQ},counts:{...cnt,season_transfers:tc.n},roles:X.ROLES});}));
 app.post('/api/rooms/:code/market/window',auth,wrap(async(r,s)=>{const room=await member(r);if(room.owner_id!==r.user.id&&!r.user.admin)throw fail('Só o dono da sala',403);const m=r.body?.mode;if(!['open','closed','auto'].includes(m))throw fail('Modo inválido');
  await tx(async c=>{await c.query('UPDATE rooms SET window_override=$2 WHERE id=$1',[room.id,m==='auto'?null:m]);await after(c,room);await c.query('UPDATE rooms SET version=version+1 WHERE id=$1',[room.id]);});
  await bump(room.id,`${r.user.nick} ${m==='open'?'abriu':m==='closed'?'fechou':'devolveu ao automático'} a janela de transferências`);s.json({ok:1});}));
 // busca (reaproveita a busca global, com o estado da sala por cima)
 app.get('/api/rooms/:code/market/search',auth,wrap(async(r,s)=>{const room=await member(r);const Q=r.query;const hum=await humans(pool,room.id);let gender=null;try{gender=C.get(await myClub(pool,room,r.user.id)).gender;}catch(e){}
  // Zero Clubistas: só jogadores masculinos que estão HOJE nos 40 clubes da liga (sem livres, sem clubes de fora)
  const ov=await q('SELECT * FROM room_players WHERE room_id=$1',[room.id]);const om=new Map(ov.map(o=>[o.player_id,o]));
  const ids=new Set();for(const cid of require('./libertadores').CLUBS)for(const id of (R.byClub.get(cid)||[]))ids.add(id);for(const o of ov)if((LIB.has(o.club_id)||isFree(o.club_id))&&inGame(o.player_id))ids.add(o.player_id);
  const t=String(Q.q||'').toLowerCase();const key={overall:p=>-p.overall,potential:p=>-(p.potential||0),value:p=>-(+p.market_value||0),age:p=>p.age}[Q.sort]||(p=>-p.overall);
  let list=[...ids].map(id=>R.merge(R.P.get(id),om.get(id))).filter(p=>p&&inGame(p.id)&&(LIB.has(p.club_id)||(isFree(p.club_id)&&om.get(p.id)&&isFree(om.get(p.id).club_id)))&&(Q.free!=='1'||isFree(p.club_id))&&C.get(p.club_id)?.gender!=='F'&&R.P.get(p.id)?.gender!=='Mulher')
   .filter(p=>(!t||p.name.toLowerCase().includes(t)||String(p.nationality||'').toLowerCase().includes(t))&&(!Q.pos||p.primary_position===Q.pos)&&(!Q.minOvr||p.overall>=+Q.minOvr)&&(!Q.maxOvr||p.overall<=+Q.maxOvr)&&(!Q.minAge||p.age>=+Q.minAge)&&(!Q.maxAge||p.age<=+Q.maxAge)&&(!Q.minPot||(p.potential??p.overall)>=+Q.minPot)&&(!Q.maxPot||(p.potential??p.overall)<=+Q.maxPot)&&(!Q.maxValue||(+p.market_value||0)<=+Q.maxValue)&&(!Q.club||(Q.club==='free'?isFree(p.club_id):p.club_id===+Q.club)))
   .sort((a,b)=>key(a)-key(b)).slice(0,Q.club?60:150);
  if(Q.listed==='1')list=list.filter(p=>p.listed||p.wants_out);
  s.json(list.map(p=>view(p,hum)));}));
 app.get('/api/rooms/:code/market/player/:pid',auth,wrap(async(r,s)=>{const room=await member(r);const p=await R.player(pool,room.id,+r.params.pid);if(!p||!inGame(p.id))throw fail('Jogador não encontrado',404);const hum=await humans(pool,room.id);
  let ctx={};try{const cid=await myClub(pool,room,r.user.id);const mine=await R.squad(pool,room.id,cid,false);const n=(await q('SELECT * FROM negotiations WHERE room_id=$1 AND buyer_club=$2 AND player_id=$3',[room.id,cid,p.id]))[0];
   ctx={my_club:cid,own:p.club_id===cid,expected_role:p.club_id===cid?null:X.expectedRole(p,mine),blocked:n&&n.blocked_until>=room.market_day,club_fails:n?.club_fails||0,player_fails:n?.player_fails||0,watched:!!(await q('SELECT 1 FROM watchlist WHERE room_id=$1 AND user_id=$2 AND player_id=$3',[room.id,r.user.id,p.id])).length};}catch(e){}
  let imp=null;if(!isFree(p.club_id)){const sq=await R.squad(pool,room.id,p.club_id,false);imp=X.importance(p,sq).k;}
  const hist=await q('SELECT * FROM transfers WHERE room_id=$1 AND player_id=$2 ORDER BY id DESC',[room.id,p.id]);
  s.json({...view(p,hum),positions:p.positions,stats:p.stats,importance:imp,...ctx,history:hist.map(t=>({...t,...TRX(t),from:clubName(t.from_club),to:clubName(t.to_club)}))});}));
 // nova proposta
 app.post('/api/rooms/:code/market/offer',auth,wrap(async(r,s)=>s.json(await tx(async c=>{const room=await lockRoom(c,r);const win=await needOpen(c,room);const buyer=await myClub(c,room,r.user.id);const hum=await humans(c,room.id);
  const pid=+r.body?.player_id,fee=Math.max(0,Math.round(+r.body?.fee||0)),loan=!!r.body?.loan,swap=r.body?.swap_player_id?+r.body.swap_player_id:null;const p=await R.player(c,room.id,pid);if(!p)throw fail('Jogador não encontrado');
  if(!inGame(p.id)||!(LIB.has(p.club_id)||isFree(p.club_id))||!LIB.has(buyer))throw fail('Por enquanto só há transferências entre os 40 clubes da liga');if(loan)throw fail('Empréstimos estão desativados');const lr=loan?Math.round(+r.body?.loan_rounds||0):null;if(loan&&!(lr>=1&&lr<=39))throw fail('Informe por quantas rodadas (1 a 39) é o empréstimo');
  if(p.club_id===buyer)throw fail('Esse jogador já é seu');if(!loan&&!swap&&!isFree(p.club_id)&&!(fee>0))throw fail('Informe o valor da proposta (maior que zero).');if(p.shielded)throw fail('Jogador blindado: o clube não aceita propostas por ele');capChk(p,fee);const bc=C.get(buyer),sc=C.get(p.club_id);if(sc.gender!==bc.gender)throw fail('Jogador de outra modalidade (masculino/feminino)');
  const f=await finances(c,room.id,buyer);if(fee>f.available||f.available<=0)throw noMoney(fee,f);
  if(swap&&!f.squad.some(x=>x.id===swap))throw fail('Jogador de troca não é do seu elenco');if(p.loan_from)throw fail('Jogador emprestado não pode ser negociado');
  const n=await neg(c,room.id,buyer,pid);if(n.blocked_until>=room.market_day)throw fail('As negociações estão esfriadas: tente de novo em alguns dias de mercado.');
  const dup=(await c.query("SELECT 1 FROM offers WHERE room_id=$1 AND buyer_club=$2 AND player_id=$3 AND status IN ('pending','countered','club_accepted')",[room.id,buyer,pid])).rows.length;if(dup)throw fail('Você já tem uma negociação em andamento por esse jogador');
  const base=[room.id,pid,buyer,p.club_id,r.user.id,hum.get(p.club_id)?.user_id||null,fee,swap,loan,room.market_day+2,room.market_day,lr];
  const ins=(st,extra={})=>c.query('INSERT INTO offers(room_id,player_id,buyer_club,seller_club,buyer_user,seller_user,fee,swap_player_id,loan,deadline_day,created_day,loan_rounds,status,counter_fee,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *',[...base,st,extra.counter||null,extra.msg||null]).then(async x=>{const o=x.rows[0];await addH(c,o.id,[{by:'comprador',club:bc.name,act:'proposta',fee}].concat(extra.counter?[{by:'vendedor',club:sc.name,act:'contraproposta',fee:extra.counter}]:st==='club_accepted'&&!isFree(p.club_id)?[{by:'vendedor',club:sc.name,act:'aceitou',fee}]:st==='rejected'?[{by:'vendedor',club:sc.name,act:'recusou'}]:[]));return o;});
  if(isFree(p.club_id)){if(swap)throw fail('Jogador livre: não há troca, você paga o valor de mercado dele');const price=Math.round(+p.market_value||0);if(price>f.available||f.available<=0)throw noMoney(price,f);base[6]=price;const o=await ins('club_accepted',{msg:`Jogador livre: custa ${X.fmt(price)} (valor de mercado). Negocie o contrato direto com ele.`});return {offer:o,decision:'accept',message:o.reason};}
  if(hum.has(p.club_id)){const o=await ins('pending',{msg:'Aguardando resposta do técnico.'});await note(c,room.id,`📩 ${r.user.nick} (${bc.name}) ofereceu ${X.fmt(fee)}${swap?' + '+pname(swap):''}${loan?' (empréstimo)':''} por ${p.name}.`,hum.get(p.club_id).user_id);await c.query('UPDATE rooms SET version=version+1 WHERE id=$1',[room.id]);return {offer:o,decision:'pending',message:'Proposta enviada ao técnico do '+sc.name+'.'};}
  // clube bot decide
  const sq=await R.squad(c,room.id,p.club_id,false);const imp=X.importance(p,sq);let swapValue=0;if(swap){const sp=await R.player(c,room.id,swap);swapValue=Math.round(sp.market_value*X.ageF(sp.age)*0.6);}
  const [rc]=(await c.query('SELECT budget FROM room_clubs WHERE room_id=$1 AND club_id=$2',[room.id,p.club_id])).rows;
  const d=X.clubDecision(p,{fee,swapValue,loan},{imp,season:room.season,day:win.day,days:win.days,fails:n.club_fails,rival:sc.league_id===bc.league_id,sellerBudget:+rc.budget,clause:p.release_clause,sellerSquad:sq.length,biggerSeller:repOf(sc)>repOf(bc)+5,salt:room.id});
  if(d.d==='accept'){const o=await ins('club_accepted',{msg:d.msg});if(d.forced)await note(c,room.id,`💥 ${bc.name} pagou a cláusula de rescisão de ${p.name} (${X.fmt(p.release_clause)}).`);return {offer:o,decision:'accept',forced:!!d.forced,message:d.msg+' Agora negocie o contrato com o jogador.'};}
  if(d.d==='counter'&&d.counter)d.counter=Math.min(d.counter,CAP(p));const fails=n.club_fails+1;const block=fails>=4;await c.query('UPDATE negotiations SET club_fails=$4,blocked_until=$5 WHERE room_id=$1 AND buyer_club=$2 AND player_id=$3',[room.id,buyer,pid,block?0:fails,block?room.market_day+3:n.blocked_until]);
  const msg=d.msg+(block?' Depois de tantas tentativas, o clube encerrou as conversas por alguns dias.':'');
  const o=await ins(d.d==='counter'&&!block?'countered':'rejected',{counter:d.counter,msg});return {offer:o,decision:block?'reject':d.d,counter:d.counter,message:msg};}))));
 // responder (vendedor humano a proposta pendente; comprador a contraproposta)
 app.post('/api/rooms/:code/market/offer/:id/respond',auth,wrap(async(r,s)=>s.json(await tx(async c=>{const room=await lockRoom(c,r);const win=await needOpen(c,room);const cid=await myClub(c,room,r.user.id);const hum=await humans(c,room.id);
  if(!(+r.params.id>0))throw fail('Proposta não encontrada',404);const [o]=(await c.query('SELECT * FROM offers WHERE id=$1 AND room_id=$2 FOR UPDATE',[+r.params.id,room.id])).rows;if(!o)throw fail('Proposta não encontrada',404);const act=r.body?.action,nf=Math.round(+r.body?.fee||0);if(act==='counter'&&!(nf>0))throw fail('Informe o valor da contraproposta (maior que zero).');const p=await R.player(c,room.id,o.player_id);
  const upd=(st,extra={})=>c.query("UPDATE offers SET status=$2,fee=COALESCE($3,fee),counter_fee=$4,reason=$5,counters=counters+$6,updated_at=now(),history=COALESCE(history,'[]'::jsonb)||$7::jsonb WHERE id=$1 RETURNING *",[o.id,st,extra.fee??null,extra.counter??null,extra.msg||null,extra.inc||0,JSON.stringify((extra.h||[]).map(e=>({...e,at:new Date().toISOString()})))]).then(x=>x.rows[0]);
  const SN=clubName(o.seller_club),BN=clubName(o.buyer_club);if(r.body?.action==='counter'){if(!(nf>0))throw fail('Informe o valor da contraproposta');capChk(p,nf);}
  const bump2=()=>c.query('UPDATE rooms SET version=version+1 WHERE id=$1',[room.id]);
  if(o.seller_club===cid&&o.status==='pending'){ // eu sou o vendedor
   const f=await finances(c,room.id,cid);
   if(act==='accept'){if(f.squad.length-1+(o.swap_player_id?1:0)<X.MIN_SQ)throw fail(`Seu elenco ficaria abaixo do mínimo (${X.MIN_SQ})`);
    if(!o.buyer_user){const fb0=await finances(c,room.id,o.buyer_club);if(fb0.available<0)return {offer:await upd('expired',{msg:'O clube comprador não tem mais dinheiro.'}),message:'O clube comprador não tem mais orçamento.'};
     await execute(c,room,{pid:o.player_id,from:cid,to:o.buyer_club,fee:+o.fee,wage:+o.wage,years:p.age>=30?2:4,kind:'venda'});await note(c,room.id,`✅ ${p.name} vendido pelo ${clubName(cid)} ao ${clubName(o.buyer_club)} por ${X.fmt(+o.fee)}.`);await bump2();return {offer:await upd('done',{msg:'Venda concluída.',h:[{by:'vendedor',club:SN,act:'aceitou',fee:+o.fee}]}),message:'Venda concluída!'};}
    const u=await upd('club_accepted',{msg:'Clube aceitou. Comprador negocia o contrato com o jogador.',h:[{by:'vendedor',club:SN,act:'aceitou',fee:+o.fee}]});await note(c,room.id,`🤝 ${clubName(cid)} aceitou a proposta do ${clubName(o.buyer_club)} por ${p.name}.`,o.buyer_user);await bump2();return {offer:u,message:'Proposta aceita. Agora o comprador negocia o salário com o jogador.'};}
   if(act==='reject'){const u=await upd('rejected',{msg:'Recusada pelo técnico.',h:[{by:'vendedor',club:SN,act:'recusou'}]});if(!o.buyer_user)await upsetPlayer(c,room,o,hum);else await note(c,room.id,`❌ ${clubName(cid)} recusou a proposta por ${p.name}.`,o.buyer_user);await bump2();return {offer:u,message:'Proposta recusada.'};}
   if(act==='counter'){if(nf<=o.fee)throw fail('A contraproposta precisa ser maior que a oferta');
    if(o.buyer_user){const u=await upd('countered',{counter:nf,msg:`Contraproposta: ${X.fmt(nf)}`,h:[{by:'vendedor',club:SN,act:'contraproposta',fee:nf}]});await note(c,room.id,`↩️ ${clubName(cid)} pediu ${X.fmt(nf)} por ${p.name}.`,o.buyer_user);await bump2();return {offer:u,message:'Contraproposta enviada.'};}
    const max=+o.bot_max;if(nf<=max){await execute(c,room,{pid:o.player_id,from:cid,to:o.buyer_club,fee:nf,wage:+o.wage,years:p.age>=30?2:4,kind:'venda'});await note(c,room.id,`✅ ${p.name} vendido ao ${clubName(o.buyer_club)} por ${X.fmt(nf)} após contraproposta.`);await bump2();return {offer:await upd('done',{fee:nf,msg:'O clube aceitou sua contraproposta. Venda concluída.',h:[{by:'vendedor',club:SN,act:'contraproposta',fee:nf},{by:'comprador',club:BN,act:'aceitou',fee:nf}]}),message:`O ${clubName(o.buyer_club)} aceitou ${X.fmt(nf)}. Venda concluída!`};}
    if(o.counters<1&&nf<=max*1.25&&max<=(await finances(c,room.id,o.buyer_club)).available+ +o.fee){const u=await upd('pending',{fee:max,inc:1,h:[{by:'vendedor',club:SN,act:'contraproposta',fee:nf},{by:'comprador',club:BN,act:'nova proposta',fee:max}],msg:`O ${clubName(o.buyer_club)} subiu a oferta para ${X.fmt(max)} — é a proposta final.`});return {offer:u,message:u.reason};}
    const u=await upd('rejected',{h:[{by:'vendedor',club:SN,act:'contraproposta',fee:nf},{by:'comprador',club:BN,act:'desistiu'}],msg:`O ${clubName(o.buyer_club)} achou o pedido exagerado e desistiu da negociação.`});return {offer:u,message:u.reason};}
   throw fail('Ação inválida');}
  if(o.buyer_club===cid&&o.status==='countered'){ // eu sou o comprador respondendo contraproposta
   if(act==='accept'){const f=await finances(c,room.id,cid);if(+o.counter_fee>f.available+ +o.fee)throw noMoney(+o.counter_fee,{...f,available:f.available+ +o.fee});const u=await upd('club_accepted',{fee:+o.counter_fee,msg:'Valor acertado com o clube. Agora negocie o contrato com o jogador.',h:[{by:'comprador',club:BN,act:'aceitou',fee:+o.counter_fee}]});if(o.seller_user){await note(c,room.id,`🤝 ${clubName(cid)} aceitou pagar ${X.fmt(+o.counter_fee)} por ${p.name}.`,o.seller_user);await bump2();}return {offer:u,message:u.reason};}
   if(act==='reject'){const u=await upd('rejected',{msg:'Negociação encerrada pelo comprador.',h:[{by:'comprador',club:BN,act:'recusou'}]});if(o.seller_user){await note(c,room.id,`❌ ${BN} recusou sua contraproposta por ${p.name}.`,o.seller_user);await bump2();}return {offer:u,message:'Negociação encerrada.'};}
   if(act==='counter'){const fb=await finances(c,room.id,cid);if(nf>fb.available+ +o.fee)throw noMoney(nf,{...fb,available:fb.available+ +o.fee});if(nf>=+o.counter_fee)throw fail('Sua contraproposta é igual ou maior que o pedido: use Aceitar');if(nf<=+o.fee)throw fail('A nova proposta precisa ser maior que a sua oferta anterior');
    if(o.seller_user){const u=await upd('pending',{fee:nf,h:[{by:'comprador',club:BN,act:'contraproposta',fee:nf}],msg:`Nova oferta: ${X.fmt(nf)}`});await note(c,room.id,`📩 ${BN} fez contraproposta de ${X.fmt(nf)} por ${p.name}.`,o.seller_user);await bump2();return {offer:u,message:'Contraproposta enviada.'};}
    // clube IA reavalia com a mesma lógica de recusas
    const sc=C.get(o.seller_club),bc=C.get(cid);const sq=await R.squad(c,room.id,o.seller_club,false);const imp=X.importance(p,sq);let swapValue=0;if(o.swap_player_id){const sp=await R.player(c,room.id,o.swap_player_id);swapValue=Math.round(sp.market_value*X.ageF(sp.age)*0.6);}
    const [rc]=(await c.query('SELECT budget FROM room_clubs WHERE room_id=$1 AND club_id=$2',[room.id,o.seller_club])).rows;const n=await neg(c,room.id,cid,o.player_id);
    const d=X.clubDecision(p,{fee:nf,swapValue,loan:false},{imp,season:room.season,day:win.day,days:win.days,fails:n.club_fails,rival:sc.league_id===bc.league_id,sellerBudget:+rc.budget,clause:p.release_clause,sellerSquad:sq.length,biggerSeller:repOf(sc)>repOf(bc)+5,salt:room.id});
    const H=[{by:'comprador',club:BN,act:'contraproposta',fee:nf}];
    if(d.d==='accept'){const u=await upd('club_accepted',{fee:nf,counter:null,h:H.concat([{by:'vendedor',club:SN,act:'aceitou',fee:nf}]),msg:`O ${SN} aceitou ${X.fmt(nf)}. Agora negocie o contrato com o jogador.`});return {offer:u,decision:'accept',message:u.reason};}
    if(d.d==='counter'&&o.counters<3){let nc=Math.min(+o.counter_fee,Math.round(Math.max(d.counter||0,(nf+ +o.counter_fee)/2)/1e5)*1e5,CAP(p));
     if(nc<=nf){const u=await upd('club_accepted',{fee:nf,counter:null,h:H.concat([{by:'vendedor',club:SN,act:'aceitou',fee:nf}]),msg:`O ${SN} aceitou ${X.fmt(nf)}. Agora negocie o contrato com o jogador.`});return {offer:u,decision:'accept',message:u.reason};}
     const last=o.counters>=2;const u=await upd('countered',{fee:nf,counter:nc,inc:1,h:H.concat([{by:'vendedor',club:SN,act:'contraproposta',fee:nc}]),msg:`O ${SN} pede ${X.fmt(nc)}${last?' — é a última palavra do clube.':'.'}`});return {offer:u,decision:'counter',counter:nc,message:u.reason};}
    const u=await upd('rejected',{fee:nf,h:H.concat([{by:'vendedor',club:SN,act:'encerrou'}]),msg:`O ${SN} encerrou a negociação. ${d.d==='reject'?d.msg:''}`.trim()});return {offer:u,decision:'reject',message:u.reason};}
   throw fail('Ação inválida');}
  throw fail('Você não pode responder essa proposta agora',403);}))));
 // contrato com o jogador
 app.post('/api/rooms/:code/market/offer/:id/contract',auth,wrap(async(r,s)=>s.json(await tx(async c=>{const room=await lockRoom(c,r);await needOpen(c,room);const cid=await myClub(c,room,r.user.id);
  const [o]=(await c.query("SELECT * FROM offers WHERE id=$1 AND room_id=$2 AND buyer_club=$3 AND status='club_accepted' FOR UPDATE",[+r.params.id,room.id,cid])).rows;if(!o)throw fail('Negociação não está na fase de contrato',404);
  const p=await R.player(c,room.id,o.player_id);if(p.club_id!==o.seller_club)throw fail('O jogador não está mais nesse clube');const wage=Math.round(+r.body?.wage||0),years=Math.min(5,Math.max(1,parseInt(r.body?.years)||3)),role=r.body?.role;
  if(role&&!X.ROLES.includes(role))throw fail('Papel inválido');const f=await finances(c,room.id,cid);const swapW=o.swap_player_id?(f.squad.find(x=>x.id===o.swap_player_id)?.wage||0):0;
  if(+o.fee>f.available+ +o.fee)throw noMoney(+o.fee,{...f,available:f.available+ +o.fee});
  if(!isFree(o.seller_club)){const ss=await R.squad(c,room.id,o.seller_club,false);if(ss.length-1+(o.swap_player_id?1:0)<X.MIN_SQ)throw fail('O clube vendedor ficaria abaixo do mínimo de elenco');}
  const n=await neg(c,room.id,cid,p.id);const from=isFree(o.seller_club)?null:C.get(o.seller_club);const fromImp=from?X.importance(p,await R.squad(c,room.id,o.seller_club,false)):null;
  const expected=X.expectedRole(p,f.squad);let d;
  if(o.loan)d=(role||expected)==='reserva'?{d:'reject',msg:'O jogador só aceita o empréstimo se for para jogar.'}:{d:'accept',msg:'O jogador aceitou o empréstimo.'};
  else d=X.playerDecision(p,{wage,role,years},{from,to:C.get(cid),L,fromImp,expected,fails:n.player_fails,salt:room.id,isFree:!from});
  if(d.d==='invalid')throw fail(d.msg);
  if(!d.hard&&d.d!=='accept'&&d.ask&&o.counter_wage&&wage>=+o.counter_wage)d={d:'accept',msg:'O jogador aceitou os termos pessoais.'};
  if(d.ask&&o.counter_wage)d.ask=Math.min(d.ask,+o.counter_wage);
  if(d.d==='accept'){const kind=o.loan?'empréstimo':from?(o.seller_user?'compra (humano)':'compra'):'livre';
   await execute(c,room,{pid:p.id,from:o.seller_club,to:cid,fee:+o.fee,wage:o.loan?p.wage:wage,years,loan:o.loan,loan_rounds:o.loan_rounds,kind,role:role||expected});
   if(o.swap_player_id){const sp=await R.player(c,room.id,o.swap_player_id);await execute(c,room,{pid:sp.id,from:cid,to:o.seller_club,fee:0,wage:sp.wage,years:3,kind:'troca'});}
   await c.query("UPDATE offers SET status='done',wage=$2,role=$3,years=$4,reason=$5,updated_at=now() WHERE id=$1",[o.id,wage,role||expected,years,d.msg]);
   await note(c,room.id,`✍️ ${p.name} assinou com o ${clubName(cid)}${+o.fee?` por ${X.fmt(+o.fee)}${from?'':' (agente livre)'}`:from?'':' (livre)'}${o.loan?' (empréstimo)':''}${o.swap_player_id?' + '+pname(o.swap_player_id)+' na troca':''}.`);await c.query('UPDATE rooms SET version=version+1 WHERE id=$1',[room.id]);
   return {decision:'accept',message:d.msg+' Transferência concluída!'};}
  const fails=n.player_fails+1;const end=d.hard||fails>=3;
  await c.query('UPDATE negotiations SET player_fails=$4,blocked_until=$5 WHERE room_id=$1 AND buyer_club=$2 AND player_id=$3',[room.id,cid,p.id,end?0:fails,end?room.market_day+3:n.blocked_until]);
  const msg=d.msg+(end&&!d.hard?' Após tantas tentativas, o jogador encerrou as conversas.':'');
  await c.query('UPDATE offers SET status=$2,counter_wage=$3,reason=$4,updated_at=now() WHERE id=$1',[o.id,end?'player_rejected':'club_accepted',d.ask||null,msg]);
  if(end&&o.seller_user)await note(c,room.id,`🚫 ${p.name} recusou a transferência para o ${clubName(cid)}: ${d.msg}`,o.seller_user);
  return {decision:end?'reject':d.d,ask:d.ask,message:msg,ended:end,attempts_left:end?0:3-fails};}))));
 app.post('/api/rooms/:code/market/offer/:id/withdraw',auth,wrap(async(r,s)=>{const room=await member(r);const cid=await myClub(pool,room,r.user.id);
  const [o]=await q("UPDATE offers SET status='withdrawn',reason='Retirada pelo comprador',updated_at=now() WHERE id=$1 AND room_id=$2 AND buyer_club=$3 AND status IN ('pending','countered','club_accepted') RETURNING *",[+r.params.id,room.id,cid]);if(!o)throw fail('Nada para retirar');s.json({ok:1});}));
 app.get('/api/rooms/:code/market/offers',auth,wrap(async(r,s)=>{const room=await member(r);const cid=await myClub(pool,room,r.user.id);
  const rows=await q('SELECT * FROM offers WHERE room_id=$1 AND (buyer_club=$2 OR seller_club=$2) ORDER BY updated_at DESC LIMIT 80',[room.id,cid]);
  const f=o=>({...o,fee:+o.fee,counter_fee:o.counter_fee&&+o.counter_fee,wage:o.wage&&+o.wage,counter_wage:o.counter_wage&&+o.counter_wage,bot_max:undefined,player:pname(o.player_id),player_ovr:R.P.get(o.player_id)?.overall,buyer:clubName(o.buyer_club),seller:isFree(o.seller_club)?'Livre':clubName(o.seller_club),swap:o.swap_player_id&&pname(o.swap_player_id),days_left:o.deadline_day-room.market_day,max_fee:6*(+R.P.get(o.player_id)?.market_value||0),history:o.history||[]});
  s.json({day:room.market_day,sent:rows.filter(o=>o.buyer_club===cid).map(f),received:rows.filter(o=>o.seller_club===cid).map(f)});}));
 // observados
 app.get('/api/rooms/:code/market/watch',auth,wrap(async(r,s)=>{const room=await member(r);const hum=await humans(pool,room.id);const ids=(await q('SELECT player_id FROM watchlist WHERE room_id=$1 AND user_id=$2',[room.id,r.user.id])).map(x=>x.player_id);
  const out=[];for(const id of ids)out.push(view(await R.player(pool,room.id,id),hum));s.json(out);}));
 app.post('/api/rooms/:code/market/watch/:pid',auth,wrap(async(r,s)=>{const room=await member(r);await q('INSERT INTO watchlist VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[room.id,r.user.id,+r.params.pid]);s.json({ok:1});}));
 app.delete('/api/rooms/:code/market/watch/:pid',auth,wrap(async(r,s)=>{const room=await member(r);await q('DELETE FROM watchlist WHERE room_id=$1 AND user_id=$2 AND player_id=$3',[room.id,r.user.id,+r.params.pid]);s.json({ok:1});}));
 // colocar à venda / liberar
 app.post('/api/rooms/:code/market/list/:pid',auth,wrap(async(r,s)=>{const room=await member(r);const cid=await myClub(pool,room,r.user.id);const p=await R.player(pool,room.id,+r.params.pid);if(p?.club_id!==cid)throw fail('Jogador não é seu');
  const want=r.body?.on!=null?!!r.body.on:!p.listed;
  await q('INSERT INTO room_players(room_id,player_id,club_id,listed,shielded) VALUES($1,$2,$3,$4,false) ON CONFLICT(room_id,player_id) DO UPDATE SET listed=$4,shielded=CASE WHEN $4 THEN false ELSE room_players.shielded END',[room.id,p.id,cid,want]);s.json({ok:1,listed:want});}));
 // Blindagem: até 3 por clube; blindado não recebe proposta. Ao blindar, propostas abertas por ele são recusadas (o dinheiro reservado volta ao comprador).
 app.post('/api/rooms/:code/market/shield/:pid',auth,wrap(async(r,s)=>s.json(await tx(async c=>{const room=await lockRoom(c,r);const cid=await myClub(c,room,r.user.id);const p=await R.player(c,room.id,+r.params.pid);if(p?.club_id!==cid)throw fail('Jogador não é seu');
  const want=r.body?.on!=null?!!r.body.on:!p.shielded;
  if(want){const n=+(await c.query('SELECT count(*) n FROM room_players WHERE room_id=$1 AND club_id=$2 AND shielded AND player_id<>$3',[room.id,cid,p.id])).rows[0].n;if(n>=3)throw fail('Limite de 3 jogadores blindados. Desblinde outro antes.');}
  await c.query('INSERT INTO room_players(room_id,player_id,club_id,shielded,listed) VALUES($1,$2,$3,$4,false) ON CONFLICT(room_id,player_id) DO UPDATE SET shielded=$4,shielded_at=CASE WHEN $4 THEN coalesce(room_players.shielded_at,now()) ELSE NULL END,listed=CASE WHEN $4 THEN false ELSE room_players.listed END',[room.id,p.id,cid,want]);
  let cancelled=0;if(want){const o=await c.query(`UPDATE offers SET status='rejected' WHERE room_id=$1 AND player_id=$2 AND seller_club=$3 AND status IN ${OPEN} RETURNING id`,[room.id,p.id,cid]);cancelled=o.rowCount;
   if(cancelled)await note(c,room.id,`🛡️ ${p.name} foi blindado pelo ${clubName(cid)}: ${cancelled} proposta(s) recusada(s) e o dinheiro reservado voltou aos compradores.`);}
  return {ok:1,shielded:want,cancelled};}))));
 app.post('/api/rooms/:code/market/release/:pid',auth,wrap(async(r,s)=>s.json(await tx(async c=>{const room=await lockRoom(c,r);if(room.status!=='season')throw fail('Só durante a temporada');const cid=await myClub(c,room,r.user.id);const p=await R.player(c,room.id,+r.params.pid);if(p?.club_id!==cid)throw fail('Jogador não é seu');
  if(p.loan_from)throw fail('Jogador emprestado não pode ser liberado');const f=await finances(c,room.id,cid);if(f.squad.length-1<X.MIN_SQ)throw fail(`Elenco mínimo de ${X.MIN_SQ} jogadores`);
  const years=Math.max(0,(p.contract_end||room.season)-room.season);const comp=Math.round(p.wage*52*Math.min(years,2)*0.5);if(comp>0&&comp>f.available)throw noMoney(comp,f);
  await execute(c,room,{pid:p.id,from:cid,to:freeOf(C.get(cid).gender),fee:0,wage:p.wage,years:0,kind:'rescisão'});await c.query('UPDATE room_clubs SET budget=budget-$3 WHERE room_id=$1 AND club_id=$2',[room.id,cid,comp]);
  await note(c,room.id,`📤 ${clubName(cid)} rescindiu com ${p.name} (multa de ${X.fmt(comp)}). Ele agora é agente livre.`);await c.query('UPDATE rooms SET version=version+1 WHERE id=$1',[room.id]);return {ok:1,cost:comp,message:`Contrato rescindido. Custo: ${X.fmt(comp)} (50% dos salários restantes, até 2 anos).`};}))));
 // dispensa (Zero Clubistas): clube recebe o valor de mercado e o jogador vira agente livre no Mercado
 app.post('/api/rooms/:code/market/dismiss/:pid',auth,wrap(async(r,s)=>s.json(await tx(async c=>{const room=await lockRoom(c,r);await needOpen(c,room);const cid=await myClub(c,room,r.user.id);const p=await R.player(c,room.id,+r.params.pid);if(!p||p.club_id!==cid)throw fail('Jogador não é seu');
  if(p.loan_from)throw fail('Jogador emprestado não pode ser dispensado');const f=await finances(c,room.id,cid);if(f.squad.length-1<X.MIN_SQ)throw fail(`Não dá para dispensar: o elenco ficaria abaixo do mínimo de ${X.MIN_SQ} jogadores`);
  const val=Math.round(+p.market_value||0);await execute(c,room,{pid:p.id,from:cid,to:freeOf(C.get(cid).gender),fee:0,wage:p.wage,years:0,kind:'dispensa'});
  await c.query("UPDATE transfers SET fee=$3 WHERE id=(SELECT max(id) FROM transfers WHERE room_id=$1 AND player_id=$2)",[room.id,p.id,val]);
  await c.query('UPDATE room_clubs SET budget=budget+$3 WHERE room_id=$1 AND club_id=$2',[room.id,cid,val]);
  await note(c,room.id,`📤 ${clubName(cid)} dispensou ${p.name} e recebeu ${X.fmt(val)}. Ele agora é agente livre no Mercado.`);await c.query('UPDATE rooms SET version=version+1 WHERE id=$1',[room.id]);
  return {ok:1,value:val,message:`${p.name} dispensado. Você recebeu ${X.fmt(val)} e ele está livre no Mercado.`};}))));
 // notícias / histórico
 app.get('/api/rooms/:code/market/news',auth,wrap(async(r,s)=>{const room=await member(r);const hum=await humans(pool,room.id);const lim=Math.min(300,+r.query.limit||120);
  const rows=await q(`SELECT * FROM transfers WHERE room_id=$1 ${r.query.human==='1'?'AND human':''} ORDER BY ${r.query.sort==='fee'?'fee DESC,':''}id DESC LIMIT ${lim}`,[room.id]);
  const ev=await q("SELECT text,created_at FROM room_events WHERE room_id=$1 AND (user_id IS NULL OR user_id=$2) AND (text LIKE '📰%' OR text LIKE '📩%' OR text LIKE '✅%' OR text LIKE '✍️%' OR text LIKE '💥%' OR text LIKE '😠%' OR text LIKE '😕%' OR text LIKE '🔒%' OR text LIKE '🔓%' OR text LIKE '📤%' OR text LIKE '🤝%' OR text LIKE '❌%' OR text LIKE '↩️%' OR text LIKE '🚫%') ORDER BY id DESC LIMIT 40",[room.id,r.user.id]);
  s.json({events:ev,transfers:rows.map(t=>({...t,...TRX(t),fee:+t.fee,wage:+t.wage,player:pname(t.player_id),ovr:R.P.get(t.player_id)?.overall,age:R.P.get(t.player_id)?.age,pos:R.P.get(t.player_id)?.primary_position,from:isFree(t.from_club)?'Livre':clubName(t.from_club),to:isFree(t.to_club)?'Livre':clubName(t.to_club),human:hum.has(t.from_club)||hum.has(t.to_club)}))});}));
 // ---------- pré-temporada: meta de 6 contratações ----------
 async function preStatus(db,room){const out=[];const CL=require('./libertadores').CLUBS;const NS=await Promise.all(CL.map(cid=>signCount(db,room,cid)));for(const [i,cid] of CL.entries()){const n=NS[i];const miss=Math.max(0,PRE_NEED-n);out.push({club_id:cid,club:clubName(cid),n,need:PRE_NEED,miss,pts:3*miss,money:50e6*miss});}return out;}
 async function preseasonAI(db,room){const signed=new Map((await preStatus(db,room)).map(x=>[x.club_id,x.n]));const before=new Map(signed);
  for(let d=0;d<12;d++){const pend=require('./libertadores').CLUBS.filter(id=>(signed.get(id)||0)<PRE_NEED);if(!pend.length)break;await db.query('UPDATE rooms SET market_day=market_day+1 WHERE id=$1',[room.id]);room.market_day++;await tick(db,room,{open:true,pre:true,day:0,days:4,signed});}
  let n=0;for(const [k,v] of signed)n+=v-(before.get(k)||0);return n;}
 async function applyPenalties(db,room){const st=await preStatus(db,room);const bad=st.filter(x=>x.miss);
  for(const x of bad)await db.query('UPDATE room_clubs SET penalty_pts=penalty_pts+$3,budget=budget-$4 WHERE room_id=$1 AND club_id=$2',[room.id,x.club_id,x.pts,x.money]);
  await note(db,room.id,bad.length?`⚖️ Punição da pré-temporada (meta de ${PRE_NEED} contratações): `+bad.map(x=>`${x.club} ${x.n}/${PRE_NEED} → -${x.pts} pts e -${X.fmt(x.money)}`).join(' · '):`✅ Todos os clubes cumpriram a meta de ${PRE_NEED} contratações da pré-temporada.`);return bad;}
 app.get('/api/rooms/:code/preseason',auth,wrap(async(r,s)=>{const room=await member(r);const st=await preStatus(pool,room);let me=null;try{const cid=await myClub(pool,room,r.user.id);me=st.find(x=>x.club_id===cid)||null;}catch(e){}s.json({status:room.status,need:PRE_NEED,me,clubs:st,below:st.filter(x=>x.miss)});}));
 return {brt,preStatus,preseasonAI,applyPenalties,PRE_NEED,reservedMap,before,after,onStart,windowOf,mainComp,execute,note,finances};
};
