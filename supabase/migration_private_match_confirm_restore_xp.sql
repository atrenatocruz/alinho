-- ════════════════════════════════════════════════════════════════════════
-- Jogos entre amigos voltam a dar XP e conquistas (18 set 2026, Dev 1)
--
-- Problema: migration_private_match_ranked_consent.sql (10 set, #233)
-- redefiniu confirm_private_match a partir de uma versão anterior a
-- migration_xp_engagement.sql / migration_trophies.sql. Desde que correu,
-- confirmar um jogo entre amigos deixou de dar XP (10 por jogo, +5 por
-- vitória), de atualizar last_played_at e de verificar conquistas.
--
-- Esta migração:
--   1. Redefine confirm_private_match = versão do ranked_consent (igual,
--      linha a linha) + o bloco de XP/conquistas no fim. O XP é dado a
--      TODOS os jogos confirmados, rankeados ou amigáveis (como antes do
--      #233); convidados sem conta ficam de fora. Chama já o nome novo
--      check_and_award_achievements (o wrapper antigo continua a existir).
--   2. Devolve o XP em falta dos jogos confirmados entretanto, e volta a
--      verificar as conquistas desses jogadores. Idempotente: os UNIQUE
--      parciais de xp_events impedem duplicar XP já dado.
--
-- Ordem: depois de migration_private_match_ranked_consent.sql e de
-- migration_achievements_rename.sql. Pode correr mais de uma vez.
-- Correr inteiro no Supabase → SQL Editor.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. confirm_private_match com XP e conquistas ────────────────────────

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
    AND v_match.team_b_player2_status = 'accepted_all';

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

-- ── 2. XP em falta dos jogos já confirmados ─────────────────────────────
-- Lê private_matches (não private_match_stats): os jogos que confirmaram
-- como amigáveis depois do #233 não têm linhas de stats.

WITH players AS (
  SELECT pm.id AS match_id, COALESCE(pm.confirmed_at, pm.created_at) AS at, t.pid, t.won
  FROM private_matches pm
  CROSS JOIN LATERAL (VALUES
    (pm.team_a_player1_id, pm.winner_team = 'a'),
    (pm.team_a_player2_id, pm.winner_team = 'a'),
    (pm.team_b_player1_id, pm.winner_team = 'b'),
    (pm.team_b_player2_id, pm.winner_team = 'b')
  ) AS t(pid, won)
  WHERE pm.status = 'confirmed' AND t.pid IS NOT NULL
)
INSERT INTO xp_events (user_id, kind, source_private_match_id, amount, occurred_at)
SELECT pid, 'friendly_match', match_id, 10, at FROM players
UNION ALL
SELECT pid, 'friendly_win', match_id, 5, at FROM players WHERE won
ON CONFLICT (user_id, kind, source_private_match_id)
  WHERE source_private_match_id IS NOT NULL DO NOTHING;

-- Recalcula os totais a partir do registo completo (como
-- migration_xp_backfill.sql) — correto mesmo que corra duas vezes.
UPDATE profiles p
SET xp = s.total,
    last_played_at = GREATEST(COALESCE(p.last_played_at, s.latest), s.latest)
FROM (
  SELECT user_id, SUM(amount) AS total, MAX(occurred_at) AS latest
  FROM xp_events GROUP BY user_id
) s
WHERE p.id = s.user_id;

-- Conquistas de quem jogou entre amigos (só desbloqueia, nunca tira).
SELECT check_and_award_achievements(u.pid)
FROM (
  SELECT DISTINCT unnest(ARRAY[team_a_player1_id, team_a_player2_id,
                               team_b_player1_id, team_b_player2_id]) AS pid
  FROM private_matches WHERE status = 'confirmed'
) u
WHERE u.pid IS NOT NULL;
