-- ════════════════════════════════════════════════════════════════════════
-- Migration: recurring mixes rework — pre-create the next occurrence as
-- 'pending' the moment the current one launches, instead of creating it
-- (and launching it, same instant) only when its scheduled time arrives.
-- See docs/superpowers/specs/2026-08-18-recurring-mixes-pending-state-design.md
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. games gains launch_at — only meaningful while status = 'pending' ──
ALTER TABLE games ADD COLUMN launch_at TIMESTAMPTZ;

-- ── 2. One-time backfill: give every currently-active recurrence its
--       first `pending` occurrence right now, using its existing
--       next_run_at as that row's launch_at — otherwise it would never
--       produce another mix once the old time-based creation is replaced. ─
INSERT INTO games (
  organization_id, title, date, location, price_per_player, prize,
  num_courts, max_players, court_time_minutes, game_time_minutes, format,
  status, created_by, recurrence_id, is_recurrence_origin, launch_at
)
SELECT
  rec.organization_id, rec.title,
  rec.next_run_at + make_interval(secs => rec.mix_offset_seconds),
  rec.location, rec.price_per_player, rec.prize,
  rec.num_courts, rec.num_courts * 4, rec.court_time_minutes, rec.game_time_minutes, rec.format,
  'pending', rec.created_by, rec.id, false, rec.next_run_at
FROM game_recurrences rec
WHERE rec.is_active = true
ON CONFLICT (recurrence_id, date) WHERE recurrence_id IS NOT NULL DO NOTHING;

UPDATE game_recurrences SET occurrences_created = occurrences_created + 1 WHERE is_active = true;

-- ── 3. next_run_at is obsolete — every pending row now carries its own
--       launch_at instead of one shared "next creation time" ────────────
ALTER TABLE game_recurrences DROP COLUMN next_run_at;

-- ── 4. Replace the cron function: launch the due pending mix, then
--       pre-create the one after it (instead of creating-and-launching a
--       mix in one step when its schedule fires). ────────────────────────
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
    SELECT g.id AS pending_game_id, g.date AS pending_date, gr.*
    FROM games g
    JOIN game_recurrences gr ON gr.id = g.recurrence_id
    WHERE g.status = 'pending' AND g.launch_at <= now() AND gr.is_active = true
    FOR UPDATE OF g SKIP LOCKED
  LOOP
    UPDATE games SET status = 'open', updated_at = now(), launch_at = NULL WHERE id = rec.pending_game_id;

    v_new_date := (
      (rec.pending_date AT TIME ZONE 'Europe/Lisbon') + (CASE rec.frequency
            WHEN 'daily'   THEN interval '1 day'
            WHEN 'weekly'  THEN interval '1 week'
            WHEN 'monthly' THEN interval '1 month'
            WHEN 'yearly'  THEN interval '1 year'
          END)
    ) AT TIME ZONE 'Europe/Lisbon';

    IF (rec.ends_type = 'on_date' AND v_new_date > rec.ends_on)
       OR (rec.ends_type = 'after_occurrences' AND rec.occurrences_created >= rec.ends_after_occurrences) THEN
      UPDATE game_recurrences SET is_active = false, updated_at = now() WHERE id = rec.id;
      CONTINUE;
    END IF;

    INSERT INTO games (
      organization_id, title, date, location, price_per_player, prize,
      num_courts, max_players, court_time_minutes, game_time_minutes, format,
      status, created_by, recurrence_id, is_recurrence_origin, launch_at
    )
    VALUES (
      rec.organization_id, rec.title, v_new_date, rec.location, rec.price_per_player, rec.prize,
      rec.num_courts, rec.num_courts * 4, rec.court_time_minutes, rec.game_time_minutes, rec.format,
      'pending', rec.created_by, rec.id, false,
      v_new_date - make_interval(secs => rec.mix_offset_seconds)
    )
    ON CONFLICT (recurrence_id, date) WHERE recurrence_id IS NOT NULL DO NOTHING;

    UPDATE game_recurrences
    SET occurrences_created = occurrences_created + 1, updated_at = now()
    WHERE id = rec.id;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION process_due_game_recurrences() FROM public;
