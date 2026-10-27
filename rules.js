// Regras do mercado (puras, sem banco) — documentadas em CRITERIOS_MERCADO.md
const S=require('./sim');
const EXPORT=new Set(['Brasil','Argentina','Portugal','Holanda','Bélgica','Colômbia','Uruguai','Equador','Chile','Paraguai','Peru','Venezuela','Bolívia','México']);
const VET_DEST=new Set(['Arábia Saudita','EUA','China','Índia','Austrália','Catar']);
const MIN_SQ=11,BOT_MAX_SQ=30;
// arredondamento "de mercado"
const mround=v=>{v=Math.max(0,v);const st=v<1e6?25e3:v<1e7?1e5:v<5e7?5e5:1e6;return Math.round(v/st)*st;};
const wround=v=>{v=Math.max(500,v);const st=v<1e4?250:v<1e5?1e3:5e3;return Math.round(v/st)*st;};
// ruído determinístico por (sala,jogador,clube) para cada clube "pensar diferente" mas de forma estável
const noise=(...k)=>{let h=2166136261;for(const c of k.join(':')){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return ((h>>>0)%1000)/1000;};
const ageF=a=>a<=19?1.25:a<=21?1.18:a<=24?1.1:a<=28?1:a<=30?0.9:a<=32?0.75:0.6;
const potF=p=>1+Math.max(0,(p.potential||p.overall)-p.overall)*0.012;
// importância no elenco: posição no ranking de OVR + titular do 11 ideal
function importance(p,squad){const sorted=[...squad].sort((a,b)=>b.overall-a.overall);const rank=sorted.findIndex(x=>x.id===p.id)+1;
 const xi=S.autoXI(squad);const starter=xi.some(x=>x.id===p.id);const xiavg=xi.reduce((a,x)=>a+x.overall,0)/Math.max(1,xi.length);
 if(starter&&(rank<=3||p.overall>=xiavg+3))return {k:'chave',f:1.55,rank,starter};if(starter)return {k:'titular',f:1.3,rank,starter};if(rank<=18)return {k:'rotação',f:1.05,rank,starter};return {k:'reserva',f:0.85,rank,starter};}
// preço pedido por um clube bot
function askPrice(p,ctx){const {imp,season,day=0,days=4,fails=0,rival=false,sellerBudget=1e9,salt=''}=ctx;
 let v=p.market_value*ageF(p.age)*potF(p)*imp.f;
 if(p.contract_end&&p.contract_end<=season+1)v*=0.72;           // contrato acabando
 if(p.wants_out)v*=0.82;if(p.listed)v*=0.9;                       // insatisfeito / à venda
 if(sellerBudget<5e5)v*=0.92;                                       // clube precisando de caixa
 v*=1+0.05*Math.min(day,days);                                      // fim de janela endurece
 v*=1+0.05*fails;                                                   // cada recusa endurece
 if(rival)v*=1.25;                                                  // rival direto da mesma liga
 v*=0.95+0.1*noise(salt,p.id);return mround(v);}
// decisão do clube vendedor (bot) diante de uma proposta
function clubDecision(p,o,ctx){const ask=askPrice(p,ctx);const fee=o.fee+(o.swapValue||0);const r=fee/ask;
 if(ctx.clause&&o.fee>=ctx.clause)return {d:'accept',ask,forced:true,msg:'Cláusula de rescisão paga: o clube é obrigado a liberar o jogador.'};
 if(ctx.sellerSquad<=MIN_SQ)return {d:'reject',ask,msg:'O clube não pode vender: ficaria com elenco abaixo do mínimo.'};
 if(o.loan){if(ctx.imp.k!=='reserva'||p.age>23)return {d:'reject',ask,msg:'O clube só empresta jovens que não fazem parte dos planos.'};return {d:'accept',ask,msg:'Empréstimo aceito.'};}
 if(ctx.imp.k==='chave'&&r<1.15)return {d:'reject',ask,msg:`O clube considera ${p.name} inegociável. Só uma proposta muito acima do valor${ctx.clause?' (ou a cláusula de rescisão)':''} mudaria isso.`};
 if(ctx.rival&&r<1)return {d:'reject',ask,msg:'O clube não negocia com um rival direto da mesma liga por esse valor.'};
 if(ctx.biggerSeller&&ctx.imp.k!=='reserva'&&ctx.imp.k!=='rotação'&&r<1.2)return {d:'reject',ask,msg:'O clube não vende um titular para um clube de menor expressão.'};
 if(r>=1)return {d:'accept',ask,msg:'Proposta aceita pelo clube.'};
 if(r>=0.65){const c=mround(ask*(ctx.fails?1:0.98+0.04*noise(ctx.salt,'c')));return {d:'counter',ask,counter:Math.max(c,mround(o.fee*1.05)),msg:`O clube pede ${fmt(c)} para negociar.`};}
 if(r>=0.4)return {d:'reject',ask,msg:'Proposta muito abaixo do valor que o clube espera.'};
 return {d:'reject',ask,msg:'O clube considerou a proposta desrespeitosa e nem respondeu.'};}
const fmt=v=>v<0?'-'+fmt(-v):v>=1e6?'€ '+(v/1e6).toFixed(1).replace('.',',')+' M':'€ '+Math.round(v/1e3)+' mil';
// papel esperado do jogador no elenco de destino (pelo OVR)
function expectedRole(p,toSquad){const others=toSquad.filter(x=>x.id!==p.id);const xi=S.autoXI([...others,p]);const starter=xi.some(x=>x.id===p.id);
 const better=others.filter(x=>x.overall>p.overall).length;const xiavg=xi.reduce((a,x)=>a+x.overall,0)/11;
 if(starter&&(better<=1||p.overall>=xiavg+4))return 'estrela';if(starter)return 'titular';if(p.age<=21&&(p.potential-p.overall)>=7)return 'promessa';if(better<=17)return 'rotação';return 'reserva';}
const ROLES=['reserva','promessa','rotação','titular','estrela'];const RV={reserva:0,promessa:1,'rotação':1,titular:2,estrela:3};
const rep=(c,L)=>c.overall+((L.get(c.league_id)?.attr||60)-70)*0.5;
// decisão do JOGADOR (contrato pessoal)
function playerDecision(p,o,ctx){const {from,to,L,fromImp,expected,fails=0,salt=''}=ctx;const free=!from||ctx.isFree;
 const role=o.role||expected;const years=o.years||3;
 if(role==='promessa'&&(p.age>21||p.potential-p.overall<5))return {d:'invalid',msg:'Só jogadores jovens (até 21) com potencial podem receber o papel de promessa.'};
 if(RV[role]>RV[expected]+0)return {d:'invalid',msg:`Papel incompatível: com OVR ${p.overall} ele seria "${expected}" no seu elenco, não "${role}".`};
 const dClub=free?0:rep(to,L)-rep(from,L);const la=x=>L.get(x.league_id)?.attr||60;const dLeague=free?0:la(to)-la(from);
 const big=Math.max(1,o.wage/Math.max(500,p.wage));const vet=p.age>=30;
 // recusas "duras" (com exceções realistas por dinheiro)
 if(!free&&p.overall>=78&&dClub<=-6&&!(vet&&big>=2.2)&&!p.wants_out)return {d:'reject',hard:true,msg:'O jogador não quer se transferir para um clube de menor expressão.'};
 if(!free&&p.age<29&&dLeague<=-6&&big<2&&!p.wants_out)return {d:'reject',hard:true,msg:'O jogador não tem interesse em jogar nessa liga neste momento da carreira.'};
 if(!free&&fromImp&&fromImp.starter&&p.morale>=60&&!p.wants_out&&dClub<2&&big<1.6&&noise(salt,p.id,'happy')<0.7)return {d:'reject',hard:true,msg:'O jogador está feliz no clube atual e não quer sair.'};
 if(RV[role]<RV[expected]&&!(expected==='promessa'&&role==='rotação'))return {d:'reject',msg:`O jogador quer ser ${expected}; não aceita o papel de ${role}.`};
 if(p.age<=23&&role==='reserva')return {d:'reject',msg:'O jogador quer minutos para se desenvolver; não aceita ser reserva.'};
 // salário pedido
 let m=free?1.0:1.15;if(dClub<-3)m+=0.04*(-dClub-3);if(dLeague<-3)m+=0.03*(-dLeague-3);if(dClub>4)m-=Math.min(0.12,0.015*(dClub-4));
 if(role==='estrela')m+=0.1;if(vet&&years<2)m+=0.1;if(p.age>=33&&years>2)m-=0.05;if(p.wants_out)m-=0.1;m*=1+0.05*fails;m*=0.97+0.06*noise(salt,p.id,'w');
 const base=free?Math.max(p.wage,Math.round(p.market_value/220)):p.wage;const ask=wround(base*m);
 return {d:'accept',ask,msg:'O jogador aceitou os termos pessoais.'}; // Robson 26/10: salário não pesa mais
 if(o.wage>=ask*0.85)return {d:'counter',ask,msg:`O jogador pede ${fmt(ask)}/semana para assinar.`};
 return {d:'reject',ask,msg:`Salário abaixo do esperado. O jogador quer algo perto de ${fmt(ask)}/semana.`};}
module.exports={EXPORT,VET_DEST,MIN_SQ,BOT_MAX_SQ,mround,wround,noise,ageF,potF,importance,askPrice,clubDecision,expectedRole,playerDecision,rep,fmt,ROLES};
