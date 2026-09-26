-- ════════════════════════════════════════════════════════════════════════
-- Migration: quem estava inscrito num mix cancelado recebe um aviso no sino
-- (ações do evento, desenho aprovado pelo Francisco a 26 set 2026 —
-- design-handoff/2026-09-26-acoes-do-evento: «Cancelar este mix … avisamos
-- quem estava inscrito»).
--
-- Até aqui, ao cancelar, só o robô avisava o grupo de WhatsApp (sync.js, ao
-- ver games.status passar a 'cancelled'); quem estava inscrito não recebia
-- nada na app.
--
-- O que faz: um gatilho em games que, quando o estado PASSA a 'cancelled',
-- escreve um aviso 'mix_cancelled' na tabela notifications a cada inscrito
-- (confirmado ou em lista de espera, ele e o parceiro), menos a quem
-- cancelou. Guarda o título e a data do mix no momento (como os outros
-- avisos de mix), para o sino não ter de voltar a ler o jogo.
--
-- O robô NÃO manda estes avisos por mensagem privada: o mixNotices.js só lê
-- 'mix_joined', 'mix_removed' e 'mix_partner_changed'. Não mexe no robô.
--
-- Independente das outras migrações por correr. Não redefine nenhuma função
-- que já exista (notify_mix_cancelled é nova). Corre-o o System Integrator
-- (regra de 25 set), anunciado no #dev-updates.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.notify_mix_cancelled()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  INSERT INTO notifications (user_id, kind, game_id, actor_id, data)
  SELECT DISTINCT who.user_id, 'mix_cancelled', NEW.id, auth.uid(),
         jsonb_build_object('game_title', NEW.title, 'game_date', NEW.date)
    FROM (
      SELECT p.user_id FROM participants p
       WHERE p.game_id = NEW.id AND p.status IN ('confirmed', 'waitlisted')
      UNION
      SELECT p.partner_id FROM participants p
       WHERE p.game_id = NEW.id AND p.status IN ('confirmed', 'waitlisted')
    ) who
   WHERE who.user_id IS NOT NULL
     AND who.user_id IS DISTINCT FROM auth.uid();
  RETURN NEW;
END;
$function$;

-- Só o gatilho a chama; ninguém a chama à mão.
REVOKE EXECUTE ON FUNCTION public.notify_mix_cancelled() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS games_notify_mix_cancelled ON games;
CREATE TRIGGER games_notify_mix_cancelled
  AFTER UPDATE OF status ON games
  FOR EACH ROW
  WHEN (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled')
  EXECUTE FUNCTION public.notify_mix_cancelled();

-- ── Verificação: pára se alguma coisa não ficou como devia ─────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'games_notify_mix_cancelled' AND tgrelid = 'public.games'::regclass AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'O gatilho games_notify_mix_cancelled não ficou criado.';
  END IF;
  IF has_function_privilege('anon', 'public.notify_mix_cancelled()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.notify_mix_cancelled()', 'EXECUTE') THEN
    RAISE EXCEPTION 'notify_mix_cancelled ficou executável por anon/authenticated.';
  END IF;
END;
$$;

COMMIT;

-- Verificar depois (só leitura):
-- SELECT n.created_at, n.user_id, n.kind, n.data FROM notifications n
--  WHERE n.kind = 'mix_cancelled' ORDER BY n.created_at DESC LIMIT 20;
