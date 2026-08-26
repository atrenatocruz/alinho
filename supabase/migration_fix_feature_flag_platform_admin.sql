-- ════════════════════════════════════════════════════════════════════════
-- Migration: fix admin_set_feature_flag to require platform-admin, not just
-- any club admin. Global feature flags affect every club, so the RPC's
-- own check should match the platform-admin-only UI gate already added in
-- GerirClube.jsx — currently it doesn't (any org admin could call this
-- RPC directly, bypassing the UI's gate entirely).
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION admin_set_feature_flag(p_key TEXT, p_enabled BOOLEAN)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_platform_admin) THEN
    RAISE EXCEPTION 'Apenas admins da plataforma podem alterar funcionalidades da app';
  END IF;

  UPDATE feature_flags
  SET enabled = p_enabled, updated_at = now(), updated_by = auth.uid()
  WHERE key = p_key;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Funcionalidade desconhecida: %', p_key;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION admin_set_feature_flag(TEXT, BOOLEAN) FROM public;
GRANT EXECUTE ON FUNCTION admin_set_feature_flag(TEXT, BOOLEAN) TO authenticated;
