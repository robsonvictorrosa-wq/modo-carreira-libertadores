// Importa data/fc27.json -> data/game.db
const fs=require('fs'),D=require('better-sqlite3');
const src=JSON.parse(require('zlib').gunzipSync(fs.readFileSync(__dirname+'/data/fc27.json.gz')).toString('utf8'));
if(fs.existsSync(__dirname+'/data/game.db'))fs.unlinkSync(__dirname+'/data/game.db');
const db=new D(__dirname+'/data/game.db');
db.exec(fs.readFileSync(__dirname+'/schema.sql','utf8'));
const money=s=>{if(!s)return null;s=String(s).replace(/[\s\u00a0€]/g,'').replace(',','.');s=s.replace(/mil/i,'K');const m=s.match(/^([\d.]+)([KMB]?)/i);if(!m)return null;return Math.round(parseFloat(m[1])*({K:1e3,M:1e6,B:1e9}[m[2].toUpperCase()]||1));};
const P=src.players;for(const p of P)if(p.name)p.name=p.name.replace(/\s*\*+\s*$/,"").replace(/\*/g,""); // remove marcador "*" (emprestado no FC27)
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
  if(!id&&c.players){const src=db.prepare("SELECT c.id,c.league_id FROM clubs c WHERE c.name=? ORDER BY (SELECT count(*) FROM players WHERE club_id=c.id) DESC").get(c.split_from);id=db.prepare('INSERT INTO clubs(name,league_id) VALUES(?,?)').run(c.name,lg).lastInsertRowid;
   const mv=db.prepare('UPDATE players SET club_id=?,base_club_id=? WHERE id=? AND club_id=?');let n=0;for(const pid of c.players)n+=mv.run(id,id,pid,src.id).changes;
   db.prepare('UPDATE clubs SET n_players=(SELECT count(*) FROM players WHERE club_id=clubs.id),squad_value=(SELECT coalesce(sum(market_value),0) FROM players WHERE club_id=clubs.id),wage_bill=(SELECT coalesce(sum(wage),0) FROM players WHERE club_id=clubs.id) WHERE id=?').run(src.id);for(const k of [id,src.id])db.prepare('UPDATE clubs SET n_players=(SELECT count(*) FROM players WHERE club_id=clubs.id),squad_value=(SELECT coalesce(sum(market_value),0) FROM players WHERE club_id=clubs.id),wage_bill=(SELECT coalesce(sum(wage),0) FROM players WHERE club_id=clubs.id),overall=(SELECT round(avg(overall),1) FROM (SELECT overall FROM players WHERE club_id=clubs.id AND overall IS NOT NULL ORDER BY overall DESC LIMIT 11)) WHERE id=?').run(k);if(c.rename_source)db.prepare('UPDATE clubs SET name=? WHERE id=?').run(c.rename_source,src.id);console.log('split',c.name,'<-',c.split_from,n,'jogadores');}
  if(!id){id=db.prepare('INSERT INTO clubs(name,league_id) VALUES(?,?)').run(c.name,lg).lastInsertRowid;miss.push(c.name);}
  else db.prepare('UPDATE clubs SET name=? WHERE id=?').run(c.name,id);
  if(c.squad==='empty'||c.squad==='file')db.prepare('DELETE FROM players WHERE club_id=?').run(id); // elenco vazio provisório
  const empty=!db.prepare('SELECT 1 FROM players WHERE club_id=?').get(id);
  db.prepare('UPDATE clubs SET budget=?,wage_bill=?,n_players=(SELECT count(*) FROM players WHERE club_id=clubs.id),squad_value=(SELECT coalesce(sum(market_value),0) FROM players WHERE club_id=clubs.id),overall=coalesce(?,overall) WHERE id=?').run(c.budget??CF.default_budget,c.wage_budget??CF.default_wage_budget,empty?CF.placeholder_ovr:null,id);
  c.id=id;}})();
 // ===== Elencos brasileiros (config/elencos-brasileiros.json, enviado pelo Robson) =====
 {const BR=JSON.parse(fs.readFileSync(__dirname+'/config/elencos-brasileiros.json','utf8')).players;
  const CMAP={'Atlético-MG':'Atlético Mineiro'};
  const POS={'goleiro':'GOL','zagueiro':'ZAG','lateral-direito':'LD','lateral direito':'LD','lateral dir.':'LD','lateral-esquerdo':'LE','lateral esquerdo':'LE','lateral esq.':'LE','volante':'VOL','meia central':'MC','meia ofensivo':'MEI','meia-atacante':'MEI','ponta direita':'PD','ponta-direita':'PD','ponta esquerda':'PE','ponta-esquerda':'PE','centroavante':'ATA','segundo atacante':'ATA'};
  // salário: mediana do FC27 por overall nos clubes brasileiros do FC27
  const wq=db.prepare("SELECT p.overall o,p.wage w FROM players p JOIN clubs c ON c.id=p.club_id JOIN leagues l ON l.id=c.league_id WHERE l.name='Brasileirão (CONMEBOL)' AND p.wage>0").all();
  const wageOf=o=>{for(let d=0;d<10;d++){const ws=wq.filter(r=>Math.abs(r.o-o)<=d).map(r=>r.w).sort((a,b)=>a-b);if(ws.length>=5)return ws[ws.length>>1];}return 20000;};
  // idade/nacionalidade reais (Transfermarkt) no arquivo; sem idade: estimada pela diferença potencial-overall
  const ageOf=(o,p)=>{const g=p-o;return g>=10?19:g>=7?21:g>=4?23:g>=2?25:g>=1?27:30;};
  const ins=db.prepare(`INSERT INTO players(id,name,nationality,club_id,base_club_id,positions,primary_position,overall,potential,age,gender,market_value,wage,contract_end,stats) VALUES(?,?,?,?,?,?,?,?,?,?,'Homem',?,?,2028,'{}')`);
  const byName=Object.fromEntries(CF.clubs.filter(c=>c.country==='Brasil').map(c=>[c.name,c.id]));const skip={};
  db.transaction(()=>{BR.forEach((p,i)=>{const cid=byName[CMAP[p.club]||p.club];if(!cid){skip[p.club]=(skip[p.club]||0)+1;return;}
   const pos=POS[String(p.position).toLowerCase().trim()];if(!pos)throw new Error('posição desconhecida: '+p.position);
   const o=+p.ovr,pt=Math.max(o,+p.potential||o),age=p.age!=null?+p.age:ageOf(o,pt);const pl={overall:o,potential:age>33?o:pt,age};
   const pss=[pos,...(p.positions_sofascore||[]).filter(x=>x!==pos)]; // várias posições (Sofascore)
   ins.run(95000000+i,p.name,p.nationality||'Brasil',cid,cid,JSON.stringify(pss),pos,o,pl.potential,age,require('./value')(pl),wageOf(o));});
   for(const id of Object.values(byName))db.prepare('UPDATE clubs SET n_players=(SELECT count(*) FROM players WHERE club_id=clubs.id),squad_value=(SELECT coalesce(sum(market_value),0) FROM players WHERE club_id=clubs.id),overall=coalesce((SELECT round(avg(overall),1) FROM (SELECT overall FROM players WHERE club_id=clubs.id ORDER BY overall DESC LIMIT 11)),overall) WHERE id=?').run(id);})();
  console.log('Elencos brasileiros: fora da liga (ignorados):',JSON.stringify(skip));}
 // ===== Primeiro leilão (config/leilao-pre.json, lista do Robson): jogadores saem dos clubes e ficam no clube técnico "Leilão ZC" =====
 {const AU=JSON.parse(fs.readFileSync(__dirname+'/config/leilao-pre.json','utf8')).players;const VAL=require('./value');
  const auc=db.prepare('INSERT INTO clubs(name,league_id) VALUES(?,?)').run('Leilão ZC',lg).lastInsertRowid;db.exec('CREATE TABLE lib_auction(ord INT,player_id INT,stage TEXT)');
  db.transaction(()=>{AU.forEach((a,i)=>{const pl={overall:a.ovr,potential:a.pot,age:a.age};const mv=VAL(pl);let id=a.id;
   if(id&&db.prepare('SELECT 1 FROM players WHERE id=?').get(id)){const old=JSON.parse(db.prepare('SELECT positions FROM players WHERE id=?').get(id).positions||'[]');
    db.prepare('UPDATE players SET name=?,nationality=?,club_id=?,base_club_id=?,primary_position=?,positions=?,overall=?,potential=?,age=?,market_value=? WHERE id=?').run(a.name,a.nat,auc,auc,a.pos,JSON.stringify([a.pos,...old.filter(x=>x!==a.pos)]),a.ovr,a.pot,a.age,mv,id);}
   else{id=96000000+i;const st=a.stats_from&&db.prepare('SELECT stats,wage,height_cm,weight_kg,preferred_foot,weak_foot,skill_moves FROM players WHERE id=?').get(a.stats_from)||{};
    db.prepare(`INSERT INTO players(id,name,nationality,club_id,base_club_id,positions,primary_position,overall,potential,age,height_cm,weight_kg,preferred_foot,weak_foot,skill_moves,gender,market_value,wage,contract_end,stats) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'Homem',?,?,2028,?)`).run(id,a.name,a.nat,auc,auc,JSON.stringify([a.pos]),a.pos,a.ovr,a.pot,a.age,st.height_cm??null,st.weight_kg??null,st.preferred_foot??null,st.weak_foot??null,st.skill_moves??null,mv,st.wage||50000,st.stats||'{}');}
   db.prepare("INSERT INTO lib_auction VALUES(?,?,'pre')").run(i,id);});
   db.prepare('UPDATE clubs SET n_players=(SELECT count(*) FROM players WHERE club_id=clubs.id)').run();})();
  console.log('Leilão de pré-temporada:',AU.length,'jogadores no clube Leilão ZC',auc);}
 // ===== Sorteio Libertadores ZC (config/sorteio-zc.json, aprovado pelo Robson): move jogadores existentes para o clube sorteado =====
 {const SZ=JSON.parse(fs.readFileSync(__dirname+'/config/sorteio-zc.json','utf8')).players;let n=0;
  db.transaction(()=>{for(const a of SZ)n+=db.prepare('UPDATE players SET club_id=?,base_club_id=? WHERE id=?').run(a.club_id,a.club_id,a.player_id).changes;
   db.prepare('UPDATE clubs SET n_players=(SELECT count(*) FROM players WHERE club_id=clubs.id)').run();})();
  console.log('Sorteio Libertadores ZC:',n,'jogadores movidos');}
 // ===== Potenciais corrigidos (config/potenciais-zc.json, lista do Robson): só o potencial =====
 {const PZ=JSON.parse(fs.readFileSync(__dirname+'/config/potenciais-zc.json','utf8')).players;let n=0;
  for(const a of PZ)n+=db.prepare('UPDATE players SET potential=? WHERE id=?').run(a.potential,a.player_id).changes;
  console.log('Potenciais corrigidos:',n);}
 db.exec('CREATE TABLE lib_clubs(ord INT,club_id INT,name TEXT,country TEXT,squad TEXT)');const ins=db.prepare('INSERT INTO lib_clubs VALUES(?,?,?,?,?)');CF.clubs.forEach((c,i)=>ins.run(i,c.id,c.name,c.country,c.squad));
 console.log('Libertadores ZC: 40 clubes; fora do FC27 (criados vazios):',miss.join(', '));}
