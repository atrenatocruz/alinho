-- ════════════════════════════════════════════════════════════════════════
-- Migration: Mix price per player + prize
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- No dashboard toggles needed for this migration.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE games ADD COLUMN IF NOT EXISTS price_per_player NUMERIC(6,2);
ALTER TABLE games ADD COLUMN IF NOT EXISTS prize TEXT;
