-- ════════════════════════════════════════════════════════════════════════
-- Migration: Auto-cancel stale Mixes (daily background job, pg_cron)
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- Requires the pg_cron extension (already enabled by schema.sql /
-- migration_recurring_mixes.sql — CREATE EXTENSION below is a no-op if so).
--
-- Problem: a Mix whose date has passed but that never got closed out
-- (still 'open', 'closed', or 'in_progress') stays visible on the Jogos
-- tab forever. This sweeps those to 'cancelled' once a day, 24h after
-- the Mix's date, so the Jogos tab (which already filters out
-- status = 'cancelled', see src/pages/Home.jsx) stops showing it.
--
-- Recurring Mixes are unaffected: the next occurrence is created when the
-- current one flips from 'pending' to 'open' (process_due_game_recurrences,
-- see migration_recurring_mixes.sql), independent of what later happens to
-- that occurrence — so cancelling a stale recurring occurrence here never
-- breaks the chain.
-- ════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION cancel_stale_open_mixes()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE games
  SET status = 'cancelled', updated_at = now()
  WHERE status IN ('open', 'closed', 'in_progress')
    AND date < now() - interval '24 hours';
$$;

REVOKE ALL ON FUNCTION cancel_stale_open_mixes() FROM public;

-- cron.schedule updates the job in place if 'cancel-stale-mixes' already
-- exists, so this migration is safe to re-run. Runs once a day; the time
-- of day doesn't matter since staleness is judged by a relative 24h
-- interval, not a calendar-day boundary.
SELECT cron.schedule(
  'cancel-stale-mixes',
  '0 6 * * *',
  $$SELECT cancel_stale_open_mixes()$$
);
