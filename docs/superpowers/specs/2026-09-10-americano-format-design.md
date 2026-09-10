# Americano Format — Design Spec

## Goal

Add **Americano** as a new mix `format` value (alongside `sobe_desce`, `todos_contra_todos`, `grupos_eliminatorias`): partners rotate every round instead of staying fixed for the whole mix, and the mix produces an **individual** player ranking (sum of points scored) instead of a winning dupla.

## Key Decisions

**Why reuse the `teams` table instead of a new schema for round-level pairings?**
`teams` already just means "two players paired for a match" — nothing in its schema (`player1_id`, `player2_id`, `seed_ranking`) or in `matches` (`team_a_id`/`team_b_id`) assumes a team is exclusive to one mix-wide pairing. Today's other formats happen to create exactly one `teams` row per player per mix, but nothing enforces that. Americano creates a **new `teams` row for every dupla formed in every round** — same schema, same `matches` shape, zero changes to either table. Every existing piece of UI that renders a match by `team_a_id`/`team_b_id` (court cards, score entry, `ScoreEntry`) keeps working unmodified.

**Why compute the whole schedule upfront instead of round-by-round (like `todos_contra_todos`'s "draw next round" button)?**
`sobe_desce`/`todos_contra_todos` draw each round from the *previous round's results* (winner moves up a court; round-robin rotation just needs a round index, not scores). Americano's partner-rotation only needs to know **who has already partnered whom** — never a match outcome — so there's no reason to wait for scores before generating round 2. Generating every round at mix-start lets players see the full draw immediately (a real Americano-night expectation) and removes an entire "advance round" interaction for this format. This does mean `GameDetails.jsx`'s existing `canAdvance`/`inGroupPhase` machinery (built for round-by-round formats) must be forced off for Americano, the same way it already is for `grupos_eliminatorias` (`inGroupPhase = isGruposEliminatorias ? false : ...` — Americano gets the equivalent `isAmericano ? false : ...` treatment). `canFinalize` becomes simply "every generated match has a score" — there's nothing to advance to.

**Why individual-only entry (no "convidar parceiro" for Americano mixes)?**
Every other format's join flow lets a player lock in a partner because that partner is *who they play the whole mix with*. Americano has no such concept — partners are assigned per round by the algorithm. Offering a partner-invite step that gets silently ignored would be actively misleading, so the join flow hides it entirely when `game.format === 'americano'`. This needs no schema change — `participants.partner_id` simply stays `NULL` for every Americano participant, same column, same table.

**Why `scoring_format` locked to `pontos_simples` for Americano?**
The chosen ranking (sum of points scored across all rounds) only means something when "points scored" is a raw, comparable number across every match — which is exactly what `pontos_simples` already is. A sets-based format's `matches.score_a`/`score_b` means "sets won" (0-2), and summing "sets won" across 5-6 short Americano rounds produces a number with none of the resolution a real point-count has. Rather than let an admin pick a combination that silently produces a meaningless ranking, add a cross-column `CHECK` to `games`: `format <> 'americano' OR scoring_format = 'pontos_simples'`.

**Why a new `finalize_americano_mix(p_game_id)` RPC instead of reusing `finalize_mix(p_game_id, p_winner_team_id)`?**
`finalize_mix` takes a single winning `team_id` as its whole API — every downstream calculation (`won_mix` per player, the `point_per_mix_win` bonus, `games.winner_team_id`) is keyed off it. Americano has no such team: the "winner" is whichever *individual* player scored the most points, and that player was on a different `teams` row in nearly every match. Retrofitting `finalize_mix` to accept an optional player-instead-of-team winner would tangle two different reward models into one function. A dedicated RPC keeps both simple: `finalize_americano_mix` computes each player's summed score directly from `matches`/`teams` (the same per-player-unnest join pattern `migration_elo_partner_shield.sql`'s head-to-head query already uses — `CASE WHEN pa.is_a THEN m.score_a ELSE m.score_b END`, proven safe in this codebase), and awards `point_per_mix_win` to the single top scorer instead of a pair. `games.winner_team_id` stays `NULL` for a finished Americano mix (the column is already nullable) — there's no team to reference; the individual per-player ranking (`mix_player_stats.points_earned`, already populated by the shared aggregation logic every format uses) is the actual record of who won.

**Why is ELO/ranking math otherwise untouched?**
`apply_mix_elo` already iterates **per player**, not per team (confirmed: it loops matches, and for each match resolves both teams' `player1_id`/`player2_id` individually) — it has never assumed a player keeps one partner for the whole mix. Americano's constantly-changing duplas are exactly the shape this function already handles per-match; nothing about it needs to change.

**Repeat-avoidance is greedy, not a perfect combinatorial design.**
Real "everyone partners everyone exactly once, everyone faces everyone the fewest times possible" scheduling (the social golfer problem) has no simple closed-form solution and isn't worth the complexity for a padel night. `formDuplas`'s existing pattern — sort by seed, greedily pair the closest candidate that isn't a repeat, relax the constraint only when no non-repeat candidate is left — is the same approach Americano's round generator uses, just re-run per round with a partner-history set that accumulates across rounds. Opponent-repeat avoidance (which dupla faces which) is a soft secondary preference, never a hard constraint — partner variety is the point of the format, opponent variety is a nice-to-have.

## Data Model

- `games.format` CHECK gains `'americano'` as a fourth value.
- `games` gains a cross-column CHECK: `(format <> 'americano' OR scoring_format = 'pontos_simples')`.
- No changes to `teams`, `matches`, or `participants` schemas — Americano reuses all three exactly as they are, at higher volume (many `teams` rows per mix instead of one per player).
- New RPC `finalize_americano_mix(p_game_id UUID) RETURNS void`: same admin/org/status guards as `finalize_mix`, requires every match to have a score, computes each player's `played`/`wins`/`losses`/summed `scored` points via the existing per-player-unnest join pattern, applies the same `points_rules` formula `finalize_mix` uses (`point_per_match_played`, `point_per_match_win`, `point_per_mix_participation`) but awards `point_per_mix_win` only to the single player with the highest summed score (ties: all tied top scorers get it — simpler and fairer than picking one arbitrarily), writes `player_stats`/`mix_player_stats` the same way `finalize_mix` does, sets `games.status = 'finished'` with `winner_team_id` left `NULL`.

## Match Structure

- **Player/court requirement**: participant count must be an exact multiple of 4 (one dupla per side, 2 duplas per court, no byes in v1) — validated the same layer `grupos_eliminatorias`'s pool-count validation lives in, before the mix can start.
- **Round count**: reuses the existing `totalRounds(game)` (court/game time based), same as every other format.
- **Schedule generation** (new pure function `generateAmericanoSchedule(players, numCourts, numRounds, pointsById)` in `mixLogic.js`): for each of `numRounds` rounds, greedily forms `numCourts * 2` duplas from all players (repeat-partner avoidance, same relax-then-accept fallback as `formDuplas`), then pairs those duplas into `numCourts` matches per round (soft repeat-opponent avoidance). Returns all rounds' pairings in one pass — no round depends on any other round's outcome.
- **No elimination phase** — every match is `phase = 'group'`; there is no `grupos_eliminatorias`-style knockout stage. `eliminationPhases`/`firstElimMatches`/`nextElimMatches` are not used by this format.
- **Mix start**: when the admin starts an Americano mix, `generateAmericanoSchedule` runs once, producing every round's `teams` + `matches` rows in one batch insert (mirroring how `grupos_eliminatorias`'s pool stage is seeded in one batch today).
- **`GameDetails.jsx`**: `isAmericano` forces `canAdvance = false` (no "draw next round" action exists for this format — everything is already drawn); `canFinalize = allDone` (every match across every round has a winner) with no `canAdvance` gate to check against, since there's nothing further to advance to.

## Ranking

- New pure function `americanoStandings(matches, teams)` in `mixLogic.js`, parallel to `standings()`: for each player, sums the score of every match their team (any of their per-round `teams` rows) played, and counts wins. Sort: summed points scored → wins scored (tie-break for equal points, not the primary criterion — the user's chosen ranking is "sum of points scored", wins only break ties).
- Rendered in `GameDetails.jsx` as a per-player ranking table (name, points, wins) — replaces the per-dupla "classificação" view used by `grupos_eliminatorias`'s pool stage, for this format only.

## UI

- Mix creation (`GerirClube.jsx`): add `'americano'` to the `FORMATS` selector.
- Join flow: when `game.format === 'americano'`, hide the "convidar parceiro" step entirely — join is always solo.
- Mix start: no partner/pool-size config needed (unlike `grupos_eliminatorias`'s pool-size field) — just the multiple-of-4 participant count validation before the start button is enabled.
- `GameDetails.jsx`: renders every round's matches at once (already supported — the existing round-rendering loop iterates every distinct `round_number` present in `matches`, nothing here requires it to be "the current round only"); a ranking table replaces the standings/advance-round UI; the finalize button calls `finalize_americano_mix(game_id)` directly — no winning-dupla picker.

## Out of Scope

- Bye handling for player counts that aren't a multiple of 4 (v1 requires an exact multiple of 4).
- Perfect/optimal partner-and-opponent scheduling (social golfer problem) — greedy repeat-avoidance only.
- Mexicano-style dynamic (score-dependent) pairing — Americano's schedule is fixed upfront, not re-seeded per round by current standings. That's a distinct, separately-deferred format idea.
- Any change to `sobe_desce`/`todos_contra_todos`/`grupos_eliminatorias` engines, `apply_mix_elo`, or `finalize_mix` itself — Americano adds a new, parallel finalize path rather than modifying the shared one.
