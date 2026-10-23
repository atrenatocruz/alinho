-- ═════════════════════════════════════════════════════════════════════════
-- Parceiros 4: o parceiro muda também o nome e o tipo na sua ficha
--
-- PORQUÊ. Decisão do Francisco a 22 out (via PO): o parceiro gere tudo na
-- sua página menos os prémios (percentagens, meses, prizes_from/until) e a
-- zona (city/district: decide em que pódio aparece o prémio). A
-- update_partner_profile da parceiros_3 não deixava mudar o nome.
--
-- O QUE FAZ. update_partner_profile ganha p_name e p_kind_label no fim (os
-- outros parâmetros ficam iguais e na mesma ordem):
--   · p_name: NULL = fica; '' dá 'name_required' (o nome é obrigatório);
--     até 80 letras.
--   · p_kind_label (ex.: «Fisioterapia»): NULL = fica; '' = apaga; até 60.
-- Continuam fora: slug (os links), code_prefix, is_founder, active, prémios e
-- zona.
--
-- COMPATIBILIDADE. A assinatura antiga (10 parâmetros) só existe no
-- alinho-dev (a parceiros_3 ainda não correu em produção) e nenhuma app nas
-- lojas a usa, por isso sai com DROP: se ficassem as duas, uma chamada com
-- parâmetros por nome ficava ambígua. Quem chama sem p_name/p_kind_label
-- continua a funcionar.
-- ORDEM. Depois de migration_parceiros_3_pagina_do_parceiro.sql.
--
-- Dev 3, 22 out 2026 · ecrã: Dev 4
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.is_partner_manager(uuid)') IS NULL THEN RAISE EXCEPTION 'Falta migration_parceiros_3_pagina_do_parceiro.sql. Parar.'; END IF;
END $$;

DROP FUNCTION IF EXISTS public.update_partner_profile(UUID, TEXT, TEXT, TEXT, TEXT[], TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE FUNCTION public.update_partner_profile(
  p_partner_id UUID, p_tagline TEXT DEFAULT NULL, p_address TEXT DEFAULT NULL, p_hours TEXT DEFAULT NULL,
  p_phones TEXT[] DEFAULT NULL, p_email TEXT DEFAULT NULL, p_instagram_url TEXT DEFAULT NULL,
  p_website_url TEXT DEFAULT NULL, p_logo_url TEXT DEFAULT NULL, p_cover_url TEXT DEFAULT NULL,
  p_name TEXT DEFAULT NULL, p_kind_label TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_img TEXT := '/storage/v1/object/public/partner-images/' || p_partner_id::text || '/';
BEGIN
  IF NOT is_partner_manager(p_partner_id) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM partners WHERE id = p_partner_id) THEN RAISE EXCEPTION 'not_found'; END IF;
  IF p_name IS NOT NULL AND btrim(p_name) = '' THEN RAISE EXCEPTION 'name_required'; END IF;
  IF NULLIF(btrim(p_email), '') IS NOT NULL AND btrim(p_email) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'bad_email'; END IF;
  IF NULLIF(btrim(p_instagram_url), '') IS NOT NULL AND btrim(p_instagram_url) !~ '^https://' THEN RAISE EXCEPTION 'bad_url'; END IF;
  IF NULLIF(btrim(p_website_url), '') IS NOT NULL AND btrim(p_website_url) !~ '^https?://' THEN RAISE EXCEPTION 'bad_url'; END IF;
  IF NULLIF(btrim(p_logo_url), '') IS NOT NULL AND position(v_img IN p_logo_url) = 0 THEN RAISE EXCEPTION 'bad_image'; END IF;
  IF NULLIF(btrim(p_cover_url), '') IS NOT NULL AND position(v_img IN p_cover_url) = 0 THEN RAISE EXCEPTION 'bad_image'; END IF;
  IF length(COALESCE(p_tagline, '')) > 200 OR length(COALESCE(p_address, '')) > 200 OR length(COALESCE(p_hours, '')) > 100
     OR length(btrim(COALESCE(p_name, ''))) > 80 OR length(btrim(COALESCE(p_kind_label, ''))) > 60 THEN
    RAISE EXCEPTION 'too_long';
  END IF;

  UPDATE partners SET
    name          = CASE WHEN p_name IS NULL THEN name ELSE btrim(p_name) END,
    kind_label    = CASE WHEN p_kind_label IS NULL THEN kind_label ELSE NULLIF(btrim(p_kind_label), '') END,
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
REVOKE ALL ON FUNCTION public.update_partner_profile(UUID, TEXT, TEXT, TEXT, TEXT[], TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_partner_profile(UUID, TEXT, TEXT, TEXT, TEXT[], TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

COMMIT;

-- Verificar depois de correr (1 função, 12 parâmetros, anon sem EXECUTE):
--   SELECT pronargs, has_function_privilege('anon', oid, 'EXECUTE') AS anon
--     FROM pg_proc WHERE proname = 'update_partner_profile';
