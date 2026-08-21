# Comunidade Unificada Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the "Clubes" bottom-tab into "Comunidade" (one unified directory of players, clubs, and a new "independent groups" entity type), add a lightweight player-follow graph, and let club admins / platform admins create groups.

**Architecture:** One SQL migration adds `kind`/`parent_organization_id` to `organizations` (a group is structurally just another organizations row), a new `player_follows` table with pure-RLS follow/unfollow (no RPC needed), a `search_organizations` RPC, a `create_group` RPC, and widens three existing RPCs (`list_global_organizations`, `get_player_profile`, `get_club_profile`) to carry the new fields. `Comunidade.jsx` replaces the flat player list with three sections (Jogadores/Clubes/Grupos) backed by two new `src/lib` wrapper modules. `Clubes.jsx` and its nav entry are retired — its functionality now fully lives in Comunidade, so its only entry point (the bottom tab) disappears and the page itself is deleted rather than left as dead code reachable only by typing a URL. `ClubProfile.jsx` gains a breadcrumb + hides physical-club-only fields when viewing a group. `PlayerDetails.jsx` gains a follow button + follower/following counts. `Gerir.jsx` (platform admin) and `GerirClube.jsx` (club admin) both gain group-creation UI, calling the same new `create_group` RPC via two different access paths.

**Tech Stack:** React (Vite SPA), Supabase (Postgres + RLS + RPCs), react-router-dom, Tailwind.

**Spec:** `docs/superpowers/specs/2026-08-21-comunidade-unified-redesign-design.md`

## Global Constraints

- No automated test framework in this project — verification is manual: SQL run/checked in the Supabase SQL Editor, `npm run build`, and a manual browser walkthrough where a live session is available.
- New SQL goes in one new file, `supabase/migration_comunidade_unified.sql`, run manually via Supabase → SQL Editor → New query → Run (this file existing in the repo does not mean it's live — say so explicitly when done).
- Whenever an RPC's `RETURNS TABLE` shape changes (adding columns to an existing function), use `DROP FUNCTION IF EXISTS ...` followed by `CREATE FUNCTION` — `CREATE OR REPLACE FUNCTION` cannot change a return type. This matches the existing convention in `supabase/migration_community_club_tags.sql`. Brand-new functions use plain `CREATE FUNCTION`.
- `SECURITY DEFINER` SQL-language RPCs follow the existing pattern: `SET search_path = public`, `STABLE` where read-only, `REVOKE ALL ON FUNCTION ... FROM public` + `GRANT EXECUTE ON FUNCTION ... TO authenticated`. The one `plpgsql` RPC (`create_group`) follows `create_organization`'s pattern instead: `REVOKE EXECUTE ON FUNCTION ... FROM anon, public` + `GRANT EXECUTE ... TO authenticated`.
- Constraints on `organizations.kind`/`parent_organization_id` (parent must be a club, not another group; a club never has a parent) are enforced in `create_group`'s `plpgsql` body, not as DB constraints — matching the spec's decision to keep Postgres constraints minimal.
- Groups inherit `is_global`, `open_join`, `points_rules` from their parent club **at creation time only** (copied, not dynamically inherited).
- European Portuguese for all user-facing copy and error messages.
- Follow existing code style in every file touched (Tailwind utility classes already used in the same file, existing comment density/tone).
- Every destructive/leave action (unfollow a club/group, unfollow a player) keeps using `confirm()` before acting — an existing project convention, not new here.
- `player_follows` is intentionally public-readable (`SELECT USING (true))`) — it's social scaffolding (follower/following counts), not a privacy feature.
- Retiring `Clubes.jsx` is a deliberate extension of the spec's own reasoning (Key Decision 3: "one search bar, one list, one place to look") — the page is deleted, not left orphaned behind a removed nav entry. Every existing link/route that pointed at `/clubes` is repointed at `/comunidade`.
- `get_club_profile` additionally gains a `parent_slug TEXT` column beyond what spec section 2.2/4.3 lists for `list_global_organizations`/`search_organizations` — needed because `ClubProfile.jsx`'s breadcrumb links to `/clube/{parent_slug}`, and `parent_name` alone isn't enough to build that link.

---

## Task 1: Database migration — schema, `player_follows`, and RPC changes

**Files:**
- Create: `supabase/migration_comunidade_unified.sql`

**Interfaces:**
- Produces: `organizations.kind TEXT` (`'club'` default, or `'group'`), `organizations.parent_organization_id UUID`; table `player_follows(follower_id, followed_id, created_at)`; RPC `search_organizations(p_query TEXT) RETURNS TABLE (id, name, slug, group_logo_url, kind, parent_organization_id, parent_name, open_join, member_count, my_status)`; RPC `create_group(p_name TEXT, p_slug TEXT, p_parent_org_id UUID, p_admin_user_id UUID) RETURNS UUID`; `list_global_organizations()` widened with `kind, parent_organization_id, parent_name`; `get_player_profile(p_user_id UUID)` widened with `followers_count, following_count, is_following, my_profile`; `get_club_profile(p_slug TEXT)` widened with `kind, parent_organization_id, parent_name, parent_slug`.

- [ ] **Step 1: Write the migration file**

```sql
-- ════════════════════════════════════════════════════════════════════════
-- Migration: Comunidade unificada — merges Clubes into Comunidade, adds
-- "independent groups" as a first-class organizations row, and a lightweight
-- player-follow graph.
--
-- Groups are modeled as organizations rows (kind = 'group') rather than a
-- separate table — they reuse every existing RPC/RLS policy/games FK for
-- free. player_follows is pure RLS (no RPC) since follow has no business
-- rules. See docs/superpowers/specs/2026-08-21-comunidade-unified-redesign-design.md
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. organizations: kind + optional parent (groups only) ────────────────
ALTER TABLE organizations ADD COLUMN kind TEXT NOT NULL DEFAULT 'club'
  CHECK (kind IN ('club', 'group'));
ALTER TABLE organizations ADD COLUMN parent_organization_id UUID
  REFERENCES organizations(id) ON DELETE CASCADE;

-- ── 2. player_follows — pure RLS, no RPC needed (follow has no business
--       rules, unlike club-follow which branches on is_global/open_join). ──
CREATE TABLE player_follows (
  follower_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  followed_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
  PRIMARY KEY (follower_id, followed_id),
  CHECK (follower_id <> followed_id)
);
ALTER TABLE player_follows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Follows are publicly visible"
  ON player_follows FOR SELECT USING (true);

CREATE POLICY "Users can follow others"
  ON player_follows FOR INSERT
  WITH CHECK (auth.uid() = follower_id);

CREATE POLICY "Users can unfollow"
  ON player_follows FOR DELETE
  USING (auth.uid() = follower_id);

-- ── 3. search_organizations — unified search across clubs + groups for the
--       Comunidade search bar. Same visibility rule as list_global_organizations
--       (is_global = TRUE only). ─────────────────────────────────────────
CREATE FUNCTION search_organizations(p_query TEXT)
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
  WHERE o.is_global = TRUE
    AND o.name ILIKE '%' || trim(p_query) || '%'
  ORDER BY o.name
  LIMIT 20;
$$;

REVOKE ALL ON FUNCTION search_organizations(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION search_organizations(TEXT) TO authenticated;

-- ── 4. create_group — two access paths: inside a club (caller must be that
--       club's admin, or a platform admin) or independent (caller must be a
--       platform admin). Inherits is_global/open_join/points_rules from the
--       parent club at creation time only. Atomic: org row + admin
--       membership in one transaction, same shape as create_organization. ──
CREATE FUNCTION create_group(p_name TEXT, p_slug TEXT, p_parent_org_id UUID, p_admin_user_id UUID)
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

    INSERT INTO organizations (name, slug, kind, parent_organization_id, is_global, open_join, points_rules)
    VALUES (p_name, p_slug, 'group', p_parent_org_id, v_parent.is_global, v_parent.open_join, v_parent.points_rules)
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

-- ── 5. list_global_organizations — widen with kind/parent_organization_id/
--       parent_name. Return-shape change → DROP + CREATE, not REPLACE. ─────
DROP FUNCTION IF EXISTS list_global_organizations();

CREATE FUNCTION list_global_organizations()
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
  WHERE o.is_global = TRUE
  ORDER BY o.name;
$$;

REVOKE ALL ON FUNCTION list_global_organizations() FROM public;
GRANT EXECUTE ON FUNCTION list_global_organizations() TO authenticated;

-- ── 6. get_player_profile — widen with follow counts + is_following/
--       my_profile. Return-shape change → DROP + CREATE. ───────────────────
DROP FUNCTION IF EXISTS get_player_profile(UUID);

CREATE FUNCTION get_player_profile(p_user_id UUID)
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
  total_points BIGINT,
  followers_count BIGINT,
  following_count BIGINT,
  is_following BOOLEAN,
  my_profile BOOLEAN
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
  ),
  follow_counts AS (
    SELECT
      (SELECT COUNT(*) FROM player_follows WHERE followed_id = p_user_id) AS followers_count,
      (SELECT COUNT(*) FROM player_follows WHERE follower_id = p_user_id) AS following_count
  ),
  is_following AS (
    SELECT EXISTS(
      SELECT 1 FROM player_follows
      WHERE follower_id = auth.uid() AND followed_id = p_user_id
    ) AS val
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
    club_stats.club_points + private_stats.private_points,
    follow_counts.followers_count,
    follow_counts.following_count,
    (SELECT val FROM is_following),
    p_user_id = auth.uid()
  FROM profiles p, club_stats, private_stats, follow_counts
  WHERE p.id = p_user_id;
$$;

REVOKE ALL ON FUNCTION get_player_profile(UUID) FROM public;
GRANT EXECUTE ON FUNCTION get_player_profile(UUID) TO authenticated;

-- ── 7. get_club_profile — widen with kind/parent_organization_id/
--       parent_name/parent_slug (parent_slug needed so ClubProfile.jsx's
--       breadcrumb can link to /clube/{parent_slug}). Return-shape change
--       → DROP + CREATE. Everything else (visibility rule, open_games
--       shape) is unchanged from migration_club_profile.sql. ──────────────
DROP FUNCTION IF EXISTS get_club_profile(TEXT);

CREATE FUNCTION get_club_profile(p_slug TEXT)
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
    AND (o.is_global = TRUE OR EXISTS (
      SELECT 1 FROM memberships m WHERE m.organization_id = o.id AND m.user_id = auth.uid()
    ));
$$;

REVOKE ALL ON FUNCTION get_club_profile(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION get_club_profile(TEXT) TO authenticated;
```

- [ ] **Step 2: Run the migration**

Supabase → SQL Editor → New query → paste the entire file → Run. Confirm it completes with no errors.

- [ ] **Step 3: Verify with manual SQL checks**

```sql
-- A) New columns exist
SELECT column_name FROM information_schema.columns
WHERE table_name = 'organizations' AND column_name IN ('kind', 'parent_organization_id');
-- expect: 2 rows

-- B) player_follows exists with RLS enabled
SELECT relrowsecurity FROM pg_class WHERE relname = 'player_follows';
-- expect: true

-- C) Existing clubs all default to kind = 'club', parent_organization_id = NULL
SELECT COUNT(*) FROM organizations WHERE kind <> 'club' OR parent_organization_id IS NOT NULL;
-- expect: 0 (no clubs got misclassified by the migration)

-- D) list_global_organizations still returns rows, now with kind/parent_name
SELECT slug, kind, parent_name FROM list_global_organizations() LIMIT 5;

-- E) search_organizations matches by name (pick a real global club's name substring)
SELECT slug, kind FROM search_organizations('<part-of-a-global-club-name>');

-- F) get_player_profile returns the new fields for your own id (my_profile = true, is_following = false)
SELECT name, followers_count, following_count, is_following, my_profile FROM get_player_profile(auth.uid());
-- expect: my_profile = true, is_following = false (can't follow yourself)

-- G) get_club_profile returns kind/parent fields (parent_name/parent_slug NULL for a club)
SELECT slug, kind, parent_name, parent_slug FROM get_club_profile('<a-global-club-slug>');
-- expect: kind = 'club', parent_name and parent_slug both NULL

-- H) create_group — as a club admin, create a group inside your own club
SELECT create_group('Grupo de Teste', 'grupo-de-teste-tmp', '<your-club-org-id>', auth.uid());
-- expect: returns a new UUID, no error

-- I) confirm the group inherited is_global/open_join/points_rules from the parent,
--    and that get_club_profile now shows it with kind='group' + correct parent fields
SELECT slug, kind, parent_name, parent_slug, is_global, open_join FROM get_club_profile('grupo-de-teste-tmp');

-- J) player_follows round trip — follow then unfollow yourself vs. another real user id
INSERT INTO player_follows (follower_id, followed_id) VALUES (auth.uid(), '<another-real-user-id>');
SELECT is_following FROM get_player_profile('<another-real-user-id>');
-- expect: true
DELETE FROM player_follows WHERE follower_id = auth.uid() AND followed_id = '<another-real-user-id>';

-- K) cleanup the test group from step H
DELETE FROM organizations WHERE slug = 'grupo-de-teste-tmp';
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migration_comunidade_unified.sql
git commit -m "feat: add groups (organizations.kind), player_follows, and Comunidade RPCs"
```

---

## Task 2: `src/lib/organizations.js` + `createGroup` wrapper in `platformAdmin.js`

**Files:**
- Create: `src/lib/organizations.js`
- Modify: `src/lib/platformAdmin.js`

**Interfaces:**
- Consumes: RPCs `list_global_organizations`, `search_organizations`, `create_group` (Task 1).
- Produces: `listGlobalOrganizations() => Promise<Array>`, `searchOrganizations(query: string) => Promise<Array>` from `src/lib/organizations.js`; `createGroup(name, slug, parentOrgId, adminUserId) => Promise<string>` added to `src/lib/platformAdmin.js`.

- [ ] **Step 1: Create `src/lib/organizations.js`**

```js
import { supabase } from './supabase'

export const listGlobalOrganizations = async () => {
  const { data, error } = await supabase.rpc('list_global_organizations')
  if (error) throw error
  return data || []
}

export const searchOrganizations = async (query) => {
  const { data, error } = await supabase.rpc('search_organizations', { p_query: query })
  if (error) throw error
  return data || []
}
```

- [ ] **Step 2: Add `createGroup` to `src/lib/platformAdmin.js`**

Add this export at the end of the file, alongside `createOrganization`:

```js
export const createGroup = async (name, slug, parentOrgId, adminUserId) => {
  const { data, error } = await supabase.rpc('create_group', {
    p_name: name,
    p_slug: slug,
    p_parent_org_id: parentOrgId || null,
    p_admin_user_id: adminUserId,
  })
  if (error) throw error
  return data
}
```

- [ ] **Step 3: Verify with `npm run build`**

Run `npm run build` from the repo root and confirm it completes with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/organizations.js src/lib/platformAdmin.js
git commit -m "feat: add organizations search/list lib and createGroup wrapper"
```

---

## Task 3: Retire the "Clubes" tab and page

**Files:**
- Modify: `src/components/Layout.jsx`
- Modify: `src/App.jsx`
- Modify: `src/pages/Home.jsx`
- Modify: `src/pages/ClubProfile.jsx`
- Delete: `src/pages/Clubes.jsx`

**Interfaces:**
- Consumes: route `/comunidade` (existing).
- Produces: nothing new — this task only removes the now-redundant `Clubes` entry point and repoints every internal link that referenced it.

- [ ] **Step 1: Remove the `Clubes` nav entry in `Layout.jsx`**

In `src/components/Layout.jsx`, remove the unused `PadelIcon` import if nothing else in the file uses it — check first: `PadelIcon` is only used in the `navItems` array being edited, so remove the import too.

Change:
```js
import { Home, Users, Trophy, Settings, LogOut, HelpCircle, Phone, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { PrimaryButton, Avatar } from './ui'
import { hashPhone } from '../lib/hashPhone'
import { getGlobalRankings } from '../lib/privateMatches'
import PadelIcon from './icons/PadelIcon'
```
to:
```js
import { Home, Users, Trophy, Settings, LogOut, HelpCircle, Phone, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { PrimaryButton, Avatar } from './ui'
import { hashPhone } from '../lib/hashPhone'
import { getGlobalRankings } from '../lib/privateMatches'
```

Change:
```js
  const navItems = isGuest
    ? [
        { path: '/', icon: Home, label: 'Jogos' },
        { path: '/perfil', label: 'Perfil' },
      ]
    : [
        { path: '/', icon: Home, label: 'Jogos' },
        { path: '/comunidade', icon: Users, label: 'Comunidade' },
        { path: '/clubes', icon: PadelIcon, label: 'Clubes' },
        { path: '/rankings', icon: Trophy, label: 'Rankings' },
        { path: '/perfil', label: 'Perfil' },
      ]
```
to:
```js
  const navItems = isGuest
    ? [
        { path: '/', icon: Home, label: 'Jogos' },
        { path: '/perfil', label: 'Perfil' },
      ]
    : [
        { path: '/', icon: Home, label: 'Jogos' },
        { path: '/comunidade', icon: Users, label: 'Comunidade' },
        { path: '/rankings', icon: Trophy, label: 'Rankings' },
        { path: '/perfil', label: 'Perfil' },
      ]
```

- [ ] **Step 2: Remove the `/clubes` route and `Clubes` import in `App.jsx`**

Change:
```js
import Comunidade from './pages/Comunidade'
import Clubes from './pages/Clubes'
import ClubProfile from './pages/ClubProfile'
```
to:
```js
import Comunidade from './pages/Comunidade'
import ClubProfile from './pages/ClubProfile'
```

Remove this whole `<Route>` block:
```jsx
      <Route
        path="/clubes"
        element={
          <Guard require="member" showSplash={showSplash}>
            <Clubes />
          </Guard>
        }
      />
```

- [ ] **Step 3: Delete `src/pages/Clubes.jsx`**

```bash
git rm src/pages/Clubes.jsx
```

- [ ] **Step 4: Repoint `Home.jsx`'s "Ver Clubes & Grupos" empty state to `/comunidade`**

Change:
```jsx
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
```
to:
```jsx
          title="Ainda não segues nenhum clube"
          subtitle={
            joining
              ? 'A juntar-te ao clube…'
              : 'Descobre clubes e grupos na Comunidade, ou usa um link de convite direto.'
          }
          action={
            !joining && (
              <div className="space-y-4 max-w-xs mx-auto">
                <Link to="/comunidade">
                  <PrimaryButton type="button" className="w-full">
                    Ver Comunidade
                  </PrimaryButton>
                </Link>
```

- [ ] **Step 5: Repoint `ClubProfile.jsx`'s back-links to `/comunidade`**

Change (two occurrences, both identical):
```jsx
        <Link to="/clubes" className="inline-flex items-center gap-1.5 text-ink-700 font-extrabold text-sm hover:underline">
          <ArrowLeft size={16} /> Voltar a Clubes & Grupos
        </Link>
```
to (apply to both — the one inside the `notFound` branch and the one at the top of the normal render):
```jsx
        <Link to="/comunidade" className="inline-flex items-center gap-1.5 text-ink-700 font-extrabold text-sm hover:underline">
          <ArrowLeft size={16} /> Voltar à Comunidade
        </Link>
```

- [ ] **Step 6: Verify with `npm run build`**

Run `npm run build` from the repo root and confirm it completes with no errors (this also catches any remaining reference to the deleted `Clubes.jsx` or unused imports).

- [ ] **Step 7: Manual browser walkthrough**

- Confirm the bottom nav shows exactly Jogos, Comunidade, Rankings, Perfil (+ Gerir for admins) — no "Clubes" tab.
- Visit `/clubes` directly — confirm it 404s / redirects the same way any other unknown route does (no crash).
- As a user with zero club memberships, visit Home — confirm the empty-state button reads "Ver Comunidade" and navigates to `/comunidade`.
- Visit any club's `/clube/:slug` profile — confirm the back-link reads "Voltar à Comunidade" and navigates to `/comunidade`.

- [ ] **Step 8: Commit**

```bash
git add src/components/Layout.jsx src/App.jsx src/pages/Home.jsx src/pages/ClubProfile.jsx
git commit -m "refactor: retire Clubes tab and page, fold into Comunidade"
```

---

## Task 4: `Comunidade.jsx` — unified sectioned page (Jogadores/Clubes/Grupos)

**Files:**
- Modify: `src/pages/Comunidade.jsx`

**Interfaces:**
- Consumes: `searchPlayers`, `listPlayers` from `../lib/privateMatches` (existing, unchanged); `listGlobalOrganizations`, `searchOrganizations` from `../lib/organizations` (Task 2); `useAuth()` → `memberships`, `followOrganization`, `leaveOrganization`, `toggleFavoriteOrganization` (existing, same shapes as `Clubes.jsx` used); `Avatar`, `EmptyState` from `../components/ui` (existing).

- [ ] **Step 1: Replace `src/pages/Comunidade.jsx` entirely**

```jsx
import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Search, Users, UserPlus, Clock, Heart } from 'lucide-react'
import { searchPlayers, listPlayers } from '../lib/privateMatches'
import { searchOrganizations, listGlobalOrganizations } from '../lib/organizations'
import { useAuth } from '../contexts/AuthContext'
import { Avatar, EmptyState } from '../components/ui'

// High enough that for these pilot clubs the browse list is, in practice,
// the whole community — not just a truncated preview.
const BROWSE_LIMIT = 100

export default function Comunidade() {
  const { memberships, followOrganization, leaveOrganization, toggleFavoriteOrganization } = useAuth()
  const [query, setQuery] = useState('')
  const [players, setPlayers] = useState([])
  const [organizations, setOrganizations] = useState([])
  const [loading, setLoading] = useState(true)
  const [actingOn, setActingOn] = useState(null)
  const [favoritingOn, setFavoritingOn] = useState(null)
  const timeoutRef = useRef(null)

  // Re-fetches just the organizations half of the list — used after
  // follow/unfollow/favorite actions so my_status/member_count refresh
  // without re-running the (debounced) player search too.
  const reloadOrganizations = async (trimmedQuery) => {
    try {
      const data = trimmedQuery ? await searchOrganizations(trimmedQuery) : await listGlobalOrganizations()
      setOrganizations(data)
    } catch (error) {
      console.error('Error reloading organizations:', error)
    }
  }

  useEffect(() => {
    const trimmed = query.trim()

    // 1 character: neither a real search nor empty — leave the current
    // list on screen instead of flashing a spinner for a query we won't run.
    if (trimmed.length === 1) return

    setLoading(true)

    if (trimmed.length === 0) {
      Promise.all([listPlayers(BROWSE_LIMIT), listGlobalOrganizations()])
        .then(([playersData, orgsData]) => {
          setPlayers(playersData)
          setOrganizations(orgsData)
        })
        .catch((error) => console.error('Error loading comunidade:', error))
        .finally(() => setLoading(false))
      return
    }

    timeoutRef.current = setTimeout(async () => {
      try {
        const [playersData, orgsData] = await Promise.all([
          searchPlayers(query),
          searchOrganizations(query),
        ])
        setPlayers(playersData)
        setOrganizations(orgsData)
      } catch (error) {
        console.error('Error searching comunidade:', error)
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => clearTimeout(timeoutRef.current)
  }, [query])

  const handleFollow = async (org) => {
    setActingOn(org.id)
    try {
      const { error } = await followOrganization(org.id)
      if (error) throw error
      await reloadOrganizations(query.trim())
    } catch (error) {
      console.error('Error following organization:', error)
      alert('Não foi possível seguir. Tenta novamente.')
    } finally {
      setActingOn(null)
    }
  }

  const handleUnfollow = async (org) => {
    const noun = org.kind === 'group' ? 'grupo' : 'clube'
    if (!confirm(`Deixar de seguir ${org.name}? Deixas de ver os mixs deste ${noun}.`)) return
    setActingOn(org.id)
    try {
      const { error } = await leaveOrganization(org.id)
      if (error) throw error
      await reloadOrganizations(query.trim())
    } catch (error) {
      console.error('Error leaving organization:', error)
      alert(error.message || 'Não foi possível deixar de seguir.')
    } finally {
      setActingOn(null)
    }
  }

  const handleToggleFavorite = async (org, currentlyFavorite) => {
    setFavoritingOn(org.id)
    try {
      const { error } = await toggleFavoriteOrganization(org.id, !currentlyFavorite)
      if (error) throw error
    } catch (error) {
      console.error('Error toggling favorite:', error)
      alert('Não foi possível atualizar o favorito. Tenta novamente.')
    } finally {
      setFavoritingOn(null)
    }
  }

  const clubs = organizations.filter((o) => o.kind === 'club')
  const groups = organizations.filter((o) => o.kind === 'group')
  const totalResults = players.length + organizations.length

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
            <Users size={13} /> {org.member_count} {org.member_count === 1 ? 'membro' : 'membros'}
          </p>
        </div>

        {org.my_status === 'member' ? (
          <>
            <button
              onClick={(e) => { e.preventDefault(); handleToggleFavorite(org, isFavorite) }}
              disabled={favoritingOn === org.id}
              aria-label={isFavorite ? 'Remover dos favoritos' : 'Marcar como favorito'}
              title={isFavorite ? 'Remover dos favoritos' : 'Marcar como favorito — os mixs deste clube aparecem primeiro em Próximos jogos'}
              className="shrink-0 w-11 h-11 min-h-[44px] rounded-full flex items-center justify-center transition-colors duration-fast disabled:opacity-40 hover:bg-ink-50"
            >
              <Heart size={20} className={isFavorite ? 'fill-lime-400 text-lime-400' : 'text-ink-200'} />
            </button>
            <button
              onClick={(e) => { e.preventDefault(); handleUnfollow(org) }}
              disabled={actingOn === org.id}
              className="whitespace-nowrap text-xs font-extrabold px-3 py-2 min-h-[44px] rounded-full bg-ink-50 text-ink-700 hover:bg-ink-200 transition-colors duration-fast disabled:opacity-40"
            >
              A seguir
            </button>
          </>
        ) : org.my_status === 'pending' ? (
          <span className="whitespace-nowrap inline-flex items-center gap-1.5 text-xs font-extrabold px-3 py-2 rounded-full bg-ink-50 text-muted">
            <Clock size={14} /> Pedido enviado
          </span>
        ) : (
          <button
            onClick={(e) => { e.preventDefault(); handleFollow(org) }}
            disabled={actingOn === org.id}
            className="whitespace-nowrap inline-flex items-center gap-1.5 text-xs font-extrabold px-3.5 py-2 min-h-[44px] rounded-full bg-lime-400 text-ink-900 hover:bg-lime-600 transition-colors duration-fast disabled:opacity-40"
          >
            <UserPlus size={14} />
            {org.open_join ? 'Seguir' : 'Pedir para entrar'}
          </button>
        )}
      </Link>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-3xl text-ink-900">Comunidade</h2>
        <p className="text-muted text-sm mt-0.5">
          {loading ? 'A carregar…' : `${totalResults} resultado${totalResults === 1 ? '' : 's'} na comunidade`}
        </p>
      </div>

      <div className="flex items-center gap-2 input-field">
        <Search size={16} className="text-muted shrink-0" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Procurar jogador, clube ou grupo..."
          className="flex-1 bg-transparent outline-none text-sm"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-ink-50 border-t-ink-700"></div>
        </div>
      ) : totalResults === 0 ? (
        <EmptyState
          icon={Users}
          title="Nada encontrado"
          subtitle={query.trim() ? 'Tenta outro nome.' : 'Ainda não há ninguém na comunidade.'}
        />
      ) : (
        <div className="space-y-6">
          {players.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-extrabold text-ink-900 uppercase tracking-wide">Jogadores</h3>
              <div className="card p-0 overflow-hidden divide-y divide-line">
                {players.map((player) => (
                  <Link
                    key={player.id}
                    to={`/jogador/${player.id}`}
                    className="flex items-center gap-3 px-4 py-3 transition-colors duration-fast hover:bg-ink-50"
                  >
                    <Avatar name={player.name} url={player.avatar_url} size="w-10 h-10 text-sm" />
                    <div className="flex-1 min-w-0">
                      <p className="font-extrabold text-ink-900 text-sm truncate">{player.name}</p>
                      {player.club_names && (
                        <p className="text-[11px] font-extrabold uppercase tracking-widest text-lime-700 truncate mt-0.5">
                          {player.club_names}
                        </p>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

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
    </div>
  )
}
```

- [ ] **Step 2: Verify with `npm run build`**

Run `npm run build` from the repo root and confirm it completes with no errors.

- [ ] **Step 3: Manual browser walkthrough**

- Visit `/comunidade` with an empty query — confirm Jogadores/Clubes/Grupos sections render (Grupos only if at least one group exists — create one via Task 8 first if needed to check this section), each only when it has results.
- Type a 1-character query — confirm nothing changes (no flash).
- Type a real player name — confirm the Jogadores section narrows correctly and Clubes/Grupos also narrow via `search_organizations`.
- Type a query matching a group's name — confirm it shows up under "Grupos" with "Grupo dentro de {clube}" beneath its name.
- As a member of a club/group, tap the Heart favorite button and the "A seguir" unfollow button on a row — confirm neither triggers navigation into the profile page, and both behave the same as they did in the old `Clubes.jsx`.
- Tap a club/group row's body — confirm it navigates to `/clube/:slug`.
- Tap a player row — confirm it navigates to `/jogador/:id`.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Comunidade.jsx
git commit -m "feat: unify Comunidade with players/clubs/groups sections and search"
```

---

## Task 5: `ClubProfile.jsx` — group support (breadcrumb + hide club-only fields)

**Files:**
- Modify: `src/pages/ClubProfile.jsx`

**Interfaces:**
- Consumes: `getClubProfile` (existing, `src/lib/clubProfile.js` — no change needed there, it already does `data?.[0] || null` and the new `kind`/`parent_organization_id`/`parent_name`/`parent_slug` fields flow through automatically once Task 1's migration is live).

- [ ] **Step 1: Add the breadcrumb when viewing a group, and hide club-only fields**

Add `Building2` to the existing `lucide-react` import:
```js
import { ArrowLeft, Users, UserPlus, Clock, Heart, MapPin, Phone, Instagram, Globe, Calendar } from 'lucide-react'
```
becomes:
```js
import { ArrowLeft, Users, UserPlus, Clock, Heart, MapPin, Phone, Instagram, Globe, Calendar, Building2 } from 'lucide-react'
```

Insert a breadcrumb right after the "Voltar à Comunidade" link and before the header card (right after Task 3 Step 5's updated back-link, before the `<div className="card flex items-center gap-3.5">` header block):

```jsx
      {club.kind === 'group' && club.parent_slug && (
        <Link
          to={`/clube/${club.parent_slug}`}
          className="inline-flex items-center gap-1.5 text-sm font-extrabold text-lime-700 hover:underline"
        >
          <Building2 size={14} /> Grupo dentro de {club.parent_name}
        </Link>
      )}

      <div className="card flex items-center gap-3.5">
```

Wrap the location section so it only renders for clubs:

Change:
```jsx
      {club.location && (
        <div className="card">
          <h3 className="text-sm font-extrabold text-ink-900 uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <MapPin size={15} /> Localização
          </h3>
          <p className="text-ink-900">{club.location}</p>
        </div>
      )}

      {(club.phone || club.instagram || club.website) && (
```
to:
```jsx
      {club.kind === 'club' && club.location && (
        <div className="card">
          <h3 className="text-sm font-extrabold text-ink-900 uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <MapPin size={15} /> Localização
          </h3>
          <p className="text-ink-900">{club.location}</p>
        </div>
      )}

      {club.kind === 'club' && (club.phone || club.instagram || club.website) && (
```

- [ ] **Step 2: Verify with `npm run build`**

Run `npm run build` from the repo root and confirm it completes with no errors.

- [ ] **Step 3: Manual browser walkthrough** (create a group via Task 8's UI first, inside a club whose profile you can view)

- Visit a group's `/clube/:slug` — confirm the "Grupo dentro de {clube}" breadcrumb appears above the header and links to the parent club's own `/clube/:slug`.
- Confirm Localização/Contactos sections don't render for the group, even if the underlying `location`/`phone`/`instagram`/`website` columns happen to be non-null (inherited data would only ever come from manual DB edits, but the `kind === 'club'` guard must hold regardless).
- Visit a regular club's `/clube/:slug` — confirm no breadcrumb appears and Localização/Contactos still render exactly as before.
- Visit an independent group (created via `Gerir.jsx`, Task 7 — `parent_organization_id` is `NULL`) — confirm no breadcrumb appears (since there's no parent to link to).

- [ ] **Step 4: Commit**

```bash
git add src/pages/ClubProfile.jsx
git commit -m "feat: show group breadcrumb and hide club-only fields on ClubProfile"
```

---

## Task 6: `PlayerDetails.jsx` — follow button + follower/following counts

**Files:**
- Modify: `src/pages/PlayerDetails.jsx`

**Interfaces:**
- Consumes: `useAuth()` → `profile` (existing); RPC `get_player_profile` (Task 1, now returns `followers_count`, `following_count`, `is_following`, `my_profile`); table `player_follows` (Task 1) via direct `supabase.from(...)` calls, same pattern as `toggleFavoriteOrganization` in `AuthContext.jsx`.

- [ ] **Step 1: Add `useAuth` import and follow-toggle state/handler**

Change:
```js
import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Trophy, Target, Award, Swords, ChevronDown } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { PrimaryButton, LevelBadge, EmptyState, Avatar } from '../components/ui'
import { winRatePct } from '../lib/statsLogic'
```
to:
```js
import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Trophy, Target, Award, Swords, ChevronDown, UserPlus } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { PrimaryButton, LevelBadge, EmptyState, Avatar } from '../components/ui'
import { winRatePct } from '../lib/statsLogic'
```

Change:
```js
export default function PlayerDetails() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [player, setPlayer] = useState(null)
  const [loading, setLoading] = useState(true)
```
to:
```js
export default function PlayerDetails() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [player, setPlayer] = useState(null)
  const [loading, setLoading] = useState(true)
  const [followActing, setFollowActing] = useState(false)
```

Add this handler right after `loadPlayer` (before `loadH2h`):
```js
  const handleFollowToggle = async () => {
    setFollowActing(true)
    try {
      if (player.is_following) {
        if (!confirm(`Deixar de seguir ${player.name}?`)) {
          setFollowActing(false)
          return
        }
        const { error } = await supabase
          .from('player_follows')
          .delete()
          .eq('follower_id', profile.id)
          .eq('followed_id', id)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('player_follows')
          .insert({ follower_id: profile.id, followed_id: id })
        if (error) throw error
      }
      await loadPlayer()
    } catch (error) {
      console.error('Error toggling follow:', error)
      alert('Não foi possível atualizar. Tenta novamente.')
    } finally {
      setFollowActing(false)
    }
  }
```

- [ ] **Step 2: Add the follow button + counts to the Hero card**

Change:
```jsx
          <h2 className="text-2xl text-white">{player.name}</h2>
          {/* level is only ever populated when the viewer shares a club
              with this player — club-scoped and meaningless otherwise */}
          {player.level && (
            <div className="mt-2.5">
              <LevelBadge level={player.level} size="md" />
            </div>
          )}
        </div>
      </div>
```
to:
```jsx
          <h2 className="text-2xl text-white">{player.name}</h2>
          {/* level is only ever populated when the viewer shares a club
              with this player — club-scoped and meaningless otherwise */}
          {player.level && (
            <div className="mt-2.5">
              <LevelBadge level={player.level} size="md" />
            </div>
          )}
          <p className="text-white/60 text-xs mt-2.5">
            {player.followers_count} {player.followers_count === 1 ? 'seguidor' : 'seguidores'} · {player.following_count} a seguir
          </p>
          {!player.my_profile && (
            <button
              onClick={handleFollowToggle}
              disabled={followActing}
              className={`mt-3 inline-flex items-center gap-1.5 text-xs font-extrabold px-3.5 py-2 min-h-[36px] rounded-full transition-colors duration-fast disabled:opacity-40 ${
                player.is_following
                  ? 'bg-white/10 text-white hover:bg-white/20'
                  : 'bg-lime-400 text-ink-900 hover:bg-lime-600'
              }`}
            >
              <UserPlus size={14} />
              {player.is_following ? 'A seguir' : 'Seguir'}
            </button>
          )}
        </div>
      </div>
```

- [ ] **Step 3: Verify with `npm run build`**

Run `npm run build` from the repo root and confirm it completes with no errors.

- [ ] **Step 4: Manual browser walkthrough**

- Visit your own `/jogador/:id` — confirm no follow button appears (`my_profile` is true), and the follower/following counts still show.
- Visit another player's `/jogador/:id` — confirm the "Seguir" button appears, tap it, confirm it flips to "A seguir" and `followers_count` increments by one.
- Tap "A seguir" again — confirm the `confirm()` dialog appears, confirm accepting it flips the button back to "Seguir" and decrements the count.
- Reload the page — confirm the follow state and counts persist (came from the DB, not local-only state).

- [ ] **Step 5: Commit**

```bash
git add src/pages/PlayerDetails.jsx
git commit -m "feat: add player follow button and follower/following counts"
```

---

## Task 7: `Gerir.jsx` — platform admin can create independent groups

**Files:**
- Modify: `src/pages/Gerir.jsx`

**Interfaces:**
- Consumes: `createGroup` from `../lib/platformAdmin` (Task 2).

- [ ] **Step 1: Import `createGroup` and add a `kind` toggle to the create form**

Change:
```js
import { searchAnyPlayer, createOrganization } from '../lib/platformAdmin'
```
to:
```js
import { searchAnyPlayer, createOrganization, createGroup } from '../lib/platformAdmin'
```

Add `kind` state alongside the other create-form state:
```js
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [selectedAdmin, setSelectedAdmin] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [createdClub, setCreatedClub] = useState(null)
```
becomes:
```js
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [kind, setKind] = useState('club')
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [selectedAdmin, setSelectedAdmin] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [createdClub, setCreatedClub] = useState(null)
```

Add `kind` reset to `resetCreateForm`:
```js
  const resetCreateForm = () => {
    setShowCreateForm(false)
    setName('')
    setSlug('')
    setSelectedAdmin(null)
    setError('')
  }
```
becomes:
```js
  const resetCreateForm = () => {
    setShowCreateForm(false)
    setKind('club')
    setName('')
    setSlug('')
    setSelectedAdmin(null)
    setError('')
  }
```

- [ ] **Step 2: Branch `handleCreate` on `kind`**

Change:
```js
  const handleCreate = async () => {
    setError('')
    setSaving(true)
    try {
      const newSlug = slug.trim()
      await createOrganization(name.trim(), newSlug, selectedAdmin.id)
```
to:
```js
  const handleCreate = async () => {
    setError('')
    setSaving(true)
    try {
      const newSlug = slug.trim()
      if (kind === 'club') {
        await createOrganization(name.trim(), newSlug, selectedAdmin.id)
      } else {
        await createGroup(name.trim(), newSlug, null, selectedAdmin.id)
      }
```

The rest of `handleCreate` (the `if (selectedAdmin.id === profile?.id)` navigation branch and the catch block) stays unchanged — both `createOrganization` and `createGroup` create exactly one admin membership for `selectedAdmin.id`, so the same post-creation logic applies to both.

- [ ] **Step 3: Add the kind toggle to the form JSX**

Change:
```jsx
          <h3 className="font-extrabold text-ink-900">Criar novo clube</h3>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Nome</label>
```
to:
```jsx
          <h3 className="font-extrabold text-ink-900">Criar novo clube ou grupo</h3>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setKind('club')}
              className={`flex-1 text-sm font-extrabold py-2.5 rounded-ctrl border transition-colors duration-fast ${
                kind === 'club' ? 'bg-ink-900 text-white border-ink-900' : 'bg-surface text-ink-700 border-line'
              }`}
            >
              Clube
            </button>
            <button
              type="button"
              onClick={() => setKind('group')}
              className={`flex-1 text-sm font-extrabold py-2.5 rounded-ctrl border transition-colors duration-fast ${
                kind === 'group' ? 'bg-ink-900 text-white border-ink-900' : 'bg-surface text-ink-700 border-line'
              }`}
            >
              Grupo independente
            </button>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Nome</label>
```

Update the placeholder text and button label to stay generic:
```jsx
              placeholder="ex: Padel Clube Lisboa"
```
to:
```jsx
              placeholder={kind === 'club' ? 'ex: Padel Clube Lisboa' : 'ex: Torneio de Verão'}
```

```jsx
              placeholder="ex: padel-clube-lisboa"
```
to:
```jsx
              placeholder={kind === 'club' ? 'ex: padel-clube-lisboa' : 'ex: torneio-de-verao'}
```

```jsx
            <PrimaryButton
              onClick={handleCreate}
              disabled={!name.trim() || !slug.trim() || !selectedAdmin || saving}
              className="flex-1"
            >
              {saving ? 'A criar…' : 'Criar clube'}
            </PrimaryButton>
```
to:
```jsx
            <PrimaryButton
              onClick={handleCreate}
              disabled={!name.trim() || !slug.trim() || !selectedAdmin || saving}
              className="flex-1"
            >
              {saving ? 'A criar…' : kind === 'club' ? 'Criar clube' : 'Criar grupo'}
            </PrimaryButton>
```

- [ ] **Step 4: Verify with `npm run build`**

Run `npm run build` from the repo root and confirm it completes with no errors.

- [ ] **Step 5: Manual browser walkthrough** (requires a live session as a platform admin)

- Open `/gerir`, "Criar novo clube" panel — confirm the Clube/Grupo independente toggle appears, defaulting to Clube.
- Fill in name/slug/admin with "Clube" selected, submit — confirm it still creates a club exactly as before (unchanged behavior).
- Switch to "Grupo independente", fill in name/slug/admin, submit — confirm it succeeds and the new row appears in the clubs list (platform admins see every organization, including groups, since `allOrganizations` selects from the whole table).
- Visit the new group's `/clube/:slug` — confirm `kind = 'group'`, no breadcrumb (no parent), and Localização/Contactos are hidden (Task 5).

- [ ] **Step 6: Commit**

```bash
git add src/pages/Gerir.jsx
git commit -m "feat: platform admin can create independent groups from Gerir"
```

---

## Task 8: `GerirClube.jsx` — club admin can create a group inside their club

**Files:**
- Modify: `src/pages/GerirClube.jsx`

**Interfaces:**
- Consumes: `createGroup` from `../lib/platformAdmin` (Task 2); `org.id` (existing, resolved earlier in the component).

- [ ] **Step 1: Import `createGroup`, add a local slug sanitizer, and add group-creation state**

Change:
```js
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useGooglePlacesAutocomplete } from '../lib/useGooglePlacesAutocomplete'
import { uploadClubLogo, removeClubLogo } from '../lib/clubLogoStorage'
import { DateField, DateTimeField, Avatar } from '../components/ui'
import { totalRounds, FORMAT_LABEL } from '../lib/mixLogic'

// datetime-local <-> stored timestamptz helpers (keeps Portugal wall-clock)
const toLocalInput = (d) => {
```
to:
```js
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useGooglePlacesAutocomplete } from '../lib/useGooglePlacesAutocomplete'
import { uploadClubLogo, removeClubLogo } from '../lib/clubLogoStorage'
import { createGroup } from '../lib/platformAdmin'
import { DateField, DateTimeField, Avatar } from '../components/ui'
import { totalRounds, FORMAT_LABEL } from '../lib/mixLogic'

const sanitizeSlug = (value) => value.toLowerCase().replace(/[^a-z0-9-]/g, '')

// datetime-local <-> stored timestamptz helpers (keeps Portugal wall-clock)
const toLocalInput = (d) => {
```

Add state near the existing `logoError` state:
```js
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [logoError, setLogoError] = useState('')
```
becomes:
```js
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [logoError, setLogoError] = useState('')
  const [showCreateGroup, setShowCreateGroup] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [groupSlug, setGroupSlug] = useState('')
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [groupError, setGroupError] = useState('')
  const [createdGroupName, setCreatedGroupName] = useState(null)
```

- [ ] **Step 2: Add `handleCreateGroup`**

Add this handler right after `handleTogglePrivateMatches`:
```js
  const handleCreateGroup = async () => {
    setGroupError('')
    setCreatingGroup(true)
    try {
      await createGroup(groupName.trim(), groupSlug.trim(), org.id, currentUser.id)
      setCreatedGroupName(groupName.trim())
      setShowCreateGroup(false)
      setGroupName('')
      setGroupSlug('')
    } catch (error) {
      console.error('Error creating group:', error)
      const message = error?.message || ''
      if (message.toLowerCase().includes('duplicate key value violates unique constraint') || message.toLowerCase().includes('slug')) {
        setGroupError('Já existe um clube ou grupo com este identificador — escolhe outro')
      } else {
        setGroupError('Não foi possível criar o grupo. Tenta novamente.')
      }
    } finally {
      setCreatingGroup(false)
    }
  }
```

- [ ] **Step 3: Add the "Criar grupo" section to the Definições tab**

Insert this new section right after the closing `</form>` tag and before the "Funcionalidades da app" section:

Change:
```jsx
              </form>

              <div className="mt-6 pt-6 border-t border-gray-200">
                <h4 className="text-base font-semibold text-ink-900 mb-1">
                  Funcionalidades da app
                </h4>
```
to:
```jsx
              </form>

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
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={groupName}
                      onChange={(e) => setGroupName(e.target.value)}
                      className="input-field"
                      placeholder="Nome do grupo"
                    />
                    <input
                      type="text"
                      value={groupSlug}
                      onChange={(e) => setGroupSlug(sanitizeSlug(e.target.value))}
                      className="input-field"
                      placeholder="slug-do-grupo"
                    />
                    {groupError && (
                      <p className="text-danger text-sm font-extrabold">{groupError}</p>
                    )}
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={handleCreateGroup}
                        disabled={!groupName.trim() || !groupSlug.trim() || creatingGroup}
                        className="btn-primary flex-1"
                      >
                        {creatingGroup ? 'A criar…' : 'Criar grupo'}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setShowCreateGroup(false); setGroupName(''); setGroupSlug(''); setGroupError('') }}
                        disabled={creatingGroup}
                        className="btn-secondary flex-1"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
                {createdGroupName && (
                  <p className="text-sm text-ok font-extrabold mt-3">Grupo "{createdGroupName}" criado com sucesso!</p>
                )}
              </div>

              <div className="mt-6 pt-6 border-t border-gray-200">
                <h4 className="text-base font-semibold text-ink-900 mb-1">
                  Funcionalidades da app
                </h4>
```

- [ ] **Step 4: Verify with `npm run build`**

Run `npm run build` from the repo root and confirm it completes with no errors.

- [ ] **Step 5: Manual browser walkthrough** (requires a live session as a club admin)

- Open `/gerir/<your-club-slug>` → Definições, scroll to "Grupos dentro deste clube" — confirm the "Criar grupo dentro deste clube" button appears.
- Click it, fill in name/slug, submit — confirm the success message appears and the form collapses back to the button.
- Try submitting a slug that collides with an existing club/group's slug — confirm the duplicate-slug error message appears.
- Visit the new group's `/clube/:slug` — confirm `kind = 'group'`, the breadcrumb reads "Grupo dentro de {this club's name}" and links back correctly (Task 5), and you (the club admin) are its admin (check via `/gerir/<group-slug>` — should load normally, not "Sem acesso").
- Confirm the group shows up under "Grupos" in `/comunidade` (Task 4) with the correct parent label.

- [ ] **Step 6: Commit**

```bash
git add src/pages/GerirClube.jsx
git commit -m "feat: club admin can create a group inside their club"
```

---

## Self-review

**Spec coverage:**
- `organizations.kind`/`parent_organization_id` columns → Task 1, Step 1 §1.
- `player_follows` table + RLS (public SELECT, self-scoped INSERT/DELETE, no RPC) → Task 1, Step 1 §2.
- `search_organizations` RPC → Task 1, Step 1 §3.
- `create_group` RPC (two access paths, inherits `is_global`/`open_join`/`points_rules` at creation, atomic org+membership insert) → Task 1, Step 1 §4.
- `list_global_organizations` widened with `kind`/`parent_organization_id`/`parent_name` → Task 1, Step 1 §5.
- `get_player_profile` widened with `followers_count`/`following_count`/`is_following`/`my_profile` → Task 1, Step 1 §6.
- `get_club_profile` widened with `kind`/`parent_organization_id`/`parent_name` (+ `parent_slug`, a spec gap filled per Global Constraints) → Task 1, Step 1 §7.
- One migration file, `supabase/migration_comunidade_unified.sql` → Task 1.
- `Layout.jsx` — remove `Clubes` nav entry → Task 3, Step 1.
- `Comunidade.jsx` — sectioned Jogadores/Clubes/Grupos, debounced search, parallel browse/search calls, "Grupo dentro de {parent}" label, same follow/request/member button pattern as old `Clubes.jsx` → Task 4.
- `ClubProfile.jsx` → group support: breadcrumb + hidden club-only fields → Task 5.
- `PlayerDetails.jsx` — follow button + counts → Task 6.
- `Gerir.jsx` — platform admin `kind` toggle, calls `create_group` for groups → Task 7.
- `GerirClube.jsx` — "Criar grupo dentro deste clube" section, calls `create_group` with `p_parent_org_id = org.id` → Task 8.
- `src/lib/platformAdmin.js` `createGroup` wrapper → Task 2, Step 2.
- Player follows public by design, groups reuse existing RLS (no new org-scoped RLS needed) → reflected in Task 1's RLS policy (`USING (true)`) and the absence of any new RLS on `organizations`/`memberships` for groups anywhere in this plan.
- Group admins managing join requests / groups having their own mixes — explicitly out of scope in the spec, confirmed no task builds anything new here (existing `membership_requests`/`games.organization_id` machinery just works because groups are `organizations` rows).
- Nested groups blocked — enforced in `create_group`'s `v_parent.kind <> 'club'` check (Task 1, Step 1 §4).
- "Clubes" tab removed entirely (not left alongside Comunidade) — Task 3, plus the deliberate extension (documented in Global Constraints) of also deleting `Clubes.jsx` and repointing every link that pointed at `/clubes`.
No gaps found.

**Placeholder scan:** No "TBD", "add appropriate error handling", "write tests for the above", or "similar to Task N" phrasing anywhere in the plan — every step has literal code, literal SQL, or literal manual-verification instructions.

**Type consistency:** `listGlobalOrganizations()`/`searchOrganizations(query)` (Task 2, Step 1) return exactly what `list_global_organizations()`/`search_organizations(p_query)` produce (Task 1, Step 1 §§3,5) — `Comunidade.jsx` (Task 4) consumes `id, name, slug, group_logo_url, kind, parent_organization_id, parent_name, open_join, member_count, my_status` under those same names, matching what `renderOrgRow` reads. `createGroup(name, slug, parentOrgId, adminUserId)` (Task 2, Step 2) matches the `create_group(p_name, p_slug, p_parent_org_id, p_admin_user_id)` RPC signature (Task 1, Step 1 §4) positionally, and both call sites — `Gerir.jsx`'s `createGroup(name.trim(), newSlug, null, selectedAdmin.id)` (Task 7, Step 2) and `GerirClube.jsx`'s `createGroup(groupName.trim(), groupSlug.trim(), org.id, currentUser.id)` (Task 8, Step 2) — pass arguments in that same order. `get_player_profile`'s new columns (Task 1, Step 1 §6: `followers_count, following_count, is_following, my_profile`) are read under those exact names in `PlayerDetails.jsx` (Task 6, Step 2). `get_club_profile`'s new columns (Task 1, Step 1 §7: `kind, parent_organization_id, parent_name, parent_slug`) are read under those exact names in `ClubProfile.jsx` (Task 5, Step 1) and in `Comunidade.jsx`'s org rows (`org.kind`, `org.parent_name`) which come from the same-shaped `list_global_organizations`/`search_organizations`. Every file that imports something deleted or renamed in Task 3 (`Clubes.jsx`, the `/clubes` route, `PadelIcon` in `Layout.jsx`) has its import list updated in that same task's steps — no dangling import remains.
