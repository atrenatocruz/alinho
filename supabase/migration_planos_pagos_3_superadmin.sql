-- ═════════════════════════════════════════════════════════════════════════
-- Planos pagos (3): o que os superadmins precisam em «Planos pedidos»
--
-- PORQUÊ. #723, envio 2 do Dev 1 (design-handoff/2026-10-21-pedir-plano-e-
-- robo/SPEC-UX.md, itens 4 a 8; regras: REGRAS-BA.md, «Renovar» e «nenhum
-- plano desce sozinho»). Plano aprovado pelo Francisco a 21 out.
--
-- O QUE FAZ
--   · admin_renew_plan(p_organization_id, p_paid_until DEFAULT NULL) →
--     {ok, paid_until}: «Renovou: mais um mês». Mais um período (mês ou ano)
--     a seguir ao «pago até» de agora (20 nov → 20 dez), ou o dia que o
--     superadmin escolher. Limpa os avisos de renovação e avisa os admins
--     ('plan_renewed').
--   · admin_end_paid_plan(p_organization_id) → {ok}: «Passar ao Free» para
--     quem não renovou. O grupo (e os subgrupos) passa ao Free e o período
--     pago fecha (sai de «Por renovar»; a tarefa automática não o repõe).
--     Ninguém sai e nada se apaga. Avisa os admins ('plan_ended'). Com uma
--     experiência a decorrer dá 'trial_active' (termina-se primeiro).
--   · admin_list_plan_renewals: mais amount (o preço do período), reference
--     (a do último pedido aceite) e noticed_on (o dia do último aviso de
--     renovação; NULL nos avisos de antes desta migração).
--   · admin_list_plan_trials: mais previous_tier e paid_until (o pago que vem
--     a seguir à experiência; NULL se não pagou).
--   · process_plan_billing passa a guardar o dia do aviso (renewal_noticed_on).
--
-- COMPATIBILIDADE. As duas listas mudam de colunas (DROP + CREATE, com o
-- REVOKE de anon); ainda não estão em produção (planos_pagos_1 por correr).
-- ORDEM. Depois de migration_planos_pagos_1.sql e _2.
--
-- Dev 3, 22 out 2026 · ecrãs: Dev 1
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.organization_billing ADD COLUMN IF NOT EXISTS renewal_noticed_on DATE;

CREATE OR REPLACE FUNCTION public.process_plan_billing()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_today DATE := plan_today();
  r       RECORD;
  n_exp   INTEGER := 0; n_trial INTEGER := 0; n_down INTEGER := 0; n_note INTEGER := 0;
  v_days  INTEGER;
  v_paid  TEXT;
BEGIN
  -- a) Pedidos abertos há mais de 7 dias.
  FOR r IN
    UPDATE plan_requests SET status = 'expired', decided_at = NOW()
     WHERE status = 'open' AND created_at < NOW() - interval '7 days'
    RETURNING id, organization_id, requested_tier
  LOOP
    PERFORM plan_notify_admins(r.organization_id, 'plan_request_expired',
      jsonb_build_object('request_id', r.id, 'tier', r.requested_tier, 'tier_name', plan_label(r.requested_tier)));
    n_exp := n_exp + 1;
  END LOOP;

  -- b) Experiências: avisos a 7, 1 e 0 dias; no fim, volta ao plano de antes (ou passa ao pago).
  FOR r IN SELECT * FROM plan_trials WHERE status = 'active' LOOP
    v_days := r.ends_on - v_today;
    IF v_days < 0 THEN
      v_paid := (SELECT b.paid_tier FROM organization_billing b
                  WHERE b.organization_id = r.organization_id AND b.paid_from <= v_today AND b.paid_until >= v_today);
      IF v_paid IS NOT NULL THEN
        UPDATE plan_trials SET status = 'converted' WHERE id = r.id;
        PERFORM set_org_plan_internal(r.organization_id, v_paid);
      ELSE
        UPDATE plan_trials SET status = 'ended' WHERE id = r.id;
        PERFORM set_org_plan_internal(r.organization_id, r.previous_tier);
        PERFORM plan_notify_admins(r.organization_id, 'plan_trial_ended',
          jsonb_build_object('trial_id', r.id, 'tier', r.tier, 'tier_name', plan_label(r.tier),
                             'back_to', r.previous_tier, 'back_to_name', plan_label(r.previous_tier)));
      END IF;
      n_trial := n_trial + 1;
    ELSIF (v_days <= 7 AND NOT r.noticed_7) OR (v_days <= 1 AND NOT r.noticed_1) OR (v_days = 0 AND NOT r.noticed_0) THEN
      UPDATE plan_trials SET noticed_7 = noticed_7 OR v_days <= 7, noticed_1 = noticed_1 OR v_days <= 1,
                             noticed_0 = noticed_0 OR v_days = 0
       WHERE id = r.id;
      PERFORM plan_notify_admins(r.organization_id, 'plan_trial_ending',
        jsonb_build_object('trial_id', r.id, 'tier', r.tier, 'tier_name', plan_label(r.tier),
                           'ends_on', r.ends_on, 'days_left', v_days));
      n_note := n_note + 1;
    END IF;
  END LOOP;

  -- c) Descidas marcadas e períodos pagos que começam hoje.
  FOR r IN SELECT * FROM organization_billing WHERE downgrade_tier IS NOT NULL AND paid_until < v_today LOOP
    PERFORM set_org_plan_internal(r.organization_id, r.downgrade_tier);
    DELETE FROM organization_billing WHERE organization_id = r.organization_id;
    n_down := n_down + 1;
  END LOOP;
  FOR r IN SELECT b.* FROM organization_billing b JOIN organizations o ON o.id = b.organization_id
            WHERE b.paid_from <= v_today AND b.paid_until >= v_today AND o.plan_tier IS DISTINCT FROM b.paid_tier
              AND NOT EXISTS (SELECT 1 FROM plan_trials t WHERE t.organization_id = b.organization_id AND t.status = 'active')
  LOOP
    PERFORM set_org_plan_internal(r.organization_id, r.paid_tier);
  END LOOP;

  -- d) Renovação: anual 30 e 7 dias antes; mensal 7. Nenhum plano desce sozinho.
  FOR r IN SELECT * FROM organization_billing
            WHERE downgrade_tier IS NULL AND paid_until >= v_today
              AND NOT EXISTS (SELECT 1 FROM plan_requests q WHERE q.organization_id = organization_billing.organization_id
                                AND q.status = 'accepted' AND q.starts_on > organization_billing.paid_until)
  LOOP
    v_days := r.paid_until - v_today;
    IF r.period = 'yearly' AND v_days <= 30 AND v_days > 7 AND r.renewal_noticed_30 IS DISTINCT FROM r.paid_until THEN
      UPDATE organization_billing SET renewal_noticed_30 = r.paid_until, renewal_noticed_on = v_today WHERE organization_id = r.organization_id;
    ELSIF v_days <= 7 AND r.renewal_noticed_7 IS DISTINCT FROM r.paid_until THEN
      UPDATE organization_billing SET renewal_noticed_7 = r.paid_until, renewal_noticed_30 = r.paid_until, renewal_noticed_on = v_today WHERE organization_id = r.organization_id;
    ELSE
      CONTINUE;
    END IF;
    PERFORM plan_notify_admins(r.organization_id, 'plan_renewal_due',
      jsonb_build_object('tier', r.paid_tier, 'tier_name', plan_label(r.paid_tier), 'period', r.period,
                         'paid_until', r.paid_until, 'days_left', v_days,
                         'amount', (SELECT CASE r.period WHEN 'yearly' THEN yearly ELSE monthly END FROM plan_prices WHERE tier = r.paid_tier)));
    n_note := n_note + 1;
  END LOOP;

  RETURN jsonb_build_object('expired', n_exp, 'trials_done', n_trial, 'downgrades', n_down, 'notices', n_note);
END;
$function$;
REVOKE ALL ON FUNCTION public.process_plan_billing() FROM PUBLIC, anon, authenticated;

-- ── Renovar (superadmin) ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_renew_plan(p_organization_id UUID, p_paid_until DATE DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  b       organization_billing%ROWTYPE;
  v_until DATE;
BEGIN
  IF NOT COALESCE(is_platform_admin_me(), FALSE) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  SELECT * INTO b FROM organization_billing WHERE organization_id = p_organization_id FOR UPDATE;
  IF b.organization_id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  -- Último dia incluído: o período seguinte começa no dia a seguir.
  v_until := COALESCE(p_paid_until,
                      ((b.paid_until + 1) + CASE b.period WHEN 'yearly' THEN interval '1 year' ELSE interval '1 month' END)::date - 1);
  IF v_until <= b.paid_until THEN RAISE EXCEPTION 'bad_paid_until'; END IF;
  UPDATE organization_billing
     SET paid_until = v_until, downgrade_tier = NULL,
         renewal_noticed_30 = NULL, renewal_noticed_7 = NULL, renewal_noticed_on = NULL, updated_at = NOW()
   WHERE organization_id = p_organization_id;
  -- Se o plano tinha ficado diferente, volta ao pago (fora de uma experiência).
  IF b.paid_from <= plan_today() AND NOT EXISTS (SELECT 1 FROM plan_trials WHERE organization_id = p_organization_id AND status = 'active') THEN
    PERFORM set_org_plan_internal(p_organization_id, b.paid_tier);
  END IF;
  PERFORM plan_notify_admins(p_organization_id, 'plan_renewed',
    jsonb_build_object('tier', b.paid_tier, 'tier_name', plan_label(b.paid_tier), 'period', b.period, 'paid_until', v_until));
  RETURN jsonb_build_object('ok', TRUE, 'paid_until', v_until);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_renew_plan(UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_renew_plan(UUID, DATE) TO authenticated;

-- ── Passar ao Free (superadmin) ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_end_paid_plan(p_organization_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  b organization_billing%ROWTYPE;
BEGIN
  IF NOT COALESCE(is_platform_admin_me(), FALSE) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = p_organization_id) THEN RAISE EXCEPTION 'not_found'; END IF;
  IF EXISTS (SELECT 1 FROM plan_trials WHERE organization_id = p_organization_id AND status = 'active') THEN
    RAISE EXCEPTION 'trial_active';
  END IF;
  SELECT * INTO b FROM organization_billing WHERE organization_id = p_organization_id FOR UPDATE;
  DELETE FROM organization_billing WHERE organization_id = p_organization_id;
  -- Ninguém sai e nada se apaga: só os limites do Free valem para o que vier.
  PERFORM set_org_plan_internal(p_organization_id, 'free');
  PERFORM plan_notify_admins(p_organization_id, 'plan_ended',
    jsonb_build_object('from_tier', b.paid_tier, 'from_tier_name', plan_label(b.paid_tier)));
  RETURN jsonb_build_object('ok', TRUE);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_end_paid_plan(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_end_paid_plan(UUID) TO authenticated;

-- ── As duas listas com mais colunas ─────────────────────────────────────
DROP FUNCTION IF EXISTS public.admin_list_plan_renewals();
CREATE FUNCTION public.admin_list_plan_renewals()
RETURNS TABLE(organization_id UUID, group_name TEXT, paid_tier TEXT, period TEXT, paid_until DATE, days_left INTEGER,
              open_request BOOLEAN, amount NUMERIC, reference TEXT, noticed_on DATE)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  IF NOT COALESCE(is_platform_admin_me(), FALSE) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  RETURN QUERY
    SELECT b.organization_id, o.name, b.paid_tier, b.period, b.paid_until, (b.paid_until - plan_today())::int,
           EXISTS (SELECT 1 FROM plan_requests r WHERE r.organization_id = b.organization_id AND r.status = 'open'),
           (SELECT CASE b.period WHEN 'yearly' THEN pp.yearly ELSE pp.monthly END FROM plan_prices pp WHERE pp.tier = b.paid_tier),
           (SELECT r.reference FROM plan_requests r WHERE r.id = b.last_request_id),
           b.renewal_noticed_on
      FROM organization_billing b JOIN organizations o ON o.id = b.organization_id
     WHERE b.downgrade_tier IS NULL
       AND b.paid_until - plan_today() <= CASE b.period WHEN 'yearly' THEN 30 ELSE 7 END
     ORDER BY b.paid_until;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_list_plan_renewals() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_plan_renewals() TO authenticated;

DROP FUNCTION IF EXISTS public.admin_list_plan_trials();
CREATE FUNCTION public.admin_list_plan_trials()
RETURNS TABLE(organization_id UUID, group_name TEXT, tier TEXT, owner_id UUID, owner_name TEXT, starts_on DATE, ends_on DATE,
              previous_tier TEXT, paid_until DATE)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  IF NOT COALESCE(is_platform_admin_me(), FALSE) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  RETURN QUERY
    SELECT t.organization_id, o.name, t.tier, t.owner_id, p.name, t.starts_on, t.ends_on, t.previous_tier,
           (SELECT b.paid_until FROM organization_billing b
             WHERE b.organization_id = t.organization_id AND b.paid_from > t.ends_on)
      FROM plan_trials t JOIN organizations o ON o.id = t.organization_id LEFT JOIN profiles p ON p.id = t.owner_id
     WHERE t.status = 'active'
     ORDER BY t.ends_on;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_list_plan_trials() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_plan_trials() TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT has_function_privilege('anon', 'public.admin_list_plan_renewals()', 'EXECUTE');   -- false
--   SELECT has_function_privilege('anon', 'public.admin_renew_plan(uuid,date)', 'EXECUTE');  -- false
