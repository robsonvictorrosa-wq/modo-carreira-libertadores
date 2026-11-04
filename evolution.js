// Evolução dos jogadores – Libertadores ZC (regras do Robson, 04/11).
// A cada jogo disputado o jogador acumula uma fração de over (evo_acc); ao passar de 1.0 sobe 1 over.
// Ganho por jogo = faixa da MÉDIA de nota × idade × distância ao potencial × variação (±40%).
// Jovem (≤21) longe do potencial: 6,00–6,35 ~10–11 jogos por +1 · 6,35–6,75 ~7–8 · 6,75–7,25 ~5–6 · 7,25+ ~3–4. Abaixo de 6,00 não evolui.
// Idade: 24–25 leva ~1,25x · 26–27 ~1,5x · 30–31 ~2x; 33+ não evolui.
// Limite rígido: over nunca passa do potencial. O último ponto (falta 1) só com média 7,25+ (Excelente) e leva 4x mais.
// Nunca regride. O campo potencial nunca é alterado.
const VAL=require('./value');
const TIERS=[[7.25,0.29],[6.75,0.18],[6.35,0.135],[6.0,0.095]];
const EXC=7.25,NOEVO_AGE=33,VERSION='evo-0411';
function base(r){r=+r;if(!(r>=6))return 0;for(const [t,v] of TIERS)if(r>=t)return v;return 0;}
function ageF(a){a=+a||25;return a<=21?1:a<=23?0.9:a<=25?0.8:a<=27?0.667:a<=29?0.57:a<=31?0.5:a<=32?0.45:0;}
// distância ao potencial: 2+ = velocidade normal; último ponto (falta 1) só na fase Excelente e leva 4x
const gapF=(g,r)=>g<=0?0:g>=2?1:(r>=EXC?0.25:0);
const noEvo=p=>(+p.age||0)>=NOEVO_AGE;
const maxOv=(p)=>+p.potential||+p.overall; // teto rígido: nunca passa do potencial
// ganho de um jogo (media = média da temporada incluindo este jogo)
function gain(p,nota,media,rnd=Math.random){const r=media==null?nota:media;const b=base(r);if(!b||noEvo(p))return 0;
 const pot=+p.potential||+p.overall,ov=+p.overall;if(ov>=maxOv(p,r))return 0;
 return b*ageF(p.age)*gapF(pot-ov,r)*(0.6+0.8*rnd());}
// aplica um jogo: devolve {ov,acc}; nunca regride, nunca passa do limite
function step(p,ov,acc,nota,media,rnd){const q={...p,overall:ov};const g=gain(q,nota,media,rnd);if(!g)return {ov,acc};acc+=g;
 while(acc>=1){if(ov+1>maxOv(p,media)){acc=0;break;}ov++;acc-=1;}if(ov>=maxOv(p,media))acc=0;return {ov,acc};}
const U0=()=>require('better-sqlite3')(__dirname+'/data/game.db',{readonly:true});
async function ensureRows(db,room,ids,bq){const have=new Set((await db.query('SELECT player_id FROM room_players WHERE room_id=$1 AND player_id=ANY($2::int[])',[room.id,ids])).rows.map(x=>x.player_id));
 const miss=ids.filter(i=>!have.has(i)).map(i=>[i,bq.get(i)]).filter(x=>x[1]&&x[1].club_id);
 if(miss.length)await db.query('INSERT INTO room_players(room_id,player_id,club_id) SELECT $1,u.p,u.c FROM unnest($2::int[],$3::int[]) u(p,c) ON CONFLICT DO NOTHING',[room.id,miss.map(x=>x[0]),miss.map(x=>x[1].club_id)]);}
async function afterRound(db,room,comp){
 const ms=(await db.query('SELECT details FROM matches WHERE comp_id=$1 AND round=$2 AND played',[comp.id,comp.current_round])).rows;
 const rt=new Map();for(const m of ms)for(const [id,v] of Object.entries(m.details?.ratings||{}))if(+id>0&&v!=null)rt.set(+id,+v);
 if(!rt.size)return [];const ids=[...rt.keys()];
 const U=U0();const bq=U.prepare('SELECT club_id,overall,potential,age FROM players WHERE id=?');
 await ensureRows(db,room,ids,bq);
 const ps=(await db.query('SELECT p.player_id,p.overall,p.potential,p.age,p.evo_acc,p.ovr_start,s.apps,s.rating_sum FROM room_players p LEFT JOIN player_stats s ON s.comp_id=$2 AND s.player_id=p.player_id WHERE p.room_id=$1 AND p.player_id=ANY($3::int[])',[room.id,comp.id,ids])).rows;
 for(const p of ps){const b=bq.get(p.player_id)||{};for(const k of ['overall','potential','age'])if(!(+p[k]>0))p[k]=b[k];}U.close();
 const up=[];
 for(const p of ps){if(!(+p.overall>0))continue;const media=p.apps?p.rating_sum/p.apps:null;const r=step(p,+p.overall,+p.evo_acc||0,rt.get(p.player_id),media);
  const mv=r.ov!==+p.overall?VAL({...p,overall:r.ov}):null;
  await db.query('UPDATE room_players SET evo_acc=$3,ovr_start=COALESCE(ovr_start,$4),overall=$5,market_value=COALESCE($6,market_value) WHERE room_id=$1 AND player_id=$2',[room.id,p.player_id,r.acc,+p.overall,r.ov,mv]);
  if(r.ov>+p.overall)up.push(p.player_id);}
 return up.length?[{info:`📈 ${up.length} jogador(es) evoluíram nesta rodada.`}]:[];}
// RNG determinístico (replay idempotente)
const seeded=s=>()=>{s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
// Robson 04/11: recalcula a evolução de todos desde a rodada 1 com as regras novas (uma vez por VERSION).
// Base = over original (ovr_start, senão over atual); resultado nunca abaixo da base nem do over atual (ninguém perde over). Potencial não é alterado.
async function replay(pool,compName){await pool.query('CREATE TABLE IF NOT EXISTS lib_migrations(name TEXT PRIMARY KEY,at TIMESTAMPTZ DEFAULT now())');
 if((await pool.query('SELECT 1 FROM lib_migrations WHERE name=$1',[VERSION])).rows.length){console.log('EVOREPLAY já aplicado',VERSION);return;}
 const comps=(await pool.query("SELECT DISTINCT ON (room_id) c.*,r.id rid FROM competitions c JOIN rooms r ON r.id=c.room_id WHERE c.name=$1 ORDER BY room_id,c.id DESC",[compName])).rows;
 const c=await pool.connect();let n=0,up=0;
 try{await c.query('BEGIN');const U=U0();const bq=U.prepare('SELECT club_id,overall,potential,age FROM players WHERE id=?');
  for(const comp of comps){const room={id:comp.room_id};
   const ms=(await c.query('SELECT id,round,details->\'ratings\' rt FROM matches WHERE comp_id=$1 AND played ORDER BY round,id',[comp.id])).rows;
   const games=new Map();for(const m of ms)for(const [id,v] of Object.entries(m.rt||{}))if(+id>0&&v!=null)(games.get(+id)||games.set(+id,[]).get(+id)).push(+v);
   const ids=[...games.keys()];if(!ids.length)continue;await ensureRows(c,room,ids,bq);
   const ps=(await c.query('SELECT player_id,overall,potential,age,ovr_start FROM room_players WHERE room_id=$1 AND player_id=ANY($2::int[])',[room.id,ids])).rows;
   for(const p of ps){const b=bq.get(p.player_id)||{};for(const k of ['overall','potential','age'])if(!(+p[k]>0))p[k]=b[k];if(!(+p.overall>0))continue;
    const cur=+p.overall,b0=+p.ovr_start>0?+p.ovr_start:cur;const rnd=seeded(p.player_id*7919+comp.id);let ov=b0,acc=0,sum=0,k=0;
    for(const nota of games.get(p.player_id)){k++;sum+=nota;const r=step(p,ov,acc,nota,sum/k,rnd);ov=r.ov;acc=r.acc;}
    const fin=Math.max(ov,b0,cur);/* ninguém perde over */if(fin>ov)acc=0;
    await c.query('UPDATE room_players SET evo_acc=$3,ovr_start=$4,overall=$5,market_value=$6 WHERE room_id=$1 AND player_id=$2',[room.id,p.player_id,acc,b0,fin,VAL({...p,overall:fin})]);
    n++;if(fin>cur)up++;}}
  U.close();await c.query('INSERT INTO lib_migrations(name) VALUES($1)',[VERSION]);await c.query('COMMIT');console.log('EVOREPLAY OK',n,'players',JSON.stringify({salas:comps.length,subiram:up,versao:VERSION}));}
 catch(e){await c.query('ROLLBACK');console.log('EVOREPLAY erro',e.message);}finally{c.release();}}
module.exports={frozen:noEvo,applyOverall:VAL.capOverall,enabled:true,base,ageF,gapF,gain,step,maxOv,replay,VERSION,
 description:'Evolução natural, jogo a jogo, pela MÉDIA de nota na temporada. Jovem (até 21) longe do potencial sobe +1 em: ~10–11 jogos com média 6,00–6,35; ~7–8 com 6,35–6,75; ~5–6 com 6,75–7,25; ~3–4 com 7,25+. Abaixo de 6,00 não evolui. Mais velho demora mais (24–25 ~1,25x, 26–27 ~1,5x, 30–31 ~2x); 33+ não evolui. O último ponto até o potencial só vem na fase Excelente (7,25+) e leva 4x mais. Nunca passa do potencial. Variação aleatória de ±40% por jogo. Ninguém perde over.',
 afterRound};
