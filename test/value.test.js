const assert=require('assert');
const fs=require('fs');const path=require('path');
const VAL=require('../value');

function oldVAL(o,pot,a){
 if(a>33)pot=o;
 pot=Math.max(o,pot||o);
 let v=6e6*Math.exp(0.25*(o-75));
 const youth=a<=21?1.5:a<=24?1:a<=28?0.5:0.15;v*=1+0.08*(pot-o)*youth;
 if(a>=31)v*=Math.max(0.3,1-0.08*(a-30));
 const st=v>=1e7?5e5:v>=1e6?1e5:1e4;return Math.max(1e4,Math.round(v/st)*st);
}
const cur=(o,pot,a)=>{const p={overall:o,potential:pot,age:a};VAL.fix(p);return VAL(p);};

// base + bônus de potencial (jovem 24) inalterados
assert.strictEqual(cur(75,80,24),8.4e6);
assert.strictEqual(cur(76,80,24),10e6);
assert.strictEqual(cur(75,80,24),oldVAL(75,80,24));

// até 30 anos o valor não muda (o desconto só começava em 31)
for(const [o,pot,a] of [[79,81,30],[79,82,30],[75,75,25],[70,80,21],[82,85,28],[76,77,30]]){
 assert.strictEqual(cur(o,pot,a),oldVAL(o,pot,a),`<=30 mudou: ${o}/${pot}/${a}`);
}

// veteranos: sai o desconto de 8%/ano após 30; o fator de juventude do potencial permanece
assert.ok(cur(77,78,32)>oldVAL(77,78,32)); // Gallardo
assert.ok(cur(80,80,37)>oldVAL(80,80,37)); // Müller
assert.ok(cur(82,82,38)>oldVAL(82,82,38)); // Di María
assert.ok(cur(76,77,31)>oldVAL(76,77,31)); // 31 anos
assert.strictEqual(cur(77,78,32),10e6); // Gallardo 77/78/32, youth 0.15
assert.strictEqual(cur(80,80,37),21e6); // Müller 80/80/37, pot travado
assert.strictEqual(cur(82,82,38),34.5e6); // Di María 82/82/38
assert.strictEqual(cur(76,77,31),7.8e6); // Bernardo-like

// trava de potencial 34+ permanece (idade 33 ainda pode ter pot > ovr)
const locked={overall:80,potential:85,age:37};VAL.fix(locked);
assert.strictEqual(locked.potential,80);
assert.strictEqual(VAL(locked),21e6);
const at33={overall:77,potential:80,age:33};VAL.fix(at33);
assert.strictEqual(at33.potential,80);
assert.ok(cur(77,80,33)>cur(77,77,33));

// código: desconto removido, resto da fórmula no lugar
const src=fs.readFileSync(path.join(__dirname,'../value.js'),'utf8');
assert.doesNotMatch(src,/if\(a>=31\)/);
assert.doesNotMatch(src,/1-0\.08\*\(a-30\)/);
assert.match(src,/6e6\*Math\.exp\(0\.25\*\(o-75\)\)/);
assert.match(src,/youth=a<=21\?1\.5:a<=24\?1:a<=28\?0\.5:0\.15/);
assert.match(src,/FROZEN_AGE=33/);
assert.match(src,/Sem desconto de idade/);

const sw=fs.readFileSync(path.join(__dirname,'../public/sw.js'),'utf8');
assert.match(sw,/const V='zc-v71'/);
const mp=fs.readFileSync(path.join(__dirname,'../mp.js'),'utf8');
assert.match(mp,/migValuesNoAgeDisc1511/);
assert.match(mp,/recalc-values/);
const srv=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
assert.match(srv,/recalc-values/);
assert.match(srv,/e\.market_value=VAL\(e\)/);
const imp=fs.readFileSync(path.join(__dirname,'../import.js'),'utf8');
assert.match(imp,/recalc-values/);
console.log('ok: valor sem desconto de idade, base/potencial/trava/arredondamento iguais, <=30 inalterado');
