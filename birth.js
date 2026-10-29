// Idade sempre derivada da data de nascimento (FC27 birth_date; elencos brasileiros = Transfermarkt). Aniversários atualizam sozinhos.
const fs=require('fs'),zlib=require('zlib');let B=null;
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const CLUB_ALIAS={atleticomg:'atleticomineiro'};
function load(uni){if(B)return B;B=new Map();
 try{const src=JSON.parse(zlib.gunzipSync(fs.readFileSync(__dirname+'/data/fc27.json.gz')).toString('utf8'));for(const p of src.players||[])if(p.birth_date)B.set(+p.id,String(p.birth_date).slice(0,10));}catch(e){console.error('birth fc27',e.message)}
 try{const el=JSON.parse(fs.readFileSync(__dirname+'/config/elencos-brasileiros.json','utf8')).players||[];const m=new Map();
  for(const p of el)if(p.birthdate){const c=norm(p.club);m.set((CLUB_ALIAS[c]||c)+'|'+norm(p.name),p.birthdate);}
  if(uni)for(const r of uni.prepare('SELECT p.id,p.name,c.name club FROM players p JOIN clubs c ON c.id=p.base_club_id WHERE p.id>=95000000 AND p.id<96000000').all()){const d=m.get(norm(r.club)+'|'+norm(r.name));if(d)B.set(r.id,d);}}catch(e){console.error('birth br',e.message)}
 try{(JSON.parse(fs.readFileSync(__dirname+'/config/leilao-surpresa.json','utf8')).players||[]).forEach((p,i)=>{if(p.dob&&!p.id)B.set(96100000+i,p.dob);});}catch(e){console.error('birth surpresa',e.message)} // criados do leilão surpresa (data real)
 return B;}
// hoje no fuso de São Paulo
const today=()=>new Date(Date.now()-3*3600e3).toISOString().slice(0,10);
function ageOf(id,ref){const d=B&&B.get(+id);if(!d)return null;const [y,m,dd]=d.split('-').map(Number);const [ty,tm,td]=(ref||today()).split('-').map(Number);return ty-y-((tm<m||(tm===m&&td<dd))?1:0);}
module.exports={load,ageOf,birth:id=>B&&B.get(+id)};
