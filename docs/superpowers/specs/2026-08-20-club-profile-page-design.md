# Club profile page

## Context

"Clubes & Grupos" (`/clubes`) lists every `is_global` club as a bare card — name, member count, and a Seguir/Pedir-para-entrar button. There's no way to see anything else about a club before joining: no logo (the `Definições` upload is still a stub), no description, no location, no contacts, no sense of what's actually happening there (open mixes). This adds a dedicated profile page reachable from that list.

`organizations` currently has no `description`, `location`, or public contact fields — `robot_contact` and `whatsapp_group_jid` are internal bot config, not meant for public display. Logo (`group_logo_url`) already has a column but no working upload UI.

The profile page itself is not restricted to global clubs — visibility is `is_global OR caller is a member` — but the only entry point built in this pass is `Clubes.jsx`, which only ever lists global clubs. A private club's member could reach their own club's profile if some other UI linked to it later; building that link is out of scope here.

## Schema

```sql
ALTER TABLE organizations ADD COLUMN description TEXT;
ALTER TABLE organizations ADD COLUMN location TEXT;
ALTER TABLE organizations ADD COLUMN phone TEXT;
ALTER TABLE organizations ADD COLUMN instagram TEXT;
ALTER TABLE organizations ADD COLUMN website TEXT;
```

All nullable — a section is simply not rendered on the profile page when its field is empty.

**Storage** — new `club-logos` bucket, same shape as the existing `avatars` bucket (`migration_add_avatar_url.sql`): public read, write restricted by folder-name-as-owner, except the "owner" here is the org, checked via the existing `is_org_admin()` function instead of `auth.uid()`:

```sql
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
```

Path convention: `<org_id>/logo.jpg`, fixed filename so re-uploading overwrites in place (same cache-busting-via-`?v=`-query-param trick as `avatarStorage.js`).

## RPCs

**`get_club_profile(p_slug TEXT)`** — `SECURITY DEFINER`, one round trip for the whole page. Returns zero rows when the club isn't global and the caller isn't a member — same response whether the slug doesn't exist or the club is private, so the page can't be used to confirm a private club's existence:

```sql
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

`open_games` intentionally excludes participant identities — only aggregate counts — since this is visible to people who haven't joined the club yet.

## Frontend

**`src/pages/ClubProfile.jsx`** (new), route `/clube/:slug` in `App.jsx` (`Guard require="member"`, same tier as `/clubes`, `/comunidade`, `/rankings`). Calls `get_club_profile(slug)` on mount:

- Header: logo (`Avatar` component, existing fallback-to-initials behavior), name, member count, and the Seguir/Pedir/A-seguir button — reusing `followOrganization`/`leaveOrganization`/`toggleFavoriteOrganization` from `AuthContext`, same as `Clubes.jsx`.
- "Sobre" (description), "Localização", "Contactos" (phone as `tel:`, instagram/website as links — prefixed with `https://` if the admin didn't type a protocol) — each section only renders when its field is non-empty.
- "Mixs em aberto" — read-only list (title, date, location, `confirmed_count`/`max_players`), no click-through, `EmptyState` when the array is empty.
- No data at all (private/nonexistent) → `EmptyState` "Clube não encontrado."

**`Clubes.jsx`** — each card wraps in a `Link` to `/clube/:slug`; the existing Seguir/Pedir/Heart buttons need `e.stopPropagation()` (or `e.preventDefault()`) so tapping them doesn't also navigate.

**`GerirClube.jsx` → Definições** — extend the existing settings form:
- New inputs: Descrição (textarea), Telefone, Instagram, Website.
- Localização: replace with the same Google Places `Autocomplete` + width-sync pattern already wired onto the game "Local" field (`src/pages/GerirClube.jsx`'s existing `useEffect`), pointed at a new ref for this field.
- Logo: replace the "em breve" placeholder with a real file input → `uploadClubLogo(orgId, file)` (new `src/lib/clubLogoStorage.js`, copy of `avatarStorage.js`'s `compressImage`-then-upload shape) → on success, save the returned URL onto `settings.group_logo_url` the same way the rest of the settings form stages changes before `handleUpdateSettings` submits.

All five new columns get added to whatever `settings` object shape `loadSettings`/`handleUpdateSettings` already reads/writes in `GerirClube.jsx`.

## Error handling

- `get_club_profile` returns no rows → `ClubProfile.jsx` shows `EmptyState`, not a thrown error — this is an expected, reachable state (private club, bad slug, or someone typed a URL by hand), not a bug.
- Logo upload failure → same try/catch/`alert` pattern as `Profile.jsx`'s avatar upload.
- Card tap-through on `Clubes.jsx`'s action buttons is a pure UI bug class (missing `stopPropagation`), not a data error — caught in manual testing, not worth a runtime guard.

## Testing

No automated test suite in this project — manual verification:

**SQL (Supabase SQL editor):**
- `get_club_profile` for a global club, called with no auth context change needed beyond a normal `authenticated` session that isn't a member — confirm the row comes back with `my_status = 'none'` and `open_games` excludes finished/cancelled mixes.
- `get_club_profile` for a private club, called as a non-member — confirm zero rows.
- Same call as an actual member of that private club — confirm the row comes back.
- `open_games`' `confirmed_count` matches the `peopleCount` formula already used in `GerirClube.jsx` (1 per confirmed participant + 1 more when `partner_id` is set) for a mix with at least one paired participant.

**Frontend (manual, in-browser):**
- From `/clubes`, tap a global club's card → lands on `/clube/:slug` with logo/description/location/contacts/open-mixes rendering only for fields that are actually filled in.
- Tap Seguir/Pedir/Heart from within the card on `/clubes` → confirm it does *not* navigate to the profile.
- As a club admin, fill in the new Definições fields + upload a logo → confirm they show up on the public profile immediately after.
- Manually navigate to `/clube/<private-club-slug>` as a non-member → confirm "Clube não encontrado", not a leaked description/location/mixes.
