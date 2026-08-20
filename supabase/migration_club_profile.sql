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
