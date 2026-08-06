-- ════════════════════════════════════════════════════════════════════════
-- Migration: Mixes recorrentes (recurring Mixes)
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- Requires the pg_cron extension. If "CREATE EXTENSION" below errors with
-- a permission error, enable it first via Dashboard → Database →
-- Extensions → search "pg_cron" → Enable, then re-run this file.
-- ════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

-- ── game_recurrences: the recurrence rule + a snapshot of the settings ──
-- copied into every auto-created Mix. The Mix that owns this row
-- (games.is_recurrence_origin = true) is the only one whose edits update
-- this snapshot — already-created Mixes are never rewritten.
CREATE TABLE game_recurrences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'yearly')),
  ends_type TEXT NOT NULL CHECK (ends_type IN ('never', 'on_date', 'after_occurrences')),
  ends_on TIMESTAMPTZ,
  ends_after_occurrences INTEGER,
  occurrences_created INTEGER NOT NULL DEFAULT 1, -- the original Mix counts as occurrence 1
  mix_offset_seconds INTEGER NOT NULL, -- (mix date) - (auto-create date), fixed at creation time
  next_run_at TIMESTAMPTZ NOT NULL,
  title TEXT NOT NULL,
  location TEXT,
  price_per_player NUMERIC(6,2),
  prize TEXT,
  num_courts INTEGER NOT NULL,
  court_time_minutes INTEGER NOT NULL,
  game_time_minutes INTEGER NOT NULL,
  format TEXT NOT NULL,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

ALTER TABLE games ADD COLUMN IF NOT EXISTS recurrence_id UUID REFERENCES game_recurrences(id);
ALTER TABLE games ADD COLUMN IF NOT EXISTS is_recurrence_origin BOOLEAN NOT NULL DEFAULT false;

-- Idempotency backstop: the same recurrence can never produce two Mixes on
-- the same date, even if the cron job somehow runs twice concurrently.
CREATE UNIQUE INDEX IF NOT EXISTS games_recurrence_date_key
  ON games(recurrence_id, date) WHERE recurrence_id IS NOT NULL;

ALTER TABLE game_recurrences ENABLE ROW LEVEL SECURITY;

-- Mirrors the games RLS policies: members can view, only org admins manage.
CREATE POLICY "Org members can view game recurrences"
  ON game_recurrences FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM memberships
    WHERE memberships.organization_id = game_recurrences.organization_id AND memberships.user_id = auth.uid()
  ));

CREATE POLICY "Org admins can create game recurrences"
  ON game_recurrences FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM memberships
    WHERE memberships.organization_id = game_recurrences.organization_id
      AND memberships.user_id = auth.uid() AND memberships.is_admin
  ));

CREATE POLICY "Org admins can update game recurrences"
  ON game_recurrences FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM memberships
    WHERE memberships.organization_id = game_recurrences.organization_id
      AND memberships.user_id = auth.uid() AND memberships.is_admin
  ));

CREATE POLICY "Org admins can delete game recurrences"
  ON game_recurrences FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM memberships
    WHERE memberships.organization_id = game_recurrences.organization_id
      AND memberships.user_id = auth.uid() AND memberships.is_admin
  ));

-- ── Background job: create due Mixes, advance the schedule ─────────────
CREATE OR REPLACE FUNCTION process_due_game_recurrences()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec RECORD;
  v_new_date TIMESTAMPTZ;
BEGIN
  FOR rec IN
    SELECT * FROM game_recurrences
    WHERE is_active = true AND next_run_at <= now()
    FOR UPDATE SKIP LOCKED
  LOOP
    v_new_date := rec.next_run_at + make_interval(secs => rec.mix_offset_seconds);

    -- End conditions are checked BEFORE creating the Mix that would exceed them.
    IF (rec.ends_type = 'on_date' AND v_new_date > rec.ends_on)
       OR (rec.ends_type = 'after_occurrences' AND rec.occurrences_created >= rec.ends_after_occurrences) THEN
      UPDATE game_recurrences SET is_active = false, updated_at = now() WHERE id = rec.id;
      CONTINUE;
    END IF;

    INSERT INTO games (
      organization_id, title, date, location, price_per_player, prize,
      num_courts, max_players, court_time_minutes, game_time_minutes, format,
      status, created_by, recurrence_id, is_recurrence_origin
    )
    VALUES (
      rec.organization_id, rec.title, v_new_date, rec.location, rec.price_per_player, rec.prize,
      rec.num_courts, rec.num_courts * 4, rec.court_time_minutes, rec.game_time_minutes, rec.format,
      'open', rec.created_by, rec.id, false
    )
    ON CONFLICT (recurrence_id, date) WHERE recurrence_id IS NOT NULL DO NOTHING;

    UPDATE game_recurrences
    SET next_run_at = rec.next_run_at + (CASE rec.frequency
          WHEN 'daily'   THEN interval '1 day'
          WHEN 'weekly'  THEN interval '1 week'
          WHEN 'monthly' THEN interval '1 month'
          WHEN 'yearly'  THEN interval '1 year'
        END),
        occurrences_created = occurrences_created + 1,
        updated_at = now()
    WHERE id = rec.id;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION process_due_game_recurrences() FROM public;

-- cron.schedule updates the job in place if 'process-game-recurrences'
-- already exists, so this migration is safe to re-run.
SELECT cron.schedule(
  'process-game-recurrences',
  '*/5 * * * *',
  $$SELECT process_due_game_recurrences()$$
);
