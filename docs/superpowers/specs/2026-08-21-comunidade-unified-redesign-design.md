# Comunidade Unificada — Design Spec

## Goal

Merge the "Clubes" bottom-tab and current "Comunidade" (players directory) into a single "Comunidade" tab that lets users discover and interact with three entity types — players, clubs, and the new "independent groups" — under one roof. This reduces the bottom nav from five tabs to four, introduces a lightweight player-follow graph, and creates a new first-class entity type (groups) that shares the existing multi-tenant infrastructure with clubs.

## Key Decisions

**Why model groups as organizations (not a separate `groups` table)?**  
A group is structurally identical to a club — it has members, creates mixes, has point rules, and uses the same follow/join/request machinery. The only differences are (a) who may create it, and (b) it optionally lives inside another organization. Adding two columns to `organizations` (`kind`, `parent_organization_id`) gives all existing RPCs, RLS policies, and `games` foreign keys for free. A separate `groups`+`group_members` table would duplicate all of that.

**Why follow is pure RLS, not SECURITY DEFINER?**  
Player-follow is a simple user ↔ user toggle. Unlike club-follow (which must branch on `is_global` and `open_join` inside a single RPC), follow has no business rules — you follow, or you don't. RLS with `INSERT ... WITH CHECK` / `DELETE ... USING` is sufficient, consistent with the project's principle that the DB is the security boundary, and avoids an unnecessary RPC.

**Why remove the "Clubes" tab entirely rather than keeping it alongside Comunidade?**  
The two tabs show the same kind of content — lists of entities you can browse and act on. Having two navigation points for discoverable entities means the user has to guess which tab to look in. One search bar, one list, one place to look — fewer clicks, simpler mental model.

---

## 1 — Data Model Changes

### 1.1 `organizations`: two new columns

```sql
ALTER TABLE organizations ADD COLUMN kind TEXT NOT NULL DEFAULT 'club'
  CHECK (kind IN ('club', 'group'));
ALTER TABLE organizations ADD COLUMN parent_organization_id UUID
  REFERENCES organizations(id) ON DELETE CASCADE;
```

**Constraints (enforced at the application/RPC level, not as DB constraints, to keep Postgres constraints minimal — matching existing conventions in this codebase):**
- A row with `kind = 'group'` and `parent_organization_id` set must have its parent's `kind = 'club'` (not nested groups).
- A row with `kind = 'club'` must have `parent_organization_id = NULL` (enforced by DEFAULT; the app never sets it for clubs).
- Groups inherit `is_global`, `open_join`, `points_rules` from the parent club at creation time (copied, not inherited dynamically — simpler, avoids cascade-update complexity).

### 1.2 `player_follows`: new table

```sql
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
```

No RPC needed — the frontend calls `supabase.from('player_follows').insert/delete()` directly. The `SELECT` policy is public so any authenticated user can see who follows whom, enabling follower counts on profiles without extra RPCs.

---

## 2 — New / Modified RPCs

### 2.1 `search_organizations(p_query TEXT)` — NEW

Unified search across clubs and groups for the Comunidade search bar.

```sql
RETURNS TABLE (
  id            UUID,
  name          TEXT,
  slug          TEXT,
  group_logo_url TEXT,
  kind          TEXT,
  parent_organization_id UUID,
  parent_name   TEXT,
  open_join     BOOLEAN,
  member_count  BIGINT,
  my_status     TEXT
)
-- SECURITY DEFINER, same pattern as list_global_organizations
WHERE o.is_global = TRUE
  AND o.name ILIKE '%' || trim(p_query) || '%'
ORDER BY o.name
LIMIT 20;
```

Returns `parent_name` (the parent club's name) when the group has a parent — used in the Comunidade UI to show "Grupo dentro de {clube}" without a second query.

### 2.2 `list_global_organizations()` — MODIFY

Add `kind`, `parent_organization_id`, and `parent_name` to the existing return set. Existing rows all have `kind = 'club'` and `parent_organization_id = NULL` (set by DEFAULT in migration 1.1), so this is backwards-compatible — no frontend changes needed yet.

### 2.3 `get_player_profile(p_user_id UUID)` — MODIFY

Add four fields to the existing return set: `followers_count BIGINT`, `following_count BIGINT`, `is_following BOOLEAN` (whether `auth.uid()` follows this user), `my_profile BOOLEAN` (whether `p_user_id = auth.uid()`).

```sql
-- new CTEs added to existing function body:
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
-- these join alongside existing club_stats, private_stats, shared_level CTEs
-- and are selected into the final SELECT list
```

### 2.4 `create_group(p_name, p_slug, p_parent_org_id, p_admin_user_id)` — NEW

Creates a group. Two access paths:
- `p_parent_org_id` is set (group inside a club): caller must be `is_org_admin(p_parent_org_id)` or `is_platform_admin`. Copies `is_global` and `open_join` from parent (inherited at creation; parent admin can flip them later).
- `p_parent_org_id` is NULL (independent group): caller must be `is_platform_admin`. Same access model as `create_organization`.

Atomic: inserts the `organizations` row and a `memberships` row for the admin in one transaction.

---

## 3 — Migration Scope

One new migration file: `supabase/migration_comunidade_unified.sql`

Contains:
1. `ALTER TABLE organizations ADD COLUMN kind ... ADD COLUMN parent_organization_id ...`
2. `CREATE TABLE player_follows` + RLS policies
3. `CREATE FUNCTION search_organizations`
4. `CREATE FUNCTION create_group`
5. `CREATE OR REPLACE FUNCTION list_global_organizations` (modified — adds 3 columns)
6. `CREATE OR REPLACE FUNCTION get_player_profile` (modified — adds 4 fields)

---

## 4 — Frontend Changes

### 4.1 `Layout.jsx` — Remove "Clubes" tab

Remove the `Clubes` entry from `navItems` in `src/components/Layout.jsx`. The remaining tabs are: Jogos, Comunidade, Rankings, Perfil (+ Gerir for admins).

### 4.2 `Comunidade.jsx` — Unified page with search and sections

Replace the current flat player list with a sectioned layout:

**State:**
```ts
query: string                          // search input
players: {id, name, avatar_url, club_names}[]
organizations: {id, name, slug, group_logo_url, kind, parent_organization_id, parent_name, open_join, member_count, my_status}[]
```

**Behavior:**
- Empty query → show `listPlayers(100)` for players, `list_global_organizations()` for clubs/groups (both loaded in parallel on mount, same as today's pattern).
- Non-empty query (debounced 300ms) → `search_players(query)` + `search_organizations(query)` in parallel.
- Three section headers: "Jogadores", "Clubes", "Grupos". Each section only renders if it has results.
- Each club/group row shows: avatar, name, "(Grupo dentro de {parent_name})" if parent exists, member count, and the follow/request/member status button (exact same UI pattern as `Clubes.jsx` lines 96–143 — extracted into a reusable `OrgFollowButton` component, or duplicated given it's only ~30 lines).
- Player rows: same as today (`Link` to `/jogador/:id`).

### 4.3 `ClubProfile.jsx` → generalize to `OrgProfile.jsx`

Rename/refactor to handle both clubs and groups at `/clube/:slug` (no route change — slugs are unique across all organizations regardless of `kind`).

Differences by `kind`:
- `kind = 'group'`: show a breadcrumb-style label "Grupo dentro de {parent_name}" linking to `/clube/{parent_slug}`. Hide `location`, `phone`, `instagram`, `website` fields (only relevant to physical clubs).
- `kind = 'club'`: show as today.

`getClubProfile` RPC: add `kind`, `parent_organization_id`, `parent_name` to return set. The `follow_organization` / `leave_organization` / `membership_requests` RPCs already accept a generic `p_organization_id` and work unchanged.

### 4.4 `PlayerDetails.jsx` — Follow button + counts

Add a "Seguir"/"A seguir" button next to the existing header. On click:
- `is_following = false` → `supabase.from('player_follows').insert({ follower_id: auth.uid(), followed_id: id })`
- `is_following = true` → confirm("Deixar de seguir?"), then `supabase.from('player_follows').delete().eq(...)`

Show `followers_count` and `following_count` from `get_player_profile`.

### 4.5 `Gerir.jsx` — Platform admin can create independent groups

Extend the existing "Criar novo clube" form: add a toggle or radio to select `kind = 'club'` or `kind = 'group'`. When `group`, `parent_organization_id = NULL` and the same `create_group` RPC is called (not `create_organization`).

### 4.6 `GerirClube.jsx` — Club admin can create groups inside their club

New section/button "Criar grupo dentro deste clube" visible only when the caller is admin. Opens a minimal form (name, slug). Calls `create_group(p_name, p_slug, p_parent_org_id = current_club_id, p_admin_user_id)`.

### 4.7 `src/lib/platformAdmin.js` — Add `createGroup` wrapper

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

---

## 5 — Visibility / RLS Considerations

**Player follows — public by design:** The `player_follows` SELECT policy is `USING (true)` so any authenticated user can see follows. This is intentional — it's social scaffolding (followers/following counts on profiles), not a privacy feature. All data returned is already visible elsewhere (profiles, match results).

**Groups are not in a separate RLS silo:** Because groups are `organizations` rows, they're already covered by every existing `memberships`-based RLS policy. No new RLS rules are needed for groups specifically — the `kind` column is a business-logic differentiator, not an access-control boundary.

---

## 6 — Open Items / Out of Scope

- **Group admins managing join requests:** Uses the existing `list_membership_requests` / `approve_membership_request` / `reject_membership_request` RPCs unchanged. When a group's `open_join = false`, requests go into `membership_requests` and the group's admin(s) see them in `GerirClube` already.
- **Groups with their own mixes:** Already works — `games.organization_id` references `organizations(id)` and a group's id is just another row in that table.
- **Nested groups (group inside a group):** Explicitly blocked by design (see constraint in 1.1). If needed later, change the constraint — but current requirement is groups-inside-clubs only.
- **Discovering a group via its parent club's profile:** Not in this iteration. A group shows up in Comunidade search independently; linking from club profile to its groups is a future enhancement.
