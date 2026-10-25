const assert=require('assert');const {leagueSchedule}=require('../leaguesched');
for(let t=0;t<20;t++){const clubs=Array.from({length:40},(_,i)=>1000+i*7);const avg=new Map(clubs.map(c=>[c,60+Math.random()*25]));
 const R=leagueSchedule(clubs,avg,t+1);assert.strictEqual(R.length,39);
 const rank=[...clubs].sort((a,b)=>avg.get(b)-avg.get(a));const top=new Set(rank.slice(0,20));
 const H=new Map(clubs.map(c=>[c,0])),A=new Map(clubs.map(c=>[c,0])),seq=new Map(clubs.map(c=>[c,''])),pairs=new Set();
 for(const g of R){assert.strictEqual(g.length,20);const seen=new Set();for(const [h,a]of g){assert(!seen.has(h)&&!seen.has(a));seen.add(h);seen.add(a);H.set(h,H.get(h)+1);A.set(a,A.get(a)+1);seq.set(h,seq.get(h)+'H');seq.set(a,seq.get(a)+'A');const k=[h,a].sort().join();assert(!pairs.has(k));pairs.add(k);}}
 assert.strictEqual(pairs.size,780);
 for(const c of clubs){if(top.has(c)){assert.strictEqual(H.get(c),19);assert.strictEqual(A.get(c),20);}else{assert.strictEqual(H.get(c),20);assert.strictEqual(A.get(c),19);}
  assert(!/HHH|AAA/.test(seq.get(c)),'sequência longa '+seq.get(c));}}
console.log('ok: 40 clubes, top-20 19C/20F, demais 20C/19F, máx 2 seguidas');
