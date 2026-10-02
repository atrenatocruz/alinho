-- ═════════════════════════════════════════════════════════════════════════
-- Torneio: o organizador junta duas pessoas que se inscreveram sozinhas
--
-- PORQUÊ. QA, 2 out (importante para o Smash Cup): duas pessoas inscritas
-- sozinhas («Procuro parceiro», 'sem_parceiro') não se juntavam. O «Juntar
-- parceiro» do organizador (tournament_admin_set_partner) recusava com
-- 'partner_already_in_category', porque a escolhida já tem a sua inscrição
-- sozinha na categoria. Juntar quem procura parceiro é a razão do botão.
--
-- O QUE FAZ. Em tournament_admin_set_partner (corpo VIVO, 1 troca; «já
-- estava»): se a pessoa escolhida como parceiro tiver, nesta categoria,
-- uma inscrição sozinha à espera de parceiro ('sem_parceiro', sem ninguém
-- como parceiro), essa inscrição passa a 'desistiu' (fica como história) e
-- a pessoa entra como parceiro. Inscrita com outra pessoa continua a
-- recusar ('partner_already_in_category'). Tudo o resto igual.
--
-- Dev 3, 2 out 2026 · pedido do QA · ecrã: Dev 1
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  c_mau CONSTANT TEXT := '(  IF p_partner_id IS NOT NULL\s+AND tournament_person_in_category\(v_entry\.category_id, p_partner_id, p_entry_id\) THEN)';
  c_bom CONSTANT TEXT := '  -- Quem se inscreveu sozinho («Procuro parceiro») e é escolhido como
  -- parceiro: a inscrição sozinha junta-se a esta (QA, 2 out).
  IF p_partner_id IS NOT NULL THEN
    UPDATE tournament_entries SET status = ''desistiu''
     WHERE category_id = v_entry.category_id AND id <> p_entry_id
       AND player1_id = p_partner_id AND player2_id IS NULL AND guest_name IS NULL
       AND status = ''sem_parceiro'';
  END IF;
\1';
  v_def TEXT := pg_get_functiondef('public.tournament_admin_set_partner(uuid, uuid, text, text, text)'::regprocedure);
BEGIN
  IF v_def LIKE '%Procuro parceiro%' THEN
    RAISE NOTICE 'tournament_admin_set_partner: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'tournament_admin_set_partner: o pedaço a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE regexp_replace(v_def, c_mau, c_bom);
END $$;

REVOKE ALL ON FUNCTION public.tournament_admin_set_partner(uuid, uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tournament_admin_set_partner(uuid, uuid, text, text, text) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_functiondef('public.tournament_admin_set_partner(uuid,uuid,text,text,text)'::regprocedure) LIKE '%Procuro parceiro%';  -- true
