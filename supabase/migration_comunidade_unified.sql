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
