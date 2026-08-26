# Club-Scoped Groups — Design Spec

## Goal

Groups (`organizations` rows with `kind='group'`, introduced in
`2026-08-21-comunidade-unified-redesign-design.md`) are structurally linked to
their parent club (`parent_organization_id`) but don't *feel* linked: each
group is a fully independent tenant with its own `/gerir/<slug>` management
page, shows up as its own public card in Comunidade and Rankings, is joinable
by anyone via the same public directory a club uses, and a club admin has no
authority over a group unless they personally hold a membership in it. This
spec closes that gap: groups become something a club admin manages *from
inside the club*, membership is always approval-gated, group contents are
hidden from club members who aren't in the group, and a club's own mix
creation form can target a specific group.

Concretely, this fixes: an M5 player in a club should not be able to see who's
in, or join without approval, an "M4" group that exists inside that same
club — today they could discover and auto/self-request-join it through the
public directory like any other club.

## Key Decisions

**Why extend `is_org_admin` instead of a new "club admin of this group" check?**
`is_org_admin(org_id)` already gates nearly every RLS policy and RPC that
touches games, mixes, memberships, requests, and invites (27 call sites).
Adding "OR admin of `org_id`'s parent" to its single definition gives a club
admin full control over every child group everywhere that already checks
`is_org_admin`, with no per-policy duplication — consistent with this repo's
existing debt note about not copy-pasting the same `EXISTS` check when a
shared helper can be extended instead.

**Why force `open_join = FALSE` on every group rather than let it inherit
the parent club's setting?**
`create_group` currently copies `is_global`/`open_join`/`points_rules` from
the parent at creation time. Groups are how a club subdivides itself by
level/team/tournament — auto-join defeats the purpose (the M5-into-M4
scenario). Every group's join flow goes through `membership_requests`,
regardless of whether the parent club itself is open-join.

**Why a new `list_club_groups` RPC instead of widening `organizations`
RLS?**
The direct `organizations` SELECT policy is membership-only by design — that
stays untouched. What's needed is a controlled peek: any club member can see
that a group exists (name, id, my own join status) without being a member of
it, but only actual group members (or the club admin, via the `is_org_admin`
extension) get its member list, mixes, or ratings. A SECURITY DEFINER RPC
returning two different shapes based on the caller's relationship to each
group — same pattern already used by `list_global_organizations` and
`get_club_profile` — is the natural fit; a raw RLS policy can't express
"visible but shallow vs. visible and deep" in one row shape.

**Why keep the group's standalone `/gerir/<slug>` and `/clube/<slug>` routes
working instead of removing them?**
A user could be a group's admin without being their parent club's admin (the
creator of a group becomes its admin even when a platform admin created it
on someone else's behalf). Removing the standalone route would strand that
person. The inline panel in `GerirClube.jsx` becomes the primary path; the
standalone routes stay as a secondary path, with their visibility tightened
(see §3).

**Why does `follow_organization` need a group-specific branch?**
It currently refuses any org where `is_global = FALSE` ("Este clube não é
público") — correct for its original purpose (a stranger joining a public
club via the directory), but wrong for a group: a group's `is_global` no
longer drives any visibility decision after this change (§2.5–§2.8), and a
club member requesting to join a sibling group inside a *private*
(`is_global = FALSE`) club must still work. The fix is a dedicated branch —
allowed when the caller already holds a membership in the group's parent
club, regardless of the group's own `is_global` value.

**Why not restructure `games`/mixes at all?**
A mix already belongs to exactly one `organization_id`, and a group is just
another row in `organizations` — creating a mix "for a group" already means
nothing more than inserting with that group's id. The only real gap is that
today you can only do that by switching your admin context to the group's
own page; the fix is a scope picker on the existing form, not a schema
change.

---

## 1 — Data Model Changes

None. `organizations.kind` / `parent_organization_id`, `memberships`,
`membership_requests`, and `games.organization_id` already support
everything here. This is entirely an RLS/RPC/UI change.

---

## 2 — New / Modified RPCs and Functions

### 2.1 `is_org_admin(p_organization_id UUID)` — MODIFY

```sql
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
```

Ripples intentionally through every existing policy/RPC that calls
`is_org_admin`: a club admin gains admin rights over a child group's
memberships, requests, games/mixes, and settings, without touching those
policies individually.

### 2.2 `create_group(p_name, p_slug, p_parent_org_id, p_admin_user_id)` — MODIFY

One-line change: when `p_parent_org_id IS NOT NULL`, insert with
`open_join = FALSE` instead of `v_parent.open_join`. Independent groups
(`p_parent_org_id IS NULL`, platform-admin-only path) are unaffected —
out of scope for this change (see §6).

### 2.3 `list_club_groups(p_club_id UUID)` — NEW

```sql
CREATE FUNCTION list_club_groups(p_club_id UUID)
RETURNS TABLE (
  id UUID,
  name TEXT,
  slug TEXT,
  group_logo_url TEXT,
  my_status TEXT,        -- 'member' | 'admin' | 'pending' | 'none'
  can_manage BOOLEAN,     -- true if is_org_admin(id) — controls whether the
                           -- panel shows member list / requests / settings
  member_count BIGINT,    -- NULL unless can_manage or my_status IN ('member','admin')
  avg_rating NUMERIC      -- NULL unless can_manage or my_status IN ('member','admin')
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
```

Caller must be a member of the club itself (checked in the `WHERE`) —
non-club-members get zero rows, same "can't confirm existence" shape used
elsewhere in this codebase. Rating is global per player (`profiles.rating`,
from `migration_elo_rating.sql`), not per-membership, so `avg_rating` here
averages each group member's global rating — the same source `GroupLevelBadge`
already reads elsewhere (per `2026-08-25-elo-ranking-design.md`).

### 2.4 `follow_organization(p_organization_id UUID)` — MODIFY

```sql
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
    -- open_join is always FALSE for club-scoped groups (§2.2) — always the
    -- request branch, regardless of is_global.
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
```

Same signature and return values (`'joined'` / `'pending'`) as today, so
`followOrganization` in `AuthContext.jsx` needs no change — `GerirClube.jsx`'s
group panel (§3.1) calls it exactly like `Comunidade.jsx` already does for
clubs. Independent groups (`parent_organization_id IS NULL`) fall through to
the unchanged `ELSE` branch — still gated on `is_global`/`open_join` as
before (out of scope, §6).

### 2.5 `list_global_organizations()` — MODIFY

Add `WHERE o.is_global = TRUE AND o.kind = 'club'`. Groups stop appearing in
the public directory (Comunidade, Rankings' "Clubes & Grupos") entirely.

### 2.6 `search_organizations(p_query TEXT)` — MODIFY

Same filter: add `AND o.kind = 'club'`. (Superseded either way once
`list_global_organizations`/`search_organizations` no longer need to carry
`kind`/`parent_organization_id`/`parent_name` for groups — those columns can
stay in the return shape for forward-compatibility but will always be
`'club'`/`NULL`/`NULL` after this change.)

### 2.7 `get_organization_rankings()` — MODIFY

Rankings.jsx's "Clubes & Grupos" tab calls this RPC (`getOrganizationRankings`
in `src/lib/organizations.js`), not `list_global_organizations` — a separate
function with its own `WHERE o.is_global = TRUE` (no `kind` filter today).
Add `AND o.kind = 'club'` here too, and align its `avg_rating` subquery with
`list_club_groups` (§2.3) by keeping its existing `m.is_guest = FALSE`
filter — no other change.

### 2.8 `get_club_profile(p_slug TEXT)` — MODIFY

Change the visibility `WHERE` clause to branch on `kind`:

```sql
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
```

A group's standalone public page now requires being a member (or the club
admin, via §2.1) — `is_global` no longer grants a stranger access to a
group's page, closing the same hole `list_club_groups` closes for the
directory.

---

## 3 — Frontend Changes

### 3.1 `GerirClube.jsx` — "Grupos dentro deste clube" becomes real

Replace the current create-only section (screenshot: name/slug form, no
listing) with:
- `list_club_groups(org.id)` loaded alongside the page's other admin data.
- Each group renders as a row (avatar, name, member count + rating **only**
  if `can_manage` or `my_status` is `member`/`admin` — otherwise just the
  name and a status pill: "Membro", "Pedido pendente", or a "Pedir para
  entrar" button that calls `follow_organization(group.id)`).
- Expanding a row a caller `can_manage` opens a panel reusing existing
  patterns already in this file: pending requests (`list_membership_requests`
  + approve/reject), member list, and a "Criar mix para este grupo" shortcut
  that opens the same create-game form pre-scoped to that group (see 3.2).
- The existing "Criar grupo dentro deste clube" form stays, now feeding the
  list above instead of a dead end.

### 3.2 `GerirClube.jsx` — scope picker on "Criar novo jogo"

The create-game form (around the existing `EMPTY_GAME_FORM` / submit handler
at `handleCreateGame`) gains one new field: "Âmbito" — a select defaulting to
"Todo o clube" (`org.id`), populated with the club's groups from
`list_club_groups` (only ones the admin `can_manage`, i.e. can actually
create mixes in). The submit handler's `organization_id: currentOrganizationId`
becomes `organization_id: selectedScopeId` (defaulting to
`currentOrganizationId`). No other change to the insert — the row lands in
`games` scoped to whichever org was picked, and existing RLS/read paths
already isolate it correctly.

### 3.3 `Comunidade.jsx` — drop the "Grupos" section

With `list_global_organizations`/`search_organizations` now club-only (§2.5,
§2.6), the "Grupos" section of Comunidade naturally renders empty — remove
the section and its heading rather than leaving a permanently-empty block.
Independent groups (§6) are explicitly out of scope, so this section has no
remaining content to show under any circumstances after this change.

### 3.4 `Rankings.jsx` — "Clubes & Grupos" tab

Its data source is `get_organization_rankings` (§2.7), not
`list_global_organizations` — a separate RPC, now also club-only. Rename the
tab label from "Clubes & Grupos" to "Clubes" and drop the
`org.kind === 'group' ? 'Grupo' : 'Clube'` branch (always "Clube" now, for
organizations returned by this RPC).

### 3.5 `ClubProfile.jsx`

No structural change — it already branches on `kind` for a group's
breadcrumb/hidden-fields rendering (per the prior spec). It now simply
receives fewer group visits from public sources (since groups aren't listed
publicly), and `get_club_profile` returning zero rows for a non-member
group visit is already handled by the existing "not found" empty state.

---

## 4 — Visibility / RLS Summary

| Who | Sees group exists (name) | Sees members/mixes/ratings | Can approve join requests / edit settings |
|---|---|---|---|
| Non-club-member | No (`list_club_groups` requires club membership; `get_club_profile` requires group membership or club-admin) | No | No |
| Club member, not in group | Yes | No | No |
| Group member | Yes | Yes (that group only) | No, unless also group admin |
| Group admin | Yes | Yes | Yes (that group) |
| Club admin | Yes | Yes (every group, via `is_org_admin` extension) | Yes (every group) |
| Platform admin | Yes | Yes | Yes |

---

## 5 — Migration Scope

One new migration file: `supabase/migration_club_scoped_groups.sql`

Contains, in order:
1. `CREATE OR REPLACE FUNCTION is_org_admin` (§2.1)
2. `CREATE OR REPLACE FUNCTION create_group` (§2.2 — `open_join = FALSE` for
   club-scoped groups)
3. `CREATE FUNCTION list_club_groups` (§2.3)
4. `CREATE OR REPLACE FUNCTION follow_organization` (§2.4)
5. `CREATE OR REPLACE FUNCTION list_global_organizations` (§2.5)
6. `CREATE OR REPLACE FUNCTION search_organizations` (§2.6)
7. `CREATE OR REPLACE FUNCTION get_organization_rankings` (§2.7)
8. `CREATE OR REPLACE FUNCTION get_club_profile` (§2.8)

Per this repo's convention, this file existing in the repo does not mean
it's live — it must be pasted into Supabase → SQL Editor and run before any
of the frontend changes in §3 will work end-to-end.

No backfill needed: per product confirmation, any groups created so far are
treated as unused/throwaway; existing group rows simply pick up the new
`open_join = FALSE` behavior only for *future* group creations (already-
created groups keep whatever `open_join` they were created with, unless an
admin flips it — acceptable since there's no real usage to disrupt).

---

## 6 — Open Items / Out of Scope

- **Independent groups** (`kind='group'`, `parent_organization_id = NULL`,
  created via `Gerir.jsx` by a platform admin): entirely untouched by this
  spec. They keep whatever visibility/join behavior they have today. If a
  future request wants them hidden from Comunidade too, that's a separate
  decision (platform admins may specifically want those discoverable).
- **Nested groups:** still blocked by the existing `create_group` constraint
  (`v_parent.kind <> 'club'` raises). Not revisited here.
- **Notifying a group admin of a new join request:** out of scope — requests
  surface in the existing `list_membership_requests` panel; no push/email
  notification is being added.
- **Migrating/preserving existing group data:** explicitly out of scope per
  product decision (§5).
