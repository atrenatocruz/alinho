-- ═════════════════════════════════════════════════════════════════════════
-- Avisos por ler que deixam de fazer sentido: mix cancelado ou em rascunho,
-- e pedido de entrada já decidido
--
-- PORQUÊ. Revisão do PO, 13 out, ponto 5 (Dev 3): cancelar um mix ou
-- voltá-lo a rascunho deixava por ler os avisos antigos desse mix («entrou
-- no mix», «subiste da lista de espera», «há um lugar livre»…), que levavam
-- a um mix que já não existe para o jogador. E o aviso «pediu para entrar»
-- dos admins ficava por ler depois de alguém já ter aceitado ou recusado.
-- Em produção, a 14 out: 10 avisos assim. Puxado pelo PO para sexta 16.
--
-- O QUE FAZ
--   1. Quando um mix passa a 'cancelled' ou 'draft', os avisos por ler
--      desse mix passam a lidos, menos os que explicam o que aconteceu:
--      mix_cancelled, mix_cancelled_not_filled, mix_unpublished,
--      mix_not_filled e mix_not_finished.
--   2. Quando um pedido de entrada deixa de estar 'requested' (aceite,
--      recusado, ou a linha sai), o aviso 'mix_join_request' desse pedido
--      passa a lido para todos os admins.
--   3. Uma vez, os que já estão nessa situação (produção: 10 e 0).
--
-- Dev 3, 14 out 2026 · ecrãs: nenhum muda
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Mix cancelado ou em rascunho ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.games_close_stale_notices()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  UPDATE notifications SET read_at = TIMEZONE('utc', NOW())
   WHERE game_id = NEW.id AND read_at IS NULL
     AND kind NOT IN ('mix_cancelled', 'mix_cancelled_not_filled', 'mix_unpublished', 'mix_not_filled', 'mix_not_finished');
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.games_close_stale_notices() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS games_close_stale_notices ON games;
CREATE TRIGGER games_close_stale_notices
  AFTER UPDATE OF status ON games
  FOR EACH ROW
  WHEN (NEW.status IN ('cancelled', 'draft') AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.games_close_stale_notices();

-- ── 2. Pedido de entrada já decidido ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.participants_close_join_request_notice()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  UPDATE notifications SET read_at = TIMEZONE('utc', NOW())
   WHERE kind = 'mix_join_request' AND read_at IS NULL
     AND game_id = OLD.game_id AND data->>'participant_id' = OLD.id::text;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.participants_close_join_request_notice() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS participants_close_join_request_notice_upd ON participants;
CREATE TRIGGER participants_close_join_request_notice_upd
  AFTER UPDATE OF status ON participants
  FOR EACH ROW
  WHEN (OLD.status = 'requested' AND NEW.status IS DISTINCT FROM 'requested')
  EXECUTE FUNCTION public.participants_close_join_request_notice();

DROP TRIGGER IF EXISTS participants_close_join_request_notice_del ON participants;
CREATE TRIGGER participants_close_join_request_notice_del
  AFTER DELETE ON participants
  FOR EACH ROW
  WHEN (OLD.status = 'requested')
  EXECUTE FUNCTION public.participants_close_join_request_notice();

-- ── 3. Os que já estão assim ────────────────────────────────────────────
UPDATE notifications n SET read_at = TIMEZONE('utc', NOW())
  FROM games g
 WHERE g.id = n.game_id AND n.read_at IS NULL AND g.status IN ('cancelled', 'draft')
   AND n.kind NOT IN ('mix_cancelled', 'mix_cancelled_not_filled', 'mix_unpublished', 'mix_not_filled', 'mix_not_finished');

UPDATE notifications n SET read_at = TIMEZONE('utc', NOW())
 WHERE n.kind = 'mix_join_request' AND n.read_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM participants p WHERE p.id::text = n.data->>'participant_id' AND p.status = 'requested');

COMMIT;

-- Verificar depois de correr (0 e 0):
--   SELECT count(*) FROM notifications n JOIN games g ON g.id = n.game_id
--    WHERE n.read_at IS NULL AND g.status IN ('cancelled', 'draft')
--      AND n.kind NOT IN ('mix_cancelled', 'mix_cancelled_not_filled', 'mix_unpublished', 'mix_not_filled', 'mix_not_finished');
--   SELECT count(*) FROM notifications n WHERE n.kind = 'mix_join_request' AND n.read_at IS NULL
--      AND NOT EXISTS (SELECT 1 FROM participants p WHERE p.id::text = n.data->>'participant_id' AND p.status = 'requested');
