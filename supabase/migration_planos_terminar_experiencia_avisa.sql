-- ═════════════════════════════════════════════════════════════════════════
-- Planos: «Terminar» uma experiência grátis passa a avisar os admins do grupo
--
-- PORQUÊ. QA de 2 nov aos «Planos pedidos» (design-handoff/2026-10-21-pedir-
-- plano-e-robo/qa-2nov/NOTA-QA-planos-pedidos-dev.md, nota 2): quando a
-- superadmin termina uma experiência, o dono não recebe aviso nenhum, ao
-- contrário de recusar, aceitar, renovar e passar ao Free. Decisão do PO, 2 nov:
-- passa a avisar, com o mesmo aviso de quando a experiência acaba sozinha.
--
-- O QUE FAZ. stop_plan_trial (o corpo de produção, md5 9a3a4a3d…; no alinho-dev
-- só falta o comentário, md5 ba84682b…) passa a mandar 'plan_trial_ended', com
-- os mesmos dados da tarefa automática (process_plan_billing): «O Community
-- grátis acabou. Maré Alta Padel voltou ao Squad. Ninguém saiu e nada foi
-- apagado.» Sem texto novo.
--   · Vai para os admins do grupo, menos quem carregou em «Terminar» (quem o
--     fez já sabe). Quando é a superadmin, vão todos.
--   · Como na tarefa automática: se entretanto pagou um plano (fica o pago), não
--     avisa.
-- Mesma assinatura (CREATE OR REPLACE): as permissões ficam; repõe-se o REVOKE
-- na mesma.
--
-- ORDEM. Depois de migration_planos_pagos_1.sql (já corrida em produção).
--
-- Dev 3, 2 nov 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- Só troca se o corpo de hoje for o esperado, ou se já estiver trocado.
DO $$
DECLARE v_md5 TEXT := (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc
                        WHERE oid = to_regprocedure('public.stop_plan_trial(uuid)'));
BEGIN
  IF v_md5 IS NULL THEN
    RAISE EXCEPTION 'stop_plan_trial não existe. Falta a migration_planos_pagos_1.sql. Parar.';
  ELSIF v_md5 NOT IN ('9a3a4a3d589cdd12ea9904642bf0d36a', 'ba84682b3482f7e086833da185ba457f')
        AND position('plan_trial_ended' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.stop_plan_trial(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'stop_plan_trial: o corpo não é o esperado (md5 %). Parar.', v_md5;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.stop_plan_trial(p_organization_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_t    plan_trials%ROWTYPE;
  v_paid TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'no_session'; END IF;
  IF NOT (is_org_admin(p_organization_id) OR COALESCE(is_platform_admin_me(), FALSE)) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  SELECT * INTO v_t FROM plan_trials WHERE organization_id = p_organization_id AND status = 'active' FOR UPDATE;
  IF v_t.id IS NULL THEN RAISE EXCEPTION 'no_trial'; END IF;
  UPDATE plan_trials SET status = 'stopped' WHERE id = v_t.id;
  -- Se entretanto pagou um plano, fica o pago.
  v_paid := plan_current_paid_tier(p_organization_id);
  PERFORM set_org_plan_internal(p_organization_id, COALESCE(v_paid, v_t.previous_tier));
  -- O mesmo aviso de quando acaba sozinha (process_plan_billing), aos admins
  -- menos a quem terminou.
  IF v_paid IS NULL THEN
    INSERT INTO notifications (user_id, kind, data)
    SELECT m.user_id, 'plan_trial_ended',
           jsonb_build_object('trial_id', v_t.id, 'tier', v_t.tier, 'tier_name', plan_label(v_t.tier),
                              'back_to', v_t.previous_tier, 'back_to_name', plan_label(v_t.previous_tier),
                              'organization_id', o.id, 'group_name', o.name)
      FROM memberships m JOIN organizations o ON o.id = m.organization_id
     WHERE m.organization_id = p_organization_id AND m.is_admin AND m.user_id <> auth.uid();
  END IF;
  RETURN jsonb_build_object('ok', TRUE);
END;
$function$;

REVOKE ALL ON FUNCTION public.stop_plan_trial(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stop_plan_trial(UUID) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT has_function_privilege('anon', 'public.stop_plan_trial(uuid)', 'EXECUTE'),
--          has_function_privilege('authenticated', 'public.stop_plan_trial(uuid)', 'EXECUTE'),
--          position('plan_trial_ended' IN prosrc) > 0
--     FROM pg_proc WHERE oid = 'public.stop_plan_trial(uuid)'::regprocedure;
--   → false, true, true
