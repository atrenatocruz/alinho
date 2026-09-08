-- ════════════════════════════════════════════════════════════════════════
-- XP — backfill retroativo (correr DEPOIS de migration_xp_engagement.sql)
--
-- Ao contrário do Elo, o XP é aditivo e independente da ordem — dá para
-- semear todo o histórico de uma vez, para os escudos significarem algo
-- no dia 1. Fontes: mix_player_stats (já exclui guests) e
-- private_match_stats (amigáveis confirmados). Os UNIQUEs parciais do
-- ledger tornam isto re-corrível sem duplicar nada.
-- ════════════════════════════════════════════════════════════════════════

-- Mixes: participação, jogos e vitória — datados pela data do mix.
INSERT INTO xp_events (user_id, organization_id, kind, source_game_id, amount, occurred_at)
SELECT mps.user_id, mps.organization_id, 'mix_participation', mps.game_id, 20,
       COALESCE(g.date, mps.created_at)
FROM mix_player_stats mps JOIN games g ON g.id = mps.game_id
ON CONFLICT (user_id, kind, source_game_id) WHERE source_game_id IS NOT NULL DO NOTHING;

INSERT INTO xp_events (user_id, organization_id, kind, source_game_id, amount, occurred_at)
SELECT mps.user_id, mps.organization_id, 'mix_games', mps.game_id, mps.matches_played * 5,
       COALESCE(g.date, mps.created_at)
FROM mix_player_stats mps JOIN games g ON g.id = mps.game_id
WHERE mps.matches_played > 0
ON CONFLICT (user_id, kind, source_game_id) WHERE source_game_id IS NOT NULL DO NOTHING;

INSERT INTO xp_events (user_id, organization_id, kind, source_game_id, amount, occurred_at)
SELECT mps.user_id, mps.organization_id, 'mix_win', mps.game_id, 30,
       COALESCE(g.date, mps.created_at)
FROM mix_player_stats mps JOIN games g ON g.id = mps.game_id
WHERE mps.mix_won
ON CONFLICT (user_id, kind, source_game_id) WHERE source_game_id IS NOT NULL DO NOTHING;

-- Amigáveis confirmados — datados pela confirmação.
INSERT INTO xp_events (user_id, kind, source_private_match_id, amount, occurred_at)
SELECT pms.user_id, 'friendly_match', pms.private_match_id, 10,
       COALESCE(pm.confirmed_at, pms.created_at)
FROM private_match_stats pms JOIN private_matches pm ON pm.id = pms.private_match_id
WHERE pm.status = 'confirmed'
ON CONFLICT (user_id, kind, source_private_match_id) WHERE source_private_match_id IS NOT NULL DO NOTHING;

INSERT INTO xp_events (user_id, kind, source_private_match_id, amount, occurred_at)
SELECT pms.user_id, 'friendly_win', pms.private_match_id, 5,
       COALESCE(pm.confirmed_at, pms.created_at)
FROM private_match_stats pms JOIN private_matches pm ON pm.id = pms.private_match_id
WHERE pm.status = 'confirmed' AND pms.won
ON CONFLICT (user_id, kind, source_private_match_id) WHERE source_private_match_id IS NOT NULL DO NOTHING;

-- Recompute dos denormalizados a partir do ledger completo — idempotente,
-- correto mesmo que já existam eventos "live" entretanto.
UPDATE profiles p
SET xp = s.total,
    last_played_at = GREATEST(COALESCE(p.last_played_at, s.latest), s.latest)
FROM (
  SELECT user_id, SUM(amount) AS total, MAX(occurred_at) AS latest
  FROM xp_events GROUP BY user_id
) s
WHERE p.id = s.user_id;

-- Conferência rápida: top-20 de assiduidade recém-calculado.
SELECT p.name, p.xp, p.last_played_at::date AS ultimo_jogo
FROM profiles p WHERE p.xp > 0
ORDER BY p.xp DESC LIMIT 20;
