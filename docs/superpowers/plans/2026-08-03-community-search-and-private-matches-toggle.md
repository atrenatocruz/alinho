# Comunidade search fix + private matches toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the Comunidade tab into `main`, fix its player search (show a
browsable list immediately, give feedback on zero results), and add a
global backoffice toggle that disables creating new "Jogo entre amigos"
(private) matches without touching existing history/ranking data.

**Architecture:** React (Vite, no framework router beyond `react-router-dom`)
+ Supabase (Postgres, RLS, SECURITY DEFINER RPCs). New behavior is additive:
a new `list_players` RPC for browsing, a new `feature_flags` table +
`admin_set_feature_flag` RPC for the toggle, and small conditional-render /
route-guard changes on the frontend. No existing table or RPC is dropped or
renamed.

**Tech Stack:** React 18, react-router-dom, Supabase JS client, Tailwind
(via existing `input-field`/`card`/`btn-primary` utility classes), plain
Postgres SQL (`plpgsql`/`sql` functions, `SECURITY DEFINER`).

## Global Constraints

- No automated test suite exists in this repo (no vitest/jest, no
  `supabase` CLI project link, no service-role key in `.env`). Frontend
  verification is `npm run build` (catches syntax/import errors) plus a
  manual pass in the running dev server. SQL migrations are verified by a
  `SELECT`/`RAISE`-based manual check — **the agent cannot apply SQL to the
  live Supabase project itself** (no DB credentials available); each SQL
  task ends with an explicit "apply this file in Supabase → SQL Editor"
  step for the human operator, matching the existing convention documented
  at the top of `supabase/migration_private_matches_create_rpcs.sql`.
- Follow existing code style exactly: 2-space indent, no semicolons in
  `.jsx`/`.js` (matches every file read during planning), Portuguese
  user-facing copy, Tailwind utility classes matching neighboring
  components (`input-field`, `card`, `btn-primary`, `text-muted`,
  `text-ink-900`).
- New SQL migration files follow the existing one-file-per-change pattern
  (e.g. `migration_fix_membership_level_update.sql`) — never edit an
  already-applied migration file in place.
- Never remove or alter `confirm_private_match`, `get_global_rankings`, or
  any `private_match_stats` row — history and ranking totals must stay
  exactly as they are today, per the design's explicit non-goal.

---

### Task 1: Merge `worktree-bottom-nav-reorganization` into `main`

**Files:** none created/modified directly — this is a git merge of 5
existing commits (`5f05290`..`4915961`) that add
`src/pages/Comunidade.jsx`, nav changes in `src/components/Layout.jsx`,
Rankings tab reordering, and a Clubes placeholder page.

**Interfaces:**
- Produces: `src/pages/Comunidade.jsx` (existing component, wraps
  `PlayerSearch`), the `/comunidade` route registered in `src/App.jsx`, and
  the `Users`-icon nav entry in `src/components/Layout.jsx`. Later tasks
  modify `Comunidade.jsx` and rely on it existing at that exact path.

- [ ] **Step 1: Confirm the branch is still a clean fast-forward**

Run: `git merge-base main worktree-bottom-nav-reorganization`
Expected: prints `f82b15b037a3dc52f9c13fa5b5cd1de4c50c2212` (current `main`
HEAD) — confirms no new commits have landed on `main` since this was
checked during planning. If it prints anything else, stop and re-diff
before merging.

- [ ] **Step 2: Merge**

```bash
git checkout main
git merge --ff-only worktree-bottom-nav-reorganization
```

Expected: fast-forward, no conflicts. If `--ff-only` refuses (non-linear
history), stop — that means `main` moved and the plan's Step 1 check should
have caught it.

- [ ] **Step 3: Verify the build still passes**

Run: `npm run build`
Expected: exits 0, no errors.

- [ ] **Step 4: Verify the route exists**

Run: `npm run dev` (leave running), then open the app in a browser to
`/comunidade`. Expected: page renders with heading "Comunidade" and a
search input labeled "Procurar jogador...". Stop the dev server after
confirming (later tasks restart it).

No separate commit — the merge commit itself is the record.

---

### Task 2: `list_players` RPC + `listPlayers()` wrapper

**Files:**
- Create: `supabase/migration_community_browse_rpc.sql`
- Modify: `src/lib/privateMatches.js`

**Interfaces:**
- Consumes: `profiles` table (`id`, `name`, `avatar_url`, `created_at`),
  `memberships` table (`user_id`, `is_test`) — same shape `search_players`
  already reads in `supabase/migration_private_matches_create_rpcs.sql`.
- Produces: Postgres RPC `list_players(p_limit INTEGER DEFAULT 20)` →
  `TABLE (id UUID, name TEXT, avatar_url TEXT)`, and a JS function
  `listPlayers(limit = 20)` in `src/lib/privateMatches.js` returning
  `Promise<Array<{id, name, avatar_url}>>`. Task 3 imports `listPlayers`
  from this file.

- [ ] **Step 1: Write the migration file**

Create `supabase/migration_community_browse_rpc.sql`:

```sql
-- ════════════════════════════════════════════════════════════════════════
-- Migration: list_players RPC for the Comunidade "browse" list
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

-- Cross-org player listing for the Comunidade tab's default (no-query)
-- view. Same visibility rules as search_players (SECURITY DEFINER,
-- bypasses org-restricted `profiles` RLS on purpose, excludes synthetic
-- test accounts via memberships.is_test) but with no query string —
-- just the most recently joined players, for a page that should never be
-- empty on load.
CREATE OR REPLACE FUNCTION list_players(p_limit INTEGER DEFAULT 20)
RETURNS TABLE (id UUID, name TEXT, avatar_url TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.name, p.avatar_url
  FROM profiles p
  WHERE p.id <> auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM memberships m WHERE m.user_id = p.id AND m.is_test = true
    )
  ORDER BY p.created_at DESC
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION list_players(INTEGER) FROM public;
GRANT EXECUTE ON FUNCTION list_players(INTEGER) TO authenticated;
```

- [ ] **Step 2: Apply the migration**

In the Supabase dashboard: SQL Editor → New query → paste the full file
contents → Run. Expected: "Success. No rows returned."

- [ ] **Step 3: Verify manually**

In the same SQL Editor, run: `SELECT * FROM list_players(5);`
Expected: up to 5 rows of `id, name, avatar_url`, ordered newest-first,
none matching your own logged-in user id (if run via `SET request.jwt.claims`
in a test session) — or simplest, just confirm it returns rows and doesn't
error when run as a superuser (RLS bypass via SECURITY DEFINER means
`auth.uid()` may be null here — a null comparison in `<>` just means the
`id <> auth.uid()` filter is inert for this manual superuser check, which
is fine; the real exclusion is verified from the browser in Task 3).

- [ ] **Step 4: Add the JS wrapper**

In `src/lib/privateMatches.js`, add below the existing `searchPlayers`
export:

```js
export const listPlayers = async (limit = 20) => {
  const { data, error } = await supabase.rpc('list_players', { p_limit: limit })
  if (error) throw error
  return data || []
}
```

- [ ] **Step 5: Verify the build**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add supabase/migration_community_browse_rpc.sql src/lib/privateMatches.js
git commit -m "feat: add list_players RPC for Comunidade browse view"
```

---

### Task 3: `PlayerSearch` browse-by-default + empty state

**Files:**
- Modify: `src/components/PlayerSearch.jsx`
- Modify: `src/pages/Comunidade.jsx`

**Interfaces:**
- Consumes: `listPlayers` from `src/lib/privateMatches.js` (Task 2).
- Produces: `PlayerSearch` gains a new optional prop `browseByDefault`
  (boolean, default `false`). No existing prop (`label`, `selected`,
  `onSelect`, `onClear`, `excludeIds`) changes shape — `CreatePrivateMatch.jsx`
  (which doesn't pass `browseByDefault`) keeps its current behavior
  unchanged.

- [ ] **Step 1: Rewrite `PlayerSearch.jsx`**

Replace the full contents of `src/components/PlayerSearch.jsx` with:

```jsx
import { useState, useEffect, useRef } from 'react'
import { Search, X } from 'lucide-react'
import { searchPlayers, listPlayers } from '../lib/privateMatches'
import { Avatar } from './ui'

export default function PlayerSearch({ label, selected, onSelect, onClear, excludeIds = [], browseByDefault = false }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const timeoutRef = useRef(null)

  // Loads the default browse list once on mount (Comunidade only — pages
  // that don't pass browseByDefault keep the old "empty until you type"
  // behavior, e.g. opponent search in CreatePrivateMatch).
  useEffect(() => {
    if (!browseByDefault) return
    let cancelled = false
    listPlayers().then((data) => {
      if (!cancelled) {
        setResults(data)
        setOpen(true)
      }
    }).catch((error) => {
      console.error('Error loading players:', error)
    })
    return () => { cancelled = true }
  }, [browseByDefault])

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)

    const trimmed = query.trim()

    if (trimmed.length === 0) {
      // Leave the mount effect's browse list on screen instead of wiping
      // it the instant this effect re-runs for the empty initial query.
      if (!browseByDefault) setResults([])
      return
    }

    if (trimmed.length < 2) {
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
  }, [query, browseByDefault])

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

  const isSearching = query.trim().length >= 2
  const visibleResults = results.filter((p) => !excludeIds.includes(p.id))
  const showEmptyState = open && isSearching && visibleResults.length === 0

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
      {open && (visibleResults.length > 0 || showEmptyState) && (
        <div className="absolute z-10 mt-1 w-full bg-surface rounded-ctrl border border-line shadow-lift divide-y divide-line max-h-64 overflow-y-auto">
          {showEmptyState ? (
            <p className="p-3 text-sm text-muted text-center">Nenhum jogador encontrado</p>
          ) : (
            visibleResults.map((player) => (
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
            ))
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Pass `browseByDefault` from Comunidade**

In `src/pages/Comunidade.jsx`, add the prop to the existing `PlayerSearch`
element:

```jsx
      <PlayerSearch
        label="Procurar jogador..."
        selected={null}
        onSelect={(player) => navigate(`/jogador/${player.id}`)}
        onClear={() => {}}
        browseByDefault
      />
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 4: Manual browser verification**

Run: `npm run dev`, open `/comunidade`.
Expected:
  - A list of players appears immediately, with no typing required.
  - Typing 1 character shows no list (unchanged threshold).
  - Typing ≥2 characters that match nobody shows "Nenhum jogador
    encontrado" instead of nothing.
  - Typing ≥2 characters that match someone shows their result, and
    clicking it navigates to `/jogador/:id`.
  - Open `/jogos-privados/novo` and confirm opponent search there still
    behaves exactly as before (empty until 2+ characters typed, no browse
    list) — this confirms `browseByDefault` didn't leak into that usage.

- [ ] **Step 5: Commit**

```bash
git add src/components/PlayerSearch.jsx src/pages/Comunidade.jsx
git commit -m "fix: show browsable player list and empty state in Comunidade search"
```

---

### Task 4: `feature_flags` table + `admin_set_feature_flag` RPC

**Files:**
- Create: `supabase/migration_feature_flags.sql`

**Interfaces:**
- Produces: table `feature_flags(key TEXT PRIMARY KEY, enabled BOOLEAN,
  updated_at TIMESTAMPTZ, updated_by UUID)`, seeded with one row
  `('private_matches', true)`; RLS policy allowing `SELECT` to any
  authenticated user; RPC `admin_set_feature_flag(p_key TEXT, p_enabled
  BOOLEAN) RETURNS void`. Task 5 reads the table directly via the
  Supabase JS client; Task 8 calls the RPC.

- [ ] **Step 1: Write the migration file**

Create `supabase/migration_feature_flags.sql`:

```sql
-- ════════════════════════════════════════════════════════════════════════
-- Migration: app-wide feature flags (starts with private_matches toggle)
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE feature_flags (
  key TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES profiles(id)
);

INSERT INTO feature_flags (key, enabled) VALUES ('private_matches', true);

ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;

-- Not sensitive data — any authenticated user can read every flag, so the
-- frontend can gate UI/routes for every signed-in user, not just admins.
CREATE POLICY "feature_flags_select_authenticated" ON feature_flags
  FOR SELECT TO authenticated USING (true);

-- Global toggle, not org-scoped — private matches are explicitly
-- org-independent (see supabase/migration_private_matches.sql). Any admin
-- of any club may flip it: there is no platform-admin role in this app,
-- and this reuses the same trust level org admins already have elsewhere
-- (see admin_set_membership_admin in supabase/schema.sql).
CREATE OR REPLACE FUNCTION admin_set_feature_flag(p_key TEXT, p_enabled BOOLEAN)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM memberships WHERE user_id = auth.uid() AND is_admin) THEN
    RAISE EXCEPTION 'Apenas admins podem alterar funcionalidades da app';
  END IF;

  UPDATE feature_flags
  SET enabled = p_enabled, updated_at = now(), updated_by = auth.uid()
  WHERE key = p_key;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Funcionalidade desconhecida: %', p_key;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION admin_set_feature_flag(TEXT, BOOLEAN) FROM public;
GRANT EXECUTE ON FUNCTION admin_set_feature_flag(TEXT, BOOLEAN) TO authenticated;
```

- [ ] **Step 2: Apply the migration**

In the Supabase dashboard: SQL Editor → New query → paste the full file
contents → Run. Expected: "Success. No rows returned."

- [ ] **Step 3: Verify manually**

Run: `SELECT * FROM feature_flags;`
Expected: one row, `key = 'private_matches'`, `enabled = true`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migration_feature_flags.sql
git commit -m "feat: add feature_flags table and admin_set_feature_flag RPC"
```

---

### Task 5: `AuthContext` loads the flag

**Files:**
- Modify: `src/contexts/AuthContext.jsx`

**Interfaces:**
- Consumes: `feature_flags` table (Task 4) via `supabase.from('feature_flags')`.
- Produces: `useAuth()` context value gains `isPrivateMatchesEnabled`
  (boolean, defaults `true` until the first load resolves) and
  `refreshFeatureFlags` (`() => Promise<void>`). Task 6 reads
  `isPrivateMatchesEnabled`; Task 8 calls `refreshFeatureFlags` after
  toggling.

- [ ] **Step 1: Add state and the loader function**

In `src/contexts/AuthContext.jsx`, add a new state variable next to the
existing ones (after `const [loading, setLoading] = useState(true)`):

```js
  const [isPrivateMatchesEnabled, setIsPrivateMatchesEnabled] = useState(true)
```

Add a loader function near `loadProfile` (same component body):

```js
  const loadFeatureFlags = async () => {
    const { data, error } = await supabase.from('feature_flags').select('key, enabled')
    if (error) {
      console.error('Error loading feature flags:', error)
      return
    }
    const privateMatchesFlag = data?.find((f) => f.key === 'private_matches')
    setIsPrivateMatchesEnabled(privateMatchesFlag?.enabled ?? true)
  }
```

- [ ] **Step 2: Call it wherever a session is established**

Inside `loadProfile`, right after `await consumePendingOrgSlug()`, add:

```js
      await loadFeatureFlags()
```

Inside `signInAsAdmin` (the dev bypass), the flag state can stay at its
default `true` — no call needed there since that path never touches
Supabase.

- [ ] **Step 3: Expose both in the context value**

In the `value = { ... }` object at the bottom of `AuthProvider`, add:

```js
    isPrivateMatchesEnabled,
    refreshFeatureFlags: loadFeatureFlags,
```

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 5: Manual verification**

Run: `npm run dev`, sign in, open the browser console, and check
`window.__REACT_DEVTOOLS_GLOBAL_HOOK__` isn't needed — simplest check: this
will be confirmed indirectly in Task 6's manual step (the Home card
visibility depends on this value loading correctly), so just confirm no
console errors appear on login.

- [ ] **Step 6: Commit**

```bash
git add src/contexts/AuthContext.jsx
git commit -m "feat: load private_matches feature flag in AuthContext"
```

---

### Task 6: Gate the UI on the flag

**Files:**
- Modify: `src/pages/Home.jsx`
- Modify: `src/App.jsx`

**Interfaces:**
- Consumes: `isPrivateMatchesEnabled` from `useAuth()` (Task 5).
- Produces: `Home.jsx` no longer renders the "Jogo entre amigos" card when
  the flag is off; a new `PrivateMatchesRoute` guard component in `App.jsx`
  redirects `/jogos-privados`, `/jogos-privados/novo`, and
  `/jogos-privados/:id/entrar` to `/` when the flag is off.

- [ ] **Step 1: Gate the Home card**

In `src/pages/Home.jsx`, find the destructured values from `useAuth()` at
the top of the component and add `isPrivateMatchesEnabled` to that list.
Then wrap the existing card (around line 169-177):

```jsx
      {isPrivateMatchesEnabled && (
        <Link to="/jogos-privados" className="card press flex items-center gap-3 hover:shadow-lift">
          <div className="w-10 h-10 rounded-ctrl bg-lime-400/15 text-lime-600 flex items-center justify-center shrink-0">
            <Users size={18} />
          </div>
          <div>
            <p className="font-extrabold text-ink-900 text-sm">Jogo entre amigos</p>
            <p className="text-[11px] text-muted">Regista um 2x2 fora do clube</p>
          </div>
        </Link>
      )}
```

- [ ] **Step 2: Add the route guard in `App.jsx`**

In `src/App.jsx`, add a new guard component next to `MemberRoute` and
`AdminRoute`:

```jsx
// Redirects to Home when the private-matches feature flag is off — covers
// direct navigation/bookmarks to a card that's already hidden on Home.
const PrivateMatchesRoute = ({ children }) => {
  const { isPrivateMatchesEnabled } = useAuth()

  if (!isPrivateMatchesEnabled) {
    return <Navigate to="/" />
  }

  return children
}
```

Then wrap the three private-matches routes' children with it, nested
inside the existing `ProtectedRoute` (auth check still runs first):

```jsx
      <Route
        path="/jogos-privados"
        element={
          <ProtectedRoute showSplash={showSplash}>
            <PrivateMatchesRoute>
              <Layout>
                <PrivateMatches />
              </Layout>
            </PrivateMatchesRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/jogos-privados/novo"
        element={
          <ProtectedRoute showSplash={showSplash}>
            <PrivateMatchesRoute>
              <Layout>
                <CreatePrivateMatch />
              </Layout>
            </PrivateMatchesRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/jogos-privados/:id/entrar"
        element={
          <ProtectedRoute showSplash={showSplash}>
            <PrivateMatchesRoute>
              <Layout>
                <JoinPrivateMatch />
              </Layout>
            </PrivateMatchesRoute>
          </ProtectedRoute>
        }
      />
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 4: Manual verification (flag still `true` at this point)**

Run: `npm run dev`. Confirm the "Jogo entre amigos" card still shows on
Home, and `/jogos-privados` still loads normally — no behavior change yet,
since the DB flag is still `true` (Task 8 is what lets you actually flip
it). This step just confirms the new conditionals don't break the default
case.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Home.jsx src/App.jsx
git commit -m "feat: hide and block private matches when feature flag is off"
```

---

### Task 7: Server-side guard on match creation

**Files:**
- Create: `supabase/migration_private_matches_flag_guard.sql`

**Interfaces:**
- Consumes: `feature_flags` table (Task 4).
- Produces: `CREATE OR REPLACE` of `create_private_match(UUID, UUID, UUID)`
  and `claim_private_match_slot(UUID, TEXT)` — same signatures and return
  types as originally defined in
  `supabase/migration_private_matches_create_rpcs.sql`, now with a leading
  flag check. No other function changes.

- [ ] **Step 1: Write the migration file**

Create `supabase/migration_private_matches_flag_guard.sql`:

```sql
-- ════════════════════════════════════════════════════════════════════════
-- Migration: enforce the private_matches feature flag inside the RPCs
-- themselves (defense in depth — the frontend already hides/blocks this,
-- this stops direct RPC calls too). Run this whole file in Supabase →
-- SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

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
  IF NOT (SELECT enabled FROM feature_flags WHERE key = 'private_matches') THEN
    RAISE EXCEPTION 'Jogo entre amigos está temporariamente desativado';
  END IF;

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

CREATE OR REPLACE FUNCTION claim_private_match_slot(p_match_id UUID, p_slot TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match private_matches;
BEGIN
  IF NOT (SELECT enabled FROM feature_flags WHERE key = 'private_matches') THEN
    RAISE EXCEPTION 'Jogo entre amigos está temporariamente desativado';
  END IF;

  IF p_slot IS NULL OR p_slot NOT IN ('team_a_player2', 'team_b_player1', 'team_b_player2') THEN
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
```

- [ ] **Step 2: Apply the migration**

In the Supabase dashboard: SQL Editor → New query → paste the full file
contents → Run. Expected: "Success. No rows returned."

- [ ] **Step 3: Verify manually**

Run: `SELECT enabled FROM feature_flags WHERE key = 'private_matches';`
(should still be `true` at this point). Then, as a signed-in test user in
the app (or via `supabase.rpc('create_private_match', {})` in the browser
console while logged in), confirm match creation still succeeds — the
guard should be a no-op while the flag is `true`. Full negative-path
verification (flag `false` → creation blocked) happens in Task 9, after
the toggle UI exists.

- [ ] **Step 4: Commit**

```bash
git add supabase/migration_private_matches_flag_guard.sql
git commit -m "feat: enforce private_matches flag server-side in match creation RPCs"
```

---

### Task 8: Backoffice toggle UI

**Files:**
- Modify: `src/pages/Admin.jsx`

**Interfaces:**
- Consumes: `isPrivateMatchesEnabled` and `refreshFeatureFlags` from
  `useAuth()` (Task 5); RPC `admin_set_feature_flag` (Task 4).
- Produces: a new "Funcionalidades da app" section in the Settings tab,
  independently saved (no interaction with the existing
  `handleUpdateSettings` form).

- [ ] **Step 1: Read the flag and add a toggle handler**

In `src/pages/Admin.jsx`, add to the existing `useAuth()` destructure at
the top of the component (currently `const { profile: currentUser,
currentOrganizationId } = useAuth()`):

```jsx
  const { profile: currentUser, currentOrganizationId, isPrivateMatchesEnabled, refreshFeatureFlags } = useAuth()
```

Add a new state and handler near `handleUpdateSettings`:

```jsx
  const [savingFlag, setSavingFlag] = useState(false)

  const handleTogglePrivateMatches = async () => {
    setSavingFlag(true)
    try {
      const { error } = await supabase.rpc('admin_set_feature_flag', {
        p_key: 'private_matches',
        p_enabled: !isPrivateMatchesEnabled,
      })
      if (error) throw error
      await refreshFeatureFlags()
    } catch (error) {
      console.error('Error toggling private matches flag:', error)
      alert('Erro ao atualizar funcionalidade: ' + error.message)
    } finally {
      setSavingFlag(false)
    }
  }
```

- [ ] **Step 2: Add the UI block**

In the Settings tab JSX, insert a new `card` block right before the
existing `{/* Settings Tab */}` form's closing, i.e. right after the
`</form>` and before the settings tab's closing `)}` (around line 765-767):

```jsx
              </form>

              <div className="mt-6 pt-6 border-t border-gray-200">
                <h4 className="text-base font-semibold text-ink-900 mb-1">
                  Funcionalidades da app
                </h4>
                <p className="text-sm text-gray-500 mb-4">
                  Afeta todos os clubes — não é específico deste grupo.
                </p>
                <label className="flex items-center justify-between gap-4 p-3 rounded-ctrl border border-line">
                  <div>
                    <p className="font-extrabold text-ink-900 text-sm">Jogo entre amigos</p>
                    <p className="text-[11px] text-muted">Permite criar jogos 2x2 fora do clube</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={isPrivateMatchesEnabled}
                    disabled={savingFlag}
                    onChange={handleTogglePrivateMatches}
                    className="w-5 h-5 shrink-0"
                  />
                </label>
              </div>
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Admin.jsx
git commit -m "feat: add private matches toggle to Admin settings"
```

---

### Task 9: End-to-end manual verification

**Files:** none (verification only).

**Interfaces:** none produced — this task exercises everything built in
Tasks 1-8 together.

- [ ] **Step 1: Start the app**

Run: `npm run dev`, sign in as an org admin.

- [ ] **Step 2: Verify Comunidade**

Open `/comunidade`. Confirm a player list appears immediately with no
typing, search for a known name returns it, search for gibberish shows
"Nenhum jogador encontrado", and clicking a result navigates to their
profile.

- [ ] **Step 3: Verify the toggle turns the feature off**

Open `/admin`, Settings tab. Confirm the "Jogo entre amigos" switch is on.
Turn it off. Confirm: the switch reflects the new state without a page
reload; navigating to `/` no longer shows the "Jogo entre amigos" card;
manually navigating to `/jogos-privados` redirects to `/`.

- [ ] **Step 4: Verify history stays intact while off**

While still off, open a profile (`/jogador/:id`) or `/perfil` for a user
with existing private-match history. Confirm past private-match stats and
points still display exactly as before — nothing about history rendering
changed in this plan.

- [ ] **Step 5: Verify the toggle turns the feature back on**

Turn the switch back on in `/admin`. Confirm the Home card reappears and
`/jogos-privados` loads normally again.

- [ ] **Step 6: Final full build check**

Run: `npm run build`
Expected: exits 0, no warnings introduced by this plan's changes.

No commit for this task — it's verification only. If any step fails,
return to the relevant earlier task and fix before considering the plan
done.
