-- ═════════════════════════════════════════════════════════════════════════
-- Planos pagos (#723): pedidos, período pago, anual e experiência grátis
--
-- PORQUÊ. Aprovado pelo Francisco a 21 out (regras: design-handoff/
-- 2026-10-21-pedir-plano-e-robo/REGRAS-BA.md; textos: SPEC-UX.md). Plano dos
-- dados: okay do Francisco a 21 out. Ecrãs: Dev 1. O robô espera pelo Renato.
--
-- NOMES. Na base: free, plus (Squad), pro (Community), club (Club).
-- DATAS. Hora de Lisboa. «pago até» e «grátis até» são o último dia incluído.
--
-- O QUE FAZ
--   · plan_prices: o preço por mês e por ano (12 pelo preço de 10).
--   · billing_settings: os dados de quem fatura (PROVISÓRIOS até o Ruben os
--     dar: provisional = true).
--   · plan_requests: os pedidos (um aberto por grupo), com referência
--     ALN-XXXX, mensal/anual, dados da fatura, «Já paguei», e o estado
--     (open, accepted, declined, cancelled, expired). Caducam ao fim de 7 dias.
--   · organization_billing: o período pago de cada grupo principal (plano,
--     pago até, mensal/anual) e a descida marcada para o fim do período.
--   · plan_trials: as experiências grátis (uma por dono e por plano).
--   · Funções para os admins do grupo, para os superadmins, e a tarefa
--     automática (de hora a hora, idempotente) que caduca pedidos, acaba
--     experiências, faz as descidas marcadas e manda os avisos.
--   · O plano muda sempre pelo mesmo sítio: set_org_plan_internal (o mesmo
--     que o admin_set_organization_plan faz, sem a verificação de quem chama,
--     para a tarefa automática). O admin_set_organization_plan fica igual.
--
-- AVISOS (notifications, a todos os admins do grupo; aos superadmins os
-- pedidos novos e o «Já paguei»). data leva o que o ecrã precisa.
--   plan_request_new, plan_request_paid (superadmins);
--   plan_request_accepted, plan_request_declined, plan_request_expired,
--   plan_trial_started, plan_trial_ending (7, 1 e 0 dias), plan_trial_ended,
--   plan_renewal_due (anual 30 e 7 dias; mensal 7 dias) (admins).
--   Na app antiga não aparecem no sino (kinds desconhecidos).
--
-- COMPATIBILIDADE. Só acrescenta. REVOKE a anon em tudo.
--
-- Dev 3, 21 out 2026 · ecrãs: Dev 1 · regras: BA
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Tabelas ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.plan_prices (
  tier    TEXT PRIMARY KEY CHECK (tier IN ('plus', 'pro', 'club')),
  monthly NUMERIC(8,2) NOT NULL,
  yearly  NUMERIC(8,2) NOT NULL
);
INSERT INTO public.plan_prices (tier, monthly, yearly) VALUES
  ('plus', 4.99, 49.90), ('pro', 14.99, 149.90), ('club', 29.99, 299.90)
ON CONFLICT (tier) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.billing_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  provisional BOOLEAN NOT NULL DEFAULT TRUE
);
INSERT INTO public.billing_settings (key, value) VALUES
  ('company_name', '[NOME DA EMPRESA]'), ('company_nif', '[NIF]'), ('company_address', '[MORADA]'),
  ('iban', '[IBAN]'), ('mbway', '[NÚMERO MB WAY]')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.plan_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  from_tier       TEXT NOT NULL,
  requested_tier  TEXT NOT NULL CHECK (requested_tier IN ('free', 'plus', 'pro', 'club')),
  period          TEXT NOT NULL DEFAULT 'monthly' CHECK (period IN ('monthly', 'yearly')),
  kind            TEXT NOT NULL CHECK (kind IN ('new', 'renewal', 'upgrade', 'downgrade')),
  amount          NUMERIC(8,2) NOT NULL DEFAULT 0,
  reference       TEXT NOT NULL UNIQUE,
  invoice_name    TEXT,
  invoice_nif     TEXT,
  requested_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_claimed_at TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'declined', 'cancelled', 'expired')),
  decline_reason  TEXT CHECK (decline_reason IN ('nao_recebido', 'valor_errado', 'outro')),
  decline_note    TEXT,
  decided_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  decided_at      TIMESTAMPTZ,
  starts_on       DATE,
  paid_until      DATE
);
CREATE UNIQUE INDEX IF NOT EXISTS plan_requests_one_open ON public.plan_requests (organization_id) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS public.organization_billing (
  organization_id     UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  paid_tier           TEXT NOT NULL CHECK (paid_tier IN ('plus', 'pro', 'club')),
  period              TEXT NOT NULL CHECK (period IN ('monthly', 'yearly')),
  paid_from           DATE NOT NULL,
  paid_until          DATE NOT NULL,
  last_request_id     UUID REFERENCES public.plan_requests(id) ON DELETE SET NULL,
  downgrade_tier      TEXT CHECK (downgrade_tier IN ('free', 'plus', 'pro', 'club')),
  renewal_noticed_30  DATE,   -- o paid_until para que já saiu o aviso de 30 dias
  renewal_noticed_7   DATE,   -- idem, 7 dias
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.plan_trials (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  owner_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tier            TEXT NOT NULL CHECK (tier IN ('plus', 'pro', 'club')),
  previous_tier   TEXT NOT NULL,
  starts_on       DATE NOT NULL,
  ends_on         DATE NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended', 'stopped', 'converted')),
  noticed_7       BOOLEAN NOT NULL DEFAULT FALSE,
  noticed_1       BOOLEAN NOT NULL DEFAULT FALSE,
  noticed_0       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_id, tier)
);
CREATE UNIQUE INDEX IF NOT EXISTS plan_trials_one_active ON public.plan_trials (organization_id) WHERE status = 'active';

ALTER TABLE public.plan_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_billing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_trials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.plan_prices, public.billing_settings, public.plan_requests,
              public.organization_billing, public.plan_trials FROM PUBLIC, anon, authenticated;

-- ── 2. Ajudas (internas) ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.plan_today()
RETURNS DATE LANGUAGE sql STABLE SET search_path = public
AS $function$ SELECT (NOW() AT TIME ZONE 'Europe/Lisbon')::date; $function$;

CREATE OR REPLACE FUNCTION public.plan_rank(p_tier TEXT)
RETURNS INTEGER LANGUAGE sql IMMUTABLE SET search_path = public
AS $function$ SELECT CASE p_tier WHEN 'free' THEN 0 WHEN 'plus' THEN 1 WHEN 'pro' THEN 2 WHEN 'club' THEN 3 END; $function$;

CREATE OR REPLACE FUNCTION public.plan_label(p_tier TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = public
AS $function$ SELECT CASE p_tier WHEN 'free' THEN 'Free' WHEN 'plus' THEN 'Squad' WHEN 'pro' THEN 'Community' WHEN 'club' THEN 'Club' END; $function$;

-- O mesmo UPDATE do admin_set_organization_plan (o grupo e os subgrupos), sem
-- verificar quem chama: só para as funções abaixo e a tarefa automática.
CREATE OR REPLACE FUNCTION public.set_org_plan_internal(p_organization_id UUID, p_tier TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  IF p_tier NOT IN ('free', 'plus', 'pro', 'club') THEN RAISE EXCEPTION 'bad_tier'; END IF;
  UPDATE organizations SET plan_tier = p_tier, plan_updated_at = NOW()
   WHERE id = p_organization_id OR parent_organization_id = p_organization_id;
END;
$function$;

-- Avisar os admins do grupo.
CREATE OR REPLACE FUNCTION public.plan_notify_admins(p_organization_id UUID, p_kind TEXT, p_data JSONB)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $function$
  INSERT INTO notifications (user_id, kind, data)
  SELECT m.user_id, p_kind,
         p_data || jsonb_build_object('organization_id', o.id, 'group_name', o.name)
    FROM memberships m JOIN organizations o ON o.id = m.organization_id
   WHERE m.organization_id = p_organization_id AND m.is_admin;
$function$;

-- Avisar os superadmins.
CREATE OR REPLACE FUNCTION public.plan_notify_superadmins(p_kind TEXT, p_data JSONB)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $function$
  INSERT INTO notifications (user_id, kind, data)
  SELECT pa.user_id, p_kind, p_data FROM platform_admins pa;
$function$;

-- O plano que conta agora para os preços e as subidas: o pago, se ainda
-- estiver a correr; senão o do grupo.
CREATE OR REPLACE FUNCTION public.plan_current_tier(p_organization_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $function$
  SELECT COALESCE((SELECT b.paid_tier FROM organization_billing b
                    WHERE b.organization_id = p_organization_id AND b.paid_until >= plan_today()),
                  (SELECT o.plan_tier FROM organizations o WHERE o.id = p_organization_id));
$function$;

-- Referência curta para o pagamento.
CREATE OR REPLACE FUNCTION public.plan_new_reference()
RETURNS TEXT LANGUAGE plpgsql VOLATILE SET search_path = public
AS $function$
DECLARE
  c CONSTANT TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v TEXT;
BEGIN
  LOOP
    SELECT 'ALN-' || string_agg(substr(c, 1 + floor(random() * length(c))::int, 1), '') INTO v FROM generate_series(1, 4);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM plan_requests WHERE reference = v);
  END LOOP;
  RETURN v;
END;
$function$;

-- Meses começados de p_from até p_until (inclusive).
CREATE OR REPLACE FUNCTION public.plan_months_started(p_from DATE, p_until DATE)
RETURNS INTEGER LANGUAGE plpgsql IMMUTABLE SET search_path = public
AS $function$
DECLARE n INTEGER := 0; d DATE := p_from;
BEGIN
  WHILE d <= p_until LOOP n := n + 1; d := (d + interval '1 month')::date; END LOOP;
  RETURN n;
END;
$function$;

REVOKE ALL ON FUNCTION public.plan_today(), public.plan_rank(TEXT), public.plan_label(TEXT),
  public.set_org_plan_internal(UUID, TEXT), public.plan_notify_admins(UUID, TEXT, JSONB),
  public.plan_notify_superadmins(TEXT, JSONB), public.plan_current_tier(UUID),
  public.plan_new_reference(), public.plan_months_started(DATE, DATE) FROM PUBLIC, anon, authenticated;

-- ── 3. Para os admins do grupo ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.request_plan(p_organization_id UUID, p_tier TEXT, p_period TEXT DEFAULT 'monthly',
                                               p_invoice_name TEXT DEFAULT NULL, p_invoice_nif TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_org    organizations%ROWTYPE;
  v_cur    TEXT;
  v_bill   organization_billing%ROWTYPE;
  v_kind   TEXT;
  v_amount NUMERIC(8,2);
  v_price  plan_prices%ROWTYPE;
  v_oldp   plan_prices%ROWTYPE;
  v_ref    TEXT;
  v_id     UUID;
  v_period TEXT := COALESCE(p_period, 'monthly');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'no_session'; END IF;
  SELECT * INTO v_org FROM organizations WHERE id = p_organization_id;
  IF v_org.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_org.parent_organization_id IS NOT NULL THEN RAISE EXCEPTION 'not_main_group'; END IF;
  IF NOT is_org_admin(p_organization_id) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF p_tier NOT IN ('free', 'plus', 'pro', 'club') THEN RAISE EXCEPTION 'bad_tier'; END IF;
  IF v_period NOT IN ('monthly', 'yearly') THEN RAISE EXCEPTION 'bad_period'; END IF;
  IF EXISTS (SELECT 1 FROM plan_requests WHERE organization_id = p_organization_id AND status = 'open') THEN
    RAISE EXCEPTION 'request_open';
  END IF;

  v_cur := plan_current_tier(p_organization_id);
  SELECT * INTO v_bill FROM organization_billing WHERE organization_id = p_organization_id AND paid_until >= plan_today();
  SELECT * INTO v_price FROM plan_prices WHERE tier = p_tier;

  IF plan_rank(p_tier) < plan_rank(v_cur) THEN
    v_kind := 'downgrade'; v_amount := 0;              -- muda no fim do que está pago
  ELSIF v_bill.organization_id IS NOT NULL AND p_tier = v_bill.paid_tier THEN
    v_kind := 'renewal';                               -- o período seguinte
    v_amount := CASE v_period WHEN 'yearly' THEN v_price.yearly ELSE v_price.monthly END;
  ELSIF v_bill.organization_id IS NOT NULL AND plan_rank(p_tier) > plan_rank(v_bill.paid_tier) THEN
    v_kind := 'upgrade';                               -- a diferença dos meses que faltam
    SELECT * INTO v_oldp FROM plan_prices WHERE tier = v_bill.paid_tier;
    v_amount := (v_price.monthly - v_oldp.monthly) * plan_months_started(plan_today(), v_bill.paid_until);
  ELSIF p_tier = 'free' THEN
    RAISE EXCEPTION 'same_tier';
  ELSE
    v_kind := 'new';
    v_amount := CASE v_period WHEN 'yearly' THEN v_price.yearly ELSE v_price.monthly END;
  END IF;

  v_ref := plan_new_reference();
  INSERT INTO plan_requests (organization_id, from_tier, requested_tier, period, kind, amount, reference,
                             invoice_name, invoice_nif, requested_by)
  VALUES (p_organization_id, v_cur, p_tier, v_period, v_kind, v_amount, v_ref,
          NULLIF(btrim(p_invoice_name), ''), NULLIF(btrim(p_invoice_nif), ''), auth.uid())
  RETURNING id INTO v_id;

  PERFORM plan_notify_superadmins('plan_request_new',
    jsonb_build_object('request_id', v_id, 'organization_id', p_organization_id, 'group_name', v_org.name,
                       'tier', p_tier, 'tier_name', plan_label(p_tier), 'from_tier', v_cur, 'kind', v_kind,
                       'amount', v_amount, 'reference', v_ref));
  RETURN jsonb_build_object('ok', TRUE, 'request_id', v_id, 'reference', v_ref, 'amount', v_amount, 'kind', v_kind, 'period', v_period);
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_plan_request(p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE v_r plan_requests%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'no_session'; END IF;
  SELECT * INTO v_r FROM plan_requests WHERE id = p_request_id FOR UPDATE;
  IF v_r.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT is_org_admin(v_r.organization_id) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF v_r.status <> 'open' THEN RAISE EXCEPTION 'not_open'; END IF;
  UPDATE plan_requests SET status = 'cancelled', decided_by = auth.uid(), decided_at = NOW() WHERE id = v_r.id;
  RETURN jsonb_build_object('ok', TRUE);
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_plan_request_paid(p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE v_r plan_requests%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'no_session'; END IF;
  SELECT * INTO v_r FROM plan_requests WHERE id = p_request_id FOR UPDATE;
  IF v_r.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT is_org_admin(v_r.organization_id) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF v_r.status <> 'open' THEN RAISE EXCEPTION 'not_open'; END IF;
  IF v_r.paid_claimed_at IS NULL THEN
    UPDATE plan_requests SET paid_claimed_at = NOW() WHERE id = v_r.id;
    PERFORM plan_notify_superadmins('plan_request_paid',
      jsonb_build_object('request_id', v_r.id, 'organization_id', v_r.organization_id,
                         'group_name', (SELECT name FROM organizations WHERE id = v_r.organization_id),
                         'tier', v_r.requested_tier, 'tier_name', plan_label(v_r.requested_tier),
                         'amount', v_r.amount, 'reference', v_r.reference));
  END IF;
  RETURN jsonb_build_object('ok', TRUE);
END;
$function$;

CREATE OR REPLACE FUNCTION public.start_plan_trial(p_organization_id UUID, p_tier TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_org   organizations%ROWTYPE;
  v_prev  TEXT;
  v_old   plan_trials%ROWTYPE;
  v_today DATE := plan_today();
  v_days  INTEGER;
  v_end   DATE;
  v_id    UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'no_session'; END IF;
  SELECT * INTO v_org FROM organizations WHERE id = p_organization_id FOR UPDATE;
  IF v_org.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_org.parent_organization_id IS NOT NULL THEN RAISE EXCEPTION 'not_main_group'; END IF;
  IF NOT is_org_admin(p_organization_id) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF p_tier NOT IN ('plus', 'pro', 'club') THEN RAISE EXCEPTION 'bad_tier'; END IF;
  IF v_org.owner_id IS NULL THEN RAISE EXCEPTION 'no_owner'; END IF;
  IF EXISTS (SELECT 1 FROM plan_trials WHERE owner_id = v_org.owner_id AND tier = p_tier) THEN RAISE EXCEPTION 'trial_used'; END IF;

  -- Uma de cada vez: a de agora acaba (conta como usada) e guarda-se o plano de antes dela.
  SELECT * INTO v_old FROM plan_trials WHERE organization_id = p_organization_id AND status = 'active' FOR UPDATE;
  IF v_old.id IS NOT NULL THEN
    UPDATE plan_trials SET status = 'stopped' WHERE id = v_old.id;
    v_prev := v_old.previous_tier;
  ELSE
    v_prev := v_org.plan_tier;
  END IF;
  IF plan_rank(p_tier) <= plan_rank(COALESCE(plan_current_tier(p_organization_id), 'free')) AND v_old.id IS NULL THEN
    RAISE EXCEPTION 'not_an_upgrade';
  END IF;

  v_days := CASE WHEN v_today <= DATE '2026-12-31' THEN 90 ELSE 30 END;
  v_end := v_today + v_days - 1;
  INSERT INTO plan_trials (organization_id, owner_id, tier, previous_tier, starts_on, ends_on)
  VALUES (p_organization_id, v_org.owner_id, p_tier, v_prev, v_today, v_end)
  RETURNING id INTO v_id;
  PERFORM set_org_plan_internal(p_organization_id, p_tier);
  PERFORM plan_notify_admins(p_organization_id, 'plan_trial_started',
    jsonb_build_object('trial_id', v_id, 'tier', p_tier, 'tier_name', plan_label(p_tier), 'ends_on', v_end, 'days', v_days));
  RETURN jsonb_build_object('ok', TRUE, 'trial_id', v_id, 'ends_on', v_end, 'days', v_days);
END;
$function$;

-- Terminar já (admin do grupo ou superadmin). Volta ao plano de antes.
CREATE OR REPLACE FUNCTION public.stop_plan_trial(p_organization_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE v_t plan_trials%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'no_session'; END IF;
  IF NOT (is_org_admin(p_organization_id) OR COALESCE(is_platform_admin_me(), FALSE)) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  SELECT * INTO v_t FROM plan_trials WHERE organization_id = p_organization_id AND status = 'active' FOR UPDATE;
  IF v_t.id IS NULL THEN RAISE EXCEPTION 'no_trial'; END IF;
  UPDATE plan_trials SET status = 'stopped' WHERE id = v_t.id;
  -- Se entretanto pagou um plano, fica o pago.
  PERFORM set_org_plan_internal(p_organization_id, COALESCE(plan_current_paid_tier(p_organization_id), v_t.previous_tier));
  RETURN jsonb_build_object('ok', TRUE);
END;
$function$;

-- O plano pago a correr hoje (ou NULL).
CREATE OR REPLACE FUNCTION public.plan_current_paid_tier(p_organization_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $function$
  SELECT b.paid_tier FROM organization_billing b
   WHERE b.organization_id = p_organization_id AND b.paid_from <= plan_today() AND b.paid_until >= plan_today();
$function$;
REVOKE ALL ON FUNCTION public.plan_current_paid_tier(UUID) FROM PUBLIC, anon, authenticated;

-- O que a página Planos precisa, para os admins do grupo (e superadmins).
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
    'billing_info', (SELECT jsonb_object_agg(key, value) FROM billing_settings),
    'billing_info_provisional', (SELECT bool_or(provisional) FROM billing_settings));
END;
$function$;

GRANT EXECUTE ON FUNCTION public.request_plan(UUID, TEXT, TEXT, TEXT, TEXT), public.cancel_plan_request(UUID),
  public.mark_plan_request_paid(UUID), public.start_plan_trial(UUID, TEXT), public.stop_plan_trial(UUID),
  public.get_group_plan_status(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.request_plan(UUID, TEXT, TEXT, TEXT, TEXT), public.cancel_plan_request(UUID),
  public.mark_plan_request_paid(UUID), public.start_plan_trial(UUID, TEXT), public.stop_plan_trial(UUID),
  public.get_group_plan_status(UUID) FROM PUBLIC, anon;

-- ── 4. Para os superadmins ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_list_plan_requests()
RETURNS TABLE(request_id UUID, organization_id UUID, group_name TEXT, from_tier TEXT, requested_tier TEXT, period TEXT,
              kind TEXT, amount NUMERIC, reference TEXT, requested_by_name TEXT, created_at TIMESTAMPTZ,
              paid_claimed_at TIMESTAMPTZ, invoice_name TEXT, invoice_nif TEXT, suggested_starts_on DATE, suggested_paid_until DATE)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  IF NOT COALESCE(is_platform_admin_me(), FALSE) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  RETURN QUERY
    SELECT r.id, r.organization_id, o.name, r.from_tier, r.requested_tier, r.period, r.kind, r.amount, r.reference,
           p.name, r.created_at, r.paid_claimed_at, r.invoice_name, r.invoice_nif, s.starts_on, s.paid_until
      FROM plan_requests r
      JOIN organizations o ON o.id = r.organization_id
      LEFT JOIN profiles p ON p.id = r.requested_by
      CROSS JOIN LATERAL plan_suggested_dates(r.id) s
     WHERE r.status = 'open'
     ORDER BY (r.paid_claimed_at IS NULL), r.created_at;
END;
$function$;

-- As datas que o «Aceitar» propõe (o superadmin pode mudar o «pago até»).
CREATE OR REPLACE FUNCTION public.plan_suggested_dates(p_request_id UUID)
RETURNS TABLE(starts_on DATE, paid_until DATE)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_r     plan_requests%ROWTYPE;
  v_bill  organization_billing%ROWTYPE;
  v_trial plan_trials%ROWTYPE;
  v_start DATE := plan_today();
BEGIN
  SELECT * INTO v_r FROM plan_requests WHERE id = p_request_id;
  SELECT * INTO v_bill FROM organization_billing WHERE organization_id = v_r.organization_id;
  SELECT * INTO v_trial FROM plan_trials WHERE organization_id = v_r.organization_id AND status = 'active';
  IF v_r.kind IN ('upgrade', 'downgrade') THEN
    -- A subida começa já e não mexe no «pago até»; a descida começa depois dele.
    starts_on := CASE WHEN v_r.kind = 'upgrade' THEN v_start ELSE v_bill.paid_until + 1 END;
    paid_until := v_bill.paid_until;
    RETURN NEXT; RETURN;
  END IF;
  -- Novo ou renovação: depois do que já está pago e depois da experiência.
  IF v_bill.organization_id IS NOT NULL AND v_bill.paid_until >= v_start THEN v_start := v_bill.paid_until + 1; END IF;
  IF v_trial.id IS NOT NULL AND v_trial.ends_on >= v_start THEN v_start := v_trial.ends_on + 1; END IF;
  starts_on := v_start;
  paid_until := (v_start + CASE v_r.period WHEN 'yearly' THEN interval '1 year' ELSE interval '1 month' END)::date - 1;
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_accept_plan_request(p_request_id UUID, p_paid_until DATE DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_r     plan_requests%ROWTYPE;
  v_s     RECORD;
  v_until DATE;
  v_trial plan_trials%ROWTYPE;
BEGIN
  IF NOT COALESCE(is_platform_admin_me(), FALSE) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  SELECT * INTO v_r FROM plan_requests WHERE id = p_request_id FOR UPDATE;
  IF v_r.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_r.status <> 'open' THEN RAISE EXCEPTION 'not_open'; END IF;
  SELECT * INTO v_s FROM plan_suggested_dates(v_r.id);
  v_until := COALESCE(p_paid_until, v_s.paid_until);

  IF v_r.kind = 'downgrade' THEN
    -- Marca a descida para o dia a seguir ao «pago até» (sem pago: já).
    IF EXISTS (SELECT 1 FROM organization_billing WHERE organization_id = v_r.organization_id AND paid_until >= plan_today()) THEN
      UPDATE organization_billing SET downgrade_tier = v_r.requested_tier, updated_at = NOW() WHERE organization_id = v_r.organization_id;
    ELSE
      PERFORM set_org_plan_internal(v_r.organization_id, v_r.requested_tier);
    END IF;
  ELSE
    IF v_until IS NULL OR v_until < v_s.starts_on THEN RAISE EXCEPTION 'bad_paid_until'; END IF;
    INSERT INTO organization_billing (organization_id, paid_tier, period, paid_from, paid_until, last_request_id)
    VALUES (v_r.organization_id, v_r.requested_tier, v_r.period,
            CASE WHEN v_r.kind = 'upgrade' THEN COALESCE((SELECT paid_from FROM organization_billing WHERE organization_id = v_r.organization_id), v_s.starts_on) ELSE v_s.starts_on END,
            v_until, v_r.id)
    ON CONFLICT (organization_id) DO UPDATE
      SET paid_tier = EXCLUDED.paid_tier, period = EXCLUDED.period,
          paid_from = CASE WHEN v_r.kind = 'upgrade' THEN organization_billing.paid_from ELSE EXCLUDED.paid_from END,
          paid_until = EXCLUDED.paid_until, last_request_id = EXCLUDED.last_request_id,
          downgrade_tier = NULL, updated_at = NOW();
    -- Durante a experiência do mesmo plano, a experiência passa a paga no fim (não se perde nenhum dia).
    SELECT * INTO v_trial FROM plan_trials WHERE organization_id = v_r.organization_id AND status = 'active';
    IF v_trial.id IS NOT NULL AND v_trial.tier = v_r.requested_tier THEN
      NULL;  -- a tarefa automática vê o pago a seguir e marca 'converted'
    ELSIF v_s.starts_on <= plan_today() OR v_r.kind = 'upgrade' THEN
      IF v_trial.id IS NOT NULL THEN UPDATE plan_trials SET status = 'stopped' WHERE id = v_trial.id; END IF;
      PERFORM set_org_plan_internal(v_r.organization_id, v_r.requested_tier);
    END IF;
  END IF;

  UPDATE plan_requests SET status = 'accepted', decided_by = auth.uid(), decided_at = NOW(),
         starts_on = v_s.starts_on, paid_until = CASE WHEN v_r.kind = 'downgrade' THEN NULL ELSE v_until END
   WHERE id = v_r.id;
  PERFORM plan_notify_admins(v_r.organization_id, 'plan_request_accepted',
    jsonb_build_object('request_id', v_r.id, 'tier', v_r.requested_tier, 'tier_name', plan_label(v_r.requested_tier),
                       'kind', v_r.kind, 'starts_on', v_s.starts_on,
                       'paid_until', CASE WHEN v_r.kind = 'downgrade' THEN NULL ELSE v_until END));
  RETURN jsonb_build_object('ok', TRUE, 'starts_on', v_s.starts_on, 'paid_until', CASE WHEN v_r.kind = 'downgrade' THEN NULL ELSE v_until END);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_decline_plan_request(p_request_id UUID, p_reason TEXT, p_note TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE v_r plan_requests%ROWTYPE;
BEGIN
  IF NOT COALESCE(is_platform_admin_me(), FALSE) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF p_reason NOT IN ('nao_recebido', 'valor_errado', 'outro') THEN RAISE EXCEPTION 'bad_reason'; END IF;
  IF p_reason = 'outro' AND NULLIF(btrim(p_note), '') IS NULL THEN RAISE EXCEPTION 'note_required'; END IF;
  SELECT * INTO v_r FROM plan_requests WHERE id = p_request_id FOR UPDATE;
  IF v_r.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_r.status <> 'open' THEN RAISE EXCEPTION 'not_open'; END IF;
  UPDATE plan_requests SET status = 'declined', decline_reason = p_reason, decline_note = NULLIF(btrim(p_note), ''),
         decided_by = auth.uid(), decided_at = NOW()
   WHERE id = v_r.id;
  PERFORM plan_notify_admins(v_r.organization_id, 'plan_request_declined',
    jsonb_build_object('request_id', v_r.id, 'tier', v_r.requested_tier, 'tier_name', plan_label(v_r.requested_tier),
                       'reason', p_reason, 'note', NULLIF(btrim(p_note), '')));
  RETURN jsonb_build_object('ok', TRUE);
END;
$function$;

-- «Por renovar»: o pago acaba nos próximos 30 dias (anual) ou 7 (mensal), ou
-- já acabou e não há nada a seguir.
CREATE OR REPLACE FUNCTION public.admin_list_plan_renewals()
RETURNS TABLE(organization_id UUID, group_name TEXT, paid_tier TEXT, period TEXT, paid_until DATE, days_left INTEGER, open_request BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  IF NOT COALESCE(is_platform_admin_me(), FALSE) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  RETURN QUERY
    SELECT b.organization_id, o.name, b.paid_tier, b.period, b.paid_until, (b.paid_until - plan_today())::int,
           EXISTS (SELECT 1 FROM plan_requests r WHERE r.organization_id = b.organization_id AND r.status = 'open')
      FROM organization_billing b JOIN organizations o ON o.id = b.organization_id
     WHERE b.downgrade_tier IS NULL
       AND b.paid_until - plan_today() <= CASE b.period WHEN 'yearly' THEN 30 ELSE 7 END
     ORDER BY b.paid_until;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_list_plan_trials()
RETURNS TABLE(organization_id UUID, group_name TEXT, tier TEXT, owner_id UUID, owner_name TEXT, starts_on DATE, ends_on DATE)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  IF NOT COALESCE(is_platform_admin_me(), FALSE) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  RETURN QUERY
    SELECT t.organization_id, o.name, t.tier, t.owner_id, p.name, t.starts_on, t.ends_on
      FROM plan_trials t JOIN organizations o ON o.id = t.organization_id LEFT JOIN profiles p ON p.id = t.owner_id
     WHERE t.status = 'active'
     ORDER BY t.ends_on;
END;
$function$;

REVOKE ALL ON FUNCTION public.plan_suggested_dates(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_list_plan_requests(), public.admin_accept_plan_request(UUID, DATE),
  public.admin_decline_plan_request(UUID, TEXT, TEXT), public.admin_list_plan_renewals(),
  public.admin_list_plan_trials() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_plan_requests(), public.admin_accept_plan_request(UUID, DATE),
  public.admin_decline_plan_request(UUID, TEXT, TEXT), public.admin_list_plan_renewals(),
  public.admin_list_plan_trials() TO authenticated;

-- ── 5. A tarefa automática (de hora a hora; repetir não faz nada a mais) ─
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
      UPDATE organization_billing SET renewal_noticed_30 = r.paid_until WHERE organization_id = r.organization_id;
    ELSIF v_days <= 7 AND r.renewal_noticed_7 IS DISTINCT FROM r.paid_until THEN
      UPDATE organization_billing SET renewal_noticed_7 = r.paid_until, renewal_noticed_30 = r.paid_until WHERE organization_id = r.organization_id;
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

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'process-plan-billing';
SELECT cron.schedule('process-plan-billing', '7 * * * *', 'SELECT public.process_plan_billing()');

COMMIT;

-- Verificar depois de correr:
--   SELECT count(*) FROM cron.job WHERE jobname = 'process-plan-billing';                                   -- 1
--   SELECT has_function_privilege('anon', 'public.request_plan(uuid,text,text,text,text)', 'EXECUTE');      -- false
--   SELECT has_function_privilege('authenticated', 'public.process_plan_billing()', 'EXECUTE');             -- false
--   SELECT has_table_privilege('authenticated', 'public.plan_requests', 'SELECT');                          -- false
--   SELECT bool_and(provisional) FROM billing_settings;                                                     -- true até o Ruben dar os dados
