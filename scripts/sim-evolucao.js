// Simula a distribuição de ganhos de over (node scripts/sim-evolucao.js)
const E=require('../evolution'),VAL=require('../value');
function run(p0,avg,games,N=4000){const out=[];for(let k=0;k<N;k++){const p={...p0};let acc=0,sum=0;
 for(let g=1;g<=games;g++){const n=Math.max(3,Math.min(10,avg+(Math.random()+Math.random()+Math.random()-1.5)*1.2));const media=g>1?sum/(g-1):null;sum+=n;
  acc+=E.gain(p,n,media);while(acc>=1){const v=VAL.capOverall(p,p.overall+1);if(v<=p.overall){acc=0;break;}p.overall=v;acc-=1;}}out.push(p.overall-p0.overall);}
 out.sort((a,b)=>a-b);const m=out.reduce((a,b)=>a+b,0)/N;return `média +${m.toFixed(1)} (p10 +${out[N*0.1|0]}, p90 +${out[N*0.9|0]}, máx +${out[N-1]})`;}
const prof=[[73,21,83],[70,19,85],[75,24,82],[78,27,82],[80,30,82],[82,33,84]];
for(const [o,a,pt] of prof){console.log(`\nOVR ${o}, ${a} anos, pot ${pt}`);for(const avg of [6.0,6.5,7.0,7.5,8.0])console.log(`  média ${avg}: 20 jogos ${run({overall:o,age:a,potential:pt},avg,20)} | 39 jogos ${run({overall:o,age:a,potential:pt},avg,39)}`);}
