# Post-close mix result correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a club admin correct one match's score inside an already-`finished` mix (Trello #257) and have every downstream table `finalize_mix` populated (`player_stats`, `mix_player_stats`, `xp_events`/`profiles.xp`, `profiles.rating` via Elo, `achievements`/`player_achievements`, `vouchers`) come back into a consistent state automatically, without needing hand-run SQL.

**Architecture:** One new `SECURITY DEFINER` Postgres RPC, `correct_finished_mix_match`, does all the server-side recomputation in a single transaction. The frontend extends the score-correction UI that already exists for `in_progress` mixes (`GameDetails.jsx`) to also work when `finished`, computing the corrected mix winner client-side by reusing a newly-extracted pure helper (`computeMixWinnerTeamId`, `src/lib/mixLogic.js`) — the same derivation `currentWinnerTeamId` already uses today — rather than duplicating standings math in SQL.

**Tech Stack:** Postgres/PL-pgSQL (Supabase, hand-run migrations), React + Vite (`src/pages/GameDetails.jsx`, `src/components/ScoreEntry.jsx`), Vitest for the one pure-JS unit under test.

**Spec:** `docs/superpowers/specs/2026-09-14-post-close-mix-correction-design.md`

## Global Constraints

- **Only club admins may call this** — the RPC independently verifies admin membership (`memberships.is_admin`), same pattern as `finalize_mix`; `isScorekeeper` never gates this (UI convenience role, not a security boundary).
- **Scope: `finalize_mix`'s own tables only.** `private_matches`, `group_matches`, and Americano mixes (`finalize_americano_mix`, no `winner_team_id` concept) are explicitly out of scope and must be rejected, not silently mishandled.
- **No un-award of achievements, no un-redemption of a used voucher, no correction-history/audit table.** These are deliberate non-goals, not omissions — do not add them.
- **The migration file is NOT LIVE until a human pastes it into Supabase → SQL Editor and runs it.** State this explicitly in the migration file's header comment, matching every other migration in this repo.
- **Elo revert+reapply is all-or-nothing across every player who appears in any match of the mix being corrected** (not just the corrected match's four players) — `apply_mix_elo`'s bonus redistribution touches the whole mix roster. Skip Elo entirely (leaving `profiles.rating` and `mix_player_stats.rating_delta` untouched) if any of those players has either (a) no tracked `rating_delta` for this mix (`untracked_participant` — covers guests, whose Elo isn't recorded in `mix_player_stats` at all), or (b) a later Elo-affecting event (`later_elo_event`) per the exact check in Task 2.
- **`mix_win` XP is insert/delete, never an in-place amount update** — `xp_events.amount` has `CHECK (amount > 0)`, and `finalize_mix` never writes a 0-amount row for a losing player, so there is no row to "flip" between 0 and 30.
- **Vouchers**: only touched when `games.has_voucher = true` AND the mix winner actually changes. An old winner's unredeemed (`'por_usar'`) voucher is deleted; an already-redeemed (`'usado'`) one is left untouched but flagged in the result. New winners get a fresh voucher, idempotently (`ON CONFLICT DO NOTHING`).
- **Destructive-adjacent frontend action → `confirm()` gate**, per this repo's standing rule (`CLAUDE.md`, "Things that have bitten people before") — this action touches rating/points/XP and is genuinely consequential.
- **This is a bilingual app** (`src/locales/pt.json` + `src/locales/en.json`, both required for every new i18n key — see the "English i18n merged" note this repo tracks).
- **Work happens on the current branch** (`feat/post-close-result-correction`), commit as you go, never push to `dev`/`main` as part of this plan — that stays a separate, explicit decision per `CLAUDE.md`.

---

## Task 1: Extract `computeMixWinnerTeamId` as a tested pure helper

**Files:**
- Modify: `src/lib/mixLogic.js` (add the new exported function)
- Modify: `src/lib/mixLogic.test.js` (add tests)
- Modify: `src/pages/GameDetails.jsx:1122-1136` (replace the inline IIFE with a call to the new helper)

**Interfaces:**
- Produces: `computeMixWinnerTeamId(game, teams, matches)` — pure function, `(game: {format}, teams: Array<{id}>, matches: Array<{winner_team_id, round_number, court_number, phase, team_a_id, team_b_id, score_a, score_b}>) => string | null`. Returns the mix's current/implied winning team id, or `null` if undecided or the format has no single winning team (Americano). Used both by `GameDetails.jsx`'s existing `currentWinnerTeamId` (Task 1) and by the new post-close correction handler (Task 3).
- Consumes: the existing `standings(teams, matches)` export from the same file (unchanged).

This is a pure refactor — `currentWinnerTeamId`'s value must not change for any existing mix. Do it test-first so the extraction is provably behavior-preserving, then reuse the same function in Task 3 instead of writing a second copy of this logic.

- [ ] **Step 1: Read the current inline derivation to confirm exact behavior before touching it**

Re-read `src/pages/GameDetails.jsx` lines 1120-1137 (the `currentWinnerTeamId` IIFE) right before starting — confirm it still matches this plan's understanding (nobody else may have touched it since this plan was written). It should read:

```js
  const currentWinnerTeamId = isAmericano ? null : (() => {
    if (!matches.some(m => m.winner_team_id)) return null
    if (isSobeDesce) {
      // most recent round with a completed court-1 match; falls back to the
      // overall leader if the current round is still only partly scored
      for (let r = maxRound; r >= 1; r--) {
        const m = matches.find(mm => mm.round_number === r && mm.court_number === 1 && mm.winner_team_id)
        if (m) return m.winner_team_id
      }
      return standings(teams, matches)[0]?.team?.id || null
    }
    const finalMatch = matches.find(m => m.phase === 'final' && m.winner_team_id)
    if (finalMatch) return finalMatch.winner_team_id
    return standings(teams, matches)[0]?.team?.id || null
  })()
```

where `isAmericano = game?.format === 'americano'`, `isSobeDesce = (game?.format || 'sobe_desce') === 'sobe_desce'`, and `maxRound = matches.length ? Math.max(...matches.map(m => m.round_number)) : 0`. If the actual code has diverged from this, stop and reconcile before proceeding — the tests in Step 2 encode this exact behavior.

- [ ] **Step 2: Write the failing tests**

Add to `src/lib/mixLogic.test.js` (it already imports `describe, it, expect` from `vitest` at the top — add `computeMixWinnerTeamId` to the existing import list from `./mixLogic`):

```js
describe('computeMixWinnerTeamId', () => {
  it('returns null for americano regardless of matches', () => {
    const game = { format: 'americano' }
    const teams = [{ id: 't1' }, { id: 't2' }]
    const matches = [{ winner_team_id: 't1', round_number: 1, court_number: 1, phase: 'group', team_a_id: 't1', team_b_id: 't2' }]
    expect(computeMixWinnerTeamId(game, teams, matches)).toBeNull()
  })

  it('returns null when no match has a winner yet', () => {
    const game = { format: 'sobe_desce' }
    const teams = [{ id: 't1' }, { id: 't2' }]
    const matches = [{ winner_team_id: null, round_number: 1, court_number: 1, phase: 'group', team_a_id: 't1', team_b_id: 't2' }]
    expect(computeMixWinnerTeamId(game, teams, matches)).toBeNull()
  })

  it('sobe_desce: returns the most recent round\'s completed court-1 winner', () => {
    const game = { format: 'sobe_desce' }
    const teams = [{ id: 't1' }, { id: 't2' }, { id: 't3' }, { id: 't4' }]
    const matches = [
      { winner_team_id: 't1', round_number: 1, court_number: 1, phase: 'group', team_a_id: 't1', team_b_id: 't2', score_a: 6, score_b: 2 },
      { winner_team_id: 't3', round_number: 2, court_number: 1, phase: 'group', team_a_id: 't3', team_b_id: 't1', score_a: 6, score_b: 3 },
    ]
    expect(computeMixWinnerTeamId(game, teams, matches)).toBe('t3')
  })

  it('sobe_desce: walks back to an earlier round when the latest round\'s court-1 match is not yet decided', () => {
    const game = { format: 'sobe_desce' }
    const teams = [{ id: 't1' }, { id: 't2' }, { id: 't3' }, { id: 't4' }]
    const matches = [
      { winner_team_id: 't1', round_number: 1, court_number: 1, phase: 'group', team_a_id: 't1', team_b_id: 't2', score_a: 6, score_b: 2 },
      { winner_team_id: null, round_number: 2, court_number: 1, phase: 'group', team_a_id: 't3', team_b_id: 't1', score_a: null, score_b: null },
      { winner_team_id: 't4', round_number: 2, court_number: 2, phase: 'group', team_a_id: 't4', team_b_id: 't2', score_a: 6, score_b: 1 },
    ]
    expect(computeMixWinnerTeamId(game, teams, matches)).toBe('t1')
  })

  it('non-sobe_desce: prefers a decided final-phase match over standings()', () => {
    const game = { format: 'todos_contra_todos' }
    const teams = [{ id: 't1' }, { id: 't2' }, { id: 't3' }, { id: 't4' }]
    const matches = [
      { winner_team_id: 't1', round_number: 1, court_number: 1, phase: 'group', team_a_id: 't1', team_b_id: 't2', score_a: 6, score_b: 2 },
      { winner_team_id: 't2', round_number: 2, court_number: 1, phase: 'final', team_a_id: 't1', team_b_id: 't2', score_a: 3, score_b: 6 },
    ]
    // standings() would put t1 first (1 win), but a decided final overrides it
    expect(computeMixWinnerTeamId(game, teams, matches)).toBe('t2')
  })

  it('non-sobe_desce: falls back to standings() when there is no final-phase match yet', () => {
    const game = { format: 'todos_contra_todos' }
    const teams = [{ id: 't1' }, { id: 't2' }, { id: 't3' }, { id: 't4' }]
    const matches = [
      { winner_team_id: 't1', round_number: 1, court_number: 1, phase: 'group', team_a_id: 't1', team_b_id: 't2', score_a: 6, score_b: 2 },
      { winner_team_id: 't3', round_number: 1, court_number: 2, phase: 'group', team_a_id: 't3', team_b_id: 't4', score_a: 6, score_b: 1 },
    ]
    // both t1 and t3 have 1 win; standings() tie-breaks on diff — t3's is bigger (+5 vs +4)
    expect(computeMixWinnerTeamId(game, teams, matches)).toBe('t3')
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- mixLogic`
Expected: FAIL — `computeMixWinnerTeamId is not a function` (or `is not exported`), for every new test.

- [ ] **Step 4: Implement the helper in `src/lib/mixLogic.js`**

Add this export near `standings()` (it depends on nothing else new):

```js
/** Derives the mix's current/implied winning team id from its matches —
    used both while a mix is still open (GameDetails.jsx's own
    `currentWinnerTeamId`, to preview who finalize_mix would crown) and
    by the post-close correction flow (Trello #257) to compute the new
    winner after a match's score is edited, before calling
    correct_finished_mix_match. Format-aware, NOT a bare call to
    standings(): sobe_desce walks rounds backwards for the most recent
    completed court-1 match before falling back to standings(); other
    formats prefer a decided `phase === 'final'` match before the same
    fallback. Americano has no single winning team (individual scoring
    across rotating partners) and always returns null. */
export function computeMixWinnerTeamId(game, teams, matches) {
  if (game?.format === 'americano') return null
  if (!matches.some(m => m.winner_team_id)) return null

  const isSobeDesce = (game?.format || 'sobe_desce') === 'sobe_desce'
  if (isSobeDesce) {
    const maxRound = matches.length ? Math.max(...matches.map(m => m.round_number)) : 0
    for (let r = maxRound; r >= 1; r--) {
      const m = matches.find(mm => mm.round_number === r && mm.court_number === 1 && mm.winner_team_id)
      if (m) return m.winner_team_id
    }
    return standings(teams, matches)[0]?.team?.id || null
  }

  const finalMatch = matches.find(m => m.phase === 'final' && m.winner_team_id)
  if (finalMatch) return finalMatch.winner_team_id
  return standings(teams, matches)[0]?.team?.id || null
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- mixLogic`
Expected: PASS for all `computeMixWinnerTeamId` tests, and every pre-existing `mixLogic.test.js` test still passes (nothing else in the file changed).

- [ ] **Step 6: Wire `GameDetails.jsx` to use the extracted helper**

Add `computeMixWinnerTeamId` to the existing `mixLogic` import at the top of `src/pages/GameDetails.jsx` (find the line importing `standings` from `../lib/mixLogic` and add it to that same import list).

Replace the IIFE at lines ~1122-1136:

```js
  const currentWinnerTeamId = isAmericano ? null : (() => {
    if (!matches.some(m => m.winner_team_id)) return null
    if (isSobeDesce) {
      // most recent round with a completed court-1 match; falls back to the
      // overall leader if the current round is still only partly scored
      for (let r = maxRound; r >= 1; r--) {
        const m = matches.find(mm => mm.round_number === r && mm.court_number === 1 && mm.winner_team_id)
        if (m) return m.winner_team_id
      }
      return standings(teams, matches)[0]?.team?.id || null
    }
    const finalMatch = matches.find(m => m.phase === 'final' && m.winner_team_id)
    if (finalMatch) return finalMatch.winner_team_id
    return standings(teams, matches)[0]?.team?.id || null
  })()
```

with:

```js
  // Format-aware winner derivation, shared with the post-close correction
  // flow (Trello #257) — see computeMixWinnerTeamId in mixLogic.js.
  const currentWinnerTeamId = computeMixWinnerTeamId(game, teams, matches)
```

`isAmericano`, `isSobeDesce`, and `maxRound` stay exactly where they are (declared just above this line, still used elsewhere in the file) — only this one derivation moves.

- [ ] **Step 7: Manually verify no behavior change**

Run: `npm run dev`, open any mix that's `in_progress` with at least one scored match (any format present in your local/seed data). Confirm the "Terminar Mix" flow still shows the same implied winner it did before this change (check by comparing what `finalize_mix` ends up recording, or by temporarily logging `currentWinnerTeamId` before/after — remove any temporary logging before committing). This is a refactor, not a behavior change — there should be nothing new to see.

- [ ] **Step 8: Run the full test suite**

Run: `npm test`
Expected: PASS — no other test file should be affected by this change.

- [ ] **Step 9: Commit**

```bash
git add src/lib/mixLogic.js src/lib/mixLogic.test.js src/pages/GameDetails.jsx
git commit -m "$(cat <<'EOF'
refactor: extract computeMixWinnerTeamId as a tested pure helper

Pulls GameDetails.jsx's inline currentWinnerTeamId derivation into
mixLogic.js so the post-close mix correction flow (Trello #257) can
reuse the exact same format-aware winner logic instead of duplicating
it or falling back to a bare standings() call that would mis-detect
the winner for sobe_desce and elimination-bracket mixes.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011x8RPEBrD2mrnXhyJytueW
EOF
)"
```

---

## Task 2: Migration — `correct_finished_mix_match` RPC

**Files:**
- Create: `supabase/migration_post_close_mix_correction.sql`

**Interfaces:**
- Produces: `correct_finished_mix_match(p_match_id UUID, p_new_score_a INTEGER, p_new_score_b INTEGER, p_new_winner_team_id UUID, p_sets JSONB DEFAULT NULL) RETURNS JSONB` — the RPC Task 3's frontend calls. Returns `{"new_winner_team_id": uuid, "winner_changed": bool, "elo_applied": bool, "elo_skip_reason": "later_elo_event" | "untracked_participant" | null, "voucher_not_reverted": bool}`.
- Produces (internal helper, not called from the frontend): `_has_later_elo_event(p_user_id UUID, p_after TIMESTAMPTZ, p_exclude_game_id UUID) RETURNS BOOLEAN`.
- Consumes: `apply_mix_elo(p_game_id UUID, p_winner_team_id UUID)` (existing, unchanged — current live body `supabase/migration_elo_partner_shield.sql`, re-verify via `git log` before writing this migration in case a newer one has landed since 2026-09-14) and `check_and_award_trophies(p_user_id UUID)` (existing, unchanged — compat wrapper around `check_and_award_achievements`, current live body `supabase/migration_achievements_rename.sql`).

There is no automated test runner for Postgres functions in this repo — migrations are hand-verified in the Supabase SQL Editor (see the "Manual verification" sections `migration_vouchers.sql` and `migration_group_matches.sql` both already include). This task follows that convention: write the whole function (it must be syntactically complete to run at all), then work through the verification scenarios below as the "test cycle" for this task.

- [ ] **Step 1: Re-verify the live source of everything this migration touches or reads**

Before writing a line of SQL, run (from the repo root):

```bash
git log -1 --format="%H %ad" --date=iso-strict -- supabase/migration_vouchers.sql
git log -1 --format="%H %ad" --date=iso-strict -- supabase/migration_elo_partner_shield.sql supabase/migration_private_match_elo.sql
git log -1 --format="%H %ad" --date=iso-strict -- supabase/migration_achievements_rename.sql supabase/migration_trophies.sql
```

Confirm `migration_vouchers.sql` is still the most recent file defining `finalize_mix` (so its shape of `player_stats`/`mix_player_stats`/`xp_events`/`vouchers` is still what's live), `migration_elo_partner_shield.sql` is still the most recent defining `apply_mix_elo`, and `migration_achievements_rename.sql` is still the most recent defining `check_and_award_trophies`/`check_and_award_achievements`. If any of these has been superseded since this plan was written (2026-09-14), stop and re-read the newer file before proceeding — the diff-based recompute in Step 3 below depends on `mix_player_stats`'s exact column set and `finalize_mix`'s exact points formula matching what's actually live.

- [ ] **Step 2: Write the migration file header and the `_has_later_elo_event` helper**

Create `supabase/migration_post_close_mix_correction.sql`:

```sql
-- ════════════════════════════════════════════════════════════════════════
-- Migration: post-close mix result correction (Trello #257). A club admin
-- can correct one matches row's score inside an already-finished mix
-- (games.status = 'finished') and every downstream table finalize_mix
-- populated comes back into a consistent state: player_stats,
-- mix_player_stats, xp_events/profiles.xp, profiles.rating (Elo, when
-- safe — see below), achievements (re-checked, never revoked), and
-- vouchers (award/cleanup, respecting an already-redeemed voucher).
--
-- Direct admin action, no propose/peer-accept workflow — unlike
-- group_matches' correction flow, only an admin could have produced the
-- original result here, so there's no non-admin submitter to protect
-- against. Scope: finalize_mix's own tables only. private_matches and
-- group_matches (already has its own correction) are out of scope.
-- Americano mixes are rejected outright — finalize_americano_mix has no
-- winner_team_id concept.
--
-- See docs/superpowers/specs/2026-09-14-post-close-mix-correction-design.md
-- for the full design and the reasoning behind every decision below,
-- especially the Elo revert/reapply guards (§5.3 of that doc).
--
-- NOT LIVE until run in Supabase → SQL Editor → New query → Run. A
-- migration file existing in this repo changes nothing on its own — the
-- GameDetails.jsx "Corrigir resultado" affordance for finished mixes
-- depends on this having actually been pasted in and executed there.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. _has_later_elo_event: has this player's rating moved for a
--       reason unrelated to the mix being corrected, since it happened? ──
-- Used to decide whether reverting-and-reapplying this mix's Elo effect
-- is still mathematically sound (every later event depends on
-- profiles.rating *at the time it ran*, not a historical snapshot).

CREATE OR REPLACE FUNCTION _has_later_elo_event(p_user_id UUID, p_after TIMESTAMPTZ, p_exclude_game_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM mix_player_stats mps
    JOIN games g ON g.id = mps.game_id
    WHERE mps.user_id = p_user_id
      AND mps.game_id <> p_exclude_game_id
      AND mps.rating_delta IS NOT NULL
      AND g.date > p_after
  )
  OR EXISTS (
    SELECT 1 FROM private_match_stats pms
    JOIN private_matches pm ON pm.id = pms.private_match_id
    WHERE pms.user_id = p_user_id
      AND pm.status = 'confirmed'
      AND pm.played_at > p_after
  );
$$;

REVOKE ALL ON FUNCTION _has_later_elo_event(UUID, TIMESTAMPTZ, UUID) FROM public, anon, authenticated;
```

- [ ] **Step 3: Append the main RPC**

Append to the same file:

```sql
-- ── 2. correct_finished_mix_match: the correction itself ────────────────

CREATE OR REPLACE FUNCTION correct_finished_mix_match(
  p_match_id UUID,
  p_new_score_a INTEGER,
  p_new_score_b INTEGER,
  p_new_winner_team_id UUID,
  p_sets JSONB DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match matches;
  v_game games;
  rules JSONB;
  v_old_winner_team_id UUID;
  v_winner_changed BOOLEAN;
  v_mix_players UUID[];
  v_elo_applied BOOLEAN := FALSE;
  v_elo_skip_reason TEXT := NULL;
  v_voucher_not_reverted BOOLEAN := FALSE;
  v_voucher_status TEXT;
  v_pid UUID;
BEGIN
  -- 1. Lock and validate
  SELECT * INTO v_match FROM matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jogo não encontrado';
  END IF;

  SELECT * INTO v_game FROM games WHERE id = v_match.game_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mix não encontrado';
  END IF;

  IF v_game.status <> 'finished' THEN
    RAISE EXCEPTION 'Este mix não está terminado — usa a correção normal de resultado';
  END IF;
  IF v_game.format = 'americano' THEN
    RAISE EXCEPTION 'A correção pós-fecho não está disponível para mixes Americano';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM memberships
    WHERE organization_id = v_game.organization_id AND user_id = auth.uid() AND is_admin
  ) THEN
    RAISE EXCEPTION 'Apenas admins podem corrigir um resultado depois do mix terminado';
  END IF;

  IF p_new_score_a IS NULL OR p_new_score_b IS NULL OR p_new_score_a = p_new_score_b
     OR p_new_score_a < 0 OR p_new_score_b < 0 THEN
    RAISE EXCEPTION 'Resultado inválido';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM teams WHERE id = p_new_winner_team_id AND game_id = v_game.id) THEN
    RAISE EXCEPTION 'Dupla vencedora inválida';
  END IF;

  v_old_winner_team_id := v_game.winner_team_id;

  -- 2. Apply the corrected match
  UPDATE matches
  SET score_a = p_new_score_a,
      score_b = p_new_score_b,
      winner_team_id = CASE WHEN p_new_score_a > p_new_score_b THEN v_match.team_a_id ELSE v_match.team_b_id END
  WHERE id = p_match_id;

  IF p_sets IS NOT NULL THEN
    DELETE FROM match_sets WHERE match_id = p_match_id;
    INSERT INTO match_sets (match_id, set_number, score_a, score_b, is_super_tiebreak)
    SELECT p_match_id, ROW_NUMBER() OVER (), (s->>'score_a')::int, (s->>'score_b')::int,
           COALESCE((s->>'is_super_tiebreak')::boolean, FALSE)
    FROM jsonb_array_elements(p_sets) AS s;
  END IF;

  v_winner_changed := (p_new_winner_team_id IS DISTINCT FROM v_old_winner_team_id);

  -- 3. Points + mix-participation totals — recompute the whole mix's
  --    pcalc (same shape finalize_mix uses) and diff against what's
  --    currently stored, rather than trying to isolate just the players
  --    the corrected match touches.
  SELECT points_rules INTO rules FROM organizations WHERE id = v_game.organization_id;
  IF rules IS NULL THEN
    rules := '{"point_per_match_played": 1, "point_per_match_win": 3, "point_per_mix_participation": 2, "point_per_mix_win": 10}'::jsonb;
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _mix_pcalc (
    pid UUID PRIMARY KEY, played INT, wins INT, losses INT, won_mix BOOLEAN, pts INT
  ) ON COMMIT DROP;
  TRUNCATE _mix_pcalc;

  INSERT INTO _mix_pcalc
  WITH mt AS (
    SELECT m.winner_team_id AS win_id, t.id AS team_id, t.player1_id, t.player2_id
    FROM matches m JOIN teams t ON t.id = m.team_a_id OR t.id = m.team_b_id
    WHERE m.game_id = v_game.id
  ),
  pp AS (SELECT unnest(ARRAY[player1_id, player2_id]) AS pid, (team_id = win_id) AS won FROM mt),
  agg AS (
    SELECT pid, COUNT(*) played, COUNT(*) FILTER (WHERE won) wins, COUNT(*) FILTER (WHERE NOT won) losses
    FROM pp WHERE pid IS NOT NULL GROUP BY pid
  ),
  scored AS (
    SELECT a.pid, a.played, a.wins, a.losses,
           (a.pid IN (SELECT unnest(ARRAY[player1_id, player2_id]) FROM teams WHERE id = p_new_winner_team_id)) AS won_mix
    FROM agg a JOIN memberships mb ON mb.user_id = a.pid AND mb.organization_id = v_game.organization_id AND NOT mb.is_guest
  )
  SELECT pid, played, wins, losses, won_mix,
         (played * COALESCE((rules->>'point_per_match_played')::int, 0)
          + wins * COALESCE((rules->>'point_per_match_win')::int, 0)
          + COALESCE((rules->>'point_per_mix_participation')::int, 0)
          + CASE WHEN won_mix THEN COALESCE((rules->>'point_per_mix_win')::int, 0) ELSE 0 END) AS pts
  FROM scored;

  UPDATE player_stats ps
  SET game_wins    = ps.game_wins    + (c.wins   - old.matches_won),
      game_losses  = ps.game_losses  + (c.losses - (old.matches_played - old.matches_won)),
      mix_wins     = ps.mix_wins     + (c.won_mix::int - old.mix_won::int),
      total_points = ps.total_points + (c.pts    - old.points_earned),
      updated_at   = NOW()
  FROM _mix_pcalc c JOIN mix_player_stats old ON old.game_id = v_game.id AND old.user_id = c.pid
  WHERE ps.user_id = c.pid AND ps.organization_id = v_game.organization_id;
  -- mixes_played never changes — the correction doesn't add or remove a
  -- match, only rescores one.

  UPDATE mix_player_stats mps
  SET matches_played = c.played,
      matches_won    = c.wins,
      points_earned  = c.pts,
      mix_won        = c.won_mix
  FROM _mix_pcalc c
  WHERE mps.game_id = v_game.id AND mps.user_id = c.pid;

  -- 4. mix_win XP — insert for new winners, delete for former winners
  --    (amount > 0 CHECK rules out an in-place 0<->30 update; losers
  --    never had a row to begin with — finalize_mix only ever inserts
  --    mix_win WHERE won_mix). mix_participation/mix_games untouched:
  --    nobody's played count changes from a same-match-count correction.
  WITH losers_of_flip AS (
    SELECT unnest(ARRAY[player1_id, player2_id]) AS pid
    FROM teams WHERE id = v_old_winner_team_id
    EXCEPT
    SELECT unnest(ARRAY[player1_id, player2_id]) FROM teams WHERE id = p_new_winner_team_id
  ),
  removed AS (
    DELETE FROM xp_events
    WHERE kind = 'mix_win' AND source_game_id = v_game.id
      AND user_id IN (SELECT pid FROM losers_of_flip WHERE pid IS NOT NULL)
    RETURNING user_id
  )
  UPDATE profiles p SET xp = p.xp - 30 FROM removed WHERE p.id = removed.user_id;

  WITH new_winners AS (
    SELECT unnest(ARRAY[player1_id, player2_id]) AS pid
    FROM teams WHERE id = p_new_winner_team_id
    EXCEPT
    SELECT unnest(ARRAY[player1_id, player2_id]) FROM teams WHERE id = v_old_winner_team_id
  ),
  inserted AS (
    INSERT INTO xp_events (user_id, organization_id, kind, source_game_id, amount, occurred_at)
    SELECT pid, v_game.organization_id, 'mix_win', v_game.id, 30, v_game.date
    FROM new_winners WHERE pid IS NOT NULL
    ON CONFLICT (user_id, kind, source_game_id) WHERE source_game_id IS NOT NULL DO NOTHING
    RETURNING user_id
  )
  UPDATE profiles p SET xp = p.xp + 30 FROM inserted WHERE p.id = inserted.user_id;

  -- 5. Elo — conditional revert + reapply, all-or-nothing across every
  --    player who appears in any match of this mix (apply_mix_elo's
  --    bonus redistribution touches the whole roster, not just the
  --    corrected match's four).
  v_mix_players := ARRAY(
    SELECT DISTINCT unnest(ARRAY[t.player1_id, t.player2_id])
    FROM matches m JOIN teams t ON t.id = m.team_a_id OR t.id = m.team_b_id
    WHERE m.game_id = v_game.id
  );

  -- Untracked-participant guard: a guest's Elo delta is applied to
  -- profiles.rating by apply_mix_elo but never recorded in
  -- mix_player_stats (its closing UPDATE only matches existing rows,
  -- and guests never get one — see the design doc). Reverting the
  -- trackable players and blindly re-running apply_mix_elo would
  -- double-apply an untracked guest's contribution.
  IF EXISTS (
    SELECT 1 FROM unnest(v_mix_players) pid
    WHERE NOT EXISTS (
      SELECT 1 FROM mix_player_stats mps
      WHERE mps.game_id = v_game.id AND mps.user_id = pid AND mps.rating_delta IS NOT NULL
    )
  ) THEN
    v_elo_skip_reason := 'untracked_participant';
  END IF;

  IF v_elo_skip_reason IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM unnest(v_mix_players) pid
      WHERE _has_later_elo_event(pid, v_game.date, v_game.id)
    ) THEN
      v_elo_skip_reason := 'later_elo_event';
    ELSE
      v_elo_applied := TRUE;
    END IF;
  END IF;

  IF v_elo_applied THEN
    UPDATE profiles pr
    SET rating = GREATEST(0, COALESCE(pr.rating, 900) - mps.rating_delta)
    FROM mix_player_stats mps
    WHERE mps.game_id = v_game.id AND mps.user_id = pr.id AND mps.rating_delta IS NOT NULL;

    PERFORM apply_mix_elo(v_game.id, p_new_winner_team_id);
  END IF;

  -- 6. games.winner_team_id
  UPDATE games SET winner_team_id = p_new_winner_team_id, updated_at = NOW() WHERE id = v_game.id;

  -- 7. Achievements — re-check, never revoke (award-only, ON CONFLICT DO
  --    NOTHING; multiple mixes can contribute to the same threshold, so
  --    there's no clean "this trophy came from this mix" to undo anyway).
  PERFORM check_and_award_trophies(mps.user_id) FROM mix_player_stats mps WHERE mps.game_id = v_game.id;

  -- 8. Vouchers — only if has_voucher and the winner actually changed.
  IF v_game.has_voucher AND v_winner_changed THEN
    FOR v_pid IN SELECT unnest(ARRAY[player1_id, player2_id]) FROM teams WHERE id = v_old_winner_team_id LOOP
      CONTINUE WHEN v_pid IS NULL;
      SELECT status INTO v_voucher_status FROM vouchers WHERE game_id = v_game.id AND user_id = v_pid;
      IF v_voucher_status = 'por_usar' THEN
        DELETE FROM vouchers WHERE game_id = v_game.id AND user_id = v_pid;
      ELSIF v_voucher_status = 'usado' THEN
        v_voucher_not_reverted := TRUE;
      END IF;
    END LOOP;

    INSERT INTO vouchers (game_id, user_id, organization_id)
    SELECT v_game.id, w.pid, v_game.organization_id
    FROM (
      SELECT player1_id AS pid FROM teams WHERE id = p_new_winner_team_id
      UNION ALL SELECT player2_id FROM teams WHERE id = p_new_winner_team_id
    ) w
    WHERE w.pid IS NOT NULL
    ON CONFLICT (game_id, user_id) DO NOTHING;
  END IF;

  -- 9. Result summary for the frontend
  RETURN jsonb_build_object(
    'new_winner_team_id', p_new_winner_team_id,
    'winner_changed', v_winner_changed,
    'elo_applied', v_elo_applied,
    'elo_skip_reason', v_elo_skip_reason,
    'voucher_not_reverted', v_voucher_not_reverted
  );
END;
$$;

REVOKE ALL ON FUNCTION correct_finished_mix_match(UUID, INTEGER, INTEGER, UUID, JSONB) FROM public, anon;
GRANT EXECUTE ON FUNCTION correct_finished_mix_match(UUID, INTEGER, INTEGER, UUID, JSONB) TO authenticated;
```

- [ ] **Step 4: Append the "Manual verification" section**

Append to the same file (this is the "test cycle" for this task — every scenario below must actually be run against a real Supabase project, local or staging, with real seed data, before this task is considered done):

```sql
-- ── 3. Manual verification (run once this migration is live) ────────────
-- Set up: a club with at least 5-6 players, a finished sobe_desce or
-- todos_contra_todos mix with 2+ matches and no other mixes/private
-- matches for its players since. Note the mix's game_id and the ids of
-- two matches in it before starting.
--
-- 1. Happy path, winner unchanged: correct a losing team's already-lost
--    match to a different (still-losing) score:
-- SELECT correct_finished_mix_match('<match id>', <new losing score_a>, <new losing score_b>, '<current games.winner_team_id>');
-- Expect: no error. Then:
-- SELECT winner_team_id FROM games WHERE id = '<game id>'; -- unchanged
-- SELECT matches_played, matches_won, points_earned, mix_won, rating_delta FROM mix_player_stats WHERE game_id = '<game id>';
--   -- only the two teams in the corrected match should show a
--   -- matches_won/points_earned change; mix_won unchanged for everyone.
-- SELECT * FROM xp_events WHERE source_game_id = '<game id>' AND kind = 'mix_win'; -- unchanged row set
--
-- 2. Winner flips: correct the deciding match so the mix winner changes:
-- SELECT correct_finished_mix_match('<deciding match id>', <new score_a>, <new score_b>, '<the OTHER team id>');
-- Expect response: {"winner_changed": true, ...}. Then:
-- SELECT winner_team_id FROM games WHERE id = '<game id>'; -- now the other team
-- SELECT user_id, mix_won, points_earned FROM mix_player_stats WHERE game_id = '<game id>'; -- flips for both teams' 4 players
-- SELECT user_id, amount FROM xp_events WHERE source_game_id = '<game id>' AND kind = 'mix_win'; -- now the NEW winners' 2 rows, old winners' rows gone
-- SELECT id, xp FROM profiles WHERE id IN (<old + new winners>); -- ±30 each
--
-- 3. Voucher already redeemed: repeat #2 on a has_voucher=true mix, but
--    first: UPDATE vouchers SET status = 'usado', used_at = NOW() WHERE game_id = '<game id>' AND user_id = '<one old winner>';
--    Expect response: {"voucher_not_reverted": true, ...}. Then:
-- SELECT status FROM vouchers WHERE game_id = '<game id>' AND user_id = '<that old winner>'; -- still 'usado', untouched
-- SELECT status FROM vouchers WHERE game_id = '<game id>' AND user_id = '<the OTHER old winner, still por_usar>'; -- row deleted (0 rows)
-- SELECT * FROM vouchers WHERE game_id = '<game id>' AND user_id IN (<new winners>); -- 2 new 'por_usar' rows
--
-- 4. Elo skipped — later event: correct a winner-flipping match, but
--    first finalize a LATER mix (later games.date) that one of this
--    mix's players also played in (or confirm a later ranked private
--    match for them). Then run the same correction as #2. Expect
--    response: {"elo_applied": false, "elo_skip_reason": "later_elo_event"}.
-- SELECT rating, rating_games FROM profiles WHERE id IN (<this mix's players>); -- unchanged by this call
-- SELECT rating_delta FROM mix_player_stats WHERE game_id = '<game id>'; -- unchanged (still the ORIGINAL values)
--   -- everything else (winner, points, xp, achievements, vouchers) should
--   -- still have updated per #1-3.
--
-- 5. Elo skipped — guest participant: same as #4, but instead of a later
--    event, make one of the mix's players a guest
--    (UPDATE memberships SET is_guest = true WHERE organization_id = '<org id>' AND user_id = '<a player>';)
--    before running the correction. Expect
--    {"elo_applied": false, "elo_skip_reason": "untracked_participant"}.
--
-- 6. Rejections:
-- SELECT correct_finished_mix_match('<match id in an in_progress mix>', 6, 2, '<team id>');
--   -- expect: 'Este mix não está terminado — usa a correção normal de resultado'
-- SELECT correct_finished_mix_match('<match id in a pending/open/closed mix>', 6, 2, '<team id>');
--   -- same rejection
-- SELECT correct_finished_mix_match('<match id in a finished americano mix>', 6, 2, '<team id>');
--   -- expect: 'A correção pós-fecho não está disponível para mixes Americano'
-- -- as a non-admin (a participant or a different org's admin) session:
-- SELECT correct_finished_mix_match('<any finished mix match id>', 6, 2, '<team id>');
--   -- expect: 'Apenas admins podem corrigir um resultado depois do mix terminado'
--
-- 7. Idempotent retry: run the EXACT same call from #2 a second time
--    immediately after. Expect every table checked in #2 to come back
--    with the SAME values as after the first call — no double-application
--    of points/XP/vouchers (winner_changed comes back false the second
--    time, since v_old_winner_team_id is now what the first call set).
```

- [ ] **Step 5: Run every scenario in Step 4 against a real Supabase project (local or staging)**

Paste the whole file into Supabase → SQL Editor → New query → Run, then work through scenarios 1-7 one at a time, checking each expected result. Fix anything that doesn't match before moving on — this is the actual test cycle for this task, there is no automated substitute.

- [ ] **Step 6: Commit**

```bash
git add supabase/migration_post_close_mix_correction.sql
git commit -m "$(cat <<'EOF'
feat: post-close mix result correction RPC (#257)

New correct_finished_mix_match(), callable only by a club admin, for
fixing a matches score after finalize_mix has already run. Recomputes
and diffs player_stats/mix_player_stats, insert/deletes the mix_win
xp_events row (amount > 0 CHECK rules out an in-place update),
conditionally reverts+reapplies Elo (all-or-nothing across the whole
mix roster, skipped when any player has a later Elo event or an
untracked guest Elo delta), re-checks achievements without revoking
any, and awards/cleans up vouchers respecting an already-redeemed one.

NOT LIVE until run in Supabase SQL Editor — see migration file header.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011x8RPEBrD2mrnXhyJytueW
EOF
)"
```

---

## Task 3: Frontend — "Corrigir resultado" on a finished mix

**Files:**
- Modify: `src/pages/GameDetails.jsx` (canEditScores gating, finished-mix score UI, new handler)
- Modify: `src/locales/pt.json`, `src/locales/en.json` (new i18n keys)

**Interfaces:**
- Consumes: `computeMixWinnerTeamId(game, teams, matches)` from Task 1; `correct_finished_mix_match` RPC from Task 2 (must be live in the Supabase project you're testing against — re-run Task 2's migration there first if it isn't).
- Produces: nothing new for other tasks to consume — this is the leaf of the plan.

- [ ] **Step 1: Confirm the two "rondas" blocks are truly separate before touching either**

`GameDetails.jsx` renders rounds in two mutually-exclusive places: an
`in_progress`-only block (`{game.status === 'in_progress' && (<>...`,
opened around line 1878, comment: "In-progress mix: duplas-per-court,
classificação, rounds — all stacked as before. Untouched by the
finished-mix tabs below.") that closes around line 2201 and contains
the `ms.map` with `canEditScores` at line ~2155 — and a
`finishedTab === 'rondas'`-only block (inside `{game.status ===
'finished' && (<>...`, around line 2297-2320) with its own separate
`ms.map`. Because the `in_progress` block never renders once the mix
is `finished`, its `canEditScores`/`editable` (line ~2155-2156) need
**no change at all** — leave them exactly as they are. Only the
`finished`-tab block (Step 2 below) needs the new admin-when-finished
gating. Re-read both blocks in the current file before editing, in
case either has moved since this plan was written — the line numbers
above are from the read that produced this plan, not a guarantee.

- [ ] **Step 2: Give the finished-mix "rondas" block the correction UI the in_progress block already has**

Find the finished-mix rounds rendering (around line 2297-2320):

```js
                          {ms.map(m => {
                            const done = !!m.winner_team_id
                            const editable = !done && (isAdmin || isScorekeeper) && game.status === 'in_progress'
                            return (
                              <div key={m.id} className="rounded-ctrl bg-canvas p-2.5">
                                <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted mb-2 px-1">
                                  {t('gamedetails.court_number', { number: m.court_number })}
                                </p>
                                <ScoreEntry
                                  match={m}
                                  scoringFormat={game.scoring_format || 'pontos_simples'}
                                  editable={editable}
                                  teamAName={teamName(m.team_a_id)}
                                  teamBName={teamName(m.team_b_id)}
                                  initialScores={scores[m.id] || { a: '', b: '' }}
                                  onScoreChange={(matchId, next) => setScores(prev => ({ ...prev, [matchId]: next }))}
                                  onSave={(finalScore) => handleSaveScore(m, finalScore)}
                                  saving={savingMatchId === m.id}
                                />
                              </div>
                            )
                          })}
```

Replace with the same `editingMatchId`/pencil-icon pattern the `in_progress` block (lines ~2151-2196) already uses, but with its own `canEditScores` (admin-only, no scorekeeper — see the rationale in Step 1) and routed to a new handler:

```js
                          {ms.map(m => {
                            const done = !!m.winner_team_id
                            const isCorrecting = editingMatchId === m.id
                            const canEditScores = isAdmin && game.status === 'finished'
                            const editable = canEditScores && (!done || isCorrecting)
                            return (
                              <div key={m.id} className="rounded-ctrl bg-canvas p-2.5">
                                <div className="flex items-center justify-between mb-2 px-1">
                                  <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted">
                                    {t('gamedetails.court_number', { number: m.court_number })}
                                  </p>
                                  {canEditScores && done && !isCorrecting && (
                                    <button
                                      onClick={() => startEditingScore(m)}
                                      className="inline-flex items-center gap-1 text-[11px] font-extrabold text-muted hover:text-ink-900 min-h-[28px] px-1"
                                    >
                                      <Pencil size={12} />
                                      {t('gamedetails.correct_finished_score')}
                                    </button>
                                  )}
                                </div>
                                <ScoreEntry
                                  key={`${m.id}-${isCorrecting}`}
                                  match={m}
                                  scoringFormat={game.scoring_format || 'pontos_simples'}
                                  editable={editable}
                                  teamAName={teamName(m.team_a_id)}
                                  teamBName={teamName(m.team_b_id)}
                                  initialScores={scores[m.id] || { a: '', b: '' }}
                                  onScoreChange={(matchId, next) => setScores(prev => ({ ...prev, [matchId]: next }))}
                                  onSave={(finalScore) => handleCorrectFinishedScore(m, finalScore)}
                                  saving={savingMatchId === m.id}
                                />
                                {isCorrecting && (
                                  <button
                                    onClick={() => cancelEditingScore(m.id)}
                                    className="w-full mt-2 py-2.5 rounded-ctrl bg-ink-50 text-ink-700 text-sm font-extrabold transition-all duration-fast active:scale-[0.98]"
                                  >
                                    {t('gamedetails.cancel')}
                                  </button>
                                )}
                              </div>
                            )
                          })}
```

This block's `canEditScores`/`editable` only need to check `isAdmin` — the surrounding `{game.status === 'finished' && (...)}` (confirmed in Step 1) already guarantees `game.status === 'finished'` here, so the explicit re-check in the code above is redundant-but-harmless documentation of intent, matching how the `in_progress` block's own `canEditScores` also re-states a status check it's already nested inside.

- [ ] **Step 3: Add the `handleCorrectFinishedScore` handler**

Add near `handleSaveScore` (after it, around line 1033):

```js
  // Post-close mix correction (Trello #257): same shape as
  // handleSaveScore, but calls correct_finished_mix_match instead of a
  // plain `matches` update, gated by confirm() since this recomputes
  // points/XP/Elo/vouchers — genuinely consequential, not just a display
  // change. finalScore.sets is forwarded to p_sets exactly like
  // handleSaveScore already forwards it to the match_sets delete/insert.
  const handleCorrectFinishedScore = async (match, finalScore) => {
    const { score_a: a, score_b: b, sets } = finalScore
    const patchedMatches = matches.map(m => (
      m.id === match.id
        ? { ...m, score_a: a, score_b: b, winner_team_id: a > b ? match.team_a_id : match.team_b_id }
        : m
    ))
    const newWinnerTeamId = computeMixWinnerTeamId(game, teams, patchedMatches)
    if (!newWinnerTeamId) return

    if (!confirm(t('gamedetails.confirm_correct_finished_score', {
      team: teamName(match.team_a_id), a, other: teamName(match.team_b_id), b,
    }))) return

    setMixError('')
    setSavingMatchId(match.id)
    try {
      const { data, error } = await supabase.rpc('correct_finished_mix_match', {
        p_match_id: match.id,
        p_new_score_a: a,
        p_new_score_b: b,
        p_new_winner_team_id: newWinnerTeamId,
        p_sets: sets || null,
      })
      if (error) throw error

      setScores(prev => ({ ...prev, [match.id]: undefined }))
      setEditingMatchId(current => (current === match.id ? null : current))
      await loadGameDetails()

      const parts = [
        data.winner_changed
          ? t('gamedetails.correction_result_winner_changed', { team: teamName(data.new_winner_team_id) })
          : t('gamedetails.correction_result_winner_unchanged'),
      ]
      if (!data.elo_applied) {
        parts.push(data.elo_skip_reason === 'untracked_participant'
          ? t('gamedetails.correction_elo_skipped_untracked')
          : t('gamedetails.correction_elo_skipped_later_event'))
      }
      if (data.voucher_not_reverted) {
        parts.push(t('gamedetails.correction_voucher_not_reverted'))
      }
      alert(parts.join(' '))
    } catch (error) {
      console.error('Error correcting finished mix score:', error)
      setMixError(error.message || t('gamedetails.error_correct_finished_score'))
    } finally {
      setSavingMatchId(current => (current === match.id ? null : current))
    }
  }
```

Add `computeMixWinnerTeamId` to the existing `mixLogic` import (already added in Task 1, Step 6 — confirm it's there, don't duplicate the import line).

- [ ] **Step 4: Add the new i18n keys**

Add to `src/locales/pt.json` (append near the other `gamedetails.*` keys — this file isn't alphabetically sorted, so appending near related keys like `gamedetails.edit_score`/`gamedetails.cancel` is fine, not required):

```json
  "gamedetails.correct_finished_score": "Corrigir resultado",
  "gamedetails.confirm_correct_finished_score": "Corrigir {{team}} {{a}} - {{b}} {{other}}? Isto recalcula pontos, XP, rating e — se aplicável — o vencedor do mix.",
  "gamedetails.error_correct_finished_score": "Erro ao corrigir o resultado",
  "gamedetails.correction_result_winner_unchanged": "Resultado corrigido.",
  "gamedetails.correction_result_winner_changed": "Resultado corrigido — o vencedor do mix passa a ser {{team}}.",
  "gamedetails.correction_elo_skipped_later_event": "O rating (Elo) não foi ajustado, porque já há jogos mais recentes de pelo menos um dos jogadores — pede ao Renato para tratar à mão, se for preciso.",
  "gamedetails.correction_elo_skipped_untracked": "O rating (Elo) não foi ajustado, porque um dos jogadores desta noite não tem histórico de Elo guardado para este mix — pede ao Renato para tratar à mão, se for preciso.",
  "gamedetails.correction_voucher_not_reverted": "O vencedor anterior já usou o voucher deste mix — não foi revertido.",
```

Add the matching English keys to `src/locales/en.json`:

```json
  "gamedetails.correct_finished_score": "Correct result",
  "gamedetails.confirm_correct_finished_score": "Correct {{team}} {{a}} - {{b}} {{other}}? This recalculates points, XP, rating and — if applicable — the mix winner.",
  "gamedetails.error_correct_finished_score": "Error correcting the result",
  "gamedetails.correction_result_winner_unchanged": "Result corrected.",
  "gamedetails.correction_result_winner_changed": "Result corrected — the mix winner is now {{team}}.",
  "gamedetails.correction_elo_skipped_later_event": "Rating (Elo) was not adjusted, because at least one player already has more recent games — ask Renato to handle it manually if needed.",
  "gamedetails.correction_elo_skipped_untracked": "Rating (Elo) was not adjusted, because one of that night's players has no saved Elo history for this mix — ask Renato to handle it manually if needed.",
  "gamedetails.correction_voucher_not_reverted": "The previous winner already used this mix's voucher — it was not reverted.",
```

Both sets of copy are a concrete draft, not a placeholder — but flagged in the spec (§8) as worth a tone/wording review with Renato before this ships, same as any other player/admin-facing string in this repo.

- [ ] **Step 5: Manual click-through verification**

Requires Task 2's migration to actually be live in whatever Supabase project you're pointed at (local or staging — re-run the migration there if you haven't already).

Run: `npm run dev`. As an admin (or using the dev-only "Entrar como Admin" shortcut, `import.meta.env.DEV`-gated on the Login page), open a finished mix:

1. Confirm the pencil-icon "Corrigir resultado" affordance appears next to a scored match, and does **not** appear when logged in as a scorekeeper-only user or a non-admin participant.
2. Click it, change a score, save. Confirm the `confirm()` dialog appears with the right team names/scores, and cancelling it leaves everything unchanged.
3. Confirm it. Confirm the page reloads with the new score shown, and the `alert()` result summary matches what actually happened (winner changed/unchanged, Elo skipped or not, voucher note or not) — cross-check against the mix's data the way Task 2's manual verification did.
4. Repeat once on a `melhor_2_sets` or `melhor_3_sets` finished mix — confirm the set-by-set inputs appear (not the single score pair) and the correction saves correctly, replacing the old `match_sets` rows.
5. Confirm a scorekeeper who is not also an admin still cannot see or use this affordance (their access should look identical to before this change — this repo's "security is RLS, not the UI" principle is doubly enforced here since the RPC itself re-checks admin status regardless of what the UI shows).

- [ ] **Step 6: Run the full test suite one more time**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/pages/GameDetails.jsx src/locales/pt.json src/locales/en.json
git commit -m "$(cat <<'EOF'
feat: admin can correct a finished mix's match score (#257)

Extends the existing score-correction UI (editingMatchId, the pencil
icon) to also work once a mix is finished, admin-only — scorekeeper
stays in_progress-only, since that role is a UI convenience, not a
security boundary. Calls the new correct_finished_mix_match RPC,
computing the corrected mix winner client-side via
computeMixWinnerTeamId (same derivation finalize_mix's own caller
already uses) rather than duplicating standings math server-side.
confirm()-gated per this repo's rule for consequential actions; the
result — new winner if changed, whether Elo was skipped and why,
whether a voucher was left un-reversed — is surfaced via alert(),
matching how this codebase already reports other RPC outcomes.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011x8RPEBrD2mrnXhyJytueW
EOF
)"
```

---

## Task 4: Trello + Slack (per this repo's standing workflow rule)

**Files:** none — process only.

This repo's `CLAUDE.md` has a standing rule: when finishing a task that came from a Trello card, update the card and post to Slack `#dev-updates`. **Skip this task entirely if, at execution time, the user has said they're low on tokens** — that's an explicit carve-out in the same rule.

- [ ] **Step 1: Update the Trello card**

Card: Trello #257, "Corrigir resultado depois do jogo/mix já ter terminado" (find it on the **Alinho** board, or create it if it somehow doesn't exist yet).

- If this plan's work is done but not yet pushed to `main`: move the card to **Dev Done**. (This is the expected state after this plan — pushing to `main` is Renato's call per `CLAUDE.md`, not something this plan does.)
- Only move it to **Testing - QA** if the change is actually already on `main` by the time this step runs (unlikely for a normal run of this plan) — don't move it there on the strength of a `dev` push or a local/uncommitted change.

- [ ] **Step 2: Post to Slack `#dev-updates`**

Include: the card number (#257), the card link, and a summary of what was done in development terms — e.g. "New `correct_finished_mix_match` RPC lets a club admin fix a match score after a mix has finished, with points/XP/Elo/achievements/vouchers all recomputed automatically (Elo is skipped with a clear reason when it's not safe to redo — a later game already used the current rating, or an untracked guest played). Migration `supabase/migration_post_close_mix_correction.sql` is written but **not yet run** in Supabase — needs that before the frontend affordance does anything." Adjust the wording once the actual state (migration run or not, pushed or not) is known at execution time.
