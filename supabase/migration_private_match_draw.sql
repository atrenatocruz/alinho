-- ════════════════════════════════════════════════════════════════════════
-- JOGO ENTRE AMIGOS: EMPATE PERMITIDO, E NÃO CONTA PARA O RANKING
-- (23 set 2026) — cartão #420. Decidido pelo Francisco a 22 set: no jogo
-- amigável o empate é permitido, com o resultado anulado para o ranking e
-- um aviso a explicar isso. (Mix e torneio ficam sem empates.)
--
-- CORRER DEPOIS de migration_private_match_ranked_consent.sql e de
-- migration_private_match_confirm_restore_xp.sql (redefine as duas funções
-- a partir das versões de lá). Pode-se correr outra vez sem estragar.
--
-- 1. private_matches.winner_team aceita 'draw'.
-- 2. submit_private_match_score: resultados iguais gravam-se como 'draw'.
-- 3. confirm_private_match: um empate confirma-se e dá o XP de jogo jogado
--    a todos (sem o de vitória), mas nunca entra no ranking (sem
--    private_match_stats, sem Elo), mesmo que o jogo fosse rankeado.
--
-- ATENÇÃO: migration_elo_backfill_v2/v3.sql tratam qualquer winner_team que
-- não seja 'a' como vitória da equipa B. Se algum dia se voltarem a correr,
-- têm de passar a saltar os 'draw'.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE private_matches DROP CONSTRAINT IF EXISTS private_matches_winner_team_check;
ALTER TABLE private_matches ADD CONSTRAINT private_matches_winner_team_check
  CHECK (winner_team IN ('a', 'b', 'draw'));

CREATE OR REPLACE FUNCTION submit_private_match_score(
  p_match_id UUID, p_score_a INTEGER, p_score_b INTEGER, p_sets JSONB DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match private_matches;
  v_set JSONB;
  v_set_number INTEGER := 0;
BEGIN
  SELECT * INTO v_match FROM private_matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jogo não encontrado';
  END IF;
  IF v_match.status <> 'pending' THEN
    RAISE EXCEPTION 'Este jogo já foi confirmado, o resultado não pode ser alterado';
  END IF;
  IF NOT (auth.uid() = ANY (ARRAY_REMOVE(ARRAY[
    v_match.team_a_player1_id, v_match.team_a_player2_id,
    v_match.team_b_player1_id, v_match.team_b_player2_id
  ], NULL))) THEN
    RAISE EXCEPTION 'Só os jogadores do jogo podem inserir o resultado';
  END IF;
  IF (v_match.team_a_player2_id IS NULL AND v_match.team_a_player2_guest_name IS NULL)
     OR (v_match.team_b_player1_id IS NULL AND v_match.team_b_player1_guest_name IS NULL)
     OR (v_match.team_b_player2_id IS NULL AND v_match.team_b_player2_guest_name IS NULL) THEN
    RAISE EXCEPTION 'O resultado só pode ser inserido com as equipas completas';
  END IF;
  -- Empate deixa de ser inválido (#420): fica registado como 'draw'.
  IF p_score_a IS NULL OR p_score_b IS NULL THEN
    RAISE EXCEPTION 'Resultado inválido';
  END IF;
  IF p_score_a < 0 OR p_score_b < 0 THEN
    RAISE EXCEPTION 'Resultado inválido';
  END IF;

  UPDATE private_matches
  SET score_a = p_score_a,
      score_b = p_score_b,
      winner_team = CASE WHEN p_score_a > p_score_b THEN 'a'
                         WHEN p_score_b > p_score_a THEN 'b'
                         ELSE 'draw' END,
      score_submitted_by = auth.uid()
  WHERE id = p_match_id;

  -- Formato pontos_simples/pro_set_9 não manda sets — limpa quaisquer
  -- linhas de uma correção anterior que tenha mudado de formato.
  DELETE FROM private_match_sets WHERE private_match_id = p_match_id;
  IF p_sets IS NOT NULL THEN
    FOR v_set IN SELECT * FROM jsonb_array_elements(p_sets) LOOP
      v_set_number := v_set_number + 1;
      INSERT INTO private_match_sets (private_match_id, set_number, score_a, score_b, is_super_tiebreak)
      VALUES (
        p_match_id, v_set_number,
        (v_set ->> 'score_a')::INTEGER, (v_set ->> 'score_b')::INTEGER,
        COALESCE((v_set ->> 'is_super_tiebreak')::BOOLEAN, FALSE)
      );
    END LOOP;
  END IF;
END;
$$;

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
  v_opponent_has_real_player BOOLEAN;
  v_all_ranked BOOLEAN;
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
  IF (v_match.team_a_player2_id IS NULL AND v_match.team_a_player2_guest_name IS NULL)
     OR (v_match.team_b_player1_id IS NULL AND v_match.team_b_player1_guest_name IS NULL)
     OR (v_match.team_b_player2_id IS NULL AND v_match.team_b_player2_guest_name IS NULL) THEN
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
    -- Confirmação cruzada normal exige a equipa adversária — mas se essa
    -- equipa for só nomes sem conta (guests), ninguém lá consegue sequer
    -- iniciar sessão para confirmar. Nesse caso, e só nesse caso, a
    -- própria equipa pode confirmar — não há alternativa possível.
    v_opponent_has_real_player := CASE
      WHEN v_submitter_team = 'a' THEN (v_match.team_b_player1_id IS NOT NULL OR v_match.team_b_player2_id IS NOT NULL)
      ELSE (v_match.team_a_player1_id IS NOT NULL OR v_match.team_a_player2_id IS NOT NULL)
    END;
    IF v_opponent_has_real_player THEN
      RAISE EXCEPTION 'O resultado tem de ser confirmado por um jogador da equipa adversária';
    END IF;
  END IF;

  -- Ranked "a sério" só quando: intenção ranked, ninguém é convidado sem
  -- conta, e os 4 lugares aceitaram tudo. Falhando isto, o jogo confirma
  -- na mesma mas fica amigável — sem Elo, sem pontos no ranking global
  -- (ver nota no topo do ficheiro).
  v_all_ranked := v_match.ranked_intent
    AND v_match.team_a_player2_guest_name IS NULL
    AND v_match.team_b_player1_guest_name IS NULL
    AND v_match.team_b_player2_guest_name IS NULL
    AND v_match.team_a_player1_status = 'accepted_all'
    AND v_match.team_a_player2_status = 'accepted_all'
    AND v_match.team_b_player1_status = 'accepted_all'
    AND v_match.team_b_player2_status = 'accepted_all'
    -- Um empate nunca conta para o ranking: confirma-se, dá XP de jogo
    -- jogado, mas sem pontos nem Elo (Francisco, 22 set — #420).
    AND v_match.winner_team <> 'draw';

  UPDATE private_matches
  SET status = 'confirmed', confirmed_at = TIMEZONE('utc', NOW())
  WHERE id = p_match_id;

  IF v_all_ranked THEN
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
  END IF;

  -- XP e conquistas: TODOS os jogos confirmados (rankeados ou amigáveis) —
  -- o XP premeia ter jogado, não o ranking. Estava em migration_trophies.sql
  -- e perdeu-se quando migration_private_match_ranked_consent.sql redefiniu
  -- esta função. Lugares de convidado (sem conta) ficam de fora.
  WITH players AS (
    SELECT t.pid, t.won FROM (VALUES
      (v_match.team_a_player1_id, v_match.winner_team = 'a'),
      (v_match.team_a_player2_id, v_match.winner_team = 'a'),
      (v_match.team_b_player1_id, v_match.winner_team = 'b'),
      (v_match.team_b_player2_id, v_match.winner_team = 'b')
    ) AS t(pid, won)
    WHERE t.pid IS NOT NULL
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

  PERFORM check_and_award_achievements(t.pid)
  FROM unnest(ARRAY[
    v_match.team_a_player1_id, v_match.team_a_player2_id,
    v_match.team_b_player1_id, v_match.team_b_player2_id
  ]) AS t(pid)
  WHERE t.pid IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION confirm_private_match(UUID) FROM public;
GRANT EXECUTE ON FUNCTION confirm_private_match(UUID) TO authenticated;
