-- ════════════════════════════════════════════════════════════════════════
-- Migration: global club directory (Clubes & Grupos) + backoffice join
-- requests. See docs/superpowers/specs/2026-08-17-multi-tenant-player-
-- backoffice-split-design.md for the full design.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. organizations: opt-in public discovery ────────────────────────────
ALTER TABLE organizations ADD COLUMN is_global BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE organizations ADD COLUMN open_join BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 2. membership_requests: pending "Follow" on a restricted global club ─
CREATE TABLE membership_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES profiles(id)
);

-- Only one PENDING request per (user, org) — a rejected request can be
-- re-submitted later (that row keeps status='rejected' as history, and a
-- fresh row is inserted), which a plain UNIQUE(user_id, organization_id)
-- would have blocked forever.
CREATE UNIQUE INDEX membership_requests_pending_key
  ON membership_requests(user_id, organization_id) WHERE (status = 'pending');

ALTER TABLE membership_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "See own membership requests"
  ON membership_requests FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Org admins see requests for their org"
  ON membership_requests FOR SELECT
  USING (is_org_admin(organization_id));

-- No direct-INSERT policy on purpose: every insert goes through
-- follow_organization() below (SECURITY DEFINER), which is what enforces
-- "only for an is_global org" and picks the open_join vs. request branch.
-- A raw client-side .insert() is correctly blocked by RLS with no policy
-- covering it.

CREATE POLICY "Org admins resolve requests for their org"
  ON membership_requests FOR UPDATE
  USING (is_org_admin(organization_id));

-- ── 3. Widen profiles / player_stats / mix_player_stats visibility to
--       "shares an org with you" OR "the row's org is is_global" ─────────
CREATE OR REPLACE FUNCTION in_global_org(p_profile_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships m
    JOIN organizations o ON o.id = m.organization_id
    WHERE m.user_id = p_profile_id AND o.is_global = TRUE
  );
$$;

REVOKE ALL ON FUNCTION in_global_org(UUID) FROM public;
GRANT EXECUTE ON FUNCTION in_global_org(UUID) TO authenticated;

DROP POLICY IF EXISTS "See own profile or profiles of org-mates" ON profiles;
CREATE POLICY "See own profile, org-mates, or global-org members"
  ON profiles FOR SELECT
  USING (
    id = auth.uid()
    OR shares_org_with(id)
    OR in_global_org(id)
  );

DROP POLICY IF EXISTS "Org members can view player stats" ON player_stats;
CREATE POLICY "Org members or anyone can view player stats of a global org"
  ON player_stats FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM memberships
      WHERE memberships.organization_id = player_stats.organization_id AND memberships.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM organizations o
      WHERE o.id = player_stats.organization_id AND o.is_global = TRUE
    )
  );

DROP POLICY IF EXISTS "Org members can view mix player stats" ON mix_player_stats;
CREATE POLICY "Org members or anyone can view mix player stats of a global org"
  ON mix_player_stats FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM memberships
      WHERE memberships.organization_id = mix_player_stats.organization_id AND memberships.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM organizations o
      WHERE o.id = mix_player_stats.organization_id AND o.is_global = TRUE
    )
  );

-- ── 4. Follow / approve / reject / leave ──────────────────────────────────
-- Single entrypoint for the "Follow" button — the frontend never needs to
-- know whether the club is open_join or restricted, it just calls this and
-- reacts to 'joined' vs 'pending'. Idempotent on every branch.
CREATE OR REPLACE FUNCTION follow_organization(p_organization_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_is_global BOOLEAN;
  v_open_join BOOLEAN;
BEGIN
  SELECT is_global, open_join INTO v_is_global, v_open_join
  FROM organizations WHERE id = p_organization_id;

  IF v_is_global IS NULL THEN
    RAISE EXCEPTION 'Clube não encontrado';
  END IF;
  IF NOT v_is_global THEN
    RAISE EXCEPTION 'Este clube não é público';
  END IF;

  IF EXISTS (
    SELECT 1 FROM memberships WHERE user_id = auth.uid() AND organization_id = p_organization_id
  ) THEN
    RETURN 'joined';
  END IF;

  IF v_open_join THEN
    INSERT INTO memberships (user_id, organization_id)
    VALUES (auth.uid(), p_organization_id)
    ON CONFLICT (user_id, organization_id) DO NOTHING;
    RETURN 'joined';
  END IF;

  INSERT INTO membership_requests (user_id, organization_id)
  VALUES (auth.uid(), p_organization_id)
  ON CONFLICT (user_id, organization_id) WHERE (status = 'pending') DO NOTHING;
  RETURN 'pending';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION follow_organization(UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION follow_organization(UUID) TO authenticated;

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

  INSERT INTO memberships (user_id, organization_id)
  VALUES (v_user_id, v_org_id)
  ON CONFLICT (user_id, organization_id) DO NOTHING;

  UPDATE membership_requests
  SET status = 'approved', resolved_at = NOW(), resolved_by = auth.uid()
  WHERE id = p_request_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION approve_membership_request(UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION approve_membership_request(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION reject_membership_request(p_request_id UUID)
RETURNS void AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT organization_id INTO v_org_id
  FROM membership_requests WHERE id = p_request_id AND status = 'pending';

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Pedido não encontrado ou já resolvido';
  END IF;
  IF NOT is_org_admin(v_org_id) THEN
    RAISE EXCEPTION 'Apenas admins podem rejeitar pedidos';
  END IF;

  UPDATE membership_requests
  SET status = 'rejected', resolved_at = NOW(), resolved_by = auth.uid()
  WHERE id = p_request_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION reject_membership_request(UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION reject_membership_request(UUID) TO authenticated;

-- Self-service unfollow/leave. Blocked if the caller is that org's last
-- admin — an orphaned, unmanageable club is worse than a blocked click.
CREATE OR REPLACE FUNCTION leave_organization(p_organization_id UUID)
RETURNS void AS $$
BEGIN
  IF (
    SELECT is_admin FROM memberships
    WHERE user_id = auth.uid() AND organization_id = p_organization_id
  ) AND (
    SELECT COUNT(*) FROM memberships
    WHERE organization_id = p_organization_id AND is_admin = TRUE
  ) <= 1 THEN
    RAISE EXCEPTION 'És o único admin deste clube — torna outra pessoa admin antes de saíres';
  END IF;

  DELETE FROM memberships WHERE user_id = auth.uid() AND organization_id = p_organization_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION leave_organization(UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION leave_organization(UUID) TO authenticated;

-- ── 5. Directory listing — "organizations" SELECT RLS is membership-only,
--       so a non-member browsing the directory needs a SECURITY DEFINER
--       read, same shape as search_players/list_players below. ──────────
CREATE OR REPLACE FUNCTION list_global_organizations()
RETURNS TABLE (
  id UUID,
  name TEXT,
  slug TEXT,
  group_logo_url TEXT,
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
    o.id, o.name, o.slug, o.group_logo_url, o.open_join,
    (SELECT COUNT(*) FROM memberships m WHERE m.organization_id = o.id),
    CASE
      WHEN EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = o.id AND m.user_id = auth.uid()) THEN 'member'
      WHEN EXISTS (SELECT 1 FROM membership_requests r WHERE r.organization_id = o.id AND r.user_id = auth.uid() AND r.status = 'pending') THEN 'pending'
      ELSE 'none'
    END
  FROM organizations o
  WHERE o.is_global = TRUE
  ORDER BY o.name;
$$;

REVOKE ALL ON FUNCTION list_global_organizations() FROM public;
GRANT EXECUTE ON FUNCTION list_global_organizations() TO authenticated;

-- ── 6. Patch existing cross-org RPCs to respect is_global ─────────────────
-- These were SECURITY DEFINER with NO org filter at all — any signed-in
-- player could already find any other real player by name, and any
-- club's points already counted toward the "Geral" ranking tab, regardless
-- of that club's privacy. This closes that gap using the same rule as the
-- RLS change above.
CREATE OR REPLACE FUNCTION search_players(p_query TEXT)
RETURNS TABLE (id UUID, name TEXT, avatar_url TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.name, p.avatar_url
  FROM profiles p
  WHERE length(trim(p_query)) >= 2
    AND p.id <> auth.uid()
    AND p.name ILIKE '%' || trim(p_query) || '%'
    AND NOT EXISTS (
      SELECT 1 FROM memberships m WHERE m.user_id = p.id AND m.is_test = true
    )
    AND (shares_org_with(p.id) OR in_global_org(p.id))
  ORDER BY p.name
  LIMIT 10;
$$;

CREATE OR REPLACE FUNCTION list_players(p_limit INTEGER DEFAULT 20)
RETURNS TABLE (id UUID, name TEXT, avatar_url TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.name, p.avatar_url
  FROM profiles p
  WHERE p.id <> auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM memberships m WHERE m.user_id = p.id AND m.is_test = true
    )
    AND (shares_org_with(p.id) OR in_global_org(p.id))
  ORDER BY p.created_at DESC
  LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION get_global_rankings()
RETURNS TABLE (
  user_id UUID,
  name TEXT,
  avatar_url TEXT,
  club_points BIGINT,
  private_points BIGINT,
  total_points BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH club AS (
    SELECT ps.user_id, SUM(ps.total_points) AS club_points
    FROM player_stats ps
    JOIN organizations o ON o.id = ps.organization_id
    WHERE o.is_global = TRUE
    GROUP BY ps.user_id
  ),
  private AS (
    SELECT pms.user_id, SUM(pms.points_earned) AS private_points
    FROM private_match_stats pms
    GROUP BY pms.user_id
  )
  SELECT
    p.id,
    p.name,
    p.avatar_url,
    COALESCE(club.club_points, 0) AS club_points,
    COALESCE(private.private_points, 0) AS private_points,
    COALESCE(club.club_points, 0) + COALESCE(private.private_points, 0) AS total_points
  FROM profiles p
  LEFT JOIN club ON club.user_id = p.id
  LEFT JOIN private ON private.user_id = p.id
  WHERE club.user_id IS NOT NULL OR private.user_id IS NOT NULL
  ORDER BY total_points DESC, p.name ASC;
$$;

REVOKE ALL ON FUNCTION search_players(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION search_players(TEXT) TO authenticated;
REVOKE ALL ON FUNCTION list_players(INTEGER) FROM public;
GRANT EXECUTE ON FUNCTION list_players(INTEGER) TO authenticated;
REVOKE ALL ON FUNCTION get_global_rankings() FROM public;
GRANT EXECUTE ON FUNCTION get_global_rankings() TO authenticated;
