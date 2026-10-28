-- ═════════════════════════════════════════════════════════════════════════
-- Liga: a página do encontro sabe o «Aos 40-40» da liga
--
-- PORQUÊ. O Francisco aprovou a 28 out que a página do encontro mostre a
-- linha «Aos 40-40: ponto de ouro» (design-handoff/2026-10-28-aos-40-40-
-- liga). O get_league_page já devolve league.deuce_mode (migration_aos_40_40);
-- o get_league_encounter não. Pedido do Dev 1, que lê e.league.deuce_mode
-- (sem ele, o encontro mostra ponto de ouro, por isso nada parte).
--
-- O QUE FAZ. Junta 'deuce_mode', v_l.deuce_mode ao objeto 'league' do
-- get_league_encounter (emenda por texto ao corpo vivo; 1 vez, ou «já
-- estava»).
--
-- ORDEM. Depois da migration_aos_40_40.sql (precisa de leagues.deuce_mode).
--
-- COMPATIBILIDADE. Mesma assinatura; só aparece mais um campo.
--
-- Dev 3, 28 out 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  v_def TEXT;
  v_n   INT;
  v_old TEXT := $t$'league', jsonb_build_object('slug', v_l.slug, 'name', v_l.name, 'kind', v_l.kind),$t$;
  v_new TEXT := $t$'league', jsonb_build_object('slug', v_l.slug, 'name', v_l.name, 'kind', v_l.kind, 'deuce_mode', v_l.deuce_mode),$t$;
BEGIN
  v_def := replace(pg_get_functiondef('public.get_league_encounter(uuid)'::regprocedure), E'\r', '');
  IF position(v_new IN v_def) > 0 THEN
    RAISE NOTICE 'get_league_encounter já estava';
    RETURN;
  END IF;
  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'get_league_encounter: esperava 1 vez o objeto league, encontrei %. Parar.', v_n;
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END $$;

-- CREATE OR REPLACE mantém os GRANT (anon e authenticated leem a página
-- pública do encontro); só se tira o PUBLIC, como nas outras.
REVOKE EXECUTE ON FUNCTION public.get_league_encounter(uuid) FROM PUBLIC;

COMMIT;

-- Verificar depois de correr:
--   SELECT position('''deuce_mode'', v_l.deuce_mode' IN prosrc) > 0 FROM pg_proc
--    WHERE proname = 'get_league_encounter';  → true
