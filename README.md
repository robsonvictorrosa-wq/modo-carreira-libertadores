# Modo Carreira Libertadores – Zero Clubismo
Fork do Modo Carreira FC 27: salas multiplayer (apelido + PIN), temporada simulada rodada a rodada, mercado de transferências e PWA instalável, agora no formato **Libertadores ZC**.

- 40 clubes (lista e caixas em `config/libertadores.json`). Os 14 brasileiros, exceto Bahia e Botafogo, começam com elenco vazio.
- Todos contra todos em 39 rodadas. 1º–10º vão às oitavas; 11º–22º jogam o play-in em jogo único na casa da melhor campanha. Mata-mata ida e volta, final única, pênaltis. Regras em `libertadores.js` (CFG).
- Resenha pós-jogo (`resenha.js`), bolão por sala (`bolao.js`) e histórico real com fonte (`public/historico.html`).
- Stack: Node 20 + Express, SQLite read-only (universo FC27, gerado por `node import.js`) e Postgres (`DATABASE_URL`).

Local: `npm ci && node import.js && DATABASE_URL=postgres://... PGSSL=0 node server.js`
