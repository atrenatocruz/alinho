-- ═════════════════════════════════════════════════════════════════════════
-- Jogos entre amigos: o cartão da Home diz se o jogo contou
--
-- PORQUÊ. QA (via Bugs, 12 out): o cartão da Home lia ranked_intent e dizia
-- «Conta para o ranking» num jogo enviado que não contou (tinha
-- convidados). O que diz se contou é o estado da sessão depois do «O fim».
--
-- O QUE FAZ. get_my_private_matches ganha, em cada linha, como o
-- session_finished_at:
--   · session_ranking_state = friend_match_ranking_state(raiz): 'counted',
--     'waiting', 'rejected', 'not_ranked'; NULL antes de enviar e nos jogos
--     que não são entre amigos.
--   · session_games_counted: quantos pares da sessão contaram.
-- Muda o que a função devolve: DROP + CREATE a partir do corpo VIVO (2
-- trocas literais; «já estava»), e volta a dar EXECUTE só a authenticated.
--
-- ORDEM. Depois de migration_amigos_o_fim.sql.
--
-- Dev 3, 12 out 2026 · ecrã: Bugs
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  c_ret  CONSTANT TEXT := 'session_finished_at timestamp with time zone)';
  c_sel  CONSTANT TEXT := E'(SELECT r.finished_at FROM private_matches r WHERE r.id = COALESCE(pm.session_id, pm.id))\n  FROM private_matches pm';
  v_def  TEXT := pg_get_functiondef('public.get_my_private_matches()'::regprocedure);
BEGIN
  IF v_def LIKE '%session_ranking_state%' THEN
    RAISE NOTICE 'get_my_private_matches: já estava';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, c_ret, ''))) / length(c_ret) <> 1
     OR (length(v_def) - length(replace(v_def, c_sel, ''))) / length(c_sel) <> 1 THEN
    RAISE EXCEPTION 'get_my_private_matches: um dos pedaços a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  v_def := replace(v_def, c_ret, 'session_finished_at timestamp with time zone, session_ranking_state text, session_games_counted integer)');
  v_def := replace(v_def, c_sel,
       E'(SELECT r.finished_at FROM private_matches r WHERE r.id = COALESCE(pm.session_id, pm.id)),\n'
    || E'    CASE WHEN pm.is_friend_session OR pm.session_id IS NOT NULL\n'
    || E'         THEN friend_match_ranking_state(COALESCE(pm.session_id, pm.id)) END,\n'
    || E'    CASE WHEN pm.is_friend_session OR pm.session_id IS NOT NULL\n'
    || E'         THEN (SELECT count(DISTINCT gp.id)::int FROM private_matches gp\n'
    || E'                 JOIN private_match_stats gs ON gs.private_match_id = gp.id\n'
    || E'                WHERE gp.friend_pair_of = COALESCE(pm.session_id, pm.id)) END\n'
    || E'  FROM private_matches pm');
  DROP FUNCTION public.get_my_private_matches();
  EXECUTE v_def;
END $$;

REVOKE ALL ON FUNCTION public.get_my_private_matches() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_private_matches() TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_function_result('public.get_my_private_matches()'::regprocedure) LIKE '%session_games_counted integer%';  -- true
--   SELECT has_function_privilege('anon', 'public.get_my_private_matches()', 'EXECUTE');  -- false
--   SELECT has_function_privilege('authenticated', 'public.get_my_private_matches()', 'EXECUTE');  -- true
