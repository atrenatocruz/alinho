-- ═════════════════════════════════════════════════════════════════════════
-- Mix: suplentes por ordem, com aviso; menos campos → os últimos a suplentes
--
-- PORQUÊ. Pacote do mix aprovado pelo Francisco a 2 out (design-handoff/
-- 2026-09-30-mix-ver-e-marcar/PACOTE.md, pontos 4 e 5 [D3]). Ecrã: Dev 2.
-- Só vai para o dev depois de o Francisco aprovar as prints (PO, 2 out).
--
-- O QUE FAZ
--   4. Suplente por ordem: já existe (promote_waitlist sobe o 1.º por ordem
--      de chegada quando alguém sai). Junta-se o aviso na app: quem passa de
--      suplente a confirmado (e o parceiro) recebe 'mix_promoted'
--      {game_title, game_date} (as chaves do aviso 'mix_cancelled'). O
--      registo do robô (participant_events) fica como está.
--   5. «Mudar só este mix» muda também o número de campos: quando num_courts
--      ou max_players mudam num mix aberto que ainda não começou,
--        · com mais confirmados do que lugares, os ÚLTIMOS a entrar passam a
--          suplentes (uma dupla conta 2 e desce inteira) e recebem
--          'mix_moved_to_waitlist' {game_title, game_date};
--        · com mais lugares, os suplentes já sobem hoje sozinhos (trigger
--          game_capacity_increase_trigger → promote_waitlist), e agora
--          recebem o aviso do ponto 4.
--      Ao descer, não se chama o promote_waitlist: subiria logo quem acabou
--      de descer. Se ficar um lugar vago (por causa de uma dupla), o mix
--      volta a 'open'.
--      Vale também para o mix que não encheu e voltou a rascunho à hora do
--      jogo (unfilled_at, migration_mix_nao_encheu.sql): é aí que quem
--      organiza «tira campos para jogar com quem há».
--
-- Dev 3, 2 out 2026 · ecrã: Dev 2
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- A coluna nasce na migration_mix_nao_encheu.sql; aqui só para esta poder
-- correr primeiro sem partir.
ALTER TABLE games ADD COLUMN IF NOT EXISTS unfilled_at TIMESTAMPTZ;

-- ── 4. Aviso a quem sobe de suplente ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.participants_promoted_notice()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_data JSONB;
BEGIN
  SELECT jsonb_build_object('game_title', g.title, 'game_date', g.date) INTO v_data
    FROM games g WHERE g.id = NEW.game_id;
  INSERT INTO notifications (user_id, kind, game_id, data)
  SELECT u, 'mix_promoted', NEW.game_id, v_data
    FROM unnest(ARRAY[NEW.user_id, NEW.partner_id]) AS u
   WHERE u IS NOT NULL;
  RETURN NULL;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.participants_promoted_notice() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS participants_promoted_notice_trigger ON participants;
CREATE TRIGGER participants_promoted_notice_trigger
  AFTER UPDATE OF status ON participants
  FOR EACH ROW
  WHEN (OLD.status = 'waitlisted' AND NEW.status = 'confirmed')
  EXECUTE FUNCTION participants_promoted_notice();

-- ── 5. Menos (ou mais) lugares ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.games_capacity_changed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_cap    INTEGER := COALESCE(NEW.max_players, NEW.num_courts * 4);
  v_old    INTEGER := COALESCE(OLD.max_players, OLD.num_courts * 4);
  v_people INTEGER;
  p        RECORD;
  v_data   JSONB;
BEGIN
  IF v_cap >= v_old
     OR NOT ((NEW.status IN ('open', 'closed') AND NEW.date > NOW())
             OR (NEW.status = 'draft' AND NEW.unfilled_at IS NOT NULL)) THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(1 + CASE WHEN partner_id IS NOT NULL OR partner_guest_id IS NOT NULL THEN 1 ELSE 0 END), 0)
    INTO v_people FROM participants WHERE game_id = NEW.id AND status = 'confirmed';

  IF v_people > v_cap THEN
    v_data := jsonb_build_object('game_title', NEW.title, 'game_date', NEW.date);
    -- Os últimos a entrar descem primeiro.
    FOR p IN SELECT * FROM participants
              WHERE game_id = NEW.id AND status = 'confirmed'
              ORDER BY created_at DESC, id DESC LOOP
      EXIT WHEN v_people <= v_cap;
      UPDATE participants SET status = 'waitlisted' WHERE id = p.id;
      v_people := v_people - (1 + CASE WHEN p.partner_id IS NOT NULL OR p.partner_guest_id IS NOT NULL THEN 1 ELSE 0 END);
      INSERT INTO notifications (user_id, kind, game_id, data)
      SELECT u, 'mix_moved_to_waitlist', NEW.id, v_data
        FROM unnest(ARRAY[p.user_id, p.partner_id]) AS u
       WHERE u IS NOT NULL;
    END LOOP;
    IF v_people < v_cap THEN
      UPDATE games SET status = 'open', updated_at = NOW() WHERE id = NEW.id AND status = 'closed';
    END IF;
  END IF;
  -- Mais lugares: já trata o game_capacity_increase_trigger.
  RETURN NULL;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.games_capacity_changed() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS games_capacity_changed_trigger ON games;
CREATE TRIGGER games_capacity_changed_trigger
  AFTER UPDATE OF num_courts, max_players ON games
  FOR EACH ROW EXECUTE FUNCTION games_capacity_changed();

COMMIT;

-- Verificar depois de correr:
--   SELECT count(*) FROM pg_trigger WHERE tgname IN ('participants_promoted_notice_trigger', 'games_capacity_changed_trigger');  -- 2
