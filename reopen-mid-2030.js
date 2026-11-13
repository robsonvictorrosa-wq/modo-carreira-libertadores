// Robson 13/11/2026 20:14: desfaz as vendas do fechamento das 20:00:13, reabre TODOS os lotes mid
// com o último lance valendo, até 20:30 (BRT), prorrogação de 60s. Todos os clubes podem lançar.
// Mercado continua fechado até o leilão acabar. Idempotente via lib_migrations.
const NAME='reopen-mid-2030';
const UNTIL='2026-11-13 20:30:00-03';
const SINCE='2026-11-13 20:00:00-03';
const EVENT='🔨 Leilão reaberto até 20:30 com os últimos lances valendo, prorrogação de 60s. Mercado fechado até o fim do leilão. Propostas pendentes seguem valendo.';

function planPrev(prev,fromClub){
 if(prev&&prev.none)return {action:'delete'};
 if(prev&&typeof prev==='object')return {action:'update',prev};
 return {action:'fallback',club_id:fromClub};
}

async function restorePlayer(c,roomId,pid,fromClub,prev){
 const plan=planPrev(prev,fromClub);
 if(plan.action==='delete'){await c.query('DELETE FROM room_players WHERE room_id=$1 AND player_id=$2',[roomId,pid]);return plan;}
 if(plan.action==='update'){
  const cols=Object.keys(plan.prev).filter(k=>!['room_id','player_id'].includes(k));
  if(!cols.length){await c.query('UPDATE room_players SET club_id=$3,loan_from=NULL,loan_until=NULL WHERE room_id=$1 AND player_id=$2',[roomId,pid,fromClub]);return plan;}
  await c.query(`UPDATE room_players SET ${cols.map((k,i)=>`${k}=$${i+3}`).join(',')} WHERE room_id=$1 AND player_id=$2`,[roomId,pid,...cols.map(k=>plan.prev[k])]);
  return plan;
 }
 await c.query('UPDATE room_players SET club_id=$3,loan_from=NULL,loan_until=NULL WHERE room_id=$1 AND player_id=$2',[roomId,pid,fromClub]);
 return plan;
}

async function run(pool,{isFree,pname,cname}={}){
 const free=isFree||(()=>false);
 const pn=id=>{try{return pname?pname(id):String(id);}catch(e){return String(id);}};
 const cn=id=>{try{return cname?cname(id):String(id);}catch(e){return String(id);}};
 await pool.query('CREATE TABLE IF NOT EXISTS lib_migrations(name TEXT PRIMARY KEY,at TIMESTAMPTZ DEFAULT now())');
 if((await pool.query('SELECT 1 FROM lib_migrations WHERE name=$1',[NAME])).rows.length){console.log('REOPENMID2030 já aplicado');return {already:true};}
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  if((await c.query('SELECT 1 FROM lib_migrations WHERE name=$1',[NAME])).rows.length){await c.query('ROLLBACK');console.log('REOPENMID2030 já aplicado');return {already:true};}
  const [room]=(await c.query("SELECT * FROM rooms WHERE code='LIGA' FOR UPDATE")).rows;
  if(!room){await c.query('INSERT INTO lib_migrations(name) VALUES($1)',[NAME]);await c.query('COMMIT');console.log('REOPENMID2030 SEM SALA LIGA');return {ok:false,reason:'sem sala'};}
  const lots=(await c.query("SELECT * FROM auction_lots WHERE room_id=$1 AND season=$2 AND stage='mid' AND status IN ('sold','unsold') ORDER BY id",[room.id,room.season])).rows;
  const revertidas=[],conflitos=[],reabertos=[];
  let verba=0;
  for(const l of lots){
   if(l.status==='sold'){
    const [t]=(await c.query("SELECT * FROM transfers WHERE room_id=$1 AND player_id=$2 AND to_club=$3 AND kind='leilão' AND status<>'cancelled' AND created_at>=$4::timestamptz ORDER BY id DESC LIMIT 1",[room.id,l.player_id,l.winner_club,SINCE])).rows;
    if(!t){conflitos.push({lote:l.id,jogador:pn(l.player_id),motivo:'transferência de leilão não encontrada'});}
    else{
     const later=(await c.query("SELECT 1 FROM transfers WHERE room_id=$1 AND player_id=$2 AND id>$3 AND status<>'cancelled'",[room.id,l.player_id,t.id])).rows.length;
     if(later){conflitos.push({lote:l.id,jogador:pn(l.player_id),motivo:'já houve transferência depois do leilão'});continue;}
     await restorePlayer(c,room.id,l.player_id,l.from_club,t.prev);
     const fee=+t.fee||0;
     if(fee){await c.query('UPDATE room_clubs SET budget=budget+$3 WHERE room_id=$1 AND club_id=$2',[room.id,t.to_club,fee]);if(!free(t.from_club))await c.query('UPDATE room_clubs SET budget=budget-$3 WHERE room_id=$1 AND club_id=$2',[room.id,t.from_club,fee]);verba+=fee;}
     await c.query('UPDATE lineups SET starters=NULL WHERE room_id=$1 AND club_id=$2 AND $3=ANY(starters)',[room.id,t.to_club,l.player_id]);
     await c.query("UPDATE transfers SET status='cancelled',cancelled_by=$2,cancelled_at=now() WHERE id=$1",[t.id,'sistema']);
     revertidas.push({lote:l.id,jogador:pn(l.player_id),jogador_id:l.player_id,clube:cn(t.to_club),clube_id:t.to_club,valor:'€ '+((fee)/1e6).toFixed(1)+' mi',fee});
    }
   }
   await c.query("UPDATE auction_lots SET status='open',winner_club=NULL,price=NULL,closes_at=$2::timestamptz WHERE id=$1",[l.id,UNTIL]);
   reabertos.push(l.id);
  }
  if(reabertos.length){
   await c.query(`INSERT INTO auction_bids(lot_id,club_id,user_id,amount,created_at)
     SELECT DISTINCT ON (g.lot_id,g.club_id) g.lot_id,g.club_id,g.user_id,g.amount,g.created_at
     FROM auction_bid_log g WHERE g.lot_id=ANY($1) AND g.removed_at IS NULL
     ORDER BY g.lot_id,g.club_id,g.amount DESC,g.id DESC
     ON CONFLICT(lot_id,club_id) DO NOTHING`,[reabertos]);
  }
  await c.query('UPDATE rooms SET auction_open=true,version=version+1 WHERE id=$1',[room.id]);
  await c.query('INSERT INTO room_events(room_id,text) VALUES($1,$2)',[room.id,EVENT]);
  await c.query('INSERT INTO lib_migrations(name) VALUES($1)',[NAME]);
  await c.query('COMMIT');
  const out={ok:true,reabertos:reabertos.length,lotes:reabertos,vendas_revertidas:revertidas.length,revertidas,verba_devolvida:'€ '+(verba/1e6).toFixed(1)+' mi',verba,conflitos,fecha:UNTIL};
  console.log('REOPENMID2030 OK',JSON.stringify(out));
  return out;
 }catch(e){await c.query('ROLLBACK').catch(()=>{});console.error('REOPENMID2030 ERR',e.message);throw e;}
 finally{c.release();}
}

module.exports={NAME,UNTIL,SINCE,EVENT,planPrev,restorePlayer,run};
