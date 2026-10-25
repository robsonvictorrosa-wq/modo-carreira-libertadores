// Evolução dos jogadores – Libertadores ZC (regras do Robson).
// Natural e progressiva: a cada jogo disputado o jogador acumula uma fração de over (evo_acc);
// ao passar de 1.0 ele sobe 1 over. O ganho por jogo depende da nota (do jogo + média da temporada),
// da idade e da distância até o potencial, com variação aleatória. Nota ruim (<6.25) não evolui.
// Quem não joga não evolui. Nunca passa do potencial; >33 anos congelado.
// Calibragem (OVR 73, 21 anos, pot 83): 20 jogos média 7.0 ≈ +2; média 7.5 ≈ +3; 39 jogos: +1 (mediano) até +8 (excelente).
const VAL=require('./value');
// ganho base por jogo (jogador jovem, longe do potencial) em função da nota
const PTS=[[6.25,0],[6.5,0.04],[6.75,0.09],[7.0,0.145],[7.5,0.20],[8.0,0.27],[9.0,0.30]];
function base(r){if(r<PTS[0][0])return 0;for(let i=1;i<PTS.length;i++)if(r<PTS[i][0]){const[a,x]=PTS[i-1],[b,y]=PTS[i];return x+(y-x)*(r-a)/(b-a);}return PTS[PTS.length-1][1];}
function ageF(a){a=+a||25;return a<=21?1:a<=23?0.85:a<=25?0.65:a<=27?0.5:a<=29?0.35:a<=31?0.2:a<=33?0.1:0;}
const gapF=g=>g<=0?0:Math.min(1,0.25+g/10*0.75);
// ganho de um jogo: nota do jogo pesa 40%, média da temporada 60% (suaviza um jogo isolado)
function gain(p,nota,media,rnd=Math.random){const r=media==null?nota:0.4*nota+0.6*media;const b=base(r);if(!b)return 0;
 return b*ageF(p.age)*gapF((+p.potential||p.overall)-p.overall)*(0.6+0.8*rnd());}
async function afterRound(db,room,comp){
 const ms=(await db.query('SELECT details FROM matches WHERE comp_id=$1 AND round=$2 AND played',[comp.id,comp.current_round])).rows;
 const rt=new Map();for(const m of ms)for(const [id,v] of Object.entries(m.details?.ratings||{}))if(+id>0&&v!=null)rt.set(+id,+v);
 if(!rt.size)return [];
 const ids=[...rt.keys()];
 const ps=(await db.query('SELECT p.player_id,p.overall,p.potential,p.age,p.evo_acc,p.ovr_start,s.apps,s.rating_sum FROM room_players p LEFT JOIN player_stats s ON s.comp_id=$2 AND s.player_id=p.player_id WHERE p.room_id=$1 AND p.player_id=ANY($3::int[])',[room.id,comp.id,ids])).rows;
 const up=[];
 for(const p of ps){if(VAL.frozen(p))continue;const media=p.apps?p.rating_sum/p.apps:null;let acc=(+p.evo_acc||0)+gain(p,rt.get(p.player_id),media);let ov=+p.overall;
  while(acc>=1){const n=VAL.capOverall(p,ov+1);if(n<=ov){acc=0;break;}ov=n;acc-=1;}
  const mv=ov!==+p.overall?VAL({...p,overall:ov}):null;
  await db.query('UPDATE room_players SET evo_acc=$3,ovr_start=COALESCE(ovr_start,$4),overall=$5,market_value=COALESCE($6,market_value) WHERE room_id=$1 AND player_id=$2',[room.id,p.player_id,acc,+p.overall,ov,mv]);
  if(ov>+p.overall)up.push(p.player_id);}
 return up.length?[{info:`📈 ${up.length} jogador(es) evoluíram nesta rodada.`}]:[];}
module.exports={frozen:VAL.frozen,applyOverall:VAL.capOverall,enabled:true,base,ageF,gapF,gain,
 description:'Evolução natural: a cada jogo o jogador acumula uma parte de over conforme a nota (do jogo e média da temporada), a idade e a distância até o potencial, com variação aleatória. Nota média ruim (abaixo de 6,25) não evolui; quem não joga não evolui. Ex.: OVR 73, 21 anos, pot. 83 — 20 jogos com média 7,0 ≈ +2; média 7,5 ≈ +3; nos 39 jogos da fase de liga de +1 (mediano) até +8 (excelente). Nunca passa do potencial; acima de 33 anos não muda.',
 afterRound};
