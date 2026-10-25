// Motor de simulação (ver CRITERIOS_SIMULACAO.md)
const TT=require('./tactics');const FORMATIONS=TT.FORMATIONS;
const SECTOR={GOL:'GK',ZAG:'DEF',LD:'DEF',LE:'DEF',ADD:'DEF',ADE:'DEF',VOL:'MID',MC:'MID',MEI:'MID',MD:'MID',ME:'MID',PD:'ATT',PE:'ATT',SA:'ATT',ATA:'ATT'};
const sec=p=>SECTOR[p.primary_position]||'MID';
const st=(p,k)=>(p.stats&&p.stats[k])??p.overall??50;
// Auto-escalação: melhor OVR por setor conforme a formação; completa com os melhores restantes
function autoXI(squad,formation='4-3-3'){if(TT.FORMS[formation])return TT.autoXI(squad,formation);const f=FORMATIONS[formation]||FORMATIONS['4-3-3'];const need={GK:1,...f};const pool=[...squad].filter(p=>p.overall).sort((a,b)=>b.overall-a.overall);const xi=[];
 for(const s of ['GK','DEF','MID','ATT'])for(const p of pool.filter(p=>sec(p)===s&&!xi.includes(p)).slice(0,need[s]))xi.push(p);
 for(const p of pool){if(xi.length>=11)break;if(!xi.includes(p))xi.push(p);}return xi;}
const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:50;
// Força por setor dos 11 titulares
function strength(xi){const by=s=>xi.filter(p=>sec(p)===s);const fb=(arr,alt)=>arr.length?arr:alt;
 const gk=by('GK')[0];
 return {GK:gk?avg(['gk_diving','gk_handling','gk_reflexes','gk_positioning'].map(k=>st(gk,k))):35,
  DEF:avg(fb(by('DEF'),xi).map(p=>0.55*st(p,'defense')+0.3*st(p,'physical')+0.15*st(p,'pace'))),
  MID:avg(fb(by('MID'),xi).map(p=>0.45*st(p,'passing')+0.3*st(p,'dribbling')+0.25*(p.overall||50))),
  ATT:avg(fb(by('ATT'),xi).map(p=>0.5*st(p,'shooting')+0.25*st(p,'pace')+0.25*st(p,'dribbling')))};}
const poisson=(l,r)=>{let L=Math.exp(-l),k=0,p=1;do{k++;p*=r();}while(p>L);return Math.min(k-1,9);};
const pick=(arr,w,r)=>{const t=w.reduce((a,b)=>a+b,0);let x=r()*t;for(let i=0;i<arr.length;i++){x-=w[i];if(x<=0)return arr[i];}return arr[arr.length-1];};
const GW={ATA:1,SA:.85,PD:.75,PE:.75,MEI:.45,MD:.35,ME:.35,MC:.25,VOL:.12,ZAG:.1,LD:.07,LE:.07,ADD:.07,ADE:.07,GOL:0};
const AW={MEI:1,PD:.9,PE:.9,MD:.8,ME:.8,SA:.7,MC:.65,ATA:.5,LD:.45,LE:.45,ADD:.45,ADE:.45,VOL:.35,ZAG:.1,GOL:.02};
const HOME_ADV=1.12,BASE=1.3;
// form = pontos nos últimos 5 jogos (0..15) ou null
function expected(sH,sA,formH,formA){const fm=f=>f==null?1:0.95+0.1*(f/15);
 const atk=s=>0.65*s.ATT+0.35*s.MID,dfn=s=>0.6*s.DEF+0.2*s.MID+0.2*s.GK;
 const xH=BASE*Math.exp((atk(sH)-dfn(sA))/16)*HOME_ADV*fm(formH)/fm(formA);
 const xA=BASE*Math.exp((atk(sA)-dfn(sH))/16)/HOME_ADV*fm(formA)/fm(formH);
 return [Math.max(.15,Math.min(xH,4.5)),Math.max(.15,Math.min(xA,4.5))];}
// Notas individuais estilo Sofascore: estatísticas por jogador coerentes com placar, gols/assistências, posição, atributos e minutos
const PR={GK:{pa:16,sh:0,dr:0,tk:.1,it:.2,cl:.8,rc:2.5,ft:.15},DEF:{pa:48,sh:.5,dr:.5,tk:2.2,it:1.6,cl:3.6,rc:5,ft:1.1},MID:{pa:52,sh:1.2,dr:1.3,tk:2,it:1.1,cl:.9,rc:5.5,ft:1.2},ATT:{pa:28,sh:2.3,dr:2.4,tk:.8,it:.4,cl:.4,rc:3,ft:1}};
const pois=(l,r)=>l<=0?0:l<6?poisson(l,r):Math.max(0,Math.round(l+Math.sqrt(l)*(r()+r()+r()+r()-2)*1.7));const r1=x=>Math.round(x*10)/10;const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function rate(s,p,gf,ga){const S=sec(p),f=clamp(s.min/90,.15,1);let v;
 if(S==='GK'){v=6.5+s.svd*.38+s.svs*.1+s.cla*.07+s.lbs*.02+(s.ga===0&&s.min>=60?.55:0)-s.ga*.32-s.err*1.1+s.pks*1.1+(s.pa?((s.pac/s.pa)-.7)*.6:0);}
 else{v=6.27+s.g*(S==="ATT"?1.05:1.15)+(S==="ATT"?.08:0)+s.a*.7+s.kp*.16+(s.sot-s.g)*.08-(s.sh-s.sot)*.05+s.drs*.11-(s.dr-s.drs)*.04+s.tk*.11+s.it*.11+s.cl*(S==='DEF'?.05:.03)+s.rc*.035
  +(s.pa?((s.pac/s.pa)-.8)*2.2*Math.min(s.pa/35,1):0)+s.pac*.004-s.lost*.035-s.fc*.07-s.og*1.1-s.pkm*1;
  if(S==='DEF'){v-=Math.max(0,s.ga-1)*.18;if(s.ga===0&&s.min>=60)v+=.3;}}
 v+=(gf>ga?.25:gf<ga?-.2:0)*f-s.yc*.3-s.rd*1.5+s.noise;
 if(s.min<45)v=6.5+(v-6.5)*(.4+s.min/75);return r1(clamp(v,3,10));}
// Altitude: d = (alt mandante − max(alt visitante,1000 m))/1000. Ex.: Bolívar (3640 m) x clube ao nível do mar: d≈2,6 → mandante +13% xG, visitante −16% xG,
// gols do mandante mais concentrados no 2º tempo e notas do visitante caem um pouco no 2º tempo (cansaço). Efeito moderado.
const altD=(H,A)=>H.neutral?0:Math.max(0,((+H.alt||0)-Math.max(+A.alt||0,1000))/1000);
function playMatch(H,A,r=Math.random){ // H/A = {club_id,xi,bench?,form,alt?}
 // formação: cada titular rende conforme o encaixe na vaga (fora de posição rende menos) e o setor conta pela vaga
 const plan=T=>{const f=TT.FORMS[T.formation]?T.formation:'4-3-3';const lu=TT.lineup(T.xi,f,T.slotted);const s=strength(lu.map(x=>TT.effective(x.p,x.slot)));const c=TT.FORMATIONS[f];
  s.DEF*=1+.012*(c.DEF-4);s.MID*=1+.01*(c.MID-4);s.ATT*=1+.015*(c.ATT-2);return {f,lu,s,fit:TT.sectorFit(lu),tac:TT.norm(T.tactics),tk:TT.takers(T.xi,T.takers)};};
 const PH=plan(H),PA=plan(A);const sH=PH.s,sA=PA.s,AD=altD(H,A);let [xH,xA]=expected(sH,sA,H.form,A.form);
 const eH=TT.effects(PH.tac,PA.tac,sH,sA),eA=TT.effects(PA.tac,PH.tac,sA,sH);xH*=eH.own*eA.opp;xA*=eA.own*eH.opp;const EF=new Map([[H,eH],[A,eA]]),PL=new Map([[H,PH],[A,PA]]);xH*=1+0.05*AD;xA*=Math.max(.7,1-0.06*AD);const hg=poisson(xH,r),ag=poisson(xA,r);
 const events=[],pr={},S0={},on={},teams=[[H,hg,ag,xH],[A,ag,hg,xA]];
 const mk=(p,T,i,o)=>{pr[p.id]={g:0,a:0};S0[p.id]={club:T.club_id,in:i,out:o,min:0,g:0,a:0,sh:0,sot:0,kp:0,pa:0,pac:0,dr:0,drs:0,tk:0,it:0,cl:0,rc:0,lost:0,fc:0,yc:0,rd:0,og:0,pkm:0,svd:0,svs:0,cla:0,lbs:0,ga:0,err:0,pks:0,noise:0};};
 const subs={};for(const [T] of teams){T.xi.forEach(p=>mk(p,T,0,90));subs[T.club_id]=[];
  const bench=(T.bench||[]).filter(p=>p.overall&&!T.xi.includes(p)).sort((a,b)=>b.overall-a.overall).slice(0,9);const n=bench.length?Math.min(bench.length,[2,3,3,4,5][Math.floor(r()*5)]):0;const used=new Set();
  for(let k=0;k<n;k++){const min=55+Math.floor(r()*31);const outs=T.xi.filter(p=>sec(p)!=='GK'&&S0[p.id].out===90&&S0[p.id].in===0);if(!outs.length)break;
   const o=outs[Math.floor(r()*outs.length)];const cand=bench.filter(p=>!used.has(p)&&sec(p)===sec(o));const inn=(cand.length?cand:bench.filter(p=>!used.has(p)&&sec(p)!=='GK'))[0];if(!inn)break;used.add(inn);
   S0[o.id].out=min;mk(inn,T,min,90);subs[T.club_id].push({min,out:o.id,in:inn.id,inn});}}
 const field=(T,m)=>[...T.xi,...subs[T.club_id].map(s=>s.inn)].filter(p=>S0[p.id].in<=m&&S0[p.id].out>m);
 const goals=(T,O,n)=>{for(let i=0;i<n;i++){const min=T===H&&AD>0?(r()<0.5+0.06*AD?46+Math.floor(r()*45):1+Math.floor(r()*45)):1+Math.floor(r()*90);const fl=field(T,min);
  if(r()<.03){const d=field(O,min).filter(p=>sec(p)==='DEF');if(d.length){const og=d[Math.floor(r()*d.length)];S0[og.id].og++;events.push({min,club:T.club_id,scorer:og.id,scorer_name:og.name,og:true,assist:null,assist_name:null});continue;}}
  if(!fl.length)continue;const tk=PL.get(T).tk,onf=id=>fl.find(p=>p.id===id);let kind=null,sc=null,as=null;const u=r();
  if(u<.075&&onf(tk.pk)){sc=onf(tk.pk);kind='pen';}else if(u<.12&&onf(tk.fk)){sc=onf(tk.fk);kind='fk';}
  if(!sc)sc=pick(fl,fl.map(p=>(GW[p.primary_position]??.3)*st(p,'shooting')**2),r);
  if(!kind&&r()<0.8&&fl.length>1){const ck=onf(tk.ck);if(ck&&ck!==sc&&r()<.2*EF.get(T).cor){as=ck;kind='ck';}else{const c=fl.filter(p=>p!==sc);as=pick(c,c.map(p=>(AW[p.primary_position]??.3)*st(p,'passing')**2),r);}pr[as.id].a++;S0[as.id].a++;}
  pr[sc.id].g++;S0[sc.id].g++;events.push({min,club:T.club_id,scorer:sc.id,scorer_name:sc.name,assist:as?.id||null,assist_name:as?.name||null,...(kind?{kind}:{})});}};
 goals(H,A,hg);goals(A,H,ag);events.sort((a,b)=>a.min-b.min);
 const all=(T)=>[...T.xi,...subs[T.club_id].map(s=>s.inn)];
 for(const [T,gf,ga,xg] of teams){const O=T===H?A:H,E=EF.get(T),EO=EF.get(O),dom=clamp((1+((T===H?sH:sA).MID-(T===H?sA:sH).MID)/40)*(1+(E.pos-EO.pos)/70),.6,1.45);
  for(const p of all(T)){const s=S0[p.id];s.min=s.out-s.in;s.ga=events.filter(e=>e.club===O.club_id&&e.min>=s.in&&e.min<s.out).length;}
  // finalizações: no alvo = gols + defesas do goleiro adversário
  const fl=all(T).filter(p=>sec(p)!=='GK');const sotExtra=pois((xg*1.6+1.2)*Math.min(1.3,E.vol*E.acc),r),offT=pois((xg*2.2+3)*E.vol/E.acc,r);
  for(let k=0;k<sotExtra+offT;k++){const p=pick(fl,fl.map(p=>(GW[p.primary_position]??.3+.05)*st(p,'shooting')*S0[p.id].min),r);S0[p.id].sh++;if(k<sotExtra)S0[p.id].sot++;}
  for(const p of fl){S0[p.id].sh+=S0[p.id].g;S0[p.id].sot+=S0[p.id].g;}
  const oppGK=all(O).filter(p=>sec(p)==='GK');const gk=oppGK[0];if(gk){const g=S0[gk.id],q=st(gk,'gk_reflexes');
   for(let k=0;k<sotExtra;k++)(r()<.22+(q-60)*.004?g.svd++:g.svs++);if(r()<.04)g.pks++;
   for(let k=0;k<ga;k++)if(r()<.035)g.err++;}
  for(const p of all(T)){const s=S0[p.id],P=PR[sec(p)],f=s.min/90,ovr=p.overall||60;
   s.pa=pois(P.pa*f*dom*(.8+st(p,'passing')/250),r);const acc=clamp((sec(p)==='GK'?.55:sec(p)==='ATT'?.68:.74)+(st(p,'passing')-60)*.005+(r()-.5)*.12,.4,.97);s.pac=Math.round(s.pa*acc);
   s.kp=pois((sec(p)==='MID'?1.1:sec(p)==='ATT'?.9:sec(p)==='DEF'?.35:0)*f*st(p,'passing')/70,r)+s.a;
   s.dr=pois(P.dr*f*st(p,'dribbling')/70,r);s.drs=Math.round(s.dr*clamp(.35+(st(p,'dribbling')-55)*.008+(r()-.5)*.3,.1,1));
   const dp=st(p,'defense')/65;s.tk=pois(P.tk*f*dp/dom,r);s.it=pois(P.it*f*dp/dom,r);s.cl=pois(P.cl*f/dom*(sec(p)==='DEF'?(.8+xg*.1):1),r);s.rc=pois(P.rc*f*(.7+dp*.3),r);
   s.lost=pois((sec(p)==="ATT"?8:sec(p)==="MID"?6.5:sec(p)==="DEF"?4.5:1.5)*f*(1.15-(ovr-60)*.01),r)+(s.dr-s.drs);s.fc=pois(P.ft*f*E.foul,r);
   if(sec(p)==='GK'){s.cla=pois(1.3,r);s.lbs=pois(6*f,r);s.pa+=s.lbs+pois(4,r);s.pac=Math.round(s.pa*acc);}
   if(r()<.12*f+s.fc*.03)s.yc=1;if(r()<.008*f)s.rd=1;if(s.sh&&r()<.012)s.pkm=1;
   s.noise=(r()+r()+r()-1.5)*.35;if(T===A&&AD>0)s.noise-=0.08*AD*Math.max(0,s.out-Math.max(s.in,45))/45;if(E.tire)s.noise-=.06*E.tire*Math.max(0,s.out-Math.max(s.in,60))/30;}}
 const ratings={};for(const [T,gf,ga] of teams)for(const p of all(T))ratings[p.id]=rate(S0[p.id],p,gf,ga);
 const pstats={};for(const id in S0){const s=S0[id];const o={};for(const k in s)if(k!=='noise'&&k!=='club'&&s[k])o[k]=s[k];o.min=s.min;pstats[id]=o;}
 const motm=+Object.entries(ratings).sort((a,b)=>b[1]-a[1])[0]?.[0]||null;
 const lu=T=>[...T.xi.map(p=>({id:p.id,name:p.name,pos:p.primary_position,...(S0[p.id].out<90?{out:S0[p.id].out}:{})})),...subs[T.club_id].map(s=>({id:s.inn.id,name:s.inn.name,pos:s.inn.primary_position,sub:true,in:s.min}))];
 const appeared=[...all(H).map(p=>[p,H.club_id]),...all(A).map(p=>[p,A.club_id])];
 const tac=P=>({formation:P.f,tactics:P.tac,label:TT.label(P.tac),fit:P.fit,takers:P.tk,slots:P.lu.map(x=>({id:x.p.id,slot:x.slot,fit:+x.fit.toFixed(2)}))});
 return {tac:{home:tac(PH),away:tac(PA)},fx:{home:eH,away:eA},altitude:AD?Math.round(AD*1000)+1000:0,hg,ag,xg:[+xH.toFixed(2),+xA.toFixed(2)],strength:{home:sH,away:sA},events,ratings,pstats,motm,goalsBy:pr,appeared,
  subs:{home:subs[H.club_id].map(({min,out,in:i})=>({min,out,in:i})),away:subs[A.club_id].map(({min,out,in:i})=>({min,out,in:i}))},
  lineups:{home:lu(H),away:lu(A)}};}
// Turno e returno (método do círculo)
function schedule(ids,r=Math.random){const t=[...ids];for(let i=t.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[t[i],t[j]]=[t[j],t[i]];}if(t.length%2)t.push(null);
 const n=t.length,rounds=[];let arr=[...t];for(let k=0;k<n-1;k++){const m=[];for(let i=0;i<n/2;i++){const a=arr[i],b=arr[n-1-i];if(a!=null&&b!=null)m.push(k%2&&i===0?[b,a]:[a,b]);}rounds.push(m);arr=[arr[0],arr[n-1],...arr.slice(1,n-1)];}
 return rounds.concat(rounds.map(m=>m.map(([a,b])=>[b,a])));}
module.exports={FORMATIONS,autoXI,strength,expected,playMatch,schedule,sec};
