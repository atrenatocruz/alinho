-- ════════════════════════════════════════════════════════════════════════
-- Migration: como se juntam as duplas de um mix (Trello #262, parte A)
--
-- Decisão do Francisco, 15–16 set 2026: quem cria o mix escolhe como se
-- juntam as duplas de quem se inscreve sozinho:
--   por_nivel   — forte com forte (o que a app sempre fez; pré-escolha)
--   equilibrado — um da metade mais forte com um da metade mais fraca,
--                 sorteado dentro das metades
--   aleatorio   — sorteio
-- A lógica vive em src/lib/mixLogic.js (formDuplas). A regra do Renato de
-- não repetir pares dos últimos 4 mixes vale nos três modos.
--
-- Sem dependências de outras migrações por correr. Mixes que já existem
-- ficam em 'por_nivel' — nada muda para ninguém até alguém escolher outro.
--
-- A app só envia pairing_mode quando é diferente de 'por_nivel' (mesmo
-- truque do pool_size), por isso criar mixes continua a funcionar antes
-- de isto correr.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. O modo no mix e no molde das séries recorrentes ───────────────────
ALTER TABLE games
  ADD COLUMN IF NOT EXISTS pairing_mode TEXT NOT NULL DEFAULT 'por_nivel';
ALTER TABLE games DROP CONSTRAINT IF EXISTS games_pairing_mode_check;
ALTER TABLE games ADD CONSTRAINT games_pairing_mode_check
  CHECK (pairing_mode IN ('por_nivel', 'equilibrado', 'aleatorio'));

ALTER TABLE game_recurrences
  ADD COLUMN IF NOT EXISTS pairing_mode TEXT NOT NULL DEFAULT 'por_nivel';
ALTER TABLE game_recurrences DROP CONSTRAINT IF EXISTS game_recurrences_pairing_mode_check;
ALTER TABLE game_recurrences ADD CONSTRAINT game_recurrences_pairing_mode_check
  CHECK (pairing_mode IN ('por_nivel', 'equilibrado', 'aleatorio'));

-- ── 2. process_due_game_recurrences — a versão mais recente é a de
--       migration_vouchers.sql. Igual, mais pairing_mode copiado do molde,
--       para os mixes seguintes de uma série manterem o modo escolhido. ──
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
      organization_id, title, date, location, price_per_player, prize, has_voucher,
      num_courts, max_players, court_time_minutes, game_time_minutes, format,
      gender_restriction, auto_start_hours_before, level, pairing_mode,
      status, created_by, recurrence_id, is_recurrence_origin, launch_at
    )
    VALUES (
      rec.organization_id, rec.title, v_new_date, rec.location, rec.price_per_player, rec.prize, rec.has_voucher,
      rec.num_courts, rec.num_courts * 4, rec.court_time_minutes, rec.game_time_minutes, rec.format,
      rec.gender_restriction, rec.auto_start_hours_before, rec.level, rec.pairing_mode,
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
