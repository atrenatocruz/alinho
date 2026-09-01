-- ════════════════════════════════════════════════════════════════════════
-- Cookie consent + Privacy Policy (Trello #154): profiles.consent_accepted_at,
-- the one-time consent-gate flag (mirrors rating_onboarded_at /
-- complete_rating_onboarding — see migration_elo_rating.sql), and
-- `consents`, the append-only audit log of what was actually agreed to.
--
-- Existing pilot accounts are grandfathered (backfilled to already-
-- consented) below — this migration does not retroactively gate anyone who
-- already had an account before it ran. See
-- docs/superpowers/specs/2026-08-31-cookie-consent-privacy-policy-design.md
-- for the full reasoning.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- Run this BEFORE deploying the frontend change that reads
-- profiles.consent_accepted_at (App.jsx's Guard) — otherwise every account
-- reads `undefined` for the missing column and the gate silently never
-- fires until this has run.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS consent_accepted_at TIMESTAMPTZ;

COMMENT ON COLUMN profiles.consent_accepted_at IS
  'When this account accepted the Privacy Policy/Terms. NULL = new account
   that has not passed the consent gate yet. Written only by
   complete_privacy_consent() — never add this column to the client
   GRANT UPDATE allowlist in migration_fix_profiles_column_grants.sql.';

-- Existing pilot accounts are grandfathered — the ticket's urgency is about
-- new signups with no documented consent, not retroactively re-gating
-- already-active users.
UPDATE profiles SET consent_accepted_at = NOW() WHERE consent_accepted_at IS NULL;

CREATE TABLE IF NOT EXISTS consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  policy_version TEXT NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE consents IS
  'Append-only audit log of Privacy Policy/Terms acceptance (Trello #154).
   Never updated or deleted — profiles.consent_accepted_at is the fast-path
   flag Guard checks; this table is the provable record. Only written by
   complete_privacy_consent().';

ALTER TABLE consents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select own consents" ON consents;
CREATE POLICY "select own consents" ON consents FOR SELECT
  USING (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE policy for any role, including the owner — the
-- only writer is the SECURITY DEFINER RPC below, which bypasses RLS. A
-- direct client insert is refused by RLS, not just discouraged.

CREATE OR REPLACE FUNCTION complete_privacy_consent(p_policy_version TEXT)
RETURNS void AS $$
BEGIN
  -- No-op for an account that's already consented — mirrors
  -- complete_rating_onboarding's guard, so a second call (e.g. a retry
  -- after a flaky network) never creates a duplicate audit row.
  IF EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND consent_accepted_at IS NOT NULL) THEN
    RETURN;
  END IF;

  INSERT INTO consents (user_id, policy_version) VALUES (auth.uid(), p_policy_version);

  UPDATE profiles SET consent_accepted_at = NOW() WHERE id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION complete_privacy_consent(TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION complete_privacy_consent(TEXT) TO authenticated;
