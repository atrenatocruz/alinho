-- ════════════════════════════════════════════════════════════════════════
-- Elo ranking v1 — backfill (correr DEPOIS de migration_elo_rating.sql)
--
-- Recalcula o rating do zero sobre todos os mixes 'finished', por ordem
-- cronológica, como descrito em RANKING.md ("Ranking a migrar"). Jogadores
-- existentes entram todos com âncora 900 (decisão de 25 ago 2026 — nunca
-- passam pelo ecrã de auto-classificação); quem já tiver escolhido âncora
-- no onboarding (contas novas, se isto for re-corrido mais tarde) mantém a
-- sua e o histórico é reproduzido por cima.
--
-- Re-correr este ficheiro é seguro: faz reset e reproduz tudo de novo.
-- ════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  g RECORD;
  n INTEGER := 0;
BEGIN
  UPDATE profiles
  SET rating_anchor = COALESCE(rating_anchor, 900),
      rating = COALESCE(rating_anchor, 900),
      rating_games = 0;

  UPDATE mix_player_stats SET rating_delta = NULL, rating_after = NULL;

  -- Ordem de replay: data do mix e, em empate (dois mixes na mesma noite),
  -- o momento em que cada um foi realmente finalizado — as linhas de
  -- mix_player_stats nascem no finalize_mix, por isso o MIN(created_at)
  -- delas é esse momento. created_at do game (quando foi CRIADO na app)
  -- seria um desempate errado: um mix criado primeiro pode ter sido
  -- finalizado depois, e a sequência do Elo é sensível à ordem.
  FOR g IN
    SELECT g2.id, g2.winner_team_id
    FROM games g2
    LEFT JOIN LATERAL (
      SELECT MIN(created_at) AS finalized_at
      FROM mix_player_stats WHERE game_id = g2.id
    ) f ON TRUE
    WHERE g2.status = 'finished'
    ORDER BY g2.date, f.finalized_at NULLS LAST, g2.created_at, g2.id
  LOOP
    PERFORM apply_mix_elo(g.id, g.winner_team_id);
    n := n + 1;
  END LOOP;

  RAISE NOTICE 'Elo backfill: % mixes reproduzidos', n;
END $$;

-- Conferência rápida: top do ranking recalculado.
SELECT p.name, ROUND(p.rating) AS pts, p.rating_games
FROM profiles p
WHERE p.rating_games > 0
ORDER BY p.rating DESC
LIMIT 30;
