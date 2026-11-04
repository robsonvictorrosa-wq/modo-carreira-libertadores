# Como funciona a simulação

A temporada **não é simulada de uma vez**. O dono da sala clica em "Simular próxima rodada" (ou todos os técnicos marcam "Estou pronto") e **apenas uma rodada** é jogada, em todas as ligas onde há técnicos humanos.

## 1. Calendário
- Ao iniciar a temporada, cada liga com técnico humano vira uma competição da sala.
- Pontos corridos, **turno e returno** (todos contra todos, ida e volta), sorteado pelo método do círculo.
- Depois de iniciada, **ninguém troca de clube** e ninguém novo entra na sala.

## 2. Escalação
- O técnico escolhe a formação (4-3-3, 4-4-2, 4-2-3-1, 3-5-2, 5-3-2, 4-5-1) e 11 titulares, ou usa a **auto-escalação**.
- Auto-escalação (também usada pelos bots): 1 goleiro + os melhores OVR de cada setor conforme a formação; se faltar alguém de um setor, entra o melhor disponível.

## 3. Força por setor (dos 11 titulares)
| Setor | Cálculo (média dos jogadores do setor) |
|---|---|
| Goleiro | média de elasticidade, manejo, reflexos e posicionamento |
| Defesa | 55% defesa + 30% físico + 15% ritmo |
| Meio | VOL: 30% passe + 15% drible + 30% defesa + 25% OVR · MC: 38% passe + 22% drible + 15% defesa + 25% OVR · MEI e demais: 45% passe + 30% drible + 25% OVR |
| Ataque | 50% chute + 25% ritmo + 25% drible |

- **Poder ofensivo** = 65% ataque + 35% meio.
- **Poder defensivo** = 60% defesa + 20% meio + 20% goleiro.

## 4. Gols esperados (xG)
- Base: 1,3 gol por time.
- `xG = 1,3 × e^((ofensivo do time − defensivo do adversário) / 16)`.
- **Mando de campo**: mandante ×1,12, visitante ÷1,12.
- **Forma recente** (pontos nos últimos 5 jogos): de ×0,95 (nenhum ponto) até ×1,05 (5 vitórias).
- Limites: entre 0,15 e 4,5 gols esperados.

## 5. Placar (aleatoriedade controlada)
- Os gols de cada time são sorteados por uma **distribuição de Poisson** com média = xG. O favorito vence na maioria das vezes, mas zebras acontecem.
- Exemplo: Barcelona (OVR 87) x Cruzeiro (74) dá vitória do Barça em ~9 de 10 jogos; times parecidos ficam perto de 50% mandante, 27% empate, 23% visitante.

## 6. Quem faz o gol e quem dá a assistência
- **Autor do gol**: sorteado entre os titulares com peso = (chute²) × peso da posição (ATA 1,0; SA 0,85; PD/PE 0,75; MEI 0,45; MD/ME 0,35; MC 0,25; VOL 0,12; zagueiros/laterais ~0,1; goleiro 0).
- **Assistência** (em 75% dos gols): peso = (passe²) × peso da posição (MEI 1,0; PD/PE 0,9; MD/ME 0,8; SA 0,7; MC 0,65; ATA 0,5; laterais 0,45; VOL 0,35).
- O minuto do gol é sorteado de 1 a 90.

## 7. Nota do jogador
- Começa em 6,2; +0,4 vitória / −0,3 derrota; +0,9 por gol; +0,5 por assistência.
- Goleiro e defensores: +0,5 sem sofrer gol, −0,25 por gol sofrido além do primeiro.
- Variação aleatória de ±0,6. Nota final entre 3 e 10.

## 8. Tabela e estatísticas
- Vitória 3, empate 1. Desempate: pontos, vitórias, saldo de gols, gols pró.
- Por jogador e competição: jogos, gols, assistências e nota média.
