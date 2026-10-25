// Teste em massa das formações/táticas (offline, sem banco): node scripts/sim-taticas.js
const uni=require('better-sqlite3')(__dirname+'/../data/game.db',{readonly:true});
const S=require('../sim'),L=require('../libertadores'),TT=require('../tactics');L.loadClubs(uni);const R=require('../roster')(uni);
const name=id=>uni.prepare('SELECT name FROM lib_clubs WHERE club_id=?').get(id)?.name||'?';const fakeDb={query:async()=>({rows:[]})};
(async()=>{const SQ=new Map();for(const c of L.CLUBS){let sq=await R.squad(fakeDb,0,c);if(sq.length<11)sq=[...sq,...L.virtualSquad(c)];SQ.set(c,sq);}
 const avg=c=>{const x=TT.autoXI(SQ.get(c),'4-3-3');return x.reduce((s,p)=>s+p.overall,0)/11;};const ord=[...L.CLUBS].sort((a,b)=>avg(b)-avg(a));
 const strong=ord[0],mid=ord[Math.floor(ord.length/2)],weak=ord[ord.length-1];
 const N=+process.argv[2]||4000;
 function run(h,a,th,ta,fh='4-3-3',fa='4-3-3',xh,xa){let w=0,d=0,l=0,g=0,c=0,pos=0,sh=0,fc=0,co=0;const MI=require('../matchinfo');
  for(let i=0;i<N;i++){const H={club_id:h,xi:xh||TT.autoXI(SQ.get(h),fh),formation:fh,tactics:th,slotted:!!xh},A={club_id:a,xi:xa||TT.autoXI(SQ.get(a),fa),formation:fa,tactics:ta,slotted:!!xa};H.neutral=true;
   const r=S.playMatch(H,A);if(r.hg>r.ag)w++;else if(r.hg===r.ag)d++;else l++;g+=r.hg;c+=r.ag;if(i<600){const m=MI.matchInfo({id:i+1},r,'H','A');pos+=m.stats.home.pos??m.stats.pos?.[0]??0;sh+=m.stats.home.sh;fc+=m.stats.home.fc;co+=m.stats.home.corners;}}
  const k=Math.min(N,600);return {V:(100*w/N).toFixed(1),E:(100*d/N).toFixed(1),D:(100*l/N).toFixed(1),GP:(g/N).toFixed(2),GC:(c/N).toFixed(2),posse:(pos/k).toFixed(0),chutes:(sh/k).toFixed(1),faltas:(fc/k).toFixed(1),esc:(co/k).toFixed(1)};}
 const E=TT.DEF_TAC,t=o=>({...E,...o});const out=[];const row=(nm,r)=>{out.push(nm.padEnd(46)+Object.entries(r).map(([k,v])=>k+' '+v).join(' | '));};
 console.log(`Forte: ${name(strong)} (${avg(strong).toFixed(1)}) · Médio: ${name(mid)} (${avg(mid).toFixed(1)}) · Fraco: ${name(weak)} (${avg(weak).toFixed(1)}) · ${N} jogos por linha, campo neutro\n`);
 const H=mid,A=mid===ord[1]?ord[2]:ord[Math.floor(ord.length/2)+1];console.log(`== ${name(H)} x ${name(A)} (médio x médio), rival Equilibrado padrão ==`);
 row('Padrão x Padrão',run(H,A,E,E));
 for(const m of ['retranca','defensivo','ofensivo','todos'])row('Mentalidade '+TT.TAC.m[m][0],run(H,A,t({m}),E));
 for(const d of ['retranca','linha'])row('Defesa '+TT.TAC.d[d][0],run(H,A,t({d}),E));
 for(const mi of ['infiltracoes','pressao'])row('Meio '+TT.TAC.mi[mi][0],run(H,A,t({mi}),E));
 for(const a of ['contra','laterais','longa','chute'])row('Ataque '+TT.TAC.a[a][0],run(H,A,t({a}),E));
 console.log(out.splice(0).join('\n'));console.log('\n== Interações (pedra-papel-tesoura) ==');
 row('Contra-ataque x Linha no meio',run(H,A,t({a:'contra'}),t({d:'linha'})));row('Posse x Linha no meio',run(H,A,t({a:'posse'}),t({d:'linha'})));
 row('Bola longa x Linha no meio',run(H,A,t({a:'longa'}),t({d:'linha'})));row('Posse x Retranca',run(H,A,t({a:'posse'}),t({m:'retranca',d:'retranca'})));
 row('Laterais x Retranca',run(H,A,t({a:'laterais'}),t({m:'retranca',d:'retranca'})));row('Contra-ataque x Todos no ataque',run(H,A,t({a:'contra',m:'defensivo'}),t({m:'todos'})));
 console.log(out.splice(0).join('\n'));console.log(`\n== Forte x Fraco: ${name(strong)} x ${name(weak)} ==`);
 row('Padrão x Padrão',run(strong,weak,E,E));row('Forte padrão x Fraco Retranca+Contra',run(strong,weak,E,t({m:'retranca',d:'retranca',a:'contra'})));
 row('Forte Todos no ataque x Fraco Retranca+Contra',run(strong,weak,t({m:'todos'}),t({m:'retranca',d:'retranca',a:'contra'})));row('Forte padrão x Fraco Todos no ataque',run(strong,weak,E,t({m:'todos'})));
 console.log(out.splice(0).join('\n'));console.log(`\n== Formação / fora de posição (${name(H)}) ==`);
 for(const f of ['4-3-3','4-4-2','4-2-3-1','3-5-2','5-3-2','4-4-2 losango','3-4-3'])row('Formação '+f,run(H,A,E,E,f));
 const xi=TT.autoXI(SQ.get(H),'4-3-3');const bad=[...xi].reverse();row('4-3-3 com todos fora de posição',run(H,A,E,E,'4-3-3','4-3-3',bad));
 console.log(out.splice(0).join('\n'));})();
