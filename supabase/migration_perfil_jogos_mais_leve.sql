-- ═════════════════════════════════════════════════════════════════════════
-- Perfil › Jogos: o histórico só faz as contas de cada tipo nas suas linhas
--
-- PORQUÊ. QA e PO, 14 out: no alinho-dev, o Perfil › Jogos levava 6 a 10 s
-- pela app e caía aos 8 s. Duas razões:
--   · o alinho-dev é um servidor pequeno (metade da memória de produção) e
--     reiniciou-se duas vezes nessa manhã (10:36 e 10:48 UTC, «not properly
--     shut down»): as medições pela app lá estão muito acima do normal;
--   · o get_my_played_history fazia, em cada linha da página, as contas do
--     lugar no mix (mix_final_places) e da dupla entre amigos
--     (friend_match_pair_rows) para TODAS as linhas, mesmo as de outro tipo:
--     o filtro «p.src = …» estava dentro da subconsulta, depois de a função
--     já ter corrido.
--
-- O QUE FAZ. As duas contas passam a correr só nas linhas do seu tipo
-- (CASE à volta da subconsulta). O resultado é exatamente o mesmo; os
-- argumentos e a forma do que devolve não mudam (ecrã do Dev 4 igual).
-- Corpo VIVO, 2 trocas literais («já estava»).
--
-- ORDEM. Depois de migration_perfil_jogos_com_vida.sql (que cria a função)
-- e das que lhe mexem a seguir no lote de sexta.
--
-- Dev 3, 14 out 2026 · ecrã: Dev 4 (não muda)
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  c_marca CONSTANT TEXT := 'só nas linhas do seu tipo (14 out)';
  c1 CONSTANT TEXT := E'           (SELECT jsonb_build_object(''place'', f.place, ''total'', f.total) FROM mix_final_places(p.ref) f\n'
                   || E'             WHERE p.src = ''mix'' AND f.user_id = v_uid LIMIT 1) AS lugar_mix,';
  b1 CONSTANT TEXT := E'           -- Cada conta ' || c_marca || E'.\n'
                   || E'           CASE WHEN p.src = ''mix'' THEN (SELECT jsonb_build_object(''place'', f.place, ''total'', f.total) FROM mix_final_places(p.ref) f\n'
                   || E'             WHERE f.user_id = v_uid LIMIT 1) END AS lugar_mix,';
  c2 CONSTANT TEXT := E'           (SELECT to_jsonb(q) FROM friend_match_pair_rows(p.ref) q\n'
                   || E'             WHERE p.src = ''friends'' AND COALESCE(p.format, ''fixed'') <> ''rotating'' AND v_uid IN (q.a1, q.a2, q.b1, q.b2)\n'
                   || E'             ORDER BY q.rounds_a + q.rounds_b DESC LIMIT 1) AS par,';
  b2 CONSTANT TEXT := E'           CASE WHEN p.src = ''friends'' AND COALESCE(p.format, ''fixed'') <> ''rotating'' THEN (SELECT to_jsonb(q) FROM friend_match_pair_rows(p.ref) q\n'
                   || E'             WHERE v_uid IN (q.a1, q.a2, q.b1, q.b2)\n'
                   || E'             ORDER BY q.rounds_a + q.rounds_b DESC LIMIT 1) END AS par,';
  v_def TEXT := replace(pg_get_functiondef('public.get_my_played_history(uuid,timestamptz,integer,text,text,date)'::regprocedure), E'\r', '');
BEGIN
  IF position(c_marca IN v_def) > 0 THEN
    RAISE NOTICE 'get_my_played_history: já estava';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, c1, ''))) / length(c1) <> 1
     OR (length(v_def) - length(replace(v_def, c2, ''))) / length(c2) <> 1 THEN
    RAISE EXCEPTION 'get_my_played_history: um dos pedaços a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE replace(replace(v_def, c1, b1), c2, b2);
END $$;

COMMIT;

-- Verificar depois de correr (true):
--   SELECT pg_get_functiondef('public.get_my_played_history(uuid,timestamptz,integer,text,text,date)'::regprocedure)
--          LIKE '%só nas linhas do seu tipo (14 out)%';
