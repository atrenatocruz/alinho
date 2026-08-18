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
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_platform_admin) THEN
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
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_platform_admin) THEN
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
