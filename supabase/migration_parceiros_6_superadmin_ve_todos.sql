-- ═════════════════════════════════════════════════════════════════════════
-- Parceiros 6: o superadmin vê e edita a página de qualquer parceiro
--
-- PORQUÊ. O Francisco (28 out, pelo PO e pelo Dev 4): o superadmin tem de
-- ver e editar a página de qualquer parceiro (Gerir › Parceiros e
-- /gerir/parceiro/:slug), como a Rita na da RM Terapias.
--
-- O QUE JÁ ESTAVA (produção e alinho-dev, 28 out). is_partner_manager já
-- deixa o superadmin entrar (is_platform_admin_me = superadmin com o modo
-- ligado). Por isso partner_list_vouchers, partner_redeem_voucher,
-- update_partner_profile e as fotos (is_partner_manager_folder, no storage)
-- já o aceitam. get_partner é público.
--
-- O QUE FALTAVA. my_managed_partners (a lista do Gerir e o «pode entrar» da
-- página) só olhava para partner_managers. Passa a devolver também todos os
-- parceiros ativos a quem é superadmin com o modo ligado. Mesma forma
-- ({id, slug, name, logo_url}, por nome), por isso os ecrãs não mudam.
--
-- COMO. Emenda por texto ao corpo vivo (1 vez, ou «já estava»). CREATE OR
-- REPLACE mantém os GRANT (só authenticated); repete-se o REVOKE por
-- segurança.
--
-- ORDEM. Depois da migration_parceiros_3_pagina_do_parceiro.sql. Qualquer
-- ordem em relação às outras.
--
-- Dev 3, 28 out 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  v_def TEXT;
  v_n   INT;
  v_old TEXT := E'    FROM partners p JOIN partner_managers m ON m.partner_id = p.id\n   WHERE m.user_id = auth.uid() AND p.active;';
  v_new TEXT := E'    FROM partners p\n   WHERE p.active\n     AND (EXISTS (SELECT 1 FROM partner_managers m WHERE m.partner_id = p.id AND m.user_id = auth.uid())\n          OR COALESCE(is_platform_admin_me(), FALSE));';
BEGIN
  v_def := replace(pg_get_functiondef('public.my_managed_partners()'::regprocedure), E'\r', '');
  IF position('is_platform_admin_me' IN v_def) > 0 THEN
    RAISE NOTICE 'my_managed_partners já estava';
    RETURN;
  END IF;
  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'my_managed_partners: esperava 1 vez o FROM/WHERE, encontrei %. Parar.', v_n;
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END $$;

REVOKE EXECUTE ON FUNCTION public.my_managed_partners() FROM PUBLIC, anon;

COMMIT;

-- Verificar depois de correr:
--   SELECT position('is_platform_admin_me' IN prosrc) > 0, proacl FROM pg_proc
--    WHERE proname = 'my_managed_partners';
--   → true, e o proacl igual ao de antes (authenticated, sem anon).
