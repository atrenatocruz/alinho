-- ═════════════════════════════════════════════════════════════════════════
-- «A decorrer»: um mix só aparece depois de a 1.ª ronda começar
--
-- PORQUÊ. PO via Dev 2, 12 out: o list_live_events mostrava o mix «a
-- decorrer» assim que o status passava a 'in_progress' — o que acontece
-- quando as duplas ficam formadas, às vezes horas antes, pelo robô.
--
-- O QUE FAZ. No ramo dos mixes do list_live_events, o mix só entra com
-- status 'in_progress' E (a ronda já começou: games.round_started_at, OU já
-- há um jogo com resultado nesse mix — vencedor ou empate gravado). A app
-- (Home, Gerir, série) segue a mesma regra (Dev 2). Corpo VIVO, 1 troca
-- literal («já estava»); devolve jsonb na mesma.
--
-- Dev 3, 12 out 2026 · ecrã: Dev 2
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  c_frag CONSTANT TEXT := $a$WHERE gm.organization_id = ANY (v_orgs) AND gm.status = 'in_progress'$a$;
  v_def  TEXT := pg_get_functiondef('public.list_live_events(uuid)'::regprocedure);
BEGIN
  IF v_def LIKE '%gm.round_started_at IS NOT NULL%' THEN
    RAISE NOTICE 'list_live_events: já estava';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, c_frag, ''))) / length(c_frag) <> 1 THEN
    RAISE EXCEPTION 'list_live_events: o pedaço a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE replace(v_def, c_frag, c_frag
    || E'\n              -- Só depois de a 1.ª ronda começar (duplas formadas não chegam).'
    || E'\n              AND (gm.round_started_at IS NOT NULL'
    || E'\n                   OR EXISTS (SELECT 1 FROM matches mx WHERE mx.game_id = gm.id'
    || E'\n                                AND (mx.winner_team_id IS NOT NULL OR (mx.score_a IS NOT NULL AND mx.score_b IS NOT NULL))))');
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_functiondef('public.list_live_events(uuid)'::regprocedure) LIKE '%gm.round_started_at IS NOT NULL%';  -- true
