-- ═════════════════════════════════════════════════════════════════════════
-- Perfil de outra pessoa › Jogos: respeita a atividade e os resultados
--
-- PORQUÊ. Dev 4, 16 out (R13, o perfil de outra pessoa com o separador
-- «Jogos»): o get_my_played_history(p_user_id) já serve para ver os jogos de
-- outra pessoa, mas o played_history_visible só olhava para os resultados
-- (results_visibility). A lista de jogos de hoje desse perfil
-- (get_player_match_history) olha para a atividade (activity_visibility). O
-- histórico novo mostra as duas coisas — que jogos e com que resultado —
-- por isso tem de respeitar as duas.
--
-- O QUE FAZ. played_history_visible(p_uid): o próprio vê sempre; os outros
-- só se puderem ver a atividade E os resultados dessa pessoa
-- (can_view_section). Serve o histórico, os meses e os tipos
-- (get_my_played_history, get_my_played_months, get_my_played_kinds). Quem
-- não pode ver recebe a lista vazia; o perfil continua a aparecer.
--
-- Dev 3, 16 out 2026 · ecrã: Dev 4 (R13)
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.played_history_visible(p_uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT auth.uid() IS NOT NULL AND p_uid IS NOT NULL
     AND (p_uid = auth.uid()
          -- Que jogos (atividade) e com que resultado (resultados): as duas (16 out).
          OR EXISTS (SELECT 1 FROM profiles pr WHERE pr.id = p_uid
                       AND can_view_section(p_uid, pr.activity_visibility)
                       AND can_view_section(p_uid, pr.results_visibility)));
$function$;

COMMIT;

-- Verificar depois de correr (true):
--   SELECT pg_get_functiondef('public.played_history_visible(uuid)'::regprocedure) LIKE '%activity_visibility%';
