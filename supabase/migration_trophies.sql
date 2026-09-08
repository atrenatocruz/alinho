-- ════════════════════════════════════════════════════════════════════════
-- Estante de Troféus (spec 2026-09-09)
--
-- Conquistas com 4 tiers de raridade (comum/raro/épico/lendário, à PSN,
-- com % de jogadores que as têm calculada ao vivo), ganhas por presença,
-- vitórias, amigáveis, progressão de Elo/XP, kudos, antiguidade — e uma
-- categoria 'evento' para troféus patrocinados entregues à mão.
--
-- O MOTOR É UMA FUNÇÃO PURA DO ESTADO: todos os critérios derivam de
-- dados existentes (mix_player_stats, private_match_stats, mix_kudos,
-- profiles, matches/teams, games.date). check_and_award_trophies() é
-- idempotente (ON CONFLICT DO NOTHING) e por isso o backfill retroativo
-- é grátis — corre no fim desta migração para toda a gente.
--
-- Nomes/descrições vivem nos locales da app (trophies.<key>_name/_desc),
-- não na BD — padrão i18n do resto do produto.
--
-- Correr este ficheiro inteiro no Supabase → SQL Editor.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Catálogo + troféus por jogador ───────────────────────────────────

CREATE TABLE IF NOT EXISTS trophies (
  key TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('jogo','elo','xp','kudos','antiguidade','evento')),
  rarity TEXT NOT NULL CHECK (rarity IN ('comum','raro','epico','lendario')),
  sort INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE IF NOT EXISTS player_trophies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  trophy_key TEXT NOT NULL REFERENCES trophies(key) ON DELETE CASCADE,
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  UNIQUE (user_id, trophy_key)
);

CREATE INDEX IF NOT EXISTS idx_player_trophies_user ON player_trophies (user_id);
CREATE INDEX IF NOT EXISTS idx_player_trophies_key ON player_trophies (trophy_key);

-- O verificador corre por jogador nos caminhos quentes (finalize/confirm/
-- kudos) e filtra estas tabelas por utilizador — os UNIQUEs existentes
-- lideram por game_id e não servem.
CREATE INDEX IF NOT EXISTS idx_mix_player_stats_user ON mix_player_stats (user_id);
CREATE INDEX IF NOT EXISTS idx_mix_kudos_voter ON mix_kudos (voter_id);

ALTER TABLE trophies ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_trophies ENABLE ROW LEVEL SECURITY;

-- Catálogo é público para autenticados (a estante mostra os bloqueados).
DROP POLICY IF EXISTS "Authenticated can view active trophies" ON trophies;
CREATE POLICY "Authenticated can view active trophies"
  ON trophies FOR SELECT TO authenticated USING (active);

-- Troféus ganhos: o próprio e colegas de clube (como os perfis).
DROP POLICY IF EXISTS "Own or org-mates trophies" ON player_trophies;
CREATE POLICY "Own or org-mates trophies"
  ON player_trophies FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR shares_org_with(user_id));
-- Sem policies de escrita — só o verificador (SECURITY DEFINER) escreve.

-- ── 2. Seed do catálogo (47) ────────────────────────────────────────────

INSERT INTO trophies (key, category, rarity, sort) VALUES
  -- presença
  ('primeira_bola',      'jogo', 'comum',    10),
  ('areia_nos_tenis',    'jogo', 'comum',    11),
  ('cliente_da_casa',    'jogo', 'comum',    12),
  ('residente',          'jogo', 'raro',     13),
  ('meio_cento',         'jogo', 'epico',    14),
  ('centuriao_do_vidro', 'jogo', 'lendario', 15),
  ('semana_cheia',       'jogo', 'raro',     16),
  ('mes_cheio',          'jogo', 'epico',    17),
  ('ritual_de_segunda',  'jogo', 'comum',    18),
  ('coruja_do_padel',    'jogo', 'comum',    19),
  ('madrugador',         'jogo', 'comum',    20),
  ('fds_sagrado',        'jogo', 'raro',     21),
  -- vitórias
  ('primeiro_grito',     'jogo', 'comum',    30),
  ('mao_quente',         'jogo', 'raro',     31),
  ('dono_do_campo_1',    'jogo', 'epico',    32),
  ('dinastia',           'jogo', 'lendario', 33),
  ('noite_perfeita',     'jogo', 'raro',     34),
  ('bis',                'jogo', 'epico',    35),
  ('bandeja_de_prata',   'jogo', 'raro',     36),
  ('maquina_de_pontos',  'jogo', 'epico',    37),
  ('remontada',          'jogo', 'epico',    38),
  -- amigáveis
  ('entre_amigos',       'jogo', 'comum',    40),
  ('circuito_paralelo',  'jogo', 'raro',     41),
  ('sempre_em_jogo',     'jogo', 'epico',    42),
  -- elo
  ('calibrado',          'elo', 'comum',     50),
  ('fora_da_areia',      'elo', 'comum',     51),
  ('subida_ao_vidro',    'elo', 'raro',      52),
  ('zona_nobre',         'elo', 'epico',     53),
  ('ar_rarefeito',       'elo', 'lendario',  54),
  ('gigante',            'elo', 'lendario',  55),
  -- xp
  ('primeiro_escudo',    'xp', 'comum',      60),
  ('escudo_ouro',        'xp', 'raro',       61),
  ('escudo_esmeralda',   'xp', 'raro',       62),
  ('escudo_diamante',    'xp', 'epico',      63),
  ('lenda_viva',         'xp', 'lendario',   64),
  ('world_class',        'xp', 'lendario',   65),
  -- kudos
  ('primeiro_aplauso',   'kudos', 'comum',   70),
  ('bom_de_balneario',   'kudos', 'raro',    71),
  ('querido_do_clube',   'kudos', 'epico',   72),
  ('idolo_da_bancada',   'kudos', 'lendario',73),
  ('mvp_da_noite',       'kudos', 'epico',   74),
  ('fair_play',          'kudos', 'raro',    75),
  -- antiguidade e clube
  ('socio_fundador',     'antiguidade', 'lendario', 80),
  ('meio_ano_de_casa',   'antiguidade', 'comum',    81),
  ('um_ano_de_casa',     'antiguidade', 'raro',     82),
  ('velha_guarda',       'antiguidade', 'epico',    83),
  ('embaixador',         'antiguidade', 'raro',     84)
ON CONFLICT (key) DO NOTHING;

-- ── 3. O verificador — função pura do estado ────────────────────────────

CREATE OR REPLACE FUNCTION check_and_award_trophies(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile profiles;
  v_mixes INTEGER;            -- mixes jogados
  v_mix_wins INTEGER;         -- mixes vencidos
  v_games_won INTEGER;        -- jogos individuais ganhos (dentro de mixes)
  v_plenos INTEGER;           -- noites 100% vitórias (≥3 jogos)
  v_friendlies INTEGER;       -- amigáveis confirmados
  v_orgs INTEGER;             -- clubes distintos com mixes jogados
  v_mondays INTEGER;          -- mixes à segunda-feira
  v_weekend INTEGER;          -- jogos (mix+amigável) sáb/dom
  v_has_late BOOLEAN;         -- jogo iniciado ≥22h (Lisboa)
  v_has_early BOOLEAN;        -- jogo iniciado <10h (Lisboa)
  v_max_week INTEGER;         -- máximo de jogos numa semana ISO
  v_max_weeks_in_month INTEGER; -- máx. semanas distintas com jogo num mês
  v_kudos_received INTEGER;
  v_kudos_max_one_mix INTEGER;
  v_kudos_given_mixes INTEGER;
  v_has_remontada BOOLEAN;
BEGIN
  -- Blindagem: os troféus são um extra — um erro aqui (edge case futuro,
  -- typo num critério novo…) NUNCA pode fazer rollback ao finalize_mix/
  -- confirm/kudos que nos chamou e desfazer stats/XP/Elo já escritos.
  -- O bloco interno apanha tudo e degrada para um WARNING.
  BEGIN

  SELECT * INTO v_profile FROM profiles WHERE id = p_user_id;
  IF NOT FOUND THEN RETURN; END IF;

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

  -- "Jogos" temporais = mixes (data do mix) + amigáveis (played_at).
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
  )
  SELECT
    COALESCE((SELECT COUNT(*) FROM plays WHERE EXTRACT(ISODOW FROM d) IN (6, 7)), 0),
    COALESCE((SELECT BOOL_OR(EXTRACT(HOUR FROM d) >= 22) FROM plays), FALSE),
    COALESCE((SELECT BOOL_OR(EXTRACT(HOUR FROM d) < 10) FROM plays), FALSE),
    COALESCE((SELECT MAX(n) FROM weekly), 0),
    COALESCE((SELECT MAX(weeks) FROM monthly), 0)
  INTO v_weekend, v_has_late, v_has_early, v_max_week, v_max_weeks_in_month;

  SELECT COALESCE(SUM(per_game.n), 0),
         COALESCE(MAX(per_game.n), 0)
  INTO v_kudos_received, v_kudos_max_one_mix
  FROM (SELECT game_id, COUNT(*) AS n FROM mix_kudos WHERE recipient_id = p_user_id GROUP BY game_id) per_game;

  SELECT COUNT(DISTINCT game_id) INTO v_kudos_given_mixes
  FROM mix_kudos WHERE voter_id = p_user_id;

  -- Remontada: venceu um mix em que a sua dupla perdeu um jogo na ronda 1.
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

  INSERT INTO player_trophies (user_id, trophy_key)
  SELECT p_user_id, c.key
  FROM (VALUES
    -- presença
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
    -- vitórias
    ('primeiro_grito',     v_mix_wins >= 1),
    ('mao_quente',         v_mix_wins >= 5),
    ('dono_do_campo_1',    v_mix_wins >= 10),
    ('dinastia',           v_mix_wins >= 20),
    ('noite_perfeita',     v_plenos >= 1),
    ('bis',                v_plenos >= 2),
    ('bandeja_de_prata',   v_games_won >= 50),
    ('maquina_de_pontos',  v_games_won >= 150),
    ('remontada',          v_has_remontada),
    -- amigáveis
    ('entre_amigos',       v_friendlies >= 1),
    ('circuito_paralelo',  v_friendlies >= 10),
    ('sempre_em_jogo',     v_friendlies >= 25),
    -- elo
    ('calibrado',          v_profile.rating_games >= 8),
    ('fora_da_areia',      v_profile.rating IS NOT NULL AND v_profile.rating >= COALESCE(v_profile.rating_anchor, 900) + 50),
    ('subida_ao_vidro',    v_profile.rating >= 1000),
    ('zona_nobre',         v_profile.rating >= 1200),
    ('ar_rarefeito',       v_profile.rating >= 1400),
    ('gigante',            v_profile.rating >= 1600),
    -- xp
    ('primeiro_escudo',    v_profile.xp >= 50),
    ('escudo_ouro',        v_profile.xp >= 700),
    ('escudo_esmeralda',   v_profile.xp >= 2500),
    ('escudo_diamante',    v_profile.xp >= 7500),
    ('lenda_viva',         v_profile.xp >= 12000),
    ('world_class',        v_profile.xp >= 20000),
    -- kudos
    ('primeiro_aplauso',   v_kudos_received >= 1),
    ('bom_de_balneario',   v_kudos_received >= 10),
    ('querido_do_clube',   v_kudos_received >= 25),
    ('idolo_da_bancada',   v_kudos_received >= 50),
    ('mvp_da_noite',       v_kudos_max_one_mix >= 5),
    ('fair_play',          v_kudos_given_mixes >= 10),
    -- antiguidade e clube (antiguidade exige ter jogado algo)
    ('socio_fundador',     v_profile.created_at <= '2026-09-30 23:59:59+00' AND (v_mixes + v_friendlies) >= 1),
    ('meio_ano_de_casa',   v_profile.created_at <= NOW() - INTERVAL '6 months' AND (v_mixes + v_friendlies) >= 1),
    ('um_ano_de_casa',     v_profile.created_at <= NOW() - INTERVAL '1 year' AND (v_mixes + v_friendlies) >= 1),
    ('velha_guarda',       v_profile.created_at <= NOW() - INTERVAL '2 years' AND (v_mixes + v_friendlies) >= 1),
    ('embaixador',         v_orgs >= 2)
  ) AS c(key, earned)
  WHERE c.earned
  ON CONFLICT (user_id, trophy_key) DO NOTHING;

  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'check_and_award_trophies falhou para %: %', p_user_id, SQLERRM;
  END;
END;
$$;

REVOKE ALL ON FUNCTION check_and_award_trophies(UUID) FROM public, anon, authenticated;

-- ── 4. Leitura: troféus de um jogador + raridade PSN-style ──────────────
-- rarity_pct = % de jogadores ativos (com rating) que têm o troféu —
-- social proof honesto, calculado ao vivo.

CREATE OR REPLACE FUNCTION get_player_trophies(p_user_id UUID)
RETURNS TABLE (trophy_key TEXT, category TEXT, rarity TEXT, awarded_at TIMESTAMPTZ, rarity_pct NUMERIC)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH active_players AS (
    SELECT COUNT(*) AS n FROM profiles WHERE rating IS NOT NULL
  )
  SELECT pt.trophy_key, t.category, t.rarity, pt.awarded_at,
         -- Numerador e denominador na MESMA população (perfis com rating)
         -- — senão um troféu de evento dado a uma conta sem rating
         -- inflava a percentagem além da escala.
         ROUND(100.0 * (SELECT COUNT(*) FROM player_trophies x
                        JOIN profiles px ON px.id = x.user_id AND px.rating IS NOT NULL
                        WHERE x.trophy_key = pt.trophy_key)
               / GREATEST((SELECT n FROM active_players), 1), 1)
  FROM player_trophies pt
  JOIN trophies t ON t.key = pt.trophy_key AND t.active
  WHERE pt.user_id = p_user_id
  ORDER BY pt.awarded_at DESC;
$$;

REVOKE ALL ON FUNCTION get_player_trophies(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION get_player_trophies(UUID) TO authenticated;

-- ── 5. Troféus de evento (patrocinados) — entrega manual ────────────────

CREATE OR REPLACE FUNCTION admin_award_trophy(p_user_id UUID, p_key TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_platform_admin) THEN
    RAISE EXCEPTION 'Apenas admins da plataforma podem atribuir troféus';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM trophies WHERE key = p_key AND active) THEN
    RAISE EXCEPTION 'Troféu desconhecido: %', p_key;
  END IF;
  INSERT INTO player_trophies (user_id, trophy_key) VALUES (p_user_id, p_key)
  ON CONFLICT (user_id, trophy_key) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION admin_award_trophy(UUID, TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION admin_award_trophy(UUID, TEXT) TO authenticated;

-- ── 6. Ganchos nos pontos de confiança ──────────────────────────────────
-- Recriações completas das versões vivas com UMA linha extra cada
-- (PERFORM check_and_award_trophies) — sem qualquer outra mudança:
-- finalize_mix (base: migration_xp_engagement.sql), confirm_private_match
-- (idem) e give_mix_kudos (base: migration_kudos.sql; verifica recipient
-- E votante, por causa do Fair Play).

CREATE OR REPLACE FUNCTION finalize_mix(p_game_id UUID, p_winner_team_id UUID)
RETURNS void AS $$
DECLARE
  rules JSONB;
  v_org_id UUID;
  v_game_date TIMESTAMPTZ;
BEGIN
  SELECT organization_id, date INTO v_org_id, v_game_date FROM games WHERE id = p_game_id;

  IF NOT EXISTS (
    SELECT 1 FROM memberships
    WHERE organization_id = v_org_id AND user_id = auth.uid() AND is_admin
  ) THEN
    RAISE EXCEPTION 'Apenas admins podem finalizar um mix';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM games WHERE id = p_game_id AND status = 'in_progress') THEN
    RAISE EXCEPTION 'O mix não está a decorrer';
  END IF;

  IF EXISTS (SELECT 1 FROM matches WHERE game_id = p_game_id AND winner_team_id IS NULL) THEN
    RAISE EXCEPTION 'Há jogos sem resultado registado';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM teams WHERE id = p_winner_team_id AND game_id = p_game_id) THEN
    RAISE EXCEPTION 'Dupla vencedora inválida';
  END IF;

  SELECT points_rules INTO rules FROM organizations WHERE id = v_org_id;
  IF rules IS NULL THEN
    rules := '{"point_per_match_played": 1, "point_per_match_win": 3, "point_per_mix_participation": 2, "point_per_mix_win": 10}'::jsonb;
  END IF;

  WITH mt AS (
    SELECT m.winner_team_id AS win_id, t.id AS team_id, t.player1_id, t.player2_id
    FROM matches m
    JOIN teams t ON t.id = m.team_a_id OR t.id = m.team_b_id
    WHERE m.game_id = p_game_id
  ),
  pp AS (
    SELECT unnest(ARRAY[player1_id, player2_id]) AS pid,
           (team_id = win_id) AS won
    FROM mt
  ),
  agg AS (
    SELECT pid,
           COUNT(*) AS played,
           COUNT(*) FILTER (WHERE won) AS wins,
           COUNT(*) FILTER (WHERE NOT won) AS losses
    FROM pp
    WHERE pid IS NOT NULL
    GROUP BY pid
  ),
  scored AS (
    SELECT a.pid, a.played, a.wins, a.losses,
           (a.pid IN (
             SELECT unnest(ARRAY[player1_id, player2_id]) FROM teams WHERE id = p_winner_team_id
           )) AS won_mix
    FROM agg a
    JOIN memberships mb ON mb.user_id = a.pid AND mb.organization_id = v_org_id AND NOT mb.is_guest
  ),
  pcalc AS (
    SELECT pid, played, wins, losses, won_mix,
           (played * COALESCE((rules->>'point_per_match_played')::int, 0)
            + wins * COALESCE((rules->>'point_per_match_win')::int, 0)
            + COALESCE((rules->>'point_per_mix_participation')::int, 0)
            + CASE WHEN won_mix THEN COALESCE((rules->>'point_per_mix_win')::int, 0) ELSE 0 END
           ) AS pts
    FROM scored
  ),
  ins_player_stats AS (
    INSERT INTO player_stats (user_id, organization_id, game_wins, game_losses, mix_wins, mixes_played, total_points)
    SELECT pid, v_org_id, wins, losses, CASE WHEN won_mix THEN 1 ELSE 0 END, 1, pts
    FROM pcalc
    ON CONFLICT (user_id, organization_id) DO UPDATE
    SET game_wins    = player_stats.game_wins    + EXCLUDED.game_wins,
        game_losses  = player_stats.game_losses  + EXCLUDED.game_losses,
        mix_wins     = player_stats.mix_wins     + EXCLUDED.mix_wins,
        mixes_played = player_stats.mixes_played + EXCLUDED.mixes_played,
        total_points = player_stats.total_points + EXCLUDED.total_points,
        updated_at   = NOW()
    RETURNING 1
  ),
  ins_mix_stats AS (
    INSERT INTO mix_player_stats (game_id, user_id, organization_id, matches_played, matches_won, points_earned, mix_won)
    SELECT p_game_id, pid, v_org_id, played, wins, pts, won_mix
    FROM pcalc
    ON CONFLICT (game_id, user_id) DO UPDATE
    SET matches_played = EXCLUDED.matches_played,
        matches_won    = EXCLUDED.matches_won,
        points_earned  = EXCLUDED.points_earned,
        mix_won        = EXCLUDED.mix_won
    RETURNING 1
  ),
  xp_rows AS (
    SELECT pid, 'mix_participation'::text AS kind, 20 AS amount FROM pcalc
    UNION ALL
    SELECT pid, 'mix_games', played * 5 FROM pcalc WHERE played > 0
    UNION ALL
    SELECT pid, 'mix_win', 30 FROM pcalc WHERE won_mix
  ),
  ins_xp AS (
    INSERT INTO xp_events (user_id, organization_id, kind, source_game_id, amount, occurred_at)
    SELECT pid, v_org_id, kind, p_game_id, amount, v_game_date
    FROM xp_rows
    ON CONFLICT (user_id, kind, source_game_id) WHERE source_game_id IS NOT NULL DO NOTHING
    RETURNING user_id, amount
  )
  UPDATE profiles p
  SET xp = p.xp + s.total,
      last_played_at = GREATEST(COALESCE(p.last_played_at, v_game_date), v_game_date)
  FROM (SELECT user_id, SUM(amount) AS total FROM ins_xp GROUP BY user_id) s
  WHERE p.id = s.user_id;

  PERFORM apply_mix_elo(p_game_id, p_winner_team_id);

  UPDATE games
  SET status = 'finished', winner_team_id = p_winner_team_id, updated_at = NOW()
  WHERE id = p_game_id;

  -- Troféus: estado já todo escrito (stats, XP, Elo) — verificar todos os
  -- jogadores do mix.
  PERFORM check_and_award_trophies(mps.user_id)
  FROM mix_player_stats mps WHERE mps.game_id = p_game_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION confirm_private_match(p_match_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match private_matches;
  v_confirmer UUID := auth.uid();
  v_submitter_team TEXT;
  v_confirmer_team TEXT;
  pl RECORD;
  v_point_per_match_played CONSTANT INTEGER := 1;
  v_point_per_match_win CONSTANT INTEGER := 3;
BEGIN
  SELECT * INTO v_match FROM private_matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jogo não encontrado';
  END IF;
  IF v_match.status <> 'pending' THEN
    RAISE EXCEPTION 'Este jogo já foi confirmado';
  END IF;
  IF v_match.team_a_player2_id IS NULL OR v_match.team_b_player1_id IS NULL OR v_match.team_b_player2_id IS NULL THEN
    RAISE EXCEPTION 'Faltam jogadores para confirmar o jogo';
  END IF;
  IF v_match.winner_team IS NULL THEN
    RAISE EXCEPTION 'Ainda não há resultado registado';
  END IF;
  IF v_match.score_submitted_by IS NULL THEN
    RAISE EXCEPTION 'Volta a inserir o resultado para poder ser confirmado';
  END IF;

  IF NOT (v_confirmer = ANY (ARRAY[
    v_match.team_a_player1_id, v_match.team_a_player2_id,
    v_match.team_b_player1_id, v_match.team_b_player2_id
  ])) THEN
    RAISE EXCEPTION 'Só os jogadores do jogo podem confirmar o resultado';
  END IF;

  v_submitter_team := CASE
    WHEN v_match.score_submitted_by IN (v_match.team_a_player1_id, v_match.team_a_player2_id) THEN 'a'
    ELSE 'b'
  END;
  v_confirmer_team := CASE
    WHEN v_confirmer IN (v_match.team_a_player1_id, v_match.team_a_player2_id) THEN 'a'
    ELSE 'b'
  END;
  IF v_confirmer_team = v_submitter_team THEN
    RAISE EXCEPTION 'O resultado tem de ser confirmado por um jogador da equipa adversária';
  END IF;

  UPDATE private_matches
  SET status = 'confirmed', confirmed_at = TIMEZONE('utc', NOW())
  WHERE id = p_match_id;

  INSERT INTO private_match_stats (private_match_id, user_id, points_earned, won)
  VALUES
    (p_match_id, v_match.team_a_player1_id,
     v_point_per_match_played + CASE WHEN v_match.winner_team = 'a' THEN v_point_per_match_win ELSE 0 END,
     v_match.winner_team = 'a'),
    (p_match_id, v_match.team_a_player2_id,
     v_point_per_match_played + CASE WHEN v_match.winner_team = 'a' THEN v_point_per_match_win ELSE 0 END,
     v_match.winner_team = 'a'),
    (p_match_id, v_match.team_b_player1_id,
     v_point_per_match_played + CASE WHEN v_match.winner_team = 'b' THEN v_point_per_match_win ELSE 0 END,
     v_match.winner_team = 'b'),
    (p_match_id, v_match.team_b_player2_id,
     v_point_per_match_played + CASE WHEN v_match.winner_team = 'b' THEN v_point_per_match_win ELSE 0 END,
     v_match.winner_team = 'b');

  FOR pl IN
    SELECT * FROM apply_elo_pairing(
      v_match.team_a_player1_id, v_match.team_a_player2_id,
      v_match.team_b_player1_id, v_match.team_b_player2_id,
      CASE WHEN v_match.winner_team = 'a' THEN 1 ELSE 0 END
    )
  LOOP
    UPDATE private_match_stats
    SET rating_delta = ROUND(pl.delta, 2),
        rating_after = ROUND((SELECT COALESCE(pr.rating, 900) FROM profiles pr WHERE pr.id = pl.pid), 2)
    WHERE private_match_id = p_match_id AND user_id = pl.pid;
  END LOOP;

  WITH players AS (
    SELECT t.pid, t.won FROM (VALUES
      (v_match.team_a_player1_id, v_match.winner_team = 'a'),
      (v_match.team_a_player2_id, v_match.winner_team = 'a'),
      (v_match.team_b_player1_id, v_match.winner_team = 'b'),
      (v_match.team_b_player2_id, v_match.winner_team = 'b')
    ) AS t(pid, won)
  ),
  xp_rows AS (
    SELECT pid, 'friendly_match'::text AS kind, 10 AS amount FROM players
    UNION ALL
    SELECT pid, 'friendly_win', 5 FROM players WHERE won
  ),
  ins_xp AS (
    INSERT INTO xp_events (user_id, kind, source_private_match_id, amount)
    SELECT pid, kind, p_match_id, amount FROM xp_rows
    ON CONFLICT (user_id, kind, source_private_match_id)
      WHERE source_private_match_id IS NOT NULL DO NOTHING
    RETURNING user_id, amount
  )
  UPDATE profiles p
  SET xp = p.xp + s.total,
      last_played_at = GREATEST(COALESCE(p.last_played_at, NOW()), NOW())
  FROM (SELECT user_id, SUM(amount) AS total FROM ins_xp GROUP BY user_id) s
  WHERE p.id = s.user_id;

  -- Troféus para os 4.
  PERFORM check_and_award_trophies(t.pid)
  FROM unnest(ARRAY[
    v_match.team_a_player1_id, v_match.team_a_player2_id,
    v_match.team_b_player1_id, v_match.team_b_player2_id
  ]) AS t(pid);
END;
$$;

REVOKE ALL ON FUNCTION confirm_private_match(UUID) FROM public;
GRANT EXECUTE ON FUNCTION confirm_private_match(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION give_mix_kudos(p_game_id UUID, p_recipient_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_game games;
  v_voter UUID := auth.uid();
BEGIN
  SELECT * INTO v_game FROM games WHERE id = p_game_id;
  IF NOT FOUND OR v_game.status <> 'finished' THEN
    RAISE EXCEPTION 'O mix ainda não terminou';
  END IF;
  IF NOW() > v_game.date + INTERVAL '48 hours' THEN
    RAISE EXCEPTION 'O período para dar kudos deste mix já fechou';
  END IF;
  IF p_recipient_id = v_voter THEN
    RAISE EXCEPTION 'Não podes dar kudos a ti próprio';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM participants
    WHERE game_id = p_game_id AND status = 'confirmed'
      AND (user_id = v_voter OR partner_id = v_voter)
  ) THEN
    RAISE EXCEPTION 'Só quem jogou o mix pode dar kudos';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM participants
    WHERE game_id = p_game_id AND status = 'confirmed'
      AND (user_id = p_recipient_id OR partner_id = p_recipient_id)
  ) THEN
    RAISE EXCEPTION 'Esse jogador não jogou este mix';
  END IF;

  BEGIN
    INSERT INTO mix_kudos (game_id, voter_id, recipient_id)
    VALUES (p_game_id, v_voter, p_recipient_id);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Já deste o teu kudos neste mix';
  END;

  INSERT INTO xp_events (user_id, organization_id, kind, source_game_id, amount)
  VALUES (p_recipient_id, v_game.organization_id, 'kudos', p_game_id, 1)
  ON CONFLICT (user_id, kind, source_game_id) WHERE source_game_id IS NOT NULL
  DO UPDATE SET amount = xp_events.amount + 1;

  UPDATE profiles SET xp = xp + 1 WHERE id = p_recipient_id;

  -- Troféus: recipient (Primeiro Aplauso, MVP…) e votante (Fair Play).
  PERFORM check_and_award_trophies(p_recipient_id);
  PERFORM check_and_award_trophies(v_voter);
END;
$$;

REVOKE ALL ON FUNCTION give_mix_kudos(UUID, UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION give_mix_kudos(UUID, UUID) TO authenticated;

-- ── 7. Backfill retroativo — grátis, porque o motor deriva do estado ────

SELECT check_and_award_trophies(id)
FROM profiles
WHERE rating_games > 0 OR xp > 0;

-- Conferência: troféus por jogador, mais raros primeiro.
SELECT p.name, COUNT(*) AS trofeus,
       COUNT(*) FILTER (WHERE t.rarity = 'lendario') AS lendarios,
       COUNT(*) FILTER (WHERE t.rarity = 'epico') AS epicos,
       STRING_AGG(pt.trophy_key, ', ' ORDER BY t.sort) AS lista
FROM player_trophies pt
JOIN profiles p ON p.id = pt.user_id
JOIN trophies t ON t.key = pt.trophy_key
GROUP BY p.name
ORDER BY COUNT(*) DESC
LIMIT 25;
