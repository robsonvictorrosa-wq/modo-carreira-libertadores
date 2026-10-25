// Simula UMA temporada completa offline (sem banco de produção): node scripts/sim-temporada.js > out.json
const uni=require('better-sqlite3')(__dirname+'/../data/game.db',{readonly:true});
const S=require('../sim'),L=require('../libertadores'),E=require('../evolution'),VAL=require('../value'),CF=require('../config/libertadores.json');
L.loadClubs(uni);const R=require('../roster')(uni);const CL=L.CLUBS;
const ALT=new Map(uni.prepare('SELECT club_id,ord FROM lib_clubs').all().map(x=>[x.club_id,+(CF.clubs[x.ord]?.alt||0)]));
const name=id=>uni.prepare('SELECT name FROM lib_clubs WHERE club_id=?').get(id)?.name||'?';
const fakeDb={query:async()=>({rows:[]})};
(async()=>{
const SQ=new Map();for(const c of CL){let sq=await R.squad(fakeDb,0,c);if(sq.length<11)sq=[...sq,...L.virtualSquad(c)];SQ.set(c,sq);}
const P=new Map();for(const [c,sq] of SQ)for(const p of sq)P.set(p.id,{p,club:c,start:p.overall,acc:0,apps:0,rs:0,g:0,a:0});
const form=new Map(CL.map(c=>[c,[]]));
function play(m){const mk=c=>{const sq=SQ.get(c);const xi=S.autoXI(sq,'4-3-3');const f=form.get(c).slice(-5);return {club_id:c,xi,bench:sq.filter(p=>!xi.includes(p)),form:f.length?f.reduce((a,b)=>a+b,0):null,alt:ALT.get(c)};};
 const H=mk(m.home),A=mk(m.away);H.neutral=!!m.neutral;const res=S.playMatch(H,A);m.hg=res.hg;m.ag=res.ag;m.played=true;m.alt=res.altitude;
 form.get(m.home).push(res.hg>res.ag?3:res.hg===res.ag?1:0);form.get(m.away).push(res.ag>res.hg?3:res.hg===res.ag?1:0);
 for(const [p] of res.appeared){const x=P.get(p.id);if(!x)continue;const n=res.ratings[p.id];const media=x.apps?x.rs/x.apps:null;x.apps++;x.rs+=n;x.g+=res.goalsBy[p.id].g;x.a+=res.goalsBy[p.id].a;
  if(p.id>0&&!VAL.frozen(p)){x.acc+=E.gain(p,n,media);while(x.acc>=1){const v=VAL.capOverall(p,p.overall+1);if(v<=p.overall){x.acc=0;break;}p.overall=v;x.acc-=1;}}}
 return m;}
// fase de liga: todos contra todos (método do círculo)
const ms=[];let arr=[...CL];const n=arr.length;
for(let r=0;r<n-1;r++){for(let i=0;i<n/2;i++){let h=arr[i],a=arr[n-1-i];if(i===0?r%2:i%2)[h,a]=[a,h];ms.push(play({round:r+1,home:h,away:a,stage:'league'}));}arr=[arr[0],arr[n-1],...arr.slice(1,n-1)];}
const table=L.standings(ms,CL,name);const rank=new Map(table.map(t=>[t.club_id,t.pos]));
const plan=L.plan().filter(s=>s.stage!=='league');const ko=[];
for(const step of plan){const gs=L.koMatches(step,{rank,prev:ko});for(const g of gs){const m=play({...g,round:step.round});
 const decisive=m.stage==='playin'||m.leg===2||m.stage==='final';if(decisive){const legs=ko.filter(x=>x.stage===m.stage&&x.tie===m.tie);const t=L.decideTie([...legs,m],m);m.winner=t.winner;m.pens=t.pens;m.agg=legs.length?t.agg:null;}ko.push(m);}}
const champ=ko.find(m=>m.stage==='final').winner;
// altitude: aproveitamento em casa
const hs=c=>{const h=ms.filter(m=>m.home===c),a=ms.filter(m=>m.away===c);const pts=(l,s)=>l.reduce((t,m)=>{const f=s?m.hg:m.ag,g=s?m.ag:m.hg;return t+(f>g?3:f===g?1:0);},0);return {home:+(100*pts(h,1)/(3*h.length)).toFixed(1),away:+(100*pts(a,0)/(3*a.length)).toFixed(1)};};
const altClubs=CL.filter(c=>ALT.get(c)>1000).map(c=>({name:name(c),alt:ALT.get(c),...hs(c),pos:rank.get(c)}));
const all=CL.map(hs);if(all.some(x=>isNaN(x.home)))console.error("NaN",CL.filter((c,i)=>isNaN(all[i].home)).map(c=>[name(c),ms.filter(m=>m.home===c).length]));const avgHome=+(all.reduce((a,b)=>a+b.home,0)/40).toFixed(1),avgAway=+(all.reduce((a,b)=>a+b.away,0)/40).toFixed(1);
const altGames=ms.filter(m=>m.alt>0);const pf=l=>{let v=0,e=0,d=0;for(const m of l)m.hg>m.ag?v++:m.hg===m.ag?e++:d++;return {j:l.length,v,e,d,gm:+(l.reduce((a,m)=>a+m.hg,0)/l.length).toFixed(2),gs:+(l.reduce((a,m)=>a+m.ag,0)/l.length).toFixed(2)};};
const pl=[...P.values()].filter(x=>x.p.id>0).map(x=>({name:x.p.name,club:name(x.club),pos:x.p.primary_position,age:x.p.age,pot:x.p.potential,start:x.start,end:x.p.overall,gain:x.p.overall-x.start,apps:x.apps,avg:x.apps?+(x.rs/x.apps).toFixed(2):null,g:x.g,a:x.a}));
const dist={};for(const x of pl.filter(x=>x.apps>0))dist[x.gain]=(dist[x.gain]||0)+1;
console.log(JSON.stringify({table:table.map(t=>({pos:t.pos,name:t.name,j:t.j,v:t.v,e:t.e,d:t.d,gp:t.gp,gc:t.gc,sg:t.sg,pts:t.pts,zone:t.zone})),
 ko:ko.map(m=>({stage:m.stage,leg:m.leg,tie:m.tie,home:name(m.home),away:name(m.away),hg:m.hg,ag:m.ag,agg:m.agg,pens:m.pens,winner:m.winner?name(m.winner):null})),champ:name(champ),
 evoTop:[...pl].sort((a,b)=>b.gain-a.gain||b.avg-a.avg).slice(0,20),dist,evoN:pl.filter(x=>x.apps>0).length,
 evoEx:[...pl].filter(x=>x.apps>=25&&x.age<=23).sort(()=>Math.random()-.5).slice(0,12),
 ratings:pl.filter(x=>x.apps>=25).sort((a,b)=>b.avg-a.avg).slice(0,20),scorers:[...pl].sort((a,b)=>b.g-a.g).slice(0,15),assists:[...pl].sort((a,b)=>b.a-a.a).slice(0,15),
 alt:{clubs:altClubs,avgHome,avgAway,altGames:pf(altGames),others:pf(ms.filter(m=>!m.alt))}}));
})();
