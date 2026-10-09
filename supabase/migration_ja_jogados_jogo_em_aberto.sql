-- ═════════════════════════════════════════════════════════════════════════
-- «Já jogados»: distinguir o jogo em aberto do mix
--
-- PORQUÊ. Bugs, 7 out (#508, o PO deu-lho): no «Já jogados» da Home, os
-- jogos em aberto (games.origin = 'open_slot') aparecem como «Mix».
-- list_played_events devolve-os com kind 'mix' e não diz o origin. O ecrã
-- já lê r.origin === 'open_slot' e mostra «Jogo em aberto».
--
-- O QUE FAZ. No ramo dos mixes, junta 'origin' (g.origin) ao que cada
-- linha traz (corpo VIVO, 1 troca; «já estava»). Devolve jsonb na mesma:
-- CREATE OR REPLACE, sem DROP; as permissões ficam (só authenticated).
--
-- Dev 3, 7 out 2026 · ecrã: Bugs
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  c_mau CONSTANT TEXT := '(''format'', g\.format,)';
  c_bom CONSTANT TEXT := '''origin'', g.origin,
             \1';
  v_def TEXT := pg_get_functiondef('public.list_played_events(uuid, timestamp with time zone, integer)'::regprocedure);
BEGIN
  IF v_def LIKE '%''origin'', g.origin%' THEN
    RAISE NOTICE 'list_played_events: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'list_played_events: o pedaço a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE regexp_replace(v_def, c_mau, c_bom);
END $$;

REVOKE ALL ON FUNCTION public.list_played_events(uuid, timestamp with time zone, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_played_events(uuid, timestamp with time zone, integer) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_functiondef('public.list_played_events(uuid,timestamptz,integer)'::regprocedure) LIKE '%''origin'', g.origin%';  -- true
--   SELECT has_function_privilege('anon', 'public.list_played_events(uuid,timestamptz,integer)', 'EXECUTE');  -- false
