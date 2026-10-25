-- ═════════════════════════════════════════════════════════════════════════
-- Parceiros 2: a ficha real da RM Terapias e quem gere a página do parceiro
--
-- PORQUÊ. A Rita aceitou (Francisco, 20 out). Dados reais em
-- Alinho/Marketing/2026-10-rm-terapias/DADOS.md (21 out, via PO). Vai no
-- main de 30 out, atrás do interruptor «parceiros».
--
-- O QUE FAZ
--   · partners ganha phones, email, prizes_from e prizes_until (o acordo
--     começa em novembro: o pódio de outubro não mostra nem dá prémio).
--   · partner_json (get_partner, list_partners, list_my_partner_cards) traz
--     estes campos, e os prémios só quando o mês de agora está dentro do
--     acordo (fora dele, prizes = [] e o ecrã pode dizer «a partir de…»).
--   · issue_partner_month_vouchers: só dá códigos para meses dentro do
--     acordo, e o código vale até ao fim do mês seguinte ao do prémio
--     (acordo com a Rita; antes eram 30 dias).
--   · partner_managers: quem gere a página do parceiro (a conta da Rita,
--     posta pela equipa; ninguém cria contas por ela). Sem acesso direto.
--   · A ficha real da RM (slug rm-terapias), com 15/10/5 % ao pódio a partir
--     de 2026-11-01. A foto do interior NÃO entra (tem um cliente real).
--   Imagens servidas pela app: /parceiros/rm-logotipo.jpg e
--   /parceiros/rm-fachada.webp (ficheiros a juntar em public/parceiros).
--
-- ORDEM. Depois de migration_parceiros_1_base.sql. Só acrescenta.
--
-- Dev 3, 21 out 2026 · ecrãs: Dev 4, Dev 2, Dev 1
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.partners') IS NULL THEN RAISE EXCEPTION 'Falta migration_parceiros_1_base.sql. Parar.'; END IF;
END $$;

-- ── 1. Campos novos ─────────────────────────────────────────────────────
ALTER TABLE public.partners ADD COLUMN IF NOT EXISTS phones       TEXT[];
ALTER TABLE public.partners ADD COLUMN IF NOT EXISTS email        TEXT;
ALTER TABLE public.partners ADD COLUMN IF NOT EXISTS prizes_from  DATE;
ALTER TABLE public.partners ADD COLUMN IF NOT EXISTS prizes_until DATE;

CREATE TABLE IF NOT EXISTS public.partner_managers (
  partner_id UUID NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (partner_id, user_id)
);
ALTER TABLE public.partner_managers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.partner_managers FROM PUBLIC, anon, authenticated;

-- ── 2. O json do parceiro (mesma assinatura) ────────────────────────────
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
           'phones', COALESCE(to_jsonb(p.phones), '[]'::jsonb), 'email', p.email,
           'is_founder', p.is_founder,
           'prizes_from', p.prizes_from, 'prizes_until', p.prizes_until,
           -- Os prémios só dentro do acordo.
           'prizes', CASE
             WHEN (p.prizes_from IS NULL OR ranking_current_month() >= p.prizes_from)
              AND (p.prizes_until IS NULL OR ranking_current_month() <= p.prizes_until)
             THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('place', z.place, 'discount_pct', z.discount_pct,
                                                                'description', z.description) ORDER BY z.place)
                              FROM partner_month_prizes z WHERE z.partner_id = p.id), '[]'::jsonb)
             ELSE '[]'::jsonb END,
           'prize_month', ranking_current_month(),
           'prize_district', p.district)
    FROM partners p
   WHERE p.id = p_partner_id AND p.active;
$function$;
REVOKE ALL ON FUNCTION public.partner_json(UUID) FROM PUBLIC, anon, authenticated;

-- ── 3. Os códigos do pódio: só dentro do acordo; valem até ao fim do mês
-- seguinte ao do prémio.
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
  IF (v_p.prizes_from IS NOT NULL AND v_month < v_p.prizes_from)
     OR (v_p.prizes_until IS NOT NULL AND v_month > v_p.prizes_until) THEN
    RETURN 0;
  END IF;
  INSERT INTO vouchers (user_id, partner_id, prize_place, prize_month, prize_district, discount_pct, code, valid_until)
  SELECT t.user_id, v_p.id, t.place, v_month, v_p.district, z.discount_pct,
         partner_voucher_code(v_p.code_prefix),
         ((v_month + interval '2 months')::timestamp AT TIME ZONE 'Europe/Lisbon')
    FROM ranking_month_zone_table(v_month, v_p.district, 'todos') t
    JOIN partner_month_prizes z ON z.partner_id = v_p.id AND z.place = t.place
   WHERE t.qualified AND t.place <= 3
  ON CONFLICT (partner_id, prize_month, user_id) WHERE partner_id IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_partner_month_vouchers(UUID, DATE) FROM PUBLIC, anon, authenticated;

-- ── 4. A ficha real da RM Terapias ──────────────────────────────────────
INSERT INTO partners (slug, name, kind_label, city, district, tagline, address, hours,
                      instagram_url, website_url, cover_url, logo_url, phones, email,
                      code_prefix, is_founder, prizes_from)
VALUES ('rm-terapias', 'RM Terapias', 'Massagens & Tratamentos', 'Almada', 'Setúbal',
        'Massagem desportiva e terapias, com a Rita Manique. Para recuperares entre jogos.',
        'Rua da Alembrança 5A, 2810-006 Feijó (Almada)', '9h às 19h',
        'https://www.instagram.com/ritamanique_rmterapias/', 'https://rmterapias.pt',
        '/parceiros/rm-fachada.webp', '/parceiros/rm-logotipo.jpg',
        ARRAY['967 254 460', '969 235 047'], 'info@rmterapias.pt',
        'RM', TRUE, DATE '2026-11-01')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name, kind_label = EXCLUDED.kind_label, city = EXCLUDED.city, district = EXCLUDED.district,
  tagline = EXCLUDED.tagline, address = EXCLUDED.address, hours = EXCLUDED.hours,
  instagram_url = EXCLUDED.instagram_url, website_url = EXCLUDED.website_url,
  cover_url = EXCLUDED.cover_url, logo_url = EXCLUDED.logo_url, phones = EXCLUDED.phones, email = EXCLUDED.email,
  is_founder = EXCLUDED.is_founder, prizes_from = EXCLUDED.prizes_from, active = TRUE;

INSERT INTO partner_month_prizes (partner_id, place, discount_pct, description)
SELECT p.id, x.place, x.pct, 'Desconto numa massagem'
  FROM partners p, (VALUES (1, 15), (2, 10), (3, 5)) AS x(place, pct)
 WHERE p.slug = 'rm-terapias'
ON CONFLICT (partner_id, place) DO UPDATE SET discount_pct = EXCLUDED.discount_pct, description = EXCLUDED.description;

-- A conta da Rita (em produção; criada por ela a 12 set). Onde não existir
-- (alinho-dev), não faz nada.
INSERT INTO partner_managers (partner_id, user_id)
SELECT p.id, pr.id FROM partners p JOIN profiles pr ON pr.id = 'c4391bf6-2a1b-4c9c-9d31-52ccd2d167cb'
 WHERE p.slug = 'rm-terapias'
ON CONFLICT DO NOTHING;

COMMIT;

-- Verificar depois de correr:
--   SELECT get_partner('rm-terapias')->>'hours', get_partner('rm-terapias')->>'prizes_from';  -- 9h às 19h | 2026-11-01
--   SELECT jsonb_array_length(get_partner('rm-terapias')->'prizes');  -- 0 em outubro, 3 a partir de novembro
--   SELECT count(*) FROM partner_managers;                              -- 1 em produção
