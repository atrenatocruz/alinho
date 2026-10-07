-- ═════════════════════════════════════════════════════════════════════════
-- Série de mixes em rascunho («Pausar») e «Ativar»
--
-- PORQUÊ. Francisco, 6–7 out: «quando mando meter em rascunho, ele mete
-- tudo em draft, como no início. Nada sai depois disso até eu voltar a
-- meter ativo.» Plano aprovado a 7 out (Dev 3 → PO → Francisco). Urgente:
-- as datas de 13 out da Locomotiva abrem às 18h00 de 7 out. Ecrã: Dev 2 (o
-- «Pausar» do Gerir passa a chamar a pause_recurrence_to_draft).
--
-- O QUE FAZ
--   · O estado da série em rascunho é o game_recurrences.is_paused que já
--     existe: com ele, o process_due_game_recurrences não abre datas (#529)
--     e o create_recurrence_successor não cria. O «Parar repetição»
--     (is_active = false) continua a ser o fim da série.
--   · pause_recurrence_to_draft(p_recurrence_id) → jsonb {dates, people}:
--     só o admin do clube ('not_allowed'). Põe is_paused e passa pelo
--     unpublish_mix (6 out) cada data da série com a hora no futuro que
--     esteja por abrir, aberta ou cheia: tira inscritos, suplentes e
--     pedidos, com o aviso 'mix_unpublished' («retirado pela organização»),
--     sem anúncio no WhatsApp. dates = quantas datas; people = quantos
--     avisos saíram.
--   · resume_recurrence(p_recurrence_id) → jsonb {dates}: tira o is_paused
--     e as datas futuras da série em rascunho voltam a 'pending' com a hora
--     de abrir de sempre (data − mix_offset_seconds, como o
--     recurrence_insert_pending). Logo a seguir corre o
--     process_due_game_recurrences: a que já devia estar aberta abre já,
--     pelas regras de sempre (uma de cada vez), e as outras abrem à sua
--     hora. Sem datas a dobrar: a próxima data é única por série e dia.
--     dates = quantas voltaram.
--
-- Precisa do unpublish_mix de 6 out (migration_mix_rascunho_tira_inscritos,
-- já em produção). Dev 3, 7 out 2026 · ecrã: Dev 2
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$ BEGIN
  IF pg_get_functiondef('public.unpublish_mix(uuid)'::regprocedure) NOT LIKE '%mix_unpublished%' THEN
    RAISE EXCEPTION 'Correr primeiro a migration_mix_rascunho_tira_inscritos.sql.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.pause_recurrence_to_draft(p_recurrence_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  gr      game_recurrences%ROWTYPE;
  g       RECORD;
  v_ids   UUID[] := '{}';
  v_people INTEGER;
BEGIN
  SELECT * INTO gr FROM game_recurrences WHERE id = p_recurrence_id FOR UPDATE;
  IF gr.id IS NULL OR auth.uid() IS NULL OR NOT is_org_admin(gr.organization_id) THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;

  UPDATE game_recurrences SET is_paused = TRUE, updated_at = NOW() WHERE id = gr.id;

  FOR g IN
    SELECT id FROM games
     WHERE recurrence_id = gr.id AND date > NOW() AND status IN ('pending', 'open', 'closed')
     ORDER BY date
  LOOP
    PERFORM unpublish_mix(g.id);
    v_ids := v_ids || g.id;
  END LOOP;

  SELECT count(*) INTO v_people FROM notifications
   WHERE kind = 'mix_unpublished' AND game_id = ANY (v_ids) AND created_at = NOW();

  RETURN jsonb_build_object('dates', COALESCE(array_length(v_ids, 1), 0), 'people', v_people);
END;
$function$;
REVOKE ALL ON FUNCTION public.pause_recurrence_to_draft(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pause_recurrence_to_draft(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.pause_recurrence_to_draft(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.resume_recurrence(p_recurrence_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  gr  game_recurrences%ROWTYPE;
  v_n INTEGER;
BEGIN
  SELECT * INTO gr FROM game_recurrences WHERE id = p_recurrence_id FOR UPDATE;
  IF gr.id IS NULL OR auth.uid() IS NULL OR NOT is_org_admin(gr.organization_id) THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;

  UPDATE game_recurrences SET is_paused = FALSE, updated_at = NOW() WHERE id = gr.id;

  UPDATE games
     SET status = 'pending',
         launch_at = date - make_interval(secs => gr.mix_offset_seconds),
         updated_at = NOW()
   WHERE recurrence_id = gr.id AND status = 'draft' AND date > NOW();
  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- A data que já devia estar aberta abre já, pelas regras de sempre.
  PERFORM process_due_game_recurrences();

  RETURN jsonb_build_object('dates', v_n);
END;
$function$;
REVOKE ALL ON FUNCTION public.resume_recurrence(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resume_recurrence(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.resume_recurrence(UUID) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT has_function_privilege('anon', 'public.pause_recurrence_to_draft(uuid)', 'EXECUTE');  -- false
--   SELECT has_function_privilege('anon', 'public.resume_recurrence(uuid)', 'EXECUTE');          -- false
