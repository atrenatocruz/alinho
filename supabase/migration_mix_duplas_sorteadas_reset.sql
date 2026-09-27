-- ═════════════════════════════════════════════════════════════════════════
-- Mix — «Sortear duplas»: entrar ou sair depois do sorteio desfaz as duplas
--
-- PORQUÊ. Desenho aprovado pelo Francisco a 27 set
-- (design-handoff/2026-09-27-sortear-duplas/SPEC.md, ecrã do Bugs): quem
-- organiza sorteia as duplas (teams) antes de começar, e só depois carrega
-- em «Começar o Mix». Ponto 4 do SPEC: «Se entrar ou sair alguém depois do
-- sorteio (ex.: suplente), as duplas voltam a "por sortear".» Tem de valer
-- para as inscrições da app E do robô, por isso é na base de dados.
--
-- O QUE FAZ. participants_reset_drawn_teams: depois de uma inscrição entrar,
-- sair, ou mudar de estado ou de parceiro, num mix que ainda não começou
-- (games.status 'open' ou 'closed' e sem nenhum jogo em matches), apaga as
-- teams desse mix. O ecrã volta a mostrar «Sortear duplas».
--   · SECURITY DEFINER: quem sai (um jogador, ou o robô) não pode apagar
--     teams pela RLS, e a regra tem de valer na mesma.
--   · Mix já começado (há matches, ou outro estado): não mexe em nada.
--   · Nota: reclamar um convite de parceiro sem conta também muda o parceiro
--     da inscrição; num mix sorteado e por começar, isso também pede para
--     sortear outra vez (raro, e sem estragos).
--
-- VER AS DUPLAS ANTES DE COMEÇAR (ponto 2 do pedido): a política de SELECT
-- de teams de hoje («Org members can view teams») já deixa ver a qualquer
-- membro do clube/grupo do mix — é quem vê o mix. Este ficheiro não a muda;
-- o SI confirma a viva (ver o fim).
--
-- Dev 3, 27 set 2026 · nome combinado com o Bugs
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.participants_reset_drawn_teams()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_game UUID := COALESCE(NEW.game_id, OLD.game_id);
BEGIN
  IF EXISTS (SELECT 1 FROM games g
              WHERE g.id = v_game AND g.status IN ('open', 'closed')
                AND NOT EXISTS (SELECT 1 FROM matches mt WHERE mt.game_id = g.id))
     AND EXISTS (SELECT 1 FROM teams WHERE game_id = v_game) THEN
    DELETE FROM teams WHERE game_id = v_game;
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.participants_reset_drawn_teams() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS participants_reset_drawn_teams_ins_del ON participants;
CREATE TRIGGER participants_reset_drawn_teams_ins_del
  AFTER INSERT OR DELETE ON participants
  FOR EACH ROW EXECUTE FUNCTION participants_reset_drawn_teams();

DROP TRIGGER IF EXISTS participants_reset_drawn_teams_upd ON participants;
CREATE TRIGGER participants_reset_drawn_teams_upd
  AFTER UPDATE OF status, partner_id ON participants
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.partner_id IS DISTINCT FROM NEW.partner_id)
  EXECUTE FUNCTION participants_reset_drawn_teams();

COMMIT;

-- Verificar depois de correr:
--   SELECT tgname FROM pg_trigger WHERE tgname LIKE 'participants_reset_drawn_teams%';   -- 2 linhas
-- A política de ver as duplas (tem de deixar ver a qualquer membro do clube do mix):
--   SELECT polname, pg_get_expr(polqual, polrelid) FROM pg_policy
--    WHERE polrelid = 'public.teams'::regclass AND polcmd IN ('r', '*');
