-- ═════════════════════════════════════════════════════════════════════════
-- Arranque automático: começa com as duplas já sorteadas, sem sortear outras
--
-- PORQUÊ. Francisco, 2 out («mexe e corrige isso»): o arranque automático
-- (start_due_mixes, de 5 em 5 min) criava as duplas sem ver se quem organiza
-- já as tinha sorteado na app. Num mix com arranque automático e duplas
-- sorteadas à mão ficavam duplas a dobrar. O robô fazia o mesmo
-- (whatsapp-bot/src/autostart.js), corrigido no mesmo envio.
--
-- O QUE FAZ. Em start_due_mixes (corpo VIVO, 1 troca; «já estava»): se o mix
-- já tem duplas,
--   · todas completas e pelo menos 2 → começa com essas (in_progress), sem
--     sortear;
--   · com um lugar vazio, ou só 1 dupla → não começa e volta a ver na volta
--     seguinte (quem organiza tem de completar a dupla).
-- Sem duplas, sorteia como sempre. Tudo o resto igual.
--
-- Dev 3, 2 out 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  c_mau CONSTANT TEXT := '(CONTINUE WHEN v_tem_bot[[:space:]]+AND v_game\.date > now\(\) \+ \(\(v_game\.auto_start_hours_before \* 60 - 15\) \|\| '' minutes''\)::interval;)';
  c_bom CONSTANT TEXT := '\1

    -- Duplas já sorteadas por quem organiza (2 out): começa com essas, sem
    -- sortear outras por cima. Com um lugar vazio, ou só 1 dupla, espera.
    IF EXISTS (SELECT 1 FROM teams WHERE game_id = v_game.id) THEN
      CONTINUE WHEN (SELECT count(*) FROM teams WHERE game_id = v_game.id) < 2
        OR EXISTS (SELECT 1 FROM teams t WHERE t.game_id = v_game.id
                    AND ((t.player1_id IS NULL AND t.player1_guest_id IS NULL)
                      OR (t.player2_id IS NULL AND t.player2_guest_id IS NULL)));
      UPDATE games SET status = ''in_progress'', updated_at = NOW() WHERE id = v_game.id;
      v_arrancados := v_arrancados + 1;
      CONTINUE;
    END IF;';
  v_def TEXT := pg_get_functiondef('public.start_due_mixes()'::regprocedure);
BEGIN
  IF v_def LIKE '%Duplas já sorteadas por quem organiza%' THEN
    RAISE NOTICE 'start_due_mixes: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'start_due_mixes: o pedaço a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE regexp_replace(v_def, c_mau, c_bom);
END $$;

-- Interna: só o pg_cron a chama.
REVOKE EXECUTE ON FUNCTION public.start_due_mixes() FROM PUBLIC, anon, authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_functiondef('public.start_due_mixes()'::regprocedure) LIKE '%Duplas já sorteadas por quem organiza%';  -- true
