-- ════════════════════════════════════════════════════════════════════════
-- Conquistas: libertar os nomes "trophies" na BD (decisão Ruben, 10 set)
--
-- O que hoje se chama "Estante de troféus" são CONQUISTAS (achievements à
-- Steam/Xbox/Strava): desbloqueáveis automáticos, função pura do estado.
-- O nome "troféus" fica reservado para a futura estante REAL — troféus de
-- torneios/mixes configurados por clube, com prémios (vouchers) — por isso
-- as tabelas/funções mudam de nome já, enquanto a feature é nova.
--
-- trophies                  → achievements
-- player_trophies           → player_achievements (trophy_key → achievement_key)
-- check_and_award_trophies  → check_and_award_achievements (+ wrapper compat)
-- get_player_trophies       → get_player_achievements     (+ wrapper compat)
-- admin_award_trophy        → admin_award_achievement     (antigo apagado)
--
-- Os wrappers compat existem porque (a) finalize_mix/confirm_private_match/
-- give_mix_kudos (versões vivas de migration_trophies.sql) chamam
-- check_and_award_trophies — assim não é preciso recriá-los; e (b) clientes
-- com o PWA em cache continuam a chamar get_player_trophies até recarregar.
-- Limpeza dos wrappers: quando estas funções deixarem de ter tráfego.
--
-- Correr este ficheiro inteiro no Supabase → SQL Editor, ANTES do deploy
-- do frontend que chama get_player_achievements.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Renomear tabelas, coluna e índices ───────────────────────────────
-- RENAME preserva dados, PK/FK/UNIQUE, RLS e policies (movem com a tabela).

ALTER TABLE trophies RENAME TO achievements;
ALTER TABLE player_trophies RENAME TO player_achievements;
ALTER TABLE player_achievements RENAME COLUMN trophy_key TO achievement_key;

ALTER INDEX idx_player_trophies_user RENAME TO idx_player_achievements_user;
ALTER INDEX idx_player_trophies_key RENAME TO idx_player_achievements_key;

-- ── 2. O verificador, com o nome novo ───────────────────────────────────
-- Corpo idêntico ao de migration_trophies.sql, só com as tabelas/colunas
-- renomeadas. Continua idempotente e blindado (EXCEPTION → WARNING).

CREATE OR REPLACE FUNCTION check_and_award_achievements(p_user_id UUID)
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
  -- Blindagem: as conquistas são um extra — um erro aqui (edge case
  -- futuro, typo num critério novo…) NUNCA pode fazer rollback ao
  -- finalize_mix/confirm/kudos que nos chamou e desfazer stats/XP/Elo já
  -- escritos. O bloco interno apanha tudo e degrada para um WARNING.
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

  INSERT INTO player_achievements (user_id, achievement_key)
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
  ON CONFLICT (user_id, achievement_key) DO NOTHING;

  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'check_and_award_achievements falhou para %: %', p_user_id, SQLERRM;
  END;
END;
$$;

REVOKE ALL ON FUNCTION check_and_award_achievements(UUID) FROM public, anon, authenticated;

-- ── 3. Wrapper compat: os ganchos existentes continuam a funcionar ──────
-- finalize_mix, confirm_private_match e give_mix_kudos (versões vivas de
-- migration_trophies.sql) chamam check_and_award_trophies — este wrapper
-- evita recriar as três. Apagar quando essas funções forem redefinidas a
-- chamar o nome novo.

CREATE OR REPLACE FUNCTION check_and_award_trophies(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM check_and_award_achievements(p_user_id);
END;
$$;

REVOKE ALL ON FUNCTION check_and_award_trophies(UUID) FROM public, anon, authenticated;

-- ── 4. Leitura com o nome novo + wrapper compat para PWA em cache ───────

CREATE OR REPLACE FUNCTION get_player_achievements(p_user_id UUID)
RETURNS TABLE (achievement_key TEXT, category TEXT, rarity TEXT, awarded_at TIMESTAMPTZ, rarity_pct NUMERIC)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH active_players AS (
    SELECT COUNT(*) AS n FROM profiles WHERE rating IS NOT NULL
  )
  SELECT pa.achievement_key, a.category, a.rarity, pa.awarded_at,
         -- Numerador e denominador na MESMA população (perfis com rating)
         -- — senão uma conquista de evento dada a uma conta sem rating
         -- inflava a percentagem além da escala.
         ROUND(100.0 * (SELECT COUNT(*) FROM player_achievements x
                        JOIN profiles px ON px.id = x.user_id AND px.rating IS NOT NULL
                        WHERE x.achievement_key = pa.achievement_key)
               / GREATEST((SELECT n FROM active_players), 1), 1)
  FROM player_achievements pa
  JOIN achievements a ON a.key = pa.achievement_key AND a.active
  WHERE pa.user_id = p_user_id
  ORDER BY pa.awarded_at DESC;
$$;

REVOKE ALL ON FUNCTION get_player_achievements(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION get_player_achievements(UUID) TO authenticated;

-- Compat: clientes com o PWA em cache chamam este nome até recarregarem.
-- Mesma forma de retorno de sempre (trophy_key). Apagar daqui a umas semanas.
CREATE OR REPLACE FUNCTION get_player_trophies(p_user_id UUID)
RETURNS TABLE (trophy_key TEXT, category TEXT, rarity TEXT, awarded_at TIMESTAMPTZ, rarity_pct NUMERIC)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT achievement_key, category, rarity, awarded_at, rarity_pct
  FROM get_player_achievements(p_user_id);
$$;

REVOKE ALL ON FUNCTION get_player_trophies(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION get_player_trophies(UUID) TO authenticated;

-- ── 5. Entrega manual (evento) com o nome novo; o antigo desaparece ─────

DROP FUNCTION IF EXISTS admin_award_trophy(UUID, TEXT);

CREATE OR REPLACE FUNCTION admin_award_achievement(p_user_id UUID, p_key TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_platform_admin) THEN
    RAISE EXCEPTION 'Apenas admins da plataforma podem atribuir conquistas';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM achievements WHERE key = p_key AND active) THEN
    RAISE EXCEPTION 'Conquista desconhecida: %', p_key;
  END IF;
  INSERT INTO player_achievements (user_id, achievement_key) VALUES (p_user_id, p_key)
  ON CONFLICT (user_id, achievement_key) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION admin_award_achievement(UUID, TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION admin_award_achievement(UUID, TEXT) TO authenticated;

-- ── 6. Celebrações: corpo atualizado para as tabelas novas ──────────────
-- A forma de retorno NÃO muda (trophy_key continua a ser o nome da coluna
-- devolvida): é a API dos clientes já publicados, e renomeá-la não liberta
-- nada — o nome de função "get_unseen_celebrations" é genérico.

CREATE OR REPLACE FUNCTION get_unseen_celebrations()
RETURNS TABLE (kind TEXT, trophy_key TEXT, rarity TEXT, kudos_count BIGINT, game_title TEXT, happened_at TIMESTAMPTZ)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH me AS (
    SELECT id, COALESCE(celebrations_seen_at, '-infinity'::timestamptz) AS seen
    FROM profiles WHERE id = auth.uid()
  )
  -- O alias happened_at no 1º ramo é obrigatório: num UNION, o ORDER BY
  -- final resolve pelos nomes de coluna do primeiro SELECT.
  SELECT 'trophy'::text AS kind, pa.achievement_key AS trophy_key, a.rarity,
         NULL::bigint AS kudos_count, NULL::text AS game_title,
         pa.awarded_at AS happened_at
  FROM player_achievements pa
  JOIN achievements a ON a.key = pa.achievement_key AND a.active
  JOIN me ON pa.user_id = me.id AND pa.awarded_at > me.seen
  UNION ALL
  SELECT 'kudos', NULL, NULL, COUNT(*)::bigint, g.title, MAX(k.created_at)
  FROM mix_kudos k
  JOIN games g ON g.id = k.game_id
  JOIN me ON k.recipient_id = me.id AND k.created_at > me.seen
  GROUP BY g.id, g.title
  ORDER BY happened_at DESC;
$$;

REVOKE ALL ON FUNCTION get_unseen_celebrations() FROM public, anon;
GRANT EXECUTE ON FUNCTION get_unseen_celebrations() TO authenticated;
