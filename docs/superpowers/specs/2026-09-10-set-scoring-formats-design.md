# Set Scoring Formats (melhor de 2 / melhor de 3 / pro-set a 9) — Design Spec

## Goal

Today every mix format (`sobe_desce`, `todos_contra_todos`, `grupos_eliminatorias`) records a match result as a single `score_a`/`score_b` integer pair. This adds three more scoring options — **melhor de 2 sets**, **melhor de 3 sets**, and **pro-set a 9** — as a per-mix choice orthogonal to the match-structure format, so any of the three existing formats can use any scoring style without their own logic changing.

Note on naming (revision history): an earlier draft of this spec had only one "sets" format and argued its name should be `melhor_3_sets` because the mechanism was "first to win 2 sets." That was half right — first-to-2 is correct, but there are two distinct real-world variants of what happens at 1-1, and each has its own established name:
- **melhor de 2 sets**: 1-1 is decided by a **super tie-break** (first to 10) instead of playing a 3rd set — the common club/recreational shortcut.
- **melhor de 3 sets**: 1-1 is decided by playing a **full 3rd set**, same rules as sets 1-2 — the traditional format.

## Key Decisions

**Why a separate `games.scoring_format` field instead of folding this into `format`?**
Structure (how matches are scheduled) and scoring (how a match's result is decided) are independent choices — the same confusion Francisco's format proposal flagged (2026-09-09 conversation) for mixing "Torneio"/"Americano" with "Golden Point"/"melhor de 3" at the same level. `format` picks the engine; `scoring_format` picks how each match ends. Default `'pontos_simples'` preserves every existing mix's behavior exactly — nothing changes unless a mix opts in.

**Why do `melhor_2_sets` and `melhor_3_sets` share one counting mechanism instead of being built as two separate features?**
Both are "play sets, first to win 2"; they only differ in *what the decider looks like* when it's 1-1 (a tie-break entry vs. a normal 3rd-set entry). Tallying "who won more of the entries actually played" doesn't care which kind the 3rd entry was — one pure function (`computeSetsResult`) serves both, and the two formats differ only in what the UI presents as the 1-1 decider and whether that entry gets flagged `is_super_tiebreak`.

**Why does `matches.score_a`/`score_b` keep meaning "sets won" for both sets formats instead of adding a new winner field?**
`standings()`, `finalize_mix`, and every existing win/loss/ranking calculation already compare `score_a` vs `score_b` and read `winner_team_id` — and only ever read win/loss/tie from them, never their magnitude (confirmed in `migration_elo_rating.sql`'s ELO calc). Keeping those columns as "the number that decides the match" (points today, sets won for either sets format, games for `pro_set_9`) means none of that shared code needs to change — only how the UI collects and computes that number changes.

**Why does `pro_set_9` need no new table, but the two sets formats do?**
A pro-set is still one number pair — the games score — so it fits directly in `matches.score_a`/`score_b` with a different validation rule (win by 2, capped at 9, with an 8-8 breaker). A sets-based match needs to record up to 3 independent results (set 1, set 2, and a possible decider) before `matches.score_a`/`score_b` can be computed as "sets won" — that needs its own rows, shared by both sets formats (see Data Model).

**Why does the 8-8 pro-set breaker reuse the exact same "super tie-break" entry as `melhor_2_sets`'s 1-1 decider, instead of separate UI flows?**
Both are "one number pair, first to 10, decides the whole match" — same shape, same validation, same component. One primitive, multiple call sites.

## Data Model

- `games.scoring_format` — new `TEXT`, `CHECK (scoring_format IN ('pontos_simples', 'melhor_2_sets', 'melhor_3_sets', 'pro_set_9'))`, `NOT NULL DEFAULT 'pontos_simples'`. Every existing row defaults to today's behavior.
- `match_sets` — new table, populated for both `melhor_2_sets` and `melhor_3_sets` matches:
  - `id`, `match_id` (FK → `matches`, cascade delete), `set_number` (1, 2, or 3 — 3 only exists when the first two split 1-1), `score_a`, `score_b`, `is_super_tiebreak` (bool — true only for a `melhor_2_sets` decider; always false for `melhor_3_sets`, including its 3rd-set decider, since that's a normal set, not a tie-break).
  - Unique on `(match_id, set_number)`.
- No new table for `pro_set_9` — it stays a single `score_a`/`score_b` pair on `matches`, just validated differently (see Match Rules) and, when an 8-8 breaker happens, the *breaker's own* score isn't persisted anywhere separately — only the resulting 9-8 goes into `matches.score_a`/`score_b`. (This trades away a small amount of history — you can't tell from the data alone that a given 9-8 came from a breaker rather than a run of holds — an acceptable, deliberate simplification: nothing downstream needs that distinction.)

## Match Rules

- **`pontos_simples`** (existing, unchanged): any two non-equal non-negative integers.
- **`pro_set_9`**: winner reaches 9, loser has ≤7 (win-by-2 normal games), **or** the score is 8-8 and a super tie-break (first to 10, win by 2) is played — its winner's final recorded score is `9-8`. UI: enter the games score as normal; if both reach 8, the app prompts for the super tie-break instead of two more game-score fields, and writes `9-8` once that's entered.
- **`melhor_2_sets`**: first to win 2 sets. Each set is a normal games score (e.g. 6-4) — no games-level tie-break modeling (a set's own games score is trusted input, same level as today's simple score entry). If sets split 1-1, the decider is a **super tie-break** (first to 10, win by 2), flagged `is_super_tiebreak = true`.
- **`melhor_3_sets`**: identical to `melhor_2_sets` except the 1-1 decider is a **normal 3rd set** (same trusted-input rule as sets 1-2), not a tie-break — `is_super_tiebreak` stays false on that row.
- Both sets formats: `matches.score_a`/`score_b` is set to the count of sets won by each team once decided (2-0 or 2-1).

## UI

- Mix creation (all 3 formats): a new "Pontuação" selector next to the existing format selector, defaulting to "Pontos simples", with 4 options.
- Match score entry (`GameDetails.jsx`): branches on `game.scoring_format`.
  - `pontos_simples`: unchanged.
  - `pro_set_9`: same two-number entry, new validation (win-by-2, 9 cap), with the super-tie-break prompt when 8-8 is entered.
  - `melhor_2_sets` / `melhor_3_sets`: collects set 1, then set 2; if split 1-1, collects the decider (labeled "Super tie-break" for `melhor_2_sets`, "Set 3" for `melhor_3_sets`); computes and writes `matches.score_a/score_b` as sets won once the match is decided.

## Out of scope

- Ad/no-ad or in-set tie-break modeling (a set's games score is trusted input, like today's simple score) — applies to every set in both sets formats, including `melhor_3_sets`'s 3rd set.
- Any change to `sobe_desce`/`todos_contra_todos`/`grupos_eliminatorias` engine logic — this is purely a scoring-entry and result-computation layer underneath them.
- Retroactively backfilling `match_sets` for historical matches.
