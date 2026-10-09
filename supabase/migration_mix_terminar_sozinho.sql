-- ═════════════════════════════════════════════════════════════════════════
-- Mix a decorrer há mais de 24 horas: terminar sozinho, avisar ou cancelar
--
-- PORQUÊ. Francisco, 6 out (pelo PO): o cancel_stale_open_mixes (todos os
-- dias às 06:00 UTC) cancelava os mixes a decorrer 24 horas depois da hora,
-- e quem jogou ficava sem pontos. MEXE NO RANKING: vai como proposta ao
-- Ruben no Slack antes de ir para produção.
--
-- O QUE FAZ. cancel_stale_open_mixes() (mesmo nome, mesmo cron):
--   · Aberto ou cheio, 24 horas depois da hora: cancelado, como sempre.
--   · A decorrer, 24 horas depois da hora:
--     1. Todos os jogos com resultado → termina como se quem organiza
--        carregasse em «Terminar e dar os pontos» (finalize_mix, ou
--        finalize_americano_mix no americano), em nome de quem criou o mix
--        (ou do 1.º admin do clube). O vencedor é o da mesma regra do ecrã
--        (computeMixWinnerTeamId):
--          · sobe e desce (também com parceiros que trocam): quem ganhou o
--            campo 1 na última ronda;
--          · grupos + eliminatórias: quem ganhou a final.
--        TODOS CONTRA TODOS NÃO termina sozinho: o vencedor sai da
--        classificação com desempates (standings no mixLogic) e calculá-la
--        de novo aqui arriscava dar a vitória a outra dupla. Fica no aviso.
--        O mesmo para um grupos + eliminatórias sem final.
--     2. Falta algum resultado (ou o formato não termina sozinho, ou o
--        terminar falhou) → não cancela; aviso 'mix_not_finished'
--        {game_title, game_date} a quem criou o mix (sem criador, aos
--        admins): «O <mix> ainda não está terminado. Marca o que falta e
--        fecha.» No máximo um por dia.
--     3. Nenhum resultado marcado → cancelado, como hoje.
--   · Cada mix é tratado à parte: um que falhe não trava os outros.
--   · Passa a ser interna (só o pg_cron): até aqui qualquer conta a podia
--     chamar.
--
-- Corpo VIVO conferido antes de trocar (tem de ser ainda o UPDATE simples;
-- «já estava» se já for este). Dev 3, 6 out 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  v_def TEXT := pg_get_functiondef('public.cancel_stale_open_mixes()'::regprocedure);
BEGIN
  IF v_def LIKE '%mix_not_finished%' THEN
    RAISE NOTICE 'cancel_stale_open_mixes: já estava';
    RETURN;
  END IF;
  IF v_def NOT LIKE '%status IN (''open'', ''closed'', ''in_progress'')%' OR v_def LIKE '%LOOP%' THEN
    RAISE EXCEPTION 'cancel_stale_open_mixes: o corpo vivo não é o UPDATE simples. Parar e ler.';
  END IF;
  EXECUTE $f$
CREATE OR REPLACE FUNCTION public.cancel_stale_open_mixes()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  g        RECORD;
  v_total  INTEGER;
  v_done   INTEGER;
  v_admin  UUID;
  v_winner UUID;
  v_claims TEXT := COALESCE(current_setting('request.jwt.claims', true), '');
BEGIN
  -- Abertos e cheios que nunca começaram: cancelados, como sempre.
  UPDATE games SET status = 'cancelled', updated_at = NOW()
   WHERE status IN ('open', 'closed') AND date < NOW() - INTERVAL '24 hours';

  FOR g IN
    SELECT * FROM games
     WHERE status = 'in_progress' AND date < NOW() - INTERVAL '24 hours'
     FOR UPDATE SKIP LOCKED
  LOOP
    SELECT count(*), count(*) FILTER (WHERE winner_team_id IS NOT NULL)
      INTO v_total, v_done FROM matches WHERE game_id = g.id;

    -- 3. Nada marcado: cancelado.
    IF v_done = 0 THEN
      UPDATE games SET status = 'cancelled', updated_at = NOW() WHERE id = g.id;
      CONTINUE;
    END IF;

    -- 1. Tudo marcado: termina, se o vencedor sai com segurança.
    IF v_done = v_total THEN
      v_admin := COALESCE(
        (SELECT m.user_id FROM memberships m
          WHERE m.user_id = g.created_by AND m.organization_id = g.organization_id AND m.is_admin),
        (SELECT m.user_id FROM memberships m
          WHERE m.organization_id = g.organization_id AND m.is_admin
          ORDER BY m.created_at, m.user_id LIMIT 1));
      v_winner := CASE
        WHEN g.format = 'americano' THEN NULL
        WHEN COALESCE(g.format, 'sobe_desce') = 'sobe_desce' THEN
          (SELECT winner_team_id FROM matches
            WHERE game_id = g.id AND court_number = 1 AND winner_team_id IS NOT NULL
            ORDER BY round_number DESC LIMIT 1)
        WHEN g.format = 'grupos_eliminatorias' THEN
          (SELECT winner_team_id FROM matches
            WHERE game_id = g.id AND phase = 'final' AND winner_team_id IS NOT NULL
            LIMIT 1)
      END;
      IF v_admin IS NOT NULL AND (g.format = 'americano' OR v_winner IS NOT NULL) THEN
        BEGIN
          -- Em nome de quem organiza, como o botão.
          PERFORM set_config('request.jwt.claims',
                             json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
          IF g.format = 'americano' THEN
            PERFORM finalize_americano_mix(g.id);
          ELSE
            PERFORM finalize_mix(g.id, v_winner);
          END IF;
          PERFORM set_config('request.jwt.claims', v_claims, true);
          CONTINUE;
        EXCEPTION WHEN OTHERS THEN
          PERFORM set_config('request.jwt.claims', v_claims, true);
          RAISE WARNING 'cancel_stale_open_mixes: % não terminou: %', g.id, SQLERRM;
        END;
      END IF;
    END IF;

    -- 2. Falta alguma coisa: aviso a quem organiza, no máximo um por dia.
    IF NOT EXISTS (SELECT 1 FROM notifications
                    WHERE game_id = g.id AND kind = 'mix_not_finished'
                      AND created_at > NOW() - INTERVAL '20 hours') THEN
      INSERT INTO notifications (user_id, kind, game_id, data)
      SELECT who.u, 'mix_not_finished', g.id,
             jsonb_build_object('game_title', g.title, 'game_date', g.date)
        FROM (
          SELECT g.created_by AS u WHERE g.created_by IS NOT NULL
          UNION
          SELECT m.user_id FROM memberships m
           WHERE g.created_by IS NULL AND m.organization_id = g.organization_id AND m.is_admin
        ) who
       WHERE who.u IS NOT NULL;
    END IF;
  END LOOP;
END;
$function$;
$f$;
END $$;

REVOKE EXECUTE ON FUNCTION public.cancel_stale_open_mixes() FROM PUBLIC, anon, authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_functiondef('public.cancel_stale_open_mixes()'::regprocedure) LIKE '%mix_not_finished%';  -- true
--   SELECT has_function_privilege('authenticated', 'public.cancel_stale_open_mixes()', 'EXECUTE');  -- false
--   SELECT schedule, command FROM cron.job WHERE jobname = 'cancel-stale-mixes';  -- 0 6 * * * (não muda)
