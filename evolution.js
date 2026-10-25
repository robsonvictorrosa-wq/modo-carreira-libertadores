// Sistema de evolução de jogadores – EM DEFINIÇÃO (Robson ainda vai decidir as regras).
// Ponto único de encaixe: chamado depois de cada rodada simulada, dentro da transação.
// Para ativar, implemente afterRound e retorne mensagens opcionais [{info:'...'}].
// Ex.: atualizar room_players.overall a partir de matches.details (ratings/eventos).
// REGRA FIXA (Robson): jogador com idade > 33 NÃO evolui nem regride; potencial = overall.
// Qualquer regra futura deve passar a mudança de overall por EVO.applyOverall(p,novo).
const VAL=require('./value');
module.exports={
  frozen:VAL.frozen,
  applyOverall:(p,novo)=>VAL.frozen(p)?p.overall:novo,
  enabled:false,
  description:'Sistema de evolução em definição.',
  async afterRound(db,room,comp,step,matches){return [];}, // no-op
};
