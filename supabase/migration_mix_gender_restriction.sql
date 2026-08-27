-- ════════════════════════════════════════════════════════════════════════
-- Migration: gender restriction on a mix — an admin can require a mix be
-- masculino-only, feminino-only, misto, or indiferente (no restriction,
-- the existing default behavior). profiles.gender already exists
-- ('masculino' | 'feminino' | NULL) — no new player-facing data needed.
-- 'misto' and 'indiferente' both mean "no eligibility restriction" for
-- join purposes; 'misto' exists only as a distinct label an admin can pick
-- to advertise the mix as intentionally mixed-gender. Trello #111.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. games / game_recurrences gain gender_restriction. ──────────────────
ALTER TABLE games ADD COLUMN IF NOT EXISTS gender_restriction TEXT NOT NULL DEFAULT 'indiferente'
  CHECK (gender_restriction IN ('masculino', 'feminino', 'misto', 'indiferente'));
ALTER TABLE game_recurrences ADD COLUMN IF NOT EXISTS gender_restriction TEXT NOT NULL DEFAULT 'indiferente'
  CHECK (gender_restriction IN ('masculino', 'feminino', 'misto', 'indiferente'));

-- ── 2. process_due_game_recurrences — carry gender_restriction into every
--       occurrence the cron creates from a recurrence, same as every other
--       snapshot field (num_courts, format, ...). ─────────────────────────
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
    IF EXISTS (
      SELECT 1 FROM games
      WHERE recurrence_id = rec.id AND status IN ('open', 'closed', 'in_progress')
    ) THEN
      CONTINUE;
    END IF;

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
      gender_restriction, status, created_by, recurrence_id, is_recurrence_origin, launch_at
    )
    VALUES (
      rec.organization_id, rec.title, v_new_date, rec.location, rec.price_per_player, rec.prize,
      rec.num_courts, rec.num_courts * 4, rec.court_time_minutes, rec.game_time_minutes, rec.format,
      rec.gender_restriction,
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

-- ── 3. participants INSERT policy — refuse a join whose user (or chosen
--       partner) doesn't satisfy the mix's gender_restriction. 'misto' and
--       'indiferente' short-circuit to no restriction. ────────────────────
DROP POLICY IF EXISTS "Users can join games in their org" ON participants;
CREATE POLICY "Users can join games in their org"
  ON participants FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM games JOIN memberships ON memberships.organization_id = games.organization_id
      WHERE games.id = participants.game_id AND memberships.user_id = auth.uid()
    )
    AND (
      (SELECT gender_restriction FROM games WHERE games.id = participants.game_id) IN ('indiferente', 'misto')
      OR (
        (SELECT gender FROM profiles WHERE id = participants.user_id)
          = (SELECT gender_restriction FROM games WHERE games.id = participants.game_id)
        AND (
          participants.partner_id IS NULL
          OR (SELECT gender FROM profiles WHERE id = participants.partner_id)
               = (SELECT gender_restriction FROM games WHERE games.id = participants.game_id)
        )
      )
    )
  );
