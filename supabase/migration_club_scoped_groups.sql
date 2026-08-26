-- ════════════════════════════════════════════════════════════════════════
-- Migration: club-scoped groups — a club admin manages every group inside
-- their club, joining a group always requires approval, group contents are
-- hidden from club members who aren't in the group, and groups stop
-- appearing in the public directory (Comunidade / Rankings) outside their
-- parent club. See docs/superpowers/specs/2026-08-26-club-scoped-groups-design.md
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. is_org_admin — a club admin is also admin of every child group ────
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

-- ── 2. create_group — club-scoped groups always require approval to join,
--       regardless of the parent club's own open_join setting. Independent
--       groups (p_parent_org_id IS NULL) are unchanged. ───────────────────
CREATE OR REPLACE FUNCTION create_group(p_name TEXT, p_slug TEXT, p_parent_org_id UUID, p_admin_user_id UUID)
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
    IF p_admin_user_id <> auth.uid()
       AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_platform_admin) THEN
      RAISE EXCEPTION 'Só podes criar um grupo com te tornares admin dele';
    END IF;

    INSERT INTO organizations (name, slug, kind, parent_organization_id, is_global, open_join, points_rules)
    VALUES (p_name, p_slug, 'group', p_parent_org_id, v_parent.is_global, FALSE, v_parent.points_rules)
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

-- ── 3. list_club_groups — tiered visibility for a club's own groups: any
--       club member sees a group's name/id/their own status; only group
--       members (or the club admin, via #1) see member_count/avg_rating. ──
CREATE FUNCTION list_club_groups(p_club_id UUID)
RETURNS TABLE (
  id UUID,
  name TEXT,
  slug TEXT,
  group_logo_url TEXT,
  my_status TEXT,
  can_manage BOOLEAN,
  member_count BIGINT,
  avg_rating NUMERIC
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

-- ── 4. follow_organization — a club member can request to join a sibling
--       group even inside a private (non-is_global) club; independent
--       groups and clubs keep the original is_global/open_join gate. ──────
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

-- ── 5. list_global_organizations — club-only. ─────────────────────────────
CREATE OR REPLACE FUNCTION list_global_organizations()
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
  WHERE o.is_global = TRUE AND o.kind = 'club'
  ORDER BY o.name;
$$;

REVOKE ALL ON FUNCTION list_global_organizations() FROM public;
GRANT EXECUTE ON FUNCTION list_global_organizations() TO authenticated;

-- ── 6. search_organizations — club-only. ──────────────────────────────────
CREATE OR REPLACE FUNCTION search_organizations(p_query TEXT)
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
  WHERE o.is_global = TRUE AND o.kind = 'club'
    AND o.name ILIKE '%' || trim(p_query) || '%'
  ORDER BY o.name
  LIMIT 20;
$$;

REVOKE ALL ON FUNCTION search_organizations(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION search_organizations(TEXT) TO authenticated;

-- ── 7. get_organization_rankings — club-only. ─────────────────────────────
CREATE OR REPLACE FUNCTION get_organization_rankings()
RETURNS TABLE (
  id UUID,
  name TEXT,
  slug TEXT,
  group_logo_url TEXT,
  kind TEXT,
  member_count BIGINT,
  total_points BIGINT,
  avg_rating NUMERIC
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    o.id,
    o.name,
    o.slug,
    o.group_logo_url,
    o.kind,
    (SELECT COUNT(*) FROM memberships m WHERE m.organization_id = o.id) AS member_count,
    COALESCE((SELECT SUM(ps.total_points) FROM player_stats ps WHERE ps.organization_id = o.id), 0) AS total_points,
    (
      SELECT AVG(p.rating)
      FROM memberships m
      JOIN profiles p ON p.id = m.user_id
      WHERE m.organization_id = o.id
        AND m.is_guest = FALSE
        AND p.rating IS NOT NULL
    ) AS avg_rating
  FROM organizations o
  WHERE o.is_global = TRUE AND o.kind = 'club'
  ORDER BY avg_rating DESC NULLS LAST, o.name;
$$;

REVOKE ALL ON FUNCTION get_organization_rankings() FROM public;
GRANT EXECUTE ON FUNCTION get_organization_rankings() TO authenticated;

-- ── 8. get_club_profile — a group's standalone page now requires being a
--       member or the club admin; is_global no longer grants public access
--       for a group (clubs are unchanged). ───────────────────────────────
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
$$;

REVOKE ALL ON FUNCTION get_club_profile(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION get_club_profile(TEXT) TO authenticated;
