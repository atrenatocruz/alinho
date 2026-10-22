-- ═════════════════════════════════════════════════════════════════════════
-- Planos pagos (2): o IBAN e o MB Way só a quem tem de pagar
--
-- PORQUÊ. SI e BA, 21 out: a get_group_plan_status dava o IBAN e o MB Way (o
-- telemóvel de quem recebe) a qualquer admin de grupo. Regra da BA
-- (design-handoff/2026-10-21-pedir-plano-e-robo/REGRAS-BA.md):
--   · nome da empresa, NIF e morada: sempre (estão nos Termos);
--   · IBAN e MB Way: só com um pedido aberto, ou com a renovação a vencer
--     (30 dias antes no anual, 7 no mensal, até ao «pago até»);
--   · superadmins: tudo.
--
-- O QUE FAZ. get_group_plan_status com a mesma assinatura e o mesmo json; só
-- o billing_info deixa de trazer iban e mbway fora desses casos.
--
-- ORDEM. Depois de migration_planos_pagos_1.sql.
--
-- Dev 3, 21 out 2026 · ecrãs: Dev 1
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.get_group_plan_status(p_organization_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_org  organizations%ROWTYPE;
  v_main UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'no_session'; END IF;
  SELECT * INTO v_org FROM organizations WHERE id = p_organization_id;
  IF v_org.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  v_main := COALESCE(v_org.parent_organization_id, v_org.id);
  IF NOT (is_org_admin(p_organization_id) OR is_org_admin(v_main) OR COALESCE(is_platform_admin_me(), FALSE)) THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  RETURN jsonb_build_object(
    'organization_id', v_main,
    'plan_tier', (SELECT plan_tier FROM organizations WHERE id = v_main),
    'billing', (SELECT jsonb_build_object('paid_tier', b.paid_tier, 'period', b.period, 'paid_from', b.paid_from,
                                          'paid_until', b.paid_until, 'downgrade_tier', b.downgrade_tier)
                  FROM organization_billing b WHERE b.organization_id = v_main),
    'open_request', (SELECT jsonb_build_object('request_id', r.id, 'tier', r.requested_tier, 'period', r.period, 'kind', r.kind,
                                               'amount', r.amount, 'reference', r.reference, 'created_at', r.created_at,
                                               'paid_claimed_at', r.paid_claimed_at, 'invoice_name', r.invoice_name,
                                               'invoice_nif', r.invoice_nif)
                       FROM plan_requests r WHERE r.organization_id = v_main AND r.status = 'open'),
    'last_invoice', (SELECT jsonb_build_object('invoice_name', r.invoice_name, 'invoice_nif', r.invoice_nif)
                       FROM plan_requests r WHERE r.organization_id = v_main AND r.invoice_name IS NOT NULL
                      ORDER BY r.created_at DESC LIMIT 1),
    'trial', (SELECT jsonb_build_object('trial_id', t.id, 'tier', t.tier, 'ends_on', t.ends_on, 'previous_tier', t.previous_tier)
                FROM plan_trials t WHERE t.organization_id = v_main AND t.status = 'active'),
    'trials_used', COALESCE((SELECT jsonb_agg(t.tier) FROM plan_trials t
                              WHERE t.owner_id = (SELECT owner_id FROM organizations WHERE id = v_main)), '[]'::jsonb),
    'trial_days', CASE WHEN plan_today() <= DATE '2026-12-31' THEN 90 ELSE 30 END,
    'prices', (SELECT jsonb_object_agg(tier, jsonb_build_object('monthly', monthly, 'yearly', yearly)) FROM plan_prices),
    -- Nome, NIF e morada sempre (estão nos Termos); IBAN e MB Way só a quem
    -- tem de pagar: pedido aberto, renovação a vencer, ou superadmin (BA, 21 out).
    'billing_info', (SELECT jsonb_object_agg(key, value) FROM billing_settings
                      WHERE key IN ('company_name', 'company_nif', 'company_address')
                         OR COALESCE(is_platform_admin_me(), FALSE)
                         OR EXISTS (SELECT 1 FROM plan_requests r WHERE r.organization_id = v_main AND r.status = 'open' AND r.amount > 0)
                         OR EXISTS (SELECT 1 FROM organization_billing b WHERE b.organization_id = v_main
                                      AND b.downgrade_tier IS NULL AND b.paid_until >= plan_today()
                                      AND b.paid_until - plan_today() <= CASE b.period WHEN 'yearly' THEN 30 ELSE 7 END)),
    'billing_info_provisional', (SELECT bool_or(provisional) FROM billing_settings));
END;
$function$;

REVOKE ALL ON FUNCTION public.get_group_plan_status(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_group_plan_status(UUID) TO authenticated;

COMMIT;

-- Verificar depois de correr (false): um admin sem pedido nem renovação não recebe o iban:
--   (ver no alinho-dev com uma conta de teste) get_group_plan_status(<grupo>)->'billing_info' ? 'iban'
