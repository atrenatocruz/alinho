-- ═════════════════════════════════════════════════════════════════════════
-- Só é clube quem foi verificado (#739)
--
-- PORQUÊ. Decisão de 29 out (Francisco, com o sim do Renato): até aqui qualquer
-- admin passava a clube, sem ninguém ver, com «Experimentar» ou «Pedir este plano».
-- Regras: design-handoff/2026-10-29-planos-de-clube/REGRAS-BA.md. Ecrãs:
-- SPEC-PEDIDO.md. Plano aprovado: PLANO-DEV3-VERIFICACAO.md, na mesma pasta.
--
-- A REGRA. Uma organização principal só tem o plano Club se estiver verificada.
-- Vale para todos os caminhos (experiência, aceitar, tarefa automática, superadmin),
-- porque está num gatilho. A verificação fica guardada se o clube descer de plano.
--
-- O QUE ACRESCENTA
--   · organizations: club_verified_at e club_verified_source. Quem verificou fica
--     em plan_requests.decided_by: organizations lê-se sem sessão, e o superadmin é
--     invisível para os outros.
--   · plan_requests: is_club_check e os dados do clube; o motivo 'nao_e_clube'.
--   · request_club_verification e admin_accept_club_request.
--   · request_plan('club') de um grupo por verificar (o que a app antiga manda)
--     entra como pedido de verificação, sem dados e sem nada a pagar.
--   · O pedido de verificação não caduca sozinho.
--   · get_group_plan_status e admin_list_plan_requests dizem o que falta aos ecrãs.
--
-- O QUE MUDA NOS DADOS (Francisco, 3 nov, pelo PO)
--   · «Alinho Grupo Padel» (amigos-do-padel) passa a Community. Não se apaga nada.
--   · Os outros que hoje têm o plano Club ficam verificados como fundadores. Em
--     produção são só a2n e smash-padel-almada (visto a 3 nov). Vai por «quem tem o
--     plano» e não pelos nomes para o alinho-dev ficar igualmente certo. Confirmar com
--     a verificação no fim do ficheiro.
--
-- O QUE A APP ANTIGA VÊ. Nenhum nome nem parâmetro muda. «Experimentar» no Club
-- de um grupo por verificar dá erro genérico. Nos avisos: a recusa vai com o motivo
-- 'outro' e o texto de quem verificou, porque não conhece 'nao_e_clube'; o aceite
-- leva o fim da experiência em paid_until, porque sem ele diz que o plano desceu.
--
-- ORDEM. Depois de migration_zona_de_cada_pessoa.sql (usa is_place_district).
-- Antes dos ecrãs do Dev 1 no main. O preço é migration_plano_clube_19_99.sql, à parte.
--
-- Dev 3, 3 nov 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- Só troca se os corpos de hoje forem os esperados, ou se já estiverem trocados. Há
-- dois md5 onde o alinho-dev tem o mesmo corpo sem os comentários.
DO $$
DECLARE
  r RECORD;
  v_src TEXT;
  v_md5 TEXT;
BEGIN
  IF to_regprocedure('public.is_place_district(text)') IS NULL THEN
    RAISE EXCEPTION 'Falta correr migration_zona_de_cada_pessoa.sql. Parar.';
  END IF;
  FOR r IN
    SELECT * FROM (VALUES
      ('public.request_plan(uuid,text,text,text,text)', ARRAY['714aeb75eb67933d756dc65c33a8324b', '44d96cc1ece9a6efc9ace4bcba1119f4']),
      ('public.admin_accept_plan_request(uuid,date)',   ARRAY['4cb12ab8a44d609bef9333385dcee2f5', '6f1ef8418bb30115c55d1111297595d8']),
      ('public.admin_decline_plan_request(uuid,text,text)', ARRAY['915e81769f3ceaaf7b5b609c2d0bc8fe']),
      ('public.process_plan_billing()',                 ARRAY['28dedd505385843b8b97d0addd005ffd']),
      ('public.get_group_plan_status(uuid)',            ARRAY['5c022e12b05a11cfdef1b8076b067c6c']),
      ('public.admin_list_plan_requests()',             ARRAY['34b52626481bd374631ed53e030aff30'])
    ) AS t(sig, md5s)
  LOOP
    SELECT prosrc INTO v_src FROM pg_proc WHERE oid = to_regprocedure(r.sig);
    IF v_src IS NULL THEN RAISE EXCEPTION '% não existe. Parar.', r.sig; END IF;
    v_md5 := md5(replace(v_src, E'\r', ''));
    IF NOT v_md5 = ANY (r.md5s) AND position('is_club_check' IN v_src) = 0 THEN
      RAISE EXCEPTION '%: o corpo não é o esperado (md5 %). Parar.', r.sig, v_md5;
    END IF;
  END LOOP;
END $$;


-- ─── A verificação ───────────────────────────────────────────────────────

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS club_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS club_verified_source TEXT
    CHECK (club_verified_source IN ('fundador', 'pedido'));

-- Por esta ordem: primeiro os dados, só depois a guarda.
UPDATE public.organizations
   SET plan_tier = 'pro', plan_updated_at = NOW()
 WHERE slug = 'amigos-do-padel' AND parent_organization_id IS NULL AND plan_tier = 'club';

UPDATE public.organizations
   SET club_verified_at = NOW(), club_verified_source = 'fundador'
 WHERE parent_organization_id IS NULL AND plan_tier = 'club' AND club_verified_at IS NULL;

-- Só olha quando o plano passa a club, ou um subgrupo passa a principal: gravar
-- outra coisa num clube nunca dá este erro.
CREATE OR REPLACE FUNCTION public.organizations_club_needs_verification()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public
AS $function$
BEGIN
  IF NEW.parent_organization_id IS NULL AND NEW.plan_tier = 'club' AND NEW.club_verified_at IS NULL
     AND (TG_OP = 'INSERT' OR OLD.plan_tier IS DISTINCT FROM 'club' OR OLD.parent_organization_id IS NOT NULL) THEN
    RAISE EXCEPTION 'club_not_verified';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.organizations_club_needs_verification() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS organizations_club_needs_verification_trigger ON public.organizations;
CREATE TRIGGER organizations_club_needs_verification_trigger
  BEFORE INSERT OR UPDATE OF plan_tier, parent_organization_id ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.organizations_club_needs_verification();


-- ─── O pedido ────────────────────────────────────────────────────────────

ALTER TABLE public.plan_requests
  ADD COLUMN IF NOT EXISTS is_club_check BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS club_name TEXT,
  ADD COLUMN IF NOT EXISTS club_address TEXT,
  ADD COLUMN IF NOT EXISTS club_latitude NUMERIC,
  ADD COLUMN IF NOT EXISTS club_longitude NUMERIC,
  ADD COLUMN IF NOT EXISTS club_district TEXT CHECK (is_place_district(club_district)),
  ADD COLUMN IF NOT EXISTS club_courts INTEGER,
  ADD COLUMN IF NOT EXISTS club_link TEXT;

ALTER TABLE public.plan_requests DROP CONSTRAINT IF EXISTS plan_requests_decline_reason_check;
ALTER TABLE public.plan_requests ADD CONSTRAINT plan_requests_decline_reason_check
  CHECK (decline_reason = ANY (ARRAY['nao_recebido'::text, 'valor_errado'::text, 'outro'::text, 'nao_e_clube'::text]));

-- A app antiga manda isto para o Club: entra como pedido de verificação, sem dados.
CREATE OR REPLACE FUNCTION public.request_plan(p_organization_id uuid, p_tier text, p_period text DEFAULT 'monthly'::text, p_invoice_name text DEFAULT NULL::text, p_invoice_nif text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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
  v_check  BOOLEAN;
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
  v_check := p_tier = 'club' AND v_org.club_verified_at IS NULL;

  IF v_check THEN
    v_kind := 'new'; v_amount := 0;                    -- nada a pagar até estar verificado
  ELSIF plan_rank(p_tier) < plan_rank(v_cur) THEN
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
                             invoice_name, invoice_nif, requested_by, is_club_check)
  VALUES (p_organization_id, v_cur, p_tier, v_period, v_kind, v_amount, v_ref,
          NULLIF(btrim(p_invoice_name), ''), NULLIF(btrim(p_invoice_nif), ''), auth.uid(), v_check)
  RETURNING id INTO v_id;

  PERFORM plan_notify_superadmins('plan_request_new',
    jsonb_build_object('request_id', v_id, 'organization_id', p_organization_id, 'group_name', v_org.name,
                       'tier', p_tier, 'tier_name', plan_label(p_tier), 'from_tier', v_cur, 'kind', v_kind,
                       'amount', v_amount, 'reference', v_ref, 'is_club_check', v_check));
  RETURN jsonb_build_object('ok', TRUE, 'request_id', v_id, 'reference', v_ref, 'amount', v_amount, 'kind', v_kind, 'period', v_period,
                            'is_club_check', v_check);
END;
$function$;

REVOKE ALL ON FUNCTION public.request_plan(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_plan(uuid, text, text, text, text) TO authenticated, service_role;

-- O pedido com os dados do clube. Sem coordenadas ou distrito, se a morada foi escrita
-- à mão. O link abre-se no navegador de quem verifica: só endereços web.
CREATE OR REPLACE FUNCTION public.request_club_verification(
  p_organization_id UUID, p_name TEXT, p_address TEXT, p_latitude NUMERIC, p_longitude NUMERIC,
  p_district TEXT, p_courts INTEGER, p_link TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_org      organizations%ROWTYPE;
  v_name     TEXT := NULLIF(btrim(COALESCE(p_name, '')), '');
  v_address  TEXT := NULLIF(btrim(COALESCE(p_address, '')), '');
  v_district TEXT := NULLIF(btrim(COALESCE(p_district, '')), '');
  v_link     TEXT := NULLIF(btrim(COALESCE(p_link, '')), '');
  v_cur      TEXT;
  v_ref      TEXT;
  v_id       UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'no_session'; END IF;
  SELECT * INTO v_org FROM organizations WHERE id = p_organization_id;
  IF v_org.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_org.parent_organization_id IS NOT NULL THEN RAISE EXCEPTION 'not_main_group'; END IF;
  IF NOT is_org_admin(p_organization_id) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF v_org.club_verified_at IS NOT NULL THEN RAISE EXCEPTION 'already_verified'; END IF;
  IF EXISTS (SELECT 1 FROM plan_requests WHERE organization_id = p_organization_id AND status = 'open') THEN
    RAISE EXCEPTION 'request_open';
  END IF;
  IF v_name IS NULL OR length(v_name) > 120 THEN RAISE EXCEPTION 'bad_name'; END IF;
  IF v_address IS NULL OR length(v_address) > 300 THEN RAISE EXCEPTION 'bad_address'; END IF;
  IF NOT is_place_district(v_district) THEN RAISE EXCEPTION 'bad_district'; END IF;
  IF p_courts IS NULL OR p_courts < 1 OR p_courts > 50 THEN RAISE EXCEPTION 'bad_courts'; END IF;
  IF v_link IS NULL OR length(v_link) > 500
     OR v_link !~* '^(https?://)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:[0-9]+)?([/?#][^[:space:]]*)?$' THEN
    RAISE EXCEPTION 'bad_link';
  END IF;

  v_cur := plan_current_tier(p_organization_id);
  v_ref := plan_new_reference();
  INSERT INTO plan_requests (organization_id, from_tier, requested_tier, period, kind, amount, reference, requested_by,
                             is_club_check, club_name, club_address, club_latitude, club_longitude, club_district, club_courts, club_link)
  VALUES (p_organization_id, v_cur, 'club', 'monthly', 'new', 0, v_ref, auth.uid(),
          TRUE, v_name, v_address,
          CASE WHEN p_latitude BETWEEN -90 AND 90 AND p_longitude BETWEEN -180 AND 180 THEN p_latitude END,
          CASE WHEN p_latitude BETWEEN -90 AND 90 AND p_longitude BETWEEN -180 AND 180 THEN p_longitude END,
          v_district, p_courts, v_link)
  RETURNING id INTO v_id;

  PERFORM plan_notify_superadmins('plan_request_new',
    jsonb_build_object('request_id', v_id, 'organization_id', p_organization_id, 'group_name', v_org.name,
                       'tier', 'club', 'tier_name', plan_label('club'), 'from_tier', v_cur, 'kind', 'new',
                       'amount', 0, 'reference', v_ref, 'is_club_check', TRUE, 'club_name', v_name));
  RETURN jsonb_build_object('ok', TRUE, 'request_id', v_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.request_club_verification(UUID, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_club_verification(UUID, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, INTEGER, TEXT) TO authenticated, service_role;

-- Aceitar: tudo numa só operação. Se o dono já usou a experiência do Club, fica só
-- verificado e pede o plano pela folha normal, onde escolhe o período e dá os dados da
-- fatura (Francisco, 3 nov: pedido pago normal, o plano muda quando o pagamento for
-- confirmado; UX, 3 nov: o pedido não se cria sozinho).
CREATE OR REPLACE FUNCTION public.admin_accept_club_request(p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_r      plan_requests%ROWTYPE;
  v_org    organizations%ROWTYPE;
  v_old    plan_trials%ROWTYPE;
  v_today  DATE := plan_today();
  v_days   INTEGER;
  v_end    DATE;
  v_prev   TEXT;
BEGIN
  IF NOT COALESCE(is_platform_admin_me(), FALSE) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  SELECT * INTO v_r FROM plan_requests WHERE id = p_request_id FOR UPDATE;
  IF v_r.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_r.status <> 'open' THEN RAISE EXCEPTION 'not_open'; END IF;
  IF NOT v_r.is_club_check THEN RAISE EXCEPTION 'not_club_check'; END IF;
  SELECT * INTO v_org FROM organizations WHERE id = v_r.organization_id FOR UPDATE;

  -- A morada, as coordenadas e o distrito só entram onde estiverem vazios.
  UPDATE organizations
     SET club_verified_at = COALESCE(club_verified_at, NOW()),
         club_verified_source = COALESCE(club_verified_source, 'pedido'),
         location = COALESCE(NULLIF(btrim(location), ''), v_r.club_address),
         latitude = COALESCE(latitude, v_r.club_latitude),
         longitude = COALESCE(longitude, v_r.club_longitude),
         district = COALESCE(NULLIF(btrim(district), ''), v_r.club_district)
   WHERE id = v_r.organization_id;

  UPDATE plan_requests SET status = 'accepted', decided_by = auth.uid(), decided_at = NOW(), starts_on = v_today
   WHERE id = v_r.id;

  IF v_org.owner_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM plan_trials WHERE owner_id = v_org.owner_id AND tier = 'club') THEN
    -- Como em start_plan_trial, com o aviso de aceite em vez do da experiência.
    SELECT * INTO v_old FROM plan_trials WHERE organization_id = v_r.organization_id AND status = 'active' FOR UPDATE;
    IF v_old.id IS NOT NULL THEN
      UPDATE plan_trials SET status = 'stopped' WHERE id = v_old.id;
      v_prev := v_old.previous_tier;
    ELSE
      v_prev := v_org.plan_tier;
    END IF;
    v_days := CASE WHEN v_today <= DATE '2026-12-31' THEN 90 ELSE 30 END;
    v_end := v_today + v_days - 1;
    INSERT INTO plan_trials (organization_id, owner_id, tier, previous_tier, starts_on, ends_on)
    VALUES (v_r.organization_id, v_org.owner_id, 'club', v_prev, v_today, v_end);
    PERFORM set_org_plan_internal(v_r.organization_id, 'club');
    PERFORM plan_notify_admins(v_r.organization_id, 'plan_request_accepted',
      jsonb_build_object('request_id', v_r.id, 'tier', 'club', 'tier_name', plan_label('club'), 'kind', v_r.kind,
                         'is_club_check', TRUE, 'starts_on', v_today, 'ends_on', v_end, 'days', v_days,
                         'paid_until', v_end));
    RETURN jsonb_build_object('ok', TRUE, 'trial', TRUE, 'ends_on', v_end, 'days', v_days);
  END IF;

  PERFORM plan_notify_admins(v_r.organization_id, 'plan_club_verified_pay',
    jsonb_build_object('request_id', v_r.id, 'tier', 'club', 'tier_name', plan_label('club')));
  RETURN jsonb_build_object('ok', TRUE, 'trial', FALSE);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_accept_club_request(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_accept_club_request(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_accept_plan_request(p_request_id uuid, p_paid_until date DEFAULT NULL::date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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
  IF v_r.is_club_check THEN RAISE EXCEPTION 'is_club_check'; END IF;  -- vai por admin_accept_club_request
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

REVOKE ALL ON FUNCTION public.admin_accept_plan_request(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_accept_plan_request(uuid, date) TO authenticated, service_role;

-- Num pedido de verificação o porquê é obrigatório, e o motivo é 'nao_e_clube' ou
-- 'outro'. O aviso vai como 'outro': a app antiga não conhece o motivo novo.
CREATE OR REPLACE FUNCTION public.admin_decline_plan_request(p_request_id uuid, p_reason text, p_note text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE v_r plan_requests%ROWTYPE;
BEGIN
  IF NOT COALESCE(is_platform_admin_me(), FALSE) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF p_reason NOT IN ('nao_recebido', 'valor_errado', 'outro', 'nao_e_clube') THEN RAISE EXCEPTION 'bad_reason'; END IF;
  IF p_reason = 'outro' AND NULLIF(btrim(p_note), '') IS NULL THEN RAISE EXCEPTION 'note_required'; END IF;
  SELECT * INTO v_r FROM plan_requests WHERE id = p_request_id FOR UPDATE;
  IF v_r.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_r.status <> 'open' THEN RAISE EXCEPTION 'not_open'; END IF;
  IF v_r.is_club_check AND p_reason NOT IN ('nao_e_clube', 'outro') THEN RAISE EXCEPTION 'bad_reason'; END IF;
  IF NOT v_r.is_club_check AND p_reason = 'nao_e_clube' THEN RAISE EXCEPTION 'bad_reason'; END IF;
  IF v_r.is_club_check AND NULLIF(btrim(p_note), '') IS NULL THEN RAISE EXCEPTION 'note_required'; END IF;
  UPDATE plan_requests SET status = 'declined', decline_reason = p_reason, decline_note = NULLIF(btrim(p_note), ''),
         decided_by = auth.uid(), decided_at = NOW()
   WHERE id = v_r.id;
  PERFORM plan_notify_admins(v_r.organization_id, 'plan_request_declined',
    jsonb_build_object('request_id', v_r.id, 'tier', v_r.requested_tier, 'tier_name', plan_label(v_r.requested_tier),
                       'reason', CASE WHEN v_r.is_club_check THEN 'outro' ELSE p_reason END, 'note', NULLIF(btrim(p_note), ''),
                       'is_club_check', v_r.is_club_check));
  RETURN jsonb_build_object('ok', TRUE);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_decline_plan_request(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_decline_plan_request(uuid, text, text) TO authenticated, service_role;

-- Mais colunas no fim: muda o que devolve, por isso tem de se apagar primeiro.
DROP FUNCTION IF EXISTS public.admin_list_plan_requests();

CREATE OR REPLACE FUNCTION public.admin_list_plan_requests()
RETURNS TABLE(request_id uuid, organization_id uuid, group_name text, from_tier text, requested_tier text, period text, kind text, amount numeric, reference text, requested_by_name text, created_at timestamp with time zone, paid_claimed_at timestamp with time zone, invoice_name text, invoice_nif text, suggested_starts_on date, suggested_paid_until date,
              is_club_check boolean, club_name text, club_address text, club_district text, club_courts integer, club_link text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  IF NOT COALESCE(is_platform_admin_me(), FALSE) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  RETURN QUERY
    SELECT r.id, r.organization_id, o.name, r.from_tier, r.requested_tier, r.period, r.kind, r.amount, r.reference,
           p.name, r.created_at, r.paid_claimed_at, r.invoice_name, r.invoice_nif, s.starts_on, s.paid_until,
           r.is_club_check, r.club_name, r.club_address, r.club_district, r.club_courts, r.club_link
      FROM plan_requests r
      JOIN organizations o ON o.id = r.organization_id
      LEFT JOIN profiles p ON p.id = r.requested_by
      CROSS JOIN LATERAL plan_suggested_dates(r.id) s
     WHERE r.status = 'open'
     ORDER BY (r.paid_claimed_at IS NULL), r.created_at;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_list_plan_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_plan_requests() TO authenticated, service_role;

-- Só muda a linha do a): o pedido de verificação não caduca, quem está à espera é a equipa.
CREATE OR REPLACE FUNCTION public.process_plan_billing()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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
     WHERE status = 'open' AND created_at < NOW() - interval '7 days' AND NOT is_club_check
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
GRANT EXECUTE ON FUNCTION public.process_plan_billing() TO service_role;

-- Acrescenta club_verified, os dados no pedido aberto, e o último pedido de
-- verificação (a recusa fica à vista até ao próximo, e «Pedir outra vez» reusa os dados).
CREATE OR REPLACE FUNCTION public.get_group_plan_status(p_organization_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
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
    'club_verified', (SELECT club_verified_at IS NOT NULL FROM organizations WHERE id = v_main),
    'billing', (SELECT jsonb_build_object('paid_tier', b.paid_tier, 'period', b.period, 'paid_from', b.paid_from,
                                          'paid_until', b.paid_until, 'downgrade_tier', b.downgrade_tier)
                  FROM organization_billing b WHERE b.organization_id = v_main),
    'open_request', (SELECT jsonb_build_object('request_id', r.id, 'tier', r.requested_tier, 'period', r.period, 'kind', r.kind,
                                               'amount', r.amount, 'reference', r.reference, 'created_at', r.created_at,
                                               'paid_claimed_at', r.paid_claimed_at, 'invoice_name', r.invoice_name,
                                               'invoice_nif', r.invoice_nif, 'is_club_check', r.is_club_check)
                       FROM plan_requests r WHERE r.organization_id = v_main AND r.status = 'open'),
    'last_club_request', (SELECT jsonb_build_object('request_id', r.id, 'status', r.status, 'created_at', r.created_at,
                                                    'decided_at', r.decided_at, 'decline_note', r.decline_note,
                                                    'club_name', r.club_name, 'club_address', r.club_address,
                                                    'club_latitude', r.club_latitude, 'club_longitude', r.club_longitude,
                                                    'club_district', r.club_district, 'club_courts', r.club_courts,
                                                    'club_link', r.club_link)
                            FROM plan_requests r WHERE r.organization_id = v_main AND r.is_club_check
                           ORDER BY r.created_at DESC LIMIT 1),
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

REVOKE ALL ON FUNCTION public.get_group_plan_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_group_plan_status(uuid) TO authenticated, service_role;

COMMIT;

-- Verificar depois de correr:
--   SELECT slug, plan_tier, kind, club_verified_source FROM organizations
--    WHERE parent_organization_id IS NULL AND (club_verified_at IS NOT NULL OR plan_tier = 'club' OR slug = 'amigos-do-padel');
--     → em produção: a2n e smash-padel-almada (club, club, fundador); amigos-do-padel (pro, group, vazio)
--   SELECT has_function_privilege('anon', 'public.request_club_verification(uuid,text,text,numeric,numeric,text,integer,text)', 'EXECUTE'),
--          has_function_privilege('authenticated', 'public.request_club_verification(uuid,text,text,numeric,numeric,text,integer,text)', 'EXECUTE'),
--          has_function_privilege('anon', 'public.admin_accept_club_request(uuid)', 'EXECUTE'),
--          has_function_privilege('anon', 'public.admin_list_plan_requests()', 'EXECUTE'),
--          has_function_privilege('authenticated', 'public.process_plan_billing()', 'EXECUTE');
--     → false, true, false, false, false
