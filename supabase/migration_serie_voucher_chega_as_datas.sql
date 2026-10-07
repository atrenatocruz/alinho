-- ═════════════════════════════════════════════════════════════════════════
-- Série: ligar (ou mudar) o voucher chega às datas já criadas
--
-- PORQUÊ. Francisco, 7 out: o «Mix M4 · Terça» da A2N de 6 out terminou sem
-- vouchers. A data foi criada com a série (25 set), com o voucher
-- desligado. Quando se ligou o voucher no Editar do mix de origem, o
-- updateRecurrence (GerirClube.jsx) gravou a série e a origem, mas não as
-- datas já criadas («already-created Mixes are never touched»). Ficaram com
-- o mesmo problema o M3 de 7 out e o +1 de 12 out.
--
-- O QUE FAZ. Gatilho na game_recurrences: quando o has_voucher ou o prize
-- da série MUDAM, passam às datas da série ainda por jogar (rascunho, por
-- abrir, aberta ou cheia, com a hora no futuro), só a coluna que mudou. As
-- datas jogadas ficam como estão. Um «Mudar só este mix» feito antes numa
-- data é substituído pela mudança seguinte da série, como acontece com as
-- horas do WhatsApp (set_event_whatsapp_post_times).
--
-- Dev 3, 7 out 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.game_recurrences_push_voucher()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.has_voucher IS DISTINCT FROM OLD.has_voucher THEN
    UPDATE games SET has_voucher = NEW.has_voucher, updated_at = NOW()
     WHERE recurrence_id = NEW.id AND date > NOW()
       AND status IN ('draft', 'pending', 'open', 'closed')
       AND has_voucher IS DISTINCT FROM NEW.has_voucher;
  END IF;
  IF NEW.prize IS DISTINCT FROM OLD.prize THEN
    UPDATE games SET prize = NEW.prize, updated_at = NOW()
     WHERE recurrence_id = NEW.id AND date > NOW()
       AND status IN ('draft', 'pending', 'open', 'closed')
       AND prize IS DISTINCT FROM NEW.prize;
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.game_recurrences_push_voucher() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS game_recurrences_push_voucher_trigger ON game_recurrences;
CREATE TRIGGER game_recurrences_push_voucher_trigger
  AFTER UPDATE OF has_voucher, prize ON game_recurrences
  FOR EACH ROW EXECUTE FUNCTION game_recurrences_push_voucher();

COMMIT;

-- Verificar depois de correr:
--   SELECT count(*) FROM pg_trigger WHERE tgname = 'game_recurrences_push_voucher_trigger';  -- 1
