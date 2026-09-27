-- ═════════════════════════════════════════════════════════════════════════
-- Vouchers: usam-se sempre, com ou sem partilhar o contacto
--
-- PORQUÊ. Decisão do Francisco a 27 set (pelo PO): «Não queremos obrigar a
-- ter a app.» Os vouchers usam-se sempre na receção, também por quem não
-- tem conta ou recusou partilhar o contacto; a partilha serve só para o
-- contacto (o que ficou decidido a 25 set: «quem recusar usa o voucher na
-- mesma»). migration_vouchers_contacto_e_lista.sql tinha posto a trava
-- 'contact_not_shared' no admin_redeem_voucher e no mark_voucher_used —
-- sai das duas.
--
-- O QUE FAZ. Tira do corpo VIVO das duas o bloco que recusava sem acordo
-- (cada um tem de aparecer 1 vez; diz «já estava» se já não estiver lá):
--   · admin_redeem_voucher («Dar baixa» / QR do admin): qualquer voucher
--     do clube, também de convidados sem conta;
--   · mark_voucher_used («Usar» do próprio jogador).
-- Não muda: a lista do admin (list_club_vouchers) continua a mostrar o
-- contacto só a quem aceitou partilhar; share/unshare_voucher_contact.
-- Ecrã: Dev 1 («Dar baixa» e «Usar» sempre; «Ver e aceitar» como convite).
--
-- Dev 3, 27 set 2026 · depois de migration_vouchers_contacto_e_lista.sql
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  c_mau CONSTANT TEXT := '\s*-- Sem acordo de partilhar o contacto, não se dá baixa \(#556, 27 set\)\.\s*IF EXISTS \(SELECT 1 FROM vouchers WHERE id = p_voucher_id\s+AND status = ''por_usar'' AND contact_shared_at IS NULL\) THEN\s*RAISE EXCEPTION ''contact_not_shared'';\s*END IF;';
  v_def TEXT := pg_get_functiondef('public.admin_redeem_voucher(uuid)'::regprocedure);
  v_n   INTEGER;
BEGIN
  IF v_def NOT LIKE '%contact_not_shared%' THEN
    RAISE NOTICE 'admin_redeem_voucher: já estava (sem a trava)';
    RETURN;
  END IF;
  SELECT count(*) INTO v_n FROM regexp_matches(v_def, c_mau, 'g');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'admin_redeem_voucher: esperava a trava do contacto 1 vez, encontrei %. Parar e ler.', v_n;
  END IF;
  v_def := regexp_replace(v_def, c_mau, '');
  IF v_def LIKE '%contact_not_shared%' THEN
    RAISE EXCEPTION 'admin_redeem_voucher: a trava continua lá depois da troca. Parar e ler.';
  END IF;
  EXECUTE v_def;
END $$;

DO $$
DECLARE
  c_mau CONSTANT TEXT := '\s*-- Sem acordo de partilhar o contacto, não se usa \(#556, 27 set\)\.\s*IF EXISTS \(SELECT 1 FROM vouchers WHERE id = p_voucher_id AND user_id = auth\.uid\(\)\s+AND status = ''por_usar'' AND contact_shared_at IS NULL\) THEN\s*RAISE EXCEPTION ''contact_not_shared'';\s*END IF;';
  v_def TEXT := pg_get_functiondef('public.mark_voucher_used(uuid)'::regprocedure);
  v_n   INTEGER;
BEGIN
  IF v_def NOT LIKE '%contact_not_shared%' THEN
    RAISE NOTICE 'mark_voucher_used: já estava (sem a trava)';
    RETURN;
  END IF;
  SELECT count(*) INTO v_n FROM regexp_matches(v_def, c_mau, 'g');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'mark_voucher_used: esperava a trava do contacto 1 vez, encontrei %. Parar e ler.', v_n;
  END IF;
  v_def := regexp_replace(v_def, c_mau, '');
  IF v_def LIKE '%contact_not_shared%' THEN
    RAISE EXCEPTION 'mark_voucher_used: a trava continua lá depois da troca. Parar e ler.';
  END IF;
  EXECUTE v_def;
END $$;

-- CREATE OR REPLACE mantém as permissões; reforça-se a regra do #367.
REVOKE ALL ON FUNCTION public.admin_redeem_voucher(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_redeem_voucher(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_redeem_voucher(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.mark_voucher_used(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_voucher_used(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_voucher_used(UUID) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_functiondef('public.admin_redeem_voucher(uuid)'::regprocedure) NOT LIKE '%contact_not_shared%';  -- true
--   SELECT pg_get_functiondef('public.admin_redeem_voucher(uuid)'::regprocedure) LIKE '%Apenas admins podem validar este voucher%';  -- true
--   SELECT pg_get_functiondef('public.mark_voucher_used(uuid)'::regprocedure) NOT LIKE '%contact_not_shared%';  -- true
--   SELECT has_function_privilege('anon', 'public.admin_redeem_voucher(uuid)', 'EXECUTE');  -- false
