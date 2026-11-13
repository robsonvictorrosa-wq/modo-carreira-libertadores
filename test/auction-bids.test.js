const assert=require('assert');
const fs=require('fs');
const path=require('path');
const {UNBID_ERR,canUnbid,canBid}=require('../auction-rules');

assert.strictEqual(canUnbid().ok,false);
assert.strictEqual(canUnbid().error,UNBID_ERR);
assert.match(UNBID_ERR,/não pode ser removido/i);

assert.deepStrictEqual(canBid({}),{ok:true});
assert.deepStrictEqual(canBid({sameLotLeader:false,otherLotLeader:false}),{ok:true});

const same=canBid({sameLotLeader:true,otherLotLeader:false});
assert.strictEqual(same.ok,false);
assert.match(same.error,/já tem o maior lance deste jogador/);

const other=canBid({sameLotLeader:false,otherLotLeader:true,otherPlayerName:'João'});
assert.strictEqual(other.ok,false);
assert.match(other.error,/já tem o maior lance pelo João/);
assert.match(other.error,/só dá pra dar lance em outro se for superado/);

// Depois que alguém cobre, otherLotLeader fica falso e o clube pode lançar de novo (no mesmo ou em outro lote).
const after=canBid({sameLotLeader:false,otherLotLeader:false,otherPlayerName:''});
assert.strictEqual(after.ok,true);

const src=fs.readFileSync(path.join(__dirname,'../extras.js'),'utf8');
assert.match(src,/throw fail\(AR\.UNBID_ERR\)/);
assert.doesNotMatch(src,/DELETE FROM auction_bids WHERE lot_id=\$1 AND club_id=\$2 RETURNING amount/);
assert.match(src,/const chk=AR\.canBid\(\{sameLotLeader:/);
assert.match(src,/if\(!chk\.ok\)throw fail\(chk\.error\)/);

const ui=fs.readFileSync(path.join(__dirname,'../public/zc.js'),'utf8');
assert.doesNotMatch(ui,/>Remover lance</);
assert.doesNotMatch(ui,/remover lance do clube/);
assert.doesNotMatch(ui,/você pode remover o seu lance/);
assert.match(ui,/O lance não pode ser removido/);
assert.match(ui,/zUnbid=async\(\)=>\{alert\('O lance não pode ser removido/);
assert.doesNotMatch(ui,/post\(R\(\)\+'\s*\/zc\/auction\/unbid'/);
assert.match(ui,/Liderando outro/);
assert.match(ui,/leading&&leading\.id!==l\.id/);

const sw=fs.readFileSync(path.join(__dirname,'../public/sw.js'),'utf8');
assert.match(sw,/const V='zc-v49'/);
assert.doesNotMatch(sw,/const V='zc-v48'/);

console.log('ok: unbid bloqueado; quem lidera não lança em outro lote; libera depois de ser coberto; UI e cache zc-v49');
