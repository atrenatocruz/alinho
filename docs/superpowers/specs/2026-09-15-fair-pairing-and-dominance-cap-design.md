# Sorteio sem repetição forçada + cap de dominância no Elo — design

Data: 2026-09-15. Caso que motivou: print do Renato (mix onde ele, M4, jogou contra um campo de M6s e ficou com o maior ganho de pontos do mix, +54, enquanto o Ruben Mateus, N5, ficou a −18 com 50% de vitórias).

## Diagnóstico

Duas falhas distintas, no sorteio e nos pontos, ambas confirmadas por leitura de código (sem alterações feitas ainda):

1. **Repetição de pares.** `GameDetails.jsx` só olha para o mix anterior (`.limit(1)`) ao construir `repeatPairKeys`, e `formDuplas` (`mixLogic.js:103-108`) trata isso como preferência suave: se o candidato mais próximo em pontos já foi parceiro, tenta o side-preference primeiro, mas se **todos** os que sobram já foram parceiros aceita a repetição sem avisar ninguém. Não há memória de 4 mixes nem qualquer bloqueio.

2. **Pontos do favorito claro.** O core do Elo (`apply_elo_pairing`, `migration_elo_partner_shield.sql`) já desconta corretamente pela força do adversário — `E_a` reduz o ganho de quem era claramente favorito. O que **não** desconta é o bónus de `apply_mix_elo` (+1% do próprio rating por estar na equipa vencedora do mix, +0,5% extra por 100% de vitórias): é uma percentagem fixa do rating do próprio jogador, cega à força dos adversários. Isto explica o +54 do Renato — o rating mais alto do mix, multiplicado por um bónus fixo, dá o maior bónus do mix mesmo quando dominar um campo mais fraco devia valer pouco.

   O financiamento desse bónus agrava o problema do lado oposto: hoje tira pontos a **todos os que não foram 100%**, proporcional ao **rating de cada um** (`v_payer_rating_sum`), não a quem efetivamente perdeu contra os premiados nem a quão surpreendente foi essa derrota. O Ruben tinha um dos ratings mais altos entre os "pagadores" desse mix, por isso pagou a fatia maior do imposto — independentemente de ter perdido contra o próprio Renato (uma derrota já esperada e barata no Elo core) ou contra outra pessoa. É provavelmente este imposto, não o Elo em si, que tornou a derrota do Ruben mais severa do que devia.

## Decisões (Renato, 15 set)

- **A. Janela de repetição = últimos 4 mixes do clube**, contados, não por data. Junta os pares das duplas desses 4 jogos num único `repeatPairKeys`.
- **B. `formDuplas` passa a procurar ativamente** uma atribuição sem repetições (backtracking sobre os solos — grupo pequeno, busca barata) em vez de aceitar o primeiro impasse do greedy atual. Só cai numa repetição se for matematicamente impossível evitá-la com o grupo presente nesse mix.
- **C. Quando a repetição é inevitável, avisa e deixa avançar** — não bloqueia o "Começar Mix" de vez. A app mostra que par(es) repetem antes de criar as equipas; o admin confirma para continuar. Nunca acontece silenciosamente como hoje.
- **D. Cap fixo por diferença de rating** no ganho total do mix (Elo + bónus somados), só do lado de quem está em vantagem:
  | Diferença média para os adversários (rating no início do mix) | Teto do ganho total no mix |
  |---|---|
  | < 150 | sem teto (fórmula normal) |
  | 150–300 | 15 pontos |
  | ≥ 300 | 5 pontos |

  Nunca se aplica ao lado mais fraco — um azarão que dá a reviravolta continua a poder ganhar o que a fórmula normal já lhe dava (é isso que se quer premiar).
- **E. Financiamento do bónus deixa de ser proporcional ao rating do pagador.** Passa a ser proporcional a quão inesperada foi a derrota especificamente contra os premiados: usa o `E_a` que o perdedor já tinha nesse jogo. Perder contra alguém claramente mais forte (E_a baixo) financia ~0; perder contra alguém a um nível parecido (E_a perto de 0,5) financia mais. Se, no limite, ninguém perdeu de forma surpreendente contra os premiados (mesmo cenário do cap D — campo todo mais fraco), o bónus já vem pequeno por causa do cap, por isso não há problema em sobrar pouco por onde financiar.
- **F. Recalibração total do histórico** (mesmo padrão de `migration_elo_backfill_v2.sql`): reprocessa todos os mixes já fechados com a fórmula nova. Os rankings atuais de **todos os clubes** mudam quando isto correr — não é opcional escapar a isso, foi a opção escolhida em vez de "só a partir de agora".

## Efeito esperado (cenário Renato M4 ~1170 vs campo M6 ~700-900, 4/4 vitórias)

| | Antes | Depois (esperado) |
|---|---|---|
| Ganho total do Renato no mix | +54 | ≤5 (diferença média ≥300) |
| Perda do Ruben (50% vitórias, perdeu contra o Renato) | −18 | bem menor — a fatia que hoje paga por rating passa a quase 0 na parte referente a perder contra o Renato |

Números exatos dependem da recalibração real (não foram lidos dados de produção para esta spec, por decisão do Renato — avançar com a hipótese).

## Implementação

- **Sorteio**: `src/lib/mixLogic.js` (`formDuplas` — busca com backtracking, passa a devolver também que pares ficaram repetidos), `src/pages/GameDetails.jsx` (lookback 1→4 mixes; diálogo de confirmação quando há repetição inevitável, no mesmo padrão dos `confirm()` já usados para ações destrutivas), `src/lib/mixLogic.test.js` (casos novos).
- **Elo**: núcleo continua único em `apply_elo_pairing`/`apply_mix_elo` — nova migração `supabase/migration_elo_dominance_cap.sql` (nome a confirmar no plano) com o cap D e o novo financiamento E. Recalibração em `supabase/migration_elo_backfill_v3.sql` (re-corrível, no padrão da v2 — reset às âncoras + re-replay cronológico).
- **Lembrete de sempre**: estas migrações não ficam ativas só por estarem no repo — têm de ser coladas no SQL Editor do Supabase depois de escritas, e só depois disso o backfill deve correr.
- Sem alterações de RLS — isto é lógica de negócio dentro de funções já `SECURITY` existentes, não uma nova superfície de acesso.

## Testes

- Unitários (`mixLogic.test.js`): backtracking encontra atribuição sem repetição sempre que existe uma solução; cai corretamente para "repetição inevitável, sinalizada" quando não existe; janela de 4 mixes agrega pares dos 4 jogos corretamente (não só do último).
- SQL: cenários construídos à mão (replicar o caso Renato/Ruben e um caso equilibrado de controlo) correndo `apply_mix_elo` antes de tocar no backfill de produção, para confirmar que o cap e o financiamento novo dão os números esperados sem quebrar mixes normais (grupo equilibrado, sem favoritismo, deve ficar inalterado).
- Backfill corrido manualmente por instrução do Renato, não como parte de nenhum deploy automático.
