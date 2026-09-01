-- ════════════════════════════════════════════════════════════════════════
-- One-time cleanup: give every profile currently stuck at rating=NULL
-- ("0 pts" everywhere a rating is shown, per RANKING.md's formatRating —
-- NULL only becomes "—" in formatRating itself; every other call site
-- that reads a { user_id: rating } lookup falls back to 0) a real 900
-- starting rating, matching the anchor complete_rating_onboarding already
-- uses as its own baseline (migration_elo_rating.sql) and the one
-- migration_backfill_guest_ratings.sql already applied to WhatsApp guests.
--
-- Covers everyone still at rating IS NULL regardless of why: pre-Elo
-- accounts wrongly marked "already onboarded" by migration_elo_rating.sql's
-- own initial UPDATE (rating_onboarded_at NOT NULL, rating NULL — see
-- migration_reset_null_rating_onboarding.sql, which took the opposite
-- approach of sending them back through "Escolher Nível" to choose their
-- own anchor instead), WhatsApp guests not yet backfilled (redundant with
-- but harmless alongside migration_backfill_guest_ratings.sql), and any
-- account that never finished onboarding at all.
--
-- Trade-off, explicit: EscolherNivel.jsx's own stated design principle is
-- "a escolha é explícita e não tem default" — this migration overrides
-- that for existing 0-rating accounts as a deliberate one-time cleanup
-- (decision: 2026-08-31). It does NOT touch how new signups behave going
-- forward — every account created after this runs still gets
-- rating_onboarded_at = NULL from handle_new_user() and is still gated by
-- Guard (App.jsx) into EscolherNivel before it can do anything else. Run
-- this only once; running it again is a no-op (WHERE rating IS NULL only
-- matches accounts that still need it).
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- Run AFTER migration_global_rankings_include_onboarded.sql, so these
-- accounts immediately show their new 900 in every ranking/points list.
-- ════════════════════════════════════════════════════════════════════════

UPDATE profiles
SET rating = 900,
    rating_anchor = 900,
    rating_onboarded_at = COALESCE(rating_onboarded_at, NOW())
WHERE rating IS NULL;
