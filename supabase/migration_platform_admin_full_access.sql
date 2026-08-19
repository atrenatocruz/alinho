-- ════════════════════════════════════════════════════════════════════════
-- Migration: platform admins get full access to every club/group.
-- Builds on migration_platform_admin_create_organization.sql's
-- is_platform_admin flag. Approach: auto-provision, not an invisible RLS
-- bypass — a platform admin who opens a club they don't belong to gets a
-- real admin membership row created for them (platform_admin_ensure_org_access
-- below), so every existing club-scoped RLS policy and admin_* RPC keeps
-- working unchanged. The only widened policy is organizations' SELECT, so a
-- platform admin can see and pick any club from Gerir before they've been
-- auto-joined to it.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. organizations: platform admins can see every club, not just ones
--       they're a member of — needed so Gerir can list every club to pick
--       from before the first-visit auto-join below has happened. ────────
DROP POLICY IF EXISTS "Members can view their organizations" ON organizations;
CREATE POLICY "Members can view their organizations, platform admins view all"
  ON organizations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM memberships
      WHERE memberships.organization_id = organizations.id AND memberships.user_id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_platform_admin)
  );

-- ── 2. platform_admin_ensure_org_access — called once, right when a
--       platform admin opens a club's Gerir page they aren't a member of
--       yet. Grants them an admin membership in that club (upgrading to
--       admin if they were already a plain member) so every other
--       club-scoped policy/RPC (games, recurrences, members, settings,
--       admin_set_membership_admin, admin_remove_member, …) treats them
--       exactly like any other admin — no other policy needed changing. ──
CREATE OR REPLACE FUNCTION platform_admin_ensure_org_access(p_organization_id UUID)
RETURNS void AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_platform_admin) THEN
    RAISE EXCEPTION 'Apenas super admins podem aceder a qualquer clube';
  END IF;

  INSERT INTO memberships (user_id, organization_id, is_admin)
  VALUES (auth.uid(), p_organization_id, true)
  ON CONFLICT (user_id, organization_id) DO UPDATE SET is_admin = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION platform_admin_ensure_org_access(UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION platform_admin_ensure_org_access(UUID) TO authenticated;
