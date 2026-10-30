-- ═════════════════════════════════════════════════════════════════════════
-- Parceiros 7: os «Números» do mês para quem gere o parceiro (a Rita)
--
-- PORQUÊ. SPEC design-handoff/2026-10-28-rm-tres-pecas, peça 2 (pontos 8 a
-- 11). Plano aprovado pelo Francisco a 28 out; donos e regras acertados com o
-- PO e o Dev 4 no mesmo dia. O ecrã (PartnerManage › «Números», do Dev 4) já
-- chama partner_month_numbers e mostra o vazio enquanto ela não existir.
--
-- O QUE FAZ
--   1. vouchers.opened_at: a primeira vez que quem ganhou abre o «Mostrar na
--      receção» (voucher_mark_opened). Só acrescenta a coluna.
--   2. partner_track(p_partner_id, p_place, p_visitor): conta uma vista, sem
--      guardar quem foi. Sítios: 'home_card' e 'ranking_row' (o cartão),
--      'page_app' e 'page_site' (a página), 'contact' (ligar ou mapa).
--      · Pessoas diferentes por dia: na base só entra um md5 de um sal do dia
--        + parceiro + grupo + quem (a conta, ou, sem sessão, o endereço IP do
--        pedido). Nada se guarda no navegador. O sal e as marcas apagam-se no
--        dia seguinte; ficam só os totais por parceiro, dia e sítio.
--      · Sem sessão só conta 'page_site' (a /parceiros do site), até 300
--        pessoas por parceiro e por dia. O resto exige sessão.
--      · 'contact' conta vezes (até 5 por pessoa por dia); os outros contam
--        pessoas, uma vez por dia em cada grupo (cartão, página).
--      · Quem gere o parceiro não conta para os seus números.
--      · Nunca dá erro nem devolve nada: o ecrã dispara e esquece.
--      · 'page_app' conta dentro do get_partner (o pedido que a página já
--        faz); os outros são chamadas à parte (PO, 28 out).
--   3. voucher_mark_opened(p_voucher_id): só o dono do código; guarda a 1.ª vez.
--   4. partner_month_numbers(p_partner_id, p_month): o json do ecrã, só a quem
--      gere o parceiro (e ao superadmin com o modo ligado), sem nomes.
--   5. cron diário que apaga as marcas e os sais dos dias anteriores.
--
-- GRANT. partner_track fica aberta a anon DE PROPÓSITO (a /parceiros do site
-- é vista sem sessão; aceite pelo PO a 28 out). As outras duas só
-- authenticated. As tabelas novas não se leem nem escrevem diretamente.
--
-- ORDEM. Depois da migration_parceiros_3_pagina_do_parceiro.sql.
--
-- Dev 3, 28 out 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.is_partner_manager(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Falta migration_parceiros_3_pagina_do_parceiro.sql. Parar.';
  END IF;
END $$;

-- ── 1. O «abriram» do código ────────────────────────────────────────────
ALTER TABLE public.vouchers ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ;

-- ── 2. As tabelas das contagens ─────────────────────────────────────────
-- O dia em que se começou a contar (o «a {data}» do vazio).
CREATE TABLE IF NOT EXISTS public.partner_track_start (
  only_row   BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (only_row),
  started_on DATE NOT NULL
);
INSERT INTO public.partner_track_start (started_on)
VALUES ((NOW() AT TIME ZONE 'Europe/Lisbon')::date)
ON CONFLICT (only_row) DO NOTHING;

-- Os totais: é só isto que fica.
CREATE TABLE IF NOT EXISTS public.partner_track_counts (
  partner_id  UUID NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  day         DATE NOT NULL,
  place       TEXT NOT NULL CHECK (place IN ('home_card', 'ranking_row', 'page_app', 'page_site', 'contact')),
  people      INTEGER NOT NULL DEFAULT 0,
  anon_people INTEGER NOT NULL DEFAULT 0,
  taps        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (partner_id, day, place)
);

-- O sal de cada dia (apaga-se no dia seguinte, e com ele deixa de se poder
-- ligar uma marca a alguém).
CREATE TABLE IF NOT EXISTS public.partner_track_salt (
  day  DATE PRIMARY KEY,
  salt TEXT NOT NULL DEFAULT encode(extensions.gen_random_bytes(16), 'hex')
);

-- As marcas do dia: só o md5, nunca a conta nem o código.
CREATE TABLE IF NOT EXISTS public.partner_track_seen (
  day        DATE NOT NULL,
  partner_id UUID NOT NULL,
  grp        TEXT NOT NULL,
  h          TEXT NOT NULL,
  n          INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (day, partner_id, grp, h)
);

ALTER TABLE public.partner_track_start  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_track_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_track_salt   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_track_seen   ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.partner_track_start, public.partner_track_counts,
              public.partner_track_salt, public.partner_track_seen
  FROM PUBLIC, anon, authenticated;

-- ── 3. Contar uma vista ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.partner_track(p_partner_id UUID, p_place TEXT, p_visitor TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_day   DATE := (NOW() AT TIME ZONE 'Europe/Lisbon')::date;
  v_uid   UUID := auth.uid();
  v_who   TEXT;
  v_grp   TEXT;
  v_salt  TEXT;
  v_h     TEXT;
  v_n     INTEGER;
  v_anon  INTEGER;
  v_hdr   JSON;
  v_ip    TEXT;
BEGIN
  IF p_partner_id IS NULL OR p_place IS NULL THEN RETURN; END IF;
  v_grp := CASE p_place WHEN 'home_card' THEN 'card' WHEN 'ranking_row' THEN 'card'
                        WHEN 'page_app' THEN 'page' WHEN 'page_site' THEN 'page'
                        WHEN 'contact' THEN 'contact' END;
  IF v_grp IS NULL THEN RETURN; END IF;

  IF v_uid IS NOT NULL THEN
    v_who := 'u:' || v_uid::text;
  ELSE
    -- Sem sessão: só a /parceiros do site. Nada se guarda no navegador
    -- (PO e Copywriter, 28 out: cookies); quem é sai do endereço do pedido,
    -- que só entra no md5 com o sal do dia. O p_visitor fica por
    -- compatibilidade e não se usa.
    IF p_place <> 'page_site' THEN RETURN; END IF;
    v_hdr := NULLIF(current_setting('request.headers', TRUE), '')::json;
    v_ip  := COALESCE(NULLIF(btrim(v_hdr->>'cf-connecting-ip'), ''),
                      NULLIF(btrim(v_hdr->>'x-real-ip'), ''),
                      NULLIF(btrim(split_part(v_hdr->>'x-forwarded-for', ',', 1)), ''));
    IF v_ip IS NULL THEN RETURN; END IF;
    v_who := 'ip:' || v_ip;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM partners WHERE id = p_partner_id AND active) THEN RETURN; END IF;
  -- Quem gere o parceiro (e o superadmin com o modo ligado) não conta para si.
  IF v_uid IS NOT NULL AND is_partner_manager(p_partner_id) THEN RETURN; END IF;

  -- O que é de ontem para trás apaga-se já (o cron faz o mesmo à noite).
  DELETE FROM partner_track_seen WHERE day < v_day;
  DELETE FROM partner_track_salt WHERE day < v_day;

  INSERT INTO partner_track_salt (day) VALUES (v_day) ON CONFLICT (day) DO NOTHING;
  SELECT salt INTO v_salt FROM partner_track_salt WHERE day = v_day;
  v_h := md5(v_salt || '|' || p_partner_id::text || '|' || v_grp || '|' || v_who);

  INSERT INTO partner_track_counts (partner_id, day, place) VALUES (p_partner_id, v_day, p_place)
  ON CONFLICT (partner_id, day, place) DO NOTHING;

  IF v_uid IS NULL THEN
    SELECT anon_people INTO v_anon FROM partner_track_counts
     WHERE partner_id = p_partner_id AND day = v_day AND place = p_place;
    IF v_anon >= 300 THEN RETURN; END IF;
  END IF;

  INSERT INTO partner_track_seen (day, partner_id, grp, h) VALUES (v_day, p_partner_id, v_grp, v_h)
  ON CONFLICT (day, partner_id, grp, h) DO UPDATE SET n = partner_track_seen.n + 1
  RETURNING n INTO v_n;

  IF v_grp = 'contact' THEN
    -- Vezes, até 5 por pessoa por dia.
    IF v_n <= 5 THEN
      UPDATE partner_track_counts SET taps = taps + 1, people = people + (v_n = 1)::int
       WHERE partner_id = p_partner_id AND day = v_day AND place = p_place;
    END IF;
  ELSIF v_n = 1 THEN
    UPDATE partner_track_counts
       SET people = people + 1, anon_people = anon_people + (v_uid IS NULL)::int
     WHERE partner_id = p_partner_id AND day = v_day AND place = p_place;
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- Contar nunca pode partir o ecrã de quem está a ver.
  RETURN;
END;
$function$;
REVOKE ALL ON FUNCTION public.partner_track(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.partner_track(UUID, TEXT, TEXT) TO anon, authenticated;

-- ── 3b. A página na app conta no próprio pedido (BA e PO, 28 out) ──────
-- O get_partner é o que a /parceiro/:slug já chama: conta aí o 'page_app',
-- sem chamada à parte. Só com sessão (a página pede-a); quem gere o parceiro
-- já não conta dentro do partner_track. Passa a VOLATILE porque escreve.
-- Troca o corpo inteiro só se for o de produção de 28 out (md5 b0405a67…),
-- ou «já estava». CREATE OR REPLACE mantém os GRANT (anon de propósito).
DO $$
DECLARE
  v_def TEXT := replace(pg_get_functiondef('public.get_partner(text)'::regprocedure), E'\r', '');
BEGIN
  IF position('partner_track' IN v_def) > 0 THEN
    RAISE NOTICE 'get_partner já estava';
    RETURN;
  END IF;
  IF md5(v_def) <> 'b0405a67e2926293f5c9bd4eab9d59e0' THEN
    RAISE EXCEPTION 'get_partner: o corpo não é o esperado (md5 %). Parar.', md5(v_def);
  END IF;
  EXECUTE $sql$
CREATE OR REPLACE FUNCTION public.get_partner(p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id UUID;
BEGIN
  SELECT p.id INTO v_id FROM partners p WHERE p.slug = lower(btrim(p_slug)) AND p.active;
  IF v_id IS NULL THEN RETURN NULL; END IF;
  -- Números da Rita: «Abriram a tua página», na app (Dev 3, 28 out).
  IF auth.uid() IS NOT NULL THEN PERFORM partner_track(v_id, 'page_app'); END IF;
  RETURN partner_json(v_id);
END;
$function$
$sql$;
END $$;

-- ── 4. O «abriram»: a primeira vez que o dono abre o código ────────────
CREATE OR REPLACE FUNCTION public.voucher_mark_opened(p_voucher_id UUID)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $function$
  UPDATE vouchers SET opened_at = NOW()
   WHERE id = p_voucher_id AND user_id = auth.uid() AND auth.uid() IS NOT NULL
     AND partner_id IS NOT NULL AND opened_at IS NULL;
$function$;
REVOKE ALL ON FUNCTION public.voucher_mark_opened(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.voucher_mark_opened(UUID) TO authenticated;

-- ── 5. Os números do mês ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.partner_month_numbers(p_partner_id UUID, p_month DATE DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_m     DATE := date_trunc('month', COALESCE(p_month, ranking_current_month()))::date;
  v_next  DATE;
  v_since DATE;
  r_c     RECORD;
  r_v     RECORD;
BEGIN
  IF NOT is_partner_manager(p_partner_id) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  v_next := (v_m + interval '1 month')::date;

  SELECT GREATEST(s.started_on, (p.created_at AT TIME ZONE 'Europe/Lisbon')::date) INTO v_since
    FROM partners p CROSS JOIN partner_track_start s WHERE p.id = p_partner_id;

  SELECT COALESCE(sum(people) FILTER (WHERE place IN ('home_card', 'ranking_row')), 0) AS card_people,
         COALESCE(sum(people) FILTER (WHERE place IN ('page_app', 'page_site')), 0)    AS page_people,
         COALESCE(sum(taps)   FILTER (WHERE place = 'contact'), 0)                     AS contact_taps
    INTO r_c
    FROM partner_track_counts
   WHERE partner_id = p_partner_id AND day >= v_m AND day < v_next;

  SELECT count(*)                                      AS prizes,
         count(*) FILTER (WHERE opened_at IS NOT NULL) AS opened,
         count(*) FILTER (WHERE status = 'usado')      AS used
    INTO r_v
    FROM vouchers
   WHERE partner_id = p_partner_id AND prize_month = v_m AND status <> 'anulado';

  RETURN jsonb_build_object(
    'counting_since', v_since,
    'card_people',    r_c.card_people,
    'page_people',    r_c.page_people,
    'contact_taps',   r_c.contact_taps,
    'prizes',         r_v.prizes,
    'opened',         r_v.opened,
    'used',           r_v.used);
END;
$function$;
REVOKE ALL ON FUNCTION public.partner_month_numbers(UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_month_numbers(UUID, DATE) TO authenticated;

-- ── 6. Limpeza de cada noite ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.purge_partner_track_marks()
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $function$
  DELETE FROM partner_track_seen WHERE day < (NOW() AT TIME ZONE 'Europe/Lisbon')::date;
  DELETE FROM partner_track_salt WHERE day < (NOW() AT TIME ZONE 'Europe/Lisbon')::date;
$function$;
REVOKE ALL ON FUNCTION public.purge_partner_track_marks() FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'purge-partner-track-marks';
SELECT cron.schedule('purge-partner-track-marks', '10 0 * * *', 'SELECT public.purge_partner_track_marks()');

COMMIT;

-- Verificar depois de correr:
--   SELECT has_function_privilege('anon', 'public.partner_track(uuid,text,text)', 'EXECUTE');         -- true (de propósito)
--   SELECT has_function_privilege('anon', 'public.partner_month_numbers(uuid,date)', 'EXECUTE');     -- false
--   SELECT has_function_privilege('anon', 'public.voucher_mark_opened(uuid)', 'EXECUTE');            -- false
--   SELECT has_table_privilege('authenticated', 'public.partner_track_seen', 'SELECT');              -- false
--   SELECT count(*) FROM cron.job WHERE jobname = 'purge-partner-track-marks';                       -- 1
--   SELECT provolatile, position('partner_track' IN prosrc) > 0, proacl FROM pg_proc WHERE proname = 'get_partner';
--                                                                       -- v, true, proacl igual (com anon)
