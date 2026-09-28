# Ranking (rating / "nível") — como é calculado

O que está implementado, seguindo o código. Fonte de verdade: `supabase/migration_ranking_soma_zero.sql` (Trello #440, 2026-09-24), que define as quatro funções do motor. Todo o cálculo vive no Postgres; o JavaScript só mostra (`src/lib/elo.js:1-8`).

## Em duas frases

Cada pessoa tem **um** rating global, `profiles.rating` (2 casas decimais), escrito apenas por funções SQL `SECURITY DEFINER`; o cliente não lhe toca (`supabase/migration_elo_rating.sql:29-50`). O modelo é **soma zero**: o que uma dupla ganha num jogo, a outra perde, ao cêntimo.

## 1. Ponto de partida

- Ao entrar na app, o ecrã "Qual é o teu nível?" chama `complete_rating_onboarding` (`supabase/migration_elo_entry_levels.sql:140-170`):

  | Escolha | Rating inicial (`rating_anchor`) |
  | --- | --- |
  | N1 | 1900 |
  | N2 | 1700 |
  | N3 | 1500 |
  | N4 | 1300 |
  | N5 | 1100 |
  | N6 | 850 |
  | Iniciante | 600 |

- Quem ainda não escolheu vale **900** em todas as contas (`COALESCE(rating, 900)`); convidados criados pelo bot do WhatsApp entram a 900 (`supabase/migration_backfill_guest_ratings.sql:18-23`).
- A escolha **desloca** o rating em vez de o substituir: pontos ganhos antes de escolher o nível (um admin mete-te num mix antes de abrires a app) mantêm-se (`migration_elo_entry_levels.sql:164-168`). Só se pode escolher uma vez.

## 2. Um jogo 2v2 — a fórmula

Função `elo_jogo_deltas` (`migration_ranking_soma_zero.sql:140-248`). Recebe os 4 ratings, os 4 contadores de jogos e o resultado; não lê nem escreve nada.

1. **Rating da dupla** = média dos dois (`:185-186`). Um lugar sem conta (convidado por nome) é ignorado na média.
2. **Esperado** da dupla A: `E = 1 / (1 + 10^((R_B − R_A) / 400))` (`:187`).
3. **K** por pessoa, pelo número de jogos que já contaram (`:171-173`):

   | `rating_games` | K |
   | --- | --- |
   | < 8 | 40 |
   | < 20 | 30 |
   | ≥ 20 | 20 |

   O K do jogo é a média dos K das quatro pessoas. Movimento total: `M = 2 · K · (S − E)` (`:190-191`).
4. **Resultado `S`**: 1 vitória, 0 derrota, 0.5 empate. **A margem não conta**: sets, jogos ou pontos só decidem quem ganhou (`src/lib/scoringLogic.js:4-12`).
5. **Repartição dentro da dupla** (`:200-218`): na **vitória**, o mais fraco leva a fatia maior, `clamp(R_parceiro / (R_eu + R_parceiro), 0.35, 0.65)`, ponderada pelo K de cada um (um novato move mais, à custa da fatia do parceiro, não por cima). Na derrota e no empate é 50/50.
6. **Soma zero e chão em 0** (`:220-246`): ninguém desce abaixo de 0; os vencedores recebem exatamente o que os perdedores perderam; o resto do arredondamento a 2 casas vai para o último vencedor.
7. **Convidado sem conta na dupla**: o jogo move **metade** — opção `convidado = 'B'`, "dupla com convidado = uma pessoa" (`:129`, `:192-194`).

Exemplos do próprio ficheiro (`:631-641`), todos com soma 0:

| Caso | Ratings [A1, A2, B1, B2] | Jogos | Resultado |
| --- | --- | --- | --- |
| Dupla com convidado ganha | 1100, —, 1100, 1100 | 30, 0, 30, 30 | +10, —, −5, −5 |
| Novato (0 jogos) ganha com par igual | 1100, 1100, 1100, 1100 | 0, 30, 30, 30 | +16.67, +8.33, −12.50, −12.50 |
| Mais fraco da dupla ganha | 1200, 1000, 1100, 1100 | 30, 0, 30, 30 | +7.35, +17.65, −12.50, −12.50 |
| Alguém a 5 perde (chão) | 5, 1800, 500, 500 | 30, 30, 30, 30 | −5, −18.21, +11.61, +11.60 |

`apply_elo_pairing` (`:256-299`) é o invólucro que lê os 4 ratings vivos, chama a fórmula, e escreve `rating = GREATEST(0, rating + delta)` e `rating_games + 1`.

## 3. Prémio da noite (mixes)

`apply_mix_elo` (`:305-471`), opção `bonus_mix = 'pago'`:

- **Prémio**: cada um da dupla vencedora do mix recebe **+1 %** do próprio rating; noite perfeita (ganhou tudo) **+0.5 %** extra (`:384-391`).
- **Trava de domínio** (spec `docs/superpowers/specs/2026-09-15-fair-pairing-and-dominance-cap-design.md`): gap entre o meu rating no início do mix e a média dos adversários (`:395-400`):

  | Gap | Limite (pontos dos jogos + prémio) |
  | --- | --- |
  | < 150 | sem limite |
  | 150 – 299 | ≤ 15 |
  | ≥ 300 | ≤ 5 |

  Só corta o prémio, até 0; nunca tira pontos dos jogos.
- **Quem paga**: só quem **perdeu contra um premiado**, ponderado pela surpresa da derrota (`1 − E`, com os ratings do início do mix). Uma derrota esperada paga ≈ 0 (`:404-428`). Se ninguém pagar, não há prémio (`:452-455`); se se cobrar menos do que o prometido, o prémio encolhe.
- **Americano**: pontos por jogo sim, prémio não (`supabase/migration_mix_ranked.sql:325-334`).

**Torneios** (`apply_tournament_elo`, `:477-607`): jogo a jogo igual; no fim, **+1 %** a quem jogou a final pela dupla campeã, **+0.5 %** se invicta, pago por toda a categoria proporcionalmente ao rating. Sem trava de domínio. Torneios `is_test` não contam (`supabase/migration_549_contas_e_torneio_de_teste.sql:118-155`).

## 4. O que conta

| Evento | Conta? | Condição |
| --- | --- | --- |
| Mix de clube (sobe e desce, todos contra todos) | sim | `games.ranked` (`migration_mix_ranked.sql:171-173`) |
| Mix Americano | sim, sem prémio | idem |
| Jogo entre amigos | só se tudo isto | `ranked_intent` ∧ sem lugar com nome-convidado ∧ os 4 aceitaram ∧ **não é empate** (`supabase/migration_amigos_sem_bloquear.sql:268-274`) |
| Jogo dentro de um grupo | sim | `group_matches.ranked` (`supabase/migration_group_matches.sql:347-349`) |
| Torneio | sim | exceto `tournaments.is_test` |
| Aulas | não | nenhuma migração de aulas escreve `profiles.rating` |

- **Convidado de clube** (tem perfil, `memberships.is_guest`): o rating move-se, mas não fica registo em `mix_player_stats` (`migration_mix_ranked.sql:114`). É por isso que a correção pós-fecho recusa mixes com convidados (ver §5).
- **Contas de teste** (`is_test`): saem das listas de ranking e da pesquisa, não do cálculo dos mixes.
- Não há afinações por clube: `organizations.points_rules` só mexe nos **pontos** de clube (`player_stats`), nunca no rating.

## 5. Ordem, correções e reversões

- **Dentro de um mix**: os jogos aplicam-se por `round_number, created_at, id`, com os ratings **vivos** a mudar jogo a jogo (`:358`). A trava de domínio e a surpresa usam a fotografia do início do mix, para a régua não andar (`:340-346`).
- **Torneio**: por `scheduled_at, created_at, id` (`:521`).
- **Correção pós-fecho de um mix** (`supabase/migration_correct_finished_americano.sql:218-255`): reverte os `rating_delta` guardados e volta a correr `apply_mix_elo`. Recusa quando falta delta a algum participante (`untracked_participant`), quando alguém já teve outro evento de rating depois (`later_elo_event`) ou quando o mix não é ranked (`sem_ranking`).
- **Reversões que existem**: jogo de grupo (`reverse_group_match_ranking`, usa os deltas guardados em `group_matches.applied_elo_deltas`) e categoria de torneio (`undo_tournament_elo`). **Não existe** reversão para um mix apagado nem para um jogo entre amigos apagado.
- **Recalcular tudo**: `supabase/recalcular_niveis.sql` repõe toda a gente no `rating_anchor` com 0 jogos e reproduz mixes, amigos, grupos e torneios por ordem cronológica, confirmando soma zero a cada evento. Dry-run por omissão.

## 6. O que deriva do rating

- **Nível mostrado** (`src/lib/elo.js:13-40`, copiado em `whatsapp-bot/src/elo.js` e em `lesson_band()`):

  | Rating | Nível |
  | --- | --- |
  | ≥ 1800 | 1 |
  | ≥ 1600 | 2 |
  | ≥ 1400 | 3 |
  | ≥ 1200 | 4 |
  | ≥ 1000 | 5 |
  | ≥ 700 | 6 |
  | < 700 | Iniciante |

  Prefixo M/F pelo género, N quando não está definido. "Provisório" (mostrado `~902`, selo NOVO) até **8** jogos (`src/lib/elo.js:68`).
- **Rankings**: global e por clube ordenam pelo mesmo `profiles.rating` (`supabase/migration_rankings_everyone.sql`); não há rating por clube. Só quem já jogou tem lugar na escala M/F/Todos (`src/lib/rankingScales.js:1-25`).
- **Duplas do mix**: `formDuplas` ordena os solos por rating e evita repetir parceiro dos últimos 4 mixes (`src/lib/mixLogic.js:205-270`; bot em `whatsapp-bot/src/autostart.js:109-143`). A dupla mais forte vai para o campo 1.
- **Seeds de torneio**: soma dos dois ratings (`supabase/migration_tournaments_seeding.sql:68`).
- **Níveis de evento** (M4, F3, MX5…): são etiquetas que limitam quem se inscreve, comparadas com o nível derivado; nunca escrevem o rating.

## 7. Onde aparece

Perfil (número, barra até ao nível seguinte, posição global — `src/pages/Profile.jsx:632-667`), Rankings (`src/pages/Rankings.jsx`), detalhe do mix (`+53` / `−5` por jogador, `src/pages/GameDetails.jsx:2663-2713`), lista de membros, roster do WhatsApp (`Nome (M6)`). No ecrã arredonda-se a inteiro; guarda-se com 2 casas.

## 8. Divergências conhecidas no código

Registadas para a equipa decidir; este ficheiro não as corrige.

1. `elo_k_factor` (escada 120/90/70/50/30/20, `migration_elo_entry_levels.sql:48-57`) existe mas **ninguém a chama**; o K real é o inline 40/30/20 de `elo_jogo_deltas`.
2. `FEATURES.md:63` descreve o modelo anterior ao #440 (limiares 5/20, prémio pago proporcional ao rating).
3. O comentário "ninguém entra em Iniciante" (`src/lib/elo.js:11-12`) contradiz a opção Iniciante = 600.
4. **Provável bug**: a correção pós-fecho reverte `rating` mas não `rating_games`, que volta a incrementar ao reaplicar (`migration_correct_finished_americano.sql:249-251` vs `soma_zero:291`). Cada correção inflaciona o contador e pode mudar o K de alguém. Torneios e grupos fazem a reversão completa.
5. O `partner_shield` (parceiro estabelecido absorvia a perda do novato) foi abolido pelo #440; `p_partner_chosen` ficou só por compatibilidade (`soma_zero:38`, `:254-255`).

## 9. Constantes

| | Valor | Onde |
| --- | --- | --- |
| Divisor da fórmula | 400 | `soma_zero:187` |
| K | 40 (< 8 jogos) · 30 (< 20) · 20 | `soma_zero:171-173` |
| Rating da dupla | média | `soma_zero:185-186` |
| Fatia na vitória | 35 % – 65 %, o mais fraco leva mais | `soma_zero:209-216` |
| Convidado sem conta | jogo move metade | `soma_zero:129`, `:192-194` |
| Base sem escolha | 900 | `COALESCE(rating, 900)` |
| Entradas | 1900 / 1700 / 1500 / 1300 / 1100 / 850 / 600 | `migration_elo_entry_levels.sql:145-152` |
| Níveis | 1800 / 1600 / 1400 / 1200 / 1000 / 700 | `src/lib/elo.js:13-20` |
| Provisório | 8 jogos | `src/lib/elo.js:68` |
| Prémio do mix | +1 % · noite perfeita +0.5 % | `soma_zero:388-389` |
| Trava de domínio | gap ≥ 150 → ≤ 15 · gap ≥ 300 → ≤ 5 | `soma_zero:396-400` |
| Chão / teto | 0 / sem teto | `GREATEST(0, …)` |
| Parceiro repetido | evita os últimos 4 mixes | `mixLogic.js`, `autostart.js:119-121` |
| Margem de vitória | não conta | `scoringLogic.js:4-12` |
