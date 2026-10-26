-- ═════════════════════════════════════════════════════════════════════════
-- Parceiros 3: a página de quem gere o parceiro e a entrega dos prémios no dia 1
--
-- PORQUÊ. A RM Terapias dá prémios a partir de novembro, entregues a 1 dez.
-- Plano aprovado pelo Francisco a 22 out (via PO): a Rita vê os códigos do
-- mês sem nomes, marca «usado» na receção, muda a ficha e as fotos; os
-- códigos saem sozinhos no dia 1. Ecrã: Dev 4.
--
-- O QUE FAZ
--   · is_partner_manager(p_partner_id): quem está em partner_managers (ou
--     superadmin).
--   · my_managed_partners() → [{id, slug, name, logo_url}]: para a app
--     mostrar a entrada para a página do parceiro.
--   · partner_list_vouchers(p_partner_id, p_month): os códigos, sem nomes nem
--     contas. status: por_usar, usado, anulado ou expirado (por_usar fora de
--     prazo).
--   · partner_redeem_voucher(p_code) → {discount_pct, prize_place,
--     prize_month, valid_until}. Erros: not_allowed (sem sessão ou não gere
--     nenhum parceiro), not_found, other_partner (é de outro parceiro),
--     already_used (hint = used_at), expired (hint = valid_until).
--   · update_partner_profile(...): só os campos que o parceiro muda (frase,
--     morada, horário, telefones, email, Instagram, site, logótipo e capa).
--     NULL = fica como está; '' = apaga. O logótipo e a capa só aceitam
--     imagens do balde partner-images, na pasta do parceiro.
--   · Balde partner-images (público para ler; escrevem só quem gere o
--     parceiro e os superadmins, na pasta <partner_id>/; até 5 MB, imagens).
--   · A entrega no dia 1: process_partner_month_vouchers() (pg_cron de hora
--     a hora, idempotente) dá, a cada parceiro ativo, os códigos de cada mês
--     já acabado dentro do acordo que ainda não tenha sido entregue
--     (partner_month_issues). Só com o interruptor «parceiros» ligado
--     (feature_flags); se estiver desligado no dia 1, entrega quando ligar.
--     Aviso no sino a quem ganhou ('partner_prize_won') e a quem gere o
--     parceiro ('partner_month_vouchers').
--
-- COMPATIBILIDADE. Só acrescenta. REVOKE a anon.
-- ORDEM. Depois de migration_parceiros_2_rm_real.sql.
--
-- Dev 3, 22 out 2026 · ecrã: Dev 4
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.partner_managers') IS NULL THEN RAISE EXCEPTION 'Falta migration_parceiros_2_rm_real.sql. Parar.'; END IF;
END $$;

-- ── 1. Quem gere ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_partner_manager(p_partner_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $function$
  SELECT auth.uid() IS NOT NULL
     AND (EXISTS (SELECT 1 FROM partner_managers m WHERE m.partner_id = p_partner_id AND m.user_id = auth.uid())
          OR COALESCE(is_platform_admin_me(), FALSE));
$function$;
REVOKE ALL ON FUNCTION public.is_partner_manager(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_partner_manager(UUID) TO authenticated;

-- Para o balde: a pasta é o id do parceiro (texto; uma pasta que não é um id não passa).
CREATE OR REPLACE FUNCTION public.is_partner_manager_folder(p_folder TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  IF p_folder IS NULL OR p_folder !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN FALSE; END IF;
  RETURN is_partner_manager(p_folder::uuid);
END;
$function$;
REVOKE ALL ON FUNCTION public.is_partner_manager_folder(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_partner_manager_folder(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.my_managed_partners()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', p.id, 'slug', p.slug, 'name', p.name, 'logo_url', p.logo_url) ORDER BY p.name), '[]'::jsonb)
    FROM partners p JOIN partner_managers m ON m.partner_id = p.id
   WHERE m.user_id = auth.uid() AND p.active;
$function$;
REVOKE ALL ON FUNCTION public.my_managed_partners() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_managed_partners() TO authenticated;

-- ── 2. Os códigos (sem nomes) ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.partner_list_vouchers(p_partner_id UUID, p_month DATE DEFAULT NULL)
RETURNS TABLE(voucher_id UUID, code TEXT, prize_place SMALLINT, discount_pct SMALLINT, prize_month DATE,
              prize_district TEXT, status TEXT, valid_until TIMESTAMPTZ, used_at TIMESTAMPTZ, created_at TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  IF NOT is_partner_manager(p_partner_id) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  RETURN QUERY
    SELECT v.id, v.code, v.prize_place, v.discount_pct, v.prize_month, v.prize_district,
           CASE WHEN v.status = 'por_usar' AND v.valid_until < NOW() THEN 'expirado' ELSE v.status END,
           v.valid_until, v.used_at, v.created_at
      FROM vouchers v
     WHERE v.partner_id = p_partner_id
       AND (p_month IS NULL OR v.prize_month = date_trunc('month', p_month)::date)
     ORDER BY v.prize_month DESC, v.prize_place, v.code;
END;
$function$;
REVOKE ALL ON FUNCTION public.partner_list_vouchers(UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_list_vouchers(UUID, DATE) TO authenticated;

-- ── 3. Marcar «usado» na receção ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.partner_redeem_voucher(p_code TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v vouchers%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM partner_managers WHERE user_id = auth.uid()) AND NOT COALESCE(is_platform_admin_me(), FALSE) THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  SELECT * INTO v FROM vouchers WHERE code = upper(btrim(p_code)) AND partner_id IS NOT NULL FOR UPDATE;
  IF v.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  -- O código existe mas é de outro parceiro (UX, 22 out). Não diz de qual.
  IF NOT is_partner_manager(v.partner_id) THEN RAISE EXCEPTION 'other_partner'; END IF;
  -- O ecrã lê a hora no hint: «já foi usado a…», «acabou a…».
  IF v.status <> 'por_usar' THEN RAISE EXCEPTION 'already_used' USING HINT = COALESCE(v.used_at::text, ''); END IF;
  IF v.valid_until < NOW() THEN RAISE EXCEPTION 'expired' USING HINT = v.valid_until::text; END IF;
  UPDATE vouchers SET status = 'usado', used_at = NOW() WHERE id = v.id;
  RETURN jsonb_build_object('ok', TRUE, 'discount_pct', v.discount_pct, 'prize_place', v.prize_place,
                            'prize_month', v.prize_month, 'valid_until', v.valid_until);
END;
$function$;
REVOKE ALL ON FUNCTION public.partner_redeem_voucher(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_redeem_voucher(TEXT) TO authenticated;

-- ── 4. A ficha que o parceiro muda ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_partner_profile(
  p_partner_id UUID, p_tagline TEXT DEFAULT NULL, p_address TEXT DEFAULT NULL, p_hours TEXT DEFAULT NULL,
  p_phones TEXT[] DEFAULT NULL, p_email TEXT DEFAULT NULL, p_instagram_url TEXT DEFAULT NULL,
  p_website_url TEXT DEFAULT NULL, p_logo_url TEXT DEFAULT NULL, p_cover_url TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_img TEXT := '/storage/v1/object/public/partner-images/' || p_partner_id::text || '/';
BEGIN
  IF NOT is_partner_manager(p_partner_id) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM partners WHERE id = p_partner_id) THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NULLIF(btrim(p_email), '') IS NOT NULL AND btrim(p_email) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'bad_email'; END IF;
  IF NULLIF(btrim(p_instagram_url), '') IS NOT NULL AND btrim(p_instagram_url) !~ '^https://' THEN RAISE EXCEPTION 'bad_url'; END IF;
  IF NULLIF(btrim(p_website_url), '') IS NOT NULL AND btrim(p_website_url) !~ '^https?://' THEN RAISE EXCEPTION 'bad_url'; END IF;
  IF NULLIF(btrim(p_logo_url), '') IS NOT NULL AND position(v_img IN p_logo_url) = 0 THEN RAISE EXCEPTION 'bad_image'; END IF;
  IF NULLIF(btrim(p_cover_url), '') IS NOT NULL AND position(v_img IN p_cover_url) = 0 THEN RAISE EXCEPTION 'bad_image'; END IF;
  IF length(COALESCE(p_tagline, '')) > 200 OR length(COALESCE(p_address, '')) > 200 OR length(COALESCE(p_hours, '')) > 100 THEN
    RAISE EXCEPTION 'too_long';
  END IF;

  UPDATE partners SET
    tagline       = CASE WHEN p_tagline IS NULL THEN tagline ELSE NULLIF(btrim(p_tagline), '') END,
    address       = CASE WHEN p_address IS NULL THEN address ELSE NULLIF(btrim(p_address), '') END,
    hours         = CASE WHEN p_hours IS NULL THEN hours ELSE NULLIF(btrim(p_hours), '') END,
    phones        = CASE WHEN p_phones IS NULL THEN phones
                         ELSE NULLIF(ARRAY(SELECT btrim(x) FROM unnest(p_phones) x WHERE btrim(x) <> ''), '{}') END,
    email         = CASE WHEN p_email IS NULL THEN email ELSE NULLIF(btrim(p_email), '') END,
    instagram_url = CASE WHEN p_instagram_url IS NULL THEN instagram_url ELSE NULLIF(btrim(p_instagram_url), '') END,
    website_url   = CASE WHEN p_website_url IS NULL THEN website_url ELSE NULLIF(btrim(p_website_url), '') END,
    logo_url      = CASE WHEN p_logo_url IS NULL THEN logo_url ELSE NULLIF(btrim(p_logo_url), '') END,
    cover_url     = CASE WHEN p_cover_url IS NULL THEN cover_url ELSE NULLIF(btrim(p_cover_url), '') END
   WHERE id = p_partner_id;
  RETURN partner_json(p_partner_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.update_partner_profile(UUID, TEXT, TEXT, TEXT, TEXT[], TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_partner_profile(UUID, TEXT, TEXT, TEXT, TEXT[], TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ── 5. O balde das imagens ──────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('partner-images', 'partner-images', TRUE, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Partner images are publicly accessible" ON storage.objects;
CREATE POLICY "Partner images are publicly accessible" ON storage.objects FOR SELECT
  USING (bucket_id = 'partner-images');
DROP POLICY IF EXISTS "Partner managers can upload partner images" ON storage.objects;
CREATE POLICY "Partner managers can upload partner images" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'partner-images' AND is_partner_manager_folder((storage.foldername(name))[1]));
DROP POLICY IF EXISTS "Partner managers can update partner images" ON storage.objects;
CREATE POLICY "Partner managers can update partner images" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'partner-images' AND is_partner_manager_folder((storage.foldername(name))[1]));
DROP POLICY IF EXISTS "Partner managers can delete partner images" ON storage.objects;
CREATE POLICY "Partner managers can delete partner images" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'partner-images' AND is_partner_manager_folder((storage.foldername(name))[1]));

-- ── 6. A entrega no dia 1 ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.partner_month_issues (
  partner_id UUID NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  month      DATE NOT NULL,
  issued     INTEGER NOT NULL,
  issued_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (partner_id, month)
);
ALTER TABLE public.partner_month_issues ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.partner_month_issues FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.process_partner_month_vouchers()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_now  DATE := ranking_current_month();
  p      RECORD;
  m      DATE;
  n      INTEGER;
  v_tot  INTEGER := 0;
BEGIN
  -- Só com o interruptor «parceiros» ligado (sem linha = desligado).
  IF NOT COALESCE((SELECT enabled FROM feature_flags WHERE key = 'parceiros'), FALSE) THEN RETURN 0; END IF;
  FOR p IN SELECT * FROM partners WHERE active AND district IS NOT NULL AND prizes_from IS NOT NULL LOOP
    m := p.prizes_from;
    -- Cada mês já acabado, dentro do acordo, ainda por entregar.
    WHILE m < v_now AND (p.prizes_until IS NULL OR m <= p.prizes_until) LOOP
      IF NOT EXISTS (SELECT 1 FROM partner_month_issues WHERE partner_id = p.id AND month = m) THEN
        n := issue_partner_month_vouchers(p.id, m);
        INSERT INTO partner_month_issues (partner_id, month, issued) VALUES (p.id, m, n);
        -- A quem ganhou (sem o código no aviso: vê-o em «Os meus vouchers»).
        INSERT INTO notifications (user_id, kind, data)
        SELECT v.user_id, 'partner_prize_won',
               jsonb_build_object('voucher_id', v.id, 'partner_id', p.id, 'partner_slug', p.slug, 'partner_name', p.name,
                                  'prize_place', v.prize_place, 'discount_pct', v.discount_pct,
                                  'prize_month', v.prize_month, 'prize_district', v.prize_district, 'valid_until', v.valid_until)
          FROM vouchers v WHERE v.partner_id = p.id AND v.prize_month = m;
        -- A quem gere o parceiro.
        INSERT INTO notifications (user_id, kind, data)
        SELECT pm.user_id, 'partner_month_vouchers',
               jsonb_build_object('partner_id', p.id, 'partner_slug', p.slug, 'partner_name', p.name, 'month', m, 'issued', n)
          FROM partner_managers pm WHERE pm.partner_id = p.id;
        v_tot := v_tot + n;
      END IF;
      m := (m + interval '1 month')::date;
    END LOOP;
  END LOOP;
  RETURN v_tot;
END;
$function$;
REVOKE ALL ON FUNCTION public.process_partner_month_vouchers() FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'process-partner-month-vouchers';
SELECT cron.schedule('process-partner-month-vouchers', '17 * * * *', 'SELECT public.process_partner_month_vouchers()');

COMMIT;

-- Verificar depois de correr:
--   SELECT count(*) FROM cron.job WHERE jobname = 'process-partner-month-vouchers';           -- 1
--   SELECT public FROM storage.buckets WHERE id = 'partner-images';                            -- true
--   SELECT has_function_privilege('anon', 'public.partner_redeem_voucher(text)', 'EXECUTE');    -- false
--   SELECT has_table_privilege('authenticated', 'public.partner_month_issues', 'SELECT');      -- false
