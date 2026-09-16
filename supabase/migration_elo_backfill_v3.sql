-- ════════════════════════════════════════════════════════════════════════
-- Elo — recalibração total v3 (correr DEPOIS de migration_elo_dominance_cap.sql)
--
-- Re-replay do histórico COMPLETO com o cap de dominância + o novo
-- financiamento do bónus (derrota inesperada contra o premiado, não mais
-- rating do pagador) — ver migration_elo_dominance_cap.sql e a spec
-- docs/superpowers/specs/2026-09-15-fair-pairing-and-dominance-cap-design.md.
--
-- Mesmo mecanismo do v2: reset às âncoras + re-replay cronológico,
-- intercalando mixes finished e amigáveis confirmados. Quem escolheu
-- âncora no onboarding mantém-na; os restantes ficam na âncora 900. O XP
-- não é tocado (sistema separado e aditivo).
-- Re-corrível: reset + replay completo.
-- ════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  ev RECORD;
  pm private_matches;
  pl RECORD;
  n_mixes INTEGER := 0;
  n_friendlies INTEGER := 0;
BEGIN
  UPDATE profiles
  SET rating_anchor = COALESCE(rating_anchor, 900),
      rating = COALESCE(rating_anchor, 900),
      rating_games = 0
  WHERE TRUE;

  UPDATE mix_player_stats SET rating_delta = NULL, rating_after = NULL WHERE TRUE;
  UPDATE private_match_stats SET rating_delta = NULL, rating_after = NULL WHERE TRUE;

  FOR ev IN
    SELECT 'mix'::text AS kind, g.id, g.winner_team_id,
           g.date AS happened_at, f.finalized_at AS tiebreak
    FROM games g
    LEFT JOIN LATERAL (
      SELECT MIN(created_at) AS finalized_at FROM mix_player_stats WHERE game_id = g.id
    ) f ON TRUE
    WHERE g.status = 'finished'
    UNION ALL
    SELECT 'friendly', p.id, NULL::uuid, p.confirmed_at, p.confirmed_at
    FROM private_matches p
    WHERE p.status = 'confirmed'
    ORDER BY happened_at, tiebreak NULLS LAST, id
  LOOP
    IF ev.kind = 'mix' THEN
      PERFORM apply_mix_elo(ev.id, ev.winner_team_id);
      n_mixes := n_mixes + 1;
    ELSE
      SELECT * INTO pm FROM private_matches WHERE id = ev.id;
      IF pm.winner_team IS NULL THEN
        CONTINUE;
      END IF;
      FOR pl IN
        SELECT * FROM apply_elo_pairing(
          pm.team_a_player1_id, pm.team_a_player2_id,
          pm.team_b_player1_id, pm.team_b_player2_id,
          CASE WHEN pm.winner_team = 'a' THEN 1 ELSE 0 END
        )
      LOOP
        UPDATE private_match_stats
        SET rating_delta = ROUND(pl.delta, 2),
            rating_after = ROUND((SELECT COALESCE(pr.rating, 900) FROM profiles pr WHERE pr.id = pl.pid), 2)
        WHERE private_match_id = pm.id AND user_id = pl.pid;
      END LOOP;
      n_friendlies := n_friendlies + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'Recalibração v3: % mixes + % amigáveis reproduzidos', n_mixes, n_friendlies;
END $$;

-- Conferência: top-30 recalculado, para comparar com o top-30 anterior
-- (correr a mesma query antes de aplicar esta migração e guardar o
-- resultado para comparação, já que isto muda os rankings de todos os
-- clubes).
SELECT ROW_NUMBER() OVER (ORDER BY p.rating DESC) AS pos,
       p.name, ROUND(p.rating) AS pts, p.rating_games
FROM profiles p
WHERE p.rating_games > 0
ORDER BY p.rating DESC
LIMIT 30;
