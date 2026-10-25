// Estado efetivo dos jogadores por sala = universo (SQLite, só leitura) + overrides copy-on-write (Postgres room_players)
const S=require('./sim'),VAL=require('./value');
module.exports=uni=>{
 const P=new Map(),byClub=new Map(),C=new Map(),L=new Map();
 for(const l of uni.prepare('SELECT * FROM leagues').all())L.set(l.id,{...l,attr:0});
 for(const c of uni.prepare('SELECT id,name,league_id,overall,budget,wage_bill,squad_value FROM clubs').all()){const l=L.get(c.league_id);C.set(c.id,{...c,gender:l.gender,kind:l.kind,country:l.country});}
 for(const p of uni.prepare('SELECT id,name,nationality,club_id,primary_position,positions,overall,potential,age,market_value,wage,contract_end,gender FROM players').all()){p.market_value=VAL(p);P.set(p.id,p);if(!byClub.has(p.club_id))byClub.set(p.club_id,[]);byClub.get(p.club_id).push(p.id);}
 // atratividade da liga = média do OVR dos clubes (ligas "resto"/livres = neutras)
 for(const l of L.values()){const cs=[...C.values()].filter(c=>c.league_id===l.id&&c.overall);l.attr=cs.length?cs.reduce((a,c)=>a+c.overall,0)/cs.length:60;}
 const FREE={M:[...C.values()].find(c=>c.kind==='free'&&c.gender==='M')?.id,F:[...C.values()].find(c=>c.kind==='free'&&c.gender==='F')?.id};
 const isFree=id=>id===FREE.M||id===FREE.F;
 const CLAUSE_C=new Set(['Espanha','Portugal','Brasil']);
 const defClause=(p,club)=>{const c=C.get(club);if(!c||isFree(club))return null;if(c.country==='Espanha')return Math.round(p.market_value*4/1e5)*1e5||null;if(CLAUSE_C.has(c.country)||c.kind==='conmebol')return Math.round(p.market_value*3/1e5)*1e5||null;return null;};
 const merge=(p,o)=>{if(!p)return null;const e={...p};if(o)for(const k of ['club_id','overall','potential','age','wage','market_value','contract_end','release_clause','morale','wants_out','listed','loan_from','role'])if(o[k]!=null)e[k]=typeof o[k]==='string'&&/^\d+$/.test(o[k])?+o[k]:o[k];
  e.market_value=VAL(e);e.release_clause=o&&o.release_clause!=null?+o.release_clause:defClause(e,e.club_id);if(e.morale==null)e.morale=70;e.wants_out=!!e.wants_out;e.listed=!!e.listed;return e;};
 const full=id=>{const p=uni.prepare('SELECT * FROM players WHERE id=?').get(id);return p&&{...p,positions:JSON.parse(p.positions||'[]'),stats:JSON.parse(p.stats||'{}')};};
 // elenco efetivo de um clube numa sala (com atributos completos para o motor)
 async function squad(db,roomId,clubId,withStats=true){const base=byClub.get(clubId)||[];
  const ov=(await db.query('SELECT * FROM room_players WHERE room_id=$1 AND (club_id=$2 OR player_id=ANY($3))',[roomId,clubId,base])).rows;const om=new Map(ov.map(o=>[o.player_id,o]));
  const ids=base.filter(id=>!om.has(id)).concat(ov.filter(o=>o.club_id===clubId).map(o=>o.player_id));
  return ids.map(id=>{const e=merge(withStats?full(id):P.get(id),om.get(id));if(e.wants_out)e.overall=Math.max(40,e.overall-2);return e;});}
 // estado completo da sala em memória (para o mercado dos bots)
 async function world(db,roomId){const ov=(await db.query('SELECT * FROM room_players WHERE room_id=$1',[roomId])).rows;const om=new Map(ov.map(o=>[o.player_id,o]));
  const players=new Map(),clubs=new Map();for(const [id,p] of P){const e=merge(p,om.get(id));players.set(id,e);}
  for(const c of C.values())clubs.set(c.id,{...c,squad:[]});for(const p of players.values())clubs.get(p.club_id)?.squad.push(p);
  const rc=(await db.query('SELECT club_id,budget,wage_budget FROM room_clubs WHERE room_id=$1',[roomId])).rows;for(const r of rc){const c=clubs.get(r.club_id);if(c){c.budget=+r.budget;c.wage_budget=+r.wage_budget;}}
  for(const c of clubs.values()){c.squad.sort((a,b)=>b.overall-a.overall);c.wage_bill=c.squad.reduce((a,p)=>a+(p.wage||0),0);c.xiavg=c.squad.slice(0,11).reduce((a,p)=>a+p.overall,0)/Math.max(1,Math.min(11,c.squad.length));}
  return {players,clubs,om};}
 async function player(db,roomId,id){const [o]=(await db.query('SELECT * FROM room_players WHERE room_id=$1 AND player_id=$2',[roomId,id])).rows;return merge(full(id),o);}
 return {P,C,L,FREE,isFree,squad,world,player,merge,defClause,byClub,full};
};
