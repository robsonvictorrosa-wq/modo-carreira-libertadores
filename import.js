// Importa data/fc27.json -> data/game.db
const fs=require('fs'),D=require('better-sqlite3');
const src=JSON.parse(require('zlib').gunzipSync(fs.readFileSync(__dirname+'/data/fc27.json.gz')).toString('utf8'));
if(fs.existsSync(__dirname+'/data/game.db'))fs.unlinkSync(__dirname+'/data/game.db');
const db=new D(__dirname+'/data/game.db');
db.exec(fs.readFileSync(__dirname+'/schema.sql','utf8'));
const money=s=>{if(!s)return null;s=String(s).replace(/[\s\u00a0€]/g,'').replace(',','.');s=s.replace(/mil/i,'K');const m=s.match(/^([\d.]+)([KMB]?)/i);if(!m)return null;return Math.round(parseFloat(m[1])*({K:1e3,M:1e6,B:1e9}[m[2].toUpperCase()]||1));};
const P=src.players;
const CONMEBOL=new Set(['CONMEBOL Libertadores','CONMEBOL Sudamericana']);
const LEAGUE_META={'LALIGA EA SPORTS':['Espanha',1],'LALIGA HYPERMOTION':['Espanha',2],'Premier League':['Inglaterra',1],'EFL Championship':['Inglaterra',2],'EFL League One':['Inglaterra',3],'EFL League Two':['Inglaterra',4],'Bundesliga':['Alemanha',1],'Bundesliga 2':['Alemanha',2],'3. Liga':['Alemanha',3],'Serie A Enilive':['Itália',1],'Serie BKT':['Itália',2],"Ligue 1 McDonald's":['França',1],'Ligue 2 BKT':['França',2],'Liga Portugal':['Portugal',1],'Eredivisie':['Holanda',1],'1A Pro League':['Bélgica',1],'Trendyol Süper Lig':['Turquia',1],'Scottish Premiership':['Escócia',1],'ROSHN Saudi League':['Arábia Saudita',1],'Major League Soccer':['EUA',1],'Liga BBVA MX':['México',1],'Liga Profesional de Fútbol':['Argentina',1],'Eliteserien':['Noruega',1],'Allsvenskan':['Suécia',1],'3F Superliga':['Dinamarca',1],'SUPERLIGA':['Romênia',1],'Brack Super League':['Suíça',1],'Österreichische Fußball-Bundesliga':['Áustria',1],'PKO Bank Polski Ekstraklasa':['Polônia',1],'K League 1':['Coreia do Sul',1],'Chinese Football Association Super League':['China',1],'Isuzu UTE A-League':['Austrália',1],'Indian Super League':['Índia',1],"SSE Airtricity Men's Premier Division":['Irlanda',1]};
const WOMEN=new Set(["National Women's Soccer League",'Google Pixel Frauen-Bundesliga','Arkema Première Ligue','Barclays Women’s Super League','Liga F Moeve','Resto do mundo feminina']);
// clube -> país (CONMEBOL) pela nacionalidade majoritária
const ck=p=>p.club+'|'+(p.gender==='Mulher'?'F':'M');const byClub={};for(const p of P){if(!p.club)continue;(byClub[ck(p)]??={name:p.club,n:{},league:p.league,g:p.gender,players:[]}).players.push(p);const o=byClub[ck(p)];o.n[p.nationality]=(o.n[p.nationality]||0)+1;}
const leagueOf=c=>{const o=byClub[c];if(!o.league)return 'Sem clube (Livres)';if(!CONMEBOL.has(o.league))return o.league;const top=Object.entries(o.n).sort((a,b)=>b[1]-a[1])[0][0];return top==='Brasil'?'Brasileirão (CONMEBOL)':'CONMEBOL – '+top;};
const leagues={};const insL=db.prepare('INSERT INTO leagues(name,country,tier,gender,kind,original_name) VALUES(?,?,?,?,?,?)');
const getL=(name,orig,g)=>{if(leagues[name])return leagues[name];let country='Internacional',tier=1,kind='league';
 if(LEAGUE_META[name])[country,tier]=LEAGUE_META[name];else if(name.startsWith('Brasileirão')){country='Brasil';kind='conmebol';}else if(name.startsWith('CONMEBOL – ')){country=name.slice(11);kind='conmebol';}else if(name.startsWith('Resto do mundo'))kind='rest';else if(name==='Sem clube (Livres)')kind='free';else if(name.includes('Master'))kind='special';
 return leagues[name]=insL.run(name,country,tier,WOMEN.has(name)?'F':g==='Mulher'?'F':'M',kind,orig).lastInsertRowid;};
const insC=db.prepare('INSERT INTO clubs(name,league_id) VALUES(?,?)');
const insP=db.prepare(`INSERT INTO players(id,name,nationality,club_id,base_club_id,positions,primary_position,overall,potential,age,height_cm,weight_kg,preferred_foot,weak_foot,skill_moves,gender,market_value,wage,release_clause,contract_end,stats) VALUES(@id,@name,@nationality,@club_id,@club_id,@positions,@primary_position,@overall,@potential,@age,@height_cm,@weight_kg,@preferred_foot,@weak_foot,@skill_moves,@gender,@mv,@wg,@rc,@contract_end,@stats)`);
db.transaction(()=>{const clubId={};
 for(const c of Object.keys(byClub)){const o=byClub[c];clubId[c]=insC.run(o.name,getL(leagueOf(c),o.league,o.g)).lastInsertRowid;}
 for(const p of P){const cid=p.club?clubId[ck(p)]:null;
  {const PO=(JSON.parse(fs.readFileSync(__dirname+'/config/libertadores.json','utf8')).player_overrides||{})[p.id];if(PO)for(const k of ['overall','potential','age'])if(PO[k]!=null)p[k]=PO[k];}if((+p.age||0)>33||p.potential==null||p.potential<p.overall)p.potential=p.overall;insP.run({...p,club_id:cid,positions:JSON.stringify(p.positions||[]),mv:require('./value')(p),wg:money(p.wage_display),rc:money(p.release_clause_display),stats:JSON.stringify(p.stats||{})});}
})();
db.exec(`UPDATE clubs SET n_players=(SELECT count(*) FROM players WHERE club_id=clubs.id),
 squad_value=(SELECT coalesce(sum(market_value),0) FROM players WHERE club_id=clubs.id),
 wage_bill=(SELECT coalesce(sum(wage),0) FROM players WHERE club_id=clubs.id),
 overall=(SELECT round(avg(overall),1) FROM (SELECT overall FROM players WHERE club_id=clubs.id AND overall IS NOT NULL ORDER BY overall DESC LIMIT 11)),
 budget=(SELECT coalesce(sum(market_value),0)/8 FROM players WHERE club_id=clubs.id)`);
console.log(db.prepare('select count(*) n from players').get(),db.prepare('select count(*) n from clubs').get(),db.prepare('select count(*) n from leagues').get());
console.log(db.prepare("select name,(select count(*) from clubs where league_id=leagues.id) c from leagues where kind='conmebol'").all());
// ===== Libertadores ZC: aplica config/libertadores.json =====
{const CF=JSON.parse(fs.readFileSync(__dirname+'/config/libertadores.json','utf8'));
 const lg=db.prepare("INSERT INTO leagues(name,country,tier,gender,kind) VALUES('Libertadores ZC – clubes fora do FC27','Vários',1,'Homem','conmebol')").run().lastInsertRowid;
 const g=db.prepare("SELECT gender FROM leagues WHERE id=(SELECT league_id FROM clubs WHERE name='Flamengo')").get();if(g)db.prepare('UPDATE leagues SET gender=? WHERE id=?').run(g.gender,lg);
 const miss=[];db.transaction(()=>{for(const c of CF.clubs){let id=null;
  if(c.db){const r=db.prepare("SELECT c.id FROM clubs c JOIN leagues l ON l.id=c.league_id WHERE c.name=? AND l.kind!='free' ORDER BY (SELECT count(*) FROM players WHERE club_id=c.id) DESC").get(c.db);id=r?.id;}
  if(!id){id=db.prepare('INSERT INTO clubs(name,league_id) VALUES(?,?)').run(c.name,lg).lastInsertRowid;miss.push(c.name);}
  else db.prepare('UPDATE clubs SET name=? WHERE id=?').run(c.name,id);
  if(c.squad==='empty')db.prepare('DELETE FROM players WHERE club_id=?').run(id); // elenco vazio provisório
  const empty=!db.prepare('SELECT 1 FROM players WHERE club_id=?').get(id);
  db.prepare('UPDATE clubs SET budget=?,wage_bill=?,n_players=(SELECT count(*) FROM players WHERE club_id=clubs.id),squad_value=(SELECT coalesce(sum(market_value),0) FROM players WHERE club_id=clubs.id),overall=coalesce(?,overall) WHERE id=?').run(c.budget??CF.default_budget,c.wage_budget??CF.default_wage_budget,empty?CF.placeholder_ovr:null,id);
  c.id=id;}})();
 db.exec('CREATE TABLE lib_clubs(ord INT,club_id INT,name TEXT,country TEXT,squad TEXT)');const ins=db.prepare('INSERT INTO lib_clubs VALUES(?,?,?,?,?)');CF.clubs.forEach((c,i)=>ins.run(i,c.id,c.name,c.country,c.squad));
 console.log('Libertadores ZC: 40 clubes; fora do FC27 (criados vazios):',miss.join(', '));}
