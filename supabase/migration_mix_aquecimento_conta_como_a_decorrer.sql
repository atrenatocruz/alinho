-- ═════════════════════════════════════════════════════════════════════════
-- Mix: o aquecimento já conta como «A decorrer agora» (#768)
--
-- PORQUÊ. Francisco, 8 nov: a Home, a página do mix e o Gerir já tratam o
-- aquecimento como mix a decorrer (isMixLive, src/lib/mixLive.js). Faltava a
-- lista do servidor, para a linha «A decorrer agora» bater certo. Isto
-- substitui a nota antiga de migration_mix_aquecimento_e_troca.sql.
--
-- O QUE FAZ. No list_live_events (corpo vivo, 2 trocas literais):
--   · um mix em aquecimento entra na lista;
--   · o número da ronda nunca vem vazio (no aquecimento é a ronda 1).
--
-- ORDEM. Depois de migration_mix_aquecimento_e_troca.sql (usa a coluna
-- round_phase). Sem ela, o ficheiro para e não muda nada.
--
-- COMPATIBILIDADE. A resposta mantém os mesmos campos; as apps antigas não
-- mudam.
--
-- Para desfazer (só em emergência): voltar a pôr o corpo anterior
-- (md5 sem \r ad43be2e…, antes das trocas).
--
-- Dev 3, 9 nov 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'games' AND column_name = 'round_phase') THEN
    RAISE EXCEPTION 'Falta migration_mix_aquecimento_e_troca.sql. Parar.';
  END IF;
END $$;

DO $$
DECLARE
  v_marca CONSTANT TEXT := 'o aquecimento já conta (#768, 8 nov)';
  v_def   TEXT := replace(pg_get_functiondef('public.list_live_events(uuid)'::regprocedure), E'\r', '');
  v_n     INT;
  r       RECORD;
BEGIN
  IF position(v_marca IN v_def) > 0 THEN
    RAISE NOTICE 'list_live_events: já estava';
    RETURN;
  END IF;
  FOR r IN
    SELECT * FROM (VALUES
      ('AND (gm.round_started_at IS NOT NULL',
       E'AND (gm.round_started_at IS NOT NULL\n                   OR gm.round_phase = ''aquecimento''  -- ' || v_marca),
      ('''round_number'', (SELECT max(round_number) FROM matches WHERE game_id = g.id),',
       '''round_number'', COALESCE((SELECT max(round_number) FROM matches WHERE game_id = g.id), 1),')
    ) AS x(old_txt, new_txt)
  LOOP
    v_n := (length(v_def) - length(replace(v_def, r.old_txt, ''))) / length(r.old_txt);
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'list_live_events: esperava 1 vez «%», encontrei %. Parar e ler.', r.old_txt, v_n;
    END IF;
    v_def := replace(v_def, r.old_txt, r.new_txt);
  END LOOP;
  EXECUTE v_def;
END $$;

REVOKE ALL ON FUNCTION public.list_live_events(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_live_events(uuid) FROM anon;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.list_live_events(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.list_live_events(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Acessos de list_live_events errados';
  END IF;
  IF position('o aquecimento já conta (#768, 8 nov)' IN pg_get_functiondef('public.list_live_events(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'list_live_events sem a troca';
  END IF;
END $$;

COMMIT;
