const assert=require('assert');
const {NAME,SINCE,planRestore,summarize}=require('../restore-unbid');
const src=require('fs').readFileSync(require('path').join(__dirname,'../mp.js'),'utf8');

assert.strictEqual(NAME,'restore-unbid-1311');
assert.strictEqual(SINCE,'2026-11-13 12:00:00-03');
assert.match(src,/migRestoreUnbid1311/);
assert.match(src,/restore-unbid/);

// Sem lances removidos
assert.deepStrictEqual(planRestore([],[]),{restore:[],skip:[],closed:[],conflicts:[],encontrados:0});

// Restaura o maior lance removido do clube no lote aberto, quando não há lance vivo
const logs=[{id:1,lot_id:10,club_id:768,user_id:1,amount:8e6,created_at:'2026-11-13T15:05:00Z',status:'open',player_id:100},
            {id:2,lot_id:10,club_id:768,user_id:1,amount:10e6,created_at:'2026-11-13T15:08:00Z',status:'open',player_id:100}];
let p=planRestore(logs,[]);
assert.strictEqual(p.encontrados,2);
assert.strictEqual(p.restore.length,1);
assert.strictEqual(p.restore[0].amount,10e6);
assert.strictEqual(p.restore[0].action,'insert');
assert.deepStrictEqual(p.restore[0].log_ids,[1,2]);
assert.strictEqual(p.skip.length,0);

// Já tem lance vivo igual ou maior: não sobrescreve
p=planRestore(logs,[{lot_id:10,club_id:768,amount:12e6,user_id:1}]);
assert.strictEqual(p.restore.length,0);
assert.strictEqual(p.skip.length,1);
assert.match(p.skip[0].reason,/igual ou maior/);

// Lance vivo menor: atualiza para o removido
p=planRestore(logs,[{lot_id:10,club_id:768,amount:9e6,user_id:1}]);
assert.strictEqual(p.restore.length,1);
assert.strictEqual(p.restore[0].action,'update');
assert.strictEqual(p.restore[0].prev,9e6);
assert.strictEqual(p.restore[0].amount,10e6);

// Lote encerrado: não restaura
p=planRestore([{id:3,lot_id:11,club_id:768,user_id:1,amount:20e6,status:'sold',player_id:200}],[]);
assert.strictEqual(p.restore.length,0);
assert.strictEqual(p.closed.length,1);
assert.match(p.closed[0].reason,/encerrado/);

// Depois de restaurar, se o clube passa a liderar dois lotes, registra conflito mas ainda restaura (o lance volta a valer; no encerramento cada clube leva no máx. 1)
p=planRestore([
 {id:4,lot_id:20,club_id:768,user_id:1,amount:15e6,created_at:'2026-11-13T15:10:00Z',status:'open',player_id:300},
],[{lot_id:21,club_id:768,amount:12e6,user_id:1,created_at:'2026-11-13T15:12:00Z'}]);
assert.strictEqual(p.restore.length,1);
assert.strictEqual(p.conflicts.length,1);
assert.strictEqual(p.conflicts[0].club_id,768);
assert.deepStrictEqual(p.conflicts[0].lots.sort((a,b)=>a-b),[20,21]);

// Superado no outro lote: não há conflito (restaura e o clube não lidera os dois)
p=planRestore([
 {id:5,lot_id:20,club_id:768,user_id:1,amount:15e6,created_at:'2026-11-13T15:10:00Z',status:'open',player_id:300},
],[{lot_id:21,club_id:768,amount:12e6,user_id:1},{lot_id:21,club_id:123,amount:16e6,user_id:2}]);
assert.strictEqual(p.restore.length,1);
assert.strictEqual(p.conflicts.length,0);

const s=summarize(p,(id)=>id===300?'Jogador X':String(id),(id)=>id===768?'Fluminense':String(id));
assert.strictEqual(s.restaurados[0].clube,'Fluminense');
assert.strictEqual(s.restaurados[0].jogador,'Jogador X');
assert.strictEqual(s.restaurados[0].valor,'€ 15.0 mi');

console.log('ok: restaura lance removido, ignora se já coberto/maior, não mexe em lote encerrado, sinaliza liderança dupla');
