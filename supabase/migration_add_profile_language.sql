-- ════════════════════════════════════════════════════════════════════════
-- English translation (i18n v1): profiles.language, the
-- account-level UI language preference. Default 'pt' for every account,
-- new or existing — no auto-detection, matches this app's Portuguese-first
-- principle (CLAUDE.md). Set explicitly via the header toggle only.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'pt';

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_language_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_language_check CHECK (language IN ('pt', 'en'));

COMMENT ON COLUMN profiles.language IS 'UI language preference (pt/en). Client-writable via updateProfile — not security-sensitive like rating, no column-grant protection needed.';
