# Self-Serve Groups — Design Spec

## Goal

Let any authenticated player create their own group ("mix") without any
admin involvement — no club, no platform admin, no invite from an existing
tenant. Trello card #106 asks for this as the foundation for eventually
opening group creation to the general public; that "open to everyone"
decision is explicitly out of scope here (per the card) — this spec only
builds the technical path and its guardrails: one group per user, capped at
30 members / 3 concurrent active mixes / 4 courts per mix, no billing.

This is the third attempt at a "group that isn't tied to a club" concept.
The first (`2026-08-21-comunidade-unified-redesign-design.md`) added
`organizations.kind`/`parent_organization_id` and let a platform admin
create a parentless group — nobody ever did, and the UI section was removed
as permanently empty (`4d4498d`, 2026-08-26). The second
(`2026-08-26-club-scoped-groups-design.md`) scoped groups to a parent club,
managed by that club's admin. Both are untouched by this spec. What failed
before wasn't the data model — it was that creation was always gated to an
admin role a regular player doesn't have. This spec keeps the model and
removes that gate, for a distinct, explicitly-marked subset of groups.

## Key Decisions

**Why reuse `organizations`/`kind='group'` instead of a new table?**
`games.organization_id` is a hard foreign key to `organizations` — the
moment a self-serve group creates its first mix, it needs a row there
regardless. A separate table wouldn't avoid that dependency, it would just
add a second bookkeeping layer on top of it, for nothing. Reusing
`organizations` gives mix creation, rosters, results, and rankings-exclusion
machinery for free, same reasoning the original groups spec used.

**Why a new `self_serve` column instead of relying on `kind='group'` +
`parent_organization_id IS NULL`?**
That exact shape already means something: the original, still-dormant
independent-group path (`create_group` with `p_parent_org_id = NULL`,
gated by `is_platform_admin`). Nothing in this spec touches that path — per
the club-scoped-groups spec's own §6, it's explicitly out of scope and keeps
whatever behavior it has. An explicit `self_serve BOOLEAN` avoids the two
concepts becoming ambiguous later (e.g. if a platform admin ever does use
the old path) and gives every new check in this spec a single, unambiguous
condition to test.

**Why hardcoded limit constants instead of `plan_tier`/`subscriptions`
tables?**
The card's draft mentions building that scaffold now even without billing.
Only one tier exists today (free), and there is no committed billing design
yet — building multi-tier schema for a shape that doesn't exist yet is
exactly the kind of speculative design this repo's principles warn against.
The limits (30 members / 3 active mixes / 4 courts) live as literal
constants inside the RPCs/policy that check them. When a second tier or
real billing arrives, that's a new migration and its own design — this one
doesn't need to guess its shape in advance.

**Why approval-gated join (`membership_requests`) instead of instant
join-by-link?**
Matches the join model club-scoped groups already use, and gives the
30-member cap a single choke point to enforce at (approval time), rather
than needing a race-safe check on a public, unauthenticated-feeling instant
join.

**Why enforce limits at the RLS/RPC layer, not in the frontend?**
Per this project's standing rule: security and business limits live in
Postgres, not component conditionals — a limit only enforced in the UI is
not a limit, it's a suggestion anyone calling the table/RPC directly can
ignore.

## 1 — Data Model Changes

```sql
ALTER TABLE organizations ADD COLUMN self_serve BOOLEAN NOT NULL DEFAULT FALSE;
```

Invariant (enforced by `create_self_serve_group` being the only writer of
`self_serve = TRUE`, not a DB constraint — matching this repo's existing
convention of enforcing cross-column shape at the application/RPC level):
`self_serve = TRUE` implies `kind = 'group'`, `parent_organization_id IS
NULL`, `is_global = FALSE`, `open_join = FALSE`.

## 2 — New / Modified RPCs and Policies

### 2.1 `create_self_serve_group(p_name TEXT, p_slug TEXT)` — NEW

`SECURITY DEFINER`, callable by any authenticated user (no admin gate).
Refuses if the caller already admins a `self_serve` group:

```sql
CREATE FUNCTION create_self_serve_group(p_name TEXT, p_slug TEXT)
RETURNS UUID AS $$
DECLARE
  v_org_id UUID;
BEGIN
  IF EXISTS (
    SELECT 1 FROM memberships m
    JOIN organizations o ON o.id = m.organization_id
    WHERE m.user_id = auth.uid() AND m.is_admin AND o.self_serve
  ) THEN
    RAISE EXCEPTION 'Já és admin de um grupo self-serve';
  END IF;

  INSERT INTO organizations (name, slug, kind, parent_organization_id, self_serve, is_global, open_join)
  VALUES (p_name, p_slug, 'group', NULL, TRUE, FALSE, FALSE)
  RETURNING id INTO v_org_id;

  INSERT INTO memberships (user_id, organization_id, is_admin)
  VALUES (auth.uid(), v_org_id, TRUE);

  RETURN v_org_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION create_self_serve_group(TEXT, TEXT) FROM anon, public;
GRANT EXECUTE ON FUNCTION create_self_serve_group(TEXT, TEXT) TO authenticated;
```

### 2.2 `follow_organization(p_organization_id UUID)` — MODIFY

Add a `self_serve` branch alongside the existing club-scoped-group branch,
so joining doesn't hit the `is_global` refusal that's correct for a stranger
joining a private club but wrong here (self-serve groups are always
private by design):

```sql
  IF v_kind = 'group' AND v_parent_id IS NOT NULL THEN
    -- (existing club-scoped-group branch, unchanged)
    ...
  ELSIF v_kind = 'group' AND v_parent_id IS NULL AND v_self_serve THEN
    -- always request — self-serve groups are always private/approval-gated
    INSERT INTO membership_requests (user_id, organization_id)
    VALUES (auth.uid(), p_organization_id)
    ON CONFLICT (user_id, organization_id) WHERE (status = 'pending') DO NOTHING;
    RETURN 'pending';
  ELSE
    -- (existing club / legacy-independent-group branch, unchanged)
    ...
```

(`v_self_serve` fetched in the same initial `SELECT ... INTO` as `v_kind`,
`v_parent_id`, etc.) Legacy independent groups (`self_serve = FALSE`,
`parent_organization_id IS NULL`) fall through to the unchanged `ELSE`
branch exactly as before.

### 2.3 `approve_membership_request(p_request_id UUID)` — MODIFY

Add the 30-member cap as the single enforcement point — a request can stay
pending indefinitely, but approving it is refused once the group is full:

```sql
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Pedido não encontrado ou já resolvido';
  END IF;
  IF NOT is_org_admin(v_org_id) THEN
    RAISE EXCEPTION 'Apenas admins podem aprovar pedidos';
  END IF;
  IF EXISTS (SELECT 1 FROM organizations WHERE id = v_org_id AND self_serve)
     AND (SELECT COUNT(*) FROM memberships WHERE organization_id = v_org_id) >= 30 THEN
    RAISE EXCEPTION 'Grupo já atingiu o limite de 30 membros';
  END IF;
  -- (existing INSERT INTO memberships / UPDATE membership_requests, unchanged)
```

### 2.4 `"Org admins can create games"` RLS policy on `games` — MODIFY

Add the active-mix and courts-per-mix caps directly in the `WITH CHECK`,
scoped so they only ever fire for `self_serve` organizations:

```sql
DROP POLICY "Org admins can create games" ON games;
CREATE POLICY "Org admins can create games"
  ON games FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM memberships
      WHERE memberships.organization_id = games.organization_id
        AND memberships.user_id = auth.uid() AND memberships.is_admin
    )
    AND (
      NOT EXISTS (SELECT 1 FROM organizations WHERE id = games.organization_id AND self_serve)
      OR (
        num_courts <= 4
        AND (SELECT COUNT(*) FROM games g2
             WHERE g2.organization_id = games.organization_id
               AND g2.status NOT IN ('finished', 'cancelled')) < 3
      )
    )
  );
```

Clubs, club-scoped groups, and legacy independent groups are unaffected —
the added clause is a no-op unless `self_serve = TRUE`.

## 3 — Frontend Changes

### 3.1 `Comunidade.jsx` — "Criar o meu grupo" entry point

New card/button, visible to any logged-in user. If the user doesn't already
admin a `self_serve` group: a small form (name, slug) calling
`create_self_serve_group`, then navigate to `/gerir/<slug>`. If they already
do: show "O meu grupo" linking straight to it instead of another creation
option — enforces one-per-user visibly, not just server-side.

### 3.2 Reuse `/gerir/<slug>` and `/clube/<slug>` as-is

No new admin page. `GerirClube.jsx` and `ClubProfile.jsx` already branch on
`kind`/`parent_organization_id` and already work for a parentless
`kind='group'` org (kept working deliberately by the club-scoped-groups
spec for exactly this kind of case). The only change: gate
club-only/group-nesting sections (public-directory toggle, `points_rules`
customization, "Grupos dentro deste clube") on `!org.self_serve`, since none
of those apply to a self-serve group.

### 3.3 Mix creation form — no new client-side gating

The RLS policy (§2.4) is the actual enforcement. The existing create-game
error handling (toast on a failed insert) already surfaces whatever
Postgres raises — no new code path needed, just a friendlier error message
mapping if the current generic handler doesn't already show one.

## 4 — Migration Scope

New file: `supabase/migration_self_serve_groups.sql`, containing, in order:
1. `ALTER TABLE organizations ADD COLUMN self_serve` (§1)
2. `CREATE FUNCTION create_self_serve_group` (§2.1)
3. `CREATE OR REPLACE FUNCTION follow_organization` (§2.2)
4. `CREATE OR REPLACE FUNCTION approve_membership_request` (§2.3)
5. `DROP POLICY` + `CREATE POLICY "Org admins can create games"` (§2.4)

**Prerequisite check before running this migration:** `list_global_organizations`,
`search_organizations`, and `get_organization_rankings` only exclude
`kind='group'` rows (keeping self-serve groups out of the public directory
and rankings) if `migration_club_scoped_groups.sql` is already live. If it
isn't, run both together — otherwise a self-serve group becomes publicly
listed the moment it's created, defeating the "always private" design here.

Per this repo's standing convention: this file existing in the repo does
not mean it's live — it must be pasted into Supabase → SQL Editor and run.

## 5 — Testing

- `create_self_serve_group`: succeeds for a fresh user; raises for a user
  who already admins a `self_serve` org.
- `follow_organization` on a `self_serve` group: always lands in `'pending'`
  regardless of `is_global`; unaffected orgs (clubs, club-scoped groups,
  legacy independent groups) behave exactly as before.
- `approve_membership_request`: succeeds below 30 members; raises at
  exactly 30 existing members; non-`self_serve` orgs are never capped.
- `games` insert: succeeds for a `self_serve` org at `num_courts = 4` with 2
  existing active (`status NOT IN ('finished','cancelled')`) games; raises
  at `num_courts = 5`; raises on a 4th concurrent active mix. Non-
  `self_serve` orgs: unaffected regression check (no cap at all).

## 6 — Open Items / Out of Scope

- **Public "open to everyone" launch:** explicitly deferred per the card —
  this spec only builds the mechanism, gated behind however the app decides
  to surface the "Criar o meu grupo" entry point (e.g. a feature flag or
  soft rollout is a separate, later decision).
- **WhatsApp bot integration:** out of scope. Self-serve groups use the app
  only; wiring the bot in is a separate effort (it's a manually-deployed
  per-club process today, no self-serve deploy path exists).
- **Billing / paid tiers:** out of scope. No `plan_tier`/`subscriptions`
  scaffold is built now (see Key Decisions); a future tiered-billing effort
  gets its own design and migration.
- **Legacy independent groups** (`self_serve = FALSE`, `parent_organization_id
  IS NULL`, created via the old platform-admin-only `create_group` path):
  untouched, per the club-scoped-groups spec's own §6.
- **Deleting a self-serve group / transferring its admin:** not designed
  here. Since it's one group per user, a user who wants to disband and start
  over currently has no path to do so — flagged as a real gap, but a
  follow-up rather than a blocker for the initial creation path.
