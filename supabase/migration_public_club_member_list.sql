-- ════════════════════════════════════════════════════════════════════════
-- Migration: list_organization_members — the public club/group page shows
-- "31 membros" but had no way to see who they are outside of the admin
-- "Gerir" panel. This RPC exposes the same list (name + avatar only) to
-- anyone who can already see the club profile itself (mirrors
-- get_club_profile's own access gate), respecting each member's existing
-- clubs_visibility setting via can_view_section() — the same privacy rule
-- their player profile's "Clubes & Grupos" section already enforces.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

CREATE FUNCTION list_organization_members(p_organization_id UUID)
RETURNS TABLE (id UUID, name TEXT, avatar_url TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT p.id, p.name, p.avatar_url
  FROM memberships m
  JOIN profiles p ON p.id = m.user_id
  WHERE m.organization_id = p_organization_id
    AND m.is_guest = FALSE
    AND can_view_section(p.id, p.clubs_visibility)
    AND EXISTS (
      SELECT 1 FROM organizations o
      WHERE o.id = p_organization_id
        AND (
          (o.kind = 'club' AND (o.is_global = TRUE OR EXISTS (
            SELECT 1 FROM memberships vm WHERE vm.organization_id = o.id AND vm.user_id = auth.uid()
          )))
          OR (o.kind = 'group' AND (
            is_org_admin(o.id) OR EXISTS (
              SELECT 1 FROM memberships vm WHERE vm.organization_id = o.id AND vm.user_id = auth.uid()
            )
          ))
        )
    )
  ORDER BY p.name;
$$;

REVOKE ALL ON FUNCTION list_organization_members(UUID) FROM public;
GRANT EXECUTE ON FUNCTION list_organization_members(UUID) TO authenticated;
