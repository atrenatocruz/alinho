-- ═════════════════════════════════════════════════════════════════════════
-- Vouchers no Gerir: dizer quem é a pessoa (user_id)
--
-- PORQUÊ. Bugs, 7 out: o «Por pessoa» dos vouchers no Gerir (aprovado pelo
-- Francisco a 7 out, design-handoff/2026-10-07-vouchers-no-gerir, ponto 7)
-- junta os vouchers da mesma pessoa. A list_club_vouchers só mandava o
-- nome, e duas pessoas com o mesmo nome e sem contacto ficavam juntas.
--
-- O QUE FAZ. list_club_vouchers ganha a coluna user_id (o dono do voucher),
-- no fim. Muda o que devolve → DROP + CREATE a partir do corpo VIVO (só se
-- juntam a coluna e o v.user_id; o resto fica igual), com o REVOKE a
-- PUBLIC e a anon, como estava (só authenticated).
--
-- Dev 3, 7 out 2026 · ecrã: Bugs
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  c_tipo_mau CONSTANT TEXT := '(email text, phone text)\)';
  c_tipo_bom CONSTANT TEXT := '\1, user_id uuid)';
  c_sel_mau  CONSTANT TEXT := '(NULL::text)([[:space:]]+FROM vouchers v)';
  c_sel_bom  CONSTANT TEXT := '\1, v.user_id\2';
  v_def TEXT := pg_get_functiondef('public.list_club_vouchers(uuid)'::regprocedure);
BEGIN
  IF pg_get_function_result('public.list_club_vouchers(uuid)'::regprocedure) LIKE '%user_id uuid%' THEN
    RAISE NOTICE 'list_club_vouchers: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_tipo_mau, 'g')) <> 1
     OR (SELECT count(*) FROM regexp_matches(v_def, c_sel_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'list_club_vouchers: os pedaços a trocar não aparecem 1 vez. Parar e ler.';
  END IF;
  v_def := regexp_replace(v_def, c_tipo_mau, c_tipo_bom);
  v_def := regexp_replace(v_def, c_sel_mau, c_sel_bom);
  DROP FUNCTION public.list_club_vouchers(uuid);
  EXECUTE v_def;
END $$;

REVOKE ALL ON FUNCTION public.list_club_vouchers(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_club_vouchers(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_club_vouchers(uuid) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_function_result('public.list_club_vouchers(uuid)'::regprocedure) LIKE '%user_id uuid%';  -- true
--   SELECT has_function_privilege('anon', 'public.list_club_vouchers(uuid)', 'EXECUTE');  -- false
