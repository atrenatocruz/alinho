# Jogos entre amigos → Elo, com confirmação cruzada — design

Data: 2026-09-08. Decisões do Ruben: os jogos privados (2x2 fora de clubes) passam a contar para o Elo global ("como xadrez com 4 jogadores"); o resultado tem de ser confirmado pela **equipa contrária** a quem o submeteu; **sem retroativo** (o histórico confirmado antes da ativação fica como está).

## Fluxo

1. Qualquer um dos 4 jogadores submete (ou corrige) o resultado enquanto pendente — `submit_private_match_score` regista `score_submitted_by`; uma correção reinicia a confirmação a partir de quem corrigiu.
2. Um jogador **da equipa contrária** ao submitter confirma (`confirm_private_match`) — o criador deixou de ser especial. Confirmação exige os 4 slots cheios + resultado.
3. A confirmação fecha o jogo, escreve os pontos planos (1 + 3 vitória, inalterados — continuam a alimentar `private_points`) e aplica o **Elo** aos 4.

## Elo

- Núcleo extraído para `apply_elo_pairing(a1, a2, b1, b2, s_a)`: média da dupla, divisor 400, K individual 40/30/20 por `rating_games`, redistribuição por parceiro cap 35/65 (×2), piso 0, `rating_games+1`. Devolve `(pid, delta, s)`.
- `apply_mix_elo` foi recriado a chamar o núcleo por jogo — **uma só fonte da matemática** entre mixes e amigáveis; `_elo_night`, bónus de mérito e `mix_player_stats` intactos.
- Amigáveis: **sem bónus de mérito** (conceito de mix/noite, não de jogo único). Empates continuam impossíveis em privados (proibidos a 3 níveis).
- Delta gravado em `private_match_stats.rating_delta`/`rating_after`; visível no histórico da UI (`+12 Elo`).

## Casos-limite

- Resultado submetido antes da migração (sem `score_submitted_by`): a confirmação pede re-submissão ("Volta a inserir o resultado…") em vez de adivinhar a equipa.
- Guests de clube (perfis reais com `is_guest`) podem jogar amigáveis e o rating deles conta — coerente com os mixes.
- Um futuro re-backfill total do Elo (ex.: mudança de divisor) terá de intercalar os `private_matches` confirmados por `confirmed_at` a partir da data de ativação — anotado, não implementado.

## Ficheiros

`supabase/migration_private_match_elo.sql` (colunas + núcleo + 4 RPCs recriadas) · `src/pages/PrivateMatches.jsx` (canConfirm cruzado, submitter visível, delta no histórico) · locales pt/en. Deploy: migração ANTES do merge.
