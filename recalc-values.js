// Robson 15/11/2026: valor de mercado por overall e potencial, sem desconto de idade dos veteranos.
// Recalcula market_value (e a idade de nascimento) no game.db e no room_players. Idempotente via lib_value_formula / lib_migrations.
const fs=require('fs'),VAL=require('./value'),BD=require('./birth');
const NAME='values-no-age-disc-1511';
const MARKER='no-age-disc-1511';

function apply(p){const e={...p};const a=BD.ageOf(e.id);if(a!=null)e.age=a;VAL.fix(e);e.market_value=VAL(e);return e;}

function runSqlite(db){
 BD.load(db);
 db.exec("CREATE TABLE IF NOT EXISTS lib_value_formula(name TEXT PRIMARY KEY,at TEXT)");
 if(db.prepare('SELECT 1 FROM lib_value_formula WHERE name=?').get(MARKER))return {ok:true,skipped:true,atualizados:0};
 const rows=db.prepare('SELECT id,overall,potential,age,market_value FROM players').all();
 const upd=db.prepare('UPDATE players SET age=?,potential=?,market_value=? WHERE id=?');
 let n=0;
 db.transaction(()=>{
  for(const r of rows){const e=apply(r);if(e.age!==r.age||e.potential!==r.potential||e.market_value!==r.market_value){upd.run(e.age,e.potential,e.market_value,r.id);n++;}}
  db.prepare('UPDATE clubs SET squad_value=(SELECT coalesce(sum(market_value),0) FROM players WHERE club_id=clubs.id)').run();
  db.prepare("INSERT INTO lib_value_formula(name,at) VALUES(?,datetime('now'))").run(MARKER);
 })();
 const out={ok:true,atualizados:n};
 console.log('VALUESNOAGEDISC1511 game.db OK',JSON.stringify(out));
 return out;
}

function file(p){
 if(!p||!fs.existsSync(p)){console.warn('recalc-values: game.db ausente, pulando');return {ok:false,reason:'missing'};}
 const D=require('better-sqlite3');
 const db=new D(p);
 try{return runSqlite(db);}finally{db.close();}
}

async function runPostgres(pool,uni){
 if((await pool.query('SELECT 1 FROM lib_migrations WHERE name=$1',[NAME])).rows.length)return {ok:true,skipped:true};
 BD.load(uni);
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  const rows=(await c.query('SELECT room_id,player_id,overall,potential,age,market_value FROM room_players')).rows;
  let n=0;
  for(const r of rows){
   const base=uni.prepare('SELECT id,overall,potential,age,market_value FROM players WHERE id=?').get(r.player_id);
   if(!base)continue;
   const p={...base};
   if(r.overall>0)p.overall=+r.overall;
   if(r.potential>0)p.potential=+r.potential;
   if(r.age>0)p.age=+r.age;
   const e=apply(p);
   const age=BD.ageOf(p.id);
   if(+e.market_value!==+r.market_value||(age!=null&&+age!==+r.age)){
    await c.query('UPDATE room_players SET market_value=$1,age=COALESCE($2,age) WHERE room_id=$3 AND player_id=$4',[e.market_value,age,r.room_id,r.player_id]);
    n++;
   }
  }
  await c.query('INSERT INTO lib_migrations(name) VALUES($1)',[NAME]);
  await c.query('COMMIT');
  const out={ok:true,atualizados:n};
  console.log('VALUESNOAGEDISC1511 OK',JSON.stringify(out));
  return out;
 }catch(e){await c.query('ROLLBACK').catch(()=>{});console.error('VALUESNOAGEDISC1511 ERR',e.message);throw e;}
 finally{c.release();}
}

module.exports={NAME,MARKER,apply,runSqlite,file,runPostgres};
