// Libertadores ZC – formato: 40 clubes, liga única (todos x todos, 39 rodadas),
// 1º–10º direto às oitavas, 11º–22º play-in (jogo único na casa do melhor), mata-mata com pênaltis.
const CFG={
 NAME:'Libertadores ZC',
 DIRECT:10,            // 1º ao 10º: direto às oitavas
 PLAYIN_FROM:11,PLAYIN_TO:22, // 11º ao 22º: play-in (11x22, 12x21, ...)
 KO_TWO_LEGS:true,     // oitavas, quartas e semi em ida e volta (false = jogo único)
 FINAL_SINGLE:true,    // final em jogo único (campo neutro)
};
// 40 clubes definidos em config/libertadores.json (aplicado no build -> tabela lib_clubs do SQLite)
const CF=JSON.parse(require('fs').readFileSync(__dirname+'/config/libertadores.json','utf8'));
let CLUBS=[];const loadClubs=uni=>(CLUBS=uni.prepare('SELECT club_id FROM lib_clubs ORDER BY ord').all().map(x=>x.club_id));
// elenco vazio (provisório): completa o time com jogadores "Provisório" de OVR neutro só para o motor rodar
const VPOS=['GOL','LD','ZAG','ZAG','LE','VOL','MC','MEI','PD','PE','ATA','GOL','ZAG','MC','ATA','LE'];
const virtualSquad=clubId=>VPOS.map((pos,i)=>({id:-(clubId*100+i+1),name:'Provisório '+pos+(i>=11?' (res.)':''),primary_position:pos,positions:[pos],overall:CF.placeholder_ovr,age:25,stats:{},virtual:true}));
const STAGE_NAMES={league:'Fase de liga',playin:'Play-in',r16:'Oitavas de final',qf:'Quartas de final',sf:'Semifinal',final:'Final'};
function plan(n=40){const p=[];const lr=n%2?n:n-1;for(let i=1;i<=lr;i++)p.push({stage:'league',leg:0});p.push({stage:'playin',leg:1});
 for(const st of ['r16','qf','sf']){p.push({stage:st,leg:1});if(CFG.KO_TWO_LEGS)p.push({stage:st,leg:2});}
 p.push({stage:'final',leg:1});if(!CFG.FINAL_SINGLE)p.push({stage:'final',leg:2});
 return p.map((x,i)=>({...x,round:i+1}));}
const LEAGUE_ROUNDS=()=>plan().filter(x=>x.stage==='league').length;
// Tabela: pontos, vitórias, saldo, gols pró (depois nome)
function standings(matches,clubIds,nameOf=id=>String(id)){const T={};clubIds.forEach(id=>T[id]={club_id:id,name:nameOf(id),j:0,v:0,e:0,d:0,gp:0,gc:0,pts:0,form:[]});
 for(const m of [...matches].filter(m=>m.played&&(m.stage||'league')==='league').sort((a,b)=>a.round-b.round))for(const [id,f,g] of [[m.home,m.hg,m.ag],[m.away,m.ag,m.hg]]){const t=T[id];if(!t)continue;t.j++;t.gp+=f;t.gc+=g;if(f>g){t.v++;t.pts+=3;t.form.push('V')}else if(f===g){t.e++;t.pts++;t.form.push('E')}else{t.d++;t.form.push('D')}}
 return Object.values(T).map(t=>({...t,sg:t.gp-t.gc,form:t.form.slice(-5)})).sort((a,b)=>b.pts-a.pts||b.v-a.v||b.sg-a.sg||b.gp-a.gp||a.name.localeCompare(b.name)).map((t,i)=>({...t,pos:i+1,zone:i+1<=CFG.DIRECT?'oitavas':i+1>=CFG.PLAYIN_FROM&&i+1<=CFG.PLAYIN_TO?'playin':'fora'}));}
// chaveamento das oitavas por campanha (1x16, 8x9, ...): metades separadas, 1 e 2 só se cruzam na final
const BRACKET=[1,16,8,9,4,13,5,12,2,15,7,10,3,14,6,11];
// pênaltis: 5 cobranças + alternadas, conversão ~75%
function penalties(r=Math.random){let a=0,b=0;for(let i=0;i<5;i++){if(r()<.75)a++;if(a>b+(5-i))break;if(r()<.75)b++;if(b>a+(4-i)||a>b+(4-i))break;}
 while(a===b){const x=r()<.75,y=r()<.75;a+=x;b+=y;}return [a,b];}
// gera os jogos de uma rodada de mata-mata. ctx: {rank: Map clube->posição na liga, prev: jogos já disputados (todas as fases)}
function koMatches(step,ctx){const {rank,prev}=ctx;const better=(x,y)=>rank.get(x)<rank.get(y);
 if(step.leg===2){return prev.filter(m=>m.stage===step.stage&&m.leg===1).map(m=>({home:m.away,away:m.home,stage:step.stage,leg:2,tie:m.tie}));}
 const single=step.stage==='playin'||(step.stage==='final'?CFG.FINAL_SINGLE:!CFG.KO_TWO_LEGS);
 const pair=(x,y,tie)=>{const [b,w]=better(x,y)?[x,y]:[y,x];return single?{home:b,away:w,stage:step.stage,leg:1,tie,neutral:step.stage==='final'}:{home:w,away:b,stage:step.stage,leg:1,tie};};// ida na casa do pior, volta na casa do melhor
 if(step.stage==='playin'){const byPos=[...rank].sort((a,b)=>a[1]-b[1]).map(x=>x[0]);const out=[];for(let i=0;i<(CFG.PLAYIN_TO-CFG.PLAYIN_FROM+1)/2;i++)out.push(pair(byPos[CFG.PLAYIN_FROM-1+i],byPos[CFG.PLAYIN_TO-1-i],i));return out;}
 if(step.stage==='r16'){const byPos=[...rank].sort((a,b)=>a[1]-b[1]).map(x=>x[0]);const q=[...byPos.slice(0,CFG.DIRECT),...winners(prev,'playin').map(w=>w.club)].sort((a,b)=>rank.get(a)-rank.get(b));
  const out=[];for(let i=0;i<BRACKET.length;i+=2)out.push(pair(q[BRACKET[i]-1],q[BRACKET[i+1]-1],i/2));return out;}
 const from={qf:'r16',sf:'qf',final:'sf'}[step.stage];const w=winners(prev,from).sort((a,b)=>a.tie-b.tie);const out=[];for(let i=0;i<w.length;i+=2)out.push(pair(w[i].club,w[i+1].club,i/2));return out;}
function winners(prev,stage){return prev.filter(m=>m.stage===stage&&m.winner).map(m=>({club:m.winner,tie:m.tie}));}
// define vencedor de um confronto após o jogo decisivo. ms = jogos do confronto (1 ou 2), last = jogo recém-disputado
function decideTie(ms,last,r=Math.random){const a=last.home,b=last.away;let ga=0,gb=0;for(const m of ms){if(m.home===a){ga+=m.hg;gb+=m.ag}else{ga+=m.ag;gb+=m.hg}}
 if(ga!==gb)return {winner:ga>gb?a:b,agg:[ga,gb],pens:null};const p=penalties(r);return {winner:p[0]>p[1]?a:b,agg:[ga,gb],pens:p.join('-')};}
module.exports={CFG,CF,get CLUBS(){return CLUBS},loadClubs,virtualSquad,STAGE_NAMES,plan,LEAGUE_ROUNDS,standings,penalties,koMatches,winners,decideTie,BRACKET};
