-- ════════════════════════════════════════════════════════════════════════
-- Migration: Grupos + Eliminatórias mix format
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- NOT LIVE until run there — this file existing in the repo changes
-- nothing on its own.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. New format value ─────────────────────────────────────────────────
-- ⚠️  IMPORTANT: Before running this migration, verify the actual name of the
--     format CHECK constraint. If it differs from 'games_format_check', update
--     the DROP CONSTRAINT line below to match. Query to find the real name:
--
--     SELECT conname FROM pg_constraint
--     WHERE conrelid = 'games'::regclass AND contype = 'c'
--       AND pg_get_constraintdef(oid) ILIKE '%format%';
--
ALTER TABLE games DROP CONSTRAINT IF EXISTS games_format_check;
ALTER TABLE games ADD CONSTRAINT games_format_check
  CHECK (format IN ('sobe_desce', 'todos_contra_todos', 'grupos_eliminatorias'));

-- ── 2. Pool size (admin-set per category-mix, only meaningful for the
--      new format) ───────────────────────────────────────────────────────
ALTER TABLE games ADD COLUMN IF NOT EXISTS pool_size INTEGER;

-- ── 3. Which pool a dupla belongs to during the group phase. NULL once
--      the format reaches the knockout phase (pool no longer matters). ───
ALTER TABLE teams ADD COLUMN IF NOT EXISTS pool_number INTEGER;
