// Estatísticas do jogo por time + principais lances narrados, derivados da própria simulação (pstats/eventos/subs).
function rng(seed){let s=(seed>>>0)||1;return()=>{s^=s<<13;s>>>=0;s^=s>>17;s^=s<<5;s>>>=0;return s/4294967296;};}
const pois=(l,r)=>{let L=Math.exp(-l),k=0,p=1;do{k++;p*=r();}while(p>L);return k-1;};
function matchInfo(m,res,hn,an){const r=rng(m.id*2654435761+res.hg*97+res.ag*13);const ps=res.pstats||{};
 const side={home:res.lineups.home,away:res.lineups.away},name={},club={};
 for(const k of ['home','away'])for(const p of side[k]){name[p.id]=p.name;club[p.id]=k;}
 const isGK=p=>p.pos==='GK'||p.pos==='GOL';
 const sum=(k,f)=>side[k].reduce((a,p)=>a+((ps[p.id]||{})[f]||0),0);
 const st={};for(const k of ['home','away']){const o=k==='home'?'away':'home';
  const sh=sum(k,'sh'),sot=sum(k,'sot');const gko=side[o].filter(isGK);const sv=gko.reduce((a,p)=>a+((ps[p.id]||{}).svd||0)+((ps[p.id]||{}).svs||0),0);
  st[k]={sh,sot,saves:gko.reduce((a,p)=>a+((ps[p.id]||{}).svd||0)+((ps[p.id]||{}).svs||0),0)*0,pa:sum(k,'pa'),pac:sum(k,'pac'),fc:sum(k,'fc'),yc:sum(k,'yc'),rd:sum(k,'rd'),tk:sum(k,'tk'),
   corners:Math.max(0,Math.round(((sh-sot)*.35+sot*.25+pois(1.5,r))*((res.fx||{})[k]?.cor||1))),off:pois(1.8,r),_oppSv:sv};}
 // defesas = defesas do próprio goleiro (chutes no alvo do rival que não viraram gol)
 st.home.saves=st.away._oppSv;st.away.saves=st.home._oppSv;delete st.home._oppSv;delete st.away._oppSv;
 const tp=st.home.pa+st.away.pa||1;let pos=Math.round(50+(100*st.home.pa/tp-50)*1.8);pos=Math.max(25,Math.min(75,pos));
 st.home.pos=pos;st.away.pos=100-pos;
 for(const k of ['home','away'])st[k].acc=st[k].pa?Math.round(100*st[k].pac/st[k].pa):0;
 const T=k=>k==='home'?hn:an,pk=a=>a[Math.floor(r()*a.length)];const L=[];
 const minIn=id=>{const s=ps[id]||{};const i=(side[club[id]].find(p=>p.id===id)||{}).in||0;return Math.max(1,i+1+Math.floor(r()*Math.max(1,(s.min||90)-1)));};
 // gols
 let h=0,a=0;for(const e of (res.events||[])){const k=e.club===m.home?'home':'away';k==='home'?h++:a++;const pl=`${h}x${a}`;
  L.push({min:e.min,t:'gol',side:k,txt:e.kind==='pen'?pk([`PÊNALTI convertido! ${e.scorer_name}, o cobrador oficial, desloca o goleiro. ${pl}.`,`${e.scorer_name} vai pra bola na marca da cal e não perdoa. ${pl}.`]):e.kind==='fk'?pk([`GOLAÇO DE FALTA! ${e.scorer_name} bate por cima da barreira, no ângulo. ${pl}.`,`Cobrança perfeita de ${e.scorer_name}: falta direta pra dentro. ${pl}.`]):e.kind==='ck'?pk([`GOOOL de escanteio! ${e.assist_name} cobra na medida e ${e.scorer_name} sobe mais que todo mundo. ${pl}.`,`Bola parada funciona: ${e.assist_name} levanta e ${e.scorer_name} cabeceia firme. ${pl}.`]):e.og?pk([`Gol contra! ${e.scorer_name} tenta cortar e manda pro próprio patrimônio. ${pl}.`,`Que fase: ${e.scorer_name} desvia contra a própria meta. ${pl}.`]):
   e.assist_name?pk([`GOOOL do ${T(k)}! ${e.assist_name} serve e ${e.scorer_name} só empurra. ${pl}.`,`${e.scorer_name} recebe de ${e.assist_name} e bate firme no canto! ${pl}.`,`Jogada bonita: ${e.assist_name} acha ${e.scorer_name}, que não perdoa. ${pl}.`]):
   pk([`GOOOL! ${e.scorer_name} resolve sozinho e estufa a rede. ${pl}.`,`${e.scorer_name} arrisca de longe e acha o ângulo! ${pl}.`,`Bola sobrando na área e ${e.scorer_name} manda pra dentro. ${pl}.`])});}
 // defesas difíceis, pênalti defendido, chances perdidas
 for(const id in ps){const s=ps[id],k=club[id];if(!k)continue;const o=k==='home'?'away':'home';
  for(let i=0;i<Math.min(s.svd||0,2);i++)L.push({min:minIn(+id),t:'defesa',side:k,txt:pk([`Milagre! ${name[id]} voa no canto e salva o ${T(k)}.`,`${name[id]} espalma uma bomba à queima-roupa. Que defesa!`,`Cara a cara, e ${name[id]} fecha o gol. Paredão.`])});
  if(s.pks)L.push({min:minIn(+id),t:'defesa',side:k,txt:`Pênalti para o ${T(o)}… e ${name[id]} DEFENDE! Herói do jogo.`});
  if(s.pkm)L.push({min:minIn(+id),t:'chance',side:k,txt:`Pênalti para o ${T(k)}! ${name[id]} bate… e perde! Que vacilo.`});
  if((s.sh||0)-(s.sot||0)>=2&&r()<.6)L.push({min:minIn(+id),t:'chance',side:k,txt:pk([`${name[id]} tem a chance clara e isola por cima. Inacreditável.`,`Na cara do gol, ${name[id]} pega mal e manda pra fora.`,`${name[id]} acerta a trave! Quase.`])});
  if(s.yc)L.push({min:minIn(+id),t:'amarelo',side:k,txt:pk([`Amarelo para ${name[id]} após entrada atrasada.`,`${name[id]} reclama demais e leva o amarelo.`,`Falta tática de ${name[id]}: cartão amarelo.`])});
  if(s.rd)L.push({min:Math.max(1,(s.min||90)-1+((side[k].find(p=>p.id===+id)||{}).in||0)),t:'vermelho',side:k,txt:`VERMELHO! ${name[id]} é expulso e deixa o ${T(k)} com um a menos.`});}
 for(const k of ['home','away'])for(const s of (res.subs?.[k]||[]))L.push({min:s.min,t:'sub',side:k,txt:`Substituição no ${T(k)}: entra ${name[s.in]}, sai ${name[s.out]}.`});
 L.sort((x,y)=>x.min-y.min);
 L.unshift({min:0,t:'apito',side:null,txt:`Bola rolando: ${hn} x ${an}.`});
 L.push({min:90,t:'apito',side:null,txt:`Fim de jogo: ${hn} ${res.hg} x ${res.ag} ${an}.`+(res.hg===res.ag?' Empate e cada um com seu ponto.':` Vitória do ${res.hg>res.ag?hn:an}.`)});
 return {stats:st,lances:L};}
module.exports={matchInfo};
