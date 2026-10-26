-- ═════════════════════════════════════════════════════════════════════════
-- Estatísticas do perfil: mês a mês, a frase do mês e «Ganhas mais com»
--
-- PORQUÊ. Aprovado pelo Francisco a 23 out («sim»):
-- design-handoff/2026-10-23-estatisticas-mes-a-mes/SPEC.md; regras do BA em
-- design-handoff/2026-10-22-relogio/estudo-melhorias/BA-ESTATISTICAS-E-SAUDE-
-- 23OUT.md (ponto 1). Ecrãs: Dev 2.
--
-- O QUE FAZ. get_player_monthly_stats(p_user_id, p_months) → jsonb, numa
-- chamada só:
--   · months: um por mês, do mais antigo ao atual, [{ month 'AAAA-MM',
--     games, wins, losses }] (meses sem jogos vêm a 0). p_months de 1 a 24,
--     12 por omissão (o ecrã mostra 6 ou 12).
--   · this_month / prev_month: { month, games, wins } (para a frase).
--   · first_month: o primeiro mês com jogos ('AAAA-MM'), para «o teu
--     primeiro mês no alinho».
--   · month_partner: o parceiro com mais vitórias este mês { id, name,
--     avatar_url, wins, games } ou null.
--   · best_partner: «Ganhas mais com», só com pelo menos 3 jogos juntos: mais
--     vitórias, depois maior %, depois o jogo mais recente. { id, name,
--     avatar_url, wins, losses, games, pct } ou null.
--   · partners: todos, com { id, name, avatar_url, wins, losses, games, pct }
--     (para a lista «Com quem»), por jogos.
-- Contam os mesmos jogos do ranking: cada ronda de mix e de jogo em aberto
-- com resultado, cada jogo de torneio acabado (sem os de falta ou
-- desistência), cada jogo entre amigos confirmado e cada partida da liga
-- oficial (sem as faltas). Convidados sem conta não entram nos parceiros. O
-- mês é o de Lisboa. A privacidade é a do perfil (played_history_visible):
-- sem ela, devolve NULL.
--
-- COMPATIBILIDADE. Só acrescenta (função nova).
--
-- Dev 3, 26 out 2026 · ecrãs: Dev 2
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.get_player_monthly_stats(p_user_id UUID DEFAULT NULL, p_months INTEGER DEFAULT 12)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid    UUID := COALESCE(p_user_id, auth.uid());
  v_n      INTEGER := LEAST(GREATEST(COALESCE(p_months, 12), 1), 24);
  v_this   DATE := date_trunc('month', (NOW() AT TIME ZONE 'Europe/Lisbon'))::date;
  v_prev   DATE := (date_trunc('month', (NOW() AT TIME ZONE 'Europe/Lisbon')) - INTERVAL '1 month')::date;
  v_out    JSONB;
BEGIN
  IF v_uid IS NULL OR NOT played_history_visible(v_uid) THEN RETURN NULL; END IF;

  CREATE TEMP TABLE IF NOT EXISTS _pms_games (played_at TIMESTAMPTZ, won BOOLEAN, mate UUID) ON COMMIT DROP;
  TRUNCATE _pms_games;

  INSERT INTO _pms_games
  -- Mix e jogo em aberto: cada ronda com resultado.
  SELECT COALESCE(m.scored_at, g.date), (m.winner_team_id = t.id),
         CASE WHEN t.player1_id = v_uid THEN t.player2_id ELSE t.player1_id END
    FROM matches m
    JOIN teams t ON t.id IN (m.team_a_id, m.team_b_id)
    JOIN games g ON g.id = m.game_id
   WHERE m.winner_team_id IS NOT NULL AND g.status IS DISTINCT FROM 'cancelled'
     AND v_uid IN (t.player1_id, t.player2_id)
  UNION ALL
  -- Torneio: jogos acabados a jogar (sem faltas nem desistências).
  SELECT COALESCE(tm.scheduled_at, tm.created_at), (tm.winner_entry_id = me.entry_id),
         (SELECT o.user_id FROM tournament_match_players o
           WHERE o.match_id = tm.id AND o.side = me.side AND o.user_id IS DISTINCT FROM v_uid LIMIT 1)
    FROM tournament_match_players me
    JOIN tournament_matches tm ON tm.id = me.match_id
   WHERE me.user_id = v_uid AND tm.status = 'terminado' AND tm.winner_entry_id IS NOT NULL
  UNION ALL
  -- Amigos: confirmados.
  SELECT pm.played_at, pms.won,
         CASE WHEN v_uid = pm.team_a_player1_id THEN pm.team_a_player2_id
              WHEN v_uid = pm.team_a_player2_id THEN pm.team_a_player1_id
              WHEN v_uid = pm.team_b_player1_id THEN pm.team_b_player2_id
              ELSE pm.team_b_player1_id END
    FROM private_matches pm
    JOIN private_match_stats pms ON pms.private_match_id = pm.id AND pms.user_id = v_uid
   WHERE pm.status = 'confirmed' AND pm.played_at IS NOT NULL
  UNION ALL
  -- Liga: partidas dos encontros oficiais (sem as faltas).
  SELECT COALESCE(e.scheduled_at, e.confirmed_at), (lm.winner = s.side),
         CASE WHEN s.side = 'home' THEN (CASE WHEN lm.home_p1 = v_uid THEN lm.home_p2 ELSE lm.home_p1 END)
              ELSE (CASE WHEN lm.away_p1 = v_uid THEN lm.away_p2 ELSE lm.away_p1 END) END
    FROM league_matches lm
    JOIN league_encounters e ON e.id = lm.encounter_id
    CROSS JOIN LATERAL (SELECT CASE WHEN v_uid IN (lm.home_p1, lm.home_p2) THEN 'home' ELSE 'away' END AS side) s
   WHERE e.status = 'oficial' AND e.walkover_team_id IS NULL AND lm.winner IS NOT NULL
     AND v_uid IN (lm.home_p1, lm.home_p2, lm.away_p1, lm.away_p2);

  WITH g AS (
    SELECT date_trunc('month', played_at AT TIME ZONE 'Europe/Lisbon')::date AS mon, won, mate, played_at
      FROM _pms_games WHERE played_at IS NOT NULL
  ), series AS (
    SELECT (v_this - make_interval(months => i))::date AS mon
      FROM generate_series(v_n - 1, 0, -1) AS i
  ), months AS (
    SELECT s.mon, count(g.*)::int AS games, count(g.*) FILTER (WHERE g.won)::int AS wins
      FROM series s LEFT JOIN g ON g.mon = s.mon
     GROUP BY s.mon
  ), mates AS (
    SELECT g.mate, count(*)::int AS games, count(*) FILTER (WHERE g.won)::int AS wins, max(g.played_at) AS last_at
      FROM g WHERE g.mate IS NOT NULL GROUP BY g.mate
  ), month_mates AS (
    SELECT g.mate, count(*) FILTER (WHERE g.won)::int AS wins, count(*)::int AS games
      FROM g WHERE g.mate IS NOT NULL AND g.mon = v_this GROUP BY g.mate
  )
  SELECT jsonb_build_object(
    'months', (SELECT COALESCE(jsonb_agg(jsonb_build_object('month', to_char(mon, 'YYYY-MM'), 'games', games,
                                                            'wins', wins, 'losses', games - wins) ORDER BY mon), '[]'::jsonb)
                 FROM months),
    'this_month', jsonb_build_object('month', to_char(v_this, 'YYYY-MM'),
                    'games', (SELECT count(*) FROM g WHERE mon = v_this),
                    'wins', (SELECT count(*) FROM g WHERE mon = v_this AND won)),
    'prev_month', jsonb_build_object('month', to_char(v_prev, 'YYYY-MM'),
                    'games', (SELECT count(*) FROM g WHERE mon = v_prev),
                    'wins', (SELECT count(*) FROM g WHERE mon = v_prev AND won)),
    'first_month', (SELECT to_char(min(mon), 'YYYY-MM') FROM g),
    'month_partner', (SELECT jsonb_build_object('id', mm.mate, 'name', p.name, 'avatar_url', p.avatar_url,
                                                'wins', mm.wins, 'games', mm.games)
                        FROM month_mates mm JOIN profiles p ON p.id = mm.mate
                       WHERE mm.wins > 0
                       ORDER BY mm.wins DESC, mm.games, p.name LIMIT 1),
    'best_partner', (SELECT jsonb_build_object('id', x.mate, 'name', p.name, 'avatar_url', p.avatar_url,
                                               'wins', x.wins, 'losses', x.games - x.wins, 'games', x.games,
                                               'pct', round(100.0 * x.wins / x.games))
                       FROM mates x JOIN profiles p ON p.id = x.mate
                      WHERE x.games >= 3
                      ORDER BY x.wins DESC, (x.wins::numeric / x.games) DESC, x.last_at DESC LIMIT 1),
    'partners', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.mate, 'name', p.name, 'avatar_url', p.avatar_url,
                                                              'wins', x.wins, 'losses', x.games - x.wins, 'games', x.games,
                                                              'pct', round(100.0 * x.wins / x.games))
                                           ORDER BY x.games DESC, p.name), '[]'::jsonb)
                   FROM mates x JOIN profiles p ON p.id = x.mate)
  ) INTO v_out;

  RETURN v_out;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_player_monthly_stats(UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_player_monthly_stats(UUID, INTEGER) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT has_function_privilege('anon', 'public.get_player_monthly_stats(uuid,integer)', 'EXECUTE');   → false
