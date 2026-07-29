# Private Matches & Global Ranking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any user record a private 2v2 match against 3 other app users (independent of club/organization), with fixed points that never touch any club's ranking, plus a public global ranking that sums a player's club points (every organization) and private-match points into one number.

**Architecture:** Two new tables (`private_matches`, `private_match_stats`) hold ad-hoc 2v2 results, completely separate from `games`/`teams`/`matches`/`player_stats`/`finalize_mix` — none of those existing structures are touched. All writes go through `SECURITY DEFINER` RPCs (mirroring the existing `finalize_mix()` pattern) rather than raw table grants, because the validation rules ("only the creator confirms," "score can't be edited after confirm," "each player occupies exactly one slot") are much easier to express as explicit checks in a function body than as row-level-security policies. Reads for search and the global leaderboard also go through `SECURITY DEFINER` RPCs, because the existing `profiles` RLS policy (`See own profile or profiles of org-mates`) would otherwise block seeing anyone outside your own club — this plan does not touch that policy, it adds narrow, whitelisted-column RPCs that intentionally bypass it for exactly this feature.

**Tech Stack:** React 18 (Vite) + Supabase (Postgres/RLS) — same stack as the rest of the app. No new dependencies.

**Design doc:** `docs/superpowers/specs/2026-07-29-private-matches-global-ranking-design.md`

## Global Constraints

- No JS test framework exists in this repo (`package.json` has no test script and no test files anywhere under `src/`). Do not introduce one as part of this plan. Frontend task verification is `npx vite build` (compile-time correctness) plus a manual click-through checklist using `npm run dev`.
- SQL migrations in this repo are plain `.sql` files applied by hand in the Supabase SQL Editor (see the many `supabase/migration_*.sql` files) — writing the file is the deliverable; running it against the actual database and confirming with the verification query in each task is a manual step you do after writing it, not something achievable by any other tool here.
- Fixed points for private matches (no per-org configurability, there is no organization involved): 1 point for playing, +3 for winning — copied from the existing default `points_rules` (`point_per_match_played: 1, point_per_match_win: 3`) so the scale matches club points.
- No push notifications and no result-dispute/reject flow — explicitly out of scope per the design doc. "Notify" a player means the pending match shows up next time they open `/jogos-privados`, nothing more.
- Portuguese user-facing copy throughout, matching the rest of the app's tone (see any existing page for examples of the voice).
- Follow existing conventions exactly: Tailwind utility classes and the `card` / `press` / `input-field` helper classes already used everywhere, `lucide-react` icons, the shared components in `src/components/ui.jsx` (`PrimaryButton`, `Avatar`, `EmptyState`, `LevelBadge`), and the `SECURITY DEFINER SET search_path = public` + `RAISE EXCEPTION '<mensagem em português>'` style used by every existing RPC in `supabase/schema.sql`.
- Branch: create `feature/private-matches-global-ranking` off `dev` (not `main`) before starting Task 1, per this repo's workflow — the app is live with real users, `dev` is where new feature branches originate. Do not merge to `dev` or `main` as part of this plan.

---

## Task 1: Branch + database schema — `private_matches` & `private_match_stats`

**Files:**
- Create: `supabase/migration_private_matches.sql`

**Interfaces:**
- Produces: tables `private_matches (id, creator_id, team_a_player1_id, team_a_player2_id, team_b_player1_id, team_b_player2_id, score_a, score_b, winner_team, status, played_at, confirmed_at, created_at)` and `private_match_stats (id, private_match_id, user_id, points_earned, won, created_at)`. Every later task's RPCs read/write these exact columns.

- [ ] **Step 1: Create the feature branch**

```bash
git checkout dev
git pull
git checkout -b feature/private-matches-global-ranking
```

- [ ] **Step 2: Write the migration file**

Create `supabase/migration_private_matches.sql`:

```sql
-- ════════════════════════════════════════════════════════════════════════
-- Migration: Private matches (2v2 friendly games) & cross-org global ranking
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. private_matches: one ad-hoc 2v2 result, independent of organizations ─
-- Not modeled as a `games` row: games carries mix-only fields (num_courts,
-- format, short_code, brackets) that don't fit a single friendly result.
CREATE TABLE private_matches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id UUID NOT NULL REFERENCES profiles(id),
  team_a_player1_id UUID NOT NULL REFERENCES profiles(id),
  team_a_player2_id UUID REFERENCES profiles(id),
  team_b_player1_id UUID REFERENCES profiles(id),
  team_b_player2_id UUID REFERENCES profiles(id),
  score_a INTEGER,
  score_b INTEGER,
  winner_team TEXT CHECK (winner_team IN ('a', 'b')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed')),
  played_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

ALTER TABLE private_matches ENABLE ROW LEVEL SECURITY;

-- Only the 4 players (whichever slots are filled) can see a match. All
-- writes happen through SECURITY DEFINER RPCs (Tasks 2-3 below) — there is
-- deliberately no INSERT/UPDATE policy, so a raw client-side
-- `supabase.from('private_matches').insert(...)` is rejected by RLS.
CREATE POLICY "Players can view their private matches"
  ON private_matches FOR SELECT
  USING (
    auth.uid() = team_a_player1_id
    OR auth.uid() = team_a_player2_id
    OR auth.uid() = team_b_player1_id
    OR auth.uid() = team_b_player2_id
  );

-- ── 2. private_match_stats: immutable per-player snapshot, written once ───
-- by confirm_private_match() (Task 3). Mirrors mix_player_stats' role.
CREATE TABLE private_match_stats (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  private_match_id UUID NOT NULL REFERENCES private_matches(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id),
  points_earned INTEGER NOT NULL,
  won BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
  UNIQUE (private_match_id, user_id)
);

ALTER TABLE private_match_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own private match stats"
  ON private_match_stats FOR SELECT
  USING (auth.uid() = user_id);
```

- [ ] **Step 3: Run it and verify**

Run the whole file in Supabase → SQL Editor. Then run:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_name IN ('private_matches', 'private_match_stats');
```

Expected: 2 rows returned.

Then, still in the SQL Editor (running as your own logged-in role, not the `postgres` superuser — use "Run as authenticated user" if the editor offers it, otherwise trust the policy definition since it mirrors existing tested policies), confirm direct writes are blocked:

```sql
INSERT INTO private_matches (creator_id, team_a_player1_id) VALUES (auth.uid(), auth.uid());
```

Expected: fails with a row-level security policy violation (no INSERT policy exists yet).

- [ ] **Step 4: Commit**

```bash
git add supabase/migration_private_matches.sql
git commit -m "feat: add private_matches and private_match_stats tables"
```

---

## Task 2: RPCs — create a private match, invite by search or link

**Files:**
- Create: `supabase/migration_private_matches_create_rpcs.sql`

**Interfaces:**
- Consumes: `private_matches` table from Task 1.
- Produces: `create_private_match(p_team_a_player2_id UUID, p_team_b_player1_id UUID, p_team_b_player2_id UUID) RETURNS UUID`, `claim_private_match_slot(p_match_id UUID, p_slot TEXT) RETURNS VOID` (`p_slot` one of `'team_a_player2'`, `'team_b_player1'`, `'team_b_player2'`), `search_players(p_query TEXT) RETURNS TABLE(id UUID, name TEXT, avatar_url TEXT)`. Later frontend tasks call these three by name.

- [ ] **Step 1: Write the migration file**

Create `supabase/migration_private_matches_create_rpcs.sql`:

```sql
-- ════════════════════════════════════════════════════════════════════════
-- Migration: create/join RPCs for private matches
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

-- Creates a pending private match. The caller is always team_a_player1
-- (their own slot). The other 3 slots may be passed as NULL and filled
-- later via claim_private_match_slot (join-by-link).
CREATE OR REPLACE FUNCTION create_private_match(
  p_team_a_player2_id UUID DEFAULT NULL,
  p_team_b_player1_id UUID DEFAULT NULL,
  p_team_b_player2_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_filled UUID[];
BEGIN
  v_filled := ARRAY_REMOVE(ARRAY[auth.uid(), p_team_a_player2_id, p_team_b_player1_id, p_team_b_player2_id], NULL);

  IF (SELECT COUNT(*) FROM unnest(v_filled)) <> (SELECT COUNT(DISTINCT x) FROM unnest(v_filled) AS x) THEN
    RAISE EXCEPTION 'Cada jogador só pode ocupar uma posição no jogo';
  END IF;

  INSERT INTO private_matches (creator_id, team_a_player1_id, team_a_player2_id, team_b_player1_id, team_b_player2_id)
  VALUES (auth.uid(), auth.uid(), p_team_a_player2_id, p_team_b_player1_id, p_team_b_player2_id)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION create_private_match(UUID, UUID, UUID) FROM public;
GRANT EXECUTE ON FUNCTION create_private_match(UUID, UUID, UUID) TO authenticated;

-- Claims an open slot in a pending match, for the "join by link" flow.
-- Uses ARRAY_REMOVE before the membership check because IN/= ANY over an
-- array containing NULL (an unfilled slot) silently returns NULL instead
-- of FALSE for a non-match, which would skip the "already in this game"
-- guard below rather than correctly allowing the claim.
CREATE OR REPLACE FUNCTION claim_private_match_slot(p_match_id UUID, p_slot TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match private_matches;
BEGIN
  IF p_slot NOT IN ('team_a_player2', 'team_b_player1', 'team_b_player2') THEN
    RAISE EXCEPTION 'Posição inválida';
  END IF;

  SELECT * INTO v_match FROM private_matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jogo não encontrado';
  END IF;
  IF v_match.status <> 'pending' THEN
    RAISE EXCEPTION 'Este jogo já não aceita novos jogadores';
  END IF;

  IF auth.uid() = ANY (ARRAY_REMOVE(ARRAY[
    v_match.team_a_player1_id, v_match.team_a_player2_id,
    v_match.team_b_player1_id, v_match.team_b_player2_id
  ], NULL)) THEN
    RAISE EXCEPTION 'Já estás neste jogo';
  END IF;

  IF p_slot = 'team_a_player2' THEN
    IF v_match.team_a_player2_id IS NOT NULL THEN
      RAISE EXCEPTION 'Esta posição já foi ocupada';
    END IF;
    UPDATE private_matches SET team_a_player2_id = auth.uid() WHERE id = p_match_id;
  ELSIF p_slot = 'team_b_player1' THEN
    IF v_match.team_b_player1_id IS NOT NULL THEN
      RAISE EXCEPTION 'Esta posição já foi ocupada';
    END IF;
    UPDATE private_matches SET team_b_player1_id = auth.uid() WHERE id = p_match_id;
  ELSE
    IF v_match.team_b_player2_id IS NOT NULL THEN
      RAISE EXCEPTION 'Esta posição já foi ocupada';
    END IF;
    UPDATE private_matches SET team_b_player2_id = auth.uid() WHERE id = p_match_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION claim_private_match_slot(UUID, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION claim_private_match_slot(UUID, TEXT) TO authenticated;

-- Cross-org player search for the "invite by search" flow. Bypasses the
-- org-restricted `profiles` RLS policy on purpose (SECURITY DEFINER) —
-- only whitelisted, already-non-sensitive columns are returned.
CREATE OR REPLACE FUNCTION search_players(p_query TEXT)
RETURNS TABLE (id UUID, name TEXT, avatar_url TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.name, p.avatar_url
  FROM profiles p
  WHERE length(trim(p_query)) >= 2
    AND p.id <> auth.uid()
    AND p.name ILIKE '%' || trim(p_query) || '%'
  ORDER BY p.name
  LIMIT 10;
$$;

REVOKE ALL ON FUNCTION search_players(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION search_players(TEXT) TO authenticated;
```

- [ ] **Step 2: Run it and verify**

Run the file in Supabase → SQL Editor. Then, in a new query tab, run as your own authenticated session:

```sql
SELECT create_private_match(); -- your own match, all 3 other slots open
SELECT * FROM private_matches ORDER BY created_at DESC LIMIT 1;
```

Expected: one row where `team_a_player1_id` = your user id, the other 3 slots NULL, `status = 'pending'`.

```sql
SELECT * FROM search_players('a');
```

Expected: rows with `id, name, avatar_url` for profiles whose name contains "a" (case-insensitive), excluding yourself, capped at 10 — including profiles outside your own organization if any exist.

- [ ] **Step 3: Commit**

```bash
git add supabase/migration_private_matches_create_rpcs.sql
git commit -m "feat: add create/join/search RPCs for private matches"
```

---

## Task 3: RPCs — submit score & confirm (the points-awarding logic)

**Files:**
- Create: `supabase/migration_private_matches_score_rpcs.sql`

**Interfaces:**
- Consumes: tables from Task 1.
- Produces: `submit_private_match_score(p_match_id UUID, p_score_a INTEGER, p_score_b INTEGER) RETURNS VOID`, `confirm_private_match(p_match_id UUID) RETURNS VOID`.

- [ ] **Step 1: Write the migration file**

Create `supabase/migration_private_matches_score_rpcs.sql`:

```sql
-- ════════════════════════════════════════════════════════════════════════
-- Migration: score submission & confirmation RPCs for private matches
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

-- Any of the 4 filled-in players can set/overwrite the score while pending.
CREATE OR REPLACE FUNCTION submit_private_match_score(p_match_id UUID, p_score_a INTEGER, p_score_b INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match private_matches;
BEGIN
  SELECT * INTO v_match FROM private_matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jogo não encontrado';
  END IF;
  IF v_match.status <> 'pending' THEN
    RAISE EXCEPTION 'Este jogo já foi confirmado, o resultado não pode ser alterado';
  END IF;
  IF NOT (auth.uid() = ANY (ARRAY_REMOVE(ARRAY[
    v_match.team_a_player1_id, v_match.team_a_player2_id,
    v_match.team_b_player1_id, v_match.team_b_player2_id
  ], NULL))) THEN
    RAISE EXCEPTION 'Só os jogadores do jogo podem inserir o resultado';
  END IF;
  IF p_score_a IS NULL OR p_score_b IS NULL OR p_score_a = p_score_b THEN
    RAISE EXCEPTION 'Resultado inválido';
  END IF;

  UPDATE private_matches
  SET score_a = p_score_a,
      score_b = p_score_b,
      winner_team = CASE WHEN p_score_a > p_score_b THEN 'a' ELSE 'b' END
  WHERE id = p_match_id;
END;
$$;

REVOKE ALL ON FUNCTION submit_private_match_score(UUID, INTEGER, INTEGER) FROM public;
GRANT EXECUTE ON FUNCTION submit_private_match_score(UUID, INTEGER, INTEGER) TO authenticated;

-- Only the creator can confirm, only once all 4 slots are filled and a
-- score is set. This is the only place points are ever written — fixed
-- values matching the app's existing default points_rules (1 played, +3
-- win), since there's no organization here to hold a configurable rule.
CREATE OR REPLACE FUNCTION confirm_private_match(p_match_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match private_matches;
  v_point_per_match_played CONSTANT INTEGER := 1;
  v_point_per_match_win CONSTANT INTEGER := 3;
BEGIN
  SELECT * INTO v_match FROM private_matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jogo não encontrado';
  END IF;
  IF v_match.status <> 'pending' THEN
    RAISE EXCEPTION 'Este jogo já foi confirmado';
  END IF;
  IF auth.uid() <> v_match.creator_id THEN
    RAISE EXCEPTION 'Só quem criou o jogo pode confirmar o resultado';
  END IF;
  IF v_match.team_a_player2_id IS NULL OR v_match.team_b_player1_id IS NULL OR v_match.team_b_player2_id IS NULL THEN
    RAISE EXCEPTION 'Faltam jogadores para confirmar o jogo';
  END IF;
  IF v_match.winner_team IS NULL THEN
    RAISE EXCEPTION 'Ainda não há resultado registado';
  END IF;

  UPDATE private_matches
  SET status = 'confirmed', confirmed_at = TIMEZONE('utc', NOW())
  WHERE id = p_match_id;

  INSERT INTO private_match_stats (private_match_id, user_id, points_earned, won)
  VALUES
    (p_match_id, v_match.team_a_player1_id,
     v_point_per_match_played + CASE WHEN v_match.winner_team = 'a' THEN v_point_per_match_win ELSE 0 END,
     v_match.winner_team = 'a'),
    (p_match_id, v_match.team_a_player2_id,
     v_point_per_match_played + CASE WHEN v_match.winner_team = 'a' THEN v_point_per_match_win ELSE 0 END,
     v_match.winner_team = 'a'),
    (p_match_id, v_match.team_b_player1_id,
     v_point_per_match_played + CASE WHEN v_match.winner_team = 'b' THEN v_point_per_match_win ELSE 0 END,
     v_match.winner_team = 'b'),
    (p_match_id, v_match.team_b_player2_id,
     v_point_per_match_played + CASE WHEN v_match.winner_team = 'b' THEN v_point_per_match_win ELSE 0 END,
     v_match.winner_team = 'b');
END;
$$;

REVOKE ALL ON FUNCTION confirm_private_match(UUID) FROM public;
GRANT EXECUTE ON FUNCTION confirm_private_match(UUID) TO authenticated;
```

- [ ] **Step 2: Run it and verify**

Run the file in Supabase → SQL Editor. Then, using the match created in Task 2's verification (or a fresh one where you fill all 4 slots — you can update the row directly with an admin query for test purposes, e.g. `UPDATE private_matches SET team_a_player2_id = <another real user id>, team_b_player1_id = <...>, team_b_player2_id = <...> WHERE id = '<id>';`):

```sql
SELECT submit_private_match_score('<id>', 6, 3);
SELECT confirm_private_match('<id>');
SELECT * FROM private_matches WHERE id = '<id>';
SELECT * FROM private_match_stats WHERE private_match_id = '<id>';
```

Expected: `private_matches.status = 'confirmed'`, `winner_team = 'a'`; 4 rows in `private_match_stats`, the two `team_a` players with `points_earned = 4, won = true`, the two `team_b` players with `points_earned = 1, won = false`.

Also verify confirming twice fails:

```sql
SELECT confirm_private_match('<id>');
```

Expected: raises `Este jogo já foi confirmado`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migration_private_matches_score_rpcs.sql
git commit -m "feat: add score submission and confirmation RPCs for private matches"
```

---

## Task 4: RPCs — reads for the private-matches list and the global ranking

**Files:**
- Create: `supabase/migration_private_matches_read_rpcs.sql`

**Interfaces:**
- Consumes: tables from Task 1, `player_stats` (existing).
- Produces: `get_my_private_matches() RETURNS TABLE(id, status, score_a, score_b, winner_team, played_at, confirmed_at, is_creator, team_a_player1_id, team_a_player1_name, team_a_player1_avatar, team_a_player2_id, team_a_player2_name, team_a_player2_avatar, team_b_player1_id, team_b_player1_name, team_b_player1_avatar, team_b_player2_id, team_b_player2_name, team_b_player2_avatar, my_points)`, `get_global_rankings() RETURNS TABLE(user_id, name, avatar_url, club_points BIGINT, private_points BIGINT, total_points BIGINT)`.

- [ ] **Step 1: Write the migration file**

Create `supabase/migration_private_matches_read_rpcs.sql`:

```sql
-- ════════════════════════════════════════════════════════════════════════
-- Migration: read RPCs — my private matches list + global ranking
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

-- All of the caller's private matches (pending + confirmed), with the
-- other players' name/avatar joined in. SECURITY DEFINER bypasses the
-- org-restricted `profiles` RLS policy on purpose: you already know these
-- 3 people in real life, they're in a match you're also in.
CREATE OR REPLACE FUNCTION get_my_private_matches()
RETURNS TABLE (
  id UUID,
  status TEXT,
  score_a INTEGER,
  score_b INTEGER,
  winner_team TEXT,
  played_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  is_creator BOOLEAN,
  team_a_player1_id UUID, team_a_player1_name TEXT, team_a_player1_avatar TEXT,
  team_a_player2_id UUID, team_a_player2_name TEXT, team_a_player2_avatar TEXT,
  team_b_player1_id UUID, team_b_player1_name TEXT, team_b_player1_avatar TEXT,
  team_b_player2_id UUID, team_b_player2_name TEXT, team_b_player2_avatar TEXT,
  my_points INTEGER
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    pm.id, pm.status, pm.score_a, pm.score_b, pm.winner_team, pm.played_at, pm.confirmed_at,
    pm.creator_id = auth.uid(),
    pm.team_a_player1_id, pa1.name, pa1.avatar_url,
    pm.team_a_player2_id, pa2.name, pa2.avatar_url,
    pm.team_b_player1_id, pb1.name, pb1.avatar_url,
    pm.team_b_player2_id, pb2.name, pb2.avatar_url,
    pms.points_earned
  FROM private_matches pm
  LEFT JOIN profiles pa1 ON pa1.id = pm.team_a_player1_id
  LEFT JOIN profiles pa2 ON pa2.id = pm.team_a_player2_id
  LEFT JOIN profiles pb1 ON pb1.id = pm.team_b_player1_id
  LEFT JOIN profiles pb2 ON pb2.id = pm.team_b_player2_id
  LEFT JOIN private_match_stats pms ON pms.private_match_id = pm.id AND pms.user_id = auth.uid()
  WHERE auth.uid() = ANY (
    ARRAY_REMOVE(ARRAY[pm.team_a_player1_id, pm.team_a_player2_id, pm.team_b_player1_id, pm.team_b_player2_id], NULL)
  )
  ORDER BY pm.played_at DESC;
$$;

REVOKE ALL ON FUNCTION get_my_private_matches() FROM public;
GRANT EXECUTE ON FUNCTION get_my_private_matches() TO authenticated;

-- App-wide leaderboard: every organization's player_stats.total_points for
-- a user, summed across every org they're in, plus their private-match
-- points. Read-computed (no denormalized column), same approach
-- Rankings.jsx already uses for the per-club "Geral" tab, just without the
-- organization_id filter.
CREATE OR REPLACE FUNCTION get_global_rankings()
RETURNS TABLE (
  user_id UUID,
  name TEXT,
  avatar_url TEXT,
  club_points BIGINT,
  private_points BIGINT,
  total_points BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH club AS (
    SELECT ps.user_id, SUM(ps.total_points) AS club_points
    FROM player_stats ps
    GROUP BY ps.user_id
  ),
  private AS (
    SELECT pms.user_id, SUM(pms.points_earned) AS private_points
    FROM private_match_stats pms
    GROUP BY pms.user_id
  )
  SELECT
    p.id,
    p.name,
    p.avatar_url,
    COALESCE(club.club_points, 0) AS club_points,
    COALESCE(private.private_points, 0) AS private_points,
    COALESCE(club.club_points, 0) + COALESCE(private.private_points, 0) AS total_points
  FROM profiles p
  LEFT JOIN club ON club.user_id = p.id
  LEFT JOIN private ON private.user_id = p.id
  WHERE club.user_id IS NOT NULL OR private.user_id IS NOT NULL
  ORDER BY total_points DESC, p.name ASC;
$$;

REVOKE ALL ON FUNCTION get_global_rankings() FROM public;
GRANT EXECUTE ON FUNCTION get_global_rankings() TO authenticated;
```

- [ ] **Step 2: Run it and verify**

Run the file in Supabase → SQL Editor. Then:

```sql
SELECT * FROM get_my_private_matches();
```

Expected: includes the match confirmed in Task 3, with `my_points = 4` or `1` depending on which side you're on, and the other 3 players' names/avatars populated even if some are in a different club than you.

```sql
SELECT * FROM get_global_rankings() LIMIT 20;
```

Expected: one row per player who has either club points or private points, `total_points = club_points + private_points`, ordered descending.

- [ ] **Step 3: Commit**

```bash
git add supabase/migration_private_matches_read_rpcs.sql
git commit -m "feat: add read RPCs for private matches list and global ranking"
```

---

## Task 5: Frontend API wrapper

**Files:**
- Create: `src/lib/privateMatches.js`

**Interfaces:**
- Consumes: the 6 RPCs from Tasks 2-4 (`create_private_match`, `claim_private_match_slot`, `search_players`, `submit_private_match_score`, `confirm_private_match`, `get_my_private_matches`, `get_global_rankings`).
- Produces: `searchPlayers(query)`, `createPrivateMatch({ teamAPlayer2Id, teamBPlayer1Id, teamBPlayer2Id })`, `claimPrivateMatchSlot(matchId, slot)`, `submitPrivateMatchScore(matchId, scoreA, scoreB)`, `confirmPrivateMatch(matchId)`, `getMyPrivateMatches()`, `getGlobalRankings()` — every later frontend task imports from this file, none call `supabase.rpc(...)` directly.

- [ ] **Step 1: Write the file**

Create `src/lib/privateMatches.js`:

```js
import { supabase } from './supabase'

export const searchPlayers = async (query) => {
  const { data, error } = await supabase.rpc('search_players', { p_query: query })
  if (error) throw error
  return data || []
}

export const createPrivateMatch = async ({ teamAPlayer2Id, teamBPlayer1Id, teamBPlayer2Id }) => {
  const { data, error } = await supabase.rpc('create_private_match', {
    p_team_a_player2_id: teamAPlayer2Id || null,
    p_team_b_player1_id: teamBPlayer1Id || null,
    p_team_b_player2_id: teamBPlayer2Id || null,
  })
  if (error) throw error
  return data
}

export const claimPrivateMatchSlot = async (matchId, slot) => {
  const { error } = await supabase.rpc('claim_private_match_slot', { p_match_id: matchId, p_slot: slot })
  if (error) throw error
}

export const submitPrivateMatchScore = async (matchId, scoreA, scoreB) => {
  const { error } = await supabase.rpc('submit_private_match_score', {
    p_match_id: matchId,
    p_score_a: scoreA,
    p_score_b: scoreB,
  })
  if (error) throw error
}

export const confirmPrivateMatch = async (matchId) => {
  const { error } = await supabase.rpc('confirm_private_match', { p_match_id: matchId })
  if (error) throw error
}

export const getMyPrivateMatches = async () => {
  const { data, error } = await supabase.rpc('get_my_private_matches')
  if (error) throw error
  return data || []
}

export const getGlobalRankings = async () => {
  const { data, error } = await supabase.rpc('get_global_rankings')
  if (error) throw error
  return data || []
}
```

- [ ] **Step 2: Verify it builds**

Run: `npx vite build`
Expected: build succeeds (this file isn't imported by anything yet, but it must be syntactically valid and type-consistent with how later tasks will call it).

- [ ] **Step 3: Commit**

```bash
git add src/lib/privateMatches.js
git commit -m "feat: add frontend API wrapper for private matches"
```

---

## Task 6: `PlayerSearch` component

**Files:**
- Create: `src/components/PlayerSearch.jsx`

**Interfaces:**
- Consumes: `searchPlayers(query)` from `src/lib/privateMatches.js` (Task 5); `Avatar` from `src/components/ui.jsx`.
- Produces: `<PlayerSearch label selected onSelect onClear excludeIds />` — `selected` is `null` or `{ id, name, avatar_url }`; `onSelect(player)` fires when a result is tapped; `onClear()` fires when the selected chip's remove button is tapped; `excludeIds` (array of UUID strings, default `[]`) hides those ids from results (used to stop the same player being picked into two slots). Task 7 renders three of these.

- [ ] **Step 1: Write the component**

Create `src/components/PlayerSearch.jsx`:

```jsx
import { useState, useEffect, useRef } from 'react'
import { Search, X } from 'lucide-react'
import { searchPlayers } from '../lib/privateMatches'
import { Avatar } from './ui'

export default function PlayerSearch({ label, selected, onSelect, onClear, excludeIds = [] }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const timeoutRef = useRef(null)

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    if (query.trim().length < 2) {
      setResults([])
      return
    }
    timeoutRef.current = setTimeout(async () => {
      try {
        const data = await searchPlayers(query)
        setResults(data)
      } catch (error) {
        console.error('Error searching players:', error)
      }
    }, 300)
    return () => clearTimeout(timeoutRef.current)
  }, [query])

  if (selected) {
    return (
      <div className="flex items-center gap-3 p-3 rounded-ctrl border border-line bg-canvas">
        <Avatar name={selected.name} url={selected.avatar_url} size="w-9 h-9 text-sm" />
        <p className="flex-1 font-extrabold text-ink-900 text-sm truncate">{selected.name}</p>
        <button type="button" onClick={onClear} aria-label="Remover" className="text-muted hover:text-ink-900">
          <X size={18} />
        </button>
      </div>
    )
  }

  const visibleResults = results.filter((p) => !excludeIds.includes(p.id))

  return (
    <div className="relative">
      <div className="flex items-center gap-2 input-field">
        <Search size={16} className="text-muted shrink-0" />
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={label}
          className="flex-1 bg-transparent outline-none text-sm"
        />
      </div>
      {open && visibleResults.length > 0 && (
        <div className="absolute z-10 mt-1 w-full bg-surface rounded-ctrl border border-line shadow-lift divide-y divide-line max-h-64 overflow-y-auto">
          {visibleResults.map((player) => (
            <button
              key={player.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onSelect(player); setQuery(''); setResults([]); setOpen(false) }}
              className="w-full flex items-center gap-3 p-3 hover:bg-ink-50 text-left"
            >
              <Avatar name={player.name} url={player.avatar_url} size="w-9 h-9 text-sm" />
              <p className="font-extrabold text-ink-900 text-sm truncate">{player.name}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

Note the `onMouseDown={(e) => e.preventDefault()}` on each result button — without it, the input's `onBlur` (which closes the dropdown after 150ms) fires before the button's `onClick`, and the click never registers.

- [ ] **Step 2: Verify it builds**

Run: `npx vite build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/PlayerSearch.jsx
git commit -m "feat: add PlayerSearch component"
```

---

## Task 7: Create-private-match page

**Files:**
- Create: `src/pages/CreatePrivateMatch.jsx`
- Modify: `src/App.jsx` (register route `/jogos-privados/novo`)

**Interfaces:**
- Consumes: `createPrivateMatch` from `src/lib/privateMatches.js`, `PlayerSearch` from Task 6, `PrimaryButton`/`Avatar` from `src/components/ui.jsx`, `useAuth` from `src/contexts/AuthContext`.
- Produces: route `/jogos-privados/novo`, navigates to `/jogos-privados` on success (Task 9 owns that route).

- [ ] **Step 1: Write the page**

Create `src/pages/CreatePrivateMatch.jsx`:

```jsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Users } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { createPrivateMatch } from '../lib/privateMatches'
import { PrimaryButton, Avatar } from '../components/ui'
import PlayerSearch from '../components/PlayerSearch'

export default function CreatePrivateMatch() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [teamAPlayer2, setTeamAPlayer2] = useState(null)
  const [teamBPlayer1, setTeamBPlayer1] = useState(null)
  const [teamBPlayer2, setTeamBPlayer2] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleCreate = async () => {
    setError('')
    setSaving(true)
    try {
      await createPrivateMatch({
        teamAPlayer2Id: teamAPlayer2?.id,
        teamBPlayer1Id: teamBPlayer1?.id,
        teamBPlayer2Id: teamBPlayer2?.id,
      })
      navigate('/jogos-privados')
    } catch (err) {
      console.error('Error creating private match:', err)
      setError('Não foi possível criar o jogo. Tenta novamente.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-3xl text-ink-900">Jogo entre amigos</h2>
        <p className="text-muted text-sm mt-1">Regista um 2x2 e convida os outros 3.</p>
      </div>

      <div className="card space-y-4">
        <div>
          <p className="text-sm font-extrabold text-ink-900 mb-2">A tua dupla</p>
          <div className="space-y-2">
            <div className="flex items-center gap-3 p-3 rounded-ctrl border border-line bg-ink-50">
              <Avatar name={profile?.name} url={profile?.avatar_url} size="w-9 h-9 text-sm" />
              <p className="font-extrabold text-ink-900 text-sm">{profile?.name} (tu)</p>
            </div>
            <PlayerSearch
              label="Procurar o teu parceiro..."
              selected={teamAPlayer2}
              onSelect={setTeamAPlayer2}
              onClear={() => setTeamAPlayer2(null)}
              excludeIds={[profile?.id, teamBPlayer1?.id, teamBPlayer2?.id].filter(Boolean)}
            />
          </div>
        </div>

        <div>
          <p className="text-sm font-extrabold text-ink-900 mb-2">Dupla adversária</p>
          <div className="space-y-2">
            <PlayerSearch
              label="Procurar 1º adversário..."
              selected={teamBPlayer1}
              onSelect={setTeamBPlayer1}
              onClear={() => setTeamBPlayer1(null)}
              excludeIds={[profile?.id, teamAPlayer2?.id, teamBPlayer2?.id].filter(Boolean)}
            />
            <PlayerSearch
              label="Procurar 2º adversário..."
              selected={teamBPlayer2}
              onSelect={setTeamBPlayer2}
              onClear={() => setTeamBPlayer2(null)}
              excludeIds={[profile?.id, teamAPlayer2?.id, teamBPlayer1?.id].filter(Boolean)}
            />
          </div>
        </div>

        <p className="text-xs text-muted">
          Não encontras alguém? Cria o jogo na mesma — depois de criares, podes copiar um link de convite para as posições em falta.
        </p>

        {error && (
          <div className="bg-danger/10 text-danger px-4 py-3 rounded-ctrl text-sm font-extrabold">{error}</div>
        )}

        <PrimaryButton onClick={handleCreate} disabled={saving} className="w-full">
          <Users size={18} />
          {saving ? 'A criar…' : 'Criar jogo'}
        </PrimaryButton>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Register the route**

In `src/App.jsx`, add the import near the other page imports:

```js
import CreatePrivateMatch from './pages/CreatePrivateMatch'
```

Add the route inside `<Routes>`, next to the `/perfil` route:

```jsx
<Route
  path="/jogos-privados/novo"
  element={
    <ProtectedRoute showSplash={showSplash}>
      <Layout>
        <CreatePrivateMatch />
      </Layout>
    </ProtectedRoute>
  }
/>
```

- [ ] **Step 3: Verify it builds and run through it manually**

Run: `npx vite build` — expected: success.

Run: `npm run dev`, log in, navigate to `/jogos-privados/novo`. Search for and select a partner and two opponents (type at least 2 characters of an existing player's name), confirm the same player can't be picked twice, click "Criar jogo", confirm it redirects (the target page 404s until Task 9 — that's expected at this point) and confirm in the Supabase table editor that a new `private_matches` row exists with the 4 correct ids.

- [ ] **Step 4: Commit**

```bash
git add src/pages/CreatePrivateMatch.jsx src/App.jsx
git commit -m "feat: add create-private-match page"
```

---

## Task 8: Join-by-link page

**Files:**
- Create: `src/pages/JoinPrivateMatch.jsx`
- Modify: `src/App.jsx` (register route `/jogos-privados/:id/entrar`)

**Interfaces:**
- Consumes: `claimPrivateMatchSlot` from `src/lib/privateMatches.js`, `PrimaryButton` from `src/components/ui.jsx`.
- Produces: route `/jogos-privados/:id/entrar?slot=team_a_player2|team_b_player1|team_b_player2`.

- [ ] **Step 1: Write the page**

Create `src/pages/JoinPrivateMatch.jsx`:

```jsx
import { useState } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import { claimPrivateMatchSlot } from '../lib/privateMatches'
import { PrimaryButton } from '../components/ui'

const SLOT_LABELS = {
  team_a_player2: 'na dupla de quem criou o jogo',
  team_b_player1: 'na dupla adversária',
  team_b_player2: 'na dupla adversária',
}

export default function JoinPrivateMatch() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const slot = searchParams.get('slot')
  const navigate = useNavigate()
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')

  const handleJoin = async () => {
    setStatus('joining')
    setError('')
    try {
      await claimPrivateMatchSlot(id, slot)
      setStatus('joined')
    } catch (err) {
      console.error('Error joining private match:', err)
      const message = err.message?.includes('já foi ocupada')
        ? 'Esta posição já foi ocupada por outro jogador.'
        : err.message?.includes('Já estás')
        ? 'Já estás neste jogo.'
        : 'Não foi possível entrar neste jogo.'
      setError(message)
      setStatus('error')
    }
  }

  if (!slot || !SLOT_LABELS[slot]) {
    return (
      <div className="card text-center py-8">
        <p className="text-danger font-extrabold">Link de convite inválido.</p>
      </div>
    )
  }

  if (status === 'joined') {
    return (
      <div className="card text-center py-8 space-y-3">
        <CheckCircle2 size={40} className="mx-auto text-ok" />
        <p className="font-extrabold text-ink-900">Entraste no jogo!</p>
        <PrimaryButton onClick={() => navigate('/jogos-privados')} className="w-full">
          Ver jogo
        </PrimaryButton>
      </div>
    )
  }

  return (
    <div className="card text-center py-8 space-y-4">
      <p className="text-ink-900">Foste convidado para um jogo entre amigos, {SLOT_LABELS[slot]}.</p>
      {error && <p className="text-danger text-sm font-extrabold">{error}</p>}
      <PrimaryButton onClick={handleJoin} disabled={status === 'joining'} className="w-full">
        {status === 'joining' ? 'A entrar…' : 'Entrar no jogo'}
      </PrimaryButton>
    </div>
  )
}
```

- [ ] **Step 2: Register the route**

In `src/App.jsx`, add the import:

```js
import JoinPrivateMatch from './pages/JoinPrivateMatch'
```

Add the route (unguarded by `MemberRoute` — guests can join a private match too, since it has nothing to do with club membership):

```jsx
<Route
  path="/jogos-privados/:id/entrar"
  element={
    <ProtectedRoute showSplash={showSplash}>
      <Layout>
        <JoinPrivateMatch />
      </Layout>
    </ProtectedRoute>
  }
/>
```

- [ ] **Step 3: Verify it builds and run through it manually**

Run: `npx vite build` — expected: success.

Run: `npm run dev`. Using the match created in Task 7 (with an open slot), log in as a *different* user and visit `/jogos-privados/<id>/entrar?slot=team_b_player1`. Click "Entrar no jogo", confirm the success state shows, and confirm in the Supabase table editor that `team_b_player1_id` on that row is now that user's id. Then reload the same link and confirm it now shows "Já estás neste jogo." (via the error path) since claiming twice should fail.

- [ ] **Step 4: Commit**

```bash
git add src/pages/JoinPrivateMatch.jsx src/App.jsx
git commit -m "feat: add join-private-match-by-link page"
```

---

## Task 9: Private matches hub page + Home entry point

**Files:**
- Create: `src/pages/PrivateMatches.jsx`
- Modify: `src/App.jsx` (register route `/jogos-privados`)
- Modify: `src/pages/Home.jsx` (add entry-point card)

**Interfaces:**
- Consumes: `getMyPrivateMatches`, `submitPrivateMatchScore`, `confirmPrivateMatch` from `src/lib/privateMatches.js`; `PrimaryButton`, `EmptyState` from `src/components/ui.jsx`.
- Produces: route `/jogos-privados` — the landing page Task 7 and Task 8 navigate to.

- [ ] **Step 1: Write the hub page**

Create `src/pages/PrivateMatches.jsx`:

```jsx
import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Trophy, Copy, Check } from 'lucide-react'
import { getMyPrivateMatches, submitPrivateMatchScore, confirmPrivateMatch } from '../lib/privateMatches'
import { PrimaryButton, EmptyState } from '../components/ui'

const OPEN_SLOTS = [
  { key: 'team_a_player2', idField: 'team_a_player2_id' },
  { key: 'team_b_player1', idField: 'team_b_player1_id' },
  { key: 'team_b_player2', idField: 'team_b_player2_id' },
]

function ScoreForm({ match, onSubmit }) {
  const [scoreA, setScoreA] = useState('')
  const [scoreB, setScoreB] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await onSubmit(match.id, Number(scoreA), Number(scoreB))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2 mt-3">
      <input type="number" value={scoreA} onChange={(e) => setScoreA(e.target.value)} className="input-field w-16 text-center" placeholder="0" required />
      <span className="text-muted font-extrabold">-</span>
      <input type="number" value={scoreB} onChange={(e) => setScoreB(e.target.value)} className="input-field w-16 text-center" placeholder="0" required />
      <PrimaryButton type="submit" disabled={saving} className="flex-1">
        {saving ? 'A guardar…' : 'Registar resultado'}
      </PrimaryButton>
    </form>
  )
}

function InviteLinks({ match }) {
  const [copied, setCopied] = useState('')
  const openSlots = OPEN_SLOTS.filter((s) => !match[s.idField])
  if (openSlots.length === 0) return null

  const copyLink = async (slotKey) => {
    const url = `${window.location.origin}/jogos-privados/${match.id}/entrar?slot=${slotKey}`
    await navigator.clipboard.writeText(url)
    setCopied(slotKey)
    setTimeout(() => setCopied(''), 1500)
  }

  return (
    <div className="mt-3 space-y-2">
      <p className="text-xs text-muted">Faltam {openSlots.length} jogador(es):</p>
      {openSlots.map((s) => (
        <button
          key={s.key}
          type="button"
          onClick={() => copyLink(s.key)}
          className="flex items-center gap-2 text-xs font-extrabold text-ink-700 hover:text-ink-900"
        >
          {copied === s.key ? <Check size={14} className="text-ok" /> : <Copy size={14} />}
          {copied === s.key ? 'Link copiado!' : 'Copiar link de convite'}
        </button>
      ))}
    </div>
  )
}

const teamLabel = (m, prefix) => {
  const p1 = m[`${prefix}_player1_name`]
  const p2 = m[`${prefix}_player2_name`]
  return [p1, p2].filter(Boolean).join(' + ') || 'Por convidar'
}

export default function PrivateMatches() {
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const data = await getMyPrivateMatches()
      setMatches(data)
    } catch (error) {
      console.error('Error loading private matches:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleSubmitScore = async (matchId, scoreA, scoreB) => {
    try {
      await submitPrivateMatchScore(matchId, scoreA, scoreB)
      await load()
    } catch (error) {
      console.error('Error submitting score:', error)
      alert('Não foi possível registar o resultado.')
    }
  }

  const handleConfirm = async (matchId) => {
    try {
      await confirmPrivateMatch(matchId)
      await load()
    } catch (error) {
      console.error('Error confirming match:', error)
      alert('Não foi possível confirmar o jogo.')
    }
  }

  const pending = matches.filter((m) => m.status === 'pending')
  const confirmed = matches.filter((m) => m.status === 'confirmed')

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-ink-50 border-t-ink-700"></div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl text-ink-900">Jogos entre amigos</h2>
        <Link to="/jogos-privados/novo">
          <PrimaryButton>
            <Plus size={18} /> Novo
          </PrimaryButton>
        </Link>
      </div>

      {pending.length > 0 && (
        <div>
          <h3 className="text-lg text-ink-900 mb-3">Por confirmar</h3>
          <div className="space-y-3">
            {pending.map((m) => {
              const canConfirm = m.is_creator && m.score_a !== null && m.team_a_player2_id && m.team_b_player1_id && m.team_b_player2_id
              return (
                <div key={m.id} className="card">
                  <p className="font-extrabold text-ink-900 text-sm">{teamLabel(m, 'team_a')} vs {teamLabel(m, 'team_b')}</p>
                  {m.score_a !== null && m.score_b !== null ? (
                    <p className="text-sm text-muted mt-1">
                      Resultado: {m.score_a} - {m.score_b}
                      {!m.is_creator ? ' · aguarda confirmação de quem criou o jogo' : ''}
                    </p>
                  ) : (
                    <ScoreForm match={m} onSubmit={handleSubmitScore} />
                  )}
                  {canConfirm && (
                    <PrimaryButton onClick={() => handleConfirm(m.id)} className="w-full mt-3">
                      Confirmar resultado
                    </PrimaryButton>
                  )}
                  <InviteLinks match={m} />
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div>
        <h3 className="text-lg text-ink-900 mb-3">Histórico</h3>
        {confirmed.length === 0 ? (
          <EmptyState
            icon={Trophy}
            title="Ainda não tens jogos confirmados"
            subtitle="Cria o teu primeiro jogo entre amigos."
          />
        ) : (
          <div className="space-y-2.5">
            {confirmed.map((m) => (
              <div key={m.id} className="card">
                <p className="font-extrabold text-ink-900 text-sm">{teamLabel(m, 'team_a')} vs {teamLabel(m, 'team_b')}</p>
                <p className="text-[11px] text-muted mt-0.5">
                  {m.score_a} - {m.score_b} · {m.my_points} pontos
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Register the route**

In `src/App.jsx`, add the import:

```js
import PrivateMatches from './pages/PrivateMatches'
```

Add the route:

```jsx
<Route
  path="/jogos-privados"
  element={
    <ProtectedRoute showSplash={showSplash}>
      <Layout>
        <PrivateMatches />
      </Layout>
    </ProtectedRoute>
  }
/>
```

- [ ] **Step 3: Add the entry point to Home**

In `src/pages/Home.jsx`, add the import:

```js
import { Link } from 'react-router-dom'
```

(Check first whether `Link` is already imported from `react-router-dom` in this file — if the existing import line already includes other named imports from `react-router-dom`, add `Link` to that same line instead of a new import line.)

Add this card right after the tab bar / before the games list (match the existing spacing pattern of sibling elements — wrap in the same `space-y-*` container Home.jsx already uses):

```jsx
<Link to="/jogos-privados" className="card press flex items-center gap-3 hover:shadow-lift">
  <div className="w-10 h-10 rounded-ctrl bg-lime-400/15 text-lime-600 flex items-center justify-center shrink-0">
    <Users size={18} />
  </div>
  <div>
    <p className="font-extrabold text-ink-900 text-sm">Jogo entre amigos</p>
    <p className="text-[11px] text-muted">Regista um 2x2 fora do clube</p>
  </div>
</Link>
```

`Users` is already imported in `Home.jsx` (`import { CalendarX2, Trophy, Users } from 'lucide-react'`) — no new icon import needed.

- [ ] **Step 4: Verify it builds and run through it manually**

Run: `npx vite build` — expected: success.

Run: `npm run dev`. From Home, click the new "Jogo entre amigos" card, confirm it lands on `/jogos-privados`. Create a match (Task 7's flow), confirm it appears under "Por confirmar" with a score form. Submit a score as a non-creator participant, confirm the "Confirmar resultado" button only appears for the creator once all 4 slots are filled and a score exists. Confirm it, reload, and confirm it now appears under "Histórico" with the right points.

- [ ] **Step 5: Commit**

```bash
git add src/pages/PrivateMatches.jsx src/App.jsx src/pages/Home.jsx
git commit -m "feat: add private matches hub page and Home entry point"
```

---

## Task 10: Global ranking tab on the Rankings page

**Files:**
- Modify: `src/pages/Rankings.jsx`

**Interfaces:**
- Consumes: `getGlobalRankings` from `src/lib/privateMatches.js` (Task 5).
- Produces: a 4th "Global" tab on the existing `/rankings` page.

- [ ] **Step 1: Add the import and tab entry**

In `src/pages/Rankings.jsx`, add the import next to the other lib imports:

```js
import { getGlobalRankings } from '../lib/privateMatches'
```

Change the `TABS` constant to:

```js
const TABS = [
  { key: 'geral', label: 'Geral' },
  { key: 'mensal', label: 'Mensal' },
  { key: 'mixes', label: 'Mixes' },
  { key: 'global', label: 'Global' },
]
```

- [ ] **Step 2: Add state and the load function**

Add alongside the other `useState` declarations (near `// Geral`):

```js
// Global
const [globalRankings, setGlobalRankings] = useState([])
```

Add the load function alongside `loadPlayers`/`loadMixes`:

```js
const loadGlobalRankings = async () => {
  try {
    const data = await getGlobalRankings()
    setGlobalRankings(data)
  } catch (error) {
    console.error('Error loading global rankings:', error)
  }
}
```

Add it to the existing effect's calls:

```js
useEffect(() => {
  if (!currentOrganizationId) return
  loadRankings()
  loadPlayers()
  loadMonthly()
  loadMixes()
  loadGlobalRankings()
}, [currentOrganizationId])
```

- [ ] **Step 3: Add the render block**

Add this block right after the `{/* ─── Mixes ─── */}` block, before the closing `</div>` of the component:

```jsx
{/* ─── Global ─────────────────────────────────────────────────────── */}
{tab === 'global' && (
  globalRankings.length === 0 ? (
    <EmptyState
      icon={Trophy}
      title="Ranking global em branco"
      subtitle="Joga mixes ou jogos entre amigos para apareceres aqui."
    />
  ) : (
    <div className="space-y-3">
      {globalRankings.map((player, index) => (
        <Link
          key={player.user_id}
          to={`/jogador/${player.user_id}`}
          className={`card press block hover:shadow-lift ${index === 0 ? 'ring-2 ring-lime-400' : ''}`}
        >
          <div className="flex items-center gap-3.5">
            <div className={`w-11 h-11 rounded-ctrl flex items-center justify-center font-extrabold text-lg shrink-0 tabular-nums ${positionStyle(index)}`}>
              {index + 1}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-base text-ink-900 truncate">{player.name}</h3>
              <p className="text-[11px] text-muted mt-0.5">
                {player.club_points} pts clube · {player.private_points} pts amigos
              </p>
            </div>
            <div className="text-right shrink-0">
              <span className="text-2xl font-extrabold text-ink-900 tabular-nums">{player.total_points}</span>
              <p className="text-[11px] text-muted">pontos</p>
            </div>
          </div>
        </Link>
      ))}
    </div>
  )
)}
```

- [ ] **Step 4: Verify it builds and run through it manually**

Run: `npx vite build` — expected: success.

Run: `npm run dev`, navigate to `/rankings`, click the new "Global" tab, confirm it lists players ordered by combined points and that the club/private point split shown matches what you'd expect from the players you tested in Tasks 3 and 9.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Rankings.jsx
git commit -m "feat: add global ranking tab to Rankings page"
```

---

## Task 11: Profile — "Jogos entre amigos" section + points breakdown

**Files:**
- Modify: `src/pages/Profile.jsx`

**Interfaces:**
- Consumes: `getMyPrivateMatches`, `getGlobalRankings` from `src/lib/privateMatches.js` (Task 5).
- Produces: new section on `/perfil` (non-guest view only, mirrors the existing "Histórico de mixes" section).

- [ ] **Step 1: Add the import and state**

In `src/pages/Profile.jsx`, add the import:

```js
import { getMyPrivateMatches, getGlobalRankings } from '../lib/privateMatches'
```

Add state alongside the existing `mixHistory`/`mixHistoryLoading`:

```js
const [privateMatchHistory, setPrivateMatchHistory] = useState([])
const [privateMatchHistoryLoading, setPrivateMatchHistoryLoading] = useState(true)
const [globalPoints, setGlobalPoints] = useState(null)
```

- [ ] **Step 2: Add the load function and wire it into the existing effect**

Add alongside `loadMixHistory`:

```js
const loadPrivateMatchHistory = async () => {
  setPrivateMatchHistoryLoading(true)
  try {
    const data = await getMyPrivateMatches()
    setPrivateMatchHistory(data.filter((m) => m.status === 'confirmed'))
  } catch (error) {
    console.error('Error loading private match history:', error)
  } finally {
    setPrivateMatchHistoryLoading(false)
  }
}

const loadGlobalPoints = async () => {
  try {
    const data = await getGlobalRankings()
    setGlobalPoints(data.find((p) => p.user_id === profile.id) || null)
  } catch (error) {
    console.error('Error loading global points:', error)
  }
}
```

Update the existing effect to call both:

```js
useEffect(() => {
  if (profile) {
    setName(profile.name)
    setLevel(currentMembership?.level || 'iniciante')
    setPreferredSide(profile.preferred_side || 'both')
    setBirthday(profile.birthday || '')
    setGender(profile.gender || '')
    if (!isGuest && currentOrganizationId) {
      loadStats()
      loadMixHistory()
      loadPrivateMatchHistory()
      loadGlobalPoints()
    }
  }
}, [profile, currentMembership, currentOrganizationId])
```

- [ ] **Step 3: Add the points breakdown and the history section**

Add the points breakdown right after the `{/* Stats */}` block (the `statTiles` grid), before `{/* Mix history */}`:

```jsx
{globalPoints && (
  <div className="card">
    <div className="flex items-center justify-between">
      <p className="text-sm font-extrabold text-ink-900">Ranking global</p>
      <span className="text-2xl font-extrabold text-ink-900 tabular-nums">{globalPoints.total_points}</span>
    </div>
    <p className="text-[11px] text-muted mt-1">
      {globalPoints.club_points} pontos de clubes · {globalPoints.private_points} pontos de jogos entre amigos
    </p>
  </div>
)}
```

Add the private-match history section right after the existing `{/* Mix history */}` block:

```jsx
{/* Private match history */}
{!privateMatchHistoryLoading && (
  <div>
    <h3 className="text-lg text-ink-900 mb-3">Jogos entre amigos</h3>

    {privateMatchHistory.length === 0 ? (
      <EmptyState
        icon={Trophy}
        title="Ainda não tens jogos entre amigos"
        subtitle="Cria um jogo 2x2 fora do clube para começares o teu histórico."
      />
    ) : (
      <div className="space-y-2.5">
        {privateMatchHistory.map((m) => {
          const teamLabel = (prefix) =>
            [m[`${prefix}_player1_name`], m[`${prefix}_player2_name`]].filter(Boolean).join(' + ')
          return (
            <Link key={m.id} to="/jogos-privados" className="card press flex items-center justify-between hover:shadow-lift">
              <div className="min-w-0">
                <p className="font-extrabold text-ink-900 text-sm truncate">
                  {teamLabel('team_a')} vs {teamLabel('team_b')}
                </p>
                <p className="text-[11px] text-muted mt-0.5">{m.score_a} - {m.score_b}</p>
              </div>
              <span className="text-xs font-extrabold px-2.5 py-1.5 rounded-full shrink-0 tabular-nums bg-ink-50 text-ink-700">
                {m.my_points} pts
              </span>
            </Link>
          )
        })}
      </div>
    )}
  </div>
)}
```

- [ ] **Step 4: Verify it builds and run through it manually**

Run: `npx vite build` — expected: success.

Run: `npm run dev`, navigate to `/perfil`, confirm the new "Ranking global" card shows the club/private split and that its total matches your row in the `/rankings` → Global tab from Task 10. Confirm "Jogos entre amigos" lists your confirmed private matches with the right points, and shows the empty state if you have none.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Profile.jsx
git commit -m "feat: show private match history and global points on Profile"
```

---

## Self-review notes

- **Spec coverage:** every section of the design doc maps to a task — table/RLS (Task 1), private-match points fixed at 1/+3 (Task 3), search-or-link invite (Tasks 2, 6-8), creator-only confirm (Task 3), global ranking as club + private sum (Tasks 4, 10), Profile history + breakdown (Task 11), no organization restriction on opponents (Task 2's `search_players` has no org filter).
- **Deliberate deviation from the design doc:** the design doc says invitees get "an in-app notification" — this repo has no notification system at all (confirmed: no table, no UI badge, nothing). Building one is out of scope per the design doc's own "Out of scope" section (only "real push notifications" is explicitly deferred there, but the same reasoning applies to in-app notifications since no infrastructure exists to hook into). This plan implements the passive equivalent instead: a pending match simply appears next time the other players open `/jogos-privados` or `/perfil`. Flagging this here since it's the one place the plan narrows the spec rather than just translating it.
- **NULL-handling correctness:** every "is this user one of the 4 players" check uses `= ANY(ARRAY_REMOVE(ARRAY[...], NULL))` rather than `IN (...)` — with unfilled (`NULL`) slots, plain `IN`/`= ANY` returns `NULL` instead of `FALSE` for a legitimate non-member, which would silently skip the guard. This is called out inline in Task 2 so the reasoning isn't lost.
