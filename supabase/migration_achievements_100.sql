-- ═════════════════════════════════════════════════════════════════════════
-- CONQUISTAS: DE 47 PARA 100 (Ruben, 29 set 2026)
--
-- 53 conquistas novas, todas medidas com dados que já existem. Abre dois
-- filões que estavam por usar: torneios (final_position, seed), campo por
-- jogo (matches.court_number — o sobe e desce), parceiros (teams), scores
-- (roscas, punto de oro, tie-break), suplentes e WhatsApp
-- (participant_events), aulas, convites, vouchers e sessões de amigos.
--
-- O QUE FAZ
--   1. Duas categorias novas no catálogo: 'torneio' e 'aulas'.
--   2. Seed das 53 (ON CONFLICT DO NOTHING — pode correr duas vezes).
--   3. check_and_award_achievements reescrita: as 47 condições ficam
--      exactamente iguais; juntam-se os contadores novos.
--   4. Ganchos novos por trigger, para os sítios que hoje não chamam o
--      verificador: torneios (tournament_player_stats), aulas
--      (lesson_attendees), convites aceites (organization_invites),
--      vouchers usados, perfil completo (profiles), eventos de inscrição
--      (participant_events: suplente promovido, «In» pelo bot) e jogos de
--      grupo (group_matches). Cada gancho é AFTER e só chama o verificador,
--      que já engole qualquer erro (WARNING) — nunca desfaz o que o chamou.
--   5. Backfill: corre o verificador para toda a gente que já jogou.
--
-- Regra que se mantém: uma conquista nunca se retira.
-- UI: src/lib/achievements.js (ícones + CATEGORY_ORDER) e locales
-- achievements.<key>_name/_desc — vão no mesmo commit.
--
-- Correr à mão no SQL Editor, depois de migration_achievements_rename.sql,
-- migration_tournaments_who_played.sql e migration_lessons_1_base.sql.
-- ═════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  faltam TEXT[] := ARRAY[]::TEXT[];
  t TEXT;
BEGIN
  IF to_regprocedure('check_and_award_achievements(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Falta migration_achievements_rename.sql. Correr primeiro.';
  END IF;
  -- O verificador lê estas tabelas/colunas. Se faltar uma, o bloco interno
  -- engolia o erro e NENHUMA conquista voltava a ser dada — por isso
  -- confirma-se aqui, antes de mexer em alguma coisa.
  FOREACH t IN ARRAY ARRAY['participant_events', 'tournament_player_stats', 'tournament_entries',
                           'lesson_attendees', 'organization_invites', 'vouchers', 'group_matches',
                           'private_match_stats', 'player_stats'] LOOP
    IF to_regclass(t) IS NULL THEN faltam := faltam || t; END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'games' AND column_name = 'tiebreak_8_8') THEN
    faltam := faltam || 'games.tiebreak_8_8 (migration_580)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'private_matches' AND column_name = 'session_id') THEN
    faltam := faltam || 'private_matches.session_id (migration_friend_match_invitees)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'dominant_hand') THEN
    faltam := faltam || 'profiles.dominant_hand';
  END IF;
  IF array_length(faltam, 1) > 0 THEN
    RAISE EXCEPTION 'Faltam migrações anteriores: %. Correr primeiro.', array_to_string(faltam, ', ');
  END IF;
END $$;

-- ── 1. Categorias novas ────────────────────────────────────────────────
ALTER TABLE achievements DROP CONSTRAINT IF EXISTS trophies_category_check;
ALTER TABLE achievements DROP CONSTRAINT IF EXISTS achievements_category_check;
ALTER TABLE achievements ADD CONSTRAINT achievements_category_check
  CHECK (category IN ('jogo','elo','xp','kudos','antiguidade','evento','torneio','aulas'));

-- ── 2. Seed das 53 ─────────────────────────────────────────────────────
INSERT INTO achievements (key, category, rarity, sort) VALUES
  -- presença e ritmo
  ('semana_sim_semana_sim', 'jogo', 'raro',     30),
  ('trimestre_de_ferro',    'jogo', 'epico',    31),
  ('ano_sem_falhar',        'jogo', 'lendario', 32),
  ('sete_dias',             'jogo', 'raro',     33),
  ('turno_da_noite',        'jogo', 'raro',     34),
  ('fim_de_tarde',          'jogo', 'comum',    35),
  ('regressado',            'jogo', 'comum',    36),
  ('anos_a_jogar',          'jogo', 'raro',     37),
  ('turista',               'jogo', 'raro',     38),
  -- dentro do mix
  ('campo_1',               'jogo', 'comum',    40),
  ('escalada',              'jogo', 'epico',    41),
  ('do_fundo_ao_topo',      'jogo', 'raro',     42),
  ('rosca',                 'jogo', 'raro',     43),
  ('rosca_dupla',           'jogo', 'epico',    44),
  ('punto_de_oro',          'jogo', 'comum',    45),
  ('nervos_de_aco',         'jogo', 'raro',     46),
  ('tie_break',             'jogo', 'raro',     47),
  ('todos_os_formatos',     'jogo', 'raro',     48),
  ('final_four',            'jogo', 'epico',    49),
  -- vitórias e séries
  ('em_chamas',             'jogo', 'raro',     50),
  ('imparavel',             'jogo', 'epico',    51),
  ('hat_trick',             'jogo', 'epico',    52),
  ('meio_milhar',           'jogo', 'raro',     53),
  ('recorde_da_casa',       'jogo', 'raro',     54),
  ('contra_a_corrente',     'jogo', 'raro',     55),
  -- parceiros
  ('dez_parceiros',         'jogo', 'comum',    56),
  ('sociavel',              'jogo', 'raro',     57),
  ('toda_a_gente',          'jogo', 'epico',    58),
  ('dupla_de_sempre',       'jogo', 'raro',     59),
  ('quimica',               'jogo', 'raro',     60),
  ('inscricao_a_dois',      'jogo', 'comum',    61),
  -- suplentes, WhatsApp, organização
  ('salto_do_banco',        'jogo', 'comum',    62),
  ('suplente_de_luxo',      'jogo', 'raro',     63),
  ('in',                    'jogo', 'comum',    64),
  ('rei_do_in',             'jogo', 'raro',     65),
  ('primeiro_a_chegar',     'jogo', 'raro',     66),
  ('organizador',           'jogo', 'comum',    67),
  ('anfitriao',             'jogo', 'epico',    68),
  -- amigáveis e grupos
  ('sessao_completa',       'jogo', 'comum',    69),
  ('rivalidade',            'jogo', 'raro',     70),
  ('jogo_de_grupo',         'jogo', 'comum',    71),
  ('liga_interna',          'jogo', 'raro',     72),
  -- torneios
  ('estreia_em_torneio',    'torneio', 'comum',    90),
  ('podio',                 'torneio', 'raro',     91),
  ('campeao',               'torneio', 'epico',    92),
  ('bicampeao',             'torneio', 'lendario', 93),
  ('invicto_no_torneio',    'torneio', 'lendario', 94),
  ('cabeca_de_serie',       'torneio', 'raro',     95),
  -- aulas e comunidade
  ('aula_experimental',     'aulas', 'comum',       100),
  ('aluno_aplicado',        'aulas', 'raro',        101),
  ('recrutador',            'antiguidade', 'raro',  85),
  ('premio_levantado',      'antiguidade', 'comum', 86),
  ('cartao_completo',       'antiguidade', 'comum', 87)
ON CONFLICT (key) DO NOTHING;

-- ── 3. O verificador ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION check_and_award_achievements(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile profiles;
  -- as 47 de sempre
  v_mixes INTEGER;
  v_mix_wins INTEGER;
  v_games_won INTEGER;
  v_plenos INTEGER;
  v_friendlies INTEGER;
  v_orgs INTEGER;
  v_mondays INTEGER;
  v_weekend INTEGER;
  v_has_late BOOLEAN;
  v_has_early BOOLEAN;
  v_max_week INTEGER;
  v_max_weeks_in_month INTEGER;
  v_kudos_received INTEGER;
  v_kudos_max_one_mix INTEGER;
  v_kudos_given_mixes INTEGER;
  v_has_remontada BOOLEAN;
  -- presença e ritmo
  v_streak_weeks INTEGER;       -- semanas ISO consecutivas com jogo (máx.)
  v_weeks_last_year INTEGER;    -- semanas distintas com jogo nos últimos 365 dias
  v_days_of_week INTEGER;       -- dias da semana distintos com jogo
  v_late21 INTEGER;             -- jogos iniciados ≥21h
  v_afternoon INTEGER;          -- jogos iniciados 17h–18h59
  v_has_return BOOLEAN;         -- voltou depois de ≥60 dias parado
  v_birthday_play BOOLEAN;      -- jogou no dia de anos
  v_locations INTEGER;          -- locais distintos (mixes)
  -- dentro do mix
  v_court1_finish BOOLEAN;      -- acabou no campo 1 (mix com 2+ campos)
  v_escalada BOOLEAN;           -- do último campo ao 1.º na mesma noite (3+ campos)
  v_fundo_ao_topo BOOLEAN;      -- perdeu a ronda 1 e ganhou as restantes (4+ jogos)
  v_roscas INTEGER;             -- jogos ganhos a zero
  v_roscas_max_mix INTEGER;     -- roscas numa só noite
  v_punto_oro INTEGER;          -- jogos ganhos pela diferença mínima
  v_tiebreak_win BOOLEAN;       -- jogo ganho no tie-break (9-8)
  v_formats INTEGER;            -- formatos distintos jogados
  v_final_win BOOLEAN;          -- final de mix por eliminatórias ganha
  -- vitórias e séries
  v_win_streak INTEGER;         -- jogos ganhos seguidos (cronológico, atravessa mixes)
  v_mix_win_streak INTEGER;     -- mixes ganhos seguidos
  v_max_points INTEGER;         -- pontos de clube (máx. entre clubes)
  v_americano_top BOOLEAN;      -- melhor pontuação da noite num americano
  v_upset BOOLEAN;              -- ganhou a dupla 150+ acima (rating do início do mix)
  -- parceiros
  v_partners INTEGER;           -- parceiros distintos
  v_same_partner_max INTEGER;   -- vezes com o mesmo parceiro (máx.)
  v_partner_streak INTEGER;     -- jogos ganhos seguidos com o mesmo parceiro (máx.)
  v_pair_signups INTEGER;       -- inscrições a dois
  -- suplentes, WhatsApp, organização
  v_promoted INTEGER;
  v_promoted_and_won BOOLEAN;
  v_bot_ins INTEGER;
  v_first_in INTEGER;           -- vezes em que foi o 1.º inscrito
  v_created_finished INTEGER;   -- mixes que criou e chegaram ao fim
  -- amigáveis e grupos
  v_session4 BOOLEAN;
  v_rival_max INTEGER;
  v_group_matches INTEGER;
  -- torneios
  v_tourn_categories INTEGER;
  v_podiums INTEGER;
  v_titles INTEGER;
  v_unbeaten_title BOOLEAN;
  v_seed1 BOOLEAN;
  -- aulas e comunidade
  v_lessons INTEGER;
  v_recruits INTEGER;
  v_voucher_used BOOLEAN;
  v_profile_complete BOOLEAN;
BEGIN
  -- Blindagem: as conquistas são um extra — um erro aqui NUNCA pode fazer
  -- rollback a quem nos chamou. Tudo degrada para um WARNING.
  BEGIN

  SELECT * INTO v_profile FROM profiles WHERE id = p_user_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- ── as 47 de sempre (inalterado) ──────────────────────────────────────
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE mps.mix_won),
         COALESCE(SUM(mps.matches_won), 0),
         COUNT(*) FILTER (WHERE mps.matches_played >= 3 AND mps.matches_won = mps.matches_played),
         COUNT(DISTINCT mps.organization_id),
         COUNT(*) FILTER (WHERE EXTRACT(ISODOW FROM g.date AT TIME ZONE 'Europe/Lisbon') = 1)
  INTO v_mixes, v_mix_wins, v_games_won, v_plenos, v_orgs, v_mondays
  FROM mix_player_stats mps
  JOIN games g ON g.id = mps.game_id
  WHERE mps.user_id = p_user_id;

  SELECT COUNT(*) INTO v_friendlies
  FROM private_match_stats pms
  JOIN private_matches pm ON pm.id = pms.private_match_id AND pm.status = 'confirmed'
  WHERE pms.user_id = p_user_id;

  WITH plays AS (
    SELECT g.date AT TIME ZONE 'Europe/Lisbon' AS d
    FROM mix_player_stats mps JOIN games g ON g.id = mps.game_id
    WHERE mps.user_id = p_user_id
    UNION ALL
    SELECT pm.played_at AT TIME ZONE 'Europe/Lisbon'
    FROM private_match_stats pms
    JOIN private_matches pm ON pm.id = pms.private_match_id AND pm.status = 'confirmed'
    WHERE pms.user_id = p_user_id
  ),
  weekly AS (SELECT date_trunc('week', d) AS wk, COUNT(*) AS n FROM plays GROUP BY 1),
  monthly AS (
    SELECT date_trunc('month', d) AS mo, COUNT(DISTINCT date_trunc('week', d)) AS weeks
    FROM plays GROUP BY 1
  ),
  -- semanas consecutivas: numera as semanas distintas e agrupa pelas
  -- diferenças constantes (semana − posição) — cada grupo é uma sequência.
  wk_runs AS (
    SELECT wk, (EXTRACT(EPOCH FROM wk) / 604800)::bigint - ROW_NUMBER() OVER (ORDER BY wk) AS grp
    FROM weekly
  ),
  gaps AS (
    SELECT d - LAG(d) OVER (ORDER BY d) AS gap FROM plays
  )
  SELECT
    COALESCE((SELECT COUNT(*) FROM plays WHERE EXTRACT(ISODOW FROM d) IN (6, 7)), 0),
    COALESCE((SELECT BOOL_OR(EXTRACT(HOUR FROM d) >= 22) FROM plays), FALSE),
    COALESCE((SELECT BOOL_OR(EXTRACT(HOUR FROM d) < 10) FROM plays), FALSE),
    COALESCE((SELECT MAX(n) FROM weekly), 0),
    COALESCE((SELECT MAX(weeks) FROM monthly), 0),
    COALESCE((SELECT MAX(c) FROM (SELECT COUNT(*) AS c FROM wk_runs GROUP BY grp) r), 0),
    COALESCE((SELECT COUNT(DISTINCT date_trunc('week', d)) FROM plays WHERE d >= NOW() AT TIME ZONE 'Europe/Lisbon' - INTERVAL '365 days'), 0),
    COALESCE((SELECT COUNT(DISTINCT EXTRACT(ISODOW FROM d)) FROM plays), 0),
    COALESCE((SELECT COUNT(*) FROM plays WHERE EXTRACT(HOUR FROM d) >= 21), 0),
    COALESCE((SELECT COUNT(*) FROM plays WHERE EXTRACT(HOUR FROM d) BETWEEN 17 AND 18), 0),
    COALESCE((SELECT BOOL_OR(gap >= INTERVAL '60 days') FROM gaps), FALSE),
    COALESCE((SELECT BOOL_OR(v_profile.birthday IS NOT NULL
                             AND EXTRACT(MONTH FROM d) = EXTRACT(MONTH FROM v_profile.birthday)
                             AND EXTRACT(DAY FROM d) = EXTRACT(DAY FROM v_profile.birthday)) FROM plays), FALSE)
  INTO v_weekend, v_has_late, v_has_early, v_max_week, v_max_weeks_in_month,
       v_streak_weeks, v_weeks_last_year, v_days_of_week, v_late21, v_afternoon,
       v_has_return, v_birthday_play;

  SELECT COALESCE(SUM(per_game.n), 0), COALESCE(MAX(per_game.n), 0)
  INTO v_kudos_received, v_kudos_max_one_mix
  FROM (SELECT game_id, COUNT(*) AS n FROM mix_kudos WHERE recipient_id = p_user_id GROUP BY game_id) per_game;

  SELECT COUNT(DISTINCT game_id) INTO v_kudos_given_mixes
  FROM mix_kudos WHERE voter_id = p_user_id;

  SELECT EXISTS (
    SELECT 1
    FROM mix_player_stats mps
    JOIN teams tm ON tm.game_id = mps.game_id
      AND (tm.player1_id = p_user_id OR tm.player2_id = p_user_id)
    JOIN matches m ON m.game_id = mps.game_id
      AND m.round_number = 1
      AND (m.team_a_id = tm.id OR m.team_b_id = tm.id)
      AND m.winner_team_id IS NOT NULL
      AND m.winner_team_id <> tm.id
    WHERE mps.user_id = p_user_id AND mps.mix_won
  ) INTO v_has_remontada;

  -- ── locais e formatos ─────────────────────────────────────────────────
  SELECT COUNT(DISTINCT lower(btrim(g.location))) FILTER (WHERE COALESCE(btrim(g.location), '') <> ''),
         COUNT(DISTINCT g.format) FILTER (WHERE g.format IN ('sobe_desce', 'todos_contra_todos', 'americano'))
  INTO v_locations, v_formats
  FROM mix_player_stats mps JOIN games g ON g.id = mps.game_id
  WHERE mps.user_id = p_user_id;

  -- ── os jogos de cada mix, com a dupla do jogador ──────────────────────
  -- Uma linha por jogo jogado num mix: campo, ronda, o meu score, o do
  -- adversário, se ganhei, quem foi o parceiro, os ratings de início da noite.
  CREATE TEMP TABLE IF NOT EXISTS _ach_games (
    game_id UUID, gdate TIMESTAMPTZ, fmt TEXT, num_courts INTEGER, tiebreak TEXT, phase TEXT,
    round_number INTEGER, court INTEGER, created_at TIMESTAMPTZ,
    my_score INTEGER, opp_score INTEGER, won BOOLEAN, partner UUID,
    my_r NUMERIC, partner_r NUMERIC, opp_r NUMERIC
  ) ON COMMIT DROP;
  TRUNCATE _ach_games;
  INSERT INTO _ach_games
  SELECT g.id, g.date, g.format, g.num_courts, g.tiebreak_8_8, m.phase,
         m.round_number, m.court_number, m.created_at,
         CASE WHEN m.team_a_id = tm.id THEN m.score_a ELSE m.score_b END,
         CASE WHEN m.team_a_id = tm.id THEN m.score_b ELSE m.score_a END,
         m.winner_team_id = tm.id,
         CASE WHEN tm.player1_id = p_user_id THEN tm.player2_id ELSE tm.player1_id END,
         (SELECT s.rating_after - s.rating_delta FROM mix_player_stats s WHERE s.game_id = g.id AND s.user_id = p_user_id),
         (SELECT s.rating_after - s.rating_delta FROM mix_player_stats s WHERE s.game_id = g.id
            AND s.user_id = CASE WHEN tm.player1_id = p_user_id THEN tm.player2_id ELSE tm.player1_id END),
         (SELECT AVG(s.rating_after - s.rating_delta) FROM mix_player_stats s
           WHERE s.game_id = g.id AND s.user_id IN (op.player1_id, op.player2_id))
  FROM mix_player_stats mps
  JOIN games g ON g.id = mps.game_id
  JOIN teams tm ON tm.game_id = g.id AND (tm.player1_id = p_user_id OR tm.player2_id = p_user_id)
  JOIN matches m ON m.game_id = g.id AND (m.team_a_id = tm.id OR m.team_b_id = tm.id)
  JOIN teams op ON op.id = CASE WHEN m.team_a_id = tm.id THEN m.team_b_id ELSE m.team_a_id END
  WHERE mps.user_id = p_user_id AND m.winner_team_id IS NOT NULL;

  -- Campo 1 / escalada / do fundo ao topo — só em mixes com vários campos.
  WITH per_mix AS (
    SELECT game_id, num_courts,
           COUNT(*) AS played,
           MIN(round_number) AS r_first, MAX(round_number) AS r_last,
           (array_agg(court ORDER BY round_number, created_at))[1] AS court_first,
           (array_agg(court ORDER BY round_number DESC, created_at DESC))[1] AS court_last,
           BOOL_OR(round_number = 1 AND NOT won) AS lost_r1,
           BOOL_AND(won) FILTER (WHERE round_number > 1) AS won_rest,
           COUNT(*) FILTER (WHERE round_number > 1) AS n_rest
    FROM _ach_games GROUP BY game_id, num_courts
  )
  SELECT COALESCE(BOOL_OR(num_courts >= 2 AND court_last = 1), FALSE),
         COALESCE(BOOL_OR(num_courts >= 3 AND court_first = num_courts AND court_last = 1), FALSE),
         COALESCE(BOOL_OR(played >= 4 AND lost_r1 AND n_rest >= 3 AND won_rest), FALSE)
  INTO v_court1_finish, v_escalada, v_fundo_ao_topo
  FROM per_mix;

  -- Scores: rosca (ganhar a zero, formatos a pontos: ≥5 pontos meus),
  -- punto de oro (diferença mínima), tie-break (9-8 com regra ligada).
  SELECT COUNT(*) FILTER (WHERE won AND opp_score = 0 AND my_score >= 5),
         COALESCE(MAX(n_roscas), 0),
         COUNT(*) FILTER (WHERE won AND my_score - opp_score = 1),
         COALESCE(BOOL_OR(won AND tiebreak IS NOT NULL AND my_score = 9 AND opp_score = 8), FALSE),
         COALESCE(BOOL_OR(won AND phase = 'final'), FALSE)
  INTO v_roscas, v_roscas_max_mix, v_punto_oro, v_tiebreak_win, v_final_win
  FROM _ach_games a
  LEFT JOIN (SELECT game_id, COUNT(*) AS n_roscas FROM _ach_games
              WHERE won AND opp_score = 0 AND my_score >= 5 GROUP BY game_id) r USING (game_id);

  -- Séries de jogos ganhos (cronológico) e por parceiro.
  WITH ordered AS (
    SELECT won, partner, ROW_NUMBER() OVER (ORDER BY gdate, round_number, created_at) AS rn,
           ROW_NUMBER() OVER (PARTITION BY partner ORDER BY gdate, round_number, created_at) AS rn_p
    FROM _ach_games
  ),
  runs AS (
    SELECT won, partner,
           rn - ROW_NUMBER() OVER (PARTITION BY won ORDER BY rn) AS grp,
           rn_p - ROW_NUMBER() OVER (PARTITION BY partner, won ORDER BY rn_p) AS grp_p
    FROM ordered
  )
  SELECT COALESCE((SELECT MAX(c) FROM (SELECT COUNT(*) AS c FROM runs WHERE won GROUP BY grp) x), 0),
         COALESCE((SELECT MAX(c) FROM (SELECT COUNT(*) AS c FROM runs WHERE won AND partner IS NOT NULL GROUP BY partner, grp_p) y), 0)
  INTO v_win_streak, v_partner_streak;

  -- Mixes ganhos seguidos.
  WITH ordered AS (
    SELECT mps.mix_won, ROW_NUMBER() OVER (ORDER BY g.date, g.id) AS rn
    FROM mix_player_stats mps JOIN games g ON g.id = mps.game_id
    WHERE mps.user_id = p_user_id
  ),
  runs AS (SELECT mix_won, rn - ROW_NUMBER() OVER (PARTITION BY mix_won ORDER BY rn) AS grp FROM ordered)
  SELECT COALESCE(MAX(c), 0) INTO v_mix_win_streak
  FROM (SELECT COUNT(*) AS c FROM runs WHERE mix_won GROUP BY grp) x;

  SELECT COALESCE(MAX(total_points), 0) INTO v_max_points
  FROM player_stats WHERE user_id = p_user_id;

  -- Melhor pontuação da noite num americano.
  SELECT EXISTS (
    SELECT 1 FROM mix_player_stats mps JOIN games g ON g.id = mps.game_id
    WHERE mps.user_id = p_user_id AND g.format = 'americano' AND mps.matches_played > 0
      AND mps.points_earned = (SELECT MAX(points_earned) FROM mix_player_stats WHERE game_id = g.id)
  ) INTO v_americano_top;

  -- Ganhou a uma dupla 150+ acima (média da dupla, ratings do início do mix).
  SELECT COALESCE(BOOL_OR(won AND my_r IS NOT NULL AND partner_r IS NOT NULL AND opp_r IS NOT NULL
                          AND opp_r - (my_r + partner_r) / 2 >= 150), FALSE)
  INTO v_upset FROM _ach_games;

  -- Parceiros.
  SELECT COUNT(DISTINCT partner), COALESCE(MAX(n), 0)
  INTO v_partners, v_same_partner_max
  FROM (SELECT partner, COUNT(DISTINCT game_id) AS n FROM _ach_games WHERE partner IS NOT NULL GROUP BY partner) p;

  SELECT COUNT(*) INTO v_pair_signups
  FROM participants pt JOIN games g ON g.id = pt.game_id
  WHERE pt.user_id = p_user_id AND pt.partner_id IS NOT NULL AND g.status = 'finished';

  -- Suplentes e WhatsApp (participant_events).
  SELECT COUNT(*) FILTER (WHERE action = 'promoted'),
         COUNT(*) FILTER (WHERE action = 'in' AND source = 'bot')
  INTO v_promoted, v_bot_ins
  FROM participant_events WHERE user_id = p_user_id;

  SELECT EXISTS (
    SELECT 1 FROM participant_events pe
    JOIN mix_player_stats mps ON mps.game_id = pe.game_id AND mps.user_id = p_user_id AND mps.mix_won
    WHERE pe.user_id = p_user_id AND pe.action = 'promoted'
  ) INTO v_promoted_and_won;

  -- Primeiro inscrito (em mixes que chegaram ao fim, com 4+ inscritos).
  SELECT COUNT(*) INTO v_first_in
  FROM games g
  WHERE g.status = 'finished'
    AND (SELECT COUNT(*) FROM participants WHERE game_id = g.id) >= 4
    AND p_user_id = (SELECT user_id FROM participants WHERE game_id = g.id ORDER BY created_at, id LIMIT 1);

  SELECT COUNT(*) INTO v_created_finished
  FROM games WHERE created_by = p_user_id AND status = 'finished';

  -- Amigáveis: sessão com 4+ jogos; rival mais frequente.
  SELECT EXISTS (
    SELECT 1 FROM private_matches pm
    JOIN private_match_stats pms ON pms.private_match_id = pm.id AND pms.user_id = p_user_id
    WHERE pm.status = 'confirmed'
    GROUP BY COALESCE(pm.session_id, pm.id)
    HAVING COUNT(*) >= 4
  ) INTO v_session4;

  SELECT COALESCE(MAX(n), 0) INTO v_rival_max
  FROM (
    SELECT opp, COUNT(*) AS n
    FROM (
      SELECT pm.id,
             unnest(CASE WHEN p_user_id IN (pm.team_a_player1_id, pm.team_a_player2_id)
                         THEN ARRAY[pm.team_b_player1_id, pm.team_b_player2_id]
                         ELSE ARRAY[pm.team_a_player1_id, pm.team_a_player2_id] END) AS opp
      FROM private_matches pm
      WHERE pm.status = 'confirmed'
        AND p_user_id IN (pm.team_a_player1_id, pm.team_a_player2_id, pm.team_b_player1_id, pm.team_b_player2_id)
    ) o
    WHERE opp IS NOT NULL
    GROUP BY opp
  ) r;

  SELECT COUNT(*) INTO v_group_matches
  FROM group_matches gm
  WHERE gm.applied_winner_team IS NOT NULL
    AND p_user_id IN (gm.team_a_player1_id, gm.team_a_player2_id, gm.team_b_player1_id, gm.team_b_player2_id);

  -- Torneios.
  SELECT COUNT(DISTINCT category_id),
         COUNT(*) FILTER (WHERE final_position <= 3),
         COUNT(*) FILTER (WHERE final_position = 1),
         COALESCE(BOOL_OR(final_position = 1 AND matches_played > 0 AND matches_won = matches_played), FALSE)
  INTO v_tourn_categories, v_podiums, v_titles, v_unbeaten_title
  FROM tournament_player_stats WHERE user_id = p_user_id AND matches_played > 0;

  SELECT EXISTS (
    SELECT 1 FROM tournament_entries e
    WHERE e.seed_number = 1 AND p_user_id IN (e.player1_id, e.player2_id)
  ) INTO v_seed1;

  -- Aulas, convites, vouchers, perfil.
  SELECT COUNT(*) INTO v_lessons
  FROM lesson_attendees WHERE user_id = p_user_id AND status = 'confirmed';

  SELECT COUNT(*) INTO v_recruits
  FROM organization_invites WHERE invited_by = p_user_id AND status = 'accepted';

  SELECT EXISTS (SELECT 1 FROM vouchers WHERE user_id = p_user_id AND status = 'usado') INTO v_voucher_used;

  v_profile_complete := v_profile.avatar_url IS NOT NULL AND v_profile.dominant_hand IS NOT NULL
                        AND v_profile.birthday IS NOT NULL;

  INSERT INTO player_achievements (user_id, achievement_key)
  SELECT p_user_id, c.key
  FROM (VALUES
    -- ── as 47 de sempre ──
    ('primeira_bola',      v_mixes >= 1),
    ('areia_nos_tenis',    v_mixes >= 5),
    ('cliente_da_casa',    v_mixes >= 10),
    ('residente',          v_mixes >= 25),
    ('meio_cento',         v_mixes >= 50),
    ('centuriao_do_vidro', v_mixes >= 100),
    ('semana_cheia',       v_max_week >= 3),
    ('mes_cheio',          v_max_weeks_in_month >= 4),
    ('ritual_de_segunda',  v_mondays >= 5),
    ('coruja_do_padel',    v_has_late),
    ('madrugador',         v_has_early),
    ('fds_sagrado',        v_weekend >= 10),
    ('primeiro_grito',     v_mix_wins >= 1),
    ('mao_quente',         v_mix_wins >= 5),
    ('dono_do_campo_1',    v_mix_wins >= 10),
    ('dinastia',           v_mix_wins >= 20),
    ('noite_perfeita',     v_plenos >= 1),
    ('bis',                v_plenos >= 2),
    ('bandeja_de_prata',   v_games_won >= 50),
    ('maquina_de_pontos',  v_games_won >= 150),
    ('remontada',          v_has_remontada),
    ('entre_amigos',       v_friendlies >= 1),
    ('circuito_paralelo',  v_friendlies >= 10),
    ('sempre_em_jogo',     v_friendlies >= 25),
    ('calibrado',          v_profile.rating_games >= 8),
    ('fora_da_areia',      v_profile.rating IS NOT NULL AND v_profile.rating >= COALESCE(v_profile.rating_anchor, 900) + 50),
    ('subida_ao_vidro',    v_profile.rating >= 1000),
    ('zona_nobre',         v_profile.rating >= 1200),
    ('ar_rarefeito',       v_profile.rating >= 1400),
    ('gigante',            v_profile.rating >= 1600),
    ('primeiro_escudo',    v_profile.xp >= 50),
    ('escudo_ouro',        v_profile.xp >= 700),
    ('escudo_esmeralda',   v_profile.xp >= 2500),
    ('escudo_diamante',    v_profile.xp >= 7500),
    ('lenda_viva',         v_profile.xp >= 12000),
    ('world_class',        v_profile.xp >= 20000),
    ('primeiro_aplauso',   v_kudos_received >= 1),
    ('bom_de_balneario',   v_kudos_received >= 10),
    ('querido_do_clube',   v_kudos_received >= 25),
    ('idolo_da_bancada',   v_kudos_received >= 50),
    ('mvp_da_noite',       v_kudos_max_one_mix >= 5),
    ('fair_play',          v_kudos_given_mixes >= 10),
    ('socio_fundador',     v_profile.created_at <= '2026-09-30 23:59:59+00' AND (v_mixes + v_friendlies) >= 1),
    ('meio_ano_de_casa',   v_profile.created_at <= NOW() - INTERVAL '6 months' AND (v_mixes + v_friendlies) >= 1),
    ('um_ano_de_casa',     v_profile.created_at <= NOW() - INTERVAL '1 year' AND (v_mixes + v_friendlies) >= 1),
    ('velha_guarda',       v_profile.created_at <= NOW() - INTERVAL '2 years' AND (v_mixes + v_friendlies) >= 1),
    ('embaixador',         v_orgs >= 2),
    -- ── presença e ritmo ──
    ('semana_sim_semana_sim', v_streak_weeks >= 4),
    ('trimestre_de_ferro',    v_streak_weeks >= 12),
    ('ano_sem_falhar',        v_weeks_last_year >= 40),
    ('sete_dias',             v_days_of_week >= 7),
    ('turno_da_noite',        v_late21 >= 10),
    ('fim_de_tarde',          v_afternoon >= 10),
    ('regressado',            v_has_return),
    ('anos_a_jogar',          v_birthday_play),
    ('turista',               v_locations >= 5),
    -- ── dentro do mix ──
    ('campo_1',               v_court1_finish),
    ('escalada',              v_escalada),
    ('do_fundo_ao_topo',      v_fundo_ao_topo),
    ('rosca',                 v_roscas >= 1),
    ('rosca_dupla',           v_roscas_max_mix >= 2),
    ('punto_de_oro',          v_punto_oro >= 1),
    ('nervos_de_aco',         v_punto_oro >= 5),
    ('tie_break',             v_tiebreak_win),
    ('todos_os_formatos',     v_formats >= 3),
    ('final_four',            v_final_win),
    -- ── vitórias e séries ──
    ('em_chamas',             v_win_streak >= 6),
    ('imparavel',             v_win_streak >= 10),
    ('hat_trick',             v_mix_win_streak >= 3),
    ('meio_milhar',           v_max_points >= 500),
    ('recorde_da_casa',       v_americano_top),
    ('contra_a_corrente',     v_upset),
    -- ── parceiros ──
    ('dez_parceiros',         v_partners >= 10),
    ('sociavel',              v_partners >= 25),
    ('toda_a_gente',          v_partners >= 50),
    ('dupla_de_sempre',       v_same_partner_max >= 10),
    ('quimica',               v_partner_streak >= 5),
    ('inscricao_a_dois',      v_pair_signups >= 5),
    -- ── suplentes, WhatsApp, organização ──
    ('salto_do_banco',        v_promoted >= 1),
    ('suplente_de_luxo',      v_promoted_and_won),
    ('in',                    v_bot_ins >= 1),
    ('rei_do_in',             v_bot_ins >= 25),
    ('primeiro_a_chegar',     v_first_in >= 10),
    ('organizador',           v_created_finished >= 1),
    ('anfitriao',             v_created_finished >= 10),
    -- ── amigáveis e grupos ──
    ('sessao_completa',       v_session4),
    ('rivalidade',            v_rival_max >= 5),
    ('jogo_de_grupo',         v_group_matches >= 1),
    ('liga_interna',          v_group_matches >= 10),
    -- ── torneios ──
    ('estreia_em_torneio',    v_tourn_categories >= 1),
    ('podio',                 v_podiums >= 1),
    ('campeao',               v_titles >= 1),
    ('bicampeao',             v_titles >= 2),
    ('invicto_no_torneio',    v_unbeaten_title),
    ('cabeca_de_serie',       v_seed1),
    -- ── aulas e comunidade ──
    ('aula_experimental',     v_lessons >= 1),
    ('aluno_aplicado',        v_lessons >= 10),
    ('recrutador',            v_recruits >= 1),
    ('premio_levantado',      v_voucher_used),
    ('cartao_completo',       v_profile_complete)
  ) AS c(key, earned)
  WHERE c.earned
  ON CONFLICT (user_id, achievement_key) DO NOTHING;

  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'check_and_award_achievements falhou para %: %', p_user_id, SQLERRM;
  END;
END;
$$;

REVOKE ALL ON FUNCTION check_and_award_achievements(UUID) FROM public, anon, authenticated;

-- ── 4. Ganchos novos (triggers) ────────────────────────────────────────
-- Todos AFTER, só chamam o verificador (que engole erros). Nada aqui pode
-- travar a escrita que os disparou.

CREATE OR REPLACE FUNCTION _ach_after_tournament_stats() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM check_and_award_achievements(NEW.user_id);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS ach_tournament_stats ON tournament_player_stats;
CREATE TRIGGER ach_tournament_stats
  AFTER INSERT OR UPDATE OF final_position, matches_won ON tournament_player_stats
  FOR EACH ROW EXECUTE FUNCTION _ach_after_tournament_stats();

CREATE OR REPLACE FUNCTION _ach_after_lesson_attendee() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.user_id IS NOT NULL AND NEW.status = 'confirmed' THEN
    PERFORM check_and_award_achievements(NEW.user_id);
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS ach_lesson_attendee ON lesson_attendees;
CREATE TRIGGER ach_lesson_attendee
  AFTER INSERT OR UPDATE OF status ON lesson_attendees
  FOR EACH ROW EXECUTE FUNCTION _ach_after_lesson_attendee();

CREATE OR REPLACE FUNCTION _ach_after_invite_accepted() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'accepted' THEN
    PERFORM check_and_award_achievements(NEW.invited_by);
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS ach_invite_accepted ON organization_invites;
CREATE TRIGGER ach_invite_accepted
  AFTER UPDATE OF status ON organization_invites
  FOR EACH ROW EXECUTE FUNCTION _ach_after_invite_accepted();

CREATE OR REPLACE FUNCTION _ach_after_voucher_used() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'usado' THEN
    PERFORM check_and_award_achievements(NEW.user_id);
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS ach_voucher_used ON vouchers;
CREATE TRIGGER ach_voucher_used
  AFTER UPDATE OF status ON vouchers
  FOR EACH ROW EXECUTE FUNCTION _ach_after_voucher_used();

-- Perfil: só quando mudam os três campos do "cartão completo".
CREATE OR REPLACE FUNCTION _ach_after_profile_update() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.avatar_url IS NOT NULL AND NEW.dominant_hand IS NOT NULL AND NEW.birthday IS NOT NULL
     AND (OLD.avatar_url IS DISTINCT FROM NEW.avatar_url
          OR OLD.dominant_hand IS DISTINCT FROM NEW.dominant_hand
          OR OLD.birthday IS DISTINCT FROM NEW.birthday) THEN
    PERFORM check_and_award_achievements(NEW.id);
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS ach_profile_update ON profiles;
CREATE TRIGGER ach_profile_update
  AFTER UPDATE OF avatar_url, dominant_hand, birthday ON profiles
  FOR EACH ROW EXECUTE FUNCTION _ach_after_profile_update();

-- Inscrições: suplente promovido e «In» pelo bot valem no momento.
CREATE OR REPLACE FUNCTION _ach_after_participant_event() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.action = 'promoted' OR (NEW.action = 'in' AND NEW.source = 'bot') THEN
    PERFORM check_and_award_achievements(NEW.user_id);
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS ach_participant_event ON participant_events;
CREATE TRIGGER ach_participant_event
  AFTER INSERT ON participant_events
  FOR EACH ROW EXECUTE FUNCTION _ach_after_participant_event();

-- Jogos de grupo: quando o resultado é aplicado.
CREATE OR REPLACE FUNCTION _ach_after_group_match() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pid UUID;
BEGIN
  IF NEW.applied_winner_team IS NOT NULL AND OLD.applied_winner_team IS DISTINCT FROM NEW.applied_winner_team THEN
    FOREACH v_pid IN ARRAY ARRAY[NEW.team_a_player1_id, NEW.team_a_player2_id, NEW.team_b_player1_id, NEW.team_b_player2_id] LOOP
      IF v_pid IS NOT NULL THEN PERFORM check_and_award_achievements(v_pid); END IF;
    END LOOP;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS ach_group_match ON group_matches;
CREATE TRIGGER ach_group_match
  AFTER UPDATE OF applied_winner_team ON group_matches
  FOR EACH ROW EXECUTE FUNCTION _ach_after_group_match();

-- ── 5. Backfill ────────────────────────────────────────────────────────
DO $$
DECLARE r RECORD; n INTEGER := 0;
BEGIN
  FOR r IN SELECT id FROM profiles WHERE COALESCE(rating_games, 0) > 0 OR COALESCE(xp, 0) > 0 LOOP
    PERFORM check_and_award_achievements(r.id);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'Conquistas verificadas para % perfis', n;
END $$;

-- CONFIRMAR:
--   SELECT COUNT(*) FROM achievements;                                   -- 100
--   SELECT achievement_key, COUNT(*) FROM player_achievements
--    WHERE achievement_key IN ('campo_1','rosca','punto_de_oro','dez_parceiros','in')
--    GROUP BY 1 ORDER BY 2 DESC;
