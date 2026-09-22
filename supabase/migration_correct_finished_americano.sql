-- ════════════════════════════════════════════════════════════════════════
-- Corrigir um resultado depois do mix fechar passa a funcionar em TODOS os
-- formatos, incluindo Americano (Trello #377).
--
-- Regra do Francisco (22 set 2026): «o admin pode sempre corrigir, mesmo
-- depois de fechado — pode haver erros humanos». O Americano era o único
-- formato de fora: correct_finished_mix_match recusava-o com
-- «A correção pós-fecho não está disponível para mixes Americano», e o
-- ecrã, sem vencedor calculável, saía em silêncio.
--
-- PORQUE ESTAVA DE FORA: nos outros formatos cada jogador mantém o parceiro
-- todo o mix e há uma DUPLA vencedora (games.winner_team_id) — os pontos, o
-- XP de vitória, o voucher e o bónus de Elo penduram-se nela. No Americano
-- troca-se de parceiro a cada ronda e quem ganha é UM JOGADOR, o que somou
-- mais pontos (ver finalize_americano_mix: won_mix = total_scored máximo,
-- e games.winner_team_id fica NULL).
--
-- O QUE MUDA AQUI
--   - p_new_winner_team_id passa a poder ser NULL, e é ignorado no
--     Americano;
--   - o recálculo de quem «ganhou o mix» passa a ter dois caminhos: dupla
--     vencedora (como antes) ou jogador com mais pontos (Americano, mesma
--     conta do finalize_americano_mix);
--   - o XP de vitória deixa de ser calculado a partir das duplas e passa a
--     sair da comparação entre o mix_won antigo e o novo — funciona igual
--     nos dois casos;
--   - o Elo reaplica-se com apply_mix_elo(jogo, NULL) no Americano, tal
--     como o finalize_americano_mix já faz (só o bónus de vencedor do mix
--     fica de fora, os pontos por jogo aplicam-se na mesma);
--   - vouchers: só nos formatos com dupla vencedora (o Americano não os
--     emite).
--
-- Tudo o resto — travões de admin, mix terminado, resultado válido, guardas
-- do Elo (convidado sem registo, jogo posterior) — fica como estava.
--
-- Ordem: depois de migration_post_close_mix_correction.sql. É seguro
-- re-correr.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION correct_finished_mix_match(
  p_match_id UUID,
  p_new_score_a INTEGER,
  p_new_score_b INTEGER,
  p_new_winner_team_id UUID DEFAULT NULL,
  p_sets JSONB DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_match matches;
  v_game games;
  rules JSONB;
  v_is_americano BOOLEAN;
  v_old_winner_team_id UUID;
  v_winner_changed BOOLEAN;
  v_mix_players UUID[];
  v_elo_applied BOOLEAN := FALSE;
  v_elo_skip_reason TEXT := NULL;
  v_voucher_not_reverted BOOLEAN := FALSE;
  v_voucher_status TEXT;
  v_pid UUID;
BEGIN
  -- ── 1. Travões ─────────────────────────────────────────────────────────
  SELECT * INTO v_match FROM matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Jogo não encontrado'; END IF;

  SELECT * INTO v_game FROM games WHERE id = v_match.game_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Mix não encontrado'; END IF;

  IF v_game.status <> 'finished' THEN
    RAISE EXCEPTION 'Este mix não está terminado — usa a correção normal de resultado';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM memberships
    WHERE organization_id = v_game.organization_id AND user_id = auth.uid() AND is_admin
  ) THEN
    RAISE EXCEPTION 'Apenas admins podem corrigir um resultado depois do mix terminado';
  END IF;

  IF p_new_score_a IS NULL OR p_new_score_b IS NULL
     OR p_new_score_a = p_new_score_b OR p_new_score_a < 0 OR p_new_score_b < 0 THEN
    RAISE EXCEPTION 'Resultado inválido';
  END IF;

  v_is_americano := (v_game.format = 'americano');

  -- No Americano não há dupla vencedora do mix: o que vier é ignorado.
  IF v_is_americano THEN
    p_new_winner_team_id := NULL;
  ELSE
    IF p_new_winner_team_id IS NULL THEN
      RAISE EXCEPTION 'Falta a dupla vencedora do mix';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM teams WHERE id = p_new_winner_team_id AND game_id = v_game.id) THEN
      RAISE EXCEPTION 'Dupla vencedora inválida';
    END IF;
  END IF;

  v_old_winner_team_id := v_game.winner_team_id;

  -- ── 2. Aplicar o resultado corrigido ───────────────────────────────────
  UPDATE matches SET
    score_a = p_new_score_a,
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

  -- ── 3. Pontos e totais do mix ──────────────────────────────────────────
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
    SELECT m.winner_team_id AS win_id, m.score_a, m.score_b,
           ta.id AS team_a_id, ta.player1_id AS a1, ta.player2_id AS a2,
           tb.id AS team_b_id, tb.player1_id AS b1, tb.player2_id AS b2
    FROM matches m
    JOIN teams ta ON ta.id = m.team_a_id
    JOIN teams tb ON tb.id = m.team_b_id
    WHERE m.game_id = v_game.id AND m.winner_team_id IS NOT NULL
  ), pp AS (
    SELECT a1 AS pid, score_a AS scored, (win_id = team_a_id) AS won FROM mt
    UNION ALL SELECT a2, score_a, (win_id = team_a_id) FROM mt
    UNION ALL SELECT b1, score_b, (win_id = team_b_id) FROM mt
    UNION ALL SELECT b2, score_b, (win_id = team_b_id) FROM mt
  ), agg AS (
    SELECT pid, COUNT(*) AS played,
           COUNT(*) FILTER (WHERE won) AS wins,
           COUNT(*) FILTER (WHERE NOT won) AS losses,
           COALESCE(SUM(scored), 0) AS total_scored
    FROM pp WHERE pid IS NOT NULL GROUP BY pid
  ), tracked AS (
    SELECT a.* FROM agg a
    JOIN memberships mb ON mb.user_id = a.pid
      AND mb.organization_id = v_game.organization_id AND NOT mb.is_guest
  ), com_vencedor AS (
    -- Dois caminhos para "ganhou o mix": dupla vencedora nos formatos com
    -- parceiro fixo; jogador com mais pontos no Americano (mesma conta do
    -- finalize_americano_mix).
    SELECT t.*,
      CASE WHEN v_is_americano
        THEN (t.total_scored = MAX(t.total_scored) OVER ())
        ELSE (t.pid IN (SELECT unnest(ARRAY[player1_id, player2_id]) FROM teams WHERE id = p_new_winner_team_id))
      END AS won_mix
    FROM tracked t
  )
  SELECT pid, played, wins, losses, won_mix,
    (played * COALESCE((rules->>'point_per_match_played')::int, 0)
     + wins * COALESCE((rules->>'point_per_match_win')::int, 0)
     + COALESCE((rules->>'point_per_mix_participation')::int, 0)
     + CASE WHEN won_mix THEN COALESCE((rules->>'point_per_mix_win')::int, 0) ELSE 0 END) AS pts
  FROM com_vencedor;

  UPDATE player_stats ps SET
    game_wins = ps.game_wins + (c.wins - old.matches_won),
    game_losses = ps.game_losses + (c.losses - (old.matches_played - old.matches_won)),
    mix_wins = ps.mix_wins + (c.won_mix::int - old.mix_won::int),
    total_points = ps.total_points + (c.pts - old.points_earned),
    updated_at = NOW()
  FROM _mix_pcalc c
  JOIN mix_player_stats old ON old.game_id = v_game.id AND old.user_id = c.pid
  WHERE ps.user_id = c.pid AND ps.organization_id = v_game.organization_id AND v_game.ranked;

  -- Quem deixou de ganhar / passou a ganhar o mix — comparado com o que
  -- estava gravado, em vez de sair das duplas. Funciona nos dois casos e
  -- tem de ser lido ANTES de mix_player_stats ser reescrito.
  CREATE TEMP TABLE IF NOT EXISTS _mix_win_flips (pid UUID PRIMARY KEY, ganhou_agora BOOLEAN) ON COMMIT DROP;
  TRUNCATE _mix_win_flips;
  INSERT INTO _mix_win_flips
  SELECT c.pid, c.won_mix
  FROM _mix_pcalc c
  JOIN mix_player_stats old ON old.game_id = v_game.id AND old.user_id = c.pid
  WHERE c.won_mix IS DISTINCT FROM old.mix_won;

  v_winner_changed := EXISTS (SELECT 1 FROM _mix_win_flips);

  UPDATE mix_player_stats mps SET
    matches_played = c.played, matches_won = c.wins,
    points_earned = c.pts, mix_won = c.won_mix
  FROM _mix_pcalc c
  WHERE mps.game_id = v_game.id AND mps.user_id = c.pid;

  -- ── 4. XP de vitória do mix ────────────────────────────────────────────
  WITH removed AS (
    DELETE FROM xp_events
    WHERE kind = 'mix_win' AND source_game_id = v_game.id
      AND user_id IN (SELECT pid FROM _mix_win_flips WHERE NOT ganhou_agora)
    RETURNING user_id
  )
  UPDATE profiles p SET xp = p.xp - 30 FROM removed WHERE p.id = removed.user_id;

  WITH inserted AS (
    INSERT INTO xp_events (user_id, organization_id, kind, source_game_id, amount, occurred_at)
    SELECT pid, v_game.organization_id, 'mix_win', v_game.id, 30, v_game.date
    FROM _mix_win_flips WHERE ganhou_agora
    ON CONFLICT (user_id, kind, source_game_id) WHERE source_game_id IS NOT NULL DO NOTHING
    RETURNING user_id
  )
  UPDATE profiles p SET xp = p.xp + 30 FROM inserted WHERE p.id = inserted.user_id;

  -- ── 5. Elo ─────────────────────────────────────────────────────────────
  v_mix_players := ARRAY(
    SELECT DISTINCT unnest(ARRAY[t.player1_id, t.player2_id])
    FROM matches m JOIN teams t ON t.id = m.team_a_id OR t.id = m.team_b_id
    WHERE m.game_id = v_game.id
  );

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
    IF EXISTS (SELECT 1 FROM unnest(v_mix_players) pid WHERE _has_later_elo_event(pid, v_game.date, v_game.id)) THEN
      v_elo_skip_reason := 'later_elo_event';
    ELSE
      v_elo_applied := TRUE;
    END IF;
  END IF;

  IF NOT v_game.ranked THEN
    v_elo_applied := FALSE;
    v_elo_skip_reason := 'sem_ranking';
  END IF;

  IF v_elo_applied THEN
    UPDATE profiles pr SET rating = GREATEST(0, COALESCE(pr.rating, 900) - mps.rating_delta)
    FROM mix_player_stats mps
    WHERE mps.game_id = v_game.id AND mps.user_id = pr.id AND mps.rating_delta IS NOT NULL;
    -- NULL no Americano: os pontos por jogo aplicam-se na mesma, só o
    -- bónus de vencedor do mix é que não existe (igual ao finalize).
    PERFORM apply_mix_elo(v_game.id, p_new_winner_team_id);
  END IF;

  -- ── 6. Vencedor do mix ─────────────────────────────────────────────────
  UPDATE games SET winner_team_id = p_new_winner_team_id, updated_at = NOW()
  WHERE id = v_game.id;

  -- ── 7. Troféus (só se dão, nunca se tiram) ─────────────────────────────
  PERFORM check_and_award_trophies(mps.user_id)
  FROM mix_player_stats mps WHERE mps.game_id = v_game.id;

  -- ── 8. Vouchers — só onde há dupla vencedora ───────────────────────────
  IF v_game.has_voucher AND v_winner_changed AND NOT v_is_americano THEN
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

  RETURN jsonb_build_object(
    'new_winner_team_id', p_new_winner_team_id,
    'winner_changed', v_winner_changed,
    'elo_applied', v_elo_applied,
    'elo_skip_reason', v_elo_skip_reason,
    'voucher_not_reverted', v_voucher_not_reverted
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION correct_finished_mix_match(UUID, INTEGER, INTEGER, UUID, JSONB) FROM public, anon;
GRANT EXECUTE ON FUNCTION correct_finished_mix_match(UUID, INTEGER, INTEGER, UUID, JSONB) TO authenticated;

-- ── Verificação ──────────────────────────────────────────────────────────
-- SELECT pg_get_functiondef(oid) ~ 'não está disponível para mixes Americano' AS ainda_recusa_americano
-- FROM pg_proc WHERE proname = 'correct_finished_mix_match';
