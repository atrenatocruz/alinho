-- Migration: «Jogos do mix» no relógio também com convidados (10 nov 2026)
--
-- O list_my_watch_mix_matches fazia JOIN a profiles para os 4 jogadores: um
-- convidado sem conta (teams.playerN_guest_id → game_guests) não tem profile,
-- e o jogo desaparecia do relógio. Agora: LEFT JOIN a profiles e a game_guests,
-- e o nome vem de um ou do outro. O resto fica igual (claim_mix_match e
-- save_mix_match_result já só olham para quem tem conta).
--
-- Precisa de migration_relogio_mix_a.sql. Correr no dev e depois na prod.

BEGIN;

CREATE OR REPLACE FUNCTION public.list_my_watch_mix_matches()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_me  UUID := auth.uid();
  v_out JSONB;
BEGIN
  IF v_me IS NULL THEN RETURN '[]'::jsonb; END IF;

  SELECT COALESCE(jsonb_agg(x.o ORDER BY x.round_number, x.court_number), '[]'::jsonb)
    INTO v_out
    FROM (
      SELECT m.round_number, m.court_number,
             jsonb_build_object(
               'match_id',       m.id,
               'game_id',        g.id,
               'game_name',      g.title,
               'round_number',   m.round_number,
               'court_number',   m.court_number,
               'my_side',        CASE WHEN v_me IN (ta.player1_id, ta.player2_id) THEN 'a' ELSE 'b' END,
               'partner_name',   CASE WHEN v_me IN (ta.player1_id, ta.player2_id)
                                      THEN CASE WHEN v_me = ta.player1_id THEN n.a2 ELSE n.a1 END
                                      ELSE CASE WHEN v_me = tb.player1_id THEN n.b2 ELSE n.b1 END
                                 END,
               'opponent_names', CASE WHEN v_me IN (ta.player1_id, ta.player2_id)
                                      THEN jsonb_build_array(n.b1, n.b2)
                                      ELSE jsonb_build_array(n.a1, n.a2)
                                 END,
               'format',         g.format,
               'scoring_format', g.scoring_format,
               'deuce_mode',     COALESCE(to_jsonb(g)->>'deuce_mode', 'ponto_de_ouro'),
               'tiebreak_8_8',   g.tiebreak_8_8,
               'scorer_id',      ls.scorer_id,
               'scorer_name',    ps.name,
               'has_result',     (m.score_a IS NOT NULL OR m.score_b IS NOT NULL)
             ) AS o
        FROM matches m
        JOIN games g    ON g.id = m.game_id AND g.status = 'in_progress'
        JOIN teams ta   ON ta.id = m.team_a_id
        JOIN teams tb   ON tb.id = m.team_b_id
        -- Conta ou convidado: o nome vem de um ou do outro (o relógio não aceita nulos).
        CROSS JOIN LATERAL (SELECT
          COALESCE((SELECT name FROM profiles    WHERE id = ta.player1_id),
                   (SELECT name FROM game_guests WHERE id = ta.player1_guest_id), '?') AS a1,
          COALESCE((SELECT name FROM profiles    WHERE id = ta.player2_id),
                   (SELECT name FROM game_guests WHERE id = ta.player2_guest_id), '?') AS a2,
          COALESCE((SELECT name FROM profiles    WHERE id = tb.player1_id),
                   (SELECT name FROM game_guests WHERE id = tb.player1_guest_id), '?') AS b1,
          COALESCE((SELECT name FROM profiles    WHERE id = tb.player2_id),
                   (SELECT name FROM game_guests WHERE id = tb.player2_guest_id), '?') AS b2
        ) n
        -- Um dono que já não é um dos 4 não conta (o claim passa o jogo a quem o pedir).
        LEFT JOIN mix_live_scores ls ON ls.match_id = m.id
              AND ls.scorer_id IN (ta.player1_id, ta.player2_id, tb.player1_id, tb.player2_id)
        LEFT JOIN profiles ps ON ps.id = ls.scorer_id
       WHERE v_me IN (ta.player1_id, ta.player2_id, tb.player1_id, tb.player2_id)
         AND (m.score_a IS NULL OR ls.scorer_id = v_me)
    ) x;

  RETURN v_out;
END;
$function$;

COMMIT;
