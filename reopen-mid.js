// Robson 13/11/2026 20:06: reabre lotes mid unsold até 20:15 (BRT), com prorrogação de 60s;
// só quem não arrematou pode dar lance; mercado pausa até o leilão acabar, sem expirar propostas.
const NAME='reopen-mid-unsold-2015';
const UNTIL='2026-11-13 20:15:00-03';
const PAUSE_MSG='Mercado fechado até o fim do leilão';

function marketWindow(room){
 if(room&&room.auction_open)return {open:false,auction:true,paused_for_auction:true,name:PAUSE_MSG};
 return {open:true,auction:false,paused_for_auction:false};
}

function canBidOvertime({alreadyWon,alreadyWonPlayer}={}){
 if(alreadyWon)return {ok:false,error:`Seu clube já arrematou ${alreadyWonPlayer}. Só quem não levou ninguém pode dar lance nos lotes que ficaram sem oferta.`};
 return {ok:true};
}

function shouldExtend(closesAt,now){
 if(!closesAt)return false;
 const end=new Date(closesAt).getTime(),t=now?new Date(now).getTime():Date.now();
 return end-t<60e3;
}

async function run(pool,{noteText}={}){
 await pool.query('CREATE TABLE IF NOT EXISTS lib_migrations(name TEXT PRIMARY KEY,at TIMESTAMPTZ DEFAULT now())');
 if((await pool.query('SELECT 1 FROM lib_migrations WHERE name=$1',[NAME])).rows.length){console.log('REOPENMID2015 já aplicado');return {already:true};}
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  if((await c.query('SELECT 1 FROM lib_migrations WHERE name=$1',[NAME])).rows.length){await c.query('ROLLBACK');console.log('REOPENMID2015 já aplicado');return {already:true};}
  const [room]=(await c.query("SELECT * FROM rooms WHERE code='LIGA' FOR UPDATE")).rows;
  if(!room){await c.query('INSERT INTO lib_migrations(name) VALUES($1)',[NAME]);await c.query('COMMIT');console.log('REOPENMID2015 SEM SALA LIGA');return {ok:false,reason:'sem sala'};}
  const unsold=(await c.query("SELECT id,player_id FROM auction_lots WHERE room_id=$1 AND season=$2 AND stage='mid' AND status='unsold' ORDER BY id",[room.id,room.season])).rows;
  if(unsold.length)await c.query("UPDATE auction_lots SET status='open',winner_club=NULL,price=NULL,closes_at=$2::timestamptz WHERE room_id=$1 AND season=$3 AND stage='mid' AND status='unsold'",[room.id,UNTIL,room.season]);
  await c.query("UPDATE rooms SET auction_open=true,version=version+1 WHERE id=$1",[room.id]);
  const ev=noteText||`🔨 Leilão do meio reaberto até 20:15 (horário de Brasília), só nos jogadores que ficaram sem lance. Quem já arrematou alguém não pode dar lance. Lance nos últimos 60 s prorroga o lote por 60 s. 🔒 Mercado fechado até o fim do leilão. Propostas pendentes não foram apagadas e voltam a valer quando o leilão terminar.`;
  await c.query('INSERT INTO room_events(room_id,text) VALUES($1,$2)',[room.id,ev]);
  await c.query('INSERT INTO lib_migrations(name) VALUES($1)',[NAME]);
  await c.query('COMMIT');
  const out={ok:true,reabertos:unsold.length,lotes:unsold.map(x=>x.id),fecha:UNTIL};
  console.log('REOPENMID2015 OK',JSON.stringify(out));
  return out;
 }catch(e){await c.query('ROLLBACK').catch(()=>{});console.error('REOPENMID2015 ERR',e.message);throw e;}
 finally{c.release();}
}

module.exports={NAME,UNTIL,PAUSE_MSG,marketWindow,canBidOvertime,shouldExtend,run};
