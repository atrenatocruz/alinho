-- ═════════════════════════════════════════════════════════════════════════
-- Objetivo de jogos por mês: o objetivo, a medalha de cada mês, a pausa e as
-- conquistas por meses seguidos (o «anel» das ideias Fitness)
--
-- PORQUÊ. Aprovado pelo Francisco a 23 out (DECISAO-IDEIAS-FITNESS.md e o
-- §2 de BA-ESTATISTICAS-E-SAUDE-23OUT.md) e o plano a 26 out («o resto
-- okay»); a pausa uma vez em cada 12 meses a 26 out («sim aos dois»). Os
-- nomes das conquistas são provisórios até ao SPEC da UX. Ecrãs: Dev 2.
--
-- AS REGRAS
--   · Cada pessoa escolhe o objetivo, de 1 a 30 jogos por mês. Vale para os
--     meses seguintes até o mudar.
--   · Subir vale logo para o mês em curso. Descer só até dia 7; depois disso
--     a descida vale a partir do mês seguinte. O primeiro objetivo também
--     só vale para o mês em curso se for escolhido até dia 7 (senão dava
--     para escolher 1 no dia 30 e ganhar a medalha).
--   · A sugestão é a média dos últimos 3 meses acabados, no mínimo 4.
--   · Contam os mesmos jogos das estatísticas (player_counted_games: mix e
--     jogo em aberto, torneio sem faltas, amigos confirmados, liga oficial).
--   · A pausa vai até 90 dias seguidos, uma vez em cada 12 meses (contados
--     do início da anterior). Um mês tocado pela pausa e não cumprido não
--     parte a sequência nem conta para ela. Pode acabar-se antes.
--   · No fecho de cada mês (process_month_goals, de hora a hora), fica
--     guardado o resultado de cada pessoa com objetivo: a medalha é
--     achieved = TRUE. Aviso no sino 'month_goal_achieved'.
--   · Conquistas por meses seguidos cumpridos: goal_streak_3 (rara),
--     goal_streak_6 (épica), goal_streak_12 (lendária). Chaves provisórias.
--
-- AS FUNÇÕES PARA O ECRÃ
--   · get_month_goals(p_user_id) → { goal, next_goal, applies_next_from,
--     this_month: { month, games }, suggestion, can_lower_now, streak,
--     pause: { active, starts_on, ends_on, next_allowed_on }, months: [12] }.
--     Para outra pessoa, só com a privacidade do perfil; sem os dados da
--     pausa nem da sugestão.
--   · set_month_goal(p_goal) → { goal, applies_from }. Erro: bad_goal.
--   · start_goal_pause(p_days default 90) → { starts_on, ends_on }.
--     Erros: bad_days, pause_active, pause_used (HINT = quando pode outra).
--   · end_goal_pause().
--
-- COMPATIBILIDADE. Só acrescenta.
--
-- Dev 3, 26 out 2026 · ecrãs: Dev 2
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. As tabelas ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.player_month_goals (
  user_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  starts_month DATE NOT NULL CHECK (starts_month = date_trunc('month', starts_month)::date),
  goal         SMALLINT NOT NULL CHECK (goal BETWEEN 1 AND 30),
  set_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, starts_month)
);
CREATE TABLE IF NOT EXISTS public.player_goal_pauses (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  starts_on  DATE NOT NULL,
  ends_on    DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_on >= starts_on AND ends_on - starts_on <= 89)
);
CREATE INDEX IF NOT EXISTS idx_player_goal_pauses_user ON public.player_goal_pauses (user_id, starts_on);
CREATE TABLE IF NOT EXISTS public.player_month_goal_results (
  user_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  month     DATE NOT NULL,
  goal      SMALLINT NOT NULL,
  games     INTEGER NOT NULL,
  achieved  BOOLEAN NOT NULL,
  paused    BOOLEAN NOT NULL DEFAULT FALSE,
  closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, month)
);
CREATE TABLE IF NOT EXISTS public.month_goal_closings (
  month     DATE PRIMARY KEY,
  closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.player_month_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_goal_pauses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_month_goal_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.month_goal_closings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.player_month_goals, public.player_goal_pauses, public.player_month_goal_results, public.month_goal_closings
  FROM PUBLIC, anon, authenticated;

INSERT INTO achievements (key, category, rarity, sort, active) VALUES
  ('goal_streak_3', 'jogo', 'raro', 1033, TRUE),
  ('goal_streak_6', 'jogo', 'epico', 1034, TRUE),
  ('goal_streak_12', 'jogo', 'lendario', 1035, TRUE)
ON CONFLICT (key) DO NOTHING;

-- ── 2. Os jogos que contam ──────────────────────────────────────────────
-- Os mesmos do get_player_monthly_stats (estatísticas, 26 out).
CREATE OR REPLACE FUNCTION public.player_counted_games(p_uid UUID)
RETURNS TABLE(played_at TIMESTAMPTZ, won BOOLEAN, mate UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT COALESCE(m.scored_at, g.date), (m.winner_team_id = t.id),
         CASE WHEN t.player1_id = p_uid THEN t.player2_id ELSE t.player1_id END
    FROM matches m JOIN teams t ON t.id IN (m.team_a_id, m.team_b_id) JOIN games g ON g.id = m.game_id
   WHERE m.winner_team_id IS NOT NULL AND g.status IS DISTINCT FROM 'cancelled' AND p_uid IN (t.player1_id, t.player2_id)
  UNION ALL
  SELECT COALESCE(tm.scheduled_at, tm.created_at), (tm.winner_entry_id = me.entry_id),
         (SELECT o.user_id FROM tournament_match_players o WHERE o.match_id = tm.id AND o.side = me.side AND o.user_id IS DISTINCT FROM p_uid LIMIT 1)
    FROM tournament_match_players me JOIN tournament_matches tm ON tm.id = me.match_id
   WHERE me.user_id = p_uid AND tm.status = 'terminado' AND tm.winner_entry_id IS NOT NULL
  UNION ALL
  SELECT pm.played_at, pms.won,
         CASE WHEN p_uid = pm.team_a_player1_id THEN pm.team_a_player2_id WHEN p_uid = pm.team_a_player2_id THEN pm.team_a_player1_id
              WHEN p_uid = pm.team_b_player1_id THEN pm.team_b_player2_id ELSE pm.team_b_player1_id END
    FROM private_matches pm JOIN private_match_stats pms ON pms.private_match_id = pm.id AND pms.user_id = p_uid
   WHERE pm.status = 'confirmed' AND pm.played_at IS NOT NULL
  UNION ALL
  SELECT COALESCE(e.scheduled_at, e.confirmed_at), (lm.winner = s.side),
         CASE WHEN s.side = 'home' THEN (CASE WHEN lm.home_p1 = p_uid THEN lm.home_p2 ELSE lm.home_p1 END)
              ELSE (CASE WHEN lm.away_p1 = p_uid THEN lm.away_p2 ELSE lm.away_p1 END) END
    FROM league_matches lm JOIN league_encounters e ON e.id = lm.encounter_id
    CROSS JOIN LATERAL (SELECT CASE WHEN p_uid IN (lm.home_p1, lm.home_p2) THEN 'home' ELSE 'away' END AS side) s
   WHERE e.status = 'oficial' AND e.walkover_team_id IS NULL AND lm.winner IS NOT NULL
     AND p_uid IN (lm.home_p1, lm.home_p2, lm.away_p1, lm.away_p2);
$function$;
REVOKE ALL ON FUNCTION public.player_counted_games(UUID) FROM PUBLIC, anon, authenticated;

-- Jogos de uma pessoa num mês (o de Lisboa).
CREATE OR REPLACE FUNCTION public.player_month_games(p_uid UUID, p_month DATE)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT count(*)::int FROM player_counted_games(p_uid) g
   WHERE g.played_at IS NOT NULL
     AND date_trunc('month', g.played_at AT TIME ZONE 'Europe/Lisbon')::date = date_trunc('month', p_month)::date;
$function$;
REVOKE ALL ON FUNCTION public.player_month_games(UUID, DATE) FROM PUBLIC, anon, authenticated;

-- O objetivo que vale num mês (o último escolhido até esse mês).
CREATE OR REPLACE FUNCTION public.player_goal_for_month(p_uid UUID, p_month DATE)
RETURNS SMALLINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT goal FROM player_month_goals
   WHERE user_id = p_uid AND starts_month <= date_trunc('month', p_month)::date
   ORDER BY starts_month DESC LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION public.player_goal_for_month(UUID, DATE) FROM PUBLIC, anon, authenticated;

-- ── 3. Escolher o objetivo ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_month_goal(p_goal INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid   UUID := auth.uid();
  v_today DATE := (NOW() AT TIME ZONE 'Europe/Lisbon')::date;
  v_this  DATE := date_trunc('month', (NOW() AT TIME ZONE 'Europe/Lisbon'))::date;
  v_next  DATE := (date_trunc('month', (NOW() AT TIME ZONE 'Europe/Lisbon')) + INTERVAL '1 month')::date;
  v_cur   SMALLINT;
  v_from  DATE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF p_goal IS NULL OR p_goal < 1 OR p_goal > 30 THEN RAISE EXCEPTION 'bad_goal'; END IF;
  v_cur := player_goal_for_month(v_uid, v_this);
  -- Subir vale logo; descer (ou o primeiro objetivo) só até dia 7.
  v_from := CASE WHEN v_cur IS NOT NULL AND p_goal >= v_cur THEN v_this
                 WHEN extract(day FROM v_today) <= 7 THEN v_this
                 ELSE v_next END;
  DELETE FROM player_month_goals WHERE user_id = v_uid AND starts_month >= v_from;
  INSERT INTO player_month_goals (user_id, starts_month, goal) VALUES (v_uid, v_from, p_goal);
  RETURN jsonb_build_object('goal', p_goal, 'applies_from', v_from);
END;
$function$;
REVOKE ALL ON FUNCTION public.set_month_goal(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_month_goal(INTEGER) TO authenticated;

-- ── 4. A pausa ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.start_goal_pause(p_days INTEGER DEFAULT 90)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid   UUID := auth.uid();
  v_today DATE := (NOW() AT TIME ZONE 'Europe/Lisbon')::date;
  v_last  DATE;
  v_end   DATE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF p_days IS NULL OR p_days < 1 OR p_days > 90 THEN RAISE EXCEPTION 'bad_days'; END IF;
  IF EXISTS (SELECT 1 FROM player_goal_pauses WHERE user_id = v_uid AND v_today BETWEEN starts_on AND ends_on) THEN
    RAISE EXCEPTION 'pause_active';
  END IF;
  -- Uma vez em cada 12 meses (Francisco, 26 out).
  SELECT max(starts_on) INTO v_last FROM player_goal_pauses WHERE user_id = v_uid;
  IF v_last IS NOT NULL AND v_today < (v_last + INTERVAL '12 months')::date THEN
    RAISE EXCEPTION 'pause_used' USING HINT = ((v_last + INTERVAL '12 months')::date)::text;
  END IF;
  v_end := v_today + (p_days - 1);
  INSERT INTO player_goal_pauses (user_id, starts_on, ends_on) VALUES (v_uid, v_today, v_end);
  RETURN jsonb_build_object('starts_on', v_today, 'ends_on', v_end);
END;
$function$;
REVOKE ALL ON FUNCTION public.start_goal_pause(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_goal_pause(INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.end_goal_pause()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_today DATE := (NOW() AT TIME ZONE 'Europe/Lisbon')::date;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_allowed'; END IF;
  -- Começada hoje e acabada hoje: é como se não tivesse havido (não conta
  -- para os 12 meses). Senão acaba ontem (e conta como usada).
  DELETE FROM player_goal_pauses WHERE user_id = auth.uid() AND starts_on = v_today;
  UPDATE player_goal_pauses SET ends_on = v_today - 1
   WHERE user_id = auth.uid() AND starts_on < v_today AND v_today <= ends_on;
END;
$function$;
REVOKE ALL ON FUNCTION public.end_goal_pause() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.end_goal_pause() TO authenticated;

-- ── 5. A sequência ──────────────────────────────────────────────────────
-- Meses seguidos cumpridos, a contar do mês p_month para trás; um mês em
-- pausa e não cumprido salta-se (não parte nem conta).
CREATE OR REPLACE FUNCTION public.player_goal_streak(p_uid UUID, p_month DATE)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  r   RECORD;
  v_n INTEGER := 0;
  v_m DATE := date_trunc('month', p_month)::date;
BEGIN
  LOOP
    SELECT * INTO r FROM player_month_goal_results WHERE user_id = p_uid AND month = v_m;
    EXIT WHEN r IS NULL OR r.month IS NULL;
    IF r.achieved THEN v_n := v_n + 1;
    ELSIF NOT r.paused THEN EXIT;
    END IF;
    v_m := (v_m - INTERVAL '1 month')::date;
  END LOOP;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public.player_goal_streak(UUID, DATE) FROM PUBLIC, anon, authenticated;

-- ── 6. O fecho do mês ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.process_month_goals()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_this  DATE := date_trunc('month', (NOW() AT TIME ZONE 'Europe/Lisbon'))::date;
  v_month DATE;
  v_last  DATE;
  v_at    TIMESTAMPTZ;
  u       RECORD;
  v_goal  SMALLINT;
  v_games INTEGER;
  v_ok    BOOLEAN;
  v_pause BOOLEAN;
  v_st    INTEGER;
  v_n     INTEGER := 0;
BEGIN
  -- Cada mês acabado desde o primeiro objetivo, por fechar.
  v_month := COALESCE((SELECT (max(month) + INTERVAL '1 month')::date FROM month_goal_closings),
                      (SELECT min(starts_month) FROM player_month_goals));
  IF v_month IS NULL THEN RETURN 0; END IF;
  WHILE v_month < v_this LOOP
    v_last := (v_month + INTERVAL '1 month' - INTERVAL '1 day')::date;
    v_at := ((v_month + INTERVAL '1 month')::timestamp AT TIME ZONE 'Europe/Lisbon') - INTERVAL '1 second';
    FOR u IN SELECT DISTINCT user_id FROM player_month_goals WHERE starts_month <= v_month LOOP
      v_goal := player_goal_for_month(u.user_id, v_month);
      CONTINUE WHEN v_goal IS NULL;
      v_games := player_month_games(u.user_id, v_month);
      v_ok := v_games >= v_goal;
      v_pause := EXISTS (SELECT 1 FROM player_goal_pauses p
                          WHERE p.user_id = u.user_id AND p.starts_on <= v_last AND p.ends_on >= v_month);
      INSERT INTO player_month_goal_results (user_id, month, goal, games, achieved, paused)
      VALUES (u.user_id, v_month, v_goal, v_games, v_ok, v_pause)
      ON CONFLICT (user_id, month) DO NOTHING;
      IF v_ok THEN
        INSERT INTO notifications (user_id, kind, data)
        VALUES (u.user_id, 'month_goal_achieved', jsonb_build_object('month', v_month, 'goal', v_goal, 'games', v_games));
        v_st := player_goal_streak(u.user_id, v_month);
        INSERT INTO player_achievements (user_id, achievement_key, awarded_at, context, event_kind, event_on)
        SELECT u.user_id, k, v_at, 'facto', 'objetivo_mes', v_last
          FROM (VALUES ('goal_streak_3', 3), ('goal_streak_6', 6), ('goal_streak_12', 12)) AS x(k, need)
          JOIN achievements a ON a.key = x.k AND a.active
         WHERE v_st >= x.need
        ON CONFLICT (user_id, achievement_key) DO NOTHING;
      END IF;
      v_n := v_n + 1;
    END LOOP;
    INSERT INTO month_goal_closings (month) VALUES (v_month) ON CONFLICT DO NOTHING;
    v_month := (v_month + INTERVAL '1 month')::date;
  END LOOP;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public.process_month_goals() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-month-goals') THEN
    PERFORM cron.schedule('process-month-goals', '23 * * * *', 'SELECT public.process_month_goals()');
  END IF;
END $$;

-- ── 7. O que o ecrã lê ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_month_goals(p_user_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid   UUID := COALESCE(p_user_id, auth.uid());
  v_me    BOOLEAN := v_uid = auth.uid();
  v_today DATE := (NOW() AT TIME ZONE 'Europe/Lisbon')::date;
  v_this  DATE := date_trunc('month', (NOW() AT TIME ZONE 'Europe/Lisbon'))::date;
  v_next  DATE := (date_trunc('month', (NOW() AT TIME ZONE 'Europe/Lisbon')) + INTERVAL '1 month')::date;
  v_goal  SMALLINT;
  v_ngoal SMALLINT;
  v_games INTEGER;
  v_sugg  INTEGER;
  v_p     player_goal_pauses%ROWTYPE;
  v_lastp DATE;
  v_streak INTEGER;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;
  IF NOT v_me AND NOT played_history_visible(v_uid) THEN RETURN NULL; END IF;
  v_goal := player_goal_for_month(v_uid, v_this);
  v_ngoal := player_goal_for_month(v_uid, v_next);
  v_games := player_month_games(v_uid, v_this);
  -- A sequência que já vem dos meses fechados, mais o mês em curso se já
  -- estiver cumprido.
  v_streak := player_goal_streak(v_uid, (v_this - INTERVAL '1 month')::date)
              + CASE WHEN v_goal IS NOT NULL AND v_games >= v_goal THEN 1 ELSE 0 END;
  IF v_me THEN
    SELECT GREATEST(4, LEAST(30, round(avg(player_month_games(v_uid, (v_this - make_interval(months => i))::date)))))::int
      INTO v_sugg FROM generate_series(1, 3) AS i;
    SELECT * INTO v_p FROM player_goal_pauses WHERE user_id = v_uid AND v_today BETWEEN starts_on AND ends_on LIMIT 1;
    SELECT max(starts_on) INTO v_lastp FROM player_goal_pauses WHERE user_id = v_uid;
  END IF;
  RETURN jsonb_build_object(
    'goal', v_goal,
    'next_goal', CASE WHEN v_ngoal IS DISTINCT FROM v_goal THEN v_ngoal END,
    'applies_next_from', CASE WHEN v_ngoal IS DISTINCT FROM v_goal THEN v_next END,
    'this_month', jsonb_build_object('month', to_char(v_this, 'YYYY-MM'), 'games', v_games),
    'streak', v_streak,
    'suggestion', CASE WHEN v_me THEN v_sugg END,
    'can_lower_now', CASE WHEN v_me THEN extract(day FROM v_today) <= 7 END,
    'pause', CASE WHEN v_me THEN jsonb_build_object(
               'active', v_p.id IS NOT NULL, 'starts_on', v_p.starts_on, 'ends_on', v_p.ends_on,
               'next_allowed_on', CASE WHEN v_lastp IS NOT NULL THEN (v_lastp + INTERVAL '12 months')::date END) END,
    'months', (SELECT COALESCE(jsonb_agg(jsonb_build_object('month', to_char(r.month, 'YYYY-MM'), 'goal', r.goal, 'games', r.games,
                                                            'achieved', r.achieved, 'paused', r.paused) ORDER BY r.month), '[]'::jsonb)
                 FROM player_month_goal_results r
                WHERE r.user_id = v_uid AND r.month >= (v_this - INTERVAL '12 months')::date)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.get_month_goals(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_month_goals(UUID) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT count(*) FROM achievements WHERE key LIKE 'goal_streak_%' AND active;   → 3
--   SELECT count(*) FROM cron.job WHERE jobname = 'process-month-goals';   → 1
--   SELECT has_function_privilege('anon', 'public.set_month_goal(integer)', 'EXECUTE');   → false
--   SELECT has_table_privilege('authenticated', 'public.player_month_goals', 'SELECT');   → false
