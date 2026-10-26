// Gera atributos (mesmo formato do FC27) para jogadores da liga sem stats: perfil médio de jogadores FC27
// da mesma posição e overall próximo (desvio em relação ao overall) + variação determinística por jogador.
module.exports=db=>{
 const empty="(p.stats IS NULL OR p.stats='' OR p.stats='{}')";
 const tgt=db.prepare(`SELECT p.id,p.overall,p.primary_position pos FROM players p JOIN lib_clubs l ON l.club_id=p.club_id WHERE ${empty}`).all();
 const donors=db.prepare(`SELECT overall,primary_position pos,stats FROM players p WHERE NOT ${empty} AND overall BETWEEN 50 AND 92`).all().map(d=>({...d,s:JSON.parse(d.stats)}));
 const byPos={};for(const d of donors)(byPos[d.pos]||=[]).push(d);
 const upd=db.prepare('UPDATE players SET stats=? WHERE id=?');let n=0;
 for(const t of tgt){const pool=(byPos[t.pos]||donors).slice().sort((a,b)=>Math.abs(a.overall-t.overall)-Math.abs(b.overall-t.overall)).slice(0,25);if(!pool.length)continue;
  const keys=Object.keys(pool[0].s);let seed=t.id%2147483647||1;const rnd=()=>(seed=seed*16807%2147483647)/2147483647;const out={};
  for(const k of keys){if(k==='total')continue;const off=pool.reduce((a,d)=>a+((+d.s[k]||0)-d.overall),0)/pool.length;
   const noise=k.startsWith('gk_')&&t.pos!=='GOL'?Math.round((rnd()-.5)*6):Math.round((rnd()-.5)*6);out[k]=Math.max(1,Math.min(99,Math.round(t.overall+off+noise)));}
  if('total' in pool[0].s)out.total=Math.round(pool.reduce((a,d)=>a+(+d.s.total||0)/Math.max(1,d.overall),0)/pool.length*t.overall);
  upd.run(JSON.stringify(out),t.id);n++;}
 console.log('Atributos gerados:',n);};
