-- ════════════════════════════════════════════════════════════════════════
-- Migration: mix com ou sem ranking (Trello #267, épico #263)
--
-- Decisão do Francisco, 16 set 2026:
-- • Quem cria o mix escolhe se conta para o ranking; por omissão conta.
-- • Um mix "sem ranking" (amigável) fica fora do ranking Geral (pontos /
--   Elo), do Por Clube (player_stats) e do Mensal (a app filtra na leitura).
-- • Continua a contar: presença e XP (Assiduidade), mix_player_stats (para
--   o histórico do perfil e o próprio mix), troféus e vouchers do vencedor.
-- • Proposta, a confirmar com o Renato: só se muda antes de o mix começar.
--
-- PRÉ-REQUISITOS, por esta ordem (as funções abaixo são cópias das versões
-- mais recentes destes ficheiros, só com as linhas do "amigável" a mais):
--   1. migration_vouchers.sql                 (finalize_mix)
--   2. migration_americano_format.sql         (finalize_americano_mix)
--   3. migration_post_close_mix_correction.sql (correct_finished_mix_match)
--   4. migration_mix_pairing_mode.sql         (process_due_game_recurrences)
--   5. este ficheiro
--
-- apply_mix_elo NÃO é redefinida: quem a chama é que deixa de a chamar num
-- mix amigável. A recalibração (migration_elo_backfill_v3.sql) passa a
-- saltar mixes amigáveis — ver o filtro acrescentado nesse ficheiro.
--
-- Mixes que já existem ficam com ranked = TRUE — nada muda para ninguém.
-- A app só envia `ranked` quando é FALSE (mesmo truque do pool_size), por
-- isso criar mixes continua a funcionar antes de isto correr.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. O campo no mix e no molde das séries recorrentes ──────────────────
ALTER TABLE games ADD COLUMN IF NOT EXISTS ranked BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE game_recurrences ADD COLUMN IF NOT EXISTS ranked BOOLEAN NOT NULL DEFAULT TRUE;

-- ── 2. Só se muda antes de o mix começar (proposta, a confirmar com o
--       Renato): depois de haver jogos a decorrer ou fechados, trocar
--       deixava o ranking a meio de contas feitas com a outra regra. ─────
CREATE OR REPLACE FUNCTION prevent_ranked_change_after_start()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.ranked IS DISTINCT FROM OLD.ranked AND OLD.status IN ('in_progress', 'finished') THEN
    RAISE EXCEPTION 'Não é possível mudar se o mix conta para o ranking depois de começar';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_prevent_ranked_change_after_start ON games;
CREATE TRIGGER trg_prevent_ranked_change_after_start
BEFORE UPDATE OF ranked ON games
FOR EACH ROW EXECUTE FUNCTION prevent_ranked_change_after_start();

-- ── 3. finalize_mix — cópia de migration_vouchers.sql + amigável ─────────
CREATE OR REPLACE FUNCTION finalize_mix(p_game_id UUID, p_winner_team_id UUID)
RETURNS void AS $$
DECLARE
  rules JSONB;
  v_org_id UUID;
  v_game_date TIMESTAMPTZ;
  v_ranked BOOLEAN;
BEGIN
  SELECT organization_id, date, ranked INTO v_org_id, v_game_date, v_ranked FROM games WHERE id = p_game_id;

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
    WHERE v_ranked  -- mix amigável: não soma no ranking Por Clube
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

  -- Mix amigável: não mexe nos pontos do ranking Geral.
  IF v_ranked THEN
    PERFORM apply_mix_elo(p_game_id, p_winner_team_id);
  END IF;

  UPDATE games
  SET status = 'finished', winner_team_id = p_winner_team_id, updated_at = NOW()
  WHERE id = p_game_id;

  -- Troféus: estado já todo escrito (stats, XP, Elo) — verificar todos os
  -- jogadores do mix.
  PERFORM check_and_award_trophies(mps.user_id)
  FROM mix_player_stats mps WHERE mps.game_id = p_game_id;

  -- Vouchers (Trello #200): só a dupla vencedora, só se o mix tiver
  -- has_voucher=true. Idempotente via UNIQUE(game_id, user_id).
  IF (SELECT has_voucher FROM games WHERE id = p_game_id) THEN
    INSERT INTO vouchers (game_id, user_id, organization_id)
    SELECT p_game_id, pid, v_org_id
    FROM (
      SELECT player1_id AS pid FROM teams WHERE id = p_winner_team_id
      UNION ALL
      SELECT player2_id FROM teams WHERE id = p_winner_team_id
    ) winners
    WHERE pid IS NOT NULL
    ON CONFLICT (game_id, user_id) DO NOTHING;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── 4. finalize_americano_mix — cópia de migration_americano_format.sql
--       + amigável ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION finalize_americano_mix(p_game_id UUID)
RETURNS void AS $$
DECLARE
  rules JSONB;
  v_org_id UUID;
  v_game_date TIMESTAMPTZ;
  v_ranked BOOLEAN;
BEGIN
  SELECT organization_id, date, ranked INTO v_org_id, v_game_date, v_ranked FROM games WHERE id = p_game_id;

  IF NOT EXISTS (
    SELECT 1 FROM memberships
    WHERE organization_id = v_org_id AND user_id = auth.uid() AND is_admin
  ) THEN
    RAISE EXCEPTION 'Apenas admins podem finalizar um mix';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM games WHERE id = p_game_id AND status = 'in_progress' AND format = 'americano'
  ) THEN
    RAISE EXCEPTION 'O mix não está a decorrer ou não é Americano';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM matches WHERE game_id = p_game_id AND winner_team_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Não há resultados registados';
  END IF;

  SELECT points_rules INTO rules FROM organizations WHERE id = v_org_id;
  IF rules IS NULL THEN
    rules := '{"point_per_match_played": 1, "point_per_match_win": 3, "point_per_mix_participation": 2, "point_per_mix_win": 10}'::jsonb;
  END IF;

  WITH mt AS (
    SELECT m.winner_team_id AS win_id, m.score_a, m.score_b,
           ta.id AS team_a_id, ta.player1_id AS a1, ta.player2_id AS a2,
           tb.id AS team_b_id, tb.player1_id AS b1, tb.player2_id AS b2
    FROM matches m
    JOIN teams ta ON ta.id = m.team_a_id
    JOIN teams tb ON tb.id = m.team_b_id
    WHERE m.game_id = p_game_id AND m.winner_team_id IS NOT NULL
  ),
  pp AS (
    SELECT a1 AS pid, score_a AS scored, (win_id = team_a_id) AS won FROM mt
    UNION ALL
    SELECT a2 AS pid, score_a AS scored, (win_id = team_a_id) AS won FROM mt
    UNION ALL
    SELECT b1 AS pid, score_b AS scored, (win_id = team_b_id) AS won FROM mt
    UNION ALL
    SELECT b2 AS pid, score_b AS scored, (win_id = team_b_id) AS won FROM mt
  ),
  agg AS (
    SELECT pid,
           COUNT(*) AS played,
           COUNT(*) FILTER (WHERE won) AS wins,
           COUNT(*) FILTER (WHERE NOT won) AS losses,
           COALESCE(SUM(scored), 0) AS total_scored
    FROM pp
    WHERE pid IS NOT NULL
    GROUP BY pid
  ),
  scored AS (
    SELECT a.*
    FROM agg a
    JOIN memberships mb ON mb.user_id = a.pid AND mb.organization_id = v_org_id AND NOT mb.is_guest
  ),
  ranked AS (
    SELECT *, (total_scored = MAX(total_scored) OVER ()) AS won_mix
    FROM scored
  ),
  pcalc AS (
    SELECT pid, played, wins, losses, won_mix,
           (played * COALESCE((rules->>'point_per_match_played')::int, 0)
            + wins * COALESCE((rules->>'point_per_match_win')::int, 0)
            + COALESCE((rules->>'point_per_mix_participation')::int, 0)
            + CASE WHEN won_mix THEN COALESCE((rules->>'point_per_mix_win')::int, 0) ELSE 0 END
           ) AS pts
    FROM ranked
  ),
  ins_player_stats AS (
    INSERT INTO player_stats (user_id, organization_id, game_wins, game_losses, mix_wins, mixes_played, total_points)
    SELECT pid, v_org_id, wins, losses, CASE WHEN won_mix THEN 1 ELSE 0 END, 1, pts
    FROM pcalc
    WHERE v_ranked  -- mix amigável: não soma no ranking Por Clube
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

  -- Per-match Elo (unaffected by format — reads matches/teams directly,
  -- never assumes a player kept one partner for the whole mix). The
  -- "vencedor do mix" merit bonus inside apply_mix_elo is gated behind
  -- p_winner_team_id IS NOT NULL — passing NULL here correctly skips
  -- only that bonus (Americano has no single winning dupla to award it
  -- to), while every per-match rating update still applies normally.
  -- Mix amigável: não mexe nos pontos do ranking Geral.
  IF v_ranked THEN
    PERFORM apply_mix_elo(p_game_id, NULL);
  END IF;

  UPDATE games
  SET status = 'finished', winner_team_id = NULL, updated_at = NOW()
  WHERE id = p_game_id;

  -- Troféus: estado já todo escrito (stats, XP, Elo) — verificar todos os
  -- jogadores do mix.
  PERFORM check_and_award_achievements(mps.user_id)
  FROM mix_player_stats mps WHERE mps.game_id = p_game_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION finalize_americano_mix(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION finalize_americano_mix(UUID) TO authenticated;

-- ── 5. correct_finished_mix_match — cópia de
--       migration_post_close_mix_correction.sql + amigável ─────────────────
CREATE OR REPLACE FUNCTION correct_finished_mix_match(
  p_match_id UUID,
  p_new_score_a INTEGER,
  p_new_score_b INTEGER,
  p_new_winner_team_id UUID,
  p_sets JSONB DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match matches;
  v_game games;
  rules JSONB;
  v_old_winner_team_id UUID;
  v_winner_changed BOOLEAN;
  v_mix_players UUID[];
  v_elo_applied BOOLEAN := FALSE;
  v_elo_skip_reason TEXT := NULL;
  v_voucher_not_reverted BOOLEAN := FALSE;
  v_voucher_status TEXT;
  v_pid UUID;
BEGIN
  -- 1. Lock and validate
  SELECT * INTO v_match FROM matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jogo não encontrado';
  END IF;

  SELECT * INTO v_game FROM games WHERE id = v_match.game_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mix não encontrado';
  END IF;

  IF v_game.status <> 'finished' THEN
    RAISE EXCEPTION 'Este mix não está terminado — usa a correção normal de resultado';
  END IF;
  IF v_game.format = 'americano' THEN
    RAISE EXCEPTION 'A correção pós-fecho não está disponível para mixes Americano';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM memberships
    WHERE organization_id = v_game.organization_id AND user_id = auth.uid() AND is_admin
  ) THEN
    RAISE EXCEPTION 'Apenas admins podem corrigir um resultado depois do mix terminado';
  END IF;

  IF p_new_score_a IS NULL OR p_new_score_b IS NULL OR p_new_score_a = p_new_score_b
     OR p_new_score_a < 0 OR p_new_score_b < 0 THEN
    RAISE EXCEPTION 'Resultado inválido';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM teams WHERE id = p_new_winner_team_id AND game_id = v_game.id) THEN
    RAISE EXCEPTION 'Dupla vencedora inválida';
  END IF;

  v_old_winner_team_id := v_game.winner_team_id;

  -- 2. Apply the corrected match
  UPDATE matches
  SET score_a = p_new_score_a,
      score_b = p_new_score_b,
      winner_team_id = CASE WHEN p_new_score_a > p_new_score_b THEN v_match.team_a_id ELSE v_match.team_b_id END
  WHERE id = p_match_id;

  IF p_sets IS NOT NULL THEN
    DELETE FROM match_sets WHERE match_id = p_match_id;
    INSERT INTO match_sets (match_id, set_number, score_a, score_b, is_super_tiebreak)
    SELECT p_match_id, ROW_NUMBER() OVER (), (s->>'score_a')::int, (s->>'score_b')::int,
           COALESCE((s->>'is_super_tiebreak')::boolean, FALSE)
    FROM jsonb_array_elements(p_sets) AS s;
  END IF;

  v_winner_changed := (p_new_winner_team_id IS DISTINCT FROM v_old_winner_team_id);

  -- 3. Points + mix-participation totals — recompute the whole mix's
  --    pcalc (same shape finalize_mix uses) and diff against what's
  --    currently stored, rather than trying to isolate just the players
  --    the corrected match touches.
  SELECT points_rules INTO rules FROM organizations WHERE id = v_game.organization_id;
  IF rules IS NULL THEN
    rules := '{"point_per_match_played": 1, "point_per_match_win": 3, "point_per_mix_participation": 2, "point_per_mix_win": 10}'::jsonb;
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _mix_pcalc (
    pid UUID PRIMARY KEY, played INT, wins INT, losses INT, won_mix BOOLEAN, pts INT
  ) ON COMMIT DROP;
  TRUNCATE _mix_pcalc;

  INSERT INTO _mix_pcalc
  WITH mt AS (
    SELECT m.winner_team_id AS win_id, t.id AS team_id, t.player1_id, t.player2_id
    FROM matches m JOIN teams t ON t.id = m.team_a_id OR t.id = m.team_b_id
    WHERE m.game_id = v_game.id
  ),
  pp AS (SELECT unnest(ARRAY[player1_id, player2_id]) AS pid, (team_id = win_id) AS won FROM mt),
  agg AS (
    SELECT pid, COUNT(*) played, COUNT(*) FILTER (WHERE won) wins, COUNT(*) FILTER (WHERE NOT won) losses
    FROM pp WHERE pid IS NOT NULL GROUP BY pid
  ),
  scored AS (
    SELECT a.pid, a.played, a.wins, a.losses,
           (a.pid IN (SELECT unnest(ARRAY[player1_id, player2_id]) FROM teams WHERE id = p_new_winner_team_id)) AS won_mix
    FROM agg a JOIN memberships mb ON mb.user_id = a.pid AND mb.organization_id = v_game.organization_id AND NOT mb.is_guest
  )
  SELECT pid, played, wins, losses, won_mix,
         (played * COALESCE((rules->>'point_per_match_played')::int, 0)
          + wins * COALESCE((rules->>'point_per_match_win')::int, 0)
          + COALESCE((rules->>'point_per_mix_participation')::int, 0)
          + CASE WHEN won_mix THEN COALESCE((rules->>'point_per_mix_win')::int, 0) ELSE 0 END) AS pts
  FROM scored;

  UPDATE player_stats ps
  SET game_wins    = ps.game_wins    + (c.wins   - old.matches_won),
      game_losses  = ps.game_losses  + (c.losses - (old.matches_played - old.matches_won)),
      mix_wins     = ps.mix_wins     + (c.won_mix::int - old.mix_won::int),
      total_points = ps.total_points + (c.pts    - old.points_earned),
      updated_at   = NOW()
  FROM _mix_pcalc c JOIN mix_player_stats old ON old.game_id = v_game.id AND old.user_id = c.pid
  WHERE ps.user_id = c.pid AND ps.organization_id = v_game.organization_id
    AND v_game.ranked;  -- mix amigável: nunca entrou no Por Clube, não há nada a corrigir lá
  -- mixes_played never changes — the correction doesn't add or remove a
  -- match, only rescores one.

  UPDATE mix_player_stats mps
  SET matches_played = c.played,
      matches_won    = c.wins,
      points_earned  = c.pts,
      mix_won        = c.won_mix
  FROM _mix_pcalc c
  WHERE mps.game_id = v_game.id AND mps.user_id = c.pid;

  -- 4. mix_win XP — insert for new winners, delete for former winners
  --    (amount > 0 CHECK rules out an in-place 0<->30 update; losers
  --    never had a row to begin with — finalize_mix only ever inserts
  --    mix_win WHERE won_mix). mix_participation/mix_games untouched:
  --    nobody's played count changes from a same-match-count correction.
  WITH losers_of_flip AS (
    SELECT unnest(ARRAY[player1_id, player2_id]) AS pid
    FROM teams WHERE id = v_old_winner_team_id
    EXCEPT
    SELECT unnest(ARRAY[player1_id, player2_id]) FROM teams WHERE id = p_new_winner_team_id
  ),
  removed AS (
    DELETE FROM xp_events
    WHERE kind = 'mix_win' AND source_game_id = v_game.id
      AND user_id IN (SELECT pid FROM losers_of_flip WHERE pid IS NOT NULL)
    RETURNING user_id
  )
  UPDATE profiles p SET xp = p.xp - 30 FROM removed WHERE p.id = removed.user_id;

  WITH new_winners AS (
    SELECT unnest(ARRAY[player1_id, player2_id]) AS pid
    FROM teams WHERE id = p_new_winner_team_id
    EXCEPT
    SELECT unnest(ARRAY[player1_id, player2_id]) FROM teams WHERE id = v_old_winner_team_id
  ),
  inserted AS (
    INSERT INTO xp_events (user_id, organization_id, kind, source_game_id, amount, occurred_at)
    SELECT pid, v_game.organization_id, 'mix_win', v_game.id, 30, v_game.date
    FROM new_winners WHERE pid IS NOT NULL
    ON CONFLICT (user_id, kind, source_game_id) WHERE source_game_id IS NOT NULL DO NOTHING
    RETURNING user_id
  )
  UPDATE profiles p SET xp = p.xp + 30 FROM inserted WHERE p.id = inserted.user_id;

  -- 5. Elo — conditional revert + reapply, all-or-nothing across every
  --    player who appears in any match of this mix (apply_mix_elo's
  --    bonus redistribution touches the whole roster, not just the
  --    corrected match's four).
  v_mix_players := ARRAY(
    SELECT DISTINCT unnest(ARRAY[t.player1_id, t.player2_id])
    FROM matches m JOIN teams t ON t.id = m.team_a_id OR t.id = m.team_b_id
    WHERE m.game_id = v_game.id
  );

  -- Untracked-participant guard: a guest's Elo delta is applied to
  -- profiles.rating by apply_mix_elo but never recorded in
  -- mix_player_stats (its closing UPDATE only matches existing rows,
  -- and guests never get one — see the design doc). Reverting the
  -- trackable players and blindly re-running apply_mix_elo would
  -- double-apply an untracked guest's contribution.
  IF EXISTS (
    SELECT 1 FROM unnest(v_mix_players) pid
    WHERE NOT EXISTS (
      SELECT 1 FROM mix_player_stats mps
      WHERE mps.game_id = v_game.id AND mps.user_id = pid AND mps.rating_delta IS NOT NULL
    )
  ) THEN
    v_elo_skip_reason := 'untracked_participant';
  END IF;

  IF v_elo_skip_reason IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM unnest(v_mix_players) pid
      WHERE _has_later_elo_event(pid, v_game.date, v_game.id)
    ) THEN
      v_elo_skip_reason := 'later_elo_event';
    ELSE
      v_elo_applied := TRUE;
    END IF;
  END IF;

  -- Mix amigável: nunca mexeu no ranking Geral, por isso não há Elo a
  -- reverter nem a reaplicar.
  IF NOT v_game.ranked THEN
    v_elo_applied := FALSE;
    v_elo_skip_reason := 'sem_ranking';
  END IF;

  IF v_elo_applied THEN
    UPDATE profiles pr
    SET rating = GREATEST(0, COALESCE(pr.rating, 900) - mps.rating_delta)
    FROM mix_player_stats mps
    WHERE mps.game_id = v_game.id AND mps.user_id = pr.id AND mps.rating_delta IS NOT NULL;

    PERFORM apply_mix_elo(v_game.id, p_new_winner_team_id);
  END IF;

  -- 6. games.winner_team_id
  UPDATE games SET winner_team_id = p_new_winner_team_id, updated_at = NOW() WHERE id = v_game.id;

  -- 7. Achievements — re-check, never revoke (award-only, ON CONFLICT DO
  --    NOTHING; multiple mixes can contribute to the same threshold, so
  --    there's no clean "this trophy came from this mix" to undo anyway).
  PERFORM check_and_award_trophies(mps.user_id) FROM mix_player_stats mps WHERE mps.game_id = v_game.id;

  -- 8. Vouchers — only if has_voucher and the winner actually changed.
  IF v_game.has_voucher AND v_winner_changed THEN
    FOR v_pid IN SELECT unnest(ARRAY[player1_id, player2_id]) FROM teams WHERE id = v_old_winner_team_id LOOP
      CONTINUE WHEN v_pid IS NULL;
      SELECT status INTO v_voucher_status FROM vouchers WHERE game_id = v_game.id AND user_id = v_pid;
      IF v_voucher_status = 'por_usar' THEN
        DELETE FROM vouchers WHERE game_id = v_game.id AND user_id = v_pid;
      ELSIF v_voucher_status = 'usado' THEN
        v_voucher_not_reverted := TRUE;
      END IF;
    END LOOP;

    INSERT INTO vouchers (game_id, user_id, organization_id)
    SELECT v_game.id, w.pid, v_game.organization_id
    FROM (
      SELECT player1_id AS pid FROM teams WHERE id = p_new_winner_team_id
      UNION ALL SELECT player2_id FROM teams WHERE id = p_new_winner_team_id
    ) w
    WHERE w.pid IS NOT NULL
    ON CONFLICT (game_id, user_id) DO NOTHING;
  END IF;

  -- 9. Result summary for the frontend
  RETURN jsonb_build_object(
    'new_winner_team_id', p_new_winner_team_id,
    'winner_changed', v_winner_changed,
    'elo_applied', v_elo_applied,
    'elo_skip_reason', v_elo_skip_reason,
    'voucher_not_reverted', v_voucher_not_reverted
  );
END;
$$;

REVOKE ALL ON FUNCTION correct_finished_mix_match(UUID, INTEGER, INTEGER, UUID, JSONB) FROM public, anon;
GRANT EXECUTE ON FUNCTION correct_finished_mix_match(UUID, INTEGER, INTEGER, UUID, JSONB) TO authenticated;

-- ── 6. process_due_game_recurrences — cópia de
--       migration_mix_pairing_mode.sql + ranked copiado do molde ───────────
CREATE OR REPLACE FUNCTION process_due_game_recurrences()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec RECORD;
  v_new_date TIMESTAMPTZ;
BEGIN
  FOR rec IN
    SELECT g.id AS pending_game_id, g.date AS pending_date, gr.*
    FROM games g
    JOIN game_recurrences gr ON gr.id = g.recurrence_id
    WHERE g.status = 'pending' AND g.launch_at <= now() AND gr.is_active = true
    FOR UPDATE OF g SKIP LOCKED
  LOOP
    IF EXISTS (
      SELECT 1 FROM games
      WHERE recurrence_id = rec.id AND status IN ('open', 'closed', 'in_progress')
    ) THEN
      CONTINUE;
    END IF;

    UPDATE games SET status = 'open', updated_at = now(), launch_at = NULL WHERE id = rec.pending_game_id;

    v_new_date := (
      (rec.pending_date AT TIME ZONE 'Europe/Lisbon') + (CASE rec.frequency
            WHEN 'daily'   THEN interval '1 day'
            WHEN 'weekly'  THEN interval '1 week'
            WHEN 'monthly' THEN interval '1 month'
            WHEN 'yearly'  THEN interval '1 year'
          END)
    ) AT TIME ZONE 'Europe/Lisbon';

    IF (rec.ends_type = 'on_date' AND v_new_date > rec.ends_on)
       OR (rec.ends_type = 'after_occurrences' AND rec.occurrences_created >= rec.ends_after_occurrences) THEN
      UPDATE game_recurrences SET is_active = false, updated_at = now() WHERE id = rec.id;
      CONTINUE;
    END IF;

    INSERT INTO games (
      organization_id, title, date, location, price_per_player, prize, has_voucher,
      num_courts, max_players, court_time_minutes, game_time_minutes, format,
      gender_restriction, auto_start_hours_before, level, pairing_mode, rotate_partners, ranked,
      status, created_by, recurrence_id, is_recurrence_origin, launch_at
    )
    VALUES (
      rec.organization_id, rec.title, v_new_date, rec.location, rec.price_per_player, rec.prize, rec.has_voucher,
      rec.num_courts, rec.num_courts * 4, rec.court_time_minutes, rec.game_time_minutes, rec.format,
      rec.gender_restriction, rec.auto_start_hours_before, rec.level, rec.pairing_mode, rec.rotate_partners, rec.ranked,
      'pending', rec.created_by, rec.id, false,
      v_new_date - make_interval(secs => rec.mix_offset_seconds)
    )
    ON CONFLICT (recurrence_id, date) WHERE recurrence_id IS NOT NULL DO NOTHING;

    UPDATE game_recurrences
    SET occurrences_created = occurrences_created + 1, updated_at = now()
    WHERE id = rec.id;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION process_due_game_recurrences() FROM public;
