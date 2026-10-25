// Remove dados de TESTE (usuários testeNNNN/shotsNNNN/zcNNNN e salas de smoke/screenshots) SÓ no schema da Libertadores.
// Uso: node scripts/cleanup-test.js            (simulação, só lista)
//      node scripts/cleanup-test.js --apply    (apaga)
const {Pool}=require('pg');const SCH=process.env.PGSCHEMA;
if(!SCH||!/^(libertadores|libz)$/.test(SCH)){console.error('Recusado: PGSCHEMA precisa ser libertadores');process.exit(1);}
const ssl=process.env.PGSSL==='0'?false:{rejectUnauthorized:false};
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl,max:1});const apply=process.argv.includes('--apply');
const USER_RE='^(teste|shots|zc|smoke)[0-9]+$',ROOM_RE='^(smoke|zc smoke|screenshots zc|teste.*|smoke.*)$';
(async()=>{const c=await pool.connect();try{await c.query(`SET search_path TO ${SCH}`);
 const us=(await c.query('SELECT id,nick FROM users WHERE nick ~* $1',[USER_RE])).rows;
 const rs=(await c.query('SELECT id,code,name FROM rooms WHERE name ~* $1 OR owner_id IN (SELECT id FROM users WHERE nick ~* $2)',[ROOM_RE,USER_RE])).rows;
 console.log(`[${SCH}] usuários de teste: ${us.length} → ${us.map(u=>u.nick).join(', ')}`);console.log(`[${SCH}] salas de teste: ${rs.length} → ${rs.map(r=>r.code+' '+r.name).join(', ')}`);
 if(apply){await c.query('BEGIN');
  for(const r of rs)await c.query('DELETE FROM rooms WHERE id=$1',[r.id]);
  for(const u of us){for(const t of ['room_managers','watchlist','sessions','auction_bids'])await c.query(`DELETE FROM ${t} WHERE user_id=$1`,[u.id]).catch(()=>{});await c.query('DELETE FROM users WHERE id=$1',[u.id]);}
  await c.query('COMMIT');console.log('APAGADO.');}
 const ru=(await c.query('SELECT nick FROM users ORDER BY id')).rows,rr=(await c.query('SELECT code,name FROM rooms ORDER BY id')).rows;
 console.log(`Restam ${ru.length} usuários: ${ru.map(x=>x.nick).join(', ')||'—'}`);console.log(`Restam ${rr.length} salas: ${rr.map(x=>x.code+' '+x.name).join(', ')||'—'}`);
}catch(e){await c.query('ROLLBACK').catch(()=>{});console.error('ERRO',e.message);process.exitCode=1;}finally{c.release();await pool.end();}})();
