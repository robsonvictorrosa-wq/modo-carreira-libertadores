const express=require('express'),D=require('better-sqlite3'),path=require('path');
const db=new D(path.join(__dirname,'data/game.db'),{readonly:true});
const app=express();app.use(require('compression')());app.use(express.json());app.use(express.static(path.join(__dirname,'public'),{setHeaders:(r,f)=>{if(/\.(js|css|html|webmanifest)$/.test(f))r.setHeader('Cache-Control','no-cache');else if(/crests|icons|\.png$/.test(f))r.setHeader('Cache-Control','public, max-age=604800');}}));
const BD=require('./birth');const parse=p=>{if(!p)return p;BD.load(db);const a=BD.ageOf(p.id);return {...p,age:a!=null?a:p.age,birth_date:BD.birth(p.id)||null,positions:JSON.parse(p.positions),stats:JSON.parse(p.stats)};};
app.get('/api/health',(q,r)=>r.json({ok:true}));
app.get('/api/leagues',(q,r)=>r.json(db.prepare(`SELECT l.*,count(c.id) n_clubs,round(avg(c.overall),1) overall,sum(c.squad_value) value FROM leagues l JOIN clubs c ON c.league_id=l.id GROUP BY l.id ORDER BY CASE l.kind WHEN 'conmebol' THEN 1 WHEN 'league' THEN 0 ELSE 2 END,l.gender DESC,overall DESC`).all()));
app.get('/api/leagues/:id/clubs',(q,r)=>r.json({league:db.prepare('SELECT * FROM leagues WHERE id=?').get(q.params.id),clubs:db.prepare('SELECT * FROM clubs WHERE league_id=? ORDER BY overall DESC').all(q.params.id)}));
app.get('/api/clubs/:id',(q,r)=>{const c=db.prepare('SELECT c.*,l.name league FROM clubs c JOIN leagues l ON l.id=c.league_id WHERE c.id=?').get(q.params.id);if(!c)return r.status(404).json({});
 c.players=db.prepare('SELECT * FROM players WHERE club_id=? ORDER BY overall DESC').all(q.params.id).map(parse);r.json(c);});
app.get('/api/players/search',(q,r)=>{const s=(q.query.q||'').trim();const w=[],a=[];
 if(s){w.push("(p.name LIKE ? OR p.nationality LIKE ?)");a.push('%'+s+'%','%'+s+'%');}
 if(q.query.pos){w.push('p.primary_position=?');a.push(q.query.pos);}
 if(q.query.minOvr){w.push('p.overall>=?');a.push(+q.query.minOvr);}
 if(q.query.maxAge){w.push('p.age<=?');a.push(+q.query.maxAge);}
 const order={overall:'p.overall DESC',potential:'p.potential DESC',value:'p.market_value DESC',age:'p.age ASC'}[q.query.sort]||'p.overall DESC';
 r.json(db.prepare(`SELECT p.*,c.name club,l.name league FROM players p LEFT JOIN clubs c ON c.id=p.club_id LEFT JOIN leagues l ON l.id=c.league_id ${w.length?'WHERE '+w.join(' AND '):''} ORDER BY ${order} NULLS LAST LIMIT 100`).all(...a).map(parse));});
app.get('/api/players/:id',(q,r)=>r.json(parse(db.prepare('SELECT p.*,c.name club,l.name league FROM players p LEFT JOIN clubs c ON c.id=p.club_id LEFT JOIN leagues l ON l.id=c.league_id WHERE p.id=?').get(q.params.id))||{}));
app.get('/api/positions',(q,r)=>r.json(db.prepare('SELECT primary_position p,count(*) n FROM players WHERE primary_position IS NOT NULL GROUP BY 1 ORDER BY 2 DESC').all()));
app.get('/api/libertadores/clubs',(q,r)=>r.json({cfg:require('./libertadores').CFG,clubs:db.prepare('SELECT l.ord,l.club_id id,l.name,l.country,l.squad,c.overall,c.n_players,c.budget FROM lib_clubs l JOIN clubs c ON c.id=l.club_id ORDER BY l.ord').all()}));
require('./mp')(app,db);
const PORT=process.env.PORT||3027;app.listen(PORT,()=>console.log('Modo Carreira on',PORT));
if(process.env.MIGRATE_DST)setTimeout(()=>require('./scripts/migrate-neon.js')().catch(e=>console.log('[MIGR] ERRO',e.message)),3000);
