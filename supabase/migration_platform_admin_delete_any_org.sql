-- ════════════════════════════════════════════════════════════════════════
-- Migration: platform admin can delete ANY organization (club or group),
-- not just self-serve groups (Renato, 2026-09-16).
--
-- migration_delete_self_serve_group.sql (Trello #241) scoped the delete
-- button to self_serve = TRUE groups only, deliberately excluding real
-- clubs and admin-created groups: "um clube a sério não deve desaparecer
-- com um botão de quem o gere". Renato has since asked to lift that
-- specifically for platform admins — as the person running the pilot, he
-- needs to remove any club or group he manages, self-serve or not, from
-- its own Settings page instead of going into the database by hand.
--
-- What changes: get_organization_delete_blocker no longer returns
-- 'not_self_serve' when the caller is a platform admin. Everything else
-- is unchanged — has_subgroups / has_activity still block platform admins
-- exactly like anyone else, and a non-admin org admin still can't delete
-- a non-self-serve org (the not_self_serve check still applies to them).
--
-- delete_self_serve_group() itself needs no change: it already just calls
-- get_organization_delete_blocker() and DELETEs unconditionally once that
-- returns NULL.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_organization_delete_blocker(p_org_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_org organizations%ROWTYPE;
  v_is_platform_admin BOOLEAN;
BEGIN
  IF auth.uid() IS NULL
     OR COALESCE((auth.jwt()->>'is_anonymous')::boolean, FALSE) THEN
    RETURN 'not_authenticated';
  END IF;

  SELECT * INTO v_org FROM organizations WHERE id = p_org_id;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  SELECT COALESCE(is_platform_admin, FALSE) INTO v_is_platform_admin
  FROM profiles WHERE id = auth.uid();

  IF NOT (is_org_admin(p_org_id) OR v_is_platform_admin) THEN
    RETURN 'not_admin';
  END IF;

  IF NOT v_org.self_serve AND NOT v_is_platform_admin THEN
    RETURN 'not_self_serve';
  END IF;

  IF EXISTS (SELECT 1 FROM organizations WHERE parent_organization_id = p_org_id) THEN
    RETURN 'has_subgroups';
  END IF;

  IF EXISTS (SELECT 1 FROM games            WHERE organization_id = p_org_id)
  OR EXISTS (SELECT 1 FROM game_recurrences WHERE organization_id = p_org_id)
  OR EXISTS (SELECT 1 FROM group_matches    WHERE organization_id = p_org_id)
  OR EXISTS (SELECT 1 FROM player_stats     WHERE organization_id = p_org_id)
  OR EXISTS (SELECT 1 FROM mix_player_stats WHERE organization_id = p_org_id)
  OR EXISTS (SELECT 1 FROM vouchers         WHERE organization_id = p_org_id) THEN
    RETURN 'has_activity';
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION get_organization_delete_blocker(UUID) FROM public;
GRANT EXECUTE ON FUNCTION get_organization_delete_blocker(UUID) TO authenticated;
