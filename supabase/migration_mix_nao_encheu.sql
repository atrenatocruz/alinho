-- ═════════════════════════════════════════════════════════════════════════
-- Mix que não encheu: à hora do jogo volta a rascunho; no fim do dia cancela
--
-- PORQUÊ. Pacote do mix aprovado pelo Francisco (design-handoff/
-- 2026-09-30-mix-ver-e-marcar/PACOTE.md, ponto 7 [D3], decisão «b» de 1 out):
-- «à hora do jogo, se ninguém mexeu, sai da Home e volta a rascunho, com
-- aviso a quem organiza. Se nada for feito até ao fim do dia, cancela-se
-- sozinho e avisa os inscritos: Cancelado porque não encheu. Nunca Quem
-- organiza cancelou.» Ecrã e textos: Dev 2. NÃO enviar antes de o PO dizer
-- que o main saiu e de o Francisco aprovar as prints (PO, 2 out).
--
-- O QUE FAZ. process_unfilled_mixes(), de 5 em 5 minutos (pg_cron):
--   1. Mix aberto ('open' = com lugares por ocupar), que não é jogo em
--      aberto, cuja hora chegou hoje (dia de Lisboa), sem duplas nem jogos
--      («ninguém mexeu»), e que ainda não passou por aqui (unfilled_at):
--      → 'draft' + unfilled_at = agora. Sai da Home e do robô (só mostram
--        abertos). Os inscritos ficam.
--      → aviso 'mix_not_filled' {game_title, game_date} a quem criou o mix;
--        sem criador, aos admins do clube (PO, 2 out: não há «gestores»).
--      Quem organiza pode tirar campos (os últimos descem a suplentes,
--      migration_mix_suplentes.sql) e publicar outra vez, ou cancelar. Um
--      mix republicado já tem unfilled_at: não volta a rascunho.
--   2. Mix ainda em rascunho por não ter enchido, às 23:59 do dia do jogo
--      (Lisboa) ou depois → 'cancelled' + aviso 'mix_cancelled_not_filled'
--      {game_title, game_date} a todos os inscritos (confirmados e
--      suplentes, e parceiros). O aviso «quem organiza cancelou»
--      (notify_mix_cancelled) não sai: sem pessoa, não avisa.
--   Sem corrida com o start_due_mixes: esse só arranca mixes CHEIOS antes
--   da hora; este só pega em mixes NÃO cheios depois da hora, e salta os
--   que outra transação tem presos (FOR UPDATE SKIP LOCKED).
--
-- Dev 3, 2 out 2026 · ecrã: Dev 2
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- Ordem: depois da migration_mix_voltar_a_rascunho.sql — é ela que abre a
-- trava games_draft_one_way a este caminho. Sem ela, o cron rebentava de 5
-- em 5 minutos com 'mix_already_published'.
DO $$ BEGIN
  IF pg_get_functiondef('public.games_draft_one_way()'::regprocedure) NOT LIKE '%alinho.unpublish_mix%' THEN
    RAISE EXCEPTION 'Correr primeiro a migration_mix_voltar_a_rascunho.sql.';
  END IF;
END $$;

ALTER TABLE games ADD COLUMN IF NOT EXISTS unfilled_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.process_unfilled_mixes()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  g       RECORD;
  v_today DATE := (NOW() AT TIME ZONE 'Europe/Lisbon')::date;
  v_n     INTEGER := 0;
BEGIN
  -- 1. À hora do jogo, sem encher e sem ninguém mexer → rascunho.
  FOR g IN
    SELECT * FROM games
     WHERE status = 'open'
       AND unfilled_at IS NULL
       AND COALESCE(origin, 'admin') <> 'open_slot'
       AND date <= NOW()
       AND (date AT TIME ZONE 'Europe/Lisbon')::date = v_today
       AND NOT EXISTS (SELECT 1 FROM teams t WHERE t.game_id = games.id)
       AND NOT EXISTS (SELECT 1 FROM matches m WHERE m.game_id = games.id)
     FOR UPDATE SKIP LOCKED
  LOOP
    -- A trava games_draft_one_way deixa passar este caminho (como o unpublish_mix).
    PERFORM set_config('alinho.unpublish_mix', 'on', true);
    UPDATE games SET status = 'draft', unfilled_at = NOW(), updated_at = NOW() WHERE id = g.id;
    PERFORM set_config('alinho.unpublish_mix', '', true);

    INSERT INTO notifications (user_id, kind, game_id, data)
    SELECT DISTINCT who.u, 'mix_not_filled', g.id,
           jsonb_build_object('game_title', g.title, 'game_date', g.date)
      FROM (
        SELECT g.created_by AS u WHERE g.created_by IS NOT NULL
        UNION
        SELECT m.user_id FROM memberships m
         WHERE g.created_by IS NULL
           AND m.organization_id = g.organization_id AND m.is_admin
      ) who
     WHERE who.u IS NOT NULL;
    v_n := v_n + 1;
  END LOOP;

  -- 2. Ainda em rascunho às 23:59 do dia do jogo → cancelado, com aviso.
  FOR g IN
    SELECT * FROM games
     WHERE status = 'draft'
       AND unfilled_at IS NOT NULL
       AND NOW() >= (((date AT TIME ZONE 'Europe/Lisbon')::date + TIME '23:59') AT TIME ZONE 'Europe/Lisbon')
     FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE games SET status = 'cancelled', updated_at = NOW() WHERE id = g.id;

    INSERT INTO notifications (user_id, kind, game_id, data)
    SELECT DISTINCT who.u, 'mix_cancelled_not_filled', g.id,
           jsonb_build_object('game_title', g.title, 'game_date', g.date)
      FROM (
        SELECT p.user_id AS u FROM participants p
         WHERE p.game_id = g.id AND p.status IN ('confirmed', 'waitlisted')
        UNION
        SELECT p.partner_id FROM participants p
         WHERE p.game_id = g.id AND p.status IN ('confirmed', 'waitlisted')
      ) who
     WHERE who.u IS NOT NULL;
    v_n := v_n + 1;
  END LOOP;

  RETURN v_n;
END;
$function$;
-- Interna: só o pg_cron a chama.
REVOKE EXECUTE ON FUNCTION public.process_unfilled_mixes() FROM PUBLIC, anon, authenticated;

-- De 5 em 5 minutos (refazer o agendamento se já existir).
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'process-unfilled-mixes';
SELECT cron.schedule('process-unfilled-mixes', '*/5 * * * *', 'SELECT process_unfilled_mixes()');

COMMIT;

-- Verificar depois de correr:
--   SELECT schedule, command FROM cron.job WHERE jobname = 'process-unfilled-mixes';  -- */5 … process_unfilled_mixes()
--   SELECT has_function_privilege('authenticated', 'public.process_unfilled_mixes()', 'EXECUTE');  -- false
