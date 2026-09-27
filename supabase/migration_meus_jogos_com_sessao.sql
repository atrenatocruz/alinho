-- ═════════════════════════════════════════════════════════════════════════
-- get_my_private_matches diz de que sessão é cada jogo
--
-- PORQUÊ. Bug visto pelo Francisco (27 set, 21:24): na Home, um jogo entre
-- amigos a rodar aparece como um cartão por cada jogo da rotação. O ecrã
-- (Dev 2) junta-os num cartão por sessão, mas a agenda não dizia de que
-- sessão é cada linha. Pedido do Dev 2, sem mais nada a mudar.
--
-- O QUE FAZ. Acrescenta, no fim do que a função devolve:
--   session_id      — a sessão do jogo entre amigos (o id da 1.ª linha; a
--                     própria 1.ª linha também o traz); NULL nos jogos soltos;
--   game_number, organization_id, game_minutes, started_at, pairing_mode.
-- Muda o que a função devolve, por isso é DROP + CREATE a partir do corpo
-- VIVO (as duas trocas têm de aparecer 1 vez; «já estava» se já correu).
--
-- Dev 3, 27 set 2026 · depois de migration_amigos_sem_bloquear.sql
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  c_ret_mau CONSTANT TEXT := '(my_rating_after numeric)\)';
  c_ret_bom CONSTANT TEXT := '\1, session_id uuid, game_number integer, organization_id uuid, game_minutes smallint, started_at timestamp with time zone, pairing_mode text)';
  c_sel_mau CONSTANT TEXT := '(pms\.rating_delta, pms\.rating_after)';
  c_sel_bom CONSTANT TEXT := '\1,
    CASE WHEN pm.is_friend_session THEN pm.id ELSE pm.session_id END,
    pm.game_number, pm.organization_id, pm.game_minutes, pm.started_at, pm.pairing_mode';
  v_def TEXT := pg_get_functiondef('public.get_my_private_matches()'::regprocedure);
BEGIN
  IF v_def LIKE '%pairing_mode text)%' THEN
    RAISE NOTICE 'get_my_private_matches: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_ret_mau, 'g')) <> 1
     OR (SELECT count(*) FROM regexp_matches(v_def, c_sel_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'get_my_private_matches: os pedaços a trocar não aparecem 1 vez. Parar e ler.';
  END IF;
  v_def := regexp_replace(regexp_replace(v_def, c_ret_mau, c_ret_bom), c_sel_mau, c_sel_bom);
  DROP FUNCTION public.get_my_private_matches();
  EXECUTE v_def;
END $$;

REVOKE ALL ON FUNCTION public.get_my_private_matches() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_private_matches() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_private_matches() TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_function_result('public.get_my_private_matches()'::regprocedure) LIKE '%pairing_mode text%';  -- true
--   SELECT has_function_privilege('anon', 'public.get_my_private_matches()', 'EXECUTE');                       -- false
