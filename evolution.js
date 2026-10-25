// Sistema de evolução de jogadores – EM DEFINIÇÃO (Robson ainda vai decidir as regras).
// Ponto único de encaixe: chamado depois de cada rodada simulada, dentro da transação.
// Para ativar, implemente afterRound e retorne mensagens opcionais [{info:'...'}].
// Ex.: atualizar room_players.overall a partir de matches.details (ratings/eventos).
module.exports={
  enabled:false,
  description:'Sistema de evolução em definição.',
  async afterRound(db,room,comp,step,matches){return [];}, // no-op
};
