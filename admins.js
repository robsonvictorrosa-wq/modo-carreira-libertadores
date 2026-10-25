// Apelidos administradores: padrão (Robshow, Duque) + variável ADMIN_APELIDOS no Render (separados por vírgula, sem diferenciar maiúsculas).
const DEFAULT='Robshow,Duque';
module.exports=()=>[...new Set((DEFAULT+','+(process.env.ADMIN_APELIDOS||'')).split(',').map(x=>x.trim().toLowerCase()).filter(Boolean))];
