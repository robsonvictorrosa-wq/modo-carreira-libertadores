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

// API e migração no código
const src=fs.readFileSync(path.join(__dirname,'../kit.js'),'utf8');
assert.match(src,/app\.post\('\/api\/rooms\/:code\/zc\/kit'/);
assert.match(src,/app\.post\('\/api\/rooms\/:code\/zc\/shirt'/);
assert.match(src,/app\.get\('\/api\/rooms\/:code\/zc\/kit'/);
assert.match(src,/clubOf/);
assert.match(src,/Escolha um clube/);
assert.match(src,/CREATE TABLE IF NOT EXISTS room_kits/);
assert.match(src,/CREATE TABLE IF NOT EXISTS room_shirts/);
assert.match(src,/INSERT INTO lib_migrations\(name\) VALUES\(\$1\)/);
assert.strictEqual(K.NAME,'kits-1811');
const mp=fs.readFileSync(path.join(__dirname,'../mp.js'),'utf8');
assert.match(mp,/require\('\.\/kit'\)\.runPostgres/);
assert.match(mp,/require\('\.\/kit'\)\.attach/);
const pg=fs.readFileSync(path.join(__dirname,'../pg.sql'),'utf8');
assert.match(pg,/CREATE TABLE IF NOT EXISTS room_kits/);
assert.match(pg,/CREATE TABLE IF NOT EXISTS room_shirts/);
const sw=fs.readFileSync(path.join(__dirname,'../public\/sw.js'),'utf8');
assert.match(sw,/const V='zc-v61'/);
console.log('ok: números 1-99 únicos, cores validadas, API e migração kits-1811');
