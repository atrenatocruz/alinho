# Multi-tenant player/backoffice split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split club management into a same-origin `/gerir` backoffice, make a player's Home/Rankings/Comunidade aggregate across every club they belong to, and add an opt-in public directory ("Clubes & Grupos") with follow/join-request flows for clubs that choose to be discoverable.

**Architecture:** One new SQL migration adds `organizations.is_global`/`open_join`, a `membership_requests` table, widens `profiles`/`player_stats`/`mix_player_stats` RLS, and patches three existing cross-org RPCs (`search_players`, `list_players`, `get_global_rankings`) that were bypassing org privacy entirely. On the frontend, `Home.jsx` switches from a single "current organization" query to querying across all of a player's memberships; a new `Clubes.jsx` directory lets players discover and follow public clubs; today's `/admin` page is copied to a new `/gerir/:slug` route (parameterized by the URL slug instead of the app-wide "current organization") with a new join-request approval queue and `is_global`/`open_join` settings toggles; a new `/gerir` route picks between clubs an admin manages. No new infrastructure — everything stays on one origin, avoiding the PWA-install fragmentation a `<slug>.alinho.pt` subdomain would have caused.

**Tech Stack:** React (Vite SPA), React Router, Supabase (Postgres + RLS + RPCs), Tailwind (existing design tokens only, no new CSS).

## Global Constraints

- No automated test framework exists in this project (frontend or SQL) — every task's verification step is manual: run the dev server and check the UI, or run SQL directly in the Supabase SQL Editor. This matches the project's existing convention (see every `supabase/migration_*.sql` file's header comment).
- All new SQL goes in one new file, `supabase/migration_global_directory_and_gerir.sql`, run manually via Supabase → SQL Editor → New query → Run (never applied automatically) — same convention as every existing migration file.
- `supabase/schema.sql` is NOT updated by this plan. Its header claims it's "kept in sync manually," but in practice several recent features (private matches tables, `feature_flags`, `memberships.is_test`, `search_players`/`list_players`) were never backported into it — updating it now would be inconsistent with actual recent precedent and is out of scope.
- Every new RPC follows the existing pattern exactly: `SECURITY DEFINER SET search_path = public`, then `REVOKE EXECUTE ... FROM anon, public; GRANT EXECUTE ... TO authenticated;`. Any RLS check that queries `memberships` from inside another table's own policy must go through a `SECURITY DEFINER` helper function (reuse `is_org_admin`/`shares_org_with` where possible) — a direct inline subquery causes infinite recursion (Postgres 42P17), per `supabase/migration_fix_membership_recursion.sql`.
- All new user-facing copy is European Portuguese, matching the rest of the app. `RAISE EXCEPTION` messages are Portuguese too, matching every existing RPC.
- Frontend styling uses only existing Tailwind utility classes and design tokens already used elsewhere in the file being edited (`card`, `btn-primary`, `input-field`, the `ink-*`/`lime-*` color scale, etc.) — no new CSS, no new design-system components beyond what's specified in each task.

---

## Task 1: Database migration — global directory, join requests, RLS/RPC privacy fixes

**Files:**
- Create: `supabase/migration_global_directory_and_gerir.sql`

**Interfaces:**
- Produces (new RPCs, callable via `supabase.rpc(name, args)` from the frontend):
  - `follow_organization(p_organization_id UUID) RETURNS TEXT` — returns `'joined'` or `'pending'`.
  - `approve_membership_request(p_request_id UUID) RETURNS void`
  - `reject_membership_request(p_request_id UUID) RETURNS void`
  - `leave_organization(p_organization_id UUID) RETURNS void`
  - `list_global_organizations() RETURNS TABLE (id UUID, name TEXT, slug TEXT, group_logo_url TEXT, open_join BOOLEAN, member_count BIGINT, my_status TEXT)` — `my_status` is `'member' | 'pending' | 'none'`.
- Produces (schema): `organizations.is_global BOOLEAN`, `organizations.open_join BOOLEAN`, table `membership_requests(id, user_id, organization_id, status, created_at, resolved_at, resolved_by)`.

- [ ] **Step 1: Write the full migration file**

```sql
-- ════════════════════════════════════════════════════════════════════════
-- Migration: global club directory (Clubes & Grupos) + backoffice join
-- requests. See docs/superpowers/specs/2026-08-17-multi-tenant-player-
-- backoffice-split-design.md for the full design.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. organizations: opt-in public discovery ────────────────────────────
ALTER TABLE organizations ADD COLUMN is_global BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE organizations ADD COLUMN open_join BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 2. membership_requests: pending "Follow" on a restricted global club ─
CREATE TABLE membership_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES profiles(id)
);

-- Only one PENDING request per (user, org) — a rejected request can be
-- re-submitted later (that row keeps status='rejected' as history, and a
-- fresh row is inserted), which a plain UNIQUE(user_id, organization_id)
-- would have blocked forever.
CREATE UNIQUE INDEX membership_requests_pending_key
  ON membership_requests(user_id, organization_id) WHERE (status = 'pending');

ALTER TABLE membership_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "See own membership requests"
  ON membership_requests FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Org admins see requests for their org"
  ON membership_requests FOR SELECT
  USING (is_org_admin(organization_id));

-- No direct-INSERT policy on purpose: every insert goes through
-- follow_organization() below (SECURITY DEFINER), which is what enforces
-- "only for an is_global org" and picks the open_join vs. request branch.
-- A raw client-side .insert() is correctly blocked by RLS with no policy
-- covering it.

CREATE POLICY "Org admins resolve requests for their org"
  ON membership_requests FOR UPDATE
  USING (is_org_admin(organization_id));

-- ── 3. Widen profiles / player_stats / mix_player_stats visibility to
--       "shares an org with you" OR "the row's org is is_global" ─────────
CREATE OR REPLACE FUNCTION in_global_org(p_profile_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships m
    JOIN organizations o ON o.id = m.organization_id
    WHERE m.user_id = p_profile_id AND o.is_global = TRUE
  );
$$;

REVOKE ALL ON FUNCTION in_global_org(UUID) FROM public;
GRANT EXECUTE ON FUNCTION in_global_org(UUID) TO authenticated;

DROP POLICY IF EXISTS "See own profile or profiles of org-mates" ON profiles;
CREATE POLICY "See own profile, org-mates, or global-org members"
  ON profiles FOR SELECT
  USING (
    id = auth.uid()
    OR shares_org_with(id)
    OR in_global_org(id)
  );

DROP POLICY IF EXISTS "Org members can view player stats" ON player_stats;
CREATE POLICY "Org members or anyone can view player stats of a global org"
  ON player_stats FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM memberships
      WHERE memberships.organization_id = player_stats.organization_id AND memberships.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM organizations o
      WHERE o.id = player_stats.organization_id AND o.is_global = TRUE
    )
  );

DROP POLICY IF EXISTS "Org members can view mix player stats" ON mix_player_stats;
CREATE POLICY "Org members or anyone can view mix player stats of a global org"
  ON mix_player_stats FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM memberships
      WHERE memberships.organization_id = mix_player_stats.organization_id AND memberships.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM organizations o
      WHERE o.id = mix_player_stats.organization_id AND o.is_global = TRUE
    )
  );

-- ── 4. Follow / approve / reject / leave ──────────────────────────────────
-- Single entrypoint for the "Follow" button — the frontend never needs to
-- know whether the club is open_join or restricted, it just calls this and
-- reacts to 'joined' vs 'pending'. Idempotent on every branch.
CREATE OR REPLACE FUNCTION follow_organization(p_organization_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_is_global BOOLEAN;
  v_open_join BOOLEAN;
BEGIN
  SELECT is_global, open_join INTO v_is_global, v_open_join
  FROM organizations WHERE id = p_organization_id;

  IF v_is_global IS NULL THEN
    RAISE EXCEPTION 'Clube não encontrado';
  END IF;
  IF NOT v_is_global THEN
    RAISE EXCEPTION 'Este clube não é público';
  END IF;

  IF EXISTS (
    SELECT 1 FROM memberships WHERE user_id = auth.uid() AND organization_id = p_organization_id
  ) THEN
    RETURN 'joined';
  END IF;

  IF v_open_join THEN
    INSERT INTO memberships (user_id, organization_id)
    VALUES (auth.uid(), p_organization_id)
    ON CONFLICT (user_id, organization_id) DO NOTHING;
    RETURN 'joined';
  END IF;

  INSERT INTO membership_requests (user_id, organization_id)
  VALUES (auth.uid(), p_organization_id)
  ON CONFLICT (user_id, organization_id) WHERE (status = 'pending') DO NOTHING;
  RETURN 'pending';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION follow_organization(UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION follow_organization(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION approve_membership_request(p_request_id UUID)
RETURNS void AS $$
DECLARE
  v_org_id UUID;
  v_user_id UUID;
BEGIN
  SELECT organization_id, user_id INTO v_org_id, v_user_id
  FROM membership_requests WHERE id = p_request_id AND status = 'pending';

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Pedido não encontrado ou já resolvido';
  END IF;
  IF NOT is_org_admin(v_org_id) THEN
    RAISE EXCEPTION 'Apenas admins podem aprovar pedidos';
  END IF;

  INSERT INTO memberships (user_id, organization_id)
  VALUES (v_user_id, v_org_id)
  ON CONFLICT (user_id, organization_id) DO NOTHING;

  UPDATE membership_requests
  SET status = 'approved', resolved_at = NOW(), resolved_by = auth.uid()
  WHERE id = p_request_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION approve_membership_request(UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION approve_membership_request(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION reject_membership_request(p_request_id UUID)
RETURNS void AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT organization_id INTO v_org_id
  FROM membership_requests WHERE id = p_request_id AND status = 'pending';

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Pedido não encontrado ou já resolvido';
  END IF;
  IF NOT is_org_admin(v_org_id) THEN
    RAISE EXCEPTION 'Apenas admins podem rejeitar pedidos';
  END IF;

  UPDATE membership_requests
  SET status = 'rejected', resolved_at = NOW(), resolved_by = auth.uid()
  WHERE id = p_request_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION reject_membership_request(UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION reject_membership_request(UUID) TO authenticated;

-- Self-service unfollow/leave. Blocked if the caller is that org's last
-- admin — an orphaned, unmanageable club is worse than a blocked click.
CREATE OR REPLACE FUNCTION leave_organization(p_organization_id UUID)
RETURNS void AS $$
BEGIN
  IF (
    SELECT is_admin FROM memberships
    WHERE user_id = auth.uid() AND organization_id = p_organization_id
  ) AND (
    SELECT COUNT(*) FROM memberships
    WHERE organization_id = p_organization_id AND is_admin = TRUE
  ) <= 1 THEN
    RAISE EXCEPTION 'És o único admin deste clube — torna outra pessoa admin antes de saíres';
  END IF;

  DELETE FROM memberships WHERE user_id = auth.uid() AND organization_id = p_organization_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION leave_organization(UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION leave_organization(UUID) TO authenticated;

-- ── 5. Directory listing — "organizations" SELECT RLS is membership-only,
--       so a non-member browsing the directory needs a SECURITY DEFINER
--       read, same shape as search_players/list_players below. ──────────
CREATE OR REPLACE FUNCTION list_global_organizations()
RETURNS TABLE (
  id UUID,
  name TEXT,
  slug TEXT,
  group_logo_url TEXT,
  open_join BOOLEAN,
  member_count BIGINT,
  my_status TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    o.id, o.name, o.slug, o.group_logo_url, o.open_join,
    (SELECT COUNT(*) FROM memberships m WHERE m.organization_id = o.id),
    CASE
      WHEN EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = o.id AND m.user_id = auth.uid()) THEN 'member'
      WHEN EXISTS (SELECT 1 FROM membership_requests r WHERE r.organization_id = o.id AND r.user_id = auth.uid() AND r.status = 'pending') THEN 'pending'
      ELSE 'none'
    END
  FROM organizations o
  WHERE o.is_global = TRUE
  ORDER BY o.name;
$$;

REVOKE ALL ON FUNCTION list_global_organizations() FROM public;
GRANT EXECUTE ON FUNCTION list_global_organizations() TO authenticated;

-- ── 6. Patch existing cross-org RPCs to respect is_global ─────────────────
-- These were SECURITY DEFINER with NO org filter at all — any signed-in
-- player could already find any other real player by name, and any
-- club's points already counted toward the "Geral" ranking tab, regardless
-- of that club's privacy. This closes that gap using the same rule as the
-- RLS change above.
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
    AND NOT EXISTS (
      SELECT 1 FROM memberships m WHERE m.user_id = p.id AND m.is_test = true
    )
    AND (shares_org_with(p.id) OR in_global_org(p.id))
  ORDER BY p.name
  LIMIT 10;
$$;

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
    AND (shares_org_with(p.id) OR in_global_org(p.id))
  ORDER BY p.created_at DESC
  LIMIT p_limit;
$$;

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
    JOIN organizations o ON o.id = ps.organization_id
    WHERE o.is_global = TRUE
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

REVOKE ALL ON FUNCTION search_players(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION search_players(TEXT) TO authenticated;
REVOKE ALL ON FUNCTION list_players(INTEGER) FROM public;
GRANT EXECUTE ON FUNCTION list_players(INTEGER) TO authenticated;
REVOKE ALL ON FUNCTION get_global_rankings() FROM public;
GRANT EXECUTE ON FUNCTION get_global_rankings() TO authenticated;
```

- [ ] **Step 2: Run the migration**

In the Supabase dashboard: SQL Editor → New query → paste the entire file → Run. Confirm it completes with no errors.

- [ ] **Step 3: Verify with manual SQL checks**

Run each of these in the SQL Editor (adjust UUIDs to real test rows you create first — e.g. two organizations, one `is_global=true, open_join=true` and one `is_global=true, open_join=false`, and a second test user):

```sql
-- A) is_global/open_join columns exist and default correctly
SELECT slug, is_global, open_join FROM organizations;

-- B) follow_organization on an open club returns 'joined' and inserts a membership
SELECT follow_organization('<open-club-org-id>');
SELECT * FROM memberships WHERE organization_id = '<open-club-org-id>';

-- C) follow_organization on a restricted club returns 'pending', no membership row
SELECT follow_organization('<restricted-club-org-id>');
SELECT * FROM membership_requests WHERE organization_id = '<restricted-club-org-id>';

-- D) calling it again is a no-op, not an error
SELECT follow_organization('<restricted-club-org-id>');

-- E) list_global_organizations only returns is_global=true orgs, with correct my_status
SELECT * FROM list_global_organizations();
```

Confirm each result matches the expectation described in the comment above it.

- [ ] **Step 4: Commit**

```bash
git add supabase/migration_global_directory_and_gerir.sql
git commit -m "feat: add global club directory, join requests, and privacy fixes to cross-org RPCs"
```

---

## Task 2: AuthContext — admin-of-any helper, follow/leave organization

**Files:**
- Modify: `src/contexts/AuthContext.jsx:284-322`

**Interfaces:**
- Consumes: `follow_organization`, `leave_organization` RPCs (Task 1).
- Produces: `useAuth()` gains `adminOrganizations` (array of `{id, name, slug, group_logo_url, ...}`), `isAdminOfAny` (boolean), `followOrganization(organizationId) -> {data, error}`, `leaveOrganization(organizationId) -> {error}`.

- [ ] **Step 1: Add the two new functions**

In `src/contexts/AuthContext.jsx`, right after the existing `joinOrganization` function (ends at line 293 with `return { data, error }` / `}`), insert:

```js
  // Follows (joins immediately, or requests to join) a public "is_global"
  // organization from the Clubes & Grupos directory — mirrors
  // follow_organization()'s own 'joined' | 'pending' return value so the
  // caller can update its button state without a second round trip.
  const followOrganization = async (organizationId) => {
    const { data, error } = await supabase.rpc('follow_organization', { p_organization_id: organizationId })
    if (!error && data === 'joined' && user) {
      await loadProfile(user.id)
    }
    return { data, error }
  }

  // Leaves a club the caller currently belongs to. Blocked server-side if
  // the caller is that org's last admin.
  const leaveOrganization = async (organizationId) => {
    const { error } = await supabase.rpc('leave_organization', { p_organization_id: organizationId })
    if (!error && user) {
      await loadProfile(user.id)
    }
    return { error }
  }
```

- [ ] **Step 2: Expose the new values from the context**

In the same file, find the `value` object (currently starting `const value = {` around line 301) and the line `currentMembership,` (line 307). Add these two lines right after `currentMembership,`:

```js
    adminOrganizations: memberships.filter((m) => m.is_admin).map((m) => m.organization),
    isAdminOfAny: memberships.some((m) => m.is_admin),
```

Then find `joinOrganization,` (line 320) and add right after it:

```js
    followOrganization,
    leaveOrganization,
```

- [ ] **Step 3: Verify**

Run `npm run dev`, sign in as a user who is an admin of at least one club (or use the dev admin bypass), open the browser console, and run:

```js
// paste in the browser console while the app is running
document.querySelector('#root')._reactRootContainer // just confirming the app mounted; the real check is below
```

Instead, temporarily add `console.log(useAuth())` inside any page component (e.g. top of `Home.jsx`'s function body), reload, and confirm the logged object has `adminOrganizations`, `isAdminOfAny`, `followOrganization`, `leaveOrganization` keys. Remove the temporary `console.log` afterward.

- [ ] **Step 4: Commit**

```bash
git add src/contexts/AuthContext.jsx
git commit -m "feat: add admin-of-any and follow/leave organization to AuthContext"
```

---

## Task 3: MixCard — optional club tag

**Files:**
- Modify: `src/components/ui.jsx:512-596` (the `MixCard` component)

**Interfaces:**
- Consumes: `game.organization` (`{name, group_logo_url}`, from the Task 4 query change), a new `showClub` boolean prop.
- Produces: `<MixCard game joined showClub />` renders a small club-name label when `showClub` is true and `game.organization?.name` is present.

- [ ] **Step 1: Change the function signature**

In `src/components/ui.jsx`, change:

```js
export function MixCard({ game, joined = false }) {
```

to:

```js
export function MixCard({ game, joined = false, showClub = false }) {
```

- [ ] **Step 2: Render the tag**

Find this line (currently the first line inside the card body, right after the day/time + state row):

```jsx
      <h3 className="text-lg text-ink-900 leading-snug mb-1">{game.title}</h3>
```

Replace it with:

```jsx
      {showClub && game.organization?.name && (
        <p className="text-[11px] font-extrabold uppercase tracking-widest text-lime-700 mb-1">
          {game.organization.name}
        </p>
      )}
      <h3 className="text-lg text-ink-900 leading-snug mb-1">{game.title}</h3>
```

- [ ] **Step 3: Verify**

Run `npm run dev`, temporarily pass `showClub` to one `<MixCard>` call site with a game object that has `organization: { name: 'Teste' }` attached, confirm the small "TESTE" label renders above the title. Revert the temporary test data.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui.jsx
git commit -m "feat: add optional club tag to MixCard"
```

---

## Task 4: Home.jsx — aggregate mixs across every club a player belongs to

**Files:**
- Modify: `src/pages/Home.jsx` (whole file restructured; see exact replacements below)

**Interfaces:**
- Consumes: `useAuth()`'s `memberships` (existing), `followOrganization`/`leaveOrganization` (Task 2, not used here but confirms Task 2 lands first), `MixCard`'s new `showClub` prop (Task 3).
- Produces: Home's games query is no longer gated on `currentOrganizationId`.

- [ ] **Step 1: Replace the data-loading logic**

Replace lines 13-137 of `src/pages/Home.jsx` (from `export default function Home() {` through the end of `loadGames`'s closing `}`) with:

```jsx
export default function Home() {
  const [games, setGames] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('ativos')
  const { user, profile, memberships, currentOrganizationId, joinOrganization, isPrivateMatchesEnabled } = useAuth()
  const [searchParams] = useSearchParams()
  const [joinSlug, setJoinSlug] = useState('')
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState('')

  const handleJoin = async (slugOverride) => {
    const slug = (slugOverride ?? joinSlug).trim()
    if (!slug) return
    setJoining(true)
    setJoinError('')
    try {
      const { error } = await joinOrganization(slug)
      if (error) throw error
    } catch (error) {
      console.error('Error joining organization:', error)
      setJoinError('Não foi possível juntar-te a esse clube. Confirma o nome com o admin.')
    } finally {
      setJoining(false)
    }
  }

  // Invite links carry ?org=<slug>, but that's normally only consumed by
  // the /login page — someone who's already signed in (with no club yet)
  // gets redirected straight past /login to here without it ever being
  // read. Pick it up here too, so an invite link works for an existing,
  // club-less session, not just a fresh signup.
  useEffect(() => {
    const orgSlug = searchParams.get('org')
    if (orgSlug && !currentOrganizationId) {
      handleJoin(orgSlug)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const orgIds = memberships.map((m) => m.organization_id)
  const orgIdsKey = orgIds.slice().sort().join(',')

  useEffect(() => {
    // No memberships yet — nothing to load. Without this, `loading` would
    // stay true forever: loadGames never runs, so setLoading(false) never
    // fires and the page spins indefinitely instead of showing the
    // "no clubs followed" message.
    if (orgIds.length === 0) {
      setLoading(false)
      return
    }

    loadGames()

    // Subscribe to game updates
    const subscription = supabase
      .channel('games_channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games' }, () => {
        loadGames()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'participants' }, () => {
        loadGames()
      })
      .subscribe()

    return () => {
      subscription.unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgIdsKey])

  const loadGames = async () => {
    try {
      if (orgIds.length === 0) {
        setGames([])
        return
      }

      const { data, error } = await supabase
        .from('games')
        .select(`
          *,
          organization:organizations (name, group_logo_url),
          participants (
            id,
            user_id,
            partner_id,
            status,
            user:profiles!participants_user_id_fkey (name, avatar_url),
            partner:profiles!participants_partner_id_fkey (name, avatar_url)
          )
        `)
        .in('organization_id', orgIds)
        .order('date', { ascending: true })

      if (error) {
        console.error('Error loading games:', error)
        throw error
      }

      // level/is_guest live on `memberships` (per-org) — fetch every org's
      // membership rows once, keyed by org+user (the same person can have
      // a different level in each club, and cards from different clubs
      // are now mixed together in one list).
      const { data: memberRows, error: memberError } = await supabase
        .from('memberships')
        .select('user_id, organization_id, level, is_guest')
        .in('organization_id', orgIds)
      if (memberError) throw memberError
      const membershipByKey = new Map(
        (memberRows || []).map((m) => [`${m.organization_id}:${m.user_id}`, m])
      )

      const attachMembership = (person, userId, organizationId) => {
        if (!person) return person
        const m = membershipByKey.get(`${organizationId}:${userId}`)
        return { ...person, level: m?.level, is_guest: m?.is_guest ?? false }
      }

      // Show all games that are not cancelled
      const filteredGames = (data || [])
        .filter((game) => game.status !== 'cancelled')
        .map((game) => ({
          ...game,
          participants: (game.participants || []).map((p) => ({
            ...p,
            user: attachMembership(p.user, p.user_id, game.organization_id),
            partner: attachMembership(p.partner, p.partner_id, game.organization_id),
          })),
        }))

      setGames(filteredGames)
    } catch (error) {
      console.error('Error in loadGames:', error)
    } finally {
      setLoading(false)
    }
  }
```

- [ ] **Step 2: Update the empty-state and MixCard rendering**

Replace the `{!currentOrganizationId ? (` block (originally lines 181-210) with:

```jsx
      {memberships.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Ainda não segues nenhum clube"
          subtitle={
            joining
              ? 'A juntar-te ao clube…'
              : 'Descobre clubes públicos em Clubes & Grupos, ou usa um link de convite direto.'
          }
          action={
            !joining && (
              <div className="space-y-4 max-w-xs mx-auto">
                <Link to="/clubes">
                  <PrimaryButton type="button" className="w-full">
                    Ver Clubes & Grupos
                  </PrimaryButton>
                </Link>
                <form
                  onSubmit={(e) => { e.preventDefault(); handleJoin() }}
                  className="space-y-2"
                >
                  <input
                    type="text"
                    value={joinSlug}
                    onChange={(e) => setJoinSlug(e.target.value)}
                    placeholder="ou introduz o código de um clube privado"
                    className="input-field text-center text-sm"
                  />
                  {joinError && <p className="text-xs text-danger">{joinError}</p>}
                </form>
              </div>
            )
          }
        />
      ) : (
```

Then find `{visibleGames.map(game => (` and change:

```jsx
                <MixCard key={game.id} game={game} joined={isUserJoined(game)} />
```

to:

```jsx
                <MixCard key={game.id} game={game} joined={isUserJoined(game)} showClub={memberships.length > 1} />
```

- [ ] **Step 3: Verify**

Run `npm run dev`. As a user in zero clubs: confirm the empty state shows "Ainda não segues nenhum clube" with a "Ver Clubes & Grupos" button and a small manual-code field. As a user in one club: confirm Home looks and behaves exactly as before (no club tags, since `memberships.length > 1` is false). If you can put a test user in two clubs (via SQL: two `INSERT INTO memberships`), confirm Home shows mixs from both, each `MixCard` tagged with its club name.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Home.jsx
git commit -m "feat: aggregate Home's mix list across every club a player follows"
```

---

## Task 5: Clubes.jsx — rewrite as the "Clubes & Grupos" directory

**Files:**
- Modify: `src/pages/Clubes.jsx` (full rewrite, replacing the "Em breve" placeholder)

**Interfaces:**
- Consumes: `list_global_organizations` RPC (Task 1), `useAuth()`'s `followOrganization`/`leaveOrganization` (Task 2).

- [ ] **Step 1: Write the new page**

Replace the entire contents of `src/pages/Clubes.jsx` with:

```jsx
import { useState, useEffect } from 'react'
import { Users, UserPlus, Clock } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Avatar, EmptyState } from '../components/ui'
import PadelIcon from '../components/icons/PadelIcon'

export default function Clubes() {
  const { followOrganization, leaveOrganization } = useAuth()
  const [clubs, setClubs] = useState([])
  const [loading, setLoading] = useState(true)
  const [actingOn, setActingOn] = useState(null)

  const loadClubs = async () => {
    const { data, error } = await supabase.rpc('list_global_organizations')
    if (error) {
      console.error('Error loading clubs:', error)
      setLoading(false)
      return
    }
    setClubs(data || [])
    setLoading(false)
  }

  useEffect(() => {
    loadClubs()
  }, [])

  const handleFollow = async (club) => {
    setActingOn(club.id)
    try {
      const { error } = await followOrganization(club.id)
      if (error) throw error
      await loadClubs()
    } catch (error) {
      console.error('Error following club:', error)
      alert('Não foi possível seguir este clube. Tenta novamente.')
    } finally {
      setActingOn(null)
    }
  }

  const handleUnfollow = async (club) => {
    if (!confirm(`Deixar de seguir ${club.name}? Deixas de ver os mixs deste clube.`)) return
    setActingOn(club.id)
    try {
      const { error } = await leaveOrganization(club.id)
      if (error) throw error
      await loadClubs()
    } catch (error) {
      console.error('Error leaving club:', error)
      alert(error.message || 'Não foi possível deixar de seguir este clube.')
    } finally {
      setActingOn(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-ink-50 border-t-ink-700"></div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-3xl text-ink-900">Clubes & Grupos</h2>
        <p className="text-muted text-sm mt-0.5">Segue clubes públicos e vê os mixs deles no teu Home</p>
      </div>

      {clubs.length === 0 ? (
        <EmptyState
          icon={PadelIcon}
          title="Ainda não há clubes públicos"
          subtitle="Assim que um clube decidir ser público, aparece aqui."
        />
      ) : (
        <div className="space-y-3">
          {clubs.map((club) => (
            <div key={club.id} className="card flex items-center gap-3.5">
              <Avatar name={club.name} url={club.group_logo_url} size="w-11 h-11 text-sm" />
              <div className="flex-1 min-w-0">
                <h3 className="font-extrabold text-ink-900 truncate">{club.name}</h3>
                <p className="text-sm text-muted flex items-center gap-1.5">
                  <Users size={13} /> {club.member_count} {club.member_count === 1 ? 'membro' : 'membros'}
                </p>
              </div>

              {club.my_status === 'member' ? (
                <button
                  onClick={() => handleUnfollow(club)}
                  disabled={actingOn === club.id}
                  className="whitespace-nowrap text-xs font-extrabold px-3 py-2 min-h-[44px] rounded-full bg-ink-50 text-ink-700 hover:bg-ink-200 transition-colors duration-fast disabled:opacity-40"
                >
                  A seguir
                </button>
              ) : club.my_status === 'pending' ? (
                <span className="whitespace-nowrap inline-flex items-center gap-1.5 text-xs font-extrabold px-3 py-2 rounded-full bg-ink-50 text-muted">
                  <Clock size={14} /> Pedido enviado
                </span>
              ) : (
                <button
                  onClick={() => handleFollow(club)}
                  disabled={actingOn === club.id}
                  className="whitespace-nowrap inline-flex items-center gap-1.5 text-xs font-extrabold px-3.5 py-2 min-h-[44px] rounded-full bg-lime-400 text-ink-900 hover:bg-lime-600 transition-colors duration-fast disabled:opacity-40"
                >
                  <UserPlus size={14} />
                  {club.open_join ? 'Seguir' : 'Pedir para entrar'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify**

Run `npm run dev`, sign in, visit `/clubes`. With no `is_global` clubs yet, confirm the empty state. Set one test organization's `is_global=true, open_join=true` and another's `is_global=true, open_join=false` directly via SQL (`UPDATE organizations SET is_global = true, open_join = true WHERE slug = '...'`), reload, and confirm: the open club shows a "Seguir" button that immediately flips to "A seguir" after clicking; the restricted club shows "Pedir para entrar" that flips to "Pedido enviado".

- [ ] **Step 3: Commit**

```bash
git add src/pages/Clubes.jsx
git commit -m "feat: replace Clubes placeholder with the Clubes & Grupos directory"
```

---

## Task 6: GerirClube.jsx — move club management to a slug-scoped backoffice page

**Files:**
- Create: `src/pages/GerirClube.jsx` (based on `src/pages/Admin.jsx`)

**Interfaces:**
- Consumes: `useParams()` for `:slug`, `useAuth()`'s `memberships`, `approve_membership_request`/`reject_membership_request` RPCs (Task 1).
- Produces: default export `GerirClube`, rendered at route `/gerir/:slug` (wired in Task 8).

- [ ] **Step 1: Copy the file**

Copy the entire contents of `src/pages/Admin.jsx` into a new file `src/pages/GerirClube.jsx`.

- [ ] **Step 2: Resolve the org from the URL slug instead of the app-wide current organization**

In `src/pages/GerirClube.jsx`, change the imports at the top from:

```js
import { useState, useEffect } from 'react'
import { Plus, Calendar, Users, Trash2, Edit2, Check, X, UserX, Repeat } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { DateField, DateTimeField, Avatar } from '../components/ui'
import { totalRounds, FORMAT_LABEL } from '../lib/mixLogic'
```

to:

```js
import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Plus, Calendar, Users, Trash2, Edit2, Check, X, UserX, Repeat, Clock, ArrowLeft } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { DateField, DateTimeField, Avatar } from '../components/ui'
import { totalRounds, FORMAT_LABEL } from '../lib/mixLogic'
```

Change the function declaration and its very first lines from:

```js
export default function Admin() {
  const { profile: currentUser, currentOrganizationId, isPrivateMatchesEnabled, refreshFeatureFlags } = useAuth()
  const [activeTab, setActiveTab] = useState('games') // 'games', 'members', 'settings'
  const [games, setGames] = useState([])
  const [members, setMembers] = useState([])
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showCreateGame, setShowCreateGame] = useState(false)
  const [editingGame, setEditingGame] = useState(null)
  const [gameFilter, setGameFilter] = useState('upcoming')
  const [savingFlag, setSavingFlag] = useState(false)

  // Form states
  const [gameForm, setGameForm] = useState(EMPTY_GAME_FORM)

  useEffect(() => {
    if (currentOrganizationId) loadData()
  }, [activeTab, currentOrganizationId])
```

to:

```js
export default function GerirClube() {
  const { slug } = useParams()
  const { profile: currentUser, memberships, isPrivateMatchesEnabled, refreshFeatureFlags } = useAuth()
  const [org, setOrg] = useState(null)
  const [orgLoading, setOrgLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('games') // 'games', 'members', 'settings'
  const [games, setGames] = useState([])
  const [members, setMembers] = useState([])
  const [requests, setRequests] = useState([])
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showCreateGame, setShowCreateGame] = useState(false)
  const [editingGame, setEditingGame] = useState(null)
  const [gameFilter, setGameFilter] = useState('upcoming')
  const [savingFlag, setSavingFlag] = useState(false)

  // Form states
  const [gameForm, setGameForm] = useState(EMPTY_GAME_FORM)

  // Resolve the org from the URL slug. `Guard` (App.jsx) only checks
  // "is logged in" for this route — per-org admin authorization happens
  // here, once we know which specific org the slug points to.
  useEffect(() => {
    const membership = memberships.find((m) => m.organization?.slug === slug)
    setOrg(membership?.is_admin ? membership.organization : null)
    setOrgLoading(false)
  }, [slug, memberships])

  const currentOrganizationId = org?.id

  useEffect(() => {
    if (currentOrganizationId) loadData()
  }, [activeTab, currentOrganizationId])
```

- [ ] **Step 3: Load pending requests alongside members**

Find `loadData`:

```js
  const loadData = async () => {
    setLoading(true)
    try {
      if (activeTab === 'games') {
        await loadGames()
      } else if (activeTab === 'members') {
        await loadMembers()
      } else if (activeTab === 'settings') {
        await loadSettings()
      }
    } finally {
      setLoading(false)
    }
  }
```

Change the `'members'` branch to load both:

```js
      } else if (activeTab === 'members') {
        await Promise.all([loadMembers(), loadRequests()])
      } else if (activeTab === 'settings') {
```

Right after the existing `loadMembers` function (ends with `setMembers(merged)` then `}`), add:

```js
  const loadRequests = async () => {
    const { data, error } = await supabase
      .from('membership_requests')
      .select('id, created_at, user_id, profile:profiles(name, avatar_url)')
      .eq('organization_id', currentOrganizationId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })

    if (error) {
      console.error('Error loading membership requests:', error)
      return
    }
    setRequests(data || [])
  }

  const handleApproveRequest = async (requestId) => {
    try {
      const { error } = await supabase.rpc('approve_membership_request', { p_request_id: requestId })
      if (error) throw error
      await Promise.all([loadMembers(), loadRequests()])
    } catch (error) {
      console.error('Error approving request:', error)
      alert('Erro ao aprovar pedido: ' + error.message)
    }
  }

  const handleRejectRequest = async (requestId) => {
    try {
      const { error } = await supabase.rpc('reject_membership_request', { p_request_id: requestId })
      if (error) throw error
      await loadRequests()
    } catch (error) {
      console.error('Error rejecting request:', error)
      alert('Erro ao rejeitar pedido: ' + error.message)
    }
  }
```

- [ ] **Step 4: Add is_global/open_join to the settings save**

Find `handleUpdateSettings`:

```js
  const handleUpdateSettings = async (e) => {
    e.preventDefault()

    try {
      const { error } = await supabase
        .from('organizations')
        .update({
          robot_contact: settings.robot_contact,
          name: settings.name,
          points_rules: settings.points_rules
        })
        .eq('id', settings.id)
```

Change the `.update({...})` payload to:

```js
        .update({
          robot_contact: settings.robot_contact,
          name: settings.name,
          points_rules: settings.points_rules,
          is_global: settings.is_global,
          open_join: settings.open_join,
        })
```

- [ ] **Step 5: Render "no access" / "not found" states, and add the header + Pedidos + settings toggles**

Find the component's `return` statement — it currently starts with:

```jsx
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-ink-900">Painel Admin</h2>
        <p className="text-gray-600 mt-1">Gerir jogos, membros e definições</p>
      </div>
```

Replace just that opening (up to, but not including, the `{/* Tabs */}` block that follows) with:

```jsx
  if (orgLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-ink-50 border-t-ink-700"></div>
      </div>
    )
  }

  if (!org) {
    return (
      <div className="card text-center py-12 px-6">
        <h2 className="text-xl text-ink-900 mb-2">Sem acesso</h2>
        <p className="text-muted text-sm mb-6">
          Ou este clube não existe, ou não és admin dele.
        </p>
        <Link to="/gerir" className="inline-flex items-center gap-1.5 text-ink-700 font-extrabold text-sm hover:underline">
          <ArrowLeft size={16} /> Voltar aos clubes que geres
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-ink-900">Gerir: {org.name}</h2>
        <p className="text-gray-600 mt-1">Jogos, membros e definições deste clube</p>
      </div>
```

Now find the Members Tab block:

```jsx
          {/* Members Tab */}
          {activeTab === 'members' && (
            <div className="space-y-3">
              <div className="card bg-blue-50">
                <p className="text-gray-700">
                  <strong>Total de membros:</strong> {members.length}
                </p>
              </div>

              {members.map(member => (
```

Insert a "Pedidos" section right after the `<div className="card bg-blue-50">...</div>` block and before `{members.map(member => (`:

```jsx
              {requests.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-extrabold text-ink-900 flex items-center gap-1.5">
                    <Clock size={14} /> Pedidos de entrada ({requests.length})
                  </h3>
                  {requests.map((req) => (
                    <div key={req.id} className="card flex items-center gap-3">
                      <Avatar name={req.profile?.name} url={req.profile?.avatar_url} size="w-9 h-9 text-sm" />
                      <p className="flex-1 min-w-0 font-extrabold text-ink-900 truncate">{req.profile?.name || 'Jogador'}</p>
                      <button
                        onClick={() => handleApproveRequest(req.id)}
                        className="w-9 h-9 flex items-center justify-center rounded-full bg-ok/10 text-ok hover:bg-ok/20 transition-colors duration-fast"
                        title="Aprovar"
                      >
                        <Check size={18} />
                      </button>
                      <button
                        onClick={() => handleRejectRequest(req.id)}
                        className="w-9 h-9 flex items-center justify-center rounded-full text-danger hover:bg-danger/10 transition-colors duration-fast"
                        title="Rejeitar"
                      >
                        <X size={18} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

```

Finally, find the end of the Settings tab's points-rules `<div className="grid grid-cols-2 gap-4">...</div>` block, right before the closing `<button type="submit" className="btn-primary w-full">`:

```jsx
                <button type="submit" className="btn-primary w-full">
                  Guardar definições
                </button>
              </form>
```

Insert a new block right before that `<button type="submit"` line (still inside the same `<form>`, after the points-rules `</div>` that closes the grid):

```jsx
                <div className="pt-2 border-t border-gray-200">
                  <h4 className="text-base font-semibold text-ink-900 mt-6 mb-1">
                    Visibilidade pública
                  </h4>
                  <p className="text-sm text-gray-500 mb-4">
                    Um clube público aparece em "Clubes & Grupos", conta para o ranking geral, e os seus membros ficam pesquisáveis por qualquer jogador.
                  </p>
                  <label className="flex items-center justify-between gap-4 p-3 rounded-ctrl border border-line mb-3">
                    <div>
                      <p className="font-extrabold text-ink-900 text-sm">Clube público</p>
                      <p className="text-[11px] text-muted">Aparece em Clubes & Grupos</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.is_global}
                      onChange={(e) => setSettings({ ...settings, is_global: e.target.checked })}
                      className="w-5 h-5 shrink-0"
                    />
                  </label>
                  {settings.is_global && (
                    <label className="flex items-center justify-between gap-4 p-3 rounded-ctrl border border-line">
                      <div>
                        <p className="font-extrabold text-ink-900 text-sm">Entrada livre</p>
                        <p className="text-[11px] text-muted">Sem isto, pedidos de entrada precisam da tua aprovação</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={settings.open_join}
                        onChange={(e) => setSettings({ ...settings, open_join: e.target.checked })}
                        className="w-5 h-5 shrink-0"
                      />
                    </label>
                  )}
                </div>

                <button type="submit" className="btn-primary w-full">
                  Guardar definições
                </button>
              </form>
```

- [ ] **Step 6: Verify**

Run `npm run dev`. Temporarily add a route for `/gerir/:slug` pointing at `GerirClube` (this gets wired properly in Task 8, but a quick temporary route lets you test now) and visit it as an admin of that club: confirm Jogos/Membros/Definições all work exactly as `/admin` did before, confirm the new "Pedidos" list shows a pending request created via SQL (`INSERT INTO membership_requests (user_id, organization_id) VALUES (...)`) and that Aprovar/Rejeitar work, and confirm the two new checkboxes save correctly. Visit the same URL as a non-admin (or admin of a *different* club) and confirm the "Sem acesso" state renders instead. Remove the temporary route.

- [ ] **Step 7: Commit**

```bash
git add src/pages/GerirClube.jsx
git commit -m "feat: add GerirClube backoffice page (slug-scoped, with join-request approval)"
```

---

## Task 7: Gerir.jsx — picker for admins of multiple clubs

**Files:**
- Create: `src/pages/Gerir.jsx`

**Interfaces:**
- Consumes: `useAuth()`'s `adminOrganizations` (Task 2).
- Produces: default export `Gerir`, rendered at route `/gerir` (wired in Task 8).

- [ ] **Step 1: Write the page**

```jsx
import { Navigate, Link } from 'react-router-dom'
import { Settings } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { Avatar, EmptyState } from '../components/ui'

export default function Gerir() {
  const { adminOrganizations } = useAuth()

  if (adminOrganizations.length === 1) {
    return <Navigate to={`/gerir/${adminOrganizations[0].slug}`} replace />
  }

  if (adminOrganizations.length === 0) {
    return (
      <EmptyState
        icon={Settings}
        title="Não geres nenhum clube"
        subtitle="Esta secção é para quem administra um clube ou grupo."
      />
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-3xl text-ink-900">Gerir</h2>
        <p className="text-muted text-sm mt-0.5">Escolhe o clube que queres gerir</p>
      </div>

      <div className="space-y-3">
        {adminOrganizations.map((org) => (
          <Link key={org.id} to={`/gerir/${org.slug}`} className="card press flex items-center gap-3.5 hover:shadow-lift">
            <Avatar name={org.name} url={org.group_logo_url} size="w-11 h-11 text-sm" />
            <h3 className="font-extrabold text-ink-900 truncate">{org.name}</h3>
          </Link>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify**

Run `npm run dev`. As an admin of exactly one club, temporarily route to `/gerir` (Task 8 wires the real route) and confirm it redirects straight to `/gerir/<slug>`. If you can make a test admin of two clubs (two `memberships` rows with `is_admin=true` for the same user), confirm `/gerir` shows a picker listing both, and each links to the right `/gerir/<slug>`.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Gerir.jsx
git commit -m "feat: add Gerir picker page for admins of multiple clubs"
```

---

## Task 8: App.jsx — wire /gerir and /gerir/:slug, remove /admin

**Files:**
- Modify: `src/App.jsx`

**Interfaces:**
- Consumes: `Gerir` (Task 7), `GerirClube` (Task 6).

- [ ] **Step 1: Swap the import**

Change:

```js
import Admin from './pages/Admin'
```

to:

```js
import Gerir from './pages/Gerir'
import GerirClube from './pages/GerirClube'
```

- [ ] **Step 2: Replace the `/admin` route**

Change:

```jsx
      <Route
        path="/admin"
        element={
          <Guard require="admin" showSplash={showSplash}>
            <Admin />
          </Guard>
        }
      />
```

to:

```jsx
      <Route
        path="/gerir"
        element={
          <Guard require="protected" showSplash={showSplash}>
            <Gerir />
          </Guard>
        }
      />
      <Route
        path="/gerir/:slug"
        element={
          <Guard require="protected" showSplash={showSplash}>
            <GerirClube />
          </Guard>
        }
      />
```

(`require="protected"` only checks "is logged in" — `Gerir`/`GerirClube` do their own finer-grained, per-org authorization, per Task 6/7.)

- [ ] **Step 3: Verify**

Run `npm run dev`. Confirm `/admin` no longer resolves to anything (404-like blank route, since no `<Route path="/admin">` exists — this is expected; a redirect isn't wired here since nothing in the app links to `/admin` anymore after Task 9). Confirm `/gerir` and `/gerir/<slug>` work as verified in Tasks 6 and 7, now through the real route (not the temporary one).

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx
git commit -m "feat: route /gerir and /gerir/:slug, remove /admin"
```

---

## Task 9: Layout.jsx — nav points to /gerir, delete Admin.jsx

**Files:**
- Modify: `src/components/Layout.jsx:172-190`
- Delete: `src/pages/Admin.jsx`

**Interfaces:**
- Consumes: `useAuth()`'s `isAdminOfAny` (Task 2).

- [ ] **Step 1: Swap the nav item**

In `src/components/Layout.jsx`, change:

```js
  const { signOut, profile, updateProfile, isAdmin, isGuest } = useAuth()
```

to:

```js
  const { signOut, profile, updateProfile, isAdminOfAny, isGuest } = useAuth()
```

Then change:

```js
  if (isAdmin) {
    navItems.push({ path: '/admin', icon: Settings, label: 'Admin' })
  }
```

to:

```js
  if (isAdminOfAny) {
    navItems.push({ path: '/gerir', icon: Settings, label: 'Gerir' })
  }
```

- [ ] **Step 2: Delete the old Admin page**

```bash
git rm src/pages/Admin.jsx
```

- [ ] **Step 3: Verify nothing else references it**

```bash
grep -rn "pages/Admin" src/ || echo "clean"
```

Confirm the only remaining output is `echo "clean"` (i.e. no matches) — `App.jsx` (Task 8) and `Layout.jsx` (this task) were the only two references.

Then run `npm run dev`: confirm the bottom nav shows "Gerir" (not "Admin") for an admin, that it navigates to `/gerir`, and that a non-admin, non-any-club-admin user never sees the nav item at all.

- [ ] **Step 4: Commit**

```bash
git add src/components/Layout.jsx
git commit -m "feat: point nav's admin item at /gerir; remove Admin.jsx"
```

---

## Self-Review Notes (for whoever executes this plan)

- **Spec coverage:** Task 1 covers Schema/RLS/RPCs. Task 2 covers the AuthContext plumbing the design spec assumed. Tasks 3-4 cover "Player experience — Home." Task 5 covers "Clubes & Grupos." Tasks 6-9 cover "Backoffice" and "Routing architecture." Rankings/Comunidade need no frontend task — Task 1's RPC patches are sufficient (see the design spec's 2026-08-17 revision explaining why). Error-handling states ("clube não existe", "sem acesso") are implemented inline in Task 6/7 rather than as separate tasks, since they're small conditionals within those same components, not independently deliverable units.
- **Deliberate simplification vs. the spec:** the spec's error-handling section wanted a distinct "este clube não existe" message separate from "sem acesso." Task 6's `GerirClube` collapses both into one "Sem acesso" state, because the client only ever has `memberships` for orgs the signed-in user actually belongs to — telling "slug matches no org at all" apart from "slug matches an org I'm not a member of" would need an extra round-trip query purely to word an error message more precisely. Both cases already render a safe, actionable screen (not a blank page), so this was judged not worth the extra query.
- **Out of scope, flagged in the spec but not this plan:** `PlayerDetails.jsx`, `GameDetails.jsx`, and any other page that reads `profiles`/`player_stats` directly were not individually audited task-by-task — Task 1's RLS widening is table-level, so those pages inherit the fix automatically with no code change needed on their part. If manual testing in Task 1 surfaces a page that behaves unexpectedly for a global-org, non-member viewer, treat that as a new bug, not a sign this plan is incomplete.
- **Rollout reminder (surfaced earlier in the design conversation):** don't deploy this mid-mix — pick a moment between mixes, and confirm `/gerir/<slug>` works for the relevant admin *before* relying on it on a game day.
