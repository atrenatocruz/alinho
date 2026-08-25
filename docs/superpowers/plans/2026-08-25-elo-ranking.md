# Elo ranking v1 — plano de implementação

Spec: `docs/superpowers/specs/2026-08-25-elo-ranking-design.md`. Branch: `feat/elo-ranking`.

## Passos

1. **`supabase/migration_fix_profiles_column_grants.sql`** — fix de segurança standalone (grants por coluna no UPDATE de `profiles`; fecha o gap do `is_platform_admin` e protege por omissão as colunas de rating). Pode/deve correr imediatamente, independente do resto.
2. **`supabase/migration_elo_rating.sql`** (correr à mão no SQL Editor)
   - Colunas novas em `profiles` (`rating`, `rating_anchor`, `rating_games`, `rating_onboarded_at`) e `mix_player_stats` (`rating_delta`, `rating_after`).
   - Carimbar `rating_onboarded_at` em todos os perfis existentes.
   - `complete_rating_onboarding(p_level)` — RPC SECURITY DEFINER, só atua com `rating_onboarded_at IS NULL`; preserva deltas pré-onboarding (`âncora + (rating − 900)`).
   - `apply_mix_elo(p_game_id, p_winner_team_id)` — motor Elo + bónus de mérito; sem EXECUTE para clientes.
   - `finalize_mix` nova versão: igual à de `migration_fix_finalize_mix_pcalc.sql` + `PERFORM apply_mix_elo(...)`.
   - `get_global_rankings()` recriada com `rating`/`gender`, ordenada por rating.
3. **`supabase/migration_elo_backfill.sql`** — reset (âncora 900 para quem não tem) + replay dos mixes `finished` por ordem `date` → momento real de finalização (MIN de `mix_player_stats.created_at`). Correr DEPOIS das migrações 1-2 (ordem com o deploy do frontend é indiferente: o ecrã só aparece a contas novas).
3. **`src/lib/elo.js`** — bandas, `ratingBand(rating, gender)`, níveis de onboarding.
4. **`src/components/ui.jsx`** — `RatingBadge`.
5. **`src/pages/EscolherNivel.jsx`** — ecrã de auto-classificação (full-screen, sem Layout).
6. **`src/App.jsx`** — Guard: `profile.rating_onboarded_at === null` (estrito) → EscolherNivel.
7. **`src/pages/Rankings.jsx`** — tabs Geral (global) e Por Clube ordenados por rating, número principal = rating, badge de banda.
8. **`src/pages/Profile.jsx`** — linha com o rating/banda do próprio.
9. **`FEATURES.md`** — registar a feature.
10. Build + lint; review.

## Notas de deploy

- As três migrações **não estão aplicadas por existirem no repo** — têm de ser coladas no Supabase SQL Editor, pela ordem 1 → 2 → 3.
- Frontend deployado antes das migrações é inofensivo (coluna `rating_onboarded_at` ausente → `undefined` → ecrã nunca aparece; rankings caem no fallback de rating nulo).
