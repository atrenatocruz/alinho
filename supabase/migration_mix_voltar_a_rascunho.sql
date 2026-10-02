-- ═════════════════════════════════════════════════════════════════════════
-- Mix: «Voltar a rascunho»
--
-- PORQUÊ. Pedido do Francisco (via PO e Dev 4, 30 set): no «Mais ⋯» da
-- página do mix tem de haver «Voltar a rascunho» — o caminho ao contrário
-- do publishDraftMix. Regras confirmadas pelo PO (2 out). Pacote do mix
-- (design-handoff/2026-09-30-mix-ver-e-marcar/PACOTE.md, ponto 6, opção c:
-- só antes do anúncio do robô). Ecrã: Dev 2. NÃO enviar antes de o PO dizer
-- que o main saiu e de o Francisco aprovar as prints (PO, 2 out).
--
-- O QUE FAZ. unpublish_mix(p_game_id) → 'draft'.
--   · Só o admin do clube ou grupo ('not_allowed').
--   · Só um mix publicado que ainda não começou: aberto, ou publicado para
--     abrir mais tarde (pending com launch_at), com a data no futuro
--     ('not_published' / 'already_started').
--   · Sem ninguém inscrito, nem confirmado nem em espera ('has_players').
--   · Só antes do anúncio do robô ('already_announced'): o robô põe o
--     cartão no grupo LOGO que o mix abre (whatsapp-bot/src/sync.js — as
--     horas do whatsapp_post_times são só os lembretes). Por isso: um mix
--     aberto num clube com grupo de WhatsApp ligado já foi anunciado; o
--     publicado para abrir mais tarde (pending) e o de um clube sem grupo
--     ainda podem voltar.
--   · Numa série, só esta data: as outras continuam como estão.
--   · Fica 'draft' e sem launch_at (não abre sozinho); as horas do WhatsApp
--     ficam guardadas, e o robô não anuncia rascunhos.
--
-- Dev 3, 2 out 2026 · ecrã: Dev 2
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.unpublish_mix(p_game_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  g games%ROWTYPE;
BEGIN
  SELECT * INTO g FROM games WHERE id = p_game_id FOR UPDATE;
  IF g.id IS NULL OR auth.uid() IS NULL OR NOT is_org_admin(g.organization_id) THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  IF NOT (g.status = 'open' OR (g.status = 'pending' AND g.launch_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'not_published';
  END IF;
  IF g.date IS NULL OR g.date <= NOW() THEN
    RAISE EXCEPTION 'already_started';
  END IF;
  IF EXISTS (SELECT 1 FROM participants WHERE game_id = g.id AND status IN ('confirmed', 'waitlisted')) THEN
    RAISE EXCEPTION 'has_players';
  END IF;
  IF g.status = 'open' AND (
       EXISTS (SELECT 1 FROM whatsapp_groups wg WHERE wg.organization_id = g.organization_id)
       OR EXISTS (SELECT 1 FROM organizations o WHERE o.id = g.organization_id AND NULLIF(o.whatsapp_group_jid, '') IS NOT NULL)) THEN
    RAISE EXCEPTION 'already_announced';
  END IF;

  -- A trava games_draft_one_way (25 set) só deixa passar este caminho.
  PERFORM set_config('alinho.unpublish_mix', 'on', true);
  UPDATE games SET status = 'draft', launch_at = NULL, updated_at = NOW() WHERE id = g.id;
  PERFORM set_config('alinho.unpublish_mix', '', true);
  RETURN 'draft';
END;
$function$;

-- A trava de 25 set («um mix publicado não volta a rascunho») continua para
-- tudo o resto (update direto à tabela); só o unpublish_mix, com as suas
-- regras, passa (corpo VIVO, 1 troca; «já estava»).
DO $$
DECLARE
  c_mau CONSTANT TEXT := 'IF NEW\.status = ''draft'' AND OLD\.status IS DISTINCT FROM ''draft'' THEN';
  c_bom CONSTANT TEXT := 'IF NEW.status = ''draft'' AND OLD.status IS DISTINCT FROM ''draft''
     AND COALESCE(current_setting(''alinho.unpublish_mix'', true), '''') <> ''on'' THEN';
  v_def TEXT := pg_get_functiondef('public.games_draft_one_way()'::regprocedure);
BEGIN
  IF v_def LIKE '%alinho.unpublish_mix%' THEN
    RAISE NOTICE 'games_draft_one_way: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'games_draft_one_way: o pedaço a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE regexp_replace(v_def, c_mau, c_bom);
END $$;
REVOKE EXECUTE ON FUNCTION public.games_draft_one_way() FROM anon, authenticated, PUBLIC;
REVOKE ALL ON FUNCTION public.unpublish_mix(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.unpublish_mix(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.unpublish_mix(UUID) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT has_function_privilege('anon', 'public.unpublish_mix(uuid)', 'EXECUTE');  -- false
