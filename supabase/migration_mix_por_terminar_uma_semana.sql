-- ═════════════════════════════════════════════════════════════════════════
-- Mix a decorrer sem resultados: primeiro avisa, só cancela ao fim de 1 semana
--
-- PORQUÊ. Bug em produção, 23 out: o «QUINTAS @ IPC» (Aquele Padel Maroto),
-- de 22 out, ficou 'in_progress' com as duplas sorteadas e 0 resultados. A
-- tarefa diária cancel_stale_open_mixes (cron «cancel-stale-mixes», 06:00 UTC)
-- cancelava-o no dia seguinte, sem avisar ninguém: com 0 resultados ia direto
-- para 'cancelled' ao fim de 24 h.
-- Decisão do Francisco (23 out): «um dia é muito curto». Um mix que ficou a
-- decorrer sem resultados primeiro avisa quem organiza («mix por terminar»,
-- no sino) e só se cancela sozinho ao fim de UMA SEMANA sem resultados.
--
-- O QUE MUDA (só o ramo «nada marcado» do in_progress):
--   · in_progress, 0 resultados, há mais de 24 h e menos de 7 dias: avisa
--     quem organiza (o mesmo aviso mix_not_finished, no máximo um por dia),
--     em vez de cancelar;
--   · in_progress, 0 resultados, há 7 dias ou mais: cancela, como antes.
-- Fica igual: abertos/cheios que nunca começaram (cancelados às 24 h), e os
-- in_progress com resultados (termina sozinho com tudo marcado; com metade,
-- avisa). O resto do corpo é o vivo de 23 out (md5 sem \r de3d67a7…, igual
-- no alinho-dev e em produção). CREATE OR REPLACE: a ACL fica
-- ({postgres, service_role}; sem authenticated nem anon).
--
-- Bugs, 23 out 2026. Corre: SI (alinho-dev e depois produção).
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.cancel_stale_open_mixes()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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

    -- 3. Nada marcado: só se cancela ao fim de uma semana (Francisco, 23 out:
    --    «um dia é muito curto»). Antes disso, cai no aviso do ponto 2.
    IF v_done = 0 AND g.date < NOW() - INTERVAL '7 days' THEN
      UPDATE games SET status = 'cancelled', updated_at = NOW() WHERE id = g.id;
      CONTINUE;
    END IF;

    -- 1. Tudo marcado: termina, se o vencedor sai com segurança.
    IF v_done > 0 AND v_done = v_total THEN
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

    -- 2. Falta alguma coisa (ou ainda não há nada e não passou uma semana):
    --    aviso a quem organiza, no máximo um por dia.
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

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_functiondef('public.cancel_stale_open_mixes()'::regprocedure) LIKE '%7 days%';   -- true
--   SELECT proacl FROM pg_proc WHERE oid = 'public.cancel_stale_open_mixes()'::regprocedure;
--     -- {postgres=X/postgres,service_role=X/postgres}  (igual a antes)
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'cancel-stale-mixes';  -- igual (0 6 * * *)
