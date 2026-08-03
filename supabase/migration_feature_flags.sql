-- ════════════════════════════════════════════════════════════════════════
-- Migration: app-wide feature flags (starts with private_matches toggle)
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE feature_flags (
  key TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES profiles(id)
);

INSERT INTO feature_flags (key, enabled) VALUES ('private_matches', true);

ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;

-- Not sensitive data — any authenticated user can read every flag, so the
-- frontend can gate UI/routes for every signed-in user, not just admins.
CREATE POLICY "feature_flags_select_authenticated" ON feature_flags
  FOR SELECT TO authenticated USING (true);

-- Global toggle, not org-scoped — private matches are explicitly
-- org-independent (see supabase/migration_private_matches.sql). Any admin
-- of any club may flip it: there is no platform-admin role in this app,
-- and this reuses the same trust level org admins already have elsewhere
-- (see admin_set_membership_admin in supabase/schema.sql).
CREATE OR REPLACE FUNCTION admin_set_feature_flag(p_key TEXT, p_enabled BOOLEAN)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM memberships WHERE user_id = auth.uid() AND is_admin) THEN
    RAISE EXCEPTION 'Apenas admins podem alterar funcionalidades da app';
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
