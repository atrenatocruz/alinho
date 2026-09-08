# Fix do Elo de duplas: amortecedor de novatos + derrotas 50/50 — design

Data: 2026-09-08. Caso que motivou: Diogo Alexandre (bom jogador) preso em ~800 num espiral descendente.

## Diagnóstico — as 3 engrenagens do espiral

1. **Novatos sobre-avaliados contaminam a expectativa do parceiro.** Um recém-chegado entra a 900 (auto-avaliação); se vale ~700 na prática, a média da dupla infla o E do parceiro estabelecido, que paga o erro alheio a cada derrota "esperada". O K=40 corrige o novato em poucos jogos, mas cada noite entram novatos frescos.
2. **A redistribuição de agosto ("o mais forte absorve 65% da derrota") castigava quem carrega.** Num jogo de duplas não se carrega um parceiro fraco só com ser bom — "bate-se mas não ganha" — e ainda levava a maior fatia da perda.
3. **O seeding por rating fecha o ciclo**: rating baixo → campo de baixo → parceiros mais verdes → derrota provável.

## Decisões (Ruben, 8 set)

- **A. Amortecedor de novatos**: estabelecido (≥5 jogos contados) com parceiro provisório (<5) → delta ×0.5, nas duas direções. Simples de explicar: "jogos com parceiros novos contam menos para ti até o rating deles assentar".
- **B. Derrotas 50/50**: o cap 35/65 fica só nas vitórias (o mais fraco continua a ganhar mais); derrotas repartem a meias. Fim do imposto do carregador.
- **D. Recalibração total** (`migration_elo_backfill_v2.sql`): reset às âncoras + re-replay cronológico com as regras novas, agora a **intercalar mixes e amigáveis confirmados** (fecha o gap do backfill v1). XP intocado.
- **Fora**: multiplicador de margem (decisão do RANKING.md mantida) e duplas equilibradas na formação (C — alavanca futura se o problema persistir).

## Efeito medido (espelho JS, cenário Diogo 850+novato 900 vs 900/900)

| Situação | Antes | Depois |
|---|---|---|
| Derrota com novato (Diogo) | −9,0 | −4,6 |
| Vitória com novato (Diogo) | +11,0 | +5,5 |
| Novato na mesma derrota | −19,1 | −18,6 (corrige quase igual) |
| Derrota entre estabelecidos (1000/800) | −11,1/−8,9 | −10,0/−10,0 |
| Vitória entre estabelecidos | inalterada | inalterada |

## 2ª iteração (mesmo dia): escudo por contexto

Debate com o Ruben após a 1ª versão: o amortecedor simétrico ainda deixava o veterano perder pontos por parceiros mal auto-avaliados nos mixes; e um safeguard total teria o exploit inverso (novato fortíssimo sub-avaliado = free Elo nas vitórias; e nos amigáveis, onde o parceiro é ESCOLHIDO, seria uma máquina de farmar sem risco). Regra final, com parceiro provisório (<5 jogos), para o estabelecido (≥5):

| Contexto | Derrota | Vitória |
|---|---|---|
| **Mix** (parceiro atribuído) | **0** (escudo) | ×0.5 |
| **Amigável** (parceiro escolhido) | ×0.5 | ×0.5 |

Implementado via parâmetro `p_partner_chosen` no núcleo (`migration_elo_partner_shield.sql`, que **substitui** `migration_elo_doubles_fix.sql`). Números (Diogo 850 + novato 900 vs 900/900): mix derrota 0 / vitória +5,5; amigável −4,6 / +5,5; novato corrige normal (−18,6); estabelecidos entre si inalterados. Custo aceite: mixes ligeiramente inflacionários com novatos — medível, revisível (vitória pode descer para ×0.75… ×0.25 se a deriva incomodar).

## Implementação

Tudo em `apply_elo_pairing` (fonte única — mixes e amigáveis herdam): `migration_elo_doubles_fix.sql`. Recalibração: `migration_elo_backfill_v2.sql` (re-corrível; imprime top-30 com o Diogo marcado). Sem frontend (a explicação pública em /instrucoes é qualitativa e continua válida). Atualizar o RANKING.md (fora do repo) com a revisão: derrotas 50/50 + amortecedor de provisórios.
