// Números de camisa (1–99, únicos no clube) e cores do uniforme, por sala/clube.
// Defaults: números clássicos por posição; cores de config/kit-colors.json, senão branco/preto.
const fs=require('fs'),path=require('path');
const NAME='kits-1811';
const HEX=/^#([0-9a-fA-F]{6})$/;
const FALLBACK={primary:'#FFFFFF',secondary:'#111111',number:'#111111',gk_primary:'#1B5E20',gk_secondary:'#0D3B12',gk_number:'#FFFFFF'};
const PREF={
 GOL:[1,12,22,23,24],LD:[2,13,22,32],LE:[3,16,26,36],ZAG:[4,3,5,6,13,14,33,44],
 ADD:[2,13,23],ADE:[3,16,26],VOL:[5,6,8,15,18],MC:[8,5,16,18,14],MEI:[10,8,20,18],
 MD:[7,11,17,21],ME:[11,7,17,19],PD:[7,11,17,21],PE:[11,7,17,19],SA:[9,10,19,21],ATA:[9,10,19,21,99]
};
let COLORS=null;
function loadColors(){if(COLORS)return COLORS;try{COLORS=JSON.parse(fs.readFileSync(path.join(__dirname,'config/kit-colors.json'),'utf8')).clubs||{};}catch(e){COLORS={};}return COLORS;}
function parseColor(s,fallback){if(typeof s==='string'&&HEX.test(s.trim()))return '#'+s.trim().slice(1).toUpperCase();return fallback;}
function clubDefault(clubName,clubId){const C=loadColors();const k=C[clubName]||(clubId!=null&&C[String(clubId)])||null;return k?normalizeKit(k,FALLBACK):{...FALLBACK};}
function rowToKit(r){if(!r)return null;return {primary:r.primary_color,secondary:r.secondary_color,number:r.number_color,gk_primary:r.gk_primary,gk_secondary:r.gk_secondary,gk_number:r.gk_number};}
function normalizeKit(input,base){const d=base||FALLBACK;const src=input||{};
 return {primary:parseColor(src.primary,d.primary),secondary:parseColor(src.secondary,d.secondary),number:parseColor(src.number,d.number),
  gk_primary:parseColor(src.gk_primary,d.gk_primary),gk_secondary:parseColor(src.gk_secondary,d.gk_secondary),gk_number:parseColor(src.gk_number,d.gk_number)};}
function parseNumber(n){const v=Number(n);if(!Number.isInteger(v)||v<1||v>99)throw Object.assign(new Error('O número da camisa deve ser um inteiro de 1 a 99'),{status:400,expose:true});return v;}
const POSORD=['GOL','LD','LE','ZAG','ADD','ADE','VOL','MC','MEI','MD','ME','PD','PE','SA','ATA'];
function defaultNumbers(squad,saved){const out={},used=new Set();const list=[...squad||[]];
 for(const p of list){const id=p.id??p.player_id;const raw=saved&&(saved[id]??saved[String(id)]);if(raw==null)continue;try{const n=parseNumber(raw);if(used.has(n))continue;out[id]=n;used.add(n);}catch(e){}}
 const rest=list.filter(p=>out[p.id??p.player_id]==null).sort((a,b)=>{
  const pa=POSORD.indexOf(a.primary_position||a.pos),pb=POSORD.indexOf(b.primary_position||b.pos);
  const ia=pa<0?99:pa,ib=pb<0?99:pb;return ia-ib||(b.overall||0)-(a.overall||0);});
 for(const p of rest){const id=p.id??p.player_id;const prefs=PREF[p.primary_position||p.pos]||[];
  let n=prefs.find(x=>!used.has(x));if(!n){for(let i=1;i<=99;i++)if(!used.has(i)){n=i;break;}}
  if(n){out[id]=n;used.add(n);}}
 return out;}
function shirtError(msg,status){const e=new Error(msg);e.status=status||400;e.expose=true;throw e;}
function squadIds(squad){return new Set((squad||[]).map(p=>+(p.id??p.player_id)));}
// Valida o conjunto FINAL (elenco atual da sala). Permutas e trocas em lote entram de uma vez;
// números de ex-jogadores em `saved` são ignorados.
function setNumbers(squad,saved,items){
 const ids=squadIds(squad);
 const pending=[];
 for(const it of items||[]){
  const pid=+(it.player_id??it.id);
  if(!Number.isInteger(pid)||pid<=0)shirtError('Jogador inválido');
  if(!ids.has(pid))shirtError('Jogador fora do elenco');
  pending.push([pid,parseNumber(it.number)]);
 }
 const final=defaultNumbers(squad,saved||{});
 for(const [pid,n] of pending)final[pid]=n;
 const byNum=new Map();
 for(const p of squad||[]){
  const id=p.id??p.player_id;const n=final[id];
  if(n==null)continue;
  if(byNum.has(n))shirtError('Esse número já é de outro jogador do clube');
  byNum.set(n,id);
 }
 return final;
}
function setNumber(squad,saved,playerId,number){const all=setNumbers(squad,saved,[{player_id:playerId,number}]);return all[+playerId];}
// Substitui os números do clube na sala: apaga ex-jogadores e regrava o elenco atual numa tacada só (permite permuta).
async function writeShirts(exec,roomId,clubId,numbers){
 await exec('DELETE FROM room_shirts WHERE room_id=$1 AND club_id=$2',[roomId,clubId]);
 for(const [pid,n] of Object.entries(numbers||{})){
  await exec('INSERT INTO room_shirts(room_id,club_id,player_id,number) VALUES($1,$2,$3,$4)',[roomId,clubId,+pid,+n]);
 }
}

async function enrich(q,roomId,clubId,clubName,squad){
 // Cores: sempre o mapa fixo do clube. Números: salvos da sala, ou o padrão por posição.
 let savedRows=[];
 try{savedRows=await q('SELECT player_id,number FROM room_shirts WHERE room_id=$1 AND club_id=$2',[roomId,clubId]);}catch(e){}
 const saved=Object.fromEntries((savedRows||[]).map(r=>[r.player_id,+r.number]));
 const numbers=defaultNumbers(squad,saved);
 const kit=clubDefault(clubName,clubId);
 return {kit,numbers,saved};
}

async function clubOf(q,room,userId,fail){
 const [me]=(await q('SELECT club_id FROM room_managers WHERE room_id=$1 AND user_id=$2',[room.id,userId]));
 if(!me?.club_id)throw fail('Escolha um clube');
 return me.club_id;
}

async function runPostgres(pool){
 await pool.query(`CREATE TABLE IF NOT EXISTS lib_migrations(name TEXT PRIMARY KEY,at TIMESTAMPTZ DEFAULT now())`);
 await pool.query(`CREATE TABLE IF NOT EXISTS room_kits(
  room_id INT REFERENCES rooms(id) ON DELETE CASCADE,club_id INT NOT NULL,
  primary_color TEXT NOT NULL,secondary_color TEXT NOT NULL,number_color TEXT NOT NULL,
  gk_primary TEXT NOT NULL,gk_secondary TEXT NOT NULL,gk_number TEXT NOT NULL,PRIMARY KEY(room_id,club_id))`);
 await pool.query(`CREATE TABLE IF NOT EXISTS room_shirts(
  room_id INT REFERENCES rooms(id) ON DELETE CASCADE,club_id INT NOT NULL,player_id INT NOT NULL,
  number INT NOT NULL CHECK (number BETWEEN 1 AND 99),PRIMARY KEY(room_id,club_id,player_id),UNIQUE(room_id,club_id,number))`);
 if((await pool.query('SELECT 1 FROM lib_migrations WHERE name=$1',[NAME])).rows.length)return {ok:true,already:true};
 await pool.query('INSERT INTO lib_migrations(name) VALUES($1) ON CONFLICT(name) DO NOTHING',[NAME]);
 console.log('KITS1811 tabelas de camisa/cores prontas');
 return {ok:true};
}

function attachKit({app,q,pool,auth,wrap,fail,member,R,uni}){
 const clubName=id=>{try{return uni&&uni.prepare('SELECT name FROM clubs WHERE id=?').get(id)?.name||null;}catch(e){return null;}};
 app.get('/api/rooms/:code/zc/kit',auth,wrap(async(r,s)=>{
  const room=await member(r);const clubId=await clubOf(q,room,r.user.id,fail);
  const sq=await R.squad(pool,room.id,clubId);
  const d=await enrich(q,room.id,clubId,clubName(clubId),sq);
  s.json({kit:d.kit,numbers:d.numbers,squad:sq.map(p=>({id:p.id,name:p.name,primary_position:p.primary_position,overall:p.overall,age:p.age,number:d.numbers[p.id]||null}))});
 }));
 app.post('/api/rooms/:code/zc/kit',auth,wrap(async()=>{throw fail('A edição das cores da camisa está desativada',403);}));
 app.post('/api/rooms/:code/zc/shirt',auth,wrap(async(r,s)=>{
  const room=await member(r);const clubId=await clubOf(q,room,r.user.id,fail);
  const sq=await R.squad(pool,room.id,clubId);
  const saved=Object.fromEntries((await q('SELECT player_id,number FROM room_shirts WHERE room_id=$1 AND club_id=$2',[room.id,clubId])).map(x=>[x.player_id,+x.number]));
  const out=setNumbers(sq,saved,[{player_id:r.body?.player_id,number:r.body?.number}]);
  const pid=+r.body.player_id;
  const c=await pool.connect();
  try{await c.query('BEGIN');await writeShirts((sql,p)=>c.query(sql,p),room.id,clubId,out);await c.query('COMMIT');}
  catch(e){try{await c.query('ROLLBACK');}catch(x){}if(e.code==='23505')throw fail('Esse número já é de outro jogador do clube');throw e;}
  finally{c.release();}
  s.json({ok:1,player_id:pid,number:out[pid]});
 }));
 app.post('/api/rooms/:code/zc/shirts',auth,wrap(async(r,s)=>{
  const room=await member(r);const clubId=await clubOf(q,room,r.user.id,fail);
  const sq=await R.squad(pool,room.id,clubId);
  const saved=Object.fromEntries((await q('SELECT player_id,number FROM room_shirts WHERE room_id=$1 AND club_id=$2',[room.id,clubId])).map(x=>[x.player_id,+x.number]));
  const items=Array.isArray(r.body?.numbers)?r.body.numbers:Object.entries(r.body?.numbers||{}).map(([id,number])=>({player_id:+id,number}));
  if(!items.length)throw fail('Informe os números da camisa');
  const out=setNumbers(sq,saved,items);
  const c=await pool.connect();
  try{await c.query('BEGIN');await writeShirts((sql,p)=>c.query(sql,p),room.id,clubId,out);await c.query('COMMIT');}
  catch(e){try{await c.query('ROLLBACK');}catch(x){}if(e.code==='23505')throw fail('Esse número já é de outro jogador do clube');throw e;}
  finally{c.release();}
  s.json({ok:1,numbers:out});
 }));
}


module.exports={NAME,HEX,FALLBACK,PREF,parseColor,parseNumber,normalizeKit,clubDefault,defaultNumbers,setNumber,setNumbers,writeShirts,rowToKit,enrich,runPostgres,attach:attachKit,loadColors};
