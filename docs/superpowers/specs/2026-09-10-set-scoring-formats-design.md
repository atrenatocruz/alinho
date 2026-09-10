# Set Scoring Formats (melhor de 3 sets / pro-set a 9) — Design Spec

## Goal

Today every mix format (`sobe_desce`, `todos_contra_todos`, `grupos_eliminatorias`) records a match result as a single `score_a`/`score_b` integer pair. This adds two more scoring options — **melhor de 3 sets** and **pro-set a 9** — as a per-mix choice orthogonal to the match-structure format, so any of the three existing formats can use either scoring style without their own logic changing.

Note on naming: "melhor de 3 sets" means first to **win 2 sets** (out of up to 3) — the standard padel/tennis usage, where the result is always 2-0 or 2-1. An earlier draft of this spec mislabeled this `melhor_2_sets`; the mechanics were always "first to 2" — only the name was wrong.

## Key Decisions

**Why a separate `games.scoring_format` field instead of folding this into `format`?**
Structure (how matches are scheduled) and scoring (how a match's result is decided) are independent choices — the same confusion Francisco's format proposal flagged (`docs` reference: 2026-09-09 conversation) for mixing "Torneio"/"Americano" with "Golden Point"/"melhor de 3" at the same level. `format` picks the engine; `scoring_format` picks how each match ends. Default `'pontos_simples'` preserves every existing mix's behavior exactly — nothing changes unless a mix opts in.

**Why does `matches.score_a`/`score_b` keep meaning "sets won" for `melhor_3_sets` instead of adding a new winner field?**
`standings()`, `finalize_mix`, and every existing win/loss/ranking calculation already compare `score_a` vs `score_b` and read `winner_team_id`. Keeping those columns as "the number that decides the match" (points today, sets won for `melhor_3_sets`) means none of that shared code needs to change — only how the UI collects and computes that number changes.

**Why does `pro_set_9` need no new table, but `melhor_3_sets` does?**
A pro-set is still one number pair — the games score — so it fits directly in `matches.score_a`/`score_b` with a different validation rule (win by 2, capped at 9, with an 8-8 breaker). A best-of-3-sets match needs to record up to 3 independent results (set 1, set 2, and a possible decider) before `matches.score_a`/`score_b` can be computed as "sets won" — that needs its own rows.

**Why does the 8-8 pro-set breaker reuse the exact same "super tie-break" entry as the 1-1 sets decider, instead of two different UI flows?**
Both are "one number pair, first to 10, decides the whole match" — same shape, same validation, same component. One primitive, two call sites.

## Data Model

- `games.scoring_format` — new `TEXT`, `CHECK (scoring_format IN ('pontos_simples', 'melhor_3_sets', 'pro_set_9'))`, `NOT NULL DEFAULT 'pontos_simples'`. Every existing row defaults to today's behavior.
- `match_sets` — new table, only populated for `melhor_3_sets` matches:
  - `id`, `match_id` (FK → `matches`, cascade delete), `set_number` (1, 2, or 3 — 3 means the decider), `score_a`, `score_b`, `is_super_tiebreak` (bool — true only for set_number 3).
  - Unique on `(match_id, set_number)`.
- No new table for `pro_set_9` — it stays a single `score_a`/`score_b` pair on `matches`, just validated differently (see Match Rules) and, when an 8-8 breaker happens, the *breaker's own* score isn't persisted anywhere separately — only the resulting 9-8 goes into `matches.score_a`/`score_b`, exactly like a normal pro-set result. (This trades away a small amount of history — you can't tell from the data alone that a given 9-8 came from a breaker rather than a run of holds — which is an acceptable, deliberate simplification: nothing downstream needs that distinction.)

## Match Rules

- **`pontos_simples`** (existing, unchanged): any two non-equal non-negative integers.
- **`pro_set_9`**: winner reaches 9, loser has ≤7 (win-by-2 normal games), **or** the score is 8-8 and a super tie-break (first to 10, win by 2) is played — its winner's final recorded score is `9-8`. UI: enter the games score as normal; if both reach 8, the app prompts for the super tie-break instead of two more game-score fields, and writes `9-8` once that's entered.
- **`melhor_3_sets`**: first to win 2 sets. Each set is a normal games score (e.g. 6-4) — no games-level tie-break modeling (this spec does not add ad/no-ad or 6-6-in-a-set tie-break rules; a set's own games score is just entered as final, same trust level as today's simple score entry). If sets split 1-1, set 3 is a super tie-break (first to 10, win by 2), flagged `is_super_tiebreak = true`. `matches.score_a`/`score_b` is then set to the count of sets won by each team (2-0 or 2-1).

## UI

- Mix creation (all 3 formats): a new "Pontuação" selector next to the existing format selector, defaulting to "Pontos simples".
- Match score entry (`GameDetails.jsx`, wherever `handleSaveScore` currently takes two numbers): branches on `game.scoring_format`.
  - `pontos_simples`: unchanged.
  - `pro_set_9`: same two-number entry, new validation (win-by-2, 9 cap), with the super-tie-break prompt when 8-8 is entered.
  - `melhor_3_sets`: collects set 1, then set 2; if split 1-1, collects the super tie-break; computes and writes `matches.score_a/score_b` as sets won once the match is decided.

## Out of scope

- Ad/no-ad or in-set tie-break modeling (a set's games score is trusted input, like today's simple score).
- Any change to `sobe_desce`/`todos_contra_todos`/`grupos_eliminatorias` engine logic — this is purely a scoring-entry and result-computation layer underneath them.
- Retroactively backfilling `match_sets` for historical matches.
