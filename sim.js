// Motor de simulação (ver CRITERIOS_SIMULACAO.md)
const FORMATIONS={'4-3-3':{DEF:4,MID:3,ATT:3},'4-4-2':{DEF:4,MID:4,ATT:2},'4-2-3-1':{DEF:4,MID:5,ATT:1},'3-5-2':{DEF:3,MID:5,ATT:2},'5-3-2':{DEF:5,MID:3,ATT:2},'4-5-1':{DEF:4,MID:5,ATT:1}};
const SECTOR={GOL:'GK',ZAG:'DEF',LD:'DEF',LE:'DEF',ADD:'DEF',ADE:'DEF',VOL:'MID',MC:'MID',MEI:'MID',MD:'MID',ME:'MID',PD:'ATT',PE:'ATT',SA:'ATT',ATA:'ATT'};
const sec=p=>SECTOR[p.primary_position]||'MID';
const st=(p,k)=>(p.stats&&p.stats[k])??p.overall??50;
// Auto-escalação: melhor OVR por setor conforme a formação; completa com os melhores restantes
function autoXI(squad,formation='4-3-3'){const f=FORMATIONS[formation]||FORMATIONS['4-3-3'];const need={GK:1,...f};const pool=[...squad].filter(p=>p.overall).sort((a,b)=>b.overall-a.overall);const xi=[];
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
function playMatch(H,A,r=Math.random){ // H/A = {club_id,xi,form}
 const sH=strength(H.xi),sA=strength(A.xi),[xH,xA]=expected(sH,sA,H.form,A.form);const hg=poisson(xH,r),ag=poisson(xA,r);
 const events=[],pr={};[...H.xi,...A.xi].forEach(p=>pr[p.id]={g:0,a:0});
 const goals=(T,n)=>{for(let i=0;i<n;i++){const sc=pick(T.xi,T.xi.map(p=>(GW[p.primary_position]??.3)*st(p,'shooting')**2),r);let as=null;
  if(r()<0.8){const c=T.xi.filter(p=>p!==sc);as=pick(c,c.map(p=>(AW[p.primary_position]??.3)*st(p,'passing')**2),r);pr[as.id].a++;}
  pr[sc.id].g++;events.push({min:1+Math.floor(r()*90),club:T.club_id,scorer:sc.id,scorer_name:sc.name,assist:as?.id||null,assist_name:as?.name||null});}};
 goals(H,hg);goals(A,ag);events.sort((a,b)=>a.min-b.min);
 const ratings={};for(const [T,gf,ga] of [[H,hg,ag],[A,ag,hg]])for(const p of T.xi){let v=6.2+(gf>ga?.4:gf<ga?-.3:0)+pr[p.id].g*.9+pr[p.id].a*.5+(r()-.5)*1.2;
  if(ga===0&&['GK','DEF'].includes(sec(p)))v+=.5;if(sec(p)==='GK'||sec(p)==='DEF')v-=Math.max(0,ga-1)*.25;ratings[p.id]=Math.round(Math.max(3,Math.min(10,v))*10)/10;}
 return {hg,ag,xg:[+xH.toFixed(2),+xA.toFixed(2)],strength:{home:sH,away:sA},events,ratings,goalsBy:pr,
  lineups:{home:H.xi.map(p=>({id:p.id,name:p.name,pos:p.primary_position})),away:A.xi.map(p=>({id:p.id,name:p.name,pos:p.primary_position}))}};}
// Turno e returno (método do círculo)
function schedule(ids,r=Math.random){const t=[...ids];for(let i=t.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[t[i],t[j]]=[t[j],t[i]];}if(t.length%2)t.push(null);
 const n=t.length,rounds=[];let arr=[...t];for(let k=0;k<n-1;k++){const m=[];for(let i=0;i<n/2;i++){const a=arr[i],b=arr[n-1-i];if(a!=null&&b!=null)m.push(k%2&&i===0?[b,a]:[a,b]);}rounds.push(m);arr=[arr[0],arr[n-1],...arr.slice(1,n-1)];}
 return rounds.concat(rounds.map(m=>m.map(([a,b])=>[b,a])));}
module.exports={FORMATIONS,autoXI,strength,expected,playMatch,schedule,sec};
