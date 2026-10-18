-- ═════════════════════════════════════════════════════════════════════════
-- Parceiros 1: o parceiro, os prémios do mês por zona e os vouchers dele
--
-- PORQUÊ. Demonstração da RM Terapias, aprovada pelo Francisco a 18 out
-- (desenho: design-handoff/2026-10-18-parceiros-primeiro/SPEC-UX.md e
-- proposta-v2.png; regras: PROPOSTA-BA.md). Plano dos dados: okay do
-- Francisco a 18 out. Cada parceiro oferece um desconto ao 1.º, 2.º e 3.º
-- do Ranking do mês da sua zona (distrito), pódio de «Todos». Empates como
-- no Ranking do mês (mais vitórias, depois mais jogos; igual em tudo,
-- recebem os dois).
--
-- O QUE FAZ
--   · partners: a ficha do parceiro (pública: a página é partilhada e entra
--     no site). Quem a cria é a equipa, à mão, por agora.
--   · partner_month_prizes: o desconto de cada lugar (1, 2, 3).
--   · Ranking do mês por zona: soma, por pessoa, o que conta em cada clube
--     do distrito (organizations.district), com as regras de sempre (mínimo
--     4 jogos, sem contas de teste, etc.). Ao vivo, sem fecho guardado.
--   · vouchers: passam a poder vir de um parceiro (sem jogo nem clube), com
--     o lugar, o mês, a zona, o desconto, um código e a validade (30 dias).
--     Só o dono vê os vouchers de parceiro (os do clube ficam como estão).
--     Um voucher fora de validade já não se marca como usado.
--   · issue_partner_month_vouchers: dá os vouchers do pódio de um mês
--     (interna; a entrega automática no dia 1 fica para depois do sim da
--     Rita).
--
-- PARA OS ECRÃS
--   get_partner(p_slug) → json (anon e authenticated) · Dev 4
--     id, slug, name, kind_label, city, district, tagline, address, hours,
--     instagram_url, website_url, cover_url, logo_url (pode ser null),
--     prizes [{place, discount_pct, description}], prize_month (dia 1 do mês
--     de agora), prize_district.
--   list_partners(p_district DEFAULT NULL) → json array, mesmo formato
--     (anon e authenticated) · Dev 1 (site, sem zona) e Dev 2 (pódio da zona)
--   list_my_partner_cards() → json array, os parceiros das zonas dos clubes
--     de quem pede (authenticated) · Dev 2 (Home)
--   get_month_ranking_zone(p_district, p_month, p_gender) → as mesmas
--     colunas do get_month_ranking (authenticated) · Dev 2 (pódio)
--   vouchers.partner_id → partners: o Perfil pode pedir
--     partner:partners(name, slug, logo_url). Usar: mark_voucher_used.
--
-- Dev 3, 18 out 2026 · ecrãs: Dev 4, Dev 2, Dev 1
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. O parceiro e os prémios ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.partners (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name          TEXT NOT NULL,
  kind_label    TEXT,
  city          TEXT,
  district      TEXT,
  tagline       TEXT,
  address       TEXT,
  hours         TEXT,
  instagram_url TEXT,
  website_url   TEXT,
  cover_url     TEXT,
  logo_url      TEXT,
  code_prefix   TEXT NOT NULL CHECK (code_prefix ~ '^[A-Z0-9]{2,4}$'),
  is_founder    BOOLEAN NOT NULL DEFAULT FALSE,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_partners_district ON public.partners (district) WHERE active;

CREATE TABLE IF NOT EXISTS public.partner_month_prizes (
  partner_id   UUID NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  place        SMALLINT NOT NULL CHECK (place BETWEEN 1 AND 3),
  discount_pct SMALLINT NOT NULL CHECK (discount_pct BETWEEN 1 AND 100),
  description  TEXT,
  PRIMARY KEY (partner_id, place)
);

-- Leitura pública dos parceiros ativos; escrever, só a equipa (sem regras).
ALTER TABLE public.partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_month_prizes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.partners, public.partner_month_prizes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.partners, public.partner_month_prizes TO anon, authenticated;
DROP POLICY IF EXISTS "Parceiros ativos" ON public.partners;
CREATE POLICY "Parceiros ativos" ON public.partners FOR SELECT TO anon, authenticated USING (active);
DROP POLICY IF EXISTS "Prémios dos parceiros ativos" ON public.partner_month_prizes;
CREATE POLICY "Prémios dos parceiros ativos" ON public.partner_month_prizes FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.partners p WHERE p.id = partner_id AND p.active));

-- ── 2. O json de um parceiro (interna) ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.partner_json(p_partner_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT jsonb_build_object(
           'id', p.id, 'slug', p.slug, 'name', p.name, 'kind_label', p.kind_label,
           'city', p.city, 'district', p.district, 'tagline', p.tagline,
           'address', p.address, 'hours', p.hours, 'instagram_url', p.instagram_url,
           'website_url', p.website_url, 'cover_url', p.cover_url, 'logo_url', p.logo_url,
           'is_founder', p.is_founder,
           'prizes', COALESCE((SELECT jsonb_agg(jsonb_build_object('place', z.place, 'discount_pct', z.discount_pct,
                                                                   'description', z.description) ORDER BY z.place)
                                 FROM partner_month_prizes z WHERE z.partner_id = p.id), '[]'::jsonb),
           'prize_month', ranking_current_month(),
           'prize_district', p.district)
    FROM partners p
   WHERE p.id = p_partner_id AND p.active;
$function$;
REVOKE ALL ON FUNCTION public.partner_json(UUID) FROM PUBLIC, anon, authenticated;

-- ── 3. Para os ecrãs: o parceiro, a lista, os da minha zona ─────────────
CREATE OR REPLACE FUNCTION public.get_partner(p_slug TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT partner_json(p.id) FROM partners p WHERE p.slug = lower(btrim(p_slug)) AND p.active;
$function$;
REVOKE ALL ON FUNCTION public.get_partner(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_partner(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.list_partners(p_district TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT COALESCE(jsonb_agg(partner_json(p.id) ORDER BY p.created_at, p.name), '[]'::jsonb)
    FROM partners p
   WHERE p.active AND (NULLIF(btrim(p_district), '') IS NULL OR p.district = btrim(p_district));
$function$;
REVOKE ALL ON FUNCTION public.list_partners(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_partners(TEXT) TO anon, authenticated;

-- A zona de quem pede = os distritos dos clubes de que é membro.
CREATE OR REPLACE FUNCTION public.list_my_partner_cards()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT COALESCE(jsonb_agg(partner_json(p.id) ORDER BY p.created_at, p.name), '[]'::jsonb)
    FROM partners p
   WHERE p.active AND auth.uid() IS NOT NULL
     AND p.district IN (SELECT o.district FROM memberships m JOIN organizations o ON o.id = m.organization_id
                         WHERE m.user_id = auth.uid() AND o.district IS NOT NULL);
$function$;
REVOKE ALL ON FUNCTION public.list_my_partner_cards() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_partner_cards() TO authenticated;

-- ── 4. Ranking do mês por zona ──────────────────────────────────────────
-- Usa a tabela de cada clube do distrito (as regras vivas de lá: contas de
-- teste, professores escondidos, perfis sem nome) e soma por pessoa.
CREATE OR REPLACE FUNCTION public.ranking_month_zone_table(p_month DATE, p_district TEXT, p_filter TEXT)
RETURNS TABLE(user_id UUID, place INTEGER, points INTEGER, games INTEGER, wins INTEGER, qualified BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH s AS (
    SELECT t.user_id, SUM(t.points)::int AS points, SUM(t.games)::int AS games, SUM(t.wins)::int AS wins
      FROM organizations o
      CROSS JOIN LATERAL ranking_month_table(p_month, o.id, p_filter) t
     WHERE o.district = p_district
     GROUP BY t.user_id
  )
  SELECT s.user_id,
         CASE WHEN s.games >= 4 THEN (RANK() OVER (PARTITION BY s.games >= 4 ORDER BY s.points DESC, s.wins DESC, s.games DESC))::int END,
         s.points, s.games, s.wins, s.games >= 4
    FROM s;
$function$;
REVOKE ALL ON FUNCTION public.ranking_month_zone_table(DATE, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_month_ranking_zone(p_district TEXT, p_month DATE DEFAULT NULL, p_gender TEXT DEFAULT NULL)
RETURNS TABLE(place INTEGER, user_id UUID, name TEXT, avatar_url TEXT, rating NUMERIC, gender TEXT,
              points INTEGER, games INTEGER, wins INTEGER, qualified BOOLEAN, is_me BOOLEAN, frame TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_month  DATE := COALESCE(date_trunc('month', p_month)::date, ranking_current_month());
  v_filter TEXT := COALESCE(NULLIF(p_gender, ''), 'todos');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'no_session'; END IF;
  IF v_filter NOT IN ('todos', 'masculino', 'feminino') THEN RAISE EXCEPTION 'bad_filter'; END IF;
  IF NULLIF(btrim(p_district), '') IS NULL THEN RAISE EXCEPTION 'no_district'; END IF;
  IF v_month > ranking_current_month() OR v_month < DATE '2026-10-01' THEN RETURN; END IF;
  RETURN QUERY
    SELECT t.place, t.user_id, p.name, p.avatar_url, p.rating, p.gender, t.points, t.games, t.wins, t.qualified,
           t.user_id = auth.uid(), fr.frame
      FROM ranking_month_zone_table(v_month, btrim(p_district), v_filter) t
      JOIN profiles p ON p.id = t.user_id
      LEFT JOIN ranking_frames_now() fr ON fr.user_id = t.user_id AND fr.best
     WHERE t.qualified OR t.user_id = auth.uid()
     ORDER BY t.qualified DESC, t.place, lower(p.name);
END;
$function$;
REVOKE ALL ON FUNCTION public.get_month_ranking_zone(TEXT, DATE, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_month_ranking_zone(TEXT, DATE, TEXT) TO authenticated;

-- ── 5. Vouchers de parceiro ─────────────────────────────────────────────
ALTER TABLE public.vouchers ALTER COLUMN game_id DROP NOT NULL;
ALTER TABLE public.vouchers ALTER COLUMN organization_id DROP NOT NULL;
ALTER TABLE public.vouchers ADD COLUMN IF NOT EXISTS partner_id     UUID REFERENCES public.partners(id);
ALTER TABLE public.vouchers ADD COLUMN IF NOT EXISTS prize_place    SMALLINT;
ALTER TABLE public.vouchers ADD COLUMN IF NOT EXISTS prize_month    DATE;
ALTER TABLE public.vouchers ADD COLUMN IF NOT EXISTS prize_district TEXT;
ALTER TABLE public.vouchers ADD COLUMN IF NOT EXISTS discount_pct   SMALLINT;
ALTER TABLE public.vouchers ADD COLUMN IF NOT EXISTS code           TEXT;
ALTER TABLE public.vouchers ADD COLUMN IF NOT EXISTS valid_until    TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS vouchers_code_uniq ON public.vouchers (code) WHERE code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS vouchers_partner_month_uniq
  ON public.vouchers (partner_id, prize_month, user_id) WHERE partner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vouchers_partner ON public.vouchers (partner_id) WHERE partner_id IS NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.vouchers'::regclass AND conname = 'vouchers_jogo_ou_parceiro') THEN
    -- Um voucher é de um jogo (com clube) ou de um parceiro (com dono, lugar, mês, código e validade).
    ALTER TABLE public.vouchers ADD CONSTRAINT vouchers_jogo_ou_parceiro CHECK (
      (partner_id IS NULL AND game_id IS NOT NULL AND organization_id IS NOT NULL)
      OR (partner_id IS NOT NULL AND user_id IS NOT NULL AND prize_place BETWEEN 1 AND 3 AND prize_month IS NOT NULL
          AND discount_pct IS NOT NULL AND code IS NOT NULL AND valid_until IS NOT NULL));
  END IF;
END $$;

-- Os vouchers de parceiro só os vê o dono (têm o código). Os do clube como antes.
DO $$
DECLARE
  v_qual TEXT := (SELECT qual FROM pg_policies WHERE schemaname = 'public' AND tablename = 'vouchers' AND policyname = 'Own or org-mates vouchers');
BEGIN
  IF v_qual LIKE '%partner_id IS NULL%' THEN
    RAISE NOTICE 'vouchers: regra já estava';
  ELSIF v_qual IS DISTINCT FROM '((user_id = auth.uid()) OR shares_org_with(user_id))' THEN
    RAISE EXCEPTION 'vouchers: a regra de leitura não é a esperada (%). Parar e ler.', v_qual;
  ELSE
    DROP POLICY "Own or org-mates vouchers" ON public.vouchers;
    CREATE POLICY "Own or org-mates vouchers" ON public.vouchers FOR SELECT TO authenticated
      USING (user_id = auth.uid() OR (partner_id IS NULL AND shares_org_with(user_id)));
  END IF;
END $$;

-- Fora de validade já não se usa.
CREATE OR REPLACE FUNCTION public.vouchers_block_expired()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF NEW.status = 'usado' AND OLD.status = 'por_usar' AND OLD.valid_until IS NOT NULL AND OLD.valid_until < NOW() THEN
    RAISE EXCEPTION 'voucher_expired';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.vouchers_block_expired() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS vouchers_block_expired ON public.vouchers;
CREATE TRIGGER vouchers_block_expired BEFORE UPDATE OF status ON public.vouchers
  FOR EACH ROW EXECUTE FUNCTION public.vouchers_block_expired();

-- Código curto, sem letras que se confundem (interna).
CREATE OR REPLACE FUNCTION public.partner_voucher_code(p_prefix TEXT)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $function$
DECLARE
  c_letras CONSTANT TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code TEXT;
BEGIN
  LOOP
    SELECT p_prefix || '-' || string_agg(substr(c_letras, 1 + floor(random() * length(c_letras))::int, 1), '')
      INTO v_code FROM generate_series(1, 6);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM vouchers WHERE code = v_code);
  END LOOP;
  RETURN v_code;
END;
$function$;
REVOKE ALL ON FUNCTION public.partner_voucher_code(TEXT) FROM PUBLIC, anon, authenticated;

-- ── 6. Dar os vouchers do pódio de um mês (interna) ─────────────────────
-- Pódio de «Todos» da zona do parceiro; empate no lugar = recebem os dois.
-- Uma vez por parceiro, mês e pessoa. Devolve quantos deu.
CREATE OR REPLACE FUNCTION public.issue_partner_month_vouchers(p_partner_id UUID, p_month DATE)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_p     partners%ROWTYPE;
  v_month DATE := date_trunc('month', p_month)::date;
  v_n     INTEGER;
BEGIN
  SELECT * INTO v_p FROM partners WHERE id = p_partner_id AND active;
  IF v_p.id IS NULL OR v_p.district IS NULL THEN RAISE EXCEPTION 'partner_not_found'; END IF;
  INSERT INTO vouchers (user_id, partner_id, prize_place, prize_month, prize_district, discount_pct, code, valid_until)
  SELECT t.user_id, v_p.id, t.place, v_month, v_p.district, z.discount_pct,
         partner_voucher_code(v_p.code_prefix), NOW() + interval '30 days'
    FROM ranking_month_zone_table(v_month, v_p.district, 'todos') t
    JOIN partner_month_prizes z ON z.partner_id = v_p.id AND z.place = t.place
   WHERE t.qualified AND t.place <= 3
  ON CONFLICT (partner_id, prize_month, user_id) WHERE partner_id IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_partner_month_vouchers(UUID, DATE) FROM PUBLIC, anon, authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT has_function_privilege('anon', 'public.get_partner(text)', 'EXECUTE');                 -- true
--   SELECT has_function_privilege('anon', 'public.list_my_partner_cards()', 'EXECUTE');           -- false
--   SELECT has_function_privilege('authenticated', 'public.issue_partner_month_vouchers(uuid,date)', 'EXECUTE');  -- false
--   SELECT has_table_privilege('anon', 'public.partners', 'INSERT');                              -- false
--   SELECT qual FROM pg_policies WHERE tablename = 'vouchers' AND policyname = 'Own or org-mates vouchers';  -- com partner_id IS NULL
