// Regras do leilão: lance não pode ser retirado; quem lidera um lote aberto
// não pode dar lance em outro até ser superado. Cada clube leva no máx. 1.
const UNBID_ERR='O lance não pode ser removido: ele vale até alguém superar.';

function canUnbid(){
 return {ok:false,error:UNBID_ERR};
}

function canBid({sameLotLeader,otherLotLeader,otherPlayerName}={}){
 if(sameLotLeader)return {ok:false,error:'Você já tem o maior lance deste jogador'};
 if(otherLotLeader)return {ok:false,error:`Você já tem o maior lance pelo ${otherPlayerName}. Cada clube leva no máximo 1 jogador: só dá pra dar lance em outro se for superado.`};
 return {ok:true};
}

module.exports={UNBID_ERR,canUnbid,canBid};
