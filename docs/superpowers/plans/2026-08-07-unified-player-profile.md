# Unified Player Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/jogador/:id` work for any player regardless of shared club membership, so Rankings' "Geral" (global, cross-club) tab rows can be tappable links again, matching every other player list in the app.

**Architecture:** Three new `SECURITY DEFINER` Postgres RPCs (following the existing `search_players`/`get_global_rankings`/`mix_head_to_head` pattern already in `supabase/schema.sql`) bypass the org-restricted `profiles`/`player_stats`/`matches` RLS to expose only aggregate, non-sensitive fields for any user id. `PlayerDetails.jsx` is rewritten to call these instead of its three org-scoped queries. Rankings' Global tab rows switch back from `<div>` to `<Link>`.

**Tech Stack:** Postgres (Supabase, manually-applied SQL files — no migration runner in this repo, see `supabase/*.sql` header convention), React (`src/pages/PlayerDetails.jsx`, `src/pages/Rankings.jsx`).

## Global Constraints

- No new tables. Three new RPCs only, in a new file `supabase/migration_unified_player_profile.sql`, following the file-header convention used by every other file in `supabase/` ("Run this whole file in Supabase → SQL Editor → New query → Run").
- Every new function: `SECURITY DEFINER`, `SET search_path = public`, `REVOKE ALL ... FROM public` + `GRANT EXECUTE ... TO authenticated` (exact pattern already used by `search_players` in `supabase/migration_private_matches_create_rpcs.sql:109-128`).
- No changes to `mix_head_to_head`/`mix_head_to_head_matches` — they stay as-is for other callers.
- No new frontend page/route (`Players.jsx`/`/jogadores` search page) — out of scope for this plan, only the profile-page + Global-tab-link portion of the original design doc (`docs/superpowers/specs/2026-07-30-player-search-unified-profile-design.md`) is being built.
- This repo has no automated test runner (no `vitest`/`jest` in `package.json`). "Tests" in this plan are manual SQL verification queries (run in Supabase SQL Editor) and manual browser checks, per this project's actual practice (see `CLAUDE.md`/memory: verify UI changes live in the browser).

---

### Task 1: `get_player_profile(p_user_id UUID)` RPC

**Files:**
- Create: `supabase/migration_unified_player_profile.sql`

**Interfaces:**
- Produces: `get_player_profile(p_user_id UUID) RETURNS TABLE (id UUID, name TEXT, avatar_url TEXT, level TEXT, game_wins BIGINT, game_losses BIGINT, mix_wins BIGINT, mixes_played BIGINT, club_points BIGINT, private_points BIGINT, total_points BIGINT)`

- [ ] **Step 1: Write the function**

```sql
-- ════════════════════════════════════════════════════════════════════════
-- Migration: Unified player profile — /jogador/:id works across clubs
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

-- Cross-org player profile: aggregates player_stats across every
-- organization p_user_id belongs to (not just the caller's current one),
-- plus private-match points. SECURITY DEFINER bypasses the org-restricted
-- profiles/player_stats RLS on purpose, same pattern as search_players/
-- get_global_rankings — only aggregate, non-sensitive fields are exposed.
-- `level` is populated only when the caller happens to share a club with
-- p_user_id (level is club-scoped and meaningless otherwise); if they
-- share more than one club, any one of the matching rows is fine.
CREATE OR REPLACE FUNCTION get_player_profile(p_user_id UUID)
RETURNS TABLE (
  id UUID,
  name TEXT,
  avatar_url TEXT,
  level TEXT,
  game_wins BIGINT,
  game_losses BIGINT,
  mix_wins BIGINT,
  mixes_played BIGINT,
  club_points BIGINT,
  private_points BIGINT,
  total_points BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH club_stats AS (
    SELECT
      COALESCE(SUM(ps.game_wins), 0) AS game_wins,
      COALESCE(SUM(ps.game_losses), 0) AS game_losses,
      COALESCE(SUM(ps.mix_wins), 0) AS mix_wins,
      COALESCE(SUM(ps.mixes_played), 0) AS mixes_played,
      COALESCE(SUM(ps.total_points), 0) AS club_points
    FROM player_stats ps
    WHERE ps.user_id = p_user_id
  ),
  private_stats AS (
    SELECT COALESCE(SUM(pms.points_earned), 0) AS private_points
    FROM private_match_stats pms
    WHERE pms.user_id = p_user_id
  ),
  shared_level AS (
    SELECT m.level
    FROM memberships m
    WHERE m.user_id = p_user_id
      AND EXISTS (
        SELECT 1 FROM memberships caller
        WHERE caller.user_id = auth.uid()
          AND caller.organization_id = m.organization_id
      )
    LIMIT 1
  )
  SELECT
    p.id,
    p.name,
    p.avatar_url,
    (SELECT level FROM shared_level),
    club_stats.game_wins,
    club_stats.game_losses,
    club_stats.mix_wins,
    club_stats.mixes_played,
    club_stats.club_points,
    private_stats.private_points,
    club_stats.club_points + private_stats.private_points
  FROM profiles p, club_stats, private_stats
  WHERE p.id = p_user_id;
$$;

REVOKE ALL ON FUNCTION get_player_profile(UUID) FROM public;
GRANT EXECUTE ON FUNCTION get_player_profile(UUID) TO authenticated;
```

- [ ] **Step 2: Manual verification (run in Supabase SQL Editor after applying)**

```sql
-- Replace with a real profile id from your `profiles` table.
SELECT * FROM get_player_profile('00000000-0000-0000-0000-000000000000');
```

Expected: one row, `total_points = club_points + private_points`, `level` is `NULL` unless you're signed in (via `auth.uid()`) as someone who shares a club with that id — the SQL Editor runs as no particular authenticated user, so `level` will read `NULL` there regardless; that's expected and gets verified for real from the app in Task 4.

- [ ] **Step 3: Commit**

```bash
git add supabase/migration_unified_player_profile.sql
git commit -m "feat: add get_player_profile RPC for cross-club player profiles"
```

---

### Task 2: `get_head_to_head_summary`/`get_head_to_head_matches` RPCs

**Files:**
- Modify: `supabase/migration_unified_player_profile.sql` (append)

**Interfaces:**
- Consumes: `matches`, `teams`, `games`, `private_matches`, `private_match_stats` tables (schemas in `supabase/schema.sql:129-141` and `supabase/migration_private_matches.sql:9-50`)
- Produces:
  - `get_head_to_head_summary(p_opponent_id UUID) RETURNS TABLE (wins INTEGER, losses INTEGER, matches_played INTEGER)`
  - `get_head_to_head_matches(p_opponent_id UUID) RETURNS TABLE (match_id UUID, source TEXT, label TEXT, match_date TIMESTAMPTZ, player_score INTEGER, opponent_score INTEGER, won BOOLEAN)`

- [ ] **Step 1: Append both functions to the migration file**

```sql
-- Combined head-to-head record (auth.uid() vs p_opponent_id) across every
-- mix in every club plus every confirmed private match between the two —
-- same LATERAL-VALUES pairing technique as mix_head_to_head() in
-- schema.sql, just without the organization_id filter, unioned with the
-- private_matches side.
CREATE OR REPLACE FUNCTION get_head_to_head_summary(p_opponent_id UUID)
RETURNS TABLE (wins INTEGER, losses INTEGER, matches_played INTEGER)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH mix_pairings AS (
    SELECT (m.winner_team_id = ta.id) = pa.is_a AS won
    FROM matches m
    JOIN teams ta ON ta.id = m.team_a_id
    JOIN teams tb ON tb.id = m.team_b_id
    CROSS JOIN LATERAL (VALUES
      (ta.player1_id, TRUE), (ta.player2_id, TRUE),
      (tb.player1_id, FALSE), (tb.player2_id, FALSE)
    ) AS pa(pid, is_a)
    CROSS JOIN LATERAL (VALUES
      (ta.player1_id, TRUE), (ta.player2_id, TRUE),
      (tb.player1_id, FALSE), (tb.player2_id, FALSE)
    ) AS pb(pid, is_a)
    WHERE m.winner_team_id IS NOT NULL
      AND pa.is_a <> pb.is_a
      AND pa.pid = auth.uid() AND pb.pid = p_opponent_id
  ),
  -- A confirmed private match always has all 4 slots filled (enforced by
  -- confirm_private_match()), so no NULL-slot guard is needed here — but
  -- IN() against a possibly-NULL slot is still harmless (NULL never
  -- matches a real uuid).
  private_pairings AS (
    SELECT pms.won
    FROM private_matches pm
    JOIN private_match_stats pms ON pms.private_match_id = pm.id AND pms.user_id = auth.uid()
    WHERE pm.status = 'confirmed'
      AND (
        (auth.uid() IN (pm.team_a_player1_id, pm.team_a_player2_id)
         AND p_opponent_id IN (pm.team_b_player1_id, pm.team_b_player2_id))
        OR
        (auth.uid() IN (pm.team_b_player1_id, pm.team_b_player2_id)
         AND p_opponent_id IN (pm.team_a_player1_id, pm.team_a_player2_id))
      )
  ),
  combined AS (
    SELECT won FROM mix_pairings
    UNION ALL
    SELECT won FROM private_pairings
  )
  SELECT
    COUNT(*) FILTER (WHERE won)::INTEGER,
    COUNT(*) FILTER (WHERE NOT won)::INTEGER,
    COUNT(*)::INTEGER
  FROM combined;
$$;

REVOKE ALL ON FUNCTION get_head_to_head_summary(UUID) FROM public;
GRANT EXECUTE ON FUNCTION get_head_to_head_summary(UUID) TO authenticated;

-- Row-per-match version of the above, for the expandable match list.
CREATE OR REPLACE FUNCTION get_head_to_head_matches(p_opponent_id UUID)
RETURNS TABLE (
  match_id UUID,
  source TEXT,
  label TEXT,
  match_date TIMESTAMPTZ,
  player_score INTEGER,
  opponent_score INTEGER,
  won BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH mix_matches AS (
    SELECT m.id AS match_id, 'mix'::TEXT AS source, g.title AS label, g.date AS match_date,
           CASE WHEN pa.is_a THEN m.score_a ELSE m.score_b END AS player_score,
           CASE WHEN pa.is_a THEN m.score_b ELSE m.score_a END AS opponent_score,
           (m.winner_team_id = ta.id) = pa.is_a AS won
    FROM matches m
    JOIN teams ta ON ta.id = m.team_a_id
    JOIN teams tb ON tb.id = m.team_b_id
    JOIN games g ON g.id = m.game_id
    CROSS JOIN LATERAL (VALUES
      (ta.player1_id, TRUE), (ta.player2_id, TRUE),
      (tb.player1_id, FALSE), (tb.player2_id, FALSE)
    ) AS pa(pid, is_a)
    CROSS JOIN LATERAL (VALUES
      (ta.player1_id, TRUE), (ta.player2_id, TRUE),
      (tb.player1_id, FALSE), (tb.player2_id, FALSE)
    ) AS pb(pid, is_a)
    WHERE m.winner_team_id IS NOT NULL
      AND pa.is_a <> pb.is_a
      AND pa.pid = auth.uid() AND pb.pid = p_opponent_id
  ),
  private_matches_list AS (
    SELECT pm.id AS match_id, 'private'::TEXT AS source,
           'Jogo entre amigos'::TEXT AS label, pm.played_at AS match_date,
           CASE WHEN auth.uid() IN (pm.team_a_player1_id, pm.team_a_player2_id)
                THEN pm.score_a ELSE pm.score_b END AS player_score,
           CASE WHEN auth.uid() IN (pm.team_a_player1_id, pm.team_a_player2_id)
                THEN pm.score_b ELSE pm.score_a END AS opponent_score,
           pms.won
    FROM private_matches pm
    JOIN private_match_stats pms ON pms.private_match_id = pm.id AND pms.user_id = auth.uid()
    WHERE pm.status = 'confirmed'
      AND (
        (auth.uid() IN (pm.team_a_player1_id, pm.team_a_player2_id)
         AND p_opponent_id IN (pm.team_b_player1_id, pm.team_b_player2_id))
        OR
        (auth.uid() IN (pm.team_b_player1_id, pm.team_b_player2_id)
         AND p_opponent_id IN (pm.team_a_player1_id, pm.team_a_player2_id))
      )
  )
  SELECT * FROM mix_matches
  UNION ALL
  SELECT * FROM private_matches_list
  ORDER BY match_date DESC;
$$;

REVOKE ALL ON FUNCTION get_head_to_head_matches(UUID) FROM public;
GRANT EXECUTE ON FUNCTION get_head_to_head_matches(UUID) TO authenticated;
```

- [ ] **Step 2: Manual verification**

Run both, signed in as a real user via the app's Supabase client isn't possible from the SQL Editor (no `auth.uid()` there) — instead verify shape only:

```sql
SELECT * FROM get_head_to_head_summary('00000000-0000-0000-0000-000000000000');
SELECT * FROM get_head_to_head_matches('00000000-0000-0000-0000-000000000000');
```

Expected: no error, `wins/losses/matches_played` all `0` (since `auth.uid()` is null outside the app), zero rows from `get_head_to_head_matches`. Real behavior gets verified from the app in Task 4.

- [ ] **Step 3: Commit**

```bash
git add supabase/migration_unified_player_profile.sql
git commit -m "feat: add get_head_to_head_summary/matches RPCs for cross-club head-to-head"
```

---

### Task 3: Rewrite `PlayerDetails.jsx` to be club-independent

**Files:**
- Modify: `src/pages/PlayerDetails.jsx`

**Interfaces:**
- Consumes: `get_player_profile(p_user_id)`, `get_head_to_head_summary(p_opponent_id)`, `get_head_to_head_matches(p_opponent_id)` from Tasks 1-2.

- [ ] **Step 1: Drop the `currentOrganizationId` gate and switch `loadPlayer`/`loadH2h`/`toggleOpponent` to the new RPCs**

Replace the whole file's data-loading logic:

```jsx
import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Trophy, Target, Award, Swords, ChevronDown } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { PrimaryButton, LevelBadge, EmptyState, Avatar } from '../components/ui'
import { winRatePct } from '../lib/statsLogic'

export default function PlayerDetails() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [player, setPlayer] = useState(null)
  const [loading, setLoading] = useState(true)

  const [h2h, setH2h] = useState(null)
  const [h2hLoading, setH2hLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const [h2hMatches, setH2hMatches] = useState([])
  const [matchesLoading, setMatchesLoading] = useState(false)

  useEffect(() => {
    loadPlayer()
    loadH2h()
  }, [id])

  const loadPlayer = async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase.rpc('get_player_profile', { p_user_id: id })
      if (error) throw error
      setPlayer(data?.[0] || null)
    } catch (error) {
      console.error('Error loading player:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadH2h = async () => {
    setH2hLoading(true)
    setExpanded(false)
    setH2hMatches([])
    try {
      const { data, error } = await supabase.rpc('get_head_to_head_summary', { p_opponent_id: id })
      if (error) throw error
      setH2h(data?.[0] || { wins: 0, losses: 0, matches_played: 0 })
    } catch (error) {
      console.error('Error loading head-to-head:', error)
    } finally {
      setH2hLoading(false)
    }
  }

  const toggleExpanded = async () => {
    if (expanded) {
      setExpanded(false)
      return
    }
    setExpanded(true)
    setMatchesLoading(true)
    try {
      const { data, error } = await supabase.rpc('get_head_to_head_matches', { p_opponent_id: id })
      if (error) throw error
      setH2hMatches(data || [])
    } catch (error) {
      console.error('Error loading match history:', error)
    } finally {
      setMatchesLoading(false)
    }
  }

  const formatMatchDate = (dateString) =>
    new Date(dateString).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' })

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-ink-50 border-t-ink-700"></div>
      </div>
    )
  }

  if (!player) {
    return (
      <EmptyState
        icon={Award}
        title="Não foi possível carregar este perfil"
        subtitle="Pode já não estar disponível."
        action={
          <PrimaryButton variant="navy" onClick={() => navigate('/rankings')}>
            Voltar à classificação
          </PrimaryButton>
        }
      />
    )
  }

  const played = (player.game_wins || 0) + (player.game_losses || 0)
  const winRate = winRatePct(player.game_wins || 0, played)

  const statTiles = [
    { icon: Trophy, value: player.total_points || 0, label: 'Pontos', cls: 'text-lime-600' },
    { icon: Award, value: `${player.mix_wins || 0}/${player.mixes_played || 0}`, label: 'Mixes ganhos', cls: 'text-ink-700' },
    { icon: Target, value: played, label: 'Jogos', cls: 'text-ink-700' },
    { icon: Award, value: `${winRate}%`, label: 'Taxa de vitória', cls: 'text-ok' },
  ]

  return (
    <div className="space-y-4">
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1.5 text-ink-700 font-extrabold text-sm min-h-[44px] pr-3"
      >
        <ArrowLeft size={20} />
        Voltar
      </button>

      {/* Hero */}
      <div className="card bg-ink-900 text-center relative overflow-hidden">
        <svg
          viewBox="0 0 400 160"
          className="absolute inset-0 w-full h-full text-white/[0.05]"
          preserveAspectRatio="xMidYMid slice"
          aria-hidden="true"
        >
          <rect x="60" y="-60" width="280" height="260" rx="16" stroke="currentColor" strokeWidth="3" fill="none" />
          <line x1="200" y1="-60" x2="200" y2="200" stroke="currentColor" strokeWidth="3" />
        </svg>
        <div className="relative py-2">
          <div className="w-20 h-20 mx-auto mb-3">
            <Avatar name={player.name} url={player.avatar_url} size="w-20 h-20 text-3xl" colorClass="bg-lime-400 text-ink-900" />
          </div>
          <h2 className="text-2xl text-white">{player.name}</h2>
          {player.level && (
            <div className="mt-2.5">
              <LevelBadge level={player.level} size="md" />
            </div>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        {statTiles.map(({ icon: Icon, value, label, cls }) => (
          <div key={label} className="card text-center py-5">
            <Icon size={20} className={`mx-auto mb-1.5 ${cls}`} />
            <p className="text-2xl font-extrabold text-ink-900 tabular-nums">{value}</p>
            <p className="text-xs text-muted">{label}</p>
          </div>
        ))}
      </div>

      {/* Confrontos diretos */}
      <div>
        <h3 className="text-lg text-ink-900 mb-3">Confrontos diretos</h3>

        {h2hLoading ? (
          <div className="flex items-center justify-center py-10">
            <div className="animate-spin rounded-full h-8 w-8 border-[3px] border-ink-50 border-t-ink-700"></div>
          </div>
        ) : !h2h || h2h.matches_played === 0 ? (
          <EmptyState
            icon={Swords}
            title="Sem confrontos registados"
            subtitle="Ainda não há jogos com resultado entre ti e este jogador."
          />
        ) : (
          <div className="card p-0 overflow-hidden">
            <button
              onClick={toggleExpanded}
              aria-expanded={expanded}
              className="w-full flex items-center gap-3 px-4 py-3.5 min-h-[56px] transition-colors duration-fast hover:bg-ink-50"
            >
              <Avatar name={player.name} url={player.avatar_url} size="w-9 h-9 text-sm" />
              <p className="flex-1 min-w-0 text-left font-extrabold text-ink-900 truncate">{player.name}</p>
              <span className="text-sm font-extrabold tabular-nums shrink-0">
                <span className="text-ok">{h2h.wins}V</span>
                <span className="text-muted"> – </span>
                <span className="text-danger">{h2h.losses}D</span>
              </span>
              <ChevronDown
                size={20}
                className={`text-muted transition-transform duration-base shrink-0 ${expanded ? 'rotate-180' : ''}`}
              />
            </button>

            {expanded && (
              <div className="border-t border-line divide-y divide-line animate-fade-up">
                {matchesLoading ? (
                  <p className="text-muted text-sm text-center py-4">A carregar…</p>
                ) : (
                  h2hMatches.map(m => (
                    <div key={m.match_id} className="flex items-center gap-3 px-4 py-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-extrabold text-ink-900 text-sm truncate">{m.label}</p>
                        <p className="text-[11px] text-muted">{formatMatchDate(m.match_date)}</p>
                      </div>
                      <span className="text-base font-extrabold tabular-nums shrink-0">
                        {m.player_score}–{m.opponent_score}
                      </span>
                      <span className={`text-[11px] font-extrabold uppercase px-2 py-1 rounded-full shrink-0 ${
                        m.won ? 'bg-ok/10 text-ok' : 'bg-danger/10 text-danger'
                      }`}>
                        {m.won ? 'V' : 'D'}
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
```

Note the "Confrontos diretos" section collapses from a per-opponent list to a single row (this player vs the viewer) — there's only ever one opponent on this page now, so the list-of-opponents UI (`h2h.map(o => ...)`) becomes one static header row that expands to the match list, per the design doc.

- [ ] **Step 2: Manual verification**

Run the dev server (`npm run dev`), sign in, and:
1. Navigate to `/jogador/<your own id>` — confirm stats/points load and match the Profile page's numbers.
2. From Rankings → "Por Clube", tap a player in your club — confirm the page still loads correctly (regression check for the existing working path).

- [ ] **Step 3: Commit**

```bash
git add src/pages/PlayerDetails.jsx
git commit -m "feat: make PlayerDetails.jsx work for any player, not just same-club"
```

---

### Task 4: Re-enable links on Rankings' Global tab

**Files:**
- Modify: `src/pages/Rankings.jsx:431-458`

**Interfaces:**
- Consumes: `/jogador/:id` route (now club-independent per Task 3).

- [ ] **Step 1: Swap the static `<div>` back to `<Link>`**

Replace:

```jsx
          <div className="space-y-3">
            {/* Not a <Link>: the global ranking spans every club, and
                /jogador/:id reads `profiles` under an org-mates-only RLS
                policy — so most rows here would land on "Jogador não
                encontrado". Static card instead of a dead end. */}
            {globalRankings.map((player, index) => (
              <div
                key={player.user_id}
                className={`card block ${index === 0 ? 'ring-2 ring-lime-400' : ''}`}
              >
```

with:

```jsx
          <div className="space-y-3">
            {globalRankings.map((player, index) => (
              <Link
                key={player.user_id}
                to={`/jogador/${player.user_id}`}
                className={`card press block hover:shadow-lift ${index === 0 ? 'ring-2 ring-lime-400' : ''}`}
              >
```

...and close it with `</Link>` instead of `</div>` (matches the pattern already used for the "Por Clube" and "Mensal" tabs a few sections up in the same file).

- [ ] **Step 2: Manual verification**

In the running app: Rankings → "Geral" tab → tap a row for a player in a *different* club than your current one. Confirm it navigates to `/jogador/:id` and shows their aggregated stats (not "Jogador não encontrado").

- [ ] **Step 3: Commit**

```bash
git add src/pages/Rankings.jsx
git commit -m "feat: make Rankings Global tab rows link to the player profile again"
```

---

## Deployment note

Tasks 1-2 only take effect once `supabase/migration_unified_player_profile.sql` is run manually in the Supabase SQL Editor (Project → SQL Editor → New query → paste → Run) — this repo has no automated migration runner, matching every other `supabase/migration_*.sql` file. Do this before (or immediately after) deploying the Task 3-4 frontend changes; until it's run, `PlayerDetails.jsx` will fail with "função get_player_profile não existe" for everyone.
