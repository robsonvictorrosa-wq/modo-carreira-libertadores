const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const src=fs.readFileSync(path.join(__dirname,'../public/season.js'),'utf8');
const start=src.indexOf('function notaShown');
const end=src.indexOf('window.notaJ');
assert.ok(start>=0&&end>start,'helpers de nota em public/season.js');
const ctx={};
vm.runInNewContext(src.slice(start,end),ctx);
const {notaShown,notaC,notaInk,notaB}=ctx;
assert.equal(typeof notaShown,'function');
assert.equal(typeof notaC,'function');
assert.equal(typeof notaInk,'function');
assert.equal(typeof notaB,'function');

const RED='#C62828',YEL='#F5C400',GRN='#8BC34A',DGR='#1B7A3A',BLU='#1565C0';

function check(v,shown,bg,ink,label){
  const tag=label||String(v);
  assert.strictEqual(notaShown(v),shown,'shown '+tag);
  assert.strictEqual(notaC(v),bg,'bg '+tag);
  assert.strictEqual(notaInk(v),ink,'ink '+tag);
  if(shown==null){
    assert.strictEqual(notaB(v),'<b></b>','badge vazio '+tag);
    return;
  }
  const txt=shown.toFixed(1);
  const html=notaB(v);
  assert.ok(html.includes('>'+txt+'<'),`exibe ${txt} em ${tag}: ${html}`);
  assert.ok(html.includes('background:'+bg),`fundo ${bg} em ${tag}`);
  assert.ok(html.includes('color:'+ink),`texto ${ink} em ${tag}`);
}

check(null,null,'#8A8A8A','#fff','null');
check('',null,'#8A8A8A','#fff','empty');
check(5,5.0,RED,'#fff');
check(5.9,5.9,RED,'#fff');
check(5.94,5.9,RED,'#fff','5.94→5.9');
check(5.95,6.0,YEL,'#000','5.95→6.0');
check(6,6.0,YEL,'#000');
check(6.0,6.0,YEL,'#000');
check(6.5,6.5,YEL,'#000');
check(6.9,6.9,YEL,'#000');
check(6.94,6.9,YEL,'#000','6.94→6.9');
check(6.95,7.0,GRN,'#000','6.95→7.0');
check(7,7.0,GRN,'#000');
check(7.4,7.4,GRN,'#000');
check(7.9,7.9,GRN,'#000');
check(7.94,7.9,GRN,'#000','7.94→7.9');
check(7.95,8.0,DGR,'#fff','7.95→8.0');
check(8,8.0,DGR,'#fff');
check(8.3,8.3,DGR,'#fff');
check(8.9,8.9,DGR,'#fff');
check(8.94,8.9,DGR,'#fff','8.94→8.9');
check(8.95,9.0,BLU,'#fff','8.95→9.0');
check(9,9.0,BLU,'#fff');
check(9.5,9.5,BLU,'#fff');
check(10,10.0,BLU,'#fff');

// a função só formata a exibição; não altera o valor original
const o={n:5.95};
assert.match(notaB(o.n),/>6\.0</);
assert.strictEqual(o.n,5.95);

console.log('ok: cores das notas pelas faixas da nota exibida (1 casa), inclusive 5.95→6.0');
