-- ════════════════════════════════════════════════════════════════════════
-- One-time backfill: WhatsApp guest profiles created before the
-- createGuestProfile fix (whatsapp-bot/src/phone.js) never got a starting
-- rating, since they never open the app to see "Escolher Nível" — they'd
-- sit at rating=NULL forever, showing as "sem ranking" and seeding as the
-- weakest possible player in every dupla. Applies the same 900 baseline
-- complete_rating_onboarding already falls back to for anyone who plays
-- before onboarding (migration_elo_rating.sql).
--
-- Scoped tightly to WhatsApp-created guests only (placeholder email +
-- never onboarded) — a real new signup who simply hasn't finished
-- "Escolher Nível" yet must NOT be touched by this.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

UPDATE profiles
SET rating = 900,
    rating_anchor = 900,
    rating_onboarded_at = NOW()
WHERE email LIKE 'guest-%@whatsapp.alinho.pt'
  AND rating_onboarded_at IS NULL;
