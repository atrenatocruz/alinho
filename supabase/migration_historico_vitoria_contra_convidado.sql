-- ════════════════════════════════════════════════════════════════════════
-- Migration: get_player_match_history — vitória contra um convidado sem
-- conta aparecia como derrota no Histórico de jogos do perfil.
--
-- Renato, 14 out 2026 (Mix M4 · Terça, 13/10): ganhou os 4 jogos, o perfil
-- mostrava 3V – 1D. O jogo «perdido» foi o 8–1 contra Tiago Silva / João
-- Miguel, onde a outra dupla era a team_a e tinha um convidado sem conta
-- (player*_id NULL, player*_guest_id preenchido).
--
-- Causa: `p_user_id IN (ta.player1_id, ta.player2_id)` dá NULL (não FALSE)
-- quando o jogador não está na team_a e a team_a tem um id NULL. O `won`
-- era `(winner = ta) = NULL` → NULL, que o ecrã lê como derrota. O placar
-- saía certo só porque o CASE WHEN NULL cai no ELSE por acaso.
--
-- Corrige também a ordem dos jogos dentro do mix: todas as rondas têm a
-- mesma data, por isso «Jogo 1..4» saía por ordem arbitrária — agora
-- segue round_number / court_number.
--
-- Mantém o filtro dos mixes cancelados (migration_mix_cancelled_out_of_history.sql).
-- Mesma assinatura e tipo de retorno: CREATE OR REPLACE, sem DROP.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_player_match_history(p_user_id UUID)
RETURNS TABLE (
  match_id UUID,
  game_id UUID,
  source TEXT,
  label TEXT,
  match_date TIMESTAMPTZ,
  player_score INTEGER,
  opponent_score INTEGER,
  won BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH mix_matches AS (
    SELECT m.id AS match_id, g.id AS game_id, 'mix'::TEXT AS source, g.title AS label, g.date AS match_date,
           CASE WHEN in_a THEN m.score_a ELSE m.score_b END AS player_score,
           CASE WHEN in_a THEN m.score_b ELSE m.score_a END AS opponent_score,
           (m.winner_team_id = ta.id) = in_a AS won,
           m.round_number AS sort_round, m.court_number AS sort_court
    FROM matches m
    JOIN teams ta ON ta.id = m.team_a_id
    JOIN teams tb ON tb.id = m.team_b_id
    JOIN games g ON g.id = m.game_id
    -- IS NOT DISTINCT FROM em vez de IN: com um convidado sem conta na
    -- dupla, o id é NULL e o IN devolvia NULL em vez de FALSE.
    CROSS JOIN LATERAL (
      SELECT (p_user_id IS NOT DISTINCT FROM ta.player1_id OR p_user_id IS NOT DISTINCT FROM ta.player2_id) AS in_a
    ) side
    WHERE m.winner_team_id IS NOT NULL AND g.status IS DISTINCT FROM 'cancelled'
      AND p_user_id IN (ta.player1_id, ta.player2_id, tb.player1_id, tb.player2_id)
  ),
  private_matches_list AS (
    SELECT pm.id AS match_id, NULL::UUID AS game_id, 'private'::TEXT AS source,
           'Jogo entre amigos'::TEXT AS label, pm.played_at AS match_date,
           CASE WHEN p_user_id IN (pm.team_a_player1_id, pm.team_a_player2_id)
                THEN pm.score_a ELSE pm.score_b END AS player_score,
           CASE WHEN p_user_id IN (pm.team_a_player1_id, pm.team_a_player2_id)
                THEN pm.score_b ELSE pm.score_a END AS opponent_score,
           pms.won,
           NULL::INTEGER AS sort_round, NULL::INTEGER AS sort_court
    FROM private_matches pm
    JOIN private_match_stats pms ON pms.private_match_id = pm.id AND pms.user_id = p_user_id
    WHERE pm.status = 'confirmed'
  )
  SELECT m.match_id, m.game_id, m.source, m.label, m.match_date,
         m.player_score, m.opponent_score, m.won
  FROM (
    SELECT * FROM mix_matches
    UNION ALL
    SELECT * FROM private_matches_list
  ) m
  WHERE can_view_section(p_user_id, (SELECT activity_visibility FROM profiles WHERE id = p_user_id))
  ORDER BY m.match_date DESC, m.game_id, m.sort_round, m.sort_court
  LIMIT 50;
$$;

REVOKE ALL ON FUNCTION get_player_match_history(UUID) FROM public;
GRANT EXECUTE ON FUNCTION get_player_match_history(UUID) TO authenticated;
