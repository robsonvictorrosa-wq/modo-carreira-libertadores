// Robson 13/11/2026 20:19: só antecipa o fechamento do leilão reaberto de 20:30 para 20:25 (BRT).
// Não reabre lotes, não desfaz venda e não mexe em lances. Idempotente via lib_migrations.
const NAME='mid-close-2025';
const FROM='2026-11-13 20:30:00-03';
const UNTIL='2026-11-13 20:25:00-03';
const EVENT='🔨 Leilão: fechamento antecipado para 20:25 (horário de Brasília), com prorrogação de 60s. Mercado fechado até o fim do leilão.';

async function run(pool){
 await pool.query('CREATE TABLE IF NOT EXISTS lib_migrations(name TEXT PRIMARY KEY,at TIMESTAMPTZ DEFAULT now())');
 if((await pool.query('SELECT 1 FROM lib_migrations WHERE name=$1',[NAME])).rows.length){console.log('MIDCLOSE2025 já aplicado');return {already:true};}
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  if((await c.query('SELECT 1 FROM lib_migrations WHERE name=$1',[NAME])).rows.length){await c.query('ROLLBACK');console.log('MIDCLOSE2025 já aplicado');return {already:true};}
  const [room]=(await c.query("SELECT * FROM rooms WHERE code='LIGA' FOR UPDATE")).rows;
  if(!room){await c.query('INSERT INTO lib_migrations(name) VALUES($1)',[NAME]);await c.query('COMMIT');console.log('MIDCLOSE2025 SEM SALA LIGA');return {ok:false,reason:'sem sala'};}
  const upd=await c.query("UPDATE auction_lots SET closes_at=$3::timestamptz WHERE room_id=$1 AND season=$2 AND stage='mid' AND status='open' AND closes_at=$4::timestamptz RETURNING id",[room.id,room.season,UNTIL,FROM]);
  const ids=upd.rows.map(r=>r.id);
  await c.query('UPDATE rooms SET version=version+1 WHERE id=$1',[room.id]);
  await c.query('INSERT INTO room_events(room_id,text) VALUES($1,$2)',[room.id,EVENT]);
  await c.query('INSERT INTO lib_migrations(name) VALUES($1)',[NAME]);
  await c.query('COMMIT');
  const out={ok:true,atualizados:ids.length,lotes:ids,fecha:UNTIL};
  console.log('MIDCLOSE2025 OK',JSON.stringify(out));
  return out;
 }catch(e){await c.query('ROLLBACK').catch(()=>{});console.error('MIDCLOSE2025 ERR',e.message);throw e;}
 finally{c.release();}
}

module.exports={NAME,FROM,UNTIL,EVENT,run};
