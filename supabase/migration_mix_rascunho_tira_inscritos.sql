-- ═════════════════════════════════════════════════════════════════════════
-- Mix: «Voltar a rascunho» tira os inscritos e guarda o evento
--
-- PORQUÊ. Francisco, 6 out (substitui a opção c de 2 out): «É tipo cancelar
-- e voltar a modo draft, mas fica lá o evento. Cancelar retira tudo do mix
-- deixando apenas os jogos jogados para registo. O draft faz o mesmo, mas
-- fica lá na área de gestão para se quiser ativar outra vez mais tarde.»
-- «Recebem aviso na app.» Urgente: o Smash deixou os mixes e o Francisco
-- quer pôr hoje os dele em rascunho. Ecrã: Dev 2.
--
-- O QUE FAZ. unpublish_mix(p_game_id) → 'draft' (mesmo nome, mesmos
-- parâmetros, devolve o mesmo).
--   · Só o admin do clube ou grupo ('not_allowed').
--   · Qualquer mix publicado e ainda não terminado: aberto, cheio, por abrir
--     ou já começado ('not_published' em rascunho, terminado ou cancelado).
--     Saem as travas de 2 out: com inscritos, depois do anúncio do robô e
--     depois da hora.
--   · Tira toda a gente: inscritos, suplentes e pedidos. Cada pessoa com
--     conta (e o parceiro) recebe 'mix_unpublished' {game_title, game_date}:
--     «<mix> foi retirado pela organização» (nunca «cancelado»).
--   · Ficam os jogos já jogados (com resultado), e as duplas desses jogos,
--     para registo. Os jogos sem resultado e as outras duplas saem.
--   · O mix fica 'draft', sem launch_at, round_started_at nem unfilled_at:
--     só aparece no Gerir de quem organiza e publica-se como um rascunho
--     normal. O robô deixa de o mostrar (só mostra abertos) e não anuncia
--     nada com @todos (o aviso de cancelado só sai para 'cancelled').
--
-- Corpo VIVO conferido antes de trocar (tem de ser o de 2 out; «já
-- estava» se já for este). Dev 3, 6 out 2026 · ecrã: Dev 2
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  v_def TEXT := pg_get_functiondef('public.unpublish_mix(uuid)'::regprocedure);
BEGIN
  IF v_def LIKE '%mix_unpublished%' THEN
    RAISE NOTICE 'unpublish_mix: já estava';
    RETURN;
  END IF;
  IF v_def NOT LIKE '%has_players%' OR v_def NOT LIKE '%alinho.unpublish_mix%' THEN
    RAISE EXCEPTION 'unpublish_mix: o corpo vivo não é o de 2 out. Parar e ler.';
  END IF;
  EXECUTE $f$
CREATE OR REPLACE FUNCTION public.unpublish_mix(p_game_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  g games%ROWTYPE;
BEGIN
  SELECT * INTO g FROM games WHERE id = p_game_id FOR UPDATE;
  IF g.id IS NULL OR auth.uid() IS NULL OR NOT is_org_admin(g.organization_id) THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  IF g.status IN ('draft', 'finished', 'cancelled') THEN
    RAISE EXCEPTION 'not_published';
  END IF;

  -- Primeiro o estado: com o mix em rascunho, sair não sobe suplentes a
  -- lugares nem mexe nas duplas. A trava games_draft_one_way (25 set) só
  -- deixa passar este caminho.
  PERFORM set_config('alinho.unpublish_mix', 'on', true);
  UPDATE games SET status = 'draft', launch_at = NULL, round_started_at = NULL,
                   unfilled_at = NULL, updated_at = NOW()
   WHERE id = g.id;
  PERFORM set_config('alinho.unpublish_mix', '', true);

  -- Aviso a quem estava no mix (Francisco, 6 out: «retirado», não «cancelado»).
  INSERT INTO notifications (user_id, kind, game_id, actor_id, data)
  SELECT DISTINCT who.u, 'mix_unpublished', g.id, auth.uid(),
         jsonb_build_object('game_title', g.title, 'game_date', g.date)
    FROM (
      SELECT p.user_id AS u FROM participants p
       WHERE p.game_id = g.id AND p.status NOT IN ('declined', 'cancelled')
      UNION
      SELECT p.partner_id FROM participants p
       WHERE p.game_id = g.id AND p.status NOT IN ('declined', 'cancelled')
    ) who
   WHERE who.u IS NOT NULL AND who.u <> auth.uid();

  DELETE FROM participants WHERE game_id = g.id;

  -- Ficam os jogos jogados (e as suas duplas), para registo.
  DELETE FROM matches m
   WHERE m.game_id = g.id AND m.score_a IS NULL AND m.score_b IS NULL;
  DELETE FROM teams t
   WHERE t.game_id = g.id
     AND NOT EXISTS (SELECT 1 FROM matches m WHERE m.team_a_id = t.id OR m.team_b_id = t.id);

  RETURN 'draft';
END;
$function$;
$f$;
END $$;

REVOKE ALL ON FUNCTION public.unpublish_mix(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.unpublish_mix(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.unpublish_mix(UUID) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_functiondef('public.unpublish_mix(uuid)'::regprocedure) LIKE '%mix_unpublished%';  -- true
--   SELECT has_function_privilege('anon', 'public.unpublish_mix(uuid)', 'EXECUTE');  -- false
