-- ════════════════════════════════════════════════════════════════════════
-- English translation (i18n v1): profiles.language, the
-- account-level UI language preference. Default 'pt' for every account,
-- new or existing — no auto-detection, matches this app's Portuguese-first
-- principle (CLAUDE.md). Set explicitly from the Profile page's Personal
-- information section (Preferred language / Idioma preferido).
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'pt';

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_language_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_language_check CHECK (language IN ('pt', 'en'));

COMMENT ON COLUMN profiles.language IS 'UI language preference (pt/en). Client-writable via updateProfile — not security-sensitive like rating, no column-grant protection needed.';

-- migration_fix_profiles_column_grants.sql REVOKEd blanket UPDATE on
-- profiles and only re-grants specific columns — language was never added
-- to that allowlist, so updateProfile({ language }) would fail with a
-- permission error for every account. Grant it here, same pattern as every
-- other client-editable column.
GRANT UPDATE (language) ON profiles TO authenticated;
