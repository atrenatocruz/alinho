-- ═════════════════════════════════════════════════════════════════════════
-- Segurança: pesquisa, listas de seguidores e lista de espera do mix
--
-- PORQUÊ. Revisão só de leitura pedida pelo PO, 13 out. Três falhas que o
-- PO pôs no lote de sexta 16:
--   1. search_players devolvia os clubes e o nível de qualquer pessoa, mesmo
--      de quem os escondeu no perfil (clubs_visibility, results_visibility),
--      e o género de toda a gente. Os ecrãs já usam a search_people_basic
--      (só id, nome e foto, #518); a search_players fica para versões da
--      app guardadas no telemóvel, mas com o que o perfil deixa ver.
--   2. list_followers e list_following abertas a anon e sem olhar para o
--      perfil privado: qualquer pessoa, mesmo sem conta, via quem segue quem.
--   3. promote_waitlist(p_game_id) aberta a anon e authenticated sem
--      verificação: chamada à mão, subia suplentes e reabria um mix fechado
--      pelo admin.
--
-- O QUE FAZ
--   1. search_players: os clubes só se can_view_section(clubs_visibility);
--      o nível só se can_view_section(results_visibility); o género nunca
--      (não aparece em nenhum perfil). O lado preferido fica, como no
--      get_player_profile. Quem aparece na pesquisa não muda (o perfil nunca
--      desaparece). Corpo VIVO, 1 troca literal («já estava»).
--   2. list_followers e list_following: só com sessão; o próprio vê sempre;
--      perfil não privado, toda a gente com sessão vê (como hoje na app);
--      perfil privado, só quem o segue (aceite). Para os outros vem a lista
--      vazia — o número de seguidores continua a aparecer no perfil.
--   3. promote_waitlist: sai o acesso de public, anon e authenticated. Quem
--      a chama dentro da base (gatilhos e funções do mix e do torneio) é
--      SECURITY DEFINER e continua a poder; o robô usa service_role e fica.
--   4. meets_age_restriction: sai a anon (ver no fim).
--
-- Dev 3, 13 out 2026 · ecrãs: nenhum muda (a pesquisa já só usa id, nome e
-- foto; a lista de seguidores de um perfil privado de quem não o segue
-- passa a vir vazia)
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Pesquisa: só o que o perfil deixa ver ────────────────────────────
DO $$
DECLARE
  c_mau CONSTANT TEXT := 'SELECT p.id, p.name, p.avatar_url, clubs.club_names, p.rating, p.gender, p.preferred_side';
  c_bom CONSTANT TEXT := 'SELECT p.id, p.name, p.avatar_url,'
                      || ' CASE WHEN can_view_section(p.id, p.clubs_visibility) THEN clubs.club_names END,'
                      || ' CASE WHEN can_view_section(p.id, p.results_visibility) THEN p.rating END,'
                      || ' NULL::text,'
                      || ' p.preferred_side  -- só o que o perfil deixa ver (revisão do PO, 13 out)';
  v_def TEXT := pg_get_functiondef('public.search_players(text)'::regprocedure);
BEGIN
  IF position('só o que o perfil deixa ver' IN v_def) > 0 THEN
    RAISE NOTICE 'search_players: já estava';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, c_mau, ''))) / length(c_mau) <> 1 THEN
    RAISE EXCEPTION 'search_players: o pedaço a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE replace(v_def, c_mau, c_bom);
END $$;
REVOKE ALL ON FUNCTION public.search_players(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_players(TEXT) TO authenticated;

-- ── 2. Seguidores: com sessão, e o perfil privado só para quem o segue ──
CREATE OR REPLACE FUNCTION public.follow_lists_visible(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT auth.uid() IS NOT NULL
     AND (auth.uid() = p_user_id
          OR NOT COALESCE((SELECT pr.is_private FROM profiles pr WHERE pr.id = p_user_id), FALSE)
          OR EXISTS (SELECT 1 FROM follows f
                      WHERE f.follower_id = auth.uid() AND f.followed_id = p_user_id AND f.status = 'accepted'));
$function$;
REVOKE ALL ON FUNCTION public.follow_lists_visible(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.list_followers(p_user_id UUID)
RETURNS TABLE(id UUID, name TEXT, avatar_url TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT p.id, p.name, p.avatar_url
  FROM follows f
  JOIN profiles p ON p.id = f.follower_id
  WHERE f.followed_id = p_user_id AND f.status = 'accepted'
    AND follow_lists_visible(p_user_id)   -- revisão do PO, 13 out
  ORDER BY p.name;
$function$;
REVOKE ALL ON FUNCTION public.list_followers(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_followers(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_following(p_user_id UUID)
RETURNS TABLE(id UUID, name TEXT, avatar_url TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT p.id, p.name, p.avatar_url
  FROM follows f
  JOIN profiles p ON p.id = f.followed_id
  WHERE f.follower_id = p_user_id AND f.status = 'accepted'
    AND follow_lists_visible(p_user_id)   -- revisão do PO, 13 out
  ORDER BY p.name;
$function$;
REVOKE ALL ON FUNCTION public.list_following(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_following(UUID) TO authenticated;

-- ── 3. Lista de espera: só por dentro ───────────────────────────────────
REVOKE ALL ON FUNCTION public.promote_waitlist(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_waitlist(UUID) TO service_role;

-- ── 4. Idade: sem sessão, ninguém pergunta ──────────────────────────────
-- meets_age_restriction dizia a qualquer pessoa, mesmo sem conta, se outra
-- estava num escalão de idade. Sai a anon. authenticated fica: a regra de
-- entrar num mix (participants) chama-a com os direitos de quem entra, e
-- também para o parceiro. Restringir as perguntas sobre outros fica para
-- depois (revisão do PO, ponto 4).
REVOKE ALL ON FUNCTION public.meets_age_restriction(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meets_age_restriction(UUID, TEXT) TO authenticated;

COMMIT;

-- Verificar depois de correr (tudo true):
--   SELECT pg_get_functiondef('public.search_players(text)'::regprocedure) LIKE '%só o que o perfil deixa ver%'
--      AND NOT has_function_privilege('anon', 'public.list_followers(uuid)', 'EXECUTE')
--      AND NOT has_function_privilege('anon', 'public.list_following(uuid)', 'EXECUTE')
--      AND NOT has_function_privilege('anon', 'public.promote_waitlist(uuid)', 'EXECUTE')
--      AND NOT has_function_privilege('authenticated', 'public.promote_waitlist(uuid)', 'EXECUTE')
--      AND has_function_privilege('service_role', 'public.promote_waitlist(uuid)', 'EXECUTE')
--      AND has_function_privilege('authenticated', 'public.list_followers(uuid)', 'EXECUTE')
--      AND NOT has_function_privilege('anon', 'public.meets_age_restriction(uuid,text)', 'EXECUTE')
--      AND has_function_privilege('authenticated', 'public.meets_age_restriction(uuid,text)', 'EXECUTE');
