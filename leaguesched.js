// Calendário da fase de liga (turno único, todos x todos). Regra ZC: os 20 clubes de maior média de over
// (18 maiores overs) jogam 19 em casa e 20 fora; os outros 20 jogam 20 em casa e 19 fora.
// Método de Berger (círculo) com mando alternado: mínimo de quebras (nunca 3 seguidas casa/fora).
function berger(n){const m=n-1,R=[];
  for(let r=0;r<m;r++){const g=[];g.push(r%2?[r,m]:[m,r]);
    for(let k=1;k<n/2;k++){const a=(r+k)%m,b=(r-k+m)%m;g.push(k%2?[b,a]:[a,b]);}R.push(g);}return R;}
function homeCounts(R,n){const h=Array(n).fill(0);for(const g of R)for(const [a]of g)h[a]++;return h;}
// clubs: ids; strength: Map id->média. Retorna rounds [[ [home,away],... ], ...]
function leagueSchedule(clubs,strength,seed=Date.now()){const n=clubs.length;if(n%2)throw new Error('n par');
  let R=berger(n);let h=homeCounts(R,n);const half=n/2;
  // ajusta se o número de slots "19 em casa" não for exatamente n/2 (garantia)
  const few=h.map((x,i)=>[x,i]).filter(([x])=>x<half).length;if(few!==half)throw new Error('berger inesperado');
  const rnd=(()=>{let s=seed>>>0||1;return()=>((s=(s*1664525+1013904223)>>>0)/2**32);})();
  const sh=a=>{a=[...a];for(let i=a.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
  const ranked=[...clubs].sort((a,b)=>(strength.get(b)||0)-(strength.get(a)||0)||a-b);
  const strong=sh(ranked.slice(0,half)),weak=sh(ranked.slice(half));
  const map=Array(n);let si=0,wi=0;h.forEach((x,i)=>{map[i]=x<half?strong[si++]:weak[wi++];});
  const out=R.map(g=>g.map(([a,b])=>[map[a],map[b]]));const seq=new Map();for(const g of out)for(const [a,b]of g){seq.set(a,(seq.get(a)||'')+'H');seq.set(b,(seq.get(b)||'')+'A');}
  for(const [c,q]of seq){if(/HHH|AAA/.test(q))throw new Error('3 seguidos: '+c);const hc=q.split('H').length-1;if(hc!==(strong.includes(c)?half-1:half))throw new Error('mando errado: '+c);}
  return out;}
module.exports={leagueSchedule,berger};
