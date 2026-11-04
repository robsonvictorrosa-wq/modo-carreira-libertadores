// Evolução dos jogadores – Libertadores ZC (regras do Robson).
// Natural e progressiva: a cada jogo disputado o jogador acumula uma fração de over (evo_acc);
// ao passar de 1.0 ele sobe 1 over. Ganho por jogo: faixa da média de nota × idade × distância ao potencial × variação.
// Quem não joga não evolui. Nunca passa do potencial; >33 anos congelado.
const VAL=require('./value');
// ganho base por jogo (jogador jovem, longe do potencial) em função da nota
// Robson 03/11 (faixas pela MÉDIA de nota): <6,00 nada · 6,00–6,35 lenta · 6,35–6,75 boa · 6,75–7,25 muito boa · 7,25+ mais rápida (sem exagero)
const TIERS=[[7.25,0.18],[6.75,0.13],[6.35,0.08],[6.0,0.04]];
function base(r){r=+r;if(!(r>=6))return 0;for(const [t,v] of TIERS)if(r>=t)return v;return 0;}
function ageF(a){a=+a||25;return a<=21?1:a<=23?0.85:a<=25?0.65:a<=27?0.5:a<=29?0.35:a<=31?0.2:a<=33?0.1:0;}
const gapF=g=>g<=0?0:Math.min(1,0.25+g/10*0.75);
// ganho de um jogo: pela média da temporada (nota do jogo só enquanto não há média)
function gain(p,nota,media,rnd=Math.random){const r=media==null?nota:media;const b=base(r);if(!b)return 0;
 return b*ageF(p.age)*gapF((+p.potential||p.overall)-p.overall)*(0.6+0.8*rnd());}
async function afterRound(db,room,comp){
 const ms=(await db.query('SELECT details FROM matches WHERE comp_id=$1 AND round=$2 AND played',[comp.id,comp.current_round])).rows;
 const rt=new Map();for(const m of ms)for(const [id,v] of Object.entries(m.details?.ratings||{}))if(+id>0&&v!=null)rt.set(+id,+v);
 if(!rt.size)return [];
 const ids=[...rt.keys()];
 // Robson 03/11: jogador sem linha em room_players (nunca negociado) também evolui -> cria a linha com o clube base do universo
 const U=require('better-sqlite3')(__dirname+'/data/game.db',{readonly:true});const bq=U.prepare('SELECT club_id,overall,potential,age FROM players WHERE id=?');
 const have=new Set((await db.query('SELECT player_id FROM room_players WHERE room_id=$1 AND player_id=ANY($2::int[])',[room.id,ids])).rows.map(x=>x.player_id));
 const miss=ids.filter(i=>!have.has(i)).map(i=>[i,bq.get(i)]).filter(x=>x[1]&&x[1].club_id);
 if(miss.length)await db.query('INSERT INTO room_players(room_id,player_id,club_id) SELECT $1,u.p,u.c FROM unnest($2::int[],$3::int[]) u(p,c) ON CONFLICT DO NOTHING',[room.id,miss.map(x=>x[0]),miss.map(x=>x[1].club_id)]);
 const ps=(await db.query('SELECT p.player_id,p.overall,p.potential,p.age,p.evo_acc,p.ovr_start,s.apps,s.rating_sum FROM room_players p LEFT JOIN player_stats s ON s.comp_id=$2 AND s.player_id=p.player_id WHERE p.room_id=$1 AND p.player_id=ANY($3::int[])',[room.id,comp.id,ids])).rows;
 const up=[];
 // Robson 03/11: linha de override sem overall (contratados) virava 0 com +null; usa o valor base do universo
 for(const p of ps){const b=bq.get(p.player_id)||{};for(const k of ['overall','potential','age'])if(!(+p[k]>0))p[k]=b[k];}U.close();
 for(const p of ps){if(!(+p.overall>0))continue;if(VAL.frozen(p))continue;if(+p.overall>=(+p.potential||0))continue;const media=p.apps?p.rating_sum/p.apps:null;let acc=(+p.evo_acc||0)+gain(p,rt.get(p.player_id),media);let ov=+p.overall;
  while(acc>=1){const n=VAL.capOverall(p,ov+1);if(n<=ov){acc=0;break;}ov=n;acc-=1;}
  const mv=ov!==+p.overall?VAL({...p,overall:ov}):null;
  await db.query('UPDATE room_players SET evo_acc=$3,ovr_start=COALESCE(ovr_start,$4),overall=$5,market_value=COALESCE($6,market_value) WHERE room_id=$1 AND player_id=$2',[room.id,p.player_id,acc,+p.overall,ov,mv]);
  if(ov>+p.overall)up.push(p.player_id);}
 return up.length?[{info:`📈 ${up.length} jogador(es) evoluíram nesta rodada.`}]:[];}
module.exports={frozen:VAL.frozen,applyOverall:VAL.capOverall,enabled:true,base,ageF,gapF,gain,
 description:'Evolução natural, jogo a jogo, pela MÉDIA de nota na temporada: abaixo de 6,00 não evolui; 6,00–6,35 lenta (~0,04 over/jogo); 6,35–6,75 boa (~0,08); 6,75–7,25 muito boa (~0,13); 7,25+ a mais rápida (~0,18). Valores para jovem longe do potencial; quanto mais velho ou perto do potencial, menos evolui; acima de 33 anos não evolui. Variação aleatória de ±40% por jogo. Nunca regride, nunca passa do potencial; quem não joga não evolui.',
 afterRound};
