# Americano Mix Format Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `'americano'` as a new `games.format` value: partners rotate every round (no fixed dupla for the whole mix), the full round schedule is generated upfront at mix-start, and the mix produces an individual per-player ranking (sum of points scored) instead of a winning dupla.

**Architecture:** Two new pure functions in `mixLogic.js` (`generateAmericanoSchedule`, `americanoStandings`) drive the format — no changes to `teams`/`matches`/`participants` schemas, since Americano just creates many `teams` rows per mix (one per round-pairing) instead of one per player. `GameDetails.jsx` gets an Americano-specific branch in its mix-start handler (batch-inserts every round's teams+matches at once, instead of the round-by-round draw other formats use) and several render-site guards that hide UI built around "one fixed dupla per player" (the Duplas card, the todos-contra-todos-style Classificação block) in favor of a new individual ranking table. A new `finalize_americano_mix` RPC replaces `finalize_mix` for this format only, since there's no single winning team to pass it.

**Tech Stack:** React + Vite + Supabase (Postgres + RPC). Vitest already set up (`vitest.config.js`, `src/lib/mixLogic.test.js`).

**Spec:** `docs/superpowers/specs/2026-09-10-americano-format-design.md`

## Global Constraints

- No changes to `sobe_desce`/`todos_contra_todos`/`grupos_eliminatorias` engine logic, `apply_mix_elo`, or `finalize_mix` itself — Americano adds a new, parallel finalize path and its own schedule/ranking functions, never modifies the shared ones.
- `teams`, `matches`, `participants` schemas are unchanged — Americano reuses them exactly as they are (`teams` just gets many more rows per mix: one per round-pairing, not one per player).
- `games.scoring_format` must always be `'pontos_simples'` when `games.format = 'americano'` (enforced by a cross-column `CHECK`) — Americano's individual ranking (sum of points scored) only means something with raw point totals.
- Americano requires an exact multiple of 4 confirmed participants to start (no byes in v1).
- Partner/opponent repeat-avoidance is greedy (mirrors `formDuplas`'s existing style: sort by seed, pair the closest non-repeat candidate, accept a repeat only once no non-repeat candidate remains) — not a perfect combinatorial schedule.

---

## Task 1: Schedule generation — pure function

**Files:**
- Modify: `src/lib/mixLogic.js`
- Test: `src/lib/mixLogic.test.js`

**Interfaces:**
- Produces: `generateAmericanoSchedule(players, numCourts, numRounds, pointsById = {})` → an array of `numRounds` rounds; each round is an array of `numCourts` match objects `{ court_number, duplaA: { player1, player2, seed }, duplaB: { player1, player2, seed } }`. `players` is an array of player objects (each needs at least `.id`; `.name` isn't read by this function but flows through untouched for later use). `pointsById` maps `player.id` → a number (defaults to 0 when absent), used only to seed duplas/courts by combined strength (mirrors `formDuplas`/`seedCourts`'s existing use of points). Consumed by Task 6 (`GameDetails.jsx`'s Americano mix-start branch).

- [ ] **Step 1: Write the failing tests** — add to the end of `src/lib/mixLogic.test.js` (open the file first to see its existing `import`/`describe` structure and match it — add a new `describe('generateAmericanoSchedule', ...)` block, importing `generateAmericanoSchedule` alongside the file's other existing imports from `./mixLogic`):

```js
describe('generateAmericanoSchedule', () => {
  const mkPlayer = (id) => ({ id, name: `P${id}` })
  const eightPlayers = Array.from({ length: 8 }, (_, i) => mkPlayer(i + 1))
  const fourPlayers = eightPlayers.slice(0, 4)

  it('returns numRounds rounds, each with numCourts matches covering every player exactly once', () => {
    const schedule = generateAmericanoSchedule(eightPlayers, 2, 3, {})
    expect(schedule).toHaveLength(3)
    for (const round of schedule) {
      expect(round).toHaveLength(2)
      const usedIds = round.flatMap(m => [m.duplaA.player1.id, m.duplaA.player2.id, m.duplaB.player1.id, m.duplaB.player2.id])
      expect(usedIds).toHaveLength(8)
      expect(new Set(usedIds).size).toBe(8)
    }
  })

  it('assigns court numbers 1..numCourts within each round', () => {
    const schedule = generateAmericanoSchedule(eightPlayers, 2, 1, {})
    expect(schedule[0].map(m => m.court_number).sort()).toEqual([1, 2])
  })

  it('never repeats a partnership while unique partners remain (n-1 rounds for n players)', () => {
    const schedule = generateAmericanoSchedule(eightPlayers, 2, 7, {}) // 8 players -> 7 possible unique partners each
    const seenPairs = new Set()
    let repeats = 0
    for (const round of schedule) {
      for (const m of round) {
        for (const dupla of [m.duplaA, m.duplaB]) {
          const key = [dupla.player1.id, dupla.player2.id].sort().join('|')
          if (seenPairs.has(key)) repeats++
          seenPairs.add(key)
        }
      }
    }
    expect(repeats).toBe(0)
  })

  it('handles the minimum case: 4 players, 1 court', () => {
    const schedule = generateAmericanoSchedule(fourPlayers, 1, 2, {})
    expect(schedule).toHaveLength(2)
    for (const round of schedule) {
      expect(round).toHaveLength(1)
      const usedIds = [round[0].duplaA.player1.id, round[0].duplaA.player2.id, round[0].duplaB.player1.id, round[0].duplaB.player2.id]
      expect(new Set(usedIds).size).toBe(4)
    }
  })

  it('carries a seed (sum of pointsById) on each dupla', () => {
    const pointsById = { 1: 100, 2: 200, 3: 300, 4: 400 }
    const schedule = generateAmericanoSchedule(fourPlayers, 1, 1, pointsById)
    const m = schedule[0][0]
    expect(m.duplaA.seed).toBe((pointsById[m.duplaA.player1.id] ?? 0) + (pointsById[m.duplaA.player2.id] ?? 0))
    expect(m.duplaB.seed).toBe((pointsById[m.duplaB.player1.id] ?? 0) + (pointsById[m.duplaB.player2.id] ?? 0))
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/mixLogic.test.js`
Expected: FAIL — `generateAmericanoSchedule` is not exported yet.

- [ ] **Step 3: Implement `generateAmericanoSchedule`**

Add to `src/lib/mixLogic.js`, right after `nextElimMatches` (before the `PHASE_LABEL_KEY` export block):

```js
/** Americano: builds every round's partner-rotated duplas and court
    pairings in one pass — unlike sobe_desce/todos_contra_todos, no round
    depends on a previous round's result (only on who has already
    partnered/faced whom), so the whole schedule can be generated upfront
    at mix-start rather than drawn round by round.

    Greedy, not a perfect combinatorial design (mirrors formDuplas's own
    style): each round, players are sorted by points (desc) and paired
    with the closest candidate that hasn't been their partner yet — once
    no non-repeat candidate remains for a player, the closest available
    repeat is accepted rather than leaving anyone unpaired. The resulting
    duplas are then paired into courts the same way, softly preferring an
    opponent-dupla that hasn't been faced before (also relaxed once
    exhausted). Opponent-repeat avoidance is a secondary preference,
    never a hard constraint — partner variety is the point of the
    format, opponent variety is a nice-to-have.

    Returns: numRounds entries, each an array of numCourts
    { court_number, duplaA: {player1, player2, seed}, duplaB: {...} }. */
export function generateAmericanoSchedule(players, numCourts, numRounds, pointsById = {}) {
  const pairKey = (a, b) => [a.id, b.id].sort().join('|')
  const pointsOf = (p) => pointsById[p?.id] ?? 0

  const partnerHistory = new Set()
  const opponentHistory = new Set()
  const rounds = []

  for (let r = 0; r < numRounds; r++) {
    // ── Form this round's duplas ──────────────────────────────────────
    const pool = [...players].sort((a, b) => pointsOf(b) - pointsOf(a))
    const duplas = []
    while (pool.length >= 2) {
      const a = pool.shift()
      let idx = pool.findIndex((cand) => !partnerHistory.has(pairKey(a, cand)))
      if (idx === -1) idx = 0 // everyone left is a repeat partner — accept the closest rather than leave a gap
      const b = pool.splice(idx, 1)[0]
      partnerHistory.add(pairKey(a, b))
      duplas.push({ player1: a, player2: b, seed: pointsOf(a) + pointsOf(b) })
    }

    // ── Pair duplas into courts, softly avoiding repeat opponents ──────
    const sorted = [...duplas].sort((a, b) => b.seed - a.seed)
    const used = new Array(sorted.length).fill(false)
    const courtDuplas = []
    for (let i = 0; i < sorted.length; i++) {
      if (used[i]) continue
      const dA = sorted[i]
      const facedBefore = (dB) =>
        [dA.player1, dA.player2].some((pa) =>
          [dB.player1, dB.player2].some((pb) => opponentHistory.has(pairKey(pa, pb)))
        )
      let j = sorted.findIndex((dB, idx) => idx > i && !used[idx] && !facedBefore(dB))
      if (j === -1) j = sorted.findIndex((dB, idx) => idx > i && !used[idx])
      if (j === -1) break // no partner dupla left (shouldn't happen — caller validates player count is a multiple of 4)
      const dB = sorted[j]
      used[i] = true
      used[j] = true
      for (const pa of [dA.player1, dA.player2]) {
        for (const pb of [dB.player1, dB.player2]) opponentHistory.add(pairKey(pa, pb))
      }
      courtDuplas.push({ duplaA: dA, duplaB: dB })
    }

    rounds.push(courtDuplas.slice(0, numCourts).map((cm, idx) => ({ court_number: idx + 1, ...cm })))
  }

  return rounds
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/mixLogic.test.js`
Expected: PASS (all tests in the file, including the 5 new ones).

- [ ] **Step 5: Commit**

```bash
git add src/lib/mixLogic.js src/lib/mixLogic.test.js
git commit -m "feat: Americano schedule generation (Task 1)"
```

---

## Task 2: Individual ranking — pure function

**Files:**
- Modify: `src/lib/mixLogic.js`
- Test: `src/lib/mixLogic.test.js`

**Interfaces:**
- Produces: `americanoStandings(matches, teams)` → an array of `{ player, points, wins, played }`, sorted by `points` descending then `wins` descending. `teams` must be team rows with embedded `player1`/`player2` profile objects (the same shape `GameDetails.jsx`'s `teams` state already loads — confirmed by its existing `team.player1?.name` usage in `teamName()`/`renderDuplaBlock`). Mirrors `standings()`'s pattern of returning the full object (here: `player`) rather than just an id, so callers can read `.name` etc. directly. Consumed by Task 7 (`GameDetails.jsx`'s Americano ranking render block).

- [ ] **Step 1: Write the failing tests** — add to `src/lib/mixLogic.test.js`, in the same new `describe('generateAmericanoSchedule', ...)` area (add a sibling `describe('americanoStandings', ...)` block, importing `americanoStandings` alongside the other imports):

```js
describe('americanoStandings', () => {
  const p1 = { id: 'p1', name: 'A' }
  const p2 = { id: 'p2', name: 'B' }
  const p3 = { id: 'p3', name: 'C' }
  const p4 = { id: 'p4', name: 'D' }
  const teamAB = { id: 't-ab', player1: p1, player2: p2 }
  const teamCD = { id: 't-cd', player1: p3, player2: p4 }
  const teamAC = { id: 't-ac', player1: p1, player2: p3 }
  const teamBD = { id: 't-bd', player1: p2, player2: p4 }

  it('sums the match score onto both players of each side, ranked by total points', () => {
    const teams = [teamAB, teamCD]
    const matches = [
      { team_a_id: 't-ab', team_b_id: 't-cd', score_a: 21, score_b: 15, winner_team_id: 't-ab' },
    ]
    const result = americanoStandings(matches, teams)
    const byId = Object.fromEntries(result.map((r) => [r.player.id, r]))
    expect(byId.p1.points).toBe(21)
    expect(byId.p1.wins).toBe(1)
    expect(byId.p1.played).toBe(1)
    expect(byId.p2.points).toBe(21)
    expect(byId.p3.points).toBe(15)
    expect(byId.p3.wins).toBe(0)
    expect(byId.p4.points).toBe(15)
    expect(result[0].points).toBe(21)
  })

  it('accumulates points across multiple matches with different partners', () => {
    const teams = [teamAB, teamCD, teamAC, teamBD]
    const matches = [
      { team_a_id: 't-ab', team_b_id: 't-cd', score_a: 21, score_b: 10, winner_team_id: 't-ab' },
      { team_a_id: 't-ac', team_b_id: 't-bd', score_a: 15, score_b: 20, winner_team_id: 't-bd' },
    ]
    const result = americanoStandings(matches, teams)
    const byId = Object.fromEntries(result.map((r) => [r.player.id, r]))
    expect(byId.p1.points).toBe(36) // 21 (round 1, with p2) + 15 (round 2, with p3)
    expect(byId.p1.wins).toBe(1)
    expect(byId.p2.points).toBe(41) // 21 (round 1, with p1) + 20 (round 2, with p4)
    expect(byId.p2.wins).toBe(2)
    expect(byId.p3.points).toBe(25) // 10 (round 1, with p4) + 15 (round 2, with p1)
    expect(byId.p3.wins).toBe(0)
    expect(byId.p4.points).toBe(30) // 10 (round 1, with p3) + 20 (round 2, with p2)
    expect(byId.p4.wins).toBe(1)
    expect(result.map((r) => r.player.id)).toEqual(['p2', 'p1', 'p4', 'p3'])
  })

  it('ignores matches with no winner_team_id yet', () => {
    const teams = [teamAB, teamCD]
    const matches = [
      { team_a_id: 't-ab', team_b_id: 't-cd', score_a: null, score_b: null, winner_team_id: null },
    ]
    const result = americanoStandings(matches, teams)
    expect(result.every((r) => r.points === 0 && r.played === 0)).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/mixLogic.test.js`
Expected: FAIL — `americanoStandings` is not exported yet.

- [ ] **Step 3: Implement `americanoStandings`**

Add to `src/lib/mixLogic.js`, right after `generateAmericanoSchedule` (before the `PHASE_LABEL_KEY` export block):

```js
/** Americano's individual ranking: each player's points are the sum of
    the score their side got in every match they took part in (across
    whichever different teams row they were on each round) — not the
    team's win/loss. wins is a secondary sort key (breaks a points tie),
    never the primary one — see the design spec's "Ranking" decision.
    `teams` must have embedded player1/player2 profile objects (same
    shape GameDetails.jsx's `teams` state already carries). */
export function americanoStandings(matches, teams) {
  const teamById = Object.fromEntries(teams.map((t) => [t.id, t]))
  const table = {}
  const rowFor = (player) => {
    if (!player) return null
    if (!table[player.id]) table[player.id] = { player, points: 0, wins: 0, played: 0 }
    return table[player.id]
  }

  for (const m of matches) {
    if (!m.winner_team_id) continue
    const teamA = teamById[m.team_a_id]
    const teamB = teamById[m.team_b_id]
    if (!teamA || !teamB) continue
    for (const player of [teamA.player1, teamA.player2]) {
      const row = rowFor(player)
      if (!row) continue
      row.played += 1
      row.points += m.score_a ?? 0
      if (m.winner_team_id === teamA.id) row.wins += 1
    }
    for (const player of [teamB.player1, teamB.player2]) {
      const row = rowFor(player)
      if (!row) continue
      row.played += 1
      row.points += m.score_b ?? 0
      if (m.winner_team_id === teamB.id) row.wins += 1
    }
  }

  return Object.values(table).sort((x, y) => y.points - x.points || y.wins - x.wins)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/mixLogic.test.js`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add src/lib/mixLogic.js src/lib/mixLogic.test.js
git commit -m "feat: Americano individual ranking (Task 2)"
```

---

## Task 3: Database migration

**Files:**
- Create: `supabase/migration_americano_format.sql`

**Interfaces:**
- Produces: `games.format` CHECK gains `'americano'`; a new cross-column CHECK forces `scoring_format = 'pontos_simples'` whenever `format = 'americano'`; a new RPC `finalize_americano_mix(p_game_id UUID) RETURNS void`. Consumed by Task 5 (`GerirClube.jsx`'s format selector), Task 6/7 (`GameDetails.jsx`'s mix-start and finalize wiring).

- [ ] **Step 1: Write the migration**

```sql
-- ════════════════════════════════════════════════════════════════════════
-- Migration: Americano mix format
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- NOT LIVE until run there — this file existing in the repo changes
-- nothing on its own. Every existing mix keeps its current format,
-- unaffected.
--
-- Assumes the games.format CHECK constraint is still named
-- games_format_check (it was, as of migration_grupos_eliminatorias.sql —
-- if that's been renamed since, update the DROP CONSTRAINT line below to
-- match before running this).
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Americano as a new format value ──────────────────────────────────
ALTER TABLE games DROP CONSTRAINT IF EXISTS games_format_check;
ALTER TABLE games ADD CONSTRAINT games_format_check
  CHECK (format IN ('sobe_desce', 'todos_contra_todos', 'grupos_eliminatorias', 'americano'));

-- ── 2. Americano only ever uses pontos_simples scoring — its individual
--      ranking (sum of points scored) only means something as a raw,
--      comparable point count across every round; "sets won" summed
--      across several short Americano rounds has none of that
--      resolution. Cross-column CHECK, not just a UI default, so no path
--      (including a future one) can silently produce a meaningless
--      ranking. ───────────────────────────────────────────────────────
ALTER TABLE games DROP CONSTRAINT IF EXISTS games_americano_scoring_check;
ALTER TABLE games ADD CONSTRAINT games_americano_scoring_check
  CHECK (format <> 'americano' OR scoring_format = 'pontos_simples');

-- ── 3. finalize_americano_mix: parallel to finalize_mix, but with no
--      single winning team — the "winner" is whichever individual player
--      scored the most points, computed directly here instead of being
--      passed in. games.winner_team_id stays NULL for a finished
--      Americano mix (the column is already nullable) — mix_player_stats
--      (already populated per player, same as every other format) is the
--      real record of who won. point_per_mix_win goes to every player
--      tied for the top summed score (simpler and fairer than picking
--      one arbitrarily on a tie). ─────────────────────────────────────
CREATE OR REPLACE FUNCTION finalize_americano_mix(p_game_id UUID)
RETURNS void AS $$
DECLARE
  rules JSONB;
  v_org_id UUID;
BEGIN
  SELECT organization_id INTO v_org_id FROM games WHERE id = p_game_id;

  IF NOT EXISTS (
    SELECT 1 FROM memberships
    WHERE organization_id = v_org_id AND user_id = auth.uid() AND is_admin
  ) THEN
    RAISE EXCEPTION 'Apenas admins podem finalizar um mix';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM games WHERE id = p_game_id AND status = 'in_progress' AND format = 'americano'
  ) THEN
    RAISE EXCEPTION 'O mix não está a decorrer ou não é Americano';
  END IF;

  IF EXISTS (SELECT 1 FROM matches WHERE game_id = p_game_id AND winner_team_id IS NULL) THEN
    RAISE EXCEPTION 'Há jogos sem resultado registado';
  END IF;

  SELECT points_rules INTO rules FROM organizations WHERE id = v_org_id;
  IF rules IS NULL THEN
    rules := '{"point_per_match_played": 1, "point_per_match_win": 3, "point_per_mix_participation": 2, "point_per_mix_win": 10}'::jsonb;
  END IF;

  WITH mt AS (
    SELECT m.winner_team_id AS win_id, m.score_a, m.score_b,
           ta.id AS team_a_id, ta.player1_id AS a1, ta.player2_id AS a2,
           tb.id AS team_b_id, tb.player1_id AS b1, tb.player2_id AS b2
    FROM matches m
    JOIN teams ta ON ta.id = m.team_a_id
    JOIN teams tb ON tb.id = m.team_b_id
    WHERE m.game_id = p_game_id
  ),
  pp AS (
    SELECT a1 AS pid, score_a AS scored, (win_id = team_a_id) AS won FROM mt
    UNION ALL
    SELECT a2 AS pid, score_a AS scored, (win_id = team_a_id) AS won FROM mt
    UNION ALL
    SELECT b1 AS pid, score_b AS scored, (win_id = team_b_id) AS won FROM mt
    UNION ALL
    SELECT b2 AS pid, score_b AS scored, (win_id = team_b_id) AS won FROM mt
  ),
  agg AS (
    SELECT pid,
           COUNT(*) AS played,
           COUNT(*) FILTER (WHERE won) AS wins,
           COUNT(*) FILTER (WHERE NOT won) AS losses,
           SUM(scored) AS total_scored
    FROM pp
    WHERE pid IS NOT NULL
    GROUP BY pid
  ),
  scored AS (
    SELECT a.*
    FROM agg a
    JOIN memberships mb ON mb.user_id = a.pid AND mb.organization_id = v_org_id AND NOT mb.is_guest
  ),
  ranked AS (
    SELECT *, (total_scored = MAX(total_scored) OVER ()) AS won_mix
    FROM scored
  ),
  pcalc AS (
    SELECT pid, played, wins, losses, won_mix,
           (played * COALESCE((rules->>'point_per_match_played')::int, 0)
            + wins * COALESCE((rules->>'point_per_match_win')::int, 0)
            + COALESCE((rules->>'point_per_mix_participation')::int, 0)
            + CASE WHEN won_mix THEN COALESCE((rules->>'point_per_mix_win')::int, 0) ELSE 0 END
           ) AS pts
    FROM ranked
  ),
  ins_player_stats AS (
    INSERT INTO player_stats (user_id, organization_id, game_wins, game_losses, mix_wins, mixes_played, total_points)
    SELECT pid, v_org_id, wins, losses, CASE WHEN won_mix THEN 1 ELSE 0 END, 1, pts
    FROM pcalc
    ON CONFLICT (user_id, organization_id) DO UPDATE
    SET game_wins    = player_stats.game_wins    + EXCLUDED.game_wins,
        game_losses  = player_stats.game_losses  + EXCLUDED.game_losses,
        mix_wins     = player_stats.mix_wins     + EXCLUDED.mix_wins,
        mixes_played = player_stats.mixes_played + EXCLUDED.mixes_played,
        total_points = player_stats.total_points + EXCLUDED.total_points,
        updated_at   = NOW()
    RETURNING 1
  )
  INSERT INTO mix_player_stats (game_id, user_id, organization_id, matches_played, matches_won, points_earned, mix_won)
  SELECT p_game_id, pid, v_org_id, played, wins, pts, won_mix
  FROM pcalc
  ON CONFLICT (game_id, user_id) DO UPDATE
  SET matches_played = EXCLUDED.matches_played,
      matches_won    = EXCLUDED.matches_won,
      points_earned  = EXCLUDED.points_earned,
      mix_won        = EXCLUDED.mix_won;

  -- Per-match Elo (unaffected by format — reads matches/teams directly,
  -- never assumes a player kept one partner for the whole mix). The
  -- "vencedor do mix" merit bonus inside apply_mix_elo is gated behind
  -- p_winner_team_id IS NOT NULL — passing NULL here correctly skips
  -- only that bonus (Americano has no single winning dupla to award it
  -- to), while every per-match rating update still applies normally.
  PERFORM apply_mix_elo(p_game_id, NULL);

  UPDATE games
  SET status = 'finished', winner_team_id = NULL, updated_at = NOW()
  WHERE id = p_game_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION finalize_americano_mix(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION finalize_americano_mix(UUID) TO authenticated;
```

- [ ] **Step 2: Flag this explicitly**

This migration is **not live** until pasted into Supabase → SQL Editor and run there. Once it is, admins can create `'americano'` mixes and `finalize_americano_mix` becomes callable — say so explicitly when reporting this task done, and flag it again when Tasks 5-7 are dispatched, since they depend on this having actually run in whatever environment they're tested against. Also verify the `games_format_check` constraint name assumption (see the SQL comment) still holds by checking `supabase/migration_grupos_eliminatorias.sql` — if it was renamed by a later migration not covered by this plan, note that as a concern in this task's report rather than guessing.

- [ ] **Step 3: Commit**

```bash
git add supabase/migration_americano_format.sql
git commit -m "feat: migration for Americano format (format value, scoring lock, finalize_americano_mix) — NOT YET RUN in Supabase"
```

---

## Task 4: Label keys + locale strings

**Files:**
- Modify: `src/lib/mixLogic.js` (`FORMAT_LABEL_KEY`)
- Modify: `src/locales/pt.json`
- Modify: `src/locales/en.json`

**Interfaces:**
- Produces: `FORMAT_LABEL_KEY.americano` — consumed by Task 5 (`GerirClube.jsx`'s `FORMATS` list).

- [ ] **Step 1: Add `americano` to `FORMAT_LABEL_KEY`**

Find, in `src/lib/mixLogic.js`:

```js
export const FORMAT_LABEL_KEY = {
  sobe_desce: 'mixlogic.format_sobe_desce',
  todos_contra_todos: 'mixlogic.format_todos_contra_todos',
  grupos_eliminatorias: 'mixlogic.format_grupos_eliminatorias',
}
```

Replace with:

```js
export const FORMAT_LABEL_KEY = {
  sobe_desce: 'mixlogic.format_sobe_desce',
  todos_contra_todos: 'mixlogic.format_todos_contra_todos',
  grupos_eliminatorias: 'mixlogic.format_grupos_eliminatorias',
  americano: 'mixlogic.format_americano',
}
```

- [ ] **Step 2: Add the Portuguese strings**

In `src/locales/pt.json`, in the `"mixlogic"` object (sibling to `format_grupos_eliminatorias`), add:

```json
"format_americano": "Americano"
```

In the `"gamedetails"` object, add:

```json
"error_americano_needs_multiple_of_4": "O Americano precisa de um múltiplo de 4 jogadores confirmados (agora: {{count}}).",
"americano_ranking_title": "Classificação individual",
"register_americano_results": "Regista os resultados de todos os jogos."
```

- [ ] **Step 3: Add the matching English strings**

In `src/locales/en.json`, mirror Step 2's keys:

```json
"format_americano": "Americano"
```

```json
"error_americano_needs_multiple_of_4": "Americano needs a multiple of 4 confirmed players (currently: {{count}}).",
"americano_ranking_title": "Individual ranking",
"register_americano_results": "Register every match's result."
```

- [ ] **Step 4: Verify the app still builds**

Run: `npm run build`
Expected: builds successfully.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mixLogic.js src/locales/pt.json src/locales/en.json
git commit -m "feat: locale strings for Americano format (Task 4)"
```

---

## Task 5: Mix-creation form — Americano option

**Files:**
- Modify: `src/pages/GerirClube.jsx`

**Interfaces:**
- Consumes: `FORMAT_LABEL_KEY.americano` (Task 4).
- Produces: `games` rows creatable with `format = 'americano'` — consumed by Task 6/7 (`GameDetails.jsx`).

- [ ] **Step 1: Add `'americano'` to the `FORMATS` list**

Find:

```js
const FORMATS = [
  { value: 'sobe_desce', labelKey: FORMAT_LABEL_KEY.sobe_desce },
  { value: 'todos_contra_todos', labelKey: FORMAT_LABEL_KEY.todos_contra_todos },
  { value: 'grupos_eliminatorias', labelKey: FORMAT_LABEL_KEY.grupos_eliminatorias },
]
```

Replace with:

```js
const FORMATS = [
  { value: 'sobe_desce', labelKey: FORMAT_LABEL_KEY.sobe_desce },
  { value: 'todos_contra_todos', labelKey: FORMAT_LABEL_KEY.todos_contra_todos },
  { value: 'grupos_eliminatorias', labelKey: FORMAT_LABEL_KEY.grupos_eliminatorias },
  { value: 'americano', labelKey: FORMAT_LABEL_KEY.americano },
]
```

- [ ] **Step 2: Hide the scoring-format selector for Americano, and reset it when Americano is chosen**

Americano is locked to `pontos_simples` (Task 3's cross-column `CHECK` enforces this at the database level; this step is the matching UI layer, following the same "reset the incompatible field on format switch" precedent already established for `pool_size` in this file — mixing a stale `scoring_format` value into an Americano mix would otherwise be exactly the kind of leaked-field bug that constraint exists to prevent).

Find:

```jsx
                      <Segmented
                        options={translatedFormats}
                        value={gameForm.format}
                        onChange={(v) => setGameForm({ ...gameForm, format: v })}
                      />
                    </div>

                    {gameForm.format === 'grupos_eliminatorias' && (
```

Replace with:

```jsx
                      <Segmented
                        options={translatedFormats}
                        value={gameForm.format}
                        onChange={(v) => setGameForm({
                          ...gameForm,
                          format: v,
                          ...(v === 'americano' ? { scoring_format: 'pontos_simples' } : {}),
                        })}
                      />
                    </div>

                    {gameForm.format === 'grupos_eliminatorias' && (
```

Find:

```jsx
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {t('gerirclube.scoring_label')}
                      </label>
                      <Segmented
                        options={translatedScoringFormats}
                        value={gameForm.scoring_format}
                        onChange={(v) => setGameForm({ ...gameForm, scoring_format: v })}
                      />
                    </div>
```

Replace with:

```jsx
                    {gameForm.format !== 'americano' && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          {t('gerirclube.scoring_label')}
                        </label>
                        <Segmented
                          options={translatedScoringFormats}
                          value={gameForm.scoring_format}
                          onChange={(v) => setGameForm({ ...gameForm, scoring_format: v })}
                        />
                      </div>
                    )}
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: builds successfully.

- [ ] **Step 4: Manual verification**

Start the dev server, open "Criar Mix", confirm "Americano" appears as a 4th format option, and that selecting it hides the "Pontuação" selector (selecting a different format again brings it back, still showing "Pontos simples" since that's the field's default and Americano only ever resets it to that same value).

Note on the spec's "individual-only entry" requirement: the spec calls for hiding the "convidar parceiro" join step for Americano mixes. While exploring `GameDetails.jsx` for this plan, that button was found to already be hidden for **every** format (`joinMode('partner')` has no active call site — see the comment directly above where it would be, in the join-buttons block: "hidden for now (not deleted) ... planned for reintroduction later"). So this requirement is already satisfied app-wide, not something this plan needs to add — no task does. If that button is ever reintroduced later, hiding it specifically for `format === 'americano'` becomes a real follow-up at that point, not before.

- [ ] **Step 5: Commit**

```bash
git add src/pages/GerirClube.jsx
git commit -m "feat: Americano option in mix-creation form (Task 5)"
```

---

## Task 6: Mix-start wiring — Americano schedule generation

**Files:**
- Modify: `src/pages/GameDetails.jsx`

**Interfaces:**
- Consumes: `generateAmericanoSchedule` (Task 1).
- Produces: when `game.format === 'americano'`, clicking "Começar Mix" generates every round's `teams`+`matches` rows in one batch and sets `games.status = 'in_progress'` directly (no separate "Começar Ronda 1" step, unlike other formats) — consumed by Task 7 (render wiring, which must not show that now-unnecessary separate step for this format).

Note on validation timing: the spec describes the multiple-of-4 participant check as happening "before the start button is enabled." This task instead validates it inside `handleStartMix` itself (throwing an error the existing `catch` block surfaces via `setMixError`), matching the precedent already established for `grupos_eliminatorias`'s pool-size validation in this exact function — that one is also a post-click check, not a pre-disabled button. Consistency with the existing pattern in this file takes priority over the spec's literal phrasing here.

- [ ] **Step 1: Import `generateAmericanoSchedule`**

Find the line in `src/pages/GameDetails.jsx` that imports from `../lib/mixLogic` (it currently destructures several names including `formDuplas`, `seedCourts`, `roundRobinRound`, `standings`, etc. — add `generateAmericanoSchedule` to that same destructured import list, alongside the existing names, without removing any of them).

- [ ] **Step 2: Branch `handleStartMix` for Americano**

Find, inside `handleStartMix` (the function whose first line is `setBusy(true)` followed by `setMixError('')`, then a comment about Elo rating driving pairing):

```js
      // Duplas from the most recent previous mix at this club — solos
      // whose points-based pairing would recreate one of these get
      // reshuffled with the next-closest points instead (see formDuplas).
      const { data: previousGames } = await supabase
        .from('games')
        .select('id')
        .eq('organization_id', gameOrganizationId)
        .lt('date', game.date)
        .order('date', { ascending: false })
        .limit(1)
      let repeatPairKeys = new Set()
      if (previousGames?.[0]) {
        const { data: previousTeams } = await supabase
          .from('teams')
          .select('player1_id, player2_id')
          .eq('game_id', previousGames[0].id)
        repeatPairKeys = new Set(
          (previousTeams || []).map(team => [team.player1_id, team.player2_id].sort().join('|'))
        )
      }

      // 4.1 formação de duplas
      const duplas = formDuplas(participants, pointsById, repeatPairKeys)
```

Replace with:

```js
      // Americano has no "one fixed dupla per player" concept — partners
      // rotate every round — so it skips formDuplas/repeatPairKeys
      // entirely and generates its own whole-mix schedule upfront (see
      // generateAmericanoSchedule's doc comment for why that's safe to
      // do before any result exists, unlike sobe_desce/todos_contra_todos).
      if (game.format === 'americano') {
        const players = participants.filter((p) => p.status === 'confirmed').map((p) => p.user).filter(Boolean)
        if (players.length < 4 || players.length % 4 !== 0) {
          throw new Error(t('gamedetails.error_americano_needs_multiple_of_4', { count: players.length }))
        }
        const numCourts = players.length / 4
        const numRounds = totalRounds(game)
        const schedule = generateAmericanoSchedule(players, numCourts, numRounds, pointsById)

        // Flatten every round's duplas into one teams-insert payload,
        // tracking which (round, court, side) each row belongs to so the
        // ids Supabase hands back (in the same order — guaranteed by a
        // single multi-row INSERT ... RETURNING) can be re-attached to
        // build the matches rows next.
        const teamRows = []
        const slots = []
        schedule.forEach((round, roundIdx) => {
          round.forEach((m) => {
            for (const side of ['duplaA', 'duplaB']) {
              const dupla = m[side]
              teamRows.push({
                game_id: id,
                player1_id: dupla.player1.id,
                player2_id: dupla.player2.id,
                seed_ranking: dupla.seed,
              })
              slots.push({ roundIdx, court_number: m.court_number, side })
            }
          })
        })

        const { data: insertedTeams, error: teamsError } = await supabase.from('teams').insert(teamRows).select()
        if (teamsError) throw teamsError

        const teamIdBySlot = {}
        insertedTeams.forEach((team, i) => {
          const { roundIdx, court_number, side } = slots[i]
          teamIdBySlot[`${roundIdx}|${court_number}|${side}`] = team.id
        })

        const matchRows = []
        schedule.forEach((round, roundIdx) => {
          round.forEach((m) => {
            matchRows.push({
              game_id: id,
              round_number: roundIdx + 1,
              court_number: m.court_number,
              team_a_id: teamIdBySlot[`${roundIdx}|${m.court_number}|duplaA`],
              team_b_id: teamIdBySlot[`${roundIdx}|${m.court_number}|duplaB`],
              phase: 'group',
            })
          })
        })

        const { error: matchesError } = await supabase.from('matches').insert(matchRows)
        if (matchesError) throw matchesError

        const { error: statusError } = await supabase
          .from('games')
          .update({
            status: 'in_progress',
            round_started_at: new Date().toISOString(),
            round_duration_minutes: game.game_time_minutes,
          })
          .eq('id', id)
        if (statusError) throw statusError

        loadGameDetails()
        return
      }

      // Duplas from the most recent previous mix at this club — solos
      // whose points-based pairing would recreate one of these get
      // reshuffled with the next-closest points instead (see formDuplas).
      const { data: previousGames } = await supabase
        .from('games')
        .select('id')
        .eq('organization_id', gameOrganizationId)
        .lt('date', game.date)
        .order('date', { ascending: false })
        .limit(1)
      let repeatPairKeys = new Set()
      if (previousGames?.[0]) {
        const { data: previousTeams } = await supabase
          .from('teams')
          .select('player1_id, player2_id')
          .eq('game_id', previousGames[0].id)
        repeatPairKeys = new Set(
          (previousTeams || []).map(team => [team.player1_id, team.player2_id].sort().join('|'))
        )
      }

      // 4.1 formação de duplas
      const duplas = formDuplas(participants, pointsById, repeatPairKeys)
```

(The `if (game.format === 'americano') { ... return }` block goes BEFORE the existing "Duplas from the most recent previous mix" code — both blocks are shown above so the insertion point is unambiguous; nothing after the inserted block changes.)

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: builds successfully.

- [ ] **Step 4: Manual verification**

This isn't reachable yet in the running app without Task 3's migration having been run against whatever Supabase instance is being tested against (needed for `format = 'americano'` to be insertable at all) and Task 5 (needed to create one via the UI) — if neither is confirmed live in this environment, verify by reading the code instead: trace an 8-player, 2-court Americano mix through `handleStartMix`'s new branch — confirm `players.length` (8) passes the multiple-of-4 check, `numCourts` computes to 2, `generateAmericanoSchedule` gets called with the right arguments, the `teamRows`/`slots` arrays end up with `numRounds * numCourts * 2` entries each in matching order, and the final `matchRows` correctly reference the just-inserted team ids via `teamIdBySlot`. State clearly in your report which you did.

- [ ] **Step 5: Commit**

```bash
git add src/pages/GameDetails.jsx
git commit -m "feat: Americano mix-start schedule generation (Task 6)"
```

---

## Task 7: Render + finalize wiring — Americano ranking, hiding dupla-based UI

**Files:**
- Modify: `src/pages/GameDetails.jsx`

**Interfaces:**
- Consumes: `americanoStandings` (Task 2).
- Produces: an Americano mix (a) never shows the Duplas card or the todos-contra-todos-style Classificação block (both assume one fixed dupla per player for the whole mix — wrong shape for Americano's many-teams-per-mix reality), (b) shows a new individual ranking table instead, (c) never shows the round1/advance round-progression buttons (the whole schedule is already drawn at mix-start — see Task 6), (d) finalizes via `finalize_americano_mix` instead of `finalize_mix`, with no winning-dupla requirement.

- [ ] **Step 1: Add the `isAmericano` derived flag**

Find:

```js
  const isSobeDesce = (game?.format || 'sobe_desce') === 'sobe_desce'
  const isGruposEliminatorias = game?.format === 'grupos_eliminatorias'
```

Replace with:

```js
  const isSobeDesce = (game?.format || 'sobe_desce') === 'sobe_desce'
  const isGruposEliminatorias = game?.format === 'grupos_eliminatorias'
  const isAmericano = game?.format === 'americano'
```

- [ ] **Step 2: Force `inGroupPhase` and `elimPhases` off for Americano**

Americano has no group/knockout progression at all — everything needed is already drawn at mix-start (Task 6) — so it needs the same "forced off" treatment `grupos_eliminatorias` already gets for `inGroupPhase`, extended to also cover `elimPhases` (which `grupos_eliminatorias` does NOT force off, since it genuinely has a knockout phase — Americano never does).

Find:

```js
  const inGroupPhase = isGruposEliminatorias ? false : maxRound < groupRounds
```

Replace with:

```js
  const inGroupPhase = (isGruposEliminatorias || isAmericano) ? false : maxRound < groupRounds
```

Find:

```js
  const elimPhases = isSobeDesce
    ? []
    : isGruposEliminatorias
      ? eliminationPhases(advancingTeamCount, Number.MAX_SAFE_INTEGER)
      : eliminationPhases(teams.length, roundsTotal - groupRounds)
```

Replace with:

```js
  const elimPhases = (isSobeDesce || isAmericano)
    ? []
    : isGruposEliminatorias
      ? eliminationPhases(advancingTeamCount, Number.MAX_SAFE_INTEGER)
      : eliminationPhases(teams.length, roundsTotal - groupRounds)
```

- [ ] **Step 3: Skip `currentWinnerTeamId` computation for Americano**

Find:

```js
  const currentWinnerTeamId = (() => {
    if (!matches.some(m => m.winner_team_id)) return null
```

Replace with:

```js
  const currentWinnerTeamId = isAmericano ? null : (() => {
    if (!matches.some(m => m.winner_team_id)) return null
```

(The rest of the arrow function body and its closing `})()` are unchanged — only the opening line gains the `isAmericano ? null :` branch.)

- [ ] **Step 4: Add the `americanoStandingsResult` derived value**

Find:

```js
  const tctStandings = !isSobeDesce && teams.length ? standings(teams, matches) : []
```

Replace with:

```js
  const tctStandings = !isSobeDesce && teams.length ? standings(teams, matches) : []
  const americanoStandingsResult = isAmericano && teams.length ? americanoStandings(matches, teams) : []
```

Also add `americanoStandings` to the same `../lib/mixLogic` import list Task 6 already added `generateAmericanoSchedule` to.

- [ ] **Step 5: Branch `handleFinalize` for Americano**

Find:

```js
  const handleFinalize = async (early = false) => {
    if (!currentWinnerTeamId) return
    const msg = early
      ? t('gamedetails.confirm_finalize_early')
      : t('gamedetails.confirm_finalize')
    if (!confirm(msg)) return
    setBusy(true)
    setMixError('')
    try {
      const { error } = await supabase.rpc('finalize_mix', {
        p_game_id: id,
        p_winner_team_id: currentWinnerTeamId,
      })
      if (error) throw error
```

Replace with:

```js
  const handleFinalize = async (early = false) => {
    if (!isAmericano && !currentWinnerTeamId) return
    const msg = early
      ? t('gamedetails.confirm_finalize_early')
      : t('gamedetails.confirm_finalize')
    if (!confirm(msg)) return
    setBusy(true)
    setMixError('')
    try {
      const { error } = isAmericano
        ? await supabase.rpc('finalize_americano_mix', { p_game_id: id })
        : await supabase.rpc('finalize_mix', { p_game_id: id, p_winner_team_id: currentWinnerTeamId })
      if (error) throw error
```

- [ ] **Step 6: Hide the Duplas card (live view)**

Find (this exact line is the opening of the "Duplas" card — a unique anchor, its `id="mix-duplas"` doesn't appear anywhere else in the file):

```jsx
          <div id="mix-duplas" className="card scroll-mt-24">
```

Replace with:

```jsx
          {!isAmericano && (
          <div id="mix-duplas" className="card scroll-mt-24">
```

Find the matching closing tag — the end of that same card, identifiable by what immediately follows it (this exact 3-line sequence is unique in the file):

```jsx
          </div>

          {showDuplasShare && (
```

Replace with:

```jsx
          </div>
          )}

          {showDuplasShare && (
```

(Do not modify anything between these two edits — the card's ~150 lines of interior JSX are untouched, only wrapped.)

- [ ] **Step 7: Hide the Duplas card (finished-mix tabbed view)**

Find:

```jsx
              {finishedTab === 'duplas' && teams.length > 0 && (
                <div className="card">
                  <h3 className="text-lg text-ink-900 mb-3">{t('gamedetails.duplas')}</h3>
                  <div className="space-y-2">
                    {teams.map((team) => (
                      <div key={team.id} className="rounded-ctrl p-3 bg-canvas">
                        {renderDuplaBlock(team)}
                      </div>
                    ))}
                  </div>
                </div>
              )}
```

Replace with:

```jsx
              {finishedTab === 'duplas' && !isAmericano && teams.length > 0 && (
                <div className="card">
                  <h3 className="text-lg text-ink-900 mb-3">{t('gamedetails.duplas')}</h3>
                  <div className="space-y-2">
                    {teams.map((team) => (
                      <div key={team.id} className="rounded-ctrl p-3 bg-canvas">
                        {renderDuplaBlock(team)}
                      </div>
                    ))}
                  </div>
                </div>
              )}
```

- [ ] **Step 8: Hide the todos-contra-todos-style Classificação block (both occurrences)**

Find (this exact line appears twice in the file — once in the live in-progress view, once in the finished-mix tabbed view; both need the identical fix, so use a find-and-replace-all-occurrences edit rather than fixing just the first match):

```jsx
          {!isSobeDesce && !isGruposEliminatorias && roundsStarted && tctStandings.length > 0 && (
```

Replace **every** occurrence with:

```jsx
          {!isSobeDesce && !isGruposEliminatorias && !isAmericano && roundsStarted && tctStandings.length > 0 && (
```

(Indentation may differ slightly between the two occurrences — match each one's own existing indentation, only the condition inside `{...}` changes.)

- [ ] **Step 9: Add the individual ranking block (both occurrences)**

Find (this exact block appears twice — once in the live view, once in the finished-mix tabbed view):

```jsx
          {inPoolStage && (
            <PoolGroupStage
              teams={teams}
              matches={matches.filter((m) => m.phase === 'group')}
              numCourts={numCourts}
              busy={busy}
              teamName={teamName}
              onDrawRound={handleDrawPoolRound}
              onAllPoolsComplete={handleAllPoolsComplete}
            />
          )}
```

Immediately after each occurrence, insert:

```jsx

          {isAmericano && americanoStandingsResult.length > 0 && (
            <div className="card">
              <h3 className="text-lg text-ink-900 mb-3">{t('gamedetails.americano_ranking_title')}</h3>
              <div className="space-y-1.5">
                {americanoStandingsResult.map((s, i) => (
                  <div key={s.player.id} className="flex items-center gap-3 text-sm py-1.5 border-b border-line last:border-0">
                    <span className="w-6 font-extrabold text-ink-900 tabular-nums">{i + 1}</span>
                    <span className="flex-1 font-extrabold text-ink-900 truncate">{s.player.name}</span>
                    <span className="text-muted tabular-nums" title={t('gamedetails.wins_title')}>{s.wins}{t('gamedetails.wins_abbrev')}</span>
                    <span className="text-muted tabular-nums w-12 text-right">{s.points} {t('gamedetails.points_suffix')}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
```

(Both `PoolGroupStage` occurrences are structurally identical, so the same insertion works at both sites — the second occurrence sits inside the finished-mix tabbed view's `finishedTab === 'rondas'` branch, same as the Classificação block right above it.)

- [ ] **Step 10: Skip the "Começar Ronda 1" button and adjust the results-pending hint for Americano**

Find:

```jsx
                  {!roundsStarted && (
                    <PrimaryButton onClick={handleStartRound1} disabled={busy} className="w-full">
                      <Play size={20} />
                      {busy ? t('gamedetails.drawing') : t('gamedetails.start_round1')}
                    </PrimaryButton>
                  )}
```

Replace with:

```jsx
                  {!roundsStarted && !isAmericano && (
                    <PrimaryButton onClick={handleStartRound1} disabled={busy} className="w-full">
                      <Play size={20} />
                      {busy ? t('gamedetails.drawing') : t('gamedetails.start_round1')}
                    </PrimaryButton>
                  )}
```

(This button should never actually be reachable for Americano in practice — Task 6's `handleStartMix` branch inserts matches immediately, so `roundsStarted` is already true by the time the UI can render this section — but this guard makes that explicit and safe rather than relying on timing.)

Find:

```jsx
                  {roundsStarted && !canAdvance && !canFinalize && (
                    <p className="text-muted text-sm text-center">
                      {t('gamedetails.register_round_results', { number: maxRound })}
                    </p>
                  )}
```

Replace with:

```jsx
                  {roundsStarted && !canAdvance && !canFinalize && (
                    <p className="text-muted text-sm text-center">
                      {isAmericano
                        ? t('gamedetails.register_americano_results')
                        : t('gamedetails.register_round_results', { number: maxRound })}
                    </p>
                  )}
```

- [ ] **Step 11: Verify the build**

Run: `npm run build`
Expected: builds successfully.

- [ ] **Step 12: Run the full test suite**

Run: `npx vitest run`
Expected: PASS (all existing tests plus Task 1/2's new ones — this task doesn't add new pure-function tests itself, it only wires existing ones into the UI).

- [ ] **Step 13: Manual verification**

Same caveat as Task 6 — requires Task 3's migration to have actually been run. If confirmed live: create an Americano mix with 8 players and 2 courts, start it, confirm every round's matches appear at once (not drawn one at a time), confirm the Duplas card and todos-contra-todos Classificação block are both absent, confirm the individual ranking table appears and updates as scores are entered, confirm "Terminar Mix" (`handleFinalize`) works without ever requiring a winning-dupla selection, and confirm `mix_player_stats`/`player_stats` end up populated per player after finalizing. If the migration hasn't been run in this environment, verify by reading the code instead — trace through Steps 1-10's changes against the actual current file to confirm each conditional correctly resolves to hide/show the right thing for `format === 'americano'`. State clearly in your report which you did.

- [ ] **Step 14: Commit**

```bash
git add src/pages/GameDetails.jsx
git commit -m "feat: Americano render + finalize wiring (Task 7)"
```
