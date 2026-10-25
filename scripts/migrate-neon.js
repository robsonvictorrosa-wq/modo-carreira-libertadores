// Migração única Render PG -> Neon. Roda só se MIGRATE_DST estiver definido. Não altera a origem.
const {Client}=require('pg');
let CUR='';const raw={getTypeParser:()=>v=>v};
const L=(...a)=>console.log('[MIGR]',...a);
const mk=u=>{const x=new URL(u);x.search='';return new Client({connectionString:x.toString(),ssl:{rejectUnauthorized:false},types:raw});};
const q=(c,s,p)=>c.query(s,p).then(r=>r.rows);
const id=s=>'"'+s.replace(/"/g,'""')+'"';
async function counts(c,schemas){const out={};for(const s of schemas){for(const {t} of await q(c,`select tablename t from pg_tables where schemaname=$1 order by 1`,[s])){out[s+'.'+t]=+(await q(c,`select count(*) n from ${id(s)}.${id(t)}`))[0].n;}}return out;}
module.exports=async function(){
 const src=mk(process.env.DATABASE_URL),dst=mk(process.env.MIGRATE_DST);await src.connect();await dst.connect();
 try{
  const schemas=(await q(src,`select nspname n from pg_namespace where nspname not like 'pg\\_%' and nspname<>'information_schema' and exists(select 1 from pg_tables where schemaname=nspname) order by 1`)).map(r=>r.n);
  const ONLY=(process.env.MIGRATE_SCHEMAS||'').split(',').filter(Boolean);if(ONLY.length)schemas.splice(0,schemas.length,...schemas.filter(x=>ONLY.includes(x)));
  if(!schemas.length){L('ABORT nenhum schema');return;}
  L('schemas',schemas.join(','));
  if(process.env.MIGRATE_REPLACE==='1'&&process.env.MIGRATE_MODE!=='verify'){if(schemas.includes('public')){L('ABORT REPLACE não permitido em public');return;}for(const x of schemas){await dst.query(`drop schema if exists ${id(x)} cascade`);L('dst schema removido',x);}}
  if(process.env.MIGRATE_MODE==='verify'){const a=await counts(src,schemas),b=await counts(dst,schemas);L('VERIFY',JSON.stringify(Object.keys(a).map(k=>[k,a[k],b[k]])),Object.keys(a).every(k=>a[k]===b[k])?'ALL_MATCH':'MISMATCH');return;}
  const ex=await q(dst,`select schemaname||'.'||tablename t from pg_tables where schemaname=any($1)`,[schemas]);
  if(ex.length){L('ABORT destino já tem tabelas:',ex.map(r=>r.t).join(','));return;}
  await dst.query('begin');
  const fks=[],idx=[];
  for(const s of schemas){
   await dst.query(`create schema if not exists ${id(s)}`);
   for(const r of await q(src,`select sequencename n,data_type,start_value,increment_by,last_value from pg_sequences where schemaname=$1`,[s])){
    await dst.query(`create sequence ${id(s)}.${id(r.n)} as ${r.data_type} increment ${r.increment_by} start ${r.start_value}`);
    if(r.last_value!=null)await dst.query(`select setval($1,$2,true)`,[s+'.'+r.n,r.last_value]);}
   const tabs=await q(src,`select c.oid,c.relname t from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=$1 and c.relkind='r' order by 1`,[s]);
   for(const {oid,t} of tabs){
    const cols=await q(src,`select a.attname n,format_type(a.atttypid,a.atttypmod) ty,a.attnotnull nn,pg_get_expr(d.adbin,d.adrelid) df from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=$1 and a.attnum>0 and not a.attisdropped order by a.attnum`,[oid]);
    const cons=await q(src,`select conname,contype,pg_get_constraintdef(oid) def from pg_constraint where conrelid=$1 order by contype desc`,[oid]);
    const body=cols.map(c=>`${id(c.n)} ${c.ty}${c.df?' default '+c.df:''}${(c.nn===true||c.nn==='t')?' not null':''}`).concat(cons.filter(c=>c.contype!=='f'&&c.contype!=='n').map(c=>`constraint ${id(c.conname)} ${c.def}`));
    await dst.query(`create table ${id(s)}.${id(t)} (${body.join(',')})`);
    cons.filter(c=>c.contype==='f').forEach(c=>fks.push(`alter table ${id(s)}.${id(t)} add constraint ${id(c.conname)} ${c.def}`));
    // copia dados em lotes
    CUR=s+'.'+t;const names=cols.map(c=>id(c.n)).join(',');let off=0,n=0;const B=500;
    for(;;){const rows=(await src.query({text:`select ${names} from ${id(s)}.${id(t)} order by ctid offset ${off} limit ${B}`,rowMode:'array'})).rows;if(!rows.length)break;
     const ps=[],vals=[];rows.forEach((r,i)=>{ps.push('('+r.map((_,j)=>'$'+(i*r.length+j+1)).join(',')+')');vals.push(...r);});
     await dst.query(`insert into ${id(s)}.${id(t)} (${names}) values ${ps.join(',')}`,vals);off+=B;n+=rows.length;}
    L('tabela',s+'.'+t,n);}
   for(const r of await q(src,`select indexdef d from pg_indexes i where schemaname=$1 and not exists(select 1 from pg_constraint c join pg_class x on x.oid=c.conindid where x.relname=i.indexname and c.connamespace=(select oid from pg_namespace where nspname=$1))`,[s]))idx.push(r.d);
   for(const r of await q(src,`select s.relname sq,t.relname tb,a.attname col from pg_depend d join pg_class s on s.oid=d.objid and s.relkind='S' join pg_class t on t.oid=d.refobjid join pg_attribute a on a.attrelid=t.oid and a.attnum=d.refobjsubid join pg_namespace n on n.oid=s.relnamespace where n.nspname=$1 and d.deptype='a'`,[s]))
    fks.push(`alter sequence ${id(s)}.${id(r.sq)} owned by ${id(s)}.${id(r.tb)}.${id(r.col)}`);
  }
  for(const d of idx)await dst.query(d);
  for(const d of fks)await dst.query(d);
  await dst.query('commit');L('COPIA_OK');
  const a=await counts(src,schemas),b=await counts(dst,schemas);
  L('VERIFY',JSON.stringify(Object.keys(a).map(k=>[k,a[k],b[k]])),Object.keys(a).every(k=>a[k]===b[k])?'ALL_MATCH':'MISMATCH');
 }catch(e){L('ERRO',CUR,e.message);try{await dst.query('rollback')}catch(_){}}
 finally{await src.end();await dst.end();}
};
