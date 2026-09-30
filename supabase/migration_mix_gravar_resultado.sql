-- ═════════════════════════════════════════════════════════════════════════
-- Mix: gravar o resultado de um jogo e os sets de uma vez (tudo ou nada)
--
-- PORQUÊ. O QA viu no dev.alinho.pt, e o Bugs confirmou no código (29 set):
-- no mix, gravar o resultado são 3 passos soltos da app (update de matches
-- → apagar match_sets → inserir match_sets). Com as travas do #588, se o
-- tie-break for recusado, o 9-8 com vencedor já ficou gravado sem ele e o
-- ecrã diz «recusado». Pedido do PO, urgente: a 588 vai a produção na
-- quarta. Ecrã (GameDetails): Bugs.
--
-- O QUE FAZ. save_mix_match_result(p_match_id, p_score_a, p_score_b,
-- p_sets) → jsonb {match_id, winner_team_id}. Faz os três passos numa só
-- transação: se uma trava recusar (o 588 nos sets e no resultado, o
-- «resultado só a partir da hora» no jogo em aberto), nada fica gravado e
-- o erro é o mesmo de hoje ('tiebreak_invalid', 'set_invalid', …).
--   · Quem pode: o mesmo que as regras da tabela deixam — admin do clube
--     do jogo, ou quem marca resultados com o mix a decorrer
--     ('not_allowed').
--   · Vencedor: quem tem mais; num empate, nenhum (winner_team_id null).
--   · p_sets (opcional): [{score_a, score_b, is_super_tiebreak?,
--     tiebreak_a?, tiebreak_b?}] — substitui os sets do jogo; null deixa
--     os sets como estão.
-- A correção de um mix acabado continua no correct_finished_mix_match.
--
-- Dev 3, 29 set 2026 · ecrã: Bugs
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.save_mix_match_result(p_match_id UUID, p_score_a INTEGER, p_score_b INTEGER, p_sets JSONB DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_m      matches%ROWTYPE;
  v_g      games%ROWTYPE;
  v_winner UUID;
  s        RECORD;
BEGIN
  SELECT * INTO v_m FROM matches WHERE id = p_match_id FOR UPDATE;
  IF v_m.id IS NULL OR auth.uid() IS NULL THEN RAISE EXCEPTION 'not_allowed'; END IF;
  SELECT * INTO v_g FROM games WHERE id = v_m.game_id;

  -- As mesmas regras da tabela: admin do clube, ou quem marca com o mix a
  -- decorrer.
  IF NOT EXISTS (SELECT 1 FROM memberships
                  WHERE organization_id = v_g.organization_id AND user_id = auth.uid() AND is_admin)
     AND NOT (v_g.status = 'in_progress'
              AND EXISTS (SELECT 1 FROM game_scorekeepers WHERE game_id = v_g.id AND user_id = auth.uid())) THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;

  IF p_score_a IS NULL OR p_score_b IS NULL THEN RAISE EXCEPTION 'empty'; END IF;
  IF p_sets IS NOT NULL AND jsonb_typeof(p_sets) <> 'array' THEN RAISE EXCEPTION 'bad_score'; END IF;

  -- Empate (Francisco, 30 set): grava-se sem vencedor; o ecrã não deixa
  -- terminar a ronda enquanto houver um jogo empatado.
  v_winner := CASE WHEN p_score_a > p_score_b THEN v_m.team_a_id
                   WHEN p_score_b > p_score_a THEN v_m.team_b_id END;
  UPDATE matches SET score_a = p_score_a, score_b = p_score_b, winner_team_id = v_winner
   WHERE id = p_match_id;

  IF p_sets IS NOT NULL THEN
    DELETE FROM match_sets WHERE match_id = p_match_id;
    FOR s IN SELECT x, n FROM jsonb_array_elements(p_sets) WITH ORDINALITY AS t(x, n) LOOP
      BEGIN
        INSERT INTO match_sets (match_id, set_number, score_a, score_b, is_super_tiebreak, tiebreak_a, tiebreak_b)
        VALUES (p_match_id, s.n, (s.x->>'score_a')::INTEGER, (s.x->>'score_b')::INTEGER,
                COALESCE((s.x->>'is_super_tiebreak')::BOOLEAN, FALSE),
                NULLIF(s.x->>'tiebreak_a', '')::INTEGER, NULLIF(s.x->>'tiebreak_b', '')::INTEGER);
      EXCEPTION
        WHEN invalid_text_representation OR not_null_violation THEN RAISE EXCEPTION 'bad_score';
      END;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('match_id', p_match_id, 'winner_team_id', v_winner);
END;
$function$;
REVOKE ALL ON FUNCTION public.save_mix_match_result(UUID, INTEGER, INTEGER, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_mix_match_result(UUID, INTEGER, INTEGER, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_mix_match_result(UUID, INTEGER, INTEGER, JSONB) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT has_function_privilege('anon', 'public.save_mix_match_result(uuid, integer, integer, jsonb)', 'EXECUTE');  -- false
