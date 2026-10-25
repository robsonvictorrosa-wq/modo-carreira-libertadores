// Formações, posições no campo, encaixe de posição e táticas de jogo (mentalidade + defesa + meio + ataque).
// Efeitos moderados: mexem em chances criadas/sofridas, posse, volume/precisão de finalização, escanteios, faltas e cansaço.
const XY={GOL:[50,5],ZAG:[50,20],LD:[86,26],LE:[14,26],ADD:[86,40],ADE:[14,40],VOL:[50,38],MC:[50,52],MD:[84,56],ME:[16,56],MEI:[50,68],PD:[82,78],PE:[18,78],SA:[50,80],ATA:[50,88]};
const SEC={GOL:'GK',ZAG:'DEF',LD:'DEF',LE:'DEF',ADD:'DEF',ADE:'DEF',VOL:'MID',MC:'MID',MEI:'MID',MD:'MID',ME:'MID',PD:'ATT',PE:'ATT',SA:'ATT',ATA:'ATT'};
// cada vaga: [posição, x, y] (x 0-100 da esquerda p/ direita, y 0-100 do próprio gol ao ataque)
const D4=[['LE',12,26],['ZAG',36,20],['ZAG',64,20],['LD',88,26]],D3=[['ZAG',25,20],['ZAG',50,18],['ZAG',75,20]],D5=[['LE',8,30],['ZAG',30,19],['ZAG',50,17],['ZAG',70,19],['LD',92,30]];
const F={
 '4-3-3':[...D4,['MC',28,50],['VOL',50,42],['MC',72,50],['PE',18,78],['ATA',50,86],['PD',82,78]],
 '4-3-3 (2 vol e 1 mei)':[...D4,['VOL',34,42],['VOL',66,42],['MEI',50,62],['PE',18,80],['ATA',50,87],['PD',82,80]],
 '4-4-2':[...D4,['ME',12,54],['MC',38,48],['MC',62,48],['MD',88,54],['ATA',36,84],['ATA',64,84]],
 '4-4-2 losango':[...D4,['VOL',50,40],['MC',28,52],['MC',72,52],['MEI',50,65],['ATA',36,85],['ATA',64,85]],
 '4-5-1':[...D4,['ME',12,58],['MC',32,48],['VOL',50,42],['MC',68,48],['MD',88,58],['ATA',50,86]],
 '4-1-4-1':[...D4,['VOL',50,38],['ME',12,58],['MC',36,54],['MC',64,54],['MD',88,58],['ATA',50,86]],
 '4-2-3-1':[...D4,['VOL',36,42],['VOL',64,42],['PE',16,68],['MEI',50,64],['PD',84,68],['ATA',50,87]],
 '4-2-2-2':[...D4,['VOL',36,42],['VOL',64,42],['MEI',24,64],['MEI',76,64],['ATA',36,86],['ATA',64,86]],
 '4-3-1-2':[...D4,['MC',28,48],['VOL',50,42],['MC',72,48],['MEI',50,64],['ATA',36,86],['ATA',64,86]],
 '5-3-2':[...D5,['MC',28,50],['VOL',50,44],['MC',72,50],['ATA',36,84],['ATA',64,84]],
 '5-4-1':[...D5,['ME',12,58],['MC',38,50],['MC',62,50],['MD',88,58],['ATA',50,85]],
 '3-4-1-2':[...D3,['ME',10,52],['VOL',38,44],['VOL',62,44],['MD',90,52],['MEI',50,66],['ATA',36,86],['ATA',64,86]],
 '3-4-3':[...D3,['ME',10,52],['MC',38,48],['MC',62,48],['MD',90,52],['PE',18,80],['ATA',50,87],['PD',82,80]],
 '3-5-2':[...D3,['ME',10,54],['VOL',36,42],['MEI',50,60],['VOL',64,42],['MD',90,54],['ATA',36,85],['ATA',64,85]]};
const FORMS={};for(const k in F)FORMS[k]=[['GOL',50,5],...F[k]];
const ALIAS={'4-5-1':'4-5-1'};
const counts=f=>{const c={DEF:0,MID:0,ATT:0};for(const [p] of FORMS[f]||[])if(SEC[p]!=='GK')c[SEC[p]]++;return c;};
const FORMATIONS={};for(const k in FORMS)FORMATIONS[k]=counts(k);
// encaixe 0.45..1 de um jogador numa vaga
function fit1(pp,slot){if(!pp)return .8;if(pp===slot)return 1;if((pp==='GOL')!==(slot==='GOL'))return .45;
 if(slot==='VOL'&&pp==='MC')return 1;if((slot==='ADD'&&pp==='LD')||(slot==='ADE'&&pp==='LE')||(slot==='LD'&&pp==='ADD')||(slot==='LE'&&pp==='ADE'))return .99;
 const a=XY[pp]||[50,50],b=XY[slot]||[50,50];const d=Math.hypot(a[0]-b[0],a[1]-b[1]);return Math.max(.7,1-d*.0042);}
function fit(p,slot){let f=fit1(p.primary_position,slot);for(const q of (p.positions||[]))if(q!==p.primary_position)f=Math.max(f,fit1(q,slot)-.02);return f;}
const val=(p,slot)=>(p.overall||50)*fit(p,slot);
// distribui 11 jogadores nas vagas (guloso pela melhor combinação)
function assign(xi,formation){const sl=FORMS[formation]||FORMS['4-3-3'];const pairs=[];sl.forEach((s,i)=>xi.forEach(p=>pairs.push([fit(p,s[0]),p.overall||50,i,p])));
 pairs.sort((a,b)=>b[0]-a[0]||b[1]-a[1]);const out=new Array(sl.length).fill(null),used=new Set();
 for(const [,,i,p] of pairs){if(out[i]||used.has(p))continue;out[i]=p;used.add(p);}
 // melhora local: troca pares de vagas enquanto a soma de OVR×encaixe subir
 const v=(p,i)=>p?(p.overall||50)*fit(p,sl[i][0]):0;for(let it=0,ch=true;ch&&it<20;it++){ch=false;for(let a=0;a<out.length;a++)for(let b=a+1;b<out.length;b++){if(v(out[b],a)+v(out[a],b)>v(out[a],a)+v(out[b],b)+1e-9){const t=out[a];out[a]=out[b];out[b]=t;ch=true;}}}
 return out;}
// escolhe os 11 do elenco para a formação: cada vaga recebe o melhor OVR×encaixe disponível (vagas mais raras primeiro)
function autoXI(squad,formation='4-3-3'){const sl=FORMS[formation]||FORMS['4-3-3'];const pool=squad.filter(p=>p.overall);const used=new Set(),out=new Array(sl.length).fill(null);
 const order=sl.map((s,i)=>i).sort((a,b)=>(sl[a][0]==='GOL'?-1:0)-(sl[b][0]==='GOL'?-1:0)||pool.filter(p=>fit(p,sl[a][0])>=.97).length-pool.filter(p=>fit(p,sl[b][0])>=.97).length);
 for(const i of order){let best=null,bv=-1;for(const p of pool){if(used.has(p))continue;const v=val(p,sl[i][0]);if(v>bv){bv=v;best=p;}}if(best){out[i]=best;used.add(best);}}
 // melhora local: troca entre vagas e com o banco enquanto o total subir
 const V=(p,i)=>p?val(p,sl[i][0]):0;for(let it=0,ch=true;ch&&it<20;it++){ch=false;
  for(let a=0;a<out.length;a++){for(let b=a+1;b<out.length;b++)if(V(out[b],a)+V(out[a],b)>V(out[a],a)+V(out[b],b)+1e-9){const t=out[a];out[a]=out[b];out[b]=t;ch=true;}
   for(const p of pool)if(!used.has(p)&&V(p,a)>V(out[a],a)+1e-9){used.delete(out[a]);out[a]=p;used.add(p);ch=true;}
   for(let b=0;b<out.length;b++)if(b!==a)for(const p of pool)if(!used.has(p)&&V(p,b)+V(out[b],a)>V(out[a],a)+V(out[b],b)+1e-9){used.delete(out[a]);out[a]=out[b];out[b]=p;used.add(p);ch=true;}}}
 return out.filter(Boolean);}
// jogador "efetivo" na vaga: rende OVR×encaixe e passa a contar no setor da vaga
function effective(p,slot){const f=fit(p,slot);if(f>=.999&&p.primary_position===slot)return p;const m=1-(1-f)*.55;const st={};for(const k in (p.stats||{}))st[k]=Math.round(p.stats[k]*m);
 return {...p,primary_position:slot,overall:Math.round((p.overall||50)*m),stats:p.stats?st:undefined,_fit:f,_orig:p};}
function lineup(xi,formation,slotted){const sl=FORMS[formation]||FORMS['4-3-3'];const ord=slotted&&xi.length===sl.length?xi:assign(xi,formation);
 return ord.map((p,i)=>p?{p,slot:sl[i][0],x:sl[i][1],y:sl[i][2],fit:fit(p,sl[i][0])}:null).filter(Boolean);}
// indicador por setor: média do encaixe
function sectorFit(lu){const o={};for(const k of ['DEF','MID','ATT']){const a=lu.filter(x=>SEC[x.slot]===k);o[k]=a.length?a.reduce((s,x)=>s+x.fit,0)/a.length:1;}return o;}
// ---------- TÁTICAS ----------
const TAC={
 m:{retranca:['Retranca','Prioridade máxima à proteção. Reduz bastante as oportunidades dos dois lados.'],defensivo:['Defensivo','Avança com cautela e oferece menos oportunidades ao adversário.'],equilibrado:['Equilibrado','Mantém o risco normal, sem expor a defesa nem abrir mão do ataque.'],ofensivo:['Ofensivo','Aumenta as oportunidades de ataque, com mais espaço para o rival responder.'],todos:['Todos no ataque','Arrisca ao máximo: muitas tentativas, menos precisão e grande exposição defensiva.']},
 d:{retranca:['Retranca','Defende perto da própria área. Reduz chances do adversário, limita saídas.'],equilibrado:['Equilibrado','Linha em altura normal, equilíbrio entre proteção e saída de bola.'],linha:['Linha no meio do campo','Adianta a defesa e cria mais oportunidades. Deixa espaço nas costas para contra-ataques e bolas longas.']},
 mi:{curtos:['Passes curtos','Prepara melhor as finalizações e diminui os ataques adversários.'],infiltracoes:['Infiltrações','Cria chances, mas deixa espaços na recomposição.'],pressao:['Pressão no meio','Recupera a bola rápido; se o rival superar a pressão, finaliza com mais facilidade.']},
 a:{posse:['Posse de bola','Mais posse de bola; contra retranca encontra menos espaço.'],contra:['Contra-ataque','Menos chances, mas aproveita melhor os espaços, principalmente contra defesa adiantada.'],laterais:['Jogo pelas laterais','Cruzamentos e mais escanteios; útil contra defesa fechada.'],longa:['Bola longa','Explora as costas de linha alta; a perda de posse gera chances ao rival.'],chute:['Chute direto','Mais tentativas de finalização, com menor precisão.']}};
const DEF_TAC={m:'equilibrado',d:'equilibrado',mi:'curtos',a:'posse'};
function norm(t){t=t||{};const o={};for(const k in DEF_TAC)o[k]=TAC[k][t[k]]?t[k]:DEF_TAC[k];return o;}
const label=t=>{t=norm(t);return ['m','d','mi','a'].map(k=>TAC[k][t[k]][0]).join(' · ');};
// efeitos de T (com rival O). own = chances criadas, opp = chances cedidas ao rival, pos = desvio de posse (pontos), vol = volume de chutes, acc = precisão, cor = escanteios, foul = faltas, tire = cansaço
function effects(T,O,sT,sO,raw){T=norm(T);O=norm(O);const e={own:1,opp:1,pos:0,vol:1,acc:1,cor:1,foul:1,tire:0};const M=(o,p,x={})=>{e.own*=o;e.opp*=p;for(const k in x)if(k==='pos'||k==='tire')e[k]+=x[k];else e[k]*=x[k];};
 ({retranca:()=>M(.8,.78,{pos:-7,vol:.8}),defensivo:()=>M(.91,.88,{pos:-3,vol:.9}),equilibrado:()=>0,ofensivo:()=>M(1.12,1.1,{pos:3,vol:1.12,tire:.5}),todos:()=>M(1.22,1.3,{pos:5,vol:1.35,acc:.85,tire:1})})[T.m]();
 ({retranca:()=>M(.94,.89,{pos:-3}),equilibrado:()=>0,linha:()=>M(1.07,1.03,{pos:2,tire:.3})})[T.d]();
 const midUp=(sO?.MID||0)>(sT?.MID||0)+3;
 ({curtos:()=>M(1.03,.95,{pos:5,acc:1.06}),infiltracoes:()=>M(1.08,1.05),pressao:()=>M(1.02,midUp?1.1:.93,{pos:2,foul:1.3,tire:.6})})[T.mi]();
 const closed=O.m==='retranca'||O.d==='retranca',high=O.d==='linha';
 ({posse:()=>M(closed?.92:1.02,.97,{pos:8}),contra:()=>M(.95*(high?1.22:1)*(O.m==='ofensivo'||O.m==='todos'?1.12:1)*(O.mi==='pressao'?1.05:1),.95,{pos:-7,acc:1.08}),laterais:()=>M(closed?1.1:1.0,1,{cor:1.45}),longa:()=>M(high?1.18:.97,1.05,{pos:-5,acc:.95}),chute:()=>M(1.03,1,{vol:1.3,acc:.8})})[T.a]();
 // pressão do rival: se meu meio supera a pressão dele, crio mais
 if(O.mi==='pressao'&&(sT?.MID||0)>(sO?.MID||0)+3)e.own*=1.06;
 if(!raw){const B=effects(DEF_TAC,DEF_TAC,{},{},1);e.own/=B.own;e.opp/=B.opp;e.pos-=B.pos;}
 e.own=Math.max(.68,Math.min(1.42,e.own));e.opp=Math.max(.68,Math.min(1.45,e.opp));e.pos=Math.max(-15,Math.min(15,e.pos));return e;}
// IA: formação que melhor encaixa o elenco + tática coerente com a força
function aiPlan(squad,clubId=0){let best='4-3-3',bv=-1;for(const f in FORMS){const xi=autoXI(squad,f);const v=xi.reduce((s,p,i)=>s+val(p,FORMS[f][i]?.[0]),0)+(f==='4-3-3'||f==='4-4-2'||f==='4-2-3-1'?3:0);if(v>bv){bv=v;best=f;}}
 const xi=autoXI(squad,best);const avg=xi.reduce((s,p)=>s+(p.overall||50),0)/Math.max(1,xi.length);const h=(clubId*2654435761>>>0)%5;
 const att=xi.filter(p=>SEC[p.primary_position]==='ATT');const pace=att.length?att.reduce((s,p)=>s+(p.stats?.pace||p.overall),0)/att.length:70;
 let t;if(avg>=79)t={m:h<2?'ofensivo':'equilibrado',d:h===0?'linha':'equilibrado',mi:h===3?'pressao':'curtos',a:h===4?'laterais':'posse'};
 else if(avg>=75)t={m:'equilibrado',d:'equilibrado',mi:['curtos','infiltracoes','pressao','curtos','infiltracoes'][h],a:pace>=80?'contra':['posse','laterais','chute','posse','longa'][h]};
 else t={m:h<3?'defensivo':'equilibrado',d:h<2?'retranca':'equilibrado',mi:h===2?'pressao':'curtos',a:pace>=78||h<3?'contra':'longa'};
 return {formation:best,tactics:t};}
// cobradores: escolhidos pelo dono (só titulares); se saiu do onze, passa para o melhor disponível
function takers(xi,want={}){const ids=new Set(xi.map(p=>p.id));const s=(p,k)=>p.stats?.[k]??p.overall??50;
 const best=f=>[...xi].filter(p=>p.primary_position!=='GOL').sort((a,b)=>f(b)-f(a))[0]?.id||null;
 const o={fk:best(p=>s(p,'shooting')*.6+s(p,'passing')*.4),ck:best(p=>s(p,'passing')),pk:best(p=>s(p,'shooting')),cap:[...xi].sort((a,b)=>(b.age||0)*1.5+(b.overall||0)-((a.age||0)*1.5+(a.overall||0)))[0]?.id||null};
 for(const k in o)if(want&&ids.has(+want[k]))o[k]=+want[k];return o;}
module.exports={FORMS,FORMATIONS,SEC,TAC,DEF_TAC,norm,label,fit,assign,autoXI,effective,lineup,sectorFit,effects,aiPlan,takers};
