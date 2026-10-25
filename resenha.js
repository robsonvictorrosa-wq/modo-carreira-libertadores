// Resenha Zero Clubismo: placar + 3 curiosidades + 1 zoeira leve, SÓ com dados da própria simulação.
const pick=(a,seed)=>a[Math.abs(seed)%a.length];
function resenha(m,res,ctx){const {hn,an,stage,agg,pens,rankH,rankA}=ctx;const seed=m.id*7+res.hg*13+res.ag*31;
 const ev=res.events||[];const nm={};[...res.lineups.home,...res.lineups.away].forEach(p=>nm[p.id]=p.name);
 const cur=[];const [xh,xa]=res.xg;
 const w=res.hg>res.ag?'h':res.hg<res.ag?'a':null;
 if(w&&((w==='h'&&xh<xa)||(w==='a'&&xa<xh)))cur.push(`O xG foi ${xh} x ${xa}: quem venceu criou menos. Eficiência pura (ou sorte, escolha seu lado).`);
 else cur.push(`Gols esperados (xG): ${xh} x ${xa}${w?' – o placar fez justiça ao volume.':'.'}`);
 if(ev.length){const f=ev[0];cur.push(`Primeiro gol aos ${f.min}', com ${f.scorer_name} (${f.club===m.home?hn:an}).`);}
 else cur.push('Nenhuma bola na rede: os goleiros foram os donos da festa.');
 const by={};ev.forEach(e=>by[e.scorer]=(by[e.scorer]||0)+1);const top=Object.entries(by).sort((a,b)=>b[1]-a[1])[0];
 if(top&&top[1]>=2)cur.push(`${nm[top[0]]||'Alguém'} fez ${top[1]===2?'dois':top[1]===3?'hat-trick':top[1]+' gols'} no jogo.`);
 const best=Object.entries(res.ratings||{}).sort((a,b)=>b[1]-a[1])[0];if(best)cur.push(`Melhor nota: ${nm[best[0]]||'?'} com ${best[1]}.`);
 const oa=x=>{const s=res.strength[x];return (s.GK+s.DEF+s.MID+s.ATT)/4;};const dif=oa('home')-oa('away');
 if(Math.abs(dif)>=4)cur.push(`Força média por setor: ${Math.round(oa('home'))} x ${Math.round(oa('away'))} – no papel, ${dif>0?hn:an} era favorito.`);
 if(rankH&&rankA)cur.push(`Na tabela antes do jogo: ${hn} em ${rankH}º, ${an} em ${rankA}º.`);
 // vira-vira
 let sH=0,sA=0,led=null,virada=false;for(const e of ev){e.club===m.home?sH++:sA++;const l=sH>sA?'h':sA>sH?'a':null;if(l&&led&&l!==led)virada=true;if(l)led=l;}
 if(virada)cur.unshift('Teve virada! Quem saiu na frente não segurou.');
 if(agg)cur.unshift(`Agregado: ${agg[0]} x ${agg[1]}${pens?` – decidido nos pênaltis (${pens})`:''}.`);
 else if(pens)cur.unshift(`Empate no tempo normal, pênaltis ${pens}.`);
 const curios=cur.slice(0,3);
 const zebra=w&&((w==='h'&&dif<=-4)||(w==='a'&&dif>=4));const tot=res.hg+res.ag,gap=Math.abs(res.hg-res.ag);
 const J=zebra?['Zebra solta no gramado! Planilha nenhuma previa essa.','O favorito entrou de salto alto e saiu de chinelo.']:
  gap>=3?['Goleada: o goleiro do perdedor vai precisar de terapia e de um abraço.','Placar de pelada de fim de semana, e ninguém reclamou do juiz.']:
  tot===0?['0 x 0: jogo pra quem curte tática. Ou pra quem curte um cochilo.','Os atacantes esqueceram a chuteira no ônibus.']:
  !w?['Empate com gols: cada torcida volta pra casa achando que foi roubada. Zero clubismo: foi justo.','Dividiram os pontos como amigo divide a conta do bar.']:
  pens?['Pênaltis: loteria com ingresso caro.']:
  ['Vitória do mais competente do dia – amanhã a zoeira troca de lado.','Três pontos na conta e a resenha garantida no grupo.'];
 return {placar:`${hn} ${res.hg} x ${res.ag} ${an}`,stage,curiosidades:curios,zoeira:pick(J,seed)};}
module.exports={resenha};
