# Elo simples — design

Data: 2026-09-28. Decisão do Ruben, a partir das simulações desta data (ver `RANKING.md`, parte 2, e `supabase/ensaio_elo_monte_carlo.py`). Substitui, no que toca à conta por jogo, os specs de 2026-08-25 (elo-ranking), 2026-09-08 (doubles fix, private-match elo) e 2026-09-15 (fair-pairing-and-dominance-cap, só a parte da trava), e o modelo #440 de `migration_ranking_soma_zero.sql`. Esses ficam como registo histórico.

## Problema

Ao ritmo do piloto (1 mix por semana, 4 jogos por mix), o motor #440 mudava mais níveis por sorte do que por mérito: em 3 meses simulados, 24 % das pessoas mudavam de nível sem o nível real ter mudado e o erro médio subia de 71 para 78. O prémio da noite era a principal causa; a escada de K e a repartição 35/65 não acrescentavam precisão e ninguém as conseguia explicar a um jogador.

## Decisões

| Questão | Decisão |
| --- | --- |
| K | **20** para toda a gente. **40 nos primeiros 12 jogos, só para o próprio** — os outros três no jogo movem pelo K 20 deles. K 40 × 12 escolhido sobre K 60 × 8: corrige o mesmo nos mal declarados, com metade da inflação e sem fazer os bem declarados oscilar. |
| Repartição dentro da dupla | **Igual.** Cada um leva `K_próprio × (S − E)`. |
| Prémios | **Nenhum.** Sai o prémio da noite, a noite perfeita, a taxa por surpresa, a trava de domínio e o prémio do campeão de torneio. O prémio da noite é assunto de XP / pontos de clube (já existem). |
| Soma zero | Deixa de ser forçada. É soma zero por construção quando os quatro estão a K 20; com um novato a K 40 não é, e isso é aceite (+18 pontos de inflação por 10 novos). |
| Convidado sem conta | Não entra na média nem recebe; os outros movem normalmente. Sai a regra "dupla com convidado move metade". |
| Provisório na UI | 12 jogos (era 8), alinhado com a janela do K 40. |
| Admin corrigir o nível de entrada | **Adiado** (Ruben, 28 set). É a ferramenta que resolve o erro grosseiro numa noite; volta a ser discutida à parte. |
| Recalcular o histórico | Decisão à parte, com `recalcular_niveis(TRUE)`. Recomendação: sim, numa data anunciada, antes de o ranking ter história que custe perder. |

## O que muda no código

- `supabase/migration_elo_simples.sql` (**POR CORRER**): `elo_jogo_deltas`, `apply_elo_pairing`, `apply_mix_elo`, `apply_tournament_elo` reescritas; `elo_opcoes` e `elo_k_factor` apagadas. Assinaturas mantidas (parâmetros `p_partner_chosen`, `p_convidado`, `p_winner_team_id`, `p_champion_entry_id` ficam, ignorados), por isso `finalize_mix`, `finalize_americano_mix`, `correct_finished_mix_match`, `confirm_private_match`, `friend_match_apply_game`, `apply_group_match_ranking`, `finish_tournament_category`, `recalculate_category_points` e `recalcular_niveis` não mudam. O guard do `tournaments.is_test` (#549) está incorporado.
- `supabase/recalcular_niveis.sql`: deixa de exigir soma zero por evento.
- `src/lib/elo.js`: `PROVISIONAL_GAMES = 12`.
- Locales: `profile.provisional_note`, `instructions.elo_b6`, novo `instructions.elo_b7` ("só conta ganhar, perder ou empatar… não há prémios extra").
- `FEATURES.md`, `RANKING.md`.

## Fora de âmbito

- Correção do `rating_games` na correção pós-fecho (bug pré-existente; cartão próprio).
- Troféu "calibrado" nos 8 jogos (marco, não cálculo).
- Decaimento por inatividade; regras de proteção dos classificados contra provisórios (simuladas: ganho de 0–4 pontos, não vale a regra).
