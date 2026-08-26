# Club-Scoped Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a club's groups (`organizations` rows with `kind='group'`) feel like they live inside their parent club instead of as independent tenants — a club admin manages every group from inside `GerirClube.jsx`, joining a group always requires approval, group contents (members/mixes/ratings) are hidden from club members who aren't in the group, groups stop appearing in the public Comunidade/Rankings directory, and mix creation can target a specific group directly from the club's own create-mix form.

**Architecture:** No schema change. One SQL migration extends `is_org_admin` so a club admin is treated as admin of every child group (ripples through every existing RLS policy/RPC that already gates on it), forces `open_join = FALSE` on every club-scoped group at creation, adds a new tiered-visibility RPC (`list_club_groups`) for the "see it exists, not its contents" rule, fixes `follow_organization` so a club member can request to join a sibling group even inside a private (non-`is_global`) club, and narrows three existing public-directory RPCs (`list_global_organizations`, `search_organizations`, `get_organization_rankings`) plus `get_club_profile`'s visibility rule to stop surfacing groups outside their parent club. `GerirClube.jsx` gets a real "Grupos dentro deste clube" panel (list, expand to manage members/requests, join button) and a scope picker on its existing create-mix form. `Comunidade.jsx` and `Rankings.jsx` drop their now-permanently-empty "Grupos" sections.

**Tech Stack:** React (Vite SPA), Supabase (Postgres + RLS + RPCs), react-router-dom, Tailwind.

**Spec:** `docs/superpowers/specs/2026-08-26-club-scoped-groups-design.md`

## Global Constraints

- No automated test framework in this project — verification is manual: SQL run/checked in the Supabase SQL Editor, `npm run build`, and a manual browser walkthrough where a live session is available.
- New SQL goes in one new file, `supabase/migration_club_scoped_groups.sql`, run manually via Supabase → SQL Editor → New query → Run (this file existing in the repo does not mean it's live — say so explicitly when done).
- Every function touched here keeps its current `RETURNS` shape, so every change uses `CREATE OR REPLACE FUNCTION` (never `DROP FUNCTION` + `CREATE FUNCTION`) — matching the existing convention that DROP+CREATE is reserved for return-shape changes. `list_club_groups` is new, so it's a plain `CREATE FUNCTION`.
- `SECURITY DEFINER` SQL-language RPCs follow the existing pattern: `SET search_path = public`, `STABLE` where read-only, `REVOKE ALL ON FUNCTION ... FROM public` + `GRANT EXECUTE ON FUNCTION ... TO authenticated`. The two `plpgsql` RPCs (`create_group`, `follow_organization`) follow their own existing grant pattern instead: `REVOKE EXECUTE ON FUNCTION ... FROM anon, public` + `GRANT EXECUTE ... TO authenticated` for `create_group`, and no new REVOKE/GRANT needed for `follow_organization` (unchanged from its current grants — this migration only replaces its body).
- European Portuguese for all user-facing copy and error messages.
- Follow existing code style in every file touched (Tailwind utility classes already used in the same file, existing comment density/tone).
- Independent groups (`kind='group'`, `parent_organization_id IS NULL`, created via `Gerir.jsx` by a platform admin) are explicitly out of scope — every change here that could affect them is written to fall through to their existing, unchanged behavior.
- No data migration/backfill — existing groups (if any) simply pick up the new behavior for future actions; nothing is backfilled.

---

## Task 1: Database migration — `is_org_admin`, `create_group`, `list_club_groups`, `follow_organization`, and directory RPCs

**Files:**
- Create: `supabase/migration_club_scoped_groups.sql`

**Interfaces:**
- Produces: `is_org_admin(p_organization_id UUID) RETURNS BOOLEAN` (now also true for a club admin on any of that club's child groups); `create_group(...)` (now always inserts club-scoped groups with `open_join = FALSE`); `list_club_groups(p_club_id UUID) RETURNS TABLE (id, name, slug, group_logo_url, my_status, can_manage, member_count, avg_rating)`; `follow_organization(p_organization_id UUID) RETURNS TEXT` (now has a group-specific request branch); `list_global_organizations()`, `search_organizations(p_query TEXT)`, `get_organization_rankings()` (all now club-only); `get_club_profile(p_slug TEXT)` (group visibility now member/club-admin-only, not `is_global`-gated).

- [ ] **Step 1: Write the migration file**

```sql
-- ════════════════════════════════════════════════════════════════════════
-- Migration: club-scoped groups — a club admin manages every group inside
-- their club, joining a group always requires approval, group contents are
-- hidden from club members who aren't in the group, and groups stop
-- appearing in the public directory (Comunidade / Rankings) outside their
-- parent club. See docs/superpowers/specs/2026-08-26-club-scoped-groups-design.md
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. is_org_admin — a club admin is also admin of every child group ────
CREATE OR REPLACE FUNCTION is_org_admin(p_organization_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships
    WHERE organization_id = p_organization_id AND user_id = auth.uid() AND is_admin
  )
  OR EXISTS (
    SELECT 1 FROM organizations child
    JOIN memberships m ON m.organization_id = child.parent_organization_id
    WHERE child.id = p_organization_id AND m.user_id = auth.uid() AND m.is_admin
  );
$$;

-- ── 2. create_group — club-scoped groups always require approval to join,
--       regardless of the parent club's own open_join setting. Independent
--       groups (p_parent_org_id IS NULL) are unchanged. ───────────────────
CREATE OR REPLACE FUNCTION create_group(p_name TEXT, p_slug TEXT, p_parent_org_id UUID, p_admin_user_id UUID)
RETURNS UUID AS $$
DECLARE
  v_group_id UUID;
  v_parent organizations%ROWTYPE;
BEGIN
  IF p_parent_org_id IS NOT NULL THEN
    SELECT * INTO v_parent FROM organizations WHERE id = p_parent_org_id;
    IF v_parent.id IS NULL THEN
      RAISE EXCEPTION 'Clube-mãe não encontrado';
    END IF;
    IF v_parent.kind <> 'club' THEN
      RAISE EXCEPTION 'Só é possível criar grupos dentro de clubes';
    END IF;
    IF NOT (is_org_admin(p_parent_org_id) OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_platform_admin)) THEN
      RAISE EXCEPTION 'Sem permissão para criar um grupo neste clube';
    END IF;
    IF p_admin_user_id <> auth.uid()
       AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_platform_admin) THEN
      RAISE EXCEPTION 'Só podes criar um grupo com te tornares admin dele';
    END IF;

    INSERT INTO organizations (name, slug, kind, parent_organization_id, is_global, open_join, points_rules)
    VALUES (p_name, p_slug, 'group', p_parent_org_id, v_parent.is_global, FALSE, v_parent.points_rules)
    RETURNING id INTO v_group_id;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_platform_admin) THEN
      RAISE EXCEPTION 'Apenas super admins podem criar grupos independentes';
    END IF;

    INSERT INTO organizations (name, slug, kind, parent_organization_id)
    VALUES (p_name, p_slug, 'group', NULL)
    RETURNING id INTO v_group_id;
  END IF;

  INSERT INTO memberships (user_id, organization_id, is_admin)
  VALUES (p_admin_user_id, v_group_id, true);

  RETURN v_group_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION create_group(TEXT, TEXT, UUID, UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION create_group(TEXT, TEXT, UUID, UUID) TO authenticated;

-- ── 3. list_club_groups — tiered visibility for a club's own groups: any
--       club member sees a group's name/id/their own status; only group
--       members (or the club admin, via #1) see member_count/avg_rating. ──
CREATE FUNCTION list_club_groups(p_club_id UUID)
RETURNS TABLE (
  id UUID,
  name TEXT,
  slug TEXT,
  group_logo_url TEXT,
  my_status TEXT,
  can_manage BOOLEAN,
  member_count BIGINT,
  avg_rating NUMERIC
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    g.id, g.name, g.slug, g.group_logo_url,
    CASE
      WHEN EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = g.id AND m.user_id = auth.uid() AND m.is_admin) THEN 'admin'
      WHEN EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = g.id AND m.user_id = auth.uid()) THEN 'member'
      WHEN EXISTS (SELECT 1 FROM membership_requests r WHERE r.organization_id = g.id AND r.user_id = auth.uid() AND r.status = 'pending') THEN 'pending'
      ELSE 'none'
    END,
    is_org_admin(g.id),
    CASE WHEN is_org_admin(g.id) OR EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = g.id AND m.user_id = auth.uid())
      THEN (SELECT COUNT(*) FROM memberships m WHERE m.organization_id = g.id) END,
    CASE WHEN is_org_admin(g.id) OR EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = g.id AND m.user_id = auth.uid())
      THEN (
        SELECT AVG(p.rating) FROM memberships m
        JOIN profiles p ON p.id = m.user_id
        WHERE m.organization_id = g.id AND m.is_guest = FALSE AND p.rating IS NOT NULL
      ) END
  FROM organizations g
  WHERE g.parent_organization_id = p_club_id AND g.kind = 'group'
    AND EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = p_club_id AND m.user_id = auth.uid())
  ORDER BY g.name;
$$;

REVOKE ALL ON FUNCTION list_club_groups(UUID) FROM public;
GRANT EXECUTE ON FUNCTION list_club_groups(UUID) TO authenticated;

-- ── 4. follow_organization — a club member can request to join a sibling
--       group even inside a private (non-is_global) club; independent
--       groups and clubs keep the original is_global/open_join gate. ──────
CREATE OR REPLACE FUNCTION follow_organization(p_organization_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_kind TEXT;
  v_parent_id UUID;
  v_is_global BOOLEAN;
  v_open_join BOOLEAN;
BEGIN
  SELECT kind, parent_organization_id, is_global, open_join
    INTO v_kind, v_parent_id, v_is_global, v_open_join
  FROM organizations WHERE id = p_organization_id;

  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'Clube não encontrado';
  END IF;

  IF EXISTS (
    SELECT 1 FROM memberships WHERE user_id = auth.uid() AND organization_id = p_organization_id
  ) THEN
    RETURN 'joined';
  END IF;

  IF v_kind = 'group' AND v_parent_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM memberships WHERE user_id = auth.uid() AND organization_id = v_parent_id
    ) THEN
      RAISE EXCEPTION 'Só membros do clube podem pedir para entrar neste grupo';
    END IF;
  ELSE
    IF NOT v_is_global THEN
      RAISE EXCEPTION 'Este clube não é público';
    END IF;
    IF v_open_join THEN
      INSERT INTO memberships (user_id, organization_id)
      VALUES (auth.uid(), p_organization_id)
      ON CONFLICT (user_id, organization_id) DO NOTHING;
      RETURN 'joined';
    END IF;
  END IF;

  INSERT INTO membership_requests (user_id, organization_id)
  VALUES (auth.uid(), p_organization_id)
  ON CONFLICT (user_id, organization_id) WHERE (status = 'pending') DO NOTHING;
  RETURN 'pending';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── 5. list_global_organizations — club-only. ─────────────────────────────
CREATE OR REPLACE FUNCTION list_global_organizations()
RETURNS TABLE (
  id UUID,
  name TEXT,
  slug TEXT,
  group_logo_url TEXT,
  kind TEXT,
  parent_organization_id UUID,
  parent_name TEXT,
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
    o.id, o.name, o.slug, o.group_logo_url, o.kind, o.parent_organization_id, parent.name,
    o.open_join,
    (SELECT COUNT(*) FROM memberships m WHERE m.organization_id = o.id),
    CASE
      WHEN EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = o.id AND m.user_id = auth.uid()) THEN 'member'
      WHEN EXISTS (SELECT 1 FROM membership_requests r WHERE r.organization_id = o.id AND r.user_id = auth.uid() AND r.status = 'pending') THEN 'pending'
      ELSE 'none'
    END
  FROM organizations o
  LEFT JOIN organizations parent ON parent.id = o.parent_organization_id
  WHERE o.is_global = TRUE AND o.kind = 'club'
  ORDER BY o.name;
$$;

REVOKE ALL ON FUNCTION list_global_organizations() FROM public;
GRANT EXECUTE ON FUNCTION list_global_organizations() TO authenticated;

-- ── 6. search_organizations — club-only. ──────────────────────────────────
CREATE OR REPLACE FUNCTION search_organizations(p_query TEXT)
RETURNS TABLE (
  id UUID,
  name TEXT,
  slug TEXT,
  group_logo_url TEXT,
  kind TEXT,
  parent_organization_id UUID,
  parent_name TEXT,
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
    o.id, o.name, o.slug, o.group_logo_url, o.kind, o.parent_organization_id, parent.name,
    o.open_join,
    (SELECT COUNT(*) FROM memberships m WHERE m.organization_id = o.id),
    CASE
      WHEN EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = o.id AND m.user_id = auth.uid()) THEN 'member'
      WHEN EXISTS (SELECT 1 FROM membership_requests r WHERE r.organization_id = o.id AND r.user_id = auth.uid() AND r.status = 'pending') THEN 'pending'
      ELSE 'none'
    END
  FROM organizations o
  LEFT JOIN organizations parent ON parent.id = o.parent_organization_id
  WHERE o.is_global = TRUE AND o.kind = 'club'
    AND o.name ILIKE '%' || trim(p_query) || '%'
  ORDER BY o.name
  LIMIT 20;
$$;

REVOKE ALL ON FUNCTION search_organizations(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION search_organizations(TEXT) TO authenticated;

-- ── 7. get_organization_rankings — club-only. ─────────────────────────────
CREATE OR REPLACE FUNCTION get_organization_rankings()
RETURNS TABLE (
  id UUID,
  name TEXT,
  slug TEXT,
  group_logo_url TEXT,
  kind TEXT,
  member_count BIGINT,
  total_points BIGINT,
  avg_rating NUMERIC
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    o.id,
    o.name,
    o.slug,
    o.group_logo_url,
    o.kind,
    (SELECT COUNT(*) FROM memberships m WHERE m.organization_id = o.id) AS member_count,
    COALESCE((SELECT SUM(ps.total_points) FROM player_stats ps WHERE ps.organization_id = o.id), 0) AS total_points,
    (
      SELECT AVG(p.rating)
      FROM memberships m
      JOIN profiles p ON p.id = m.user_id
      WHERE m.organization_id = o.id
        AND m.is_guest = FALSE
        AND p.rating IS NOT NULL
    ) AS avg_rating
  FROM organizations o
  WHERE o.is_global = TRUE AND o.kind = 'club'
  ORDER BY avg_rating DESC NULLS LAST, o.name;
$$;

REVOKE ALL ON FUNCTION get_organization_rankings() FROM public;
GRANT EXECUTE ON FUNCTION get_organization_rankings() TO authenticated;

-- ── 8. get_club_profile — a group's standalone page now requires being a
--       member or the club admin; is_global no longer grants public access
--       for a group (clubs are unchanged). ───────────────────────────────
CREATE OR REPLACE FUNCTION get_club_profile(p_slug TEXT)
RETURNS TABLE (
  id UUID,
  name TEXT,
  slug TEXT,
  description TEXT,
  location TEXT,
  phone TEXT,
  instagram TEXT,
  website TEXT,
  group_logo_url TEXT,
  kind TEXT,
  parent_organization_id UUID,
  parent_name TEXT,
  parent_slug TEXT,
  open_join BOOLEAN,
  member_count BIGINT,
  my_status TEXT,
  open_games JSONB
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    o.id, o.name, o.slug, o.description, o.location, o.phone, o.instagram, o.website,
    o.group_logo_url, o.kind, o.parent_organization_id, parent.name, parent.slug,
    o.open_join,
    (SELECT COUNT(*) FROM memberships m WHERE m.organization_id = o.id),
    CASE
      WHEN EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = o.id AND m.user_id = auth.uid()) THEN 'member'
      WHEN EXISTS (SELECT 1 FROM membership_requests r WHERE r.organization_id = o.id AND r.user_id = auth.uid() AND r.status = 'pending') THEN 'pending'
      ELSE 'none'
    END,
    COALESCE((
      SELECT json_agg(json_build_object(
        'id', g.id,
        'title', g.title,
        'date', g.date,
        'location', g.location,
        'max_players', COALESCE(g.max_players, g.num_courts * 4),
        'confirmed_count', (
          SELECT COALESCE(SUM(1 + (p.partner_id IS NOT NULL)::int), 0)
          FROM participants p WHERE p.game_id = g.id AND p.status = 'confirmed'
        )
      ) ORDER BY g.date)
      FROM games g
      WHERE g.organization_id = o.id AND g.status NOT IN ('finished', 'completed', 'cancelled', 'pending')
    ), '[]'::json)::jsonb
  FROM organizations o
  LEFT JOIN organizations parent ON parent.id = o.parent_organization_id
  WHERE o.slug = p_slug
    AND (
      (o.kind = 'club' AND (o.is_global = TRUE OR EXISTS (
        SELECT 1 FROM memberships m WHERE m.organization_id = o.id AND m.user_id = auth.uid()
      )))
      OR (o.kind = 'group' AND (
        is_org_admin(o.id) OR EXISTS (
          SELECT 1 FROM memberships m WHERE m.organization_id = o.id AND m.user_id = auth.uid()
        )
      ))
    );
$$;

REVOKE ALL ON FUNCTION get_club_profile(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION get_club_profile(TEXT) TO authenticated;
```

- [ ] **Step 2: Run the migration**

Supabase → SQL Editor → New query → paste the entire file → Run. Confirm it completes with no errors.

- [ ] **Step 3: Verify with manual SQL checks**

Run each of these as a user who is admin of a real club in your project (replace the bracketed placeholders with real ids/slugs from your data — `SELECT id, slug FROM organizations WHERE kind = 'club'` to find one).

```sql
-- A) Create a temporary group inside your club, as its admin
SELECT create_group('Grupo de Teste', 'grupo-de-teste-tmp', '<your-club-org-id>', auth.uid());
-- expect: returns a new UUID, no error

-- B) The new group has open_join = FALSE regardless of the parent club's setting
SELECT open_join FROM organizations WHERE slug = 'grupo-de-teste-tmp';
-- expect: false

-- C) is_org_admin now returns true for the club admin on the new group,
--    without the club admin ever having joined it directly
SELECT is_org_admin(id) FROM organizations WHERE slug = 'grupo-de-teste-tmp';
-- expect: true

-- D) list_club_groups shows the new group with can_manage = true and
--    real member_count/avg_rating for the club admin
SELECT name, my_status, can_manage, member_count FROM list_club_groups('<your-club-org-id>');
-- expect: one row for 'Grupo de Teste', my_status = 'admin', can_manage = true

-- E) list_global_organizations / search_organizations / get_organization_rankings
--    no longer return the new group (or any group)
SELECT COUNT(*) FROM list_global_organizations() WHERE kind = 'group';
SELECT COUNT(*) FROM search_organizations('Grupo de Teste');
SELECT COUNT(*) FROM get_organization_rankings() WHERE kind = 'group';
-- expect: 0, 0, 0

-- F) get_club_profile for the group now requires membership/admin — as the
--    club admin (who is also the group's creator/admin here) it still works
SELECT slug, kind, my_status FROM get_club_profile('grupo-de-teste-tmp');
-- expect: one row, my_status = 'admin'

-- G) follow_organization on the group, as a DIFFERENT club member who is
--    NOT yet in the group — run as that user (or simulate by checking the
--    function body's logic against a second real membership row you have)
--    Expect: inserts a pending membership_requests row and returns 'pending',
--    even if the parent club has is_global = FALSE.
-- (skip if you don't have a second test user handy — covered functionally
--  by the GerirClube.jsx walkthrough in Task 3)

-- H) cleanup
DELETE FROM organizations WHERE slug = 'grupo-de-teste-tmp';
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migration_club_scoped_groups.sql
git commit -m "feat: scope groups to their parent club — admin reach, tiered visibility, approval-only join"
```

---

## Task 2: `src/lib/organizations.js` — add `listClubGroups`

**Files:**
- Modify: `src/lib/organizations.js`

**Interfaces:**
- Consumes: RPC `list_club_groups` (Task 1).
- Produces: `listClubGroups(clubId: string) => Promise<Array<{id, name, slug, group_logo_url, my_status, can_manage, member_count, avg_rating}>>`.

- [ ] **Step 1: Add the wrapper**

In `src/lib/organizations.js`, add this export after `getOrganizationRankings`:

```js
export const listClubGroups = async (clubId) => {
  const { data, error } = await supabase.rpc('list_club_groups', { p_club_id: clubId })
  if (error) throw error
  return data || []
}
```

- [ ] **Step 2: Verify with `npm run build`**

Run `npm run build` from the repo root and confirm it completes with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/organizations.js
git commit -m "feat: add listClubGroups wrapper"
```

---

## Task 3: `GerirClube.jsx` — real "Grupos dentro deste clube" panel

**Files:**
- Modify: `src/pages/GerirClube.jsx`

**Interfaces:**
- Consumes: `listClubGroups` (Task 2); RPCs `list_membership_requests`, `approve_membership_request`, `reject_membership_request` (existing, already used by this file for the club's own requests); `followOrganization` from `useAuth()` (existing, `src/contexts/AuthContext.jsx:369`).
- Produces: new local state/handlers described below, consumed by Task 4's scope picker (`clubGroups` state, filtered to `can_manage`).

- [ ] **Step 1: Import `listClubGroups` and add `followOrganization` to the `useAuth()` destructure**

Change:
```js
import { createGroup } from '../lib/platformAdmin'
```
to:
```js
import { createGroup } from '../lib/platformAdmin'
import { listClubGroups } from '../lib/organizations'
import { formatRating } from '../lib/elo'
```

Change:
```js
  const { profile: currentUser, memberships, adminOrganizations, isPrivateMatchesEnabled, refreshFeatureFlags, ensureOrgAdminAccess, refreshMemberships } = useAuth()
```
to:
```js
  const { profile: currentUser, memberships, adminOrganizations, isPrivateMatchesEnabled, refreshFeatureFlags, ensureOrgAdminAccess, refreshMemberships, followOrganization } = useAuth()
```

- [ ] **Step 2: Add state for the groups panel**

Change:
```js
  const [showCreateGroup, setShowCreateGroup] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [groupSlug, setGroupSlug] = useState('')
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [groupError, setGroupError] = useState('')
  const [createdGroupName, setCreatedGroupName] = useState(null)
```
to:
```js
  const [showCreateGroup, setShowCreateGroup] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [groupSlug, setGroupSlug] = useState('')
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [groupError, setGroupError] = useState('')
  const [createdGroupName, setCreatedGroupName] = useState(null)
  const [clubGroups, setClubGroups] = useState([])
  const [groupsLoading, setGroupsLoading] = useState(false)
  const [expandedGroupId, setExpandedGroupId] = useState(null)
  const [expandedGroupMembers, setExpandedGroupMembers] = useState([])
  const [expandedGroupRequests, setExpandedGroupRequests] = useState([])
  const [expandedGroupLoading, setExpandedGroupLoading] = useState(false)
  const [groupActingOn, setGroupActingOn] = useState(null)
```

- [ ] **Step 3: Load the club's groups alongside the existing requests load**

Change:
```js
  // Fetched independently of which tab is open, so the "Membros" tab badge
  // (pending join-request count) is visible as soon as an org is selected —
  // an admin shouldn't have to open Membros first just to find out there's
  // something waiting there.
  useEffect(() => {
    if (currentOrganizationId) loadRequests()
  }, [currentOrganizationId])
```
to:
```js
  // Fetched independently of which tab is open, so the "Membros" tab badge
  // (pending join-request count) is visible as soon as an org is selected —
  // an admin shouldn't have to open Membros first just to find out there's
  // something waiting there.
  useEffect(() => {
    if (currentOrganizationId) loadRequests()
  }, [currentOrganizationId])

  // Only clubs contain groups — a group's own Gerir page has none of its
  // own (create_group rejects a group as a parent), so this stays empty
  // there and the scope picker in the create-game form (Task 4) never
  // renders on a group's own page either.
  useEffect(() => {
    if (currentOrganizationId && org?.kind !== 'group') loadClubGroups()
  }, [currentOrganizationId, org?.kind])

  const loadClubGroups = async () => {
    setGroupsLoading(true)
    try {
      const data = await listClubGroups(currentOrganizationId)
      setClubGroups(data)
    } catch (error) {
      console.error('Error loading club groups:', error)
    } finally {
      setGroupsLoading(false)
    }
  }

  const loadExpandedGroupDetails = async (groupId) => {
    setExpandedGroupLoading(true)
    try {
      const [membersRes, requestsRes] = await Promise.all([
        supabase
          .from('memberships')
          .select('id, is_admin, is_guest, level, user_id, profile:profiles(*)')
          .eq('organization_id', groupId)
          .eq('is_guest', false),
        supabase.rpc('list_membership_requests', { p_organization_id: groupId }),
      ])
      if (membersRes.error) throw membersRes.error
      if (requestsRes.error) throw requestsRes.error

      const merged = (membersRes.data || [])
        .map((m) => ({
          id: m.user_id,
          name: m.profile?.name || 'Jogador',
          is_admin: m.is_admin,
          level: m.level,
          avatar_url: m.profile?.avatar_url,
        }))
        .sort((a, b) => a.name.localeCompare(b.name))

      setExpandedGroupMembers(merged)
      setExpandedGroupRequests(requestsRes.data || [])
    } catch (error) {
      console.error('Error loading group details:', error)
      alert('Erro ao carregar detalhes do grupo: ' + error.message)
    } finally {
      setExpandedGroupLoading(false)
    }
  }

  const handleToggleGroupExpand = (group) => {
    if (expandedGroupId === group.id) {
      setExpandedGroupId(null)
      return
    }
    setExpandedGroupId(group.id)
    setExpandedGroupMembers([])
    setExpandedGroupRequests([])
    if (group.can_manage) loadExpandedGroupDetails(group.id)
  }

  const handleApproveGroupRequest = async (requestId, groupId) => {
    try {
      const { error } = await supabase.rpc('approve_membership_request', { p_request_id: requestId })
      if (error) throw error
      await Promise.all([loadClubGroups(), loadExpandedGroupDetails(groupId)])
    } catch (error) {
      console.error('Error approving group request:', error)
      alert('Erro ao aprovar pedido: ' + error.message)
    }
  }

  const handleRejectGroupRequest = async (requestId, groupId) => {
    try {
      const { error } = await supabase.rpc('reject_membership_request', { p_request_id: requestId })
      if (error) throw error
      await loadExpandedGroupDetails(groupId)
    } catch (error) {
      console.error('Error rejecting group request:', error)
      alert('Erro ao rejeitar pedido: ' + error.message)
    }
  }

  const handleRequestJoinGroup = async (group) => {
    setGroupActingOn(group.id)
    try {
      const { error } = await followOrganization(group.id)
      if (error) throw error
      await loadClubGroups()
    } catch (error) {
      console.error('Error requesting to join group:', error)
      alert(error.message || 'Não foi possível pedir para entrar. Tenta novamente.')
    } finally {
      setGroupActingOn(null)
    }
  }
```

- [ ] **Step 4: Refresh the group list after creating a group**

Change:
```js
  const handleCreateGroup = async () => {
    setGroupError('')
    setCreatingGroup(true)
    try {
      await createGroup(groupName.trim(), groupSlug.trim(), org.id, currentUser.id)
      // create_group inserts the caller's admin membership server-side — pull
      // it into the client before the admin can navigate to /gerir/<slug>,
      // otherwise the org resolver there sees a stale memberships array and
      // bounces them to "Sem acesso" until a manual page reload.
      await refreshMemberships()
      setCreatedGroupName(groupName.trim())
      setShowCreateGroup(false)
      setGroupName('')
      setGroupSlug('')
```
to:
```js
  const handleCreateGroup = async () => {
    setGroupError('')
    setCreatingGroup(true)
    try {
      await createGroup(groupName.trim(), groupSlug.trim(), org.id, currentUser.id)
      // create_group inserts the caller's admin membership server-side — pull
      // it into the client before the admin can navigate to /gerir/<slug>,
      // otherwise the org resolver there sees a stale memberships array and
      // bounces them to "Sem acesso" until a manual page reload.
      await refreshMemberships()
      await loadClubGroups()
      setCreatedGroupName(groupName.trim())
      setShowCreateGroup(false)
      setGroupName('')
      setGroupSlug('')
```

- [ ] **Step 5: Replace the "Grupos dentro deste clube" section with the real panel**

Change:
```jsx
              {/* Only clubs can contain groups — create_group rejects a group
                  as a parent server-side, so don't offer it on a group's own
                  Gerir page (the heading would be wrong there too). */}
              {org?.kind !== 'group' && (
                <div className="mt-6 pt-6 border-t border-gray-200">
                  <h4 className="text-base font-semibold text-ink-900 mb-1">
                    Grupos dentro deste clube
                  </h4>
                  <p className="text-sm text-gray-500 mb-4">
                    Um grupo tem os seus próprios mixes e membros, mas vive dentro deste clube — útil para uma equipa, torneio, ou turma específica.
                  </p>
                  {!showCreateGroup ? (
                    <button type="button" onClick={() => setShowCreateGroup(true)} className="btn-secondary w-full">
                      Criar grupo dentro deste clube
                    </button>
                  ) : (
```
to:
```jsx
              {/* Only clubs can contain groups — create_group rejects a group
                  as a parent server-side, so don't offer it on a group's own
                  Gerir page (the heading would be wrong there too). */}
              {org?.kind !== 'group' && (
                <div className="mt-6 pt-6 border-t border-gray-200">
                  <h4 className="text-base font-semibold text-ink-900 mb-1">
                    Grupos dentro deste clube
                  </h4>
                  <p className="text-sm text-gray-500 mb-4">
                    Um grupo tem os seus próprios mixes e membros, mas vive dentro deste clube — útil para uma equipa, torneio, ou turma específica.
                  </p>

                  {groupsLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="animate-spin rounded-full h-8 w-8 border-[3px] border-ink-50 border-t-ink-700"></div>
                    </div>
                  ) : clubGroups.length > 0 && (
                    <div className="space-y-3 mb-4">
                      {clubGroups.map((group) => {
                        const isMemberish = group.can_manage || group.my_status === 'member' || group.my_status === 'admin'
                        return (
                          <div key={group.id} className="card p-0 overflow-hidden">
                            <button
                              type="button"
                              onClick={() => handleToggleGroupExpand(group)}
                              className="w-full flex items-center gap-3 p-4 text-left"
                            >
                              <Avatar name={group.name} url={group.group_logo_url} size="w-10 h-10 text-sm" />
                              <div className="flex-1 min-w-0">
                                <h5 className="font-extrabold text-ink-900 truncate">{group.name}</h5>
                                {isMemberish ? (
                                  <p className="text-[11px] text-muted mt-0.5">
                                    {group.member_count} {group.member_count === 1 ? 'membro' : 'membros'}
                                    {group.avg_rating != null && ` · Nível médio ${formatRating(group.avg_rating)}`}
                                  </p>
                                ) : (
                                  <p className="text-[11px] text-muted mt-0.5">
                                    {group.my_status === 'pending' ? 'Pedido pendente' : 'Não és membro'}
                                  </p>
                                )}
                              </div>
                              {!group.can_manage && group.my_status === 'none' && (
                                <span
                                  role="button"
                                  tabIndex={0}
                                  onClick={(e) => { e.stopPropagation(); handleRequestJoinGroup(group) }}
                                  className={`shrink-0 whitespace-nowrap text-xs font-extrabold px-3.5 py-2 min-h-[44px] rounded-full bg-lime-400 text-ink-900 hover:bg-lime-600 transition-colors duration-fast inline-flex items-center ${groupActingOn === group.id ? 'opacity-40 pointer-events-none' : ''}`}
                                >
                                  Pedir para entrar
                                </span>
                              )}
                            </button>

                            {expandedGroupId === group.id && group.can_manage && (
                              <div className="px-4 pb-4 space-y-3 border-t border-line pt-3">
                                {expandedGroupLoading ? (
                                  <div className="flex items-center justify-center py-6">
                                    <div className="animate-spin rounded-full h-6 w-6 border-[3px] border-ink-50 border-t-ink-700"></div>
                                  </div>
                                ) : (
                                  <>
                                    <Link
                                      to={`/gerir/${group.slug}`}
                                      className="inline-flex items-center gap-1.5 text-xs font-extrabold text-lime-700 hover:underline"
                                    >
                                      Gerir grupo completo →
                                    </Link>

                                    {expandedGroupRequests.length > 0 && (
                                      <div className="space-y-2">
                                        <h6 className="text-xs font-extrabold text-ink-900 flex items-center gap-1.5">
                                          <Clock size={12} /> Pedidos de entrada ({expandedGroupRequests.length})
                                        </h6>
                                        {expandedGroupRequests.map((req) => (
                                          <div key={req.id} className="flex items-center gap-2">
                                            <Avatar name={req.name} url={req.avatar_url} size="w-7 h-7 text-xs" />
                                            <p className="flex-1 min-w-0 text-sm font-extrabold text-ink-900 truncate">{req.name || 'Jogador'}</p>
                                            <button
                                              onClick={() => handleApproveGroupRequest(req.id, group.id)}
                                              className="w-8 h-8 flex items-center justify-center rounded-full bg-ok/10 text-ok hover:bg-ok/20 transition-colors duration-fast"
                                              title="Aprovar"
                                            >
                                              <Check size={16} />
                                            </button>
                                            <button
                                              onClick={() => handleRejectGroupRequest(req.id, group.id)}
                                              className="w-8 h-8 flex items-center justify-center rounded-full text-danger hover:bg-danger/10 transition-colors duration-fast"
                                              title="Rejeitar"
                                            >
                                              <X size={16} />
                                            </button>
                                          </div>
                                        ))}
                                      </div>
                                    )}

                                    <div className="space-y-1.5">
                                      {expandedGroupMembers.map((member) => (
                                        <div key={member.id} className="flex items-center gap-2">
                                          <Avatar name={member.name} url={member.avatar_url} size="w-7 h-7 text-xs" />
                                          <p className="flex-1 min-w-0 text-sm text-ink-900 truncate">{member.name}</p>
                                          {member.is_admin && <span className="w-2 h-2 rounded-full bg-lime-600 shrink-0" title="Admin" />}
                                        </div>
                                      ))}
                                    </div>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {!showCreateGroup ? (
                    <button type="button" onClick={() => setShowCreateGroup(true)} className="btn-secondary w-full">
                      Criar grupo dentro deste clube
                    </button>
                  ) : (
```

The unchanged remainder of the block (the create-group form's inputs, the Criar/Cancelar buttons, and the `{createdGroupName && (...)}` success message) stays exactly as-is below this point — only the text above it and the new listing block above that are new.

- [ ] **Step 6: Verify with `npm run build`**

Run `npm run build` from the repo root and confirm it completes with no errors.

- [ ] **Step 7: Manual browser walkthrough**

- As a club admin with no groups yet, open the club's Gerir → Definições tab — confirm "Grupos dentro deste clube" shows no list (yet) and the "Criar grupo dentro deste clube" button still works, creating a group and immediately showing it in the new list with "0 membros" and `can_manage` controls.
- Expand the newly created group's row — confirm it shows "Gerir grupo completo →" (linking to `/gerir/<group-slug>`), no pending requests, and the group creator as its only member.
- As a second real club member (not in the group), open the same club's Definições tab — confirm the group shows only its name and "Não és membro" plus a "Pedir para entrar" button, with no member count or rating visible.
- Tap "Pedir para entrar" — confirm it flips to "Pedido pendente" and no error appears, even if the club itself has "Clube público" (is_global) turned off.
- Back as the club admin, confirm the group's expanded panel now shows one pending request; tap the check to approve — confirm it disappears from pending and the member count increments to 2.
- Confirm a club admin who never personally joined the group can still expand and manage it (this exercises the `is_org_admin` extension from Task 1).
- Visit `/comunidade` as any user — confirm the group does not appear anywhere (Task 5 will remove the section entirely, but even before that task runs, `list_global_organizations`/`search_organizations` from Task 1 already exclude it).

- [ ] **Step 8: Commit**

```bash
git add src/pages/GerirClube.jsx
git commit -m "feat: manage club groups inline from GerirClube (list, requests, join)"
```

---

## Task 4: `GerirClube.jsx` — scope picker on "Criar novo jogo"

**Files:**
- Modify: `src/pages/GerirClube.jsx`

**Interfaces:**
- Consumes: `clubGroups` state (Task 3), filtered to `can_manage`.
- Produces: mixes created from the club's own create-mix form can target a specific group's `organization_id` instead of always using the club's own.

- [ ] **Step 1: Add scope state**

Change:
```js
  // Form states
  const [gameForm, setGameForm] = useState(EMPTY_GAME_FORM)
```
to:
```js
  // Form states
  const [gameForm, setGameForm] = useState(EMPTY_GAME_FORM)
  const [mixScopeId, setMixScopeId] = useState('')
```

- [ ] **Step 2: Insert the "Âmbito" picker at the top of the create-game form**

Change:
```jsx
                  <form onSubmit={editingGame ? handleUpdateGame : handleCreateGame} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Título
                      </label>
```
to:
```jsx
                  <form onSubmit={editingGame ? handleUpdateGame : handleCreateGame} className="space-y-4">
                    {!editingGame && clubGroups.some((g) => g.can_manage) && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Âmbito
                        </label>
                        <select
                          value={mixScopeId}
                          onChange={(e) => setMixScopeId(e.target.value)}
                          className="input-field"
                        >
                          <option value="">Todo o clube</option>
                          {clubGroups.filter((g) => g.can_manage).map((g) => (
                            <option key={g.id} value={g.id}>{g.name}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Título
                      </label>
```

- [ ] **Step 3: Use the picked scope as the mix's `organization_id`**

Change:
```js
      const { data, error } = await supabase
        .from('games')
        .insert([
          {
            ...gameFields,
            organization_id: currentOrganizationId,
```
to:
```js
      const { data, error } = await supabase
        .from('games')
        .insert([
          {
            ...gameFields,
            organization_id: mixScopeId || currentOrganizationId,
```

- [ ] **Step 4: Reset the scope alongside the rest of the form**

Change (after a successful create):
```js
      setShowCreateGame(false)
      setGameForm(EMPTY_GAME_FORM)
      loadGames()
    } catch (error) {
      console.error('Error creating game:', error)
      alert('Erro ao criar jogo: ' + error.message)
    }
  }
```
to:
```js
      setShowCreateGame(false)
      setGameForm(EMPTY_GAME_FORM)
      setMixScopeId('')
      loadGames()
    } catch (error) {
      console.error('Error creating game:', error)
      alert('Erro ao criar jogo: ' + error.message)
    }
  }
```

Change (the Cancelar button):
```jsx
                      <button
                        type="button"
                        onClick={() => {
                          setShowCreateGame(false)
                          setEditingGame(null)
                          setGameForm(EMPTY_GAME_FORM)
                        }}
                        className="btn-secondary flex-1"
```
to:
```jsx
                      <button
                        type="button"
                        onClick={() => {
                          setShowCreateGame(false)
                          setEditingGame(null)
                          setGameForm(EMPTY_GAME_FORM)
                          setMixScopeId('')
                        }}
                        className="btn-secondary flex-1"
```

- [ ] **Step 5: Verify with `npm run build`**

Run `npm run build` from the repo root and confirm it completes with no errors.

- [ ] **Step 6: Manual browser walkthrough**

- As a club admin with at least one group you `can_manage` (from Task 3's walkthrough), open "Criar novo jogo" — confirm the "Âmbito" select appears above "Título", defaulting to "Todo o clube", listing your manageable group(s) by name.
- Pick the group, fill in the rest of the form, submit — confirm the mix is created successfully, then open that group's own Gerir page (`/gerir/<group-slug>`) and confirm the new mix appears there in its Jogos tab.
- Confirm the mix does NOT appear in the parent club's own Jogos tab (it's scoped to the group's `organization_id`, isolated the same way any other org's games already are).
- As a club admin with zero manageable groups, open "Criar novo jogo" — confirm no "Âmbito" field renders at all (falls back to today's behavior unchanged).
- Open "Editar jogo" on any existing mix — confirm no "Âmbito" field renders (scope picker is create-only).
- On a group's own `/gerir/<slug>` page (not the parent club's), open "Criar novo jogo" — confirm no "Âmbito" field renders (groups have no `clubGroups` of their own).

- [ ] **Step 7: Commit**

```bash
git add src/pages/GerirClube.jsx
git commit -m "feat: add group scope picker to mix creation"
```

---

## Task 5: `Comunidade.jsx` — drop the permanently-empty "Grupos" section

**Files:**
- Modify: `src/pages/Comunidade.jsx`

**Interfaces:**
- Consumes: `listGlobalOrganizations`/`searchOrganizations` (unchanged wrappers — now return club-only data after Task 1).

- [ ] **Step 1: Rename the tab label and drop the group-specific pieces**

Change:
```js
const TABS = [
  { key: 'players', label: 'Jogadores' },
  { key: 'orgs', label: 'Clubes & Grupos' },
]
```
to:
```js
const TABS = [
  { key: 'players', label: 'Jogadores' },
  { key: 'orgs', label: 'Clubes' },
]
```

Change:
```js
  const handleUnfollow = async (org) => {
    const noun = org.kind === 'group' ? 'grupo' : 'clube'
    if (!confirm(`Deixar de seguir ${org.name}? Deixas de ver os mixs deste ${noun}.`)) return
```
to:
```js
  const handleUnfollow = async (org) => {
    if (!confirm(`Deixar de seguir ${org.name}? Deixas de ver os mixs deste clube.`)) return
```

Change:
```js
  const clubs = organizations.filter((o) => o.kind === 'club')
  const groups = organizations.filter((o) => o.kind === 'group')

  const renderOrgRow = (org) => {
    const membership = memberships.find((m) => m.organization_id === org.id)
    const isFavorite = membership?.is_favorite === true
    return (
      <Link key={org.id} to={`/clube/${org.slug}`} className="card press flex items-center gap-3.5 hover:shadow-lift">
        <Avatar name={org.name} url={org.group_logo_url} size="w-11 h-11 text-sm" />
        <div className="flex-1 min-w-0">
          <h3 className="font-extrabold text-ink-900 truncate">{org.name}</h3>
          {org.kind === 'group' && org.parent_name && (
            <p className="text-[11px] font-extrabold uppercase tracking-widest text-lime-700 truncate mt-0.5">
              Grupo dentro de {org.parent_name}
            </p>
          )}
          <p className="text-sm text-muted flex items-center gap-1.5">
```
to:
```js
  const clubs = organizations.filter((o) => o.kind === 'club')

  const renderOrgRow = (org) => {
    const membership = memberships.find((m) => m.organization_id === org.id)
    const isFavorite = membership?.is_favorite === true
    return (
      <Link key={org.id} to={`/clube/${org.slug}`} className="card press flex items-center gap-3.5 hover:shadow-lift">
        <Avatar name={org.name} url={org.group_logo_url} size="w-11 h-11 text-sm" />
        <div className="flex-1 min-w-0">
          <h3 className="font-extrabold text-ink-900 truncate">{org.name}</h3>
          <p className="text-sm text-muted flex items-center gap-1.5">
```

Change:
```jsx
            : `${organizations.length} resultado${organizations.length === 1 ? '' : 's'} entre clubes e grupos`}
```
to:
```jsx
            : `${organizations.length} clube${organizations.length === 1 ? '' : 's'} na comunidade`}
```

Change:
```jsx
      ) : clubs.length === 0 && groups.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Nada encontrado"
          subtitle={query.trim() ? 'Tenta outro nome.' : 'Ainda não há clubes nem grupos na comunidade.'}
        />
      ) : (
        <div className="space-y-6">
          {clubs.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-extrabold text-ink-900 uppercase tracking-wide">Clubes</h3>
              <div className="space-y-3">{clubs.map(renderOrgRow)}</div>
            </div>
          )}

          {groups.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-extrabold text-ink-900 uppercase tracking-wide">Grupos</h3>
              <div className="space-y-3">{groups.map(renderOrgRow)}</div>
            </div>
          )}
        </div>
      )}
```
to:
```jsx
      ) : clubs.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Nada encontrado"
          subtitle={query.trim() ? 'Tenta outro nome.' : 'Ainda não há clubes na comunidade.'}
        />
      ) : (
        <div className="space-y-3">{clubs.map(renderOrgRow)}</div>
      )}
```

- [ ] **Step 2: Verify with `npm run build`**

Run `npm run build` from the repo root and confirm it completes with no errors.

- [ ] **Step 3: Manual browser walkthrough**

- Visit `/comunidade`, switch to the "Clubes" tab (renamed from "Clubes & Grupos") — confirm only clubs render, no "Grupo dentro de {clube}" labels anywhere, and the result count copy reads "N clube(s) na comunidade".
- Search for a group's name (one created in Task 3's walkthrough) — confirm it does not appear in results.
- Follow/unfollow a club from this tab — confirm the confirm() dialog reads "...deste clube" and everything still works exactly as before.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Comunidade.jsx
git commit -m "refactor: drop the permanently-empty Grupos section from Comunidade"
```

---

## Task 6: `Rankings.jsx` — "Clubes" tab (drop group branch)

**Files:**
- Modify: `src/pages/Rankings.jsx`

**Interfaces:**
- Consumes: `getOrganizationRankings` (unchanged wrapper — now returns club-only data after Task 1).

- [ ] **Step 1: Rename the section label**

Change:
```js
const SECTIONS = [
  { key: 'players', label: 'Jogadores' },
  { key: 'orgs', label: 'Clubes & Grupos' },
]
```
to:
```js
const SECTIONS = [
  { key: 'players', label: 'Jogadores' },
  { key: 'orgs', label: 'Clubes' },
]
```

- [ ] **Step 2: Drop the `kind` branch and update copy in the orgs list**

Change:
```jsx
        ) : orgRankings.length === 0 ? (
          <EmptyState
            icon={Trophy}
            title="Ranking em branco"
            subtitle="Assim que um clube ou grupo público tiver jogos, aparece aqui."
          />
        ) : (
          <div className="space-y-3">
            {orgRankings.map((org, index) => (
              <Link
                key={org.id}
                to={`/clube/${org.slug}`}
                className={`card press block hover:shadow-lift ${index === 0 ? 'ring-2 ring-lime-400' : ''}`}
              >
                <div className="flex items-center gap-3.5">
                  <div className={`w-11 h-11 rounded-ctrl flex items-center justify-center font-extrabold text-lg shrink-0 tabular-nums ${positionStyle(index)}`}>
                    {index + 1}
                  </div>
                  <Avatar name={org.name} url={org.group_logo_url} size="w-11 h-11 text-sm" />
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base text-ink-900 truncate">{org.name}</h3>
                    <p className="text-[11px] text-muted mt-0.5">
                      {org.kind === 'group' ? 'Grupo' : 'Clube'} · {org.member_count} {org.member_count === 1 ? 'membro' : 'membros'}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[11px] text-muted mb-1">Nível do Grupo</p>
                    <GroupLevelBadge rating={org.avg_rating} size="md" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )
```
to:
```jsx
        ) : orgRankings.length === 0 ? (
          <EmptyState
            icon={Trophy}
            title="Ranking em branco"
            subtitle="Assim que um clube público tiver jogos, aparece aqui."
          />
        ) : (
          <div className="space-y-3">
            {orgRankings.map((org, index) => (
              <Link
                key={org.id}
                to={`/clube/${org.slug}`}
                className={`card press block hover:shadow-lift ${index === 0 ? 'ring-2 ring-lime-400' : ''}`}
              >
                <div className="flex items-center gap-3.5">
                  <div className={`w-11 h-11 rounded-ctrl flex items-center justify-center font-extrabold text-lg shrink-0 tabular-nums ${positionStyle(index)}`}>
                    {index + 1}
                  </div>
                  <Avatar name={org.name} url={org.group_logo_url} size="w-11 h-11 text-sm" />
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base text-ink-900 truncate">{org.name}</h3>
                    <p className="text-[11px] text-muted mt-0.5">
                      Clube · {org.member_count} {org.member_count === 1 ? 'membro' : 'membros'}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[11px] text-muted mb-1">Nível do Clube</p>
                    <GroupLevelBadge rating={org.avg_rating} size="md" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )
```

Also update the section's heading comment right above it:

Change:
```jsx
      {/* ─── Clubes & Grupos ────────────────────────────────────────────── */}
```
to:
```jsx
      {/* ─── Clubes ─────────────────────────────────────────────────────── */}
```

- [ ] **Step 3: Verify with `npm run build`**

Run `npm run build` from the repo root and confirm it completes with no errors.

- [ ] **Step 4: Manual browser walkthrough**

- Visit `/rankings`, switch to the "Clubes" tab (renamed from "Clubes & Grupos") — confirm only clubs render, each row says "Clube · N membros" and "Nível do Clube", no group ever appears.
- Confirm the empty-state copy (if you have no public clubs with games) reads "Assim que um clube público tiver jogos, aparece aqui."

- [ ] **Step 5: Commit**

```bash
git add src/pages/Rankings.jsx
git commit -m "refactor: Rankings Clubes tab drops the group branch"
```
