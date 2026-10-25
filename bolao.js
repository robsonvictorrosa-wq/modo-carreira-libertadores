// Bolão da sala: palpite de placar exato. Pontos (mesmas regras dos bolões do Robson):
// resultado certo (vencedor/empate) = 1; placar exato (cravada) = 3 (não acumula). Desempate: cravadas → resultados → apelido.
// Mata-mata: vale o placar do jogo (90'), não agregado nem pênaltis.
module.exports=({app,uni,q,pool,auth,wrap,fail,member})=>{
 const cname=id=>uni.prepare('SELECT name FROM clubs WHERE id=?').get(id)?.name;
 const pts=(p,m)=>{if(!m.played)return null;if(p.hg===m.hg&&p.ag===m.ag)return 3;return Math.sign(p.hg-p.ag)===Math.sign(m.hg-m.ag)?1:0;};
 app.get('/api/rooms/:code/bolao',auth,wrap(async(r,s)=>{const room=await member(r);const [comp]=await q('SELECT * FROM competitions WHERE room_id=$1 AND season=$2 ORDER BY id LIMIT 1',[room.id,room.season]);
  if(!comp)return s.json({open:[],ranking:[],last:[]});
  const open=await q('SELECT id,round,home,away,stage,leg FROM matches WHERE comp_id=$1 AND round=$2 AND NOT played ORDER BY tie NULLS LAST,id',[comp.id,comp.current_round+1]);
  const mine=new Map((await q('SELECT match_id,hg,ag FROM bolao WHERE room_id=$1 AND user_id=$2',[room.id,r.user.id])).map(x=>[x.match_id,x]));
  const all=await q('SELECT b.*,u.nick,m.hg mhg,m.ag mag,m.played,m.round FROM bolao b JOIN users u ON u.id=b.user_id JOIN matches m ON m.id=b.match_id WHERE b.room_id=$1',[room.id]);
  const R={};for(const b of all){const x=R[b.user_id]??={nick:b.nick,pts:0,cravadas:0,resultados:0,palpites:0};x.palpites++;const p=pts(b,{hg:b.mhg,ag:b.mag,played:b.played});if(p===3)x.cravadas++;if(p===1)x.resultados++;x.pts+=p||0;}
  const ranking=Object.values(R).sort((a,b)=>b.pts-a.pts||b.cravadas-a.cravadas||b.resultados-a.resultados||a.nick.localeCompare(b.nick));
  const lr=comp.current_round;const last=await q('SELECT id,home,away,hg,ag FROM matches WHERE comp_id=$1 AND round=$2 AND played AND id IN (SELECT match_id FROM bolao WHERE room_id=$3) ORDER BY id',[comp.id,lr,room.id]);
  const byM={};all.filter(b=>b.round===lr).forEach(b=>(byM[b.match_id]??=[]).push({nick:b.nick,hg:b.hg,ag:b.ag,pts:pts(b,{hg:b.mhg,ag:b.mag,played:true})}));
  s.json({round:comp.current_round+1,open:open.map(m=>({...m,home_name:cname(m.home),away_name:cname(m.away),mine:mine.get(m.id)||null})),ranking,last:last.map(m=>({...m,home_name:cname(m.home),away_name:cname(m.away),palpites:byM[m.id]||[]}))});}));
 app.post('/api/rooms/:code/bolao',auth,wrap(async(r,s)=>{const room=await member(r);const ps=(r.body?.palpites||[]).filter(p=>Number.isInteger(+p.hg)&&Number.isInteger(+p.ag)&&+p.hg>=0&&+p.ag>=0&&+p.hg<20&&+p.ag<20);
  if(!ps.length)throw fail('Nenhum palpite válido');let n=0;
  for(const p of ps){const ok=(await q('SELECT 1 FROM matches m JOIN competitions c ON c.id=m.comp_id WHERE m.id=$1 AND c.room_id=$2 AND NOT m.played',[+p.match_id,room.id])).length;if(!ok)continue;
   await q('INSERT INTO bolao(room_id,match_id,user_id,hg,ag) VALUES($1,$2,$3,$4,$5) ON CONFLICT(room_id,match_id,user_id) DO UPDATE SET hg=$4,ag=$5,updated_at=now()',[room.id,+p.match_id,r.user.id,+p.hg,+p.ag]);n++;}
  s.json({ok:1,saved:n});}));
};
