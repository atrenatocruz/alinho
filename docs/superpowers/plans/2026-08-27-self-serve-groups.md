# Self-Serve Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any authenticated player create their own group ("mix") with no admin/club involvement — capped at one group per user, 30 members, 3 concurrent active mixes, 4 courts per mix, no billing.

**Architecture:** One SQL migration adds an `organizations.self_serve` marker column, a new `create_self_serve_group` RPC (no admin gate, one-per-user check in the function body), a `follow_organization` branch so joining a self-serve group always lands in the existing `membership_requests` approval queue, a member-cap check inside `approve_membership_request`, and an active-mix/courts-per-mix cap folded into the existing `games` INSERT RLS policy. The frontend adds one entry point ("Criar o meu grupo") in `Comunidade.jsx` and hides two club-only settings in `GerirClube.jsx` when viewing a self-serve group — both pages already fully support a parentless `kind='group'` organization, per the prior club-scoped-groups work.

**Tech Stack:** React (Vite SPA), Supabase (Postgres + RLS + RPCs), react-router-dom.

**Spec:** `docs/superpowers/specs/2026-08-27-self-serve-groups-design.md`

## Global Constraints

- No automated test framework in this project — verification is manual: SQL run/checked in the Supabase SQL Editor, and the frontend checked via `npm run build` plus a manual browser walkthrough where a live session is available.
- New SQL goes in one new file, `supabase/migration_self_serve_groups.sql`, run manually via Supabase → SQL Editor → New query → Run (one-file-per-feature convention already used by every other `supabase/migration_*.sql` file in this repo).
- **Prerequisite (confirmed live):** `migration_club_scoped_groups.sql` is already running in production, so `list_global_organizations`, `search_organizations`, and `get_organization_rankings` already filter to `kind = 'club'` — self-serve groups (`kind = 'group'`) are automatically excluded from the public directory and rankings with no further RPC changes needed in this plan.
- Limits are hardcoded constants, not a `plan_tier`/`subscriptions` table: 30 members, 3 concurrent active mixes (`games.status NOT IN ('finished', 'cancelled')`), 4 courts per mix (`games.num_courts <= 4`).
- `self_serve = TRUE` implies `kind = 'group'`, `parent_organization_id IS NULL`, `is_global = FALSE`, `open_join = FALSE` — enforced by `create_self_serve_group` being the only writer of `self_serve = TRUE`, not a DB constraint (matches this repo's existing convention for `organizations.kind`/`parent_organization_id` invariants).
- One self-serve group per user, checked in `create_self_serve_group`'s function body (no DB constraint).
- European Portuguese for all user-facing copy and error messages.
- Follow existing code style in every file touched (Tailwind utility classes already used in the same file, existing comment density/tone).
- Out of scope, do not implement: WhatsApp bot integration, any billing/plan-tier schema, public "open to everyone" rollout gating, deleting/leaving a self-serve group (existing `leave_organization` already blocks a sole admin from leaving, which a self-serve creator always is — no new capability added here).

---

## Task 1: Database migration — `self_serve` column, `create_self_serve_group`, join/approval/cap enforcement

**Files:**
- Create: `supabase/migration_self_serve_groups.sql`

**Interfaces:**
- Produces: `organizations.self_serve BOOLEAN` (default `FALSE`); RPC `create_self_serve_group(p_name TEXT, p_slug TEXT) RETURNS UUID`.
- Modifies (same signatures, no caller-visible change): `follow_organization(p_organization_id UUID) RETURNS TEXT`, `approve_membership_request(p_request_id UUID) RETURNS void`, and the `"Org admins can create games"` RLS policy on `games`.

- [ ] **Step 1: Write the migration file**

```sql
-- ════════════════════════════════════════════════════════════════════════
-- Migration: self-serve groups — any authenticated player can create their
-- own group (organizations row, kind='group', parent_organization_id NULL),
-- capped at one per user, 30 members, 3 concurrent active mixes, 4 courts
-- per mix. No billing/plan-tier schema — limits are hardcoded here.
-- See docs/superpowers/specs/2026-08-27-self-serve-groups-design.md
--
-- Prerequisite: migration_club_scoped_groups.sql must already be live
-- (list_global_organizations / search_organizations / get_organization_rankings
-- already filter kind='club' — that's what keeps self-serve groups, which
-- are kind='group', out of the public directory and rankings).
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. organizations gains self_serve — marks a group created via the new
--       self-serve path, distinct from the older, still-dormant
--       platform-admin-only "independent group" path (create_group with
--       p_parent_org_id = NULL), which this migration does not touch. ──────
ALTER TABLE organizations ADD COLUMN self_serve BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 2. create_self_serve_group — any authenticated user, no admin gate.
--       Refuses if the caller already admins a self-serve group (one per
--       user). Atomically inserts the organizations row and the caller's
--       admin membership, same pattern as create_organization/create_group. ──
CREATE OR REPLACE FUNCTION create_self_serve_group(p_name TEXT, p_slug TEXT)
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

-- ── 3. follow_organization — add a self-serve branch so joining doesn't
--       hit the is_global refusal (self-serve groups are always private by
--       design); every join is a request, same approval queue as any
--       other org. Club-scoped-group and club/legacy-independent-group
--       branches are unchanged. ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION follow_organization(p_organization_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_kind TEXT;
  v_parent_id UUID;
  v_is_global BOOLEAN;
  v_open_join BOOLEAN;
  v_self_serve BOOLEAN;
BEGIN
  SELECT kind, parent_organization_id, is_global, open_join, self_serve
    INTO v_kind, v_parent_id, v_is_global, v_open_join, v_self_serve
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
  ELSIF v_kind = 'group' AND v_parent_id IS NULL AND v_self_serve THEN
    NULL; -- always falls through to the membership_requests INSERT below
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

-- ── 4. approve_membership_request — add the 30-member cap. A request can
--       stay pending indefinitely; approving it is refused once a
--       self-serve group already has 30 members. ──────────────────────────
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
  IF EXISTS (SELECT 1 FROM organizations WHERE id = v_org_id AND self_serve)
     AND (SELECT COUNT(*) FROM memberships WHERE organization_id = v_org_id) >= 30 THEN
    RAISE EXCEPTION 'Grupo já atingiu o limite de 30 membros';
  END IF;

  INSERT INTO memberships (user_id, organization_id)
  VALUES (v_user_id, v_org_id)
  ON CONFLICT (user_id, organization_id) DO NOTHING;

  UPDATE membership_requests
  SET status = 'approved', resolved_at = NOW(), resolved_by = auth.uid()
  WHERE id = p_request_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── 5. games INSERT policy — add the active-mix and courts-per-mix caps,
--       scoped so they only ever fire for self_serve organizations. Clubs,
--       club-scoped groups, and legacy independent groups are unaffected. ──
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

- [ ] **Step 2: Run the migration**

Supabase → SQL Editor → New query → paste the entire file → Run. Confirm it completes with no errors.

- [ ] **Step 3: Verify with manual SQL checks**

```sql
-- A) self_serve exists, defaults to false
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'organizations' AND column_name = 'self_serve';
-- expect: one row, data_type = boolean, column_default mentions false

-- B) Pick three existing profile ids to use below (any three real users work):
SELECT id, name FROM profiles LIMIT 3;
-- call them <creator-id>, <joiner-id>, <third-id>

-- C) As <creator-id> (impersonate via `SET request.jwt.claims` in the SQL
--    editor, or trust the guard logic and inspect it manually if
--    impersonation isn't set up):
SELECT create_self_serve_group('Grupo de Teste', 'grupo-de-teste');
-- expect: returns a UUID, no error

SELECT id, name, slug, kind, parent_organization_id, self_serve, is_global, open_join
FROM organizations WHERE slug = 'grupo-de-teste';
-- expect: one row, kind='group', parent_organization_id NULL, self_serve=true,
--         is_global=false, open_join=false

SELECT user_id, organization_id, is_admin FROM memberships
WHERE organization_id = (SELECT id FROM organizations WHERE slug = 'grupo-de-teste');
-- expect: one row, user_id = <creator-id>, is_admin = true

-- D) One-per-user: <creator-id> tries to create a second self-serve group
SELECT create_self_serve_group('Segundo Grupo', 'segundo-grupo');
-- expect: error 'Já és admin de um grupo self-serve'

-- E) As <joiner-id>: request to join the self-serve group
SELECT follow_organization((SELECT id FROM organizations WHERE slug = 'grupo-de-teste'));
-- expect: returns 'pending' (not an is_global error), and a row appears in
-- membership_requests:
SELECT status FROM membership_requests
WHERE organization_id = (SELECT id FROM organizations WHERE slug = 'grupo-de-teste')
  AND user_id = '<joiner-id>';
-- expect: one row, status = 'pending'

-- F) As <creator-id>: approve the request
SELECT approve_membership_request(
  (SELECT id FROM membership_requests
   WHERE organization_id = (SELECT id FROM organizations WHERE slug = 'grupo-de-teste')
     AND user_id = '<joiner-id>')
);
-- expect: no error; <joiner-id> now has a memberships row for the group

-- G) 30-member cap: temporarily lower the threshold to something reachable
--    for a manual test, OR just confirm the guard logic reads correctly by
--    inserting 29 more dummy memberships pointing at real profile ids and
--    confirming the 31st approval raises 'Grupo já atingiu o limite de 30
--    membros' while the 30th succeeds. (If seeding 30 real users isn't
--    practical, treat this as a code-inspection check instead: the COUNT(*)
--    ">= 30" comparison is against the live memberships table with no
--    off-by-one, since the row being approved is inserted only *after*
--    this check.)

-- H) Courts-per-mix cap: as <creator-id>, try creating a mix with more than
--    4 courts for the self-serve group. `title` and `date` are NOT NULL
--    with no default — include them so a failure below is unambiguously
--    the RLS policy, not an unrelated constraint violation.
INSERT INTO games (organization_id, title, date, num_courts, created_by, status)
VALUES ((SELECT id FROM organizations WHERE slug = 'grupo-de-teste'), 'Mix 1', NOW() + INTERVAL '1 day', 5, '<creator-id>', 'open');
-- expect: error — RLS policy violation (row-level security policy
-- "Org admins can create games")

INSERT INTO games (organization_id, title, date, num_courts, created_by, status)
VALUES ((SELECT id FROM organizations WHERE slug = 'grupo-de-teste'), 'Mix 1', NOW() + INTERVAL '1 day', 4, '<creator-id>', 'open');
-- expect: succeeds (1st active mix, 4 courts is exactly the cap)

-- I) Active-mix cap: insert two more active mixes (status 'open'), then
--    confirm a 4th is refused:
INSERT INTO games (organization_id, title, date, num_courts, created_by, status)
VALUES ((SELECT id FROM organizations WHERE slug = 'grupo-de-teste'), 'Mix 2', NOW() + INTERVAL '2 days', 1, '<creator-id>', 'open');
INSERT INTO games (organization_id, title, date, num_courts, created_by, status)
VALUES ((SELECT id FROM organizations WHERE slug = 'grupo-de-teste'), 'Mix 3', NOW() + INTERVAL '3 days', 1, '<creator-id>', 'open');
-- expect: both succeed (2nd and 3rd active mix)
INSERT INTO games (organization_id, title, date, num_courts, created_by, status)
VALUES ((SELECT id FROM organizations WHERE slug = 'grupo-de-teste'), 'Mix 4', NOW() + INTERVAL '4 days', 1, '<creator-id>', 'open');
-- expect: error — RLS policy violation (4th concurrent active mix)

-- J) Regression: confirm a normal club is completely unaffected by the new
--    games policy clause (pick any existing club id you administer):
INSERT INTO games (organization_id, title, date, num_courts, created_by, status)
VALUES ('<some-existing-club-id>', 'Regression Test Mix', NOW() + INTERVAL '1 day', 10, '<its-admin-id>', 'open');
-- expect: succeeds (no cap at all for non-self-serve orgs) — delete this
-- test row afterward.

-- K) Cleanup
DELETE FROM games WHERE organization_id = (SELECT id FROM organizations WHERE slug = 'grupo-de-teste');
DELETE FROM membership_requests WHERE organization_id = (SELECT id FROM organizations WHERE slug = 'grupo-de-teste');
DELETE FROM memberships WHERE organization_id = (SELECT id FROM organizations WHERE slug = 'grupo-de-teste');
DELETE FROM organizations WHERE slug = 'grupo-de-teste';
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migration_self_serve_groups.sql
git commit -m "feat: add self-serve group creation with member/mix/court caps"
```

---

## Task 2: `src/lib/platformAdmin.js` — `createSelfServeGroup` wrapper

**Files:**
- Modify: `src/lib/platformAdmin.js`

**Interfaces:**
- Consumes: RPC `create_self_serve_group(p_name, p_slug)` (Task 1).
- Produces: `createSelfServeGroup(name, slug) → Promise<UUID>` (throws on error, same pattern as `createOrganization`/`createGroup` in this file).

- [ ] **Step 1: Add the wrapper**

Append to `src/lib/platformAdmin.js` (same file `createOrganization`/`createGroup` already live in — despite the filename, this module is where every org-creation RPC wrapper lives in this codebase):

```js
export const createSelfServeGroup = async (name, slug) => {
  const { data, error } = await supabase.rpc('create_self_serve_group', {
    p_name: name,
    p_slug: slug,
  })
  if (error) throw error
  return data
}
```

- [ ] **Step 2: Verify with `npm run build`**

Run `npm run build` from the repo root and confirm it completes with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/platformAdmin.js
git commit -m "feat: add createSelfServeGroup RPC wrapper"
```

---

## Task 3: `Comunidade.jsx` — "Criar o meu grupo" entry point

**Files:**
- Modify: `src/pages/Comunidade.jsx`

**Interfaces:**
- Consumes: `useAuth()` → `adminOrganizations` (unchanged shape, now may include rows with `self_serve: true`); `createSelfServeGroup` from `src/lib/platformAdmin.js` (Task 2).

- [ ] **Step 1: Add state and the sanitizeSlug helper**

Near the top of `src/pages/Comunidade.jsx`, alongside the existing imports (after line 7, `import { Avatar, EmptyState } from '../components/ui'`):

```jsx
import { Plus } from 'lucide-react'
import { createSelfServeGroup } from '../lib/platformAdmin'
```

`Plus` joins the existing `lucide-react` import on line 3 — combine into one import statement: `import { Search, Users, UserPlus, Clock, Heart, Plus } from 'lucide-react'`.

Add `const sanitizeSlug = (value) => value.toLowerCase().replace(/[^a-z0-9-]/g, '')` above the component (same helper already used in `src/pages/Gerir.jsx`).

Inside the `Comunidade()` function, alongside the existing `useState` calls:

```jsx
const { memberships, followOrganization, leaveOrganization, toggleFavoriteOrganization, adminOrganizations } = useAuth()
const navigate = useNavigate()
const [showCreateGroupForm, setShowCreateGroupForm] = useState(false)
const [groupName, setGroupName] = useState('')
const [groupSlug, setGroupSlug] = useState('')
const [creatingGroup, setCreatingGroup] = useState(false)
const [createGroupError, setCreateGroupError] = useState('')
```

(`useAuth` already destructures other fields on the existing line — add `adminOrganizations` to that same destructure.) Add `import { useNavigate } from 'react-router-dom'` to the existing `react-router-dom` import on line 2 (`import { Link, useNavigate } from 'react-router-dom'`).

- [ ] **Step 2: Add the create-group handler**

Alongside the existing handlers (`handleFollow`, `handleUnfollow`, etc.):

```jsx
const mySelfServeGroup = adminOrganizations.find((o) => o.self_serve)

const handleCreateGroup = async () => {
  setCreateGroupError('')
  setCreatingGroup(true)
  try {
    await createSelfServeGroup(groupName.trim(), groupSlug.trim())
    navigate(`/gerir/${groupSlug.trim()}`)
  } catch (err) {
    console.error('Error creating self-serve group:', err)
    const message = err?.message || ''
    if (message.includes('Já és admin de um grupo self-serve')) {
      setCreateGroupError('Já és admin de um grupo. Só podes criar um.')
    } else if (message.toLowerCase().includes('duplicate key value violates unique constraint') || message.toLowerCase().includes('slug')) {
      setCreateGroupError('Já existe um grupo com este identificador — escolhe outro')
    } else {
      setCreateGroupError('Não foi possível criar o grupo. Tenta novamente.')
    }
  } finally {
    setCreatingGroup(false)
  }
}
```

- [ ] **Step 3: Render the entry point**

Add this block in the JSX, right after the header `<div>` (after the closing `</div>` that contains the "Comunidade" `<h2>`, before the search bar `<div className="flex items-center gap-2 input-field">`):

```jsx
{mySelfServeGroup ? (
  <Link to={`/gerir/${mySelfServeGroup.slug}`} className="card press flex items-center gap-3.5 hover:shadow-lift">
    <Avatar name={mySelfServeGroup.name} url={mySelfServeGroup.group_logo_url} size="w-11 h-11 text-sm" />
    <div className="flex-1 min-w-0">
      <h3 className="font-extrabold text-ink-900 truncate">{mySelfServeGroup.name}</h3>
      <p className="text-sm text-muted">O meu grupo</p>
    </div>
  </Link>
) : (
  <div className="card space-y-4">
    {!showCreateGroupForm ? (
      <button
        type="button"
        onClick={() => setShowCreateGroupForm(true)}
        className="btn-primary w-full flex items-center justify-center gap-2"
      >
        <Plus size={18} />
        Criar o meu grupo
      </button>
    ) : (
      <>
        <h3 className="font-extrabold text-ink-900">Criar o meu grupo</h3>
        <p className="text-sm text-gray-500">
          Até 30 membros, 3 mixes ativos em simultâneo, 4 campos por mix. Sem pagamentos.
        </p>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Nome</label>
          <input
            type="text"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            className="input-field"
            placeholder="ex: Os Sextas-Feiras"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Slug</label>
          <input
            type="text"
            value={groupSlug}
            onChange={(e) => setGroupSlug(sanitizeSlug(e.target.value))}
            className="input-field"
            placeholder="ex: os-sextas-feiras"
          />
        </div>

        {createGroupError && (
          <div className="bg-danger/10 text-danger px-4 py-3 rounded-ctrl text-sm font-extrabold">{createGroupError}</div>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleCreateGroup}
            disabled={!groupName.trim() || !groupSlug.trim() || creatingGroup}
            className="btn-primary flex-1 disabled:opacity-40"
          >
            {creatingGroup ? 'A criar…' : 'Criar grupo'}
          </button>
          <button
            type="button"
            onClick={() => { setShowCreateGroupForm(false); setGroupName(''); setGroupSlug(''); setCreateGroupError('') }}
            disabled={creatingGroup}
            className="flex-1 text-sm font-extrabold px-3 py-2 min-h-[44px] rounded-full bg-ink-50 text-ink-700 hover:bg-ink-200 transition-colors duration-fast disabled:opacity-40"
          >
            Cancelar
          </button>
        </div>
      </>
    )}
  </div>
)}
```

- [ ] **Step 4: Verify with `npm run build`**

Run `npm run build` from the repo root and confirm it completes with no errors.

- [ ] **Step 5: Manual browser walkthrough** (requires a live Supabase session; Task 1 must already be run in Supabase)

- As a logged-in user who admins no self-serve group: open Comunidade, confirm the "Criar o meu grupo" button is visible above the search bar.
- Click it, confirm the form appears with name/slug fields and the limits blurb.
- Type a name with spaces/accents/uppercase into Slug (e.g. `"Os Açores!"`), confirm it live-sanitizes (e.g. to `os-aores`).
- Confirm the submit button stays disabled until both Nome and Slug are filled in.
- Submit; confirm you land on `/gerir/<slug>` and the group exists there with you as its only member/admin.
- Return to Comunidade; confirm the button is now replaced by an "O meu grupo" card linking to the same `/gerir/<slug>`.
- As that same user, try the creation flow again by navigating to Comunidade in a way that would re-show the form (there shouldn't be a way to, since `mySelfServeGroup` now short-circuits it) — confirm the create form no longer offers itself.
- As a different user, request to join the group via its `/clube/<slug>` page (reusing the existing follow/request UI) and confirm it goes to "Pedido pendente" rather than an error about the club not being public.
- As the group's creator, open `/gerir/<slug>` and approve that request from the existing requests panel; confirm the requester becomes a member.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Comunidade.jsx
git commit -m "feat: add self-serve group creation entry point to Comunidade"
```

---

## Task 4: `GerirClube.jsx` — hide club-only visibility settings for a self-serve group

**Files:**
- Modify: `src/pages/GerirClube.jsx:1966-1999`

**Interfaces:**
- Consumes: `org.self_serve` (now present on the already-loaded `org` object — no new query, `org` comes from the existing `select('*, organization:organizations(*))`-shaped membership fetch).

- [ ] **Step 1: Gate the "Visibilidade pública" section**

The existing "Grupos dentro deste clube" section (line 2009: `{org?.kind !== 'group' && (...)}`) already excludes self-serve groups correctly, since they're `kind='group'` too — no change needed there. The one remaining club-only section is "Visibilidade pública" (`is_global`/`open_join` toggles), which doesn't apply to a self-serve group (always private, always approval-gated, per `create_self_serve_group`).

Wrap the existing block at `src/pages/GerirClube.jsx:1966-1999` (from `<div className="pt-2 border-t border-gray-200">` through its closing `</div>`) in a `{!org?.self_serve && (...)}` guard:

```jsx
{!org?.self_serve && (
  <div className="pt-2 border-t border-gray-200">
    <h4 className="text-base font-semibold text-ink-900 mt-6 mb-1">
      Visibilidade pública
    </h4>
    {/* ...unchanged contents... */}
  </div>
)}
```

- [ ] **Step 2: Verify with `npm run build`**

Run `npm run build` from the repo root and confirm it completes with no errors.

- [ ] **Step 3: Manual browser walkthrough** (requires a live Supabase session with a self-serve group created in Task 3's walkthrough)

- Open `/gerir/<self-serve-group-slug>` as its admin, confirm the "Visibilidade pública" section (public-club checkbox, entrada livre checkbox) does **not** appear.
- Open `/gerir/<any-existing-club-slug>` as its admin, confirm "Visibilidade pública" still appears exactly as before (regression check — this task must not affect clubs or club-scoped groups).

- [ ] **Step 4: Commit**

```bash
git add src/pages/GerirClube.jsx
git commit -m "fix: hide club-only visibility settings on a self-serve group's Gerir page"
```

---

## Self-Review Notes

- **Spec coverage:** §1 (Task 1 Step 1, part 1) · §2.1 `create_self_serve_group` (Task 1) · §2.2 `follow_organization` (Task 1) · §2.3 `approve_membership_request` (Task 1) · §2.4 `games` policy (Task 1) · §3.1 Comunidade entry point (Task 3) · §3.2 reuse `/gerir/<slug>`/`/clube/<slug>` as-is, gate club-only sections (Task 4) · §3.3 no new client-side gating on mix creation (nothing to build — existing error toast already surfaces the RLS error) · §4/§5 migration scope and prerequisite (Task 1 header comment + Global Constraints) · §6 open items (Global Constraints' "out of scope" line).
- **Type consistency:** `createSelfServeGroup(name, slug)` (Task 2) matches its only caller in Task 3 (`createSelfServeGroup(groupName.trim(), groupSlug.trim())`). `org.self_serve` (Task 4) and `adminOrganizations[].self_serve` (Task 3) both come from the same `organizations.self_serve` column (Task 1) via the same `select('*, organization:organizations(*))` pattern already in `AuthContext.jsx` — no new query needed anywhere.
- **No points_rules gating:** the spec's design draft speculated a "points_rules customization" section might need hiding in `GerirClube.jsx`; that UI doesn't exist in the file (confirmed by search) — nothing to gate there, so Task 4 only touches the visibility toggles.
