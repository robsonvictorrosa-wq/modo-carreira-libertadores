const assert=require('assert');
const fs=require('fs');const path=require('path');
const {NAME,UNTIL,PAUSE_MSG,marketWindow,canBidOvertime,shouldExtend}=require('../reopen-mid');

assert.strictEqual(NAME,'reopen-mid-unsold-2015');
assert.strictEqual(UNTIL,'2026-11-13 20:15:00-03');
assert.strictEqual(PAUSE_MSG,'Mercado fechado até o fim do leilão');

assert.deepStrictEqual(marketWindow({auction_open:true}),{open:false,auction:true,paused_for_auction:true,name:PAUSE_MSG});
assert.strictEqual(marketWindow({auction_open:false}).open,true);
assert.strictEqual(marketWindow({auction_open:false}).paused_for_auction,false);

assert.strictEqual(canBidOvertime({}).ok,true);
const no=canBidOvertime({alreadyWon:true,alreadyWonPlayer:'Bento'});
assert.strictEqual(no.ok,false);
assert.match(no.error,/já arrematou Bento/);
assert.match(no.error,/não levou ninguém/);

const t=Date.parse('2026-11-13T23:14:30Z');
assert.strictEqual(shouldExtend('2026-11-13T23:15:00Z',t),true);
assert.strictEqual(shouldExtend('2026-11-13T23:17:00Z',t),false);
assert.strictEqual(shouldExtend(null,t),false);

const extras=fs.readFileSync(path.join(__dirname,'../extras.js'),'utf8');
assert.match(extras,/closeMidOvertime/);
assert.match(extras,/now\(\)\+interval '60 seconds'/);
assert.match(extras,/closes_at IS NOT NULL AND closes_at>now\(\)/);

const mkt=fs.readFileSync(path.join(__dirname,'../market.js'),'utf8');
assert.match(mkt,/paused_for_auction/);
assert.match(mkt,/if\(win\.paused_for_auction\|\|win\.auction\)return/);
assert.match(mkt,/if\(room\.auction_open\)return/);

const ui=fs.readFileSync(path.join(__dirname,'../public/zc.js'),'utf8');
assert.match(ui,/Mercado fechado até o fim do leilão/);
assert.match(ui,/cal\.auction_open/);

const sw=fs.readFileSync(path.join(__dirname,'../public/sw.js'),'utf8');
assert.match(sw,/const V='zc-v51'/);

const mp=fs.readFileSync(path.join(__dirname,'../mp.js'),'utf8');
assert.match(mp,/migReopenMid2015/);

console.log('ok: overtime 20:15 + 60s, só quem não arrematou, mercado pausado sem expirar proposta');
