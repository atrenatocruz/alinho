# Elo ranking v1 + auto-classificação no registo — design

Data: 2026-08-25. Fonte: `RANKING.md` (decisão final "Ranking v1", 25 ago 2026) + decisões do Ruben nesta sessão.

## O que muda

1. **Novo rating Elo por jogador**, global (vale em todos os clubes), calculado no fim de cada mix a partir dos resultados dos jogos — substitui o `total_points` como ordenação principal dos rankings. O `total_points` (assiduidade) mantém-se intacto e continua a alimentar o tab Mensal e o ranking de clubes.
2. **Ecrã de auto-classificação no primeiro registo**: contas novas escolhem Iniciado (700) / Regular (900) / Avançado (1100) antes de entrar na app. **Contas já existentes nunca veem este ecrã** — são marcadas como "já classificadas" na migração e entram todas com âncora 900 via backfill.

## Decisões (fechadas com o Ruben, 2026-08-25)

| Questão | Decisão |
| --- | --- |
| Âmbito do rating | **Global, em `profiles`** — um rating por pessoa, não por membership. |
| Jogadores existentes | **Recalcular o histórico** (todos os mixes `finished`, por ordem cronológica) com âncora 900 para todos. Nunca veem o ecrã de escolha. |
| Display | **Elo passa a ordenação principal** dos tabs Geral (global) e Por Clube; `total_points` fica relegado (Mensal, clubes). |
| Bónus de mérito | **1% do próprio rating só para a dupla vencedora do mix**; +0,5% para quem fizer pleno. |
| Redistribuição por parceiro (cap 35%) | Ponderação **inversa ao rating**: o parceiro mais fraco leva a maior fatia numa vitória e a menor numa derrota. Fatia ∈ [35%, 65%] do Δ da dupla, depois multiplicada pelo K individual. |
| Origem do bónus | Debitado aos outros participantes **proporcionalmente ao rating de cada um**. |
| Pleno | **100% de vitórias na noite**, independentemente de vencer o mix. |

## Algoritmo (por mix finalizado)

Para cada jogo do mix, por ordem (`round_number`, `created_at`), com ratings correntes (atualizados jogo a jogo dentro da noite):

```
R_dupla = média dos ratings dos dois jogadores
E       = 1 / (1 + 10^((R_adversário − R_dupla) / 400))
S       = 1 vitória · 0 derrota · 0.5 empate (defensivo — a UI não permite empates)
w_i     = clamp(R_parceiro / (R_i + R_parceiro), 0.35, 0.65)   ← fatia em vitória
          (na derrota usa-se 1 − w_i; empate → 0.5; sem parceiro → 0.5)
K_i     = 40 (0–4 jogos contados) · 30 (5–19) · 20 (20+)       ← individual, estilo FIDE
Δ_i     = K_i × (S − E) × 2 × fatia_i
```

Depois de todos os jogos:

- **Bónus**: dupla vencedora do mix recebe 1% do próprio rating (pós-jogos); plenos recebem +0,5%. Total debitado aos participantes sem bónus, proporcional ao rating. Se não houver pagadores, o bónus não se aplica (nunca fica soma-positiva).
- **Piso 0, sem teto.** Sem multiplicador de margem. Nº do campo nunca entra.

Convidados (guests) jogam e o rating deles atualiza (o rating é global, o estatuto de guest é por clube), mas continuam fora de `mix_player_stats`/`total_points` como hoje.

## Bandas

`< 700` Iniciante · `700–999` banda 6 · `1000–1199` 5 · `1200–1399` 4 · `1400–1599` 3 · `1600–1799` 2 · `≥ 1800` 1. Prefixo pela escala: `M` (default) / `F` (`profiles.gender = 'feminino'`). Ninguém entra em Iniciante — só se cai lá.

## Dados e segurança

- `profiles`: `+rating NUMERIC`, `+rating_anchor INT`, `+rating_games INT`, `+rating_onboarded_at TIMESTAMPTZ`. A migração carimba `rating_onboarded_at = now()` em **todas as linhas existentes** — é isto que garante que contas antigas nunca veem o ecrã.
- `mix_player_stats`: `+rating_delta`, `+rating_after` (registo por noite, para display futuro).
- Escrita do rating **só** dentro de `finalize_mix` (SECURITY DEFINER) via `apply_mix_elo()`; o RPC `complete_rating_onboarding(p_level)` só funciona quando `rating_onboarded_at IS NULL` (no-op para contas já classificadas). Se o jogador jogou antes de escolher o nível (admin mete-o num mix antes de ele abrir a app; baseline 900 nesse intervalo), a escolha desloca a baseline mas **preserva os deltas já ganhos**: `rating = âncora + (rating − 900)`.
- **Correção de segurança relacionada** (ficheiro próprio, `migration_fix_profiles_column_grants.sql`, corre antes e independente do rollout): a policy de UPDATE de `profiles` era row-only sem restrição de colunas — um utilizador podia, em teoria, fazer UPDATE ao próprio `is_platform_admin` (ou, agora, ao `rating`). Grants por coluna no padrão de `migration_fix_membership_level_update.sql` limitam o UPDATE do cliente às colunas de perfil editáveis; as colunas de rating ficam protegidas por omissão.

## Fora de âmbito (v1)

- Jogos privados/entre amigos não afetam o Elo.
- Formação de duplas (`seed_ranking`) continua a usar os pontos de clube — mudar o seeding para o rating é um follow-up.
- Escala MX (mistos) e jogos entre clubes.
- Refinamento do K (60/45/30 nos primeiros ~8 jogos) e revisão do divisor — em aberto no RANKING.md.
