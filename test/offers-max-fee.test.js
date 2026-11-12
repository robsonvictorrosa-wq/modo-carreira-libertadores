const assert=require('assert');
const VAL=require('../value');
const CAP=p=>6*(+p.market_value||0);
// Espelha o trecho essencial de roster.merge + a rota /market/offers:
// override da sala entra, mas o valor é sempre recalculado com value.js (overall atual).
const merge=(p,o)=>{const e={...p};if(o)for(const k of ['overall','potential','age','market_value'])if(o[k]!=null&&!(['overall','potential','age'].includes(k)&&!(+o[k]>0)))e[k]=o[k];
 VAL.fix(e);e.market_value=VAL(e);return e;};
const base={id:1,name:'Teste',overall:75,potential:80,age:24};
VAL.fix(base);base.market_value=VAL(base);
const staleMax=CAP(base);
const cur=merge(base,{overall:76,market_value:base.market_value});
assert.strictEqual(base.market_value,8.4e6);
assert.strictEqual(staleMax,50.4e6);
assert.strictEqual(cur.overall,76);
assert.strictEqual(cur.market_value,10e6);
assert.strictEqual(CAP(cur),60e6);
assert.notStrictEqual(CAP(cur),staleMax);
const src=require('fs').readFileSync(require('path').join(__dirname,'../market.js'),'utf8');
assert.match(src,/max_fee:6\*\(\+p\?\.market_value\|\|0\)/);
assert.doesNotMatch(src,/max_fee:6\*\(\+R\.P\.get\(/);
assert.match(src,/const cur=id=>R\.merge\(R\.P\.get\(\+id\),om\.get\(\+id\)\)/);
console.log('ok: teto 6x usa valor atual (merge+value.js), não o snapshot R.P');
