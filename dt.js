// Data/hora em America/Sao_Paulo (ex.: 25/10/2026 16:07) + campos de status da transferência
const fdt=d=>{if(!d)return '';const s=new Date(d).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});return s.replace(',','');};
const trx=t=>({quando:fdt(t.created_at),status:t.status||'ok',contested_by:t.contested_by||null,contested_quando:fdt(t.contested_at),cancelled_by:t.cancelled_by||null,cancelled_quando:fdt(t.cancelled_at),prev:undefined});
module.exports={fdt,trx};
