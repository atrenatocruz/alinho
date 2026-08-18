# Platform admin: create new tenants from the app Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a platform admin create a new club (organization) and assign its first admin entirely from the app, replacing the current manual-SQL-only process, gated behind a new `profiles.is_platform_admin` flag.

**Architecture:** One SQL migration adds the `is_platform_admin` column and two `SECURITY DEFINER` RPCs (`create_organization`, `search_any_player`), both guarded by that flag. `PlayerSearch.jsx` gets a pluggable `searchFn` prop so it can be pointed at `search_any_player` instead of its hardcoded `search_players`. A new `src/lib/platformAdmin.js` wraps both RPCs the same way `src/lib/privateMatches.js` already wraps `search_players`. `src/pages/Gerir.jsx` gets a bug fix (platform admins must not be auto-redirected away from the page that hosts their "Criar novo clube" button) and the create-club form itself.

**Tech Stack:** React (Vite SPA), Supabase (Postgres + RLS + RPCs), react-router-dom.

## Global Constraints

- No automated test framework in this project — verification is manual: SQL run/checked in the Supabase SQL Editor, and the frontend checked via `npm run build` plus a manual browser walkthrough where a live session is available.
- New SQL goes in one new file, `supabase/migration_platform_admin_create_organization.sql`, run manually via Supabase → SQL Editor → New query → Run (one-file-per-feature convention already used by every other `supabase/migration_*.sql` file in this repo).
- Both new RPCs (`create_organization`, `search_any_player`) are `SECURITY DEFINER`, `SET search_path = public`, and follow the `REVOKE ... FROM anon, public` + `GRANT ... TO authenticated` pattern — the guard against non-platform-admins lives inside the function body (`RAISE EXCEPTION` if `NOT is_platform_admin`), not in the grant.
- European Portuguese for all user-facing copy and error messages.
- `profiles.is_platform_admin` is granted only via direct SQL, same manual philosophy that already governs who gets to create clubs today — this plan adds no UI to manage or revoke it.
- Duplicate slugs are caught by the existing `organizations.slug UNIQUE NOT NULL` constraint — no new server-side validation is needed, only a friendlier frontend error message.
- Follow existing code style in every file touched (Tailwind utility classes already used in the same file, existing comment density/tone).

---

## Task 1: Database migration — `is_platform_admin`, `create_organization`, `search_any_player`

**Files:**
- Create: `supabase/migration_platform_admin_create_organization.sql`

**Interfaces:**
- Produces: `profiles.is_platform_admin BOOLEAN` (default `FALSE`); RPC `create_organization(p_name TEXT, p_slug TEXT, p_admin_user_id UUID) RETURNS UUID`; RPC `search_any_player(p_query TEXT) RETURNS TABLE (id UUID, name TEXT, avatar_url TEXT)`.

- [ ] **Step 1: Write the migration file**

```sql
-- ════════════════════════════════════════════════════════════════════════
-- Migration: platform admin — create new tenants (clubs) from the app.
-- Adds a manually-granted is_platform_admin flag plus two RPCs gated by
-- it: create_organization (creates a club + its first admin membership,
-- atomically) and search_any_player (search every registered person,
-- unrestricted by shared-org membership, to appoint as that first admin).
-- See docs/superpowers/specs/2026-08-18-platform-admin-create-organization-design.md
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. profiles gains is_platform_admin — granted only via direct SQL,
--       same manual philosophy that already governs who can create clubs. ──
ALTER TABLE profiles ADD COLUMN is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 2. create_organization — creates the org and its first admin
--       membership atomically, so a club can never exist with nobody able
--       to manage it. ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION create_organization(p_name TEXT, p_slug TEXT, p_admin_user_id UUID)
RETURNS UUID AS $$
DECLARE
  v_org_id UUID;
BEGIN
  IF NOT (SELECT is_platform_admin FROM profiles WHERE id = auth.uid()) THEN
    RAISE EXCEPTION 'Apenas super admins podem criar clubes';
  END IF;

  INSERT INTO organizations (name, slug) VALUES (p_name, p_slug)
  RETURNING id INTO v_org_id;

  INSERT INTO memberships (user_id, organization_id, is_admin)
  VALUES (p_admin_user_id, v_org_id, true);

  RETURN v_org_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION create_organization(TEXT, TEXT, UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION create_organization(TEXT, TEXT, UUID) TO authenticated;

-- ── 3. search_any_player — same shape as the existing search_players, but
--       without its "shares an org with you, or org is global" restriction,
--       since the platform admin needs to find and appoint literally any
--       registered person as the first admin of a brand-new club they
--       don't yet share anything with. Guarded by is_platform_admin
--       instead of being open to every authenticated user. ─────────────────
CREATE OR REPLACE FUNCTION search_any_player(p_query TEXT)
RETURNS TABLE (id UUID, name TEXT, avatar_url TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (SELECT is_platform_admin FROM profiles WHERE id = auth.uid()) THEN
    RAISE EXCEPTION 'Apenas super admins podem pesquisar todos os jogadores';
  END IF;

  RETURN QUERY
  SELECT p.id, p.name, p.avatar_url
  FROM profiles p
  WHERE length(trim(p_query)) >= 2
    AND p.name ILIKE '%' || trim(p_query) || '%'
  ORDER BY p.name
  LIMIT 10;
END;
$$;

REVOKE EXECUTE ON FUNCTION search_any_player(TEXT) FROM anon, public;
GRANT EXECUTE ON FUNCTION search_any_player(TEXT) TO authenticated;
```

- [ ] **Step 2: Run the migration**

Supabase → SQL Editor → New query → paste the entire file → Run. Confirm it completes with no errors.

- [ ] **Step 3: Verify with manual SQL checks**

```sql
-- A) is_platform_admin exists, defaults to false
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'profiles' AND column_name = 'is_platform_admin';
-- expect: one row, data_type = boolean, column_default mentions false

-- B) Pick two existing profile ids to use below (any two real users work):
SELECT id, name FROM profiles LIMIT 2;
-- call the first one <admin-id> (will be granted the flag), the second <appointee-id>

-- C) Grant the flag to <admin-id>
UPDATE profiles SET is_platform_admin = true WHERE id = '<admin-id>';

-- D) As that platform admin (run this connected/impersonating <admin-id>,
--    e.g. via `SET request.jwt.claims` in the SQL editor, or simply trust
--    the guard logic and inspect it manually if impersonation isn't set up):
SELECT create_organization('Clube de Teste', 'clube-de-teste', '<appointee-id>');
-- expect: returns a UUID, no error

SELECT id, name, slug FROM organizations WHERE slug = 'clube-de-teste';
-- expect: one row

SELECT user_id, organization_id, is_admin FROM memberships
WHERE organization_id = (SELECT id FROM organizations WHERE slug = 'clube-de-teste');
-- expect: one row, user_id = <appointee-id>, is_admin = true

-- E) Duplicate slug fails on the unique constraint
SELECT create_organization('Clube de Teste 2', 'clube-de-teste', '<appointee-id>');
-- expect: error mentioning duplicate key / unique constraint on organizations_slug_key

-- F) Revoke the flag and confirm the guard raises
UPDATE profiles SET is_platform_admin = false WHERE id = '<admin-id>';
SELECT create_organization('Deveria Falhar', 'deveria-falhar', '<appointee-id>');
-- expect: error 'Apenas super admins podem criar clubes'

-- G) search_any_player: re-grant the flag, confirm it finds someone who
--    shares no org with <admin-id> (the case search_players would hide)
UPDATE profiles SET is_platform_admin = true WHERE id = '<admin-id>';
SELECT * FROM search_any_player('<part of appointee name>');
-- expect: <appointee-id> appears in the results

UPDATE profiles SET is_platform_admin = false WHERE id = '<admin-id>';
SELECT * FROM search_any_player('<part of appointee name>');
-- expect: error 'Apenas super admins podem pesquisar todos os jogadores'

-- H) Cleanup — remove the test club created in (D)
DELETE FROM memberships WHERE organization_id = (SELECT id FROM organizations WHERE slug = 'clube-de-teste');
DELETE FROM organizations WHERE slug = 'clube-de-teste';
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migration_platform_admin_create_organization.sql
git commit -m "feat: add is_platform_admin flag and create_organization/search_any_player RPCs"
```

---

## Task 2: Frontend plumbing — pluggable `PlayerSearch`, `src/lib/platformAdmin.js`

**Files:**
- Modify: `src/components/PlayerSearch.jsx`
- Create: `src/lib/platformAdmin.js`

**Interfaces:**
- Consumes: RPCs `create_organization(p_name, p_slug, p_admin_user_id)` and `search_any_player(p_query)` (Task 1).
- Produces: `PlayerSearch` prop `searchFn` (function `(query: string) => Promise<Array<{id, name, avatar_url}>>`, defaults to the existing `searchPlayers`); `searchAnyPlayer(query: string) => Promise<Array<{id, name, avatar_url}>>`; `createOrganization(name: string, slug: string, adminUserId: string) => Promise<string>` (resolves to the new org's UUID), both exported from `src/lib/platformAdmin.js`.

- [ ] **Step 1: Add the `searchFn` prop to `PlayerSearch`**

In `src/components/PlayerSearch.jsx`, change the component signature:
```jsx
export default function PlayerSearch({ label, selected, onSelect, onClear, excludeIds = [], browseByDefault = false }) {
```
to:
```jsx
export default function PlayerSearch({ label, selected, onSelect, onClear, excludeIds = [], browseByDefault = false, searchFn = searchPlayers }) {
```

- [ ] **Step 2: Use `searchFn` in the debounced search effect**

Change:
```js
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
```
to:
```js
    timeoutRef.current = setTimeout(async () => {
      try {
        const data = await searchFn(query)
        setResults(data)
      } catch (error) {
        console.error('Error searching players:', error)
      }
    }, 300)
    return () => clearTimeout(timeoutRef.current)
  }, [query, browseByDefault, searchFn])
```
(`browseByDefault`'s effect and `listPlayers` are untouched — this plan's form doesn't use `browseByDefault`.)

- [ ] **Step 3: Create `src/lib/platformAdmin.js`**

```js
import { supabase } from './supabase'

export const searchAnyPlayer = async (query) => {
  const { data, error } = await supabase.rpc('search_any_player', { p_query: query })
  if (error) throw error
  return data || []
}

export const createOrganization = async (name, slug, adminUserId) => {
  const { data, error } = await supabase.rpc('create_organization', {
    p_name: name,
    p_slug: slug,
    p_admin_user_id: adminUserId,
  })
  if (error) throw error
  return data
}
```

- [ ] **Step 4: Verify**

Run `npm run build` from the repo root and confirm it completes with no errors. If a live session is available, open any existing `PlayerSearch` usage (e.g. `/jogo-privado/criar`, the "Procurar o teu parceiro..." field) and confirm searching for a player still works exactly as before — `searchFn` defaulting to `searchPlayers` must be a no-op change for every existing caller.

- [ ] **Step 5: Commit**

```bash
git add src/components/PlayerSearch.jsx src/lib/platformAdmin.js
git commit -m "feat: make PlayerSearch's search function pluggable, add platformAdmin RPC wrappers"
```

---

## Task 3: `Gerir.jsx` — fix the auto-redirect bug, add the "Criar novo clube" form

**Files:**
- Modify: `src/pages/Gerir.jsx`

**Interfaces:**
- Consumes: `useAuth()` → `profile` (now includes `is_platform_admin`), `adminOrganizations` (unchanged shape: `{id, name, slug, group_logo_url, ...}[]`); `searchAnyPlayer`, `createOrganization` from `src/lib/platformAdmin.js` (Task 2); `PlayerSearch` with its new `searchFn` prop (Task 2).

- [ ] **Step 1: Rewrite `Gerir.jsx`**

The current auto-redirect (`adminOrganizations.length === 1` → `<Navigate>`) fires before a platform admin who happens to administer exactly one club would ever see the "Criar novo clube" button — fix: only auto-redirect when the caller is **not** a platform admin. Platform admins always see the full picker view, even with 0 or 1 clubs.

Replace the entire contents of `src/pages/Gerir.jsx` with:

```jsx
import { useState } from 'react'
import { Navigate, Link, useNavigate } from 'react-router-dom'
import { Settings, Plus } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { Avatar, EmptyState, PrimaryButton } from '../components/ui'
import PlayerSearch from '../components/PlayerSearch'
import { searchAnyPlayer, createOrganization } from '../lib/platformAdmin'

const sanitizeSlug = (value) => value.toLowerCase().replace(/[^a-z0-9-]/g, '')

export default function Gerir() {
  const { profile, adminOrganizations } = useAuth()
  const navigate = useNavigate()
  const isPlatformAdmin = !!profile?.is_platform_admin

  const [showCreateForm, setShowCreateForm] = useState(false)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [selectedAdmin, setSelectedAdmin] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  if (adminOrganizations.length === 1 && !isPlatformAdmin) {
    return <Navigate to={`/gerir/${adminOrganizations[0].slug}`} replace />
  }

  const handleCreate = async () => {
    setError('')
    setSaving(true)
    try {
      const newSlug = slug.trim()
      await createOrganization(name.trim(), newSlug, selectedAdmin.id)
      navigate(`/gerir/${newSlug}`)
    } catch (err) {
      console.error('Error creating organization:', err)
      const message = err?.message || ''
      if (message.toLowerCase().includes('duplicate key value violates unique constraint') || message.toLowerCase().includes('slug')) {
        setError('Já existe um clube com este identificador — escolhe outro')
      } else {
        setError('Não foi possível criar o clube. Tenta novamente.')
      }
    } finally {
      setSaving(false)
    }
  }

  const createClubPanel = isPlatformAdmin && (
    <div className="card space-y-4">
      {!showCreateForm ? (
        <PrimaryButton onClick={() => setShowCreateForm(true)} className="w-full">
          <Plus size={18} />
          Criar novo clube
        </PrimaryButton>
      ) : (
        <>
          <h3 className="font-extrabold text-ink-900">Criar novo clube</h3>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Nome</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input-field"
              placeholder="ex: Padel Clube Lisboa"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Slug</label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(sanitizeSlug(e.target.value))}
              className="input-field"
              placeholder="ex: padel-clube-lisboa"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Admin</label>
            <PlayerSearch
              label="Procurar jogador para ser admin..."
              searchFn={searchAnyPlayer}
              selected={selectedAdmin}
              onSelect={setSelectedAdmin}
              onClear={() => setSelectedAdmin(null)}
            />
          </div>

          {error && (
            <div className="bg-danger/10 text-danger px-4 py-3 rounded-ctrl text-sm font-extrabold">{error}</div>
          )}

          <PrimaryButton
            onClick={handleCreate}
            disabled={!name.trim() || !slug.trim() || !selectedAdmin || saving}
            className="w-full"
          >
            {saving ? 'A criar…' : 'Criar clube'}
          </PrimaryButton>
        </>
      )}
    </div>
  )

  if (adminOrganizations.length === 0) {
    return (
      <div className="space-y-5">
        <EmptyState
          icon={Settings}
          title="Não geres nenhum clube"
          subtitle="Esta secção é para quem administra um clube ou grupo."
        />
        {createClubPanel}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-3xl text-ink-900">Gerir</h2>
        <p className="text-muted text-sm mt-0.5">Escolhe o clube que queres gerir</p>
      </div>

      {createClubPanel}

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

Notes on this rewrite:
- `createClubPanel` evaluates to `false` (renders nothing) whenever `isPlatformAdmin` is false, so non-platform-admins see byte-for-byte the same page as before.
- The "0 clubs" and "not platform admin" cases are independent, per the design spec — a platform admin with zero clubs still sees the `EmptyState` **and** the "Criar novo clube" panel beneath it, not one or the other.
- Slug sanitization strips everything outside `[a-z0-9-]` on every keystroke, including uppercasing-then-lowering (`sanitizeSlug` lowercases first, so typing `"Padel Clube!"` becomes `"padelclube"` immediately, no separate case-fix step needed).
- Duplicate-slug detection matches on `"duplicate key value violates unique constraint"` (Postgres's own unique-violation phrasing) or a mention of `"slug"`, per the design spec's error-handling section — either substring in the RPC error message triggers the friendly Portuguese message instead of the raw Postgres error.

- [ ] **Step 2: Verify with `npm run build`**

Run `npm run build` from the repo root and confirm it completes with no errors.

- [ ] **Step 3: Manual browser walkthrough** (requires a live Supabase session with a profile that has `is_platform_admin = true` — use the `UPDATE profiles SET is_platform_admin = true WHERE id = '<your-id>'` pattern from Task 1's verification, then sign in as that user)

- As a platform admin who administers zero clubs: open `/gerir`, confirm both the "Não geres nenhum clube" empty state **and** the "Criar novo clube" button are visible (not just one).
- As a platform admin who administers exactly one club: open `/gerir`, confirm it does **not** auto-redirect to `/gerir/<slug>` — the picker view with "Criar novo clube" must show instead. (This is the bug fix — compare against the current behavior before this task's change, which does redirect.)
- Click "Criar novo clube", type a name with spaces/accents/uppercase into Slug (e.g. `"Clube Açores 2"`), confirm the field live-sanitizes to something like `clube-aores-2` (accented/space/uppercase characters stripped or lowercased as typed).
- Confirm the submit button stays disabled until Nome, Slug, and an admin (via the "Procurar jogador para ser admin..." search) are all filled in.
- Search for and pick an existing player as admin; confirm their result appears via `search_any_player` (a person who does not already share a club with you should still show up — this is the whole point of `search_any_player` over the ordinary `search_players`).
- Submit; confirm you land on `/gerir/<new-slug>` and that the club now exists there.
- Sign in as the appointed admin (or check `memberships` directly) and confirm they see/administer the new club.
- Try creating a second club with the same slug as one that already exists; confirm the friendly error "Já existe um clube com este identificador — escolhe outro" appears instead of a raw Postgres error.
- As a normal (non-platform-admin) club admin: open `/gerir`, confirm no "Criar novo clube" button appears anywhere, and that the length-1-club auto-redirect still happens for them (this part of the original behavior is intentionally unchanged).

- [ ] **Step 4: Commit**

```bash
git add src/pages/Gerir.jsx
git commit -m "feat: let platform admins create new clubs from Gerir"
```

---

## Self-review

**Spec coverage:**
- `profiles.is_platform_admin` column → Task 1, Step 1 §1.
- `create_organization` RPC (atomic org + admin membership, `SECURITY DEFINER`, guard, `REVOKE`/`GRANT`) → Task 1, Step 1 §2.
- `search_any_player` RPC (unrestricted search, guard, `REVOKE`/`GRANT`) → Task 1, Step 1 §3.
- `PlayerSearch` made pluggable so it can target `search_any_player` → Task 2, Steps 1-2.
- `src/lib/platformAdmin.js` wrapper functions → Task 2, Step 3.
- "Criar novo clube" button visible only to platform admins, shown independently of the 0-clubs empty state → Task 3, Step 1 (`createClubPanel` rendered in both the empty-state branch and the picker branch).
- Form fields: Nome, Slug (client-sanitized), player search for first admin → Task 3, Step 1.
- Submit disabled until all three are filled → Task 3, Step 1 (`disabled={!name.trim() || !slug.trim() || !selectedAdmin || saving}`).
- Duplicate-slug friendly error vs. generic error for anything else → Task 3, Step 1 (`handleCreate`'s catch block).
- Navigate to `/gerir/<new-slug>` on success → Task 3, Step 1 (`navigate(`/gerir/${newSlug}`)`).
- Auto-redirect bug fix (platform admins never auto-redirected away from the picker) → Task 3, Step 1 (`adminOrganizations.length === 1 && !isPlatformAdmin`).
- Manual SQL verification for both RPCs (guard raises for non-admins, duplicate slug fails, `search_any_player` returns non-shared-org people) → Task 1, Step 3.
- Manual frontend verification (button visibility, form behavior, redirect fix, end-to-end create) → Task 3, Step 3.
No gaps found.

**Placeholder scan:** No "TBD", "add appropriate error handling", "write tests for the above", or "similar to Task N" phrasing anywhere in the plan — every step has literal code or literal SQL/manual instructions.

**Type consistency:** `searchAnyPlayer(query)` and `createOrganization(name, slug, adminUserId)` are defined in Task 2, Step 3 and consumed with matching argument order/count in Task 3, Step 1 (`createOrganization(name.trim(), newSlug, selectedAdmin.id)`, `searchFn={searchAnyPlayer}`). RPC param names (`p_query`, `p_name`, `p_slug`, `p_admin_user_id`) match exactly between the SQL functions in Task 1 and the `supabase.rpc(...)` calls in Task 2. `PlayerSearch`'s new `searchFn` prop signature (`(query) => Promise<Array>`) matches how both `searchPlayers` (existing) and `searchAnyPlayer` (new) are shaped. Fixed one inconsistency during this pass: the design spec's error-matching example text used a partial phrase ("duplicate key value violates unique constraint") while `is_platform_admin`-guard rows use `RAISE EXCEPTION` (no constraint text) — confirmed in Task 3's `handleCreate` that the `.toLowerCase()` calls on both sides of the `.includes()` checks make the match case-insensitive regardless of how Postgres/PostgREST casings the returned message.
