const assert=require('assert');
const fs=require('fs');
const path=require('path');
const S=require('../sim');
const TT=require('../tactics');

function p(id,pos,ovr,stats,base){
  return {id,name:'P'+id,primary_position:pos,positions:[pos],overall:ovr,base_overall:base!=null?base:ovr,stats:{...stats}};
}
const st={defense:70,physical:72,pace:68,shooting:60,passing:74,dribbling:70,gk_diving:40,gk_handling:40,gk_reflexes:40,gk_positioning:40};
const gkSt={...st,defense:20,gk_diving:78,gk_handling:76,gk_reflexes:80,gk_positioning:78};
const xi=[
  p(1,'GOL',78,gkSt),
  p(2,'LE',73,st),p(3,'ZAG',74,st),p(4,'ZAG',73,st),p(5,'LD',72,st),
  p(6,'MC',74,{...st,passing:78,dribbling:72,defense:68}),
  p(7,'VOL',73,{...st,passing:70,dribbling:65,defense:78}),
  p(8,'MC',75,{...st,passing:80,dribbling:74,defense:66}),
  p(9,'PE',76,{...st,shooting:74,pace:82,dribbling:80}),
  p(10,'ATA',77,{...st,shooting:82,pace:76,dribbling:74}),
  p(11,'PD',75,{...st,shooting:76,pace:80,dribbling:78})
];

const s0=S.strength(xi);
assert.ok(s0.GK>70&&s0.DEF>60&&s0.MID>60&&s0.ATT>60,'força inicial razoável');

// Evolução: overall sobe, atributos originais ficam iguais.
const ev=xi.map(x=>({...x,overall:x.overall+3,stats:{...x.stats}}));
const sEng=S.strength(ev);
assert.strictEqual(+sEng.GK.toFixed(4),+s0.GK.toFixed(4),'motor: GK ignora overall evoluído');
assert.strictEqual(+sEng.DEF.toFixed(4),+s0.DEF.toFixed(4),'motor: DEF ignora overall evoluído');
assert.strictEqual(+sEng.ATT.toFixed(4),+s0.ATT.toFixed(4),'motor: ATT ignora overall evoluído');
assert.ok(sEng.MID>s0.MID,'motor: MID sobe um pouco (25% overall)');

const sLive=S.strengthLive(ev);
assert.ok(sLive.GK>s0.GK+1,'live: GK acompanha overall');
assert.ok(sLive.DEF>s0.DEF+1,'live: DEF acompanha overall');
assert.ok(sLive.ATT>s0.ATT+1,'live: ATT acompanha overall');
assert.ok(sLive.MID>sEng.MID,'live: MID sobe além do 25% do motor');

// Sem evolução, live === motor
const sSame=S.strengthLive(xi);
assert.strictEqual(+sSame.GK.toFixed(4),+s0.GK.toFixed(4));
assert.strictEqual(+sSame.DEF.toFixed(4),+s0.DEF.toFixed(4));
assert.strictEqual(+sSame.MID.toFixed(4),+s0.MID.toFixed(4));
assert.strictEqual(+sSame.ATT.toFixed(4),+s0.ATT.toFixed(4));

// alignStats respeita teto 99
const cap=S.alignStats({overall:99,base_overall:50,stats:{shooting:80,defense:90}});
assert.strictEqual(cap.stats.shooting,99);
assert.strictEqual(cap.stats.defense,99);

// playMatch continua usando strength() (não strengthLive): valores iguais aos do motor com atributos crus
const H={club_id:1,xi,formation:'4-3-3',tactics:TT.DEF_TAC,form:null};
const A={club_id:2,xi:ev,formation:'4-3-3',tactics:TT.DEF_TAC,form:null};
const res=S.playMatch(H,A,()=>0.4);
const luH=TT.lineup(H.xi,'4-3-3',true);
const expH=S.applyShape(S.strength(luH.map(z=>TT.effective(z.p,z.slot))),'4-3-3');
assert.strictEqual(+res.strength.home.GK.toFixed(4),+expH.GK.toFixed(4),'playMatch usa strength, não strengthLive (casa)');
assert.strictEqual(+res.strength.home.DEF.toFixed(4),+expH.DEF.toFixed(4));
const luA=TT.lineup(A.xi,'4-3-3',true);
const expAeng=S.applyShape(S.strength(luA.map(z=>TT.effective(z.p,z.slot))),'4-3-3');
const expAlive=S.applyShape(S.strengthLive(luA.map(z=>TT.effective(z.p,z.slot))),'4-3-3');
assert.strictEqual(+res.strength.away.GK.toFixed(4),+expAeng.GK.toFixed(4),'playMatch visitante = motor cru');
assert.ok(Math.abs(res.strength.away.GK-expAlive.GK)>0.5,'playMatch não usa força alinhada ao overall');

// Fonte: playMatch chama strength, não strengthLive
const src=fs.readFileSync(path.join(__dirname,'../sim.js'),'utf8');
const play=src.slice(src.indexOf('function playMatch'),src.indexOf('function schedule'));
assert.match(play,/const s=strength\(/);
assert.doesNotMatch(play,/strengthLive/);

// API de jogo futuro calcula live; jogo jogado mantém details.strength
const season=fs.readFileSync(path.join(__dirname,'../season.js'),'utf8');
assert.match(season,/if\(!m\.played\)[\s\S]*strengthLive/);
assert.match(season,/details=\{[\s\S]*strength:res\.strength/);
assert.match(season,/strength:S\.strengthLive\(/);

const ui=fs.readFileSync(path.join(__dirname,'../public/season.js'),'utf8');
assert.match(ui,/setorLinha=\(st,lab\)/);
assert.match(ui,/if\(!m\.played\)/);
assert.match(ui,/setorLinha\(d\.strength,'neste jogo'\)/);
assert.match(ui,/setorLinha\(d\.strength\|\|m\.strength,'elenco atual'\)/);

const sw=fs.readFileSync(path.join(__dirname,'../public/sw.js'),'utf8');
assert.match(sw,/const V='zc-v73'/);
console.log('ok: força por setor live vs motor');
