// Robson 13/11/2026: qualquer lance removido após 12:00 (horário de Brasília) na sala LIGA volta a valer.
// Idempotente via lib_migrations. Só atua em lotes ainda abertos. Log: RESTOREUNBID1311.
const NAME='restore-unbid-1311';
const SINCE='2026-11-13 12:00:00-03';

function key(lot,club){return lot+':'+club;}

function bestOf(rows){
 return rows.slice().sort((a,b)=>+b.amount-+a.amount||+b.id-+a.id)[0];
}

function planRestore(logs,liveBids){
 const live=new Map((liveBids||[]).map(b=>[key(b.lot_id,b.club_id),b]));
 const restore=[],skip=[],closed=[];
 const after=new Map(live);
 for(const [k,rows] of groupOpen(logs)){
  const best=bestOf(rows);
  const cur=live.get(k);
  const ids=rows.map(r=>r.id);
  if(cur&&+cur.amount>=+best.amount){
   skip.push({lot_id:best.lot_id,club_id:best.club_id,player_id:best.player_id,amount:+best.amount,reason:'já tem lance igual ou maior',log_ids:ids,live:+cur.amount});
   continue;
  }
  const item={lot_id:best.lot_id,club_id:best.club_id,user_id:best.user_id,player_id:best.player_id,amount:+best.amount,created_at:best.created_at,log_ids:ids,action:cur?'update':'insert',prev:cur?+cur.amount:null};
  restore.push(item);
  after.set(k,{lot_id:best.lot_id,club_id:best.club_id,amount:+best.amount,created_at:best.created_at||cur&&cur.created_at});
 }
 for(const l of logs||[])if(l.status!=='open')closed.push({id:l.id,lot_id:l.lot_id,club_id:l.club_id,player_id:l.player_id,amount:+l.amount,status:l.status,reason:'lote já encerrado'});
 const leaders=new Map();
 for(const b of after.values()){
  const cur=leaders.get(b.lot_id);
  const bt=b.created_at?new Date(b.created_at).getTime():0,ct=cur&&cur.created_at?new Date(cur.created_at).getTime():0;
  if(!cur||+b.amount>+cur.amount||(+b.amount===+cur.amount&&bt&&ct&&bt<ct)||(+b.amount===+cur.amount&&!cur))leaders.set(b.lot_id,b);
 }
 const byClub=new Map();
 for(const b of leaders.values()){if(!byClub.has(b.club_id))byClub.set(b.club_id,[]);byClub.get(b.club_id).push(b.lot_id);}
 const conflicts=[...byClub.entries()].filter(([,lots])=>lots.length>1).map(([club_id,lots])=>({club_id,lots}));
 return {restore,skip,closed,conflicts,encontrados:(logs||[]).length};
}

function groupOpen(logs){
 const g=new Map();
 for(const l of logs||[]){
  if(l.status!=='open')continue;
  const k=key(l.lot_id,l.club_id);
  if(!g.has(k))g.set(k,[]);g.get(k).push(l);
 }
 return g;
}

function mi(v){return '€ '+((+v||0)/1e6).toFixed(1)+' mi';}

function summarize(plan,pname,cname){
 const nm=(fn,id)=>{try{return fn?fn(id):String(id);}catch(e){return String(id);}};
 const row=x=>({lote:x.lot_id,clube:nm(cname,x.club_id),clube_id:x.club_id,jogador:nm(pname,x.player_id),jogador_id:x.player_id,valor:mi(x.amount),acao:x.action||undefined,motivo:x.reason||undefined});
 return {encontrados:plan.encontrados,restaurados:plan.restore.map(row),ignorados:plan.skip.map(row),encerrados:plan.closed.map(row),conflitos:plan.conflicts.map(c=>({clube:nm(cname,c.club_id),clube_id:c.club_id,lotes:c.lots}))};
}

async function run(pool,{pname,cname}={}){
 await pool.query('CREATE TABLE IF NOT EXISTS lib_migrations(name TEXT PRIMARY KEY,at TIMESTAMPTZ DEFAULT now())');
 if((await pool.query('SELECT 1 FROM lib_migrations WHERE name=$1',[NAME])).rows.length){console.log('RESTOREUNBID1311 já aplicado');return {already:true};}
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  if((await c.query('SELECT 1 FROM lib_migrations WHERE name=$1',[NAME])).rows.length){await c.query('ROLLBACK');console.log('RESTOREUNBID1311 já aplicado');return {already:true};}
  const logs=(await c.query(`SELECT g.id,g.lot_id,g.club_id,g.user_id,g.amount,g.created_at,g.removed_at,l.player_id,l.status,l.stage
    FROM auction_bid_log g JOIN auction_lots l ON l.id=g.lot_id JOIN rooms r ON r.id=l.room_id
    WHERE r.code='LIGA' AND g.removed_at IS NOT NULL AND g.removed_at>=$1::timestamptz
    ORDER BY g.removed_at,g.id`,[SINCE])).rows;
  const lotIds=[...new Set(logs.map(x=>x.lot_id))];
  const live=lotIds.length?(await c.query('SELECT lot_id,club_id,user_id,amount,created_at FROM auction_bids WHERE lot_id=ANY($1)',[lotIds])).rows:[];
  const plan=planRestore(logs,live);
  for(const r of plan.restore){
   await c.query('INSERT INTO auction_bids(lot_id,club_id,user_id,amount,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(lot_id,club_id) DO UPDATE SET amount=EXCLUDED.amount,user_id=EXCLUDED.user_id,created_at=EXCLUDED.created_at',[r.lot_id,r.club_id,r.user_id,r.amount,r.created_at||new Date()]);
   await c.query('UPDATE auction_bid_log SET removed_at=NULL WHERE id=ANY($1) AND removed_at IS NOT NULL',[r.log_ids]);
  }
  const out=summarize(plan,pname,cname);
  const [room]=(await c.query("SELECT id FROM rooms WHERE code='LIGA'")).rows;
  if(room&&plan.restore.length){
   const lines=plan.restore.map(r=>`${(cname&&cname(r.club_id))||r.club_id} ${mi(r.amount)} em ${(pname&&pname(r.player_id))||r.player_id}`);
   await c.query('INSERT INTO room_events(room_id,text) VALUES($1,$2)',[room.id,`↩️ Lances removidos após 12:00 (13/11) voltaram a valer: ${lines.join('; ')}.`]);
   await c.query('UPDATE rooms SET version=version+1 WHERE id=$1',[room.id]);
  }
  await c.query('INSERT INTO lib_migrations(name) VALUES($1)',[NAME]);
  await c.query('COMMIT');
  console.log('RESTOREUNBID1311 OK',JSON.stringify(out));
  return out;
 }catch(e){await c.query('ROLLBACK').catch(()=>{});console.error('RESTOREUNBID1311 ERR',e.message);throw e;}
 finally{c.release();}
}

module.exports={NAME,SINCE,planRestore,summarize,run};
