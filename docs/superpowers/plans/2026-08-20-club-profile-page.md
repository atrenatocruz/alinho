# Club profile page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every club a public/member-gated profile page (logo, description, location, contacts, open mixes), reachable by tapping a club's card in "Clubes & Grupos".

**Architecture:** One SQL migration adds five nullable columns to `organizations`, a `club-logos` Storage bucket (mirrors the existing `avatars` bucket), and one `SECURITY DEFINER` RPC (`get_club_profile`) that returns everything the page needs — club fields, the caller's `my_status`, and an `open_games` JSON array — in a single round trip, gated by `is_global OR caller is a member`. The existing Google Places Autocomplete wiring in `GerirClube.jsx` (game "Local" field) gets extracted into a reusable hook so the club's new "Localização" field can reuse it instead of duplicating ~50 lines. `Clubes.jsx`'s cards become links into the new `ClubProfile.jsx` page.

**Tech Stack:** React (Vite SPA), Supabase (Postgres + RLS + RPCs + Storage), react-router-dom, `@googlemaps/js-api-loader`.

**Spec:** `docs/superpowers/specs/2026-08-20-club-profile-page-design.md`

## Global Constraints

- No automated test framework in this project — verification is manual: SQL run/checked in the Supabase SQL Editor, and the frontend checked via `npm run build` plus a manual browser walkthrough where a live session is available.
- New SQL goes in one new file, `supabase/migration_club_profile.sql`, run manually via Supabase → SQL Editor → New query → Run (one-file-per-feature convention already used by every other `supabase/migration_*.sql` file).
- The new RPC (`get_club_profile`) is `SECURITY DEFINER`, `SET search_path = public`, and follows the `REVOKE ALL ... FROM public` + `GRANT EXECUTE ... TO authenticated` pattern.
- `get_club_profile` returns the exact same "nothing" (zero rows) whether the slug doesn't exist or the club is private and the caller isn't a member — never distinguish the two, so the page can't be used to confirm a private club's existence.
- `open_games` never includes participant identities — only aggregate counts (`confirmed_count`/`max_players`) — since it's shown to people who haven't joined the club yet.
- The only entry point built in this plan is `Clubes.jsx` (which only ever lists `is_global` clubs). No new navigation entry point is added for a private club's members to reach their own club's profile — out of scope per the spec.
- European Portuguese for all user-facing copy and error messages.
- Follow existing code style in every file touched (Tailwind utility classes already used in the same file, existing comment density/tone).
- Settings form fields (including the new ones) are staged in local state and only written to the database when "Guardar definições" is submitted — same as every existing field in that form (`name`, `robot_contact`, `points_rules`, ...). Logo upload is the one exception that can't be "staged": the file itself is written to Storage immediately on selection, but the `organizations.group_logo_url` row is still only updated on submit, consistent with the rest of the form.

---

## Task 1: Database migration — schema, `club-logos` bucket, `get_club_profile`

**Files:**
- Create: `supabase/migration_club_profile.sql`

**Interfaces:**
- Produces: `organizations.description/location/phone/instagram/website TEXT` (all nullable); Storage bucket `club-logos`; RPC `get_club_profile(p_slug TEXT) RETURNS TABLE (id UUID, name TEXT, slug TEXT, description TEXT, location TEXT, phone TEXT, instagram TEXT, website TEXT, group_logo_url TEXT, open_join BOOLEAN, member_count BIGINT, my_status TEXT, open_games JSONB)`.

- [ ] **Step 1: Write the migration file**

```sql
-- ════════════════════════════════════════════════════════════════════════
-- Migration: club profile page — public-facing club info + open mixes.
--
-- Adds description/location/phone/instagram/website to organizations, a
-- club-logos Storage bucket (mirrors the avatars bucket), and one RPC,
-- get_club_profile(p_slug), that returns everything ClubProfile.jsx needs
-- in one round trip. organizations' own SELECT RLS is membership-only, so
-- a non-member browsing a public (is_global) club needs this SECURITY
-- DEFINER read, same shape as list_global_organizations/list_players.
-- See docs/superpowers/specs/2026-08-20-club-profile-page-design.md
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. organizations gains public-profile fields — all nullable, a
--       section on the profile page just doesn't render when empty. ──────
ALTER TABLE organizations ADD COLUMN description TEXT;
ALTER TABLE organizations ADD COLUMN location TEXT;
ALTER TABLE organizations ADD COLUMN phone TEXT;
ALTER TABLE organizations ADD COLUMN instagram TEXT;
ALTER TABLE organizations ADD COLUMN website TEXT;

-- ── 2. club-logos Storage bucket — public read (logos aren't sensitive),
--       write restricted to that org's admins via the existing
--       is_org_admin() function, keyed off the <org_id>/... folder name. ──
INSERT INTO storage.buckets (id, name, public)
VALUES ('club-logos', 'club-logos', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Club logos are publicly accessible"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'club-logos');

CREATE POLICY "Org admins can upload their club logo"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'club-logos' AND is_org_admin((storage.foldername(name))[1]::uuid));

CREATE POLICY "Org admins can update their club logo"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'club-logos' AND is_org_admin((storage.foldername(name))[1]::uuid));

CREATE POLICY "Org admins can delete their club logo"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'club-logos' AND is_org_admin((storage.foldername(name))[1]::uuid));

-- ── 3. get_club_profile — one round trip for the whole page. Visible only
--       when the club is public (is_global) or the caller is a member;
--       zero rows otherwise, whether the slug is private or doesn't exist
--       at all, so the page can't be used to confirm a private club's
--       existence. open_games excludes finished/cancelled mixes and never
--       includes participant identities, only aggregate counts. ──────────
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
    o.group_logo_url, o.open_join,
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
      WHERE g.organization_id = o.id AND g.status NOT IN ('finished', 'completed', 'cancelled')
    ), '[]'::json)::jsonb
  FROM organizations o
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
WHERE table_name = 'organizations' AND column_name IN ('description', 'location', 'phone', 'instagram', 'website');
-- expect: 5 rows

-- B) club-logos bucket exists and is public
SELECT id, public FROM storage.buckets WHERE id = 'club-logos';
-- expect: one row, public = true

-- C) Pick a global club's slug and a private club's slug to test with:
SELECT slug, is_global FROM organizations ORDER BY is_global DESC LIMIT 5;
-- call a global one <global-slug> and a non-global one <private-slug> below

-- D) get_club_profile for a global club, as any authenticated caller who
--    isn't a member — expect one row, my_status = 'none', open_games
--    excludes finished/cancelled mixes:
SELECT slug, my_status, jsonb_array_length(open_games) AS open_count FROM get_club_profile('<global-slug>');
-- expect: one row

-- E) get_club_profile for a private club, as a non-member — expect zero rows:
SELECT * FROM get_club_profile('<private-slug>');
-- expect: 0 rows (run this as a session that is NOT a member of that org)

-- F) get_club_profile for a nonexistent slug — expect zero rows, same as (E):
SELECT * FROM get_club_profile('this-slug-does-not-exist');
-- expect: 0 rows

-- G) confirmed_count sanity check — pick an open game with at least one
--    confirmed participant that has a partner, and confirm the RPC's count
--    matches "1 per confirmed participant row + 1 more per partner_id set":
SELECT g.id, g.title,
  (SELECT COUNT(*) FILTER (WHERE p.status = 'confirmed') FROM participants p WHERE p.game_id = g.id) AS confirmed_rows,
  (SELECT COALESCE(SUM(1 + (p.partner_id IS NOT NULL)::int), 0) FROM participants p WHERE p.game_id = g.id AND p.status = 'confirmed') AS expected_confirmed_count
FROM games g WHERE g.status NOT IN ('finished', 'completed', 'cancelled') LIMIT 5;
-- cross-check expected_confirmed_count against the confirmed_count inside
-- that same game's entry in get_club_profile('<its club's slug>')'s open_games
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migration_club_profile.sql
git commit -m "feat: add club profile schema, club-logos bucket, get_club_profile RPC"
```

---

## Task 2: Extract `useGooglePlacesAutocomplete` hook (refactor, no behavior change)

**Files:**
- Create: `src/lib/useGooglePlacesAutocomplete.js`
- Modify: `src/pages/GerirClube.jsx`

**Interfaces:**
- Produces: `useGooglePlacesAutocomplete(inputRef: React.RefObject<HTMLInputElement>, active: boolean, onPlaceSelected: (value: string) => void): void` — wires Google Places Autocomplete onto `inputRef.current` whenever `active` is true, calling `onPlaceSelected(value)` when a place is picked. No-ops entirely when `VITE_GOOGLE_PLACES_API_KEY` isn't set. Keeps the `.pac-container` dropdown's width synced to the input's actual rendered width (the CSS in `src/index.css` styles it; this hook is what keeps its *width* correct).

This task moves the existing game-"Local" autocomplete wiring (currently inline in `GerirClube.jsx`) into a reusable hook, with **zero behavior change** — Task 3 is what actually adds a second usage. `onPlaceSelected` is captured via a ref inside the hook (not put in the effect's dependency array), so a caller passing a fresh inline arrow function every render does not tear down and rebuild the Autocomplete instance on every keystroke elsewhere in the form — this mirrors the "functional update" trick the original effect already used to avoid the same problem with `setGameForm`.

- [ ] **Step 1: Create the hook**

```js
import { useEffect, useRef } from 'react'
import { setOptions, importLibrary } from '@googlemaps/js-api-loader'

// Undefined (not just falsy-empty-string) when the env var is unset, so
// callers fall back to a plain text input rather than throwing on a missing
// key — see .env.example. setOptions() only records config (must run
// before the first importLibrary() call) — it doesn't fetch anything
// itself, so it's safe to call at module scope even if Places is never used.
const GOOGLE_PLACES_API_KEY = import.meta.env.VITE_GOOGLE_PLACES_API_KEY || null
if (GOOGLE_PLACES_API_KEY) setOptions({ key: GOOGLE_PLACES_API_KEY, v: 'weekly' })

/**
 * Wires Google Places Autocomplete onto a plain text <input>, active only
 * while `active` is true. No-ops when VITE_GOOGLE_PLACES_API_KEY isn't set.
 * Keeps the .pac-container dropdown's width synced to the input's actual
 * rendered width (styling lives in src/index.css) — Google sizes it once
 * at creation time and never re-syncs it on its own.
 */
export function useGooglePlacesAutocomplete(inputRef, active, onPlaceSelected) {
  const onPlaceSelectedRef = useRef(onPlaceSelected)
  useEffect(() => {
    onPlaceSelectedRef.current = onPlaceSelected
  })

  useEffect(() => {
    if (!GOOGLE_PLACES_API_KEY || !active) return

    let autocomplete
    let cancelled = false
    let bodyObserver
    let widthObserver
    let syncPacWidth

    importLibrary('places').then(({ Autocomplete }) => {
      if (cancelled || !inputRef.current) return
      autocomplete = new Autocomplete(inputRef.current, {
        fields: ['name', 'formatted_address'],
        types: ['establishment'],
        componentRestrictions: { country: 'pt' },
      })
      autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace()
        const value = place.name && place.formatted_address
          ? `${place.name} - ${place.formatted_address}`
          : place.formatted_address || place.name || ''
        if (value) onPlaceSelectedRef.current(value)
      })

      // Google sets .pac-container's width inline, once, from the input's
      // measured width at the moment the dropdown is first created — it
      // doesn't keep re-syncing it, so it can drift from the input's actual
      // rendered width. Force it to match, on creation and on any resize.
      syncPacWidth = () => {
        const pac = document.querySelector('.pac-container')
        const input = inputRef.current
        if (!pac || !input) return
        const width = `${input.getBoundingClientRect().width}px`
        if (pac.style.width !== width) pac.style.width = width
      }
      bodyObserver = new MutationObserver(() => {
        const pac = document.querySelector('.pac-container')
        if (pac && !widthObserver) {
          syncPacWidth()
          widthObserver = new MutationObserver(syncPacWidth)
          widthObserver.observe(pac, { attributes: true, attributeFilter: ['style'] })
        }
      })
      bodyObserver.observe(document.body, { childList: true })
      window.addEventListener('resize', syncPacWidth)
    }).catch((error) => console.error('Error loading Google Places:', error))

    return () => {
      cancelled = true
      bodyObserver?.disconnect()
      widthObserver?.disconnect()
      if (syncPacWidth) window.removeEventListener('resize', syncPacWidth)
      if (autocomplete) window.google?.maps?.event?.clearInstanceListeners(autocomplete)
    }
  }, [active])
}
```

- [ ] **Step 2: Replace the inline bootstrap + effect in `GerirClube.jsx`**

Remove this block near the top of the file (the `GOOGLE_PLACES_API_KEY` constant and `setOptions` call — now owned by the hook):

```js
import { setOptions, importLibrary } from '@googlemaps/js-api-loader'
```
```js
// Undefined (not just falsy-empty-string) when the env var is unset, so the
// "Local" field falls back to a plain text input rather than throwing on a
// missing key — see .env.example. setOptions() only records config (must
// run before the first importLibrary() call) — it doesn't fetch anything
// itself, so it's safe to call at module scope even if Places is never used.
const GOOGLE_PLACES_API_KEY = import.meta.env.VITE_GOOGLE_PLACES_API_KEY || null
if (GOOGLE_PLACES_API_KEY) setOptions({ key: GOOGLE_PLACES_API_KEY, v: 'weekly' })
```

Add this import instead, alongside the other `../lib/*` imports:
```js
import { useGooglePlacesAutocomplete } from '../lib/useGooglePlacesAutocomplete'
```

Replace the entire existing effect:
```js
  // Wires Google Places Autocomplete onto the plain "Local" input whenever
  // the create/edit form is open. No-ops when VITE_GOOGLE_PLACES_API_KEY
  // isn't set — the input just stays a normal text field.
  useEffect(() => {
    if (!GOOGLE_PLACES_API_KEY || !(showCreateGame || editingGame)) return

    let autocomplete
    let cancelled = false
    let bodyObserver
    let widthObserver
    let syncPacWidth

    importLibrary('places').then(({ Autocomplete }) => {
      if (cancelled || !locationInputRef.current) return
      autocomplete = new Autocomplete(locationInputRef.current, {
        fields: ['name', 'formatted_address'],
        types: ['establishment'],
        componentRestrictions: { country: 'pt' },
      })
      // Functional update: this listener is attached once per form-open,
      // so a plain `gameForm.location` closure would go stale if the
      // admin edits other fields (title, date...) before picking a place.
      autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace()
        const value = place.name && place.formatted_address
          ? `${place.name} - ${place.formatted_address}`
          : place.formatted_address || place.name || ''
        if (value) setGameForm((form) => ({ ...form, location: value }))
      })

      // Google sets .pac-container's width inline, once, from the input's
      // measured width at the moment the dropdown is first created — it
      // doesn't keep re-syncing it, so it can drift from the input's actual
      // rendered width. Force it to match, on creation and on any resize.
      syncPacWidth = () => {
        const pac = document.querySelector('.pac-container')
        const input = locationInputRef.current
        if (!pac || !input) return
        const width = `${input.getBoundingClientRect().width}px`
        if (pac.style.width !== width) pac.style.width = width
      }
      bodyObserver = new MutationObserver(() => {
        const pac = document.querySelector('.pac-container')
        if (pac && !widthObserver) {
          syncPacWidth()
          widthObserver = new MutationObserver(syncPacWidth)
          widthObserver.observe(pac, { attributes: true, attributeFilter: ['style'] })
        }
      })
      bodyObserver.observe(document.body, { childList: true })
      window.addEventListener('resize', syncPacWidth)
    }).catch((error) => console.error('Error loading Google Places:', error))

    return () => {
      cancelled = true
      bodyObserver?.disconnect()
      widthObserver?.disconnect()
      if (syncPacWidth) window.removeEventListener('resize', syncPacWidth)
      if (autocomplete) window.google?.maps?.event?.clearInstanceListeners(autocomplete)
    }
  }, [showCreateGame, editingGame])
```

with a single hook call, in the same place in the component body:
```js
  useGooglePlacesAutocomplete(
    locationInputRef,
    showCreateGame || editingGame,
    (value) => setGameForm((form) => ({ ...form, location: value }))
  )
```

- [ ] **Step 3: Verify with `npm run build`**

Run `npm run build` from the repo root and confirm it completes with no errors.

- [ ] **Step 4: Manual browser walkthrough** (requires a live session; `VITE_GOOGLE_PLACES_API_KEY` set)

- Open "Criar novo jogo" (or edit an existing game), type into "Local", confirm suggestions still appear and picking one fills in `name - formatted_address`.
- Confirm the suggestions dropdown's width still matches the input's width exactly (the fix from the previous session) — this must be unchanged, since the hook is a pure refactor of that same logic.

- [ ] **Step 5: Commit**

```bash
git add src/lib/useGooglePlacesAutocomplete.js src/pages/GerirClube.jsx
git commit -m "refactor: extract useGooglePlacesAutocomplete hook from GerirClube"
```

---

## Task 3: `GerirClube.jsx` Definições — new fields, logo upload, club location

**Files:**
- Create: `src/lib/clubLogoStorage.js`
- Modify: `src/pages/GerirClube.jsx`

**Interfaces:**
- Consumes: `useGooglePlacesAutocomplete` (Task 2); `Avatar` from `../components/ui` (existing).
- Produces: `uploadClubLogo(orgId: string, file: File) => Promise<string>` (resolves to a cache-busted public URL), `removeClubLogo(orgId: string) => Promise<void>`, both exported from `src/lib/clubLogoStorage.js`.

- [ ] **Step 1: Create `src/lib/clubLogoStorage.js`** (mirrors `src/lib/avatarStorage.js`)

```js
import { supabase } from './supabase'
import { compressImage } from './compressImage'

const BUCKET = 'club-logos'

function logoPath(orgId) {
  return `${orgId}/logo.jpg`
}

/**
 * Compresses, uploads (overwriting any previous logo at the same fixed
 * path), and returns a cache-busted public URL to save onto
 * organizations.group_logo_url. Without the ?v= query param, a browser
 * could keep showing a stale cached image after the logo changes, since
 * the underlying path never changes.
 */
export async function uploadClubLogo(orgId, file) {
  const blob = await compressImage(file)
  const path = logoPath(orgId)

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: 'image/jpeg', upsert: true })
  if (error) throw error

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return `${data.publicUrl}?v=${Date.now()}`
}

export async function removeClubLogo(orgId) {
  const { error } = await supabase.storage.from(BUCKET).remove([logoPath(orgId)])
  if (error) throw error
}
```

- [ ] **Step 2: Add imports, refs, state, and handlers to `GerirClube.jsx`**

Add `Camera` to the existing `lucide-react` import:
```js
import { Plus, Calendar, Users, Trash2, Edit2, Check, X, UserX, Repeat, Clock, ArrowLeft, Camera } from 'lucide-react'
```

Add this import alongside the other `../lib/*` imports:
```js
import { uploadClubLogo, removeClubLogo } from '../lib/clubLogoStorage'
```

Near the existing `const locationInputRef = useRef(null)` (inside `GerirClube`'s component body), add:
```js
  const clubLocationInputRef = useRef(null)
  const clubLogoInputRef = useRef(null)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [logoError, setLogoError] = useState('')
```

Add a second `useGooglePlacesAutocomplete` call, alongside the game-location one from Task 2:
```js
  useGooglePlacesAutocomplete(
    clubLocationInputRef,
    activeTab === 'settings',
    (value) => setSettings((s) => ({ ...s, location: value }))
  )
```

Add these two handlers near `handleUpdateSettings`:
```js
  const handleLogoSelect = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file later
    if (!file) return
    setLogoError('')
    setUploadingLogo(true)
    try {
      const group_logo_url = await uploadClubLogo(settings.id, file)
      setSettings((s) => ({ ...s, group_logo_url }))
    } catch (error) {
      console.error('Error uploading club logo:', error)
      setLogoError('Não foi possível enviar o logo. Tenta novamente.')
    } finally {
      setUploadingLogo(false)
    }
  }

  const handleRemoveLogo = async () => {
    setUploadingLogo(true)
    try {
      await removeClubLogo(settings.id)
      setSettings((s) => ({ ...s, group_logo_url: null }))
    } catch (error) {
      console.error('Error removing club logo:', error)
      setLogoError('Não foi possível remover o logo. Tenta novamente.')
    } finally {
      setUploadingLogo(false)
    }
  }
```

- [ ] **Step 3: Replace the "Logo do grupo (em breve)" placeholder and add the new fields**

Replace:
```jsx
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Logo do grupo (em breve)
                  </label>
                  <div className="border-2 border-dashed border-gray-300 rounded-2xl p-8 text-center text-gray-500">
                    Funcionalidade de upload em desenvolvimento
                  </div>
                </div>
```

with:
```jsx
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Logo do clube
                  </label>
                  <div className="flex items-center gap-4">
                    <div className="relative w-16 h-16 shrink-0">
                      <Avatar name={settings.name} url={settings.group_logo_url} size="w-16 h-16 text-xl" />
                      <button
                        type="button"
                        onClick={() => clubLogoInputRef.current?.click()}
                        disabled={uploadingLogo}
                        aria-label="Alterar logo do clube"
                        className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-ink-900 text-white flex items-center justify-center
                                   ring-2 ring-canvas hover:bg-ink-700 transition-colors duration-fast disabled:opacity-50"
                      >
                        {uploadingLogo ? (
                          <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                        ) : (
                          <Camera size={14} />
                        )}
                      </button>
                      <input
                        ref={clubLogoInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleLogoSelect}
                        className="hidden"
                      />
                    </div>
                    {settings.group_logo_url && (
                      <button
                        type="button"
                        onClick={handleRemoveLogo}
                        disabled={uploadingLogo}
                        className="text-danger text-sm font-extrabold hover:underline disabled:opacity-50"
                      >
                        Remover logo
                      </button>
                    )}
                  </div>
                  {logoError && (
                    <p className="text-danger text-sm font-extrabold mt-2">{logoError}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Descrição
                  </label>
                  <textarea
                    value={settings.description || ''}
                    onChange={(e) => setSettings({ ...settings, description: e.target.value })}
                    className="input-field resize-none"
                    rows={4}
                    placeholder="Uma breve descrição do clube, visível no perfil público"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Localização
                  </label>
                  <input
                    ref={clubLocationInputRef}
                    type="text"
                    value={settings.location || ''}
                    onChange={(e) => setSettings({ ...settings, location: e.target.value })}
                    className="input-field"
                    placeholder="Morada ou nome do clube"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Telefone
                    </label>
                    <input
                      type="text"
                      value={settings.phone || ''}
                      onChange={(e) => setSettings({ ...settings, phone: e.target.value })}
                      className="input-field"
                      placeholder="+351 XXX XXX XXX"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Instagram
                    </label>
                    <input
                      type="text"
                      value={settings.instagram || ''}
                      onChange={(e) => setSettings({ ...settings, instagram: e.target.value })}
                      className="input-field"
                      placeholder="@oclube"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Website
                    </label>
                    <input
                      type="text"
                      value={settings.website || ''}
                      onChange={(e) => setSettings({ ...settings, website: e.target.value })}
                      className="input-field"
                      placeholder="oclube.pt"
                    />
                  </div>
                </div>
```

- [ ] **Step 4: Include the new fields in `handleUpdateSettings`'s update call**

Change:
```js
        .update({
          robot_contact: settings.robot_contact,
          name: settings.name,
          points_rules: settings.points_rules,
          is_global: settings.is_global,
          open_join: settings.open_join,
        })
```
to:
```js
        .update({
          robot_contact: settings.robot_contact,
          name: settings.name,
          description: settings.description,
          location: settings.location,
          phone: settings.phone,
          instagram: settings.instagram,
          website: settings.website,
          group_logo_url: settings.group_logo_url,
          points_rules: settings.points_rules,
          is_global: settings.is_global,
          open_join: settings.open_join,
        })
```

(`loadSettings` already does `select('*')`, so the five new columns — and `group_logo_url`, which already existed — flow into `settings` automatically; no change needed there.)

- [ ] **Step 5: Verify with `npm run build`**

Run `npm run build` from the repo root and confirm it completes with no errors.

- [ ] **Step 6: Manual browser walkthrough** (requires a live session as a club admin, with `VITE_GOOGLE_PLACES_API_KEY` set for the location-autocomplete check)

- Open `/gerir/<your-club-slug>` → Definições. Confirm the logo circle shows the current logo or initials fallback, and clicking the small camera button opens a file picker.
- Select an image, confirm it uploads (spinner shows, then the circle updates to the new logo) and "Remover logo" appears.
- Type into "Localização", confirm Google Places suggestions appear (same dropdown styling/width behavior as the game "Local" field).
- Fill in Descrição/Telefone/Instagram/Website, click "Guardar definições", confirm the success alert.
- Reload the page (fresh `loadSettings` call) — confirm the logo, description, location, and all three contact fields persisted.
- Click "Remover logo", confirm it clears immediately (before Guardar) and stays cleared after Guardar + reload.

- [ ] **Step 7: Commit**

```bash
git add src/lib/clubLogoStorage.js src/pages/GerirClube.jsx
git commit -m "feat: club logo upload + description/location/contact fields in Definições"
```

---

## Task 4: `ClubProfile.jsx` page + `get_club_profile` wrapper + route

**Files:**
- Create: `src/lib/clubProfile.js`
- Create: `src/pages/ClubProfile.jsx`
- Modify: `src/App.jsx`

**Interfaces:**
- Consumes: RPC `get_club_profile(p_slug)` (Task 1); `useAuth()` → `memberships`, `followOrganization`, `leaveOrganization`, `toggleFavoriteOrganization` (existing, same shapes as used in `Clubes.jsx`); `Avatar`, `EmptyState`, `PrimaryButton` from `../components/ui` (existing); `PadelIcon` from `../components/icons/PadelIcon` (existing).
- Produces: `getClubProfile(slug: string) => Promise<{ id, name, slug, description, location, phone, instagram, website, group_logo_url, open_join, member_count, my_status, open_games: Array<{id, title, date, location, max_players, confirmed_count}> } | null>`, exported from `src/lib/clubProfile.js`. Route `/clube/:slug`.

- [ ] **Step 1: Create `src/lib/clubProfile.js`**

```js
import { supabase } from './supabase'

export async function getClubProfile(slug) {
  const { data, error } = await supabase.rpc('get_club_profile', { p_slug: slug })
  if (error) throw error
  return data?.[0] || null
}
```

- [ ] **Step 2: Create `src/pages/ClubProfile.jsx`**

```jsx
import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Users, UserPlus, Clock, Heart, MapPin, Phone, Instagram, Globe, Calendar } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { getClubProfile } from '../lib/clubProfile'
import { Avatar, EmptyState, PrimaryButton } from '../components/ui'
import PadelIcon from '../components/icons/PadelIcon'

const asWebsiteUrl = (value) => (/^https?:\/\//i.test(value) ? value : `https://${value}`)
const asInstagramUrl = (value) => {
  if (/^https?:\/\//i.test(value)) return value
  return `https://instagram.com/${value.trim().replace(/^@/, '')}`
}

export default function ClubProfile() {
  const { slug } = useParams()
  const { memberships, followOrganization, leaveOrganization, toggleFavoriteOrganization } = useAuth()
  const [club, setClub] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [acting, setActing] = useState(false)
  const [favoriting, setFavoriting] = useState(false)

  const load = async () => {
    try {
      const data = await getClubProfile(slug)
      if (!data) {
        setNotFound(true)
      } else {
        setClub(data)
      }
    } catch (error) {
      console.error('Error loading club profile:', error)
      setNotFound(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setLoading(true)
    setNotFound(false)
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  const handleFollow = async () => {
    setActing(true)
    try {
      const { error } = await followOrganization(club.id)
      if (error) throw error
      await load()
    } catch (error) {
      console.error('Error following club:', error)
      alert('Não foi possível seguir este clube. Tenta novamente.')
    } finally {
      setActing(false)
    }
  }

  const handleUnfollow = async () => {
    if (!confirm(`Deixar de seguir ${club.name}? Deixas de ver os mixs deste clube.`)) return
    setActing(true)
    try {
      const { error } = await leaveOrganization(club.id)
      if (error) throw error
      await load()
    } catch (error) {
      console.error('Error leaving club:', error)
      alert(error.message || 'Não foi possível deixar de seguir este clube.')
    } finally {
      setActing(false)
    }
  }

  const isFavorite = club ? memberships.find((m) => m.organization_id === club.id)?.is_favorite === true : false

  const handleToggleFavorite = async () => {
    setFavoriting(true)
    try {
      const { error } = await toggleFavoriteOrganization(club.id, !isFavorite)
      if (error) throw error
    } catch (error) {
      console.error('Error toggling favorite club:', error)
      alert('Não foi possível atualizar o favorito. Tenta novamente.')
    } finally {
      setFavoriting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-ink-50 border-t-ink-700"></div>
      </div>
    )
  }

  if (notFound || !club) {
    return (
      <div className="space-y-5">
        <Link to="/clubes" className="inline-flex items-center gap-1.5 text-ink-700 font-extrabold text-sm hover:underline">
          <ArrowLeft size={16} /> Voltar a Clubes & Grupos
        </Link>
        <EmptyState
          icon={PadelIcon}
          title="Clube não encontrado"
          subtitle="Este clube não existe ou não é público."
        />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <Link to="/clubes" className="inline-flex items-center gap-1.5 text-ink-700 font-extrabold text-sm hover:underline">
        <ArrowLeft size={16} /> Voltar a Clubes & Grupos
      </Link>

      <div className="card flex items-center gap-3.5">
        <Avatar name={club.name} url={club.group_logo_url} size="w-16 h-16 text-xl" />
        <div className="flex-1 min-w-0">
          <h2 className="text-2xl text-ink-900 truncate">{club.name}</h2>
          <p className="text-sm text-muted flex items-center gap-1.5">
            <Users size={13} /> {club.member_count} {club.member_count === 1 ? 'membro' : 'membros'}
          </p>
        </div>

        {club.my_status === 'member' ? (
          <button
            onClick={handleToggleFavorite}
            disabled={favoriting}
            aria-label={isFavorite ? 'Remover dos favoritos' : 'Marcar como favorito'}
            title={isFavorite ? 'Remover dos favoritos' : 'Marcar como favorito — os mixs deste clube aparecem primeiro em Próximos jogos'}
            className="shrink-0 w-11 h-11 min-h-[44px] rounded-full flex items-center justify-center transition-colors duration-fast disabled:opacity-40 hover:bg-ink-50"
          >
            <Heart size={20} className={isFavorite ? 'fill-lime-400 text-lime-400' : 'text-ink-200'} />
          </button>
        ) : club.my_status === 'pending' ? (
          <span className="whitespace-nowrap inline-flex items-center gap-1.5 text-xs font-extrabold px-3 py-2 rounded-full bg-ink-50 text-muted">
            <Clock size={14} /> Pedido enviado
          </span>
        ) : (
          <PrimaryButton onClick={handleFollow} disabled={acting} className="shrink-0">
            <UserPlus size={16} />
            {club.open_join ? 'Seguir' : 'Pedir para entrar'}
          </PrimaryButton>
        )}
      </div>

      {club.my_status === 'member' && (
        <button
          onClick={handleUnfollow}
          disabled={acting}
          className="text-danger text-sm font-extrabold hover:underline disabled:opacity-40"
        >
          Deixar de seguir
        </button>
      )}

      {club.description && (
        <div className="card">
          <h3 className="text-sm font-extrabold text-ink-900 uppercase tracking-wide mb-2">Sobre</h3>
          <p className="text-ink-900 whitespace-pre-line">{club.description}</p>
        </div>
      )}

      {club.location && (
        <div className="card">
          <h3 className="text-sm font-extrabold text-ink-900 uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <MapPin size={15} /> Localização
          </h3>
          <p className="text-ink-900">{club.location}</p>
        </div>
      )}

      {(club.phone || club.instagram || club.website) && (
        <div className="card space-y-2">
          <h3 className="text-sm font-extrabold text-ink-900 uppercase tracking-wide mb-2">Contactos</h3>
          {club.phone && (
            <a href={`tel:${club.phone}`} className="flex items-center gap-2 text-ink-900 hover:underline">
              <Phone size={15} className="shrink-0" /> {club.phone}
            </a>
          )}
          {club.instagram && (
            <a href={asInstagramUrl(club.instagram)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-ink-900 hover:underline">
              <Instagram size={15} className="shrink-0" /> {club.instagram}
            </a>
          )}
          {club.website && (
            <a href={asWebsiteUrl(club.website)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-ink-900 hover:underline">
              <Globe size={15} className="shrink-0" /> {club.website}
            </a>
          )}
        </div>
      )}

      <div>
        <h3 className="text-lg text-ink-900 mb-3">Mixs em aberto</h3>
        {club.open_games.length === 0 ? (
          <EmptyState
            icon={Calendar}
            title="Sem mixs em aberto"
            subtitle="Este clube não tem mixs agendados neste momento."
          />
        ) : (
          <div className="space-y-3">
            {club.open_games.map((game) => (
              <div key={game.id} className="card">
                <h4 className="font-extrabold text-ink-900">{game.title}</h4>
                <p className="text-sm text-muted">
                  {new Date(game.date).toLocaleString('pt-PT', { day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' })}
                </p>
                {game.location && (
                  <p className="flex items-center gap-1.5 text-sm text-muted mt-1">
                    <MapPin size={13} className="shrink-0" /> {game.location}
                  </p>
                )}
                <p className="flex items-center gap-1.5 text-sm text-muted mt-1">
                  <Users size={13} /> {game.confirmed_count}/{game.max_players} jogadores
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Add the route in `src/App.jsx`**

Add the import alongside the other page imports:
```js
import ClubProfile from './pages/ClubProfile'
```

Add the route immediately after the existing `/clubes` route:
```jsx
      <Route
        path="/clube/:slug"
        element={
          <Guard require="member" showSplash={showSplash}>
            <ClubProfile />
          </Guard>
        }
      />
```

- [ ] **Step 4: Verify with `npm run build`**

Run `npm run build` from the repo root and confirm it completes with no errors.

- [ ] **Step 5: Manual browser walkthrough** (requires a live session; Task 5 hasn't wired up the `Clubes.jsx` entry point yet, so navigate by typing the URL directly)

- As a member of a global club, visit `/clube/<that-club-slug>` — confirm logo/name/member-count render, and the description/location/contacts sections only appear for fields that are actually filled in (Task 3 must have saved at least one for this check to be meaningful).
- As a non-member of a global club with `open_join = true`, visit its `/clube/:slug` — confirm the "Seguir" button appears and works (state flips to the Heart/favorite button after).
- As a non-member of a global club with `open_join = false`, confirm the button reads "Pedir para entrar" and, after clicking, the header shows "Pedido enviado".
- Visit `/clube/<a-private-club-slug>` as a non-member — confirm "Clube não encontrado", not a leaked description/location/mixes.
- Visit `/clube/this-slug-does-not-exist` — confirm the same "Clube não encontrado" state (not a crash).
- Confirm "Mixs em aberto" lists open games with no participant names shown, and shows the empty state when there are none.

- [ ] **Step 6: Commit**

```bash
git add src/lib/clubProfile.js src/pages/ClubProfile.jsx src/App.jsx
git commit -m "feat: add public club profile page at /clube/:slug"
```

---

## Task 5: `Clubes.jsx` — clickable cards into the profile page

**Files:**
- Modify: `src/pages/Clubes.jsx`

**Interfaces:**
- Consumes: route `/clube/:slug` (Task 4).

- [ ] **Step 1: Import `Link` and turn each card into one**

Add to the existing imports:
```js
import { Link } from 'react-router-dom'
```

Change the card wrapper from a `<div>` to a `<Link>`, and stop the three action buttons from also triggering navigation (`e.preventDefault()`, since they're now nested inside an `<a>`):

Replace:
```jsx
            <div key={club.id} className="card flex items-center gap-3.5">
              <Avatar name={club.name} url={club.group_logo_url} size="w-11 h-11 text-sm" />
              <div className="flex-1 min-w-0">
                <h3 className="font-extrabold text-ink-900 truncate">{club.name}</h3>
                <p className="text-sm text-muted flex items-center gap-1.5">
                  <Users size={13} /> {club.member_count} {club.member_count === 1 ? 'membro' : 'membros'}
                </p>
              </div>

              {club.my_status === 'member' ? (
                <>
                  <button
                    onClick={() => handleToggleFavorite(club, isFavorite)}
                    disabled={favoritingOn === club.id}
                    aria-label={isFavorite ? 'Remover dos favoritos' : 'Marcar como favorito'}
                    title={isFavorite ? 'Remover dos favoritos' : 'Marcar como favorito — os mixs deste clube aparecem primeiro em Próximos jogos'}
                    className="shrink-0 w-11 h-11 min-h-[44px] rounded-full flex items-center justify-center transition-colors duration-fast disabled:opacity-40 hover:bg-ink-50"
                  >
                    <Heart size={20} className={isFavorite ? 'fill-lime-400 text-lime-400' : 'text-ink-200'} />
                  </button>
                  <button
                    onClick={() => handleUnfollow(club)}
                    disabled={actingOn === club.id}
                    className="whitespace-nowrap text-xs font-extrabold px-3 py-2 min-h-[44px] rounded-full bg-ink-50 text-ink-700 hover:bg-ink-200 transition-colors duration-fast disabled:opacity-40"
                  >
                    A seguir
                  </button>
                </>
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
```

with:
```jsx
            <Link key={club.id} to={`/clube/${club.slug}`} className="card press flex items-center gap-3.5 hover:shadow-lift">
              <Avatar name={club.name} url={club.group_logo_url} size="w-11 h-11 text-sm" />
              <div className="flex-1 min-w-0">
                <h3 className="font-extrabold text-ink-900 truncate">{club.name}</h3>
                <p className="text-sm text-muted flex items-center gap-1.5">
                  <Users size={13} /> {club.member_count} {club.member_count === 1 ? 'membro' : 'membros'}
                </p>
              </div>

              {club.my_status === 'member' ? (
                <>
                  <button
                    onClick={(e) => { e.preventDefault(); handleToggleFavorite(club, isFavorite) }}
                    disabled={favoritingOn === club.id}
                    aria-label={isFavorite ? 'Remover dos favoritos' : 'Marcar como favorito'}
                    title={isFavorite ? 'Remover dos favoritos' : 'Marcar como favorito — os mixs deste clube aparecem primeiro em Próximos jogos'}
                    className="shrink-0 w-11 h-11 min-h-[44px] rounded-full flex items-center justify-center transition-colors duration-fast disabled:opacity-40 hover:bg-ink-50"
                  >
                    <Heart size={20} className={isFavorite ? 'fill-lime-400 text-lime-400' : 'text-ink-200'} />
                  </button>
                  <button
                    onClick={(e) => { e.preventDefault(); handleUnfollow(club) }}
                    disabled={actingOn === club.id}
                    className="whitespace-nowrap text-xs font-extrabold px-3 py-2 min-h-[44px] rounded-full bg-ink-50 text-ink-700 hover:bg-ink-200 transition-colors duration-fast disabled:opacity-40"
                  >
                    A seguir
                  </button>
                </>
              ) : club.my_status === 'pending' ? (
                <span className="whitespace-nowrap inline-flex items-center gap-1.5 text-xs font-extrabold px-3 py-2 rounded-full bg-ink-50 text-muted">
                  <Clock size={14} /> Pedido enviado
                </span>
              ) : (
                <button
                  onClick={(e) => { e.preventDefault(); handleFollow(club) }}
                  disabled={actingOn === club.id}
                  className="whitespace-nowrap inline-flex items-center gap-1.5 text-xs font-extrabold px-3.5 py-2 min-h-[44px] rounded-full bg-lime-400 text-ink-900 hover:bg-lime-600 transition-colors duration-fast disabled:opacity-40"
                >
                  <UserPlus size={14} />
                  {club.open_join ? 'Seguir' : 'Pedir para entrar'}
                </button>
              )}
            </Link>
```

- [ ] **Step 2: Verify with `npm run build`**

Run `npm run build` from the repo root and confirm it completes with no errors.

- [ ] **Step 3: Manual browser walkthrough**

- On `/clubes`, tap a card's body (name/avatar/member-count area) — confirm it navigates to `/clube/:slug`.
- Tap the Heart button (if you're a member of that club) — confirm it toggles favorite and does **not** navigate.
- Tap "A seguir" (unfollow) — confirm the unfollow confirm-dialog + action still runs and does **not** navigate.
- Tap "Seguir"/"Pedir para entrar" on a club you don't belong to — confirm the follow/request action still runs and does **not** navigate.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Clubes.jsx
git commit -m "feat: make Clubes & Grupos cards link to the club profile page"
```

---

## Self-review

**Spec coverage:**
- 5 new `organizations` columns (`description`, `location`, `phone`, `instagram`, `website`) → Task 1, Step 1 §1.
- `club-logos` Storage bucket + admin-only write policies → Task 1, Step 1 §2.
- `get_club_profile` RPC (visibility rule, `open_games` JSON, no participant identities, `SECURITY DEFINER`/`REVOKE`/`GRANT`) → Task 1, Step 1 §3.
- Reused Google Places Autocomplete pattern for the club's Localização field, without duplicating the effect → Task 2 (extraction) + Task 3, Step 2 (second usage).
- Working logo upload replacing the "em breve" placeholder → Task 3, Steps 1-3.
- `ClubProfile.jsx` at `/clube/:slug`, `Guard require="member"` → Task 4, Steps 2-3.
- Header with Seguir/Pedir-para-entrar/Heart, reusing `AuthContext` functions → Task 4, Step 2.
- Sobre/Localização/Contactos sections only rendered when filled in → Task 4, Step 2 (`{club.description && ...}` etc.).
- "Mixs em aberto" read-only list, no click-through, no participant names → Task 4, Step 2 (`open_games.map` renders title/date/location/counts only, no `<Link>`).
- "Not found" `EmptyState` for both nonexistent and private/unauthorized slugs (same response) → Task 4, Step 2 (`notFound` branch) + Task 1's RPC returning zero rows for both cases.
- `Clubes.jsx` cards become the entry point, action buttons don't trigger navigation → Task 5.
- No new entry point for private-club members (explicitly out of scope) → stated in Global Constraints; no task builds one.
- Manual SQL + manual frontend verification per the spec's Testing section → Task 1 Step 3, Task 4 Step 5, Task 5 Step 3.
No gaps found.

**Placeholder scan:** No "TBD", "add appropriate error handling", "write tests for the above", or "similar to Task N" phrasing anywhere in the plan — every step has literal code, literal SQL, or literal manual-verification instructions.

**Type consistency:** `getClubProfile(slug)` (Task 4, Step 1) returns the exact shape `get_club_profile` produces (Task 1, Step 1 §3) — field names match one-to-one (`group_logo_url`, `open_join`, `member_count`, `my_status`, `open_games` with `id/title/date/location/max_players/confirmed_count`), and `ClubProfile.jsx` (Task 4, Step 2) consumes every one of those fields under the same names. `uploadClubLogo(orgId, file)`/`removeClubLogo(orgId)` (Task 3, Step 1) are called with matching argument order/count in Task 3, Step 2 (`uploadClubLogo(settings.id, file)`, `removeClubLogo(settings.id)`). `useGooglePlacesAutocomplete(inputRef, active, onPlaceSelected)`'s signature (Task 2, Step 1) is used identically in both call sites — Task 2, Step 2 (`locationInputRef`, `showCreateGame || editingGame`, game-form callback) and Task 3, Step 2 (`clubLocationInputRef`, `activeTab === 'settings'`, settings-form callback). `handleUpdateSettings`'s `.update({...})` call (Task 3, Step 4) writes every field the new Definições inputs read/write in Task 3, Step 3, plus the pre-existing ones — no field is added to the form without also being added to the update call.
