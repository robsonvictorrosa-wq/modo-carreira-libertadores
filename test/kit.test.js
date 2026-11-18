const assert=require('assert');
const fs=require('fs');
const path=require('path');
const K=require('../kit');

// cores
assert.strictEqual(K.parseColor('#abCdEf','#000000'),'#ABCDEF');
assert.strictEqual(K.parseColor('red','#FFFFFF'),'#FFFFFF');
assert.strictEqual(K.parseColor('#fff','#111111'),'#111111');
assert.strictEqual(K.parseColor('#GGGGGG','#111111'),'#111111');
const flu=K.clubDefault('Fluminense');
assert.strictEqual(flu.primary,'#7A0019');
assert.strictEqual(flu.secondary,'#006437');
assert.strictEqual(flu.number,'#FFFFFF');
assert.ok(flu.gk_primary);
const uni=K.clubDefault('Universitario');
assert.strictEqual(uni.primary,'#F2E8D5');
assert.strictEqual(uni.secondary,'#7A0019');
assert.strictEqual(uni.number,'#7A0019');
const nac=K.clubDefault('Nacional');
assert.strictEqual(nac.primary,'#FFFFFF');
assert.strictEqual(nac.secondary,'#003B73');
assert.strictEqual(nac.number,'#003B73');
const unknown=K.clubDefault('Clube Inexistente ZC');
assert.deepStrictEqual(unknown,K.FALLBACK);
const kit=K.normalizeKit({primary:'#ff0000',secondary:'nope'},flu);
assert.strictEqual(kit.primary,'#FF0000');
assert.strictEqual(kit.secondary,flu.secondary);
assert.strictEqual(kit.number,flu.number);

// números: faixa e inteiro
assert.strictEqual(K.parseNumber(7),7);
assert.strictEqual(K.parseNumber('99'),99);
assert.throws(()=>K.parseNumber(0),/1 a 99/);
assert.throws(()=>K.parseNumber(100),/1 a 99/);
assert.throws(()=>K.parseNumber(7.5),/1 a 99/);
assert.throws(()=>K.parseNumber('x'),/1 a 99/);

const squad=[
 {id:1,name:'Goleiro',primary_position:'GOL',overall:80},
 {id:2,name:'Lateral D',primary_position:'LD',overall:78},
 {id:3,name:'Lateral E',primary_position:'LE',overall:77},
 {id:4,name:'Zagueiro A',primary_position:'ZAG',overall:82},
 {id:5,name:'Zagueiro B',primary_position:'ZAG',overall:79},
 {id:6,name:'Volante',primary_position:'VOL',overall:81},
 {id:7,name:'Meia',primary_position:'MC',overall:80},
 {id:8,name:'Meia at',primary_position:'MEI',overall:84},
 {id:9,name:'Ponta D',primary_position:'PD',overall:83},
 {id:10,name:'Ponta E',primary_position:'PE',overall:82},
 {id:11,name:'Atacante',primary_position:'ATA',overall:86},
 {id:12,name:'Reserva GOL',primary_position:'GOL',overall:74},
 {id:13,name:'Reserva ATA',primary_position:'ATA',overall:75}
];
const nums=K.defaultNumbers(squad,{});
assert.strictEqual(nums[1],1);
assert.strictEqual(nums[2],2);
assert.strictEqual(nums[3],3);
assert.strictEqual(nums[11],9);
assert.strictEqual(nums[8],10);
const vals=Object.values(nums);
assert.strictEqual(vals.length,squad.length);
assert.strictEqual(new Set(vals).size,squad.length);
assert.ok(vals.every(n=>n>=1&&n<=99));
// reserva do gol não pega o 1 já usado
assert.notStrictEqual(nums[12],1);
assert.ok([12,22,23,24].includes(nums[12]));

// números salvos têm prioridade e não se repetem
const saved={11:99,8:99}; // 99 duplicado: só o primeiro válido na ordem do elenco? defaultNumbers walks squad order, 8 comes before 11 so 8 keeps 99?
const withSaved=K.defaultNumbers(squad,{11:99});
assert.strictEqual(withSaved[11],99);
assert.ok(Object.values(withSaved).filter(n=>n===99).length===1);
assert.notStrictEqual(withSaved[8],99);

// setNumber rejeita duplicata do número já exibido
assert.throws(()=>K.setNumber(squad,{},13,9),/já é de outro/);
assert.strictEqual(K.setNumber(squad,{11:21},11,21),21);
assert.strictEqual(K.setNumber(squad,{},13,88),88);
assert.throws(()=>K.setNumber(squad,{},999,10),/fora do elenco/);

// lote
const batch=K.setNumbers(squad,{},[{player_id:11,number:99},{player_id:8,number:20}]);
assert.strictEqual(batch[11],99);
assert.strictEqual(batch[8],20);
assert.throws(()=>K.setNumbers(squad,{},[{player_id:11,number:9},{player_id:13,number:9}]),/já é de outro/);

// permuta 10↔8 (MEI tinha 10, MC tinha 8) — nas duas ordens
assert.strictEqual(nums[8],10);
assert.strictEqual(nums[7],8);
for(const order of [
  [{player_id:8,number:8},{player_id:7,number:10}],
  [{player_id:7,number:10},{player_id:8,number:8}]
]){
  const swap=K.setNumbers(squad,{},order);
  assert.strictEqual(swap[8],8);
  assert.strictEqual(swap[7],10);
  assert.strictEqual(swap[11],9);
  assert.strictEqual(new Set(Object.values(swap)).size,squad.length);
}

// troca em lote de vários números, todos distintos no resultado
const lote=K.setNumbers(squad,{11:9,8:10},[
  {player_id:11,number:99},{player_id:9,number:21},{player_id:10,number:17},{player_id:8,number:20},{player_id:7,number:14}
]);
assert.strictEqual(lote[11],99);
assert.strictEqual(lote[9],21);
assert.strictEqual(lote[10],17);
assert.strictEqual(lote[8],20);
assert.strictEqual(lote[7],14);
assert.strictEqual(new Set(Object.values(lote)).size,squad.length);

// ex-jogador (id 99) com número 16 não bloqueia o ATA de assumir o 16 (16 não é default de ninguém do elenco)
const exSaved={99:16,8:10,11:9};
const freed=K.setNumbers(squad,exSaved,[{player_id:11,number:16}]);
assert.strictEqual(freed[11],16);
assert.ok(!Object.keys(freed).includes('99')&&freed[99]==null);
assert.strictEqual(new Set(Object.values(freed)).size,squad.length);

// persistência: transação apaga ex-jogador e aceita permuta sem UNIQUE no meio
async function withStore(seed){
  const rows=seed.map(r=>({...r}));
  const exec=async(sql,p)=>{
    const s=String(sql).replace(/\s+/g,' ').trim();
    if(s==='DELETE FROM room_shirts WHERE room_id=$1 AND club_id=$2'){
      for(let i=rows.length-1;i>=0;i--)if(rows[i].room_id===p[0]&&rows[i].club_id===p[1])rows.splice(i,1);
      return {rowCount:1};
    }
    if(s.startsWith('INSERT INTO room_shirts')){
      if(rows.some(r=>r.room_id===p[0]&&r.club_id===p[1]&&(r.player_id===p[2]||r.number===p[3]))){
        const e=new Error('duplicate');e.code='23505';throw e;
      }
      rows.push({room_id:p[0],club_id:p[1],player_id:p[2],number:p[3]});
      return {rowCount:1};
    }
    throw new Error('sql inesperado: '+s);
  };
  return {rows,exec};
}
async function testPersist(){
  const roomId=1,clubId=7;
  const store=await withStore([
    {room_id:roomId,club_id:clubId,player_id:99,number:16}, // ex-jogador
    {room_id:roomId,club_id:clubId,player_id:8,number:10},
    {room_id:roomId,club_id:clubId,player_id:7,number:8},
    {room_id:roomId,club_id:clubId,player_id:11,number:9}
  ]);
  const next=K.setNumbers(squad,{99:16,8:10,7:8,11:9},[
    {player_id:8,number:8},{player_id:7,number:10},{player_id:11,number:16}
  ]);
  await K.writeShirts(store.exec,roomId,clubId,next);
  const mine=store.rows.filter(r=>r.room_id===roomId&&r.club_id===clubId);
  assert.ok(!mine.some(r=>r.player_id===99),'ex-jogador deve sair');
  const by=Object.fromEntries(mine.map(r=>[r.player_id,r.number]));
  assert.strictEqual(by[8],8);
  assert.strictEqual(by[7],10);
  assert.strictEqual(by[11],16);
  assert.strictEqual(new Set(mine.map(r=>r.number)).size,mine.length);
  assert.strictEqual(mine.length,squad.length);
}

// API: números continuam graváveis; cores da camisa não se editam
const src=fs.readFileSync(path.join(__dirname,'../kit.js'),'utf8');
assert.match(src,/app\.post\('\/api\/rooms\/:code\/zc\/kit'/);
assert.match(src,/A edição das cores da camisa está desativada/);
assert.match(src,/app\.post\('\/api\/rooms\/:code\/zc\/shirt'/);
assert.match(src,/app\.post\('\/api\/rooms\/:code\/zc\/shirts'/);
assert.match(src,/INSERT INTO room_shirts/);
assert.match(src,/function writeShirts/);
assert.match(src,/DELETE FROM room_shirts WHERE room_id=\$1 AND club_id=\$2'\s*,\s*\[roomId,clubId\]/);
assert.match(src,/app\.get\('\/api\/rooms\/:code\/zc\/kit'/);
assert.match(src,/clubDefault\(clubName,clubId\)/);
assert.match(src,/defaultNumbers\(squad,saved\)/);
assert.match(src,/clubOf/);
assert.match(src,/Escolha um clube/);
assert.match(src,/CREATE TABLE IF NOT EXISTS room_kits/);
assert.match(src,/CREATE TABLE IF NOT EXISTS room_shirts/);
assert.match(src,/INSERT INTO lib_migrations\(name\) VALUES\(\$1\)/);
assert.strictEqual(K.NAME,'kits-1811');
const ui=fs.readFileSync(path.join(__dirname,'../public/zc.js'),'utf8');
assert.match(ui,/Mudar número/);
assert.doesNotMatch(ui,/Mudar a camisa/);
assert.match(ui,/zNumeros/);
assert.match(ui,/zSaveShirts/);
const mp=fs.readFileSync(path.join(__dirname,'../mp.js'),'utf8');
assert.match(mp,/require\('\.\/kit'\)\.runPostgres/);
assert.match(mp,/require\('\.\/kit'\)\.attach/);
const pg=fs.readFileSync(path.join(__dirname,'../pg.sql'),'utf8');
assert.match(pg,/CREATE TABLE IF NOT EXISTS room_kits/);
assert.match(pg,/CREATE TABLE IF NOT EXISTS room_shirts/);
const sw=fs.readFileSync(path.join(__dirname,'../public/sw.js'),'utf8');
assert.match(sw,/const V='zc-v66'/);
assert.match(ui,/function kitPos\(x,y,sl\)/);
assert.match(ui,/shirt-wrap/);
assert.match(ui,/Escalação titular/);
const css=fs.readFileSync(path.join(__dirname,'../public/zc.css'),'utf8');
assert.match(css,/\.xi-title\{position:absolute/);
assert.match(css,/aspect-ratio:4\/3/);
assert.match(css,/\.kit-tag\{[^}]*width:120px/);
assert.match(css,/\.kit-tag \.knm\{[^}]*font-size:15px/);
assert.doesNotMatch(css,/aspect-ratio:4\/5/);

testPersist().then(()=>console.log('ok: números 1-99 únicos e graváveis, cores fixas do clube, edição de cor desativada')).catch(e=>{console.error(e);process.exit(1);});
