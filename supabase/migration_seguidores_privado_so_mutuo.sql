-- ═════════════════════════════════════════════════════════════════════════
-- Perfil privado: as listas de seguidores só com o seguir mútuo
--
-- PORQUÊ. SI e PO, 14 out: num perfil privado, as listas de seguidores e de
-- quem segue são um detalhe. Seguem a regra do Francisco de 1 out para os
-- detalhes: só as vê o próprio e quem segue e é seguido (aceite dos dois
-- lados). A migration_seguranca_pesquisa_seguidores_espera.sql deixava ver
-- a quem só seguia.
--
-- O QUE FAZ. follow_lists_visible: no perfil privado, is_mutual_follow em
-- vez de «eu sigo». Perfil não privado: igual (toda a gente com sessão).
-- O número de seguidores continua sempre à vista (get_player_profile).
--
-- ORDEM. Depois de migration_seguranca_pesquisa_seguidores_espera.sql.
--
-- Dev 3, 14 out 2026 · ecrã: Dev 4 (R13, o texto «perfil privado»)
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

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
          -- Perfil privado: seguir e ser seguido (regra de 1 out; SI e PO, 14 out).
          OR is_mutual_follow(auth.uid(), p_user_id));
$function$;
REVOKE ALL ON FUNCTION public.follow_lists_visible(UUID) FROM PUBLIC, anon, authenticated;

COMMIT;

-- Verificar depois de correr (true):
--   SELECT pg_get_functiondef('public.follow_lists_visible(uuid)'::regprocedure) LIKE '%is_mutual_follow(auth.uid(), p_user_id)%'
--      AND NOT has_function_privilege('authenticated', 'public.follow_lists_visible(uuid)', 'EXECUTE');
