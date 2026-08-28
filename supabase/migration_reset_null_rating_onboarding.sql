-- ════════════════════════════════════════════════════════════════════════
-- Fix: real accounts permanently stuck at rating=NULL ("—" everywhere a
-- rating is shown). migration_elo_rating.sql's own backfill —
--   UPDATE profiles SET rating_onboarded_at = NOW() WHERE rating_onboarded_at IS NULL;
-- — marked every pre-existing profile as "already onboarded" so they'd
-- skip the new "Escolher Nível" screen, but never gave anyone an actual
-- rating. Anyone who simply hadn't played a mix yet at that point is now
-- stuck at rating=NULL with no way to reach the one screen that sets
-- it — it's gated on rating_onboarded_at being NULL, which is no longer
-- true for them.
--
-- Fix: reset rating_onboarded_at back to NULL for exactly these accounts
-- so they see "Escolher Nível" on their next visit and pick their real
-- starting level themselves — this feature's own stated design principle
-- is "a escolha é explícita e não tem default" (EscolherNivel.jsx), so
-- silently assigning them a number instead would be the wrong fix.
--
-- Excludes WhatsApp guest profiles, who never open the app and are
-- handled instead by migration_backfill_guest_ratings.sql.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

UPDATE profiles
SET rating_onboarded_at = NULL
WHERE rating IS NULL
  AND rating_onboarded_at IS NOT NULL
  AND email NOT LIKE 'guest-%@whatsapp.alinho.pt';
