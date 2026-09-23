-- ═════════════════════════════════════════════════════════════════════════
-- TORNEIOS: FALTA E DESISTÊNCIA FAZEM O QUE O ECRÃ PROMETE
-- (23 set 2026) — cartões #458 e #459.
--
-- CORRER DEPOIS de migration_tournaments_recalc.sql (redefine o mesmo
-- mark_walkover, a partir da versão de lá). Pode-se correr outra vez sem
-- estragar.
--
-- #458 — «fica desistência com o resultado até aqui»: mark_walkover passa a
--        receber p_score_a / p_score_b (opcionais) com o resultado até ali.
--        Antes lia só o que estava gravado, que era sempre nada → 0-9.
-- #459 — «os jogos que faltam contam como ganhos para os adversários»: quem
--        falta ou desiste perde por falta os jogos de grupo que ainda tinha
--        por jogar. Antes esses jogos ficavam pendurados e o grupo não fechava.
--
-- Muda a assinatura (dois parâmetros novos), por isso apaga-se a antiga —
-- senão ficavam duas versões e as chamadas davam «ambígua».
-- ═════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS mark_walkover(UUID, TEXT, TEXT, BOOLEAN);

CREATE OR REPLACE FUNCTION mark_walkover(
  p_match_id UUID, p_kind TEXT, p_loser TEXT, p_justified BOOLEAN DEFAULT NULL,
  p_score_a INTEGER DEFAULT NULL, p_score_b INTEGER DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m            tournament_matches;
  v_tournament UUID;
  v_max        INTEGER;
  v_a          INTEGER;
  v_b          INTEGER;
  v_loser_id   UUID;
  v_winner_id  UUID;
  r            tournament_matches;
BEGIN
  IF p_kind NOT IN ('falta','desistencia') THEN
    RAISE EXCEPTION 'Só há falta de comparência ou desistência';
  END IF;
  IF p_loser NOT IN ('a','b') THEN
    RAISE EXCEPTION 'Falta dizer quem faltou ou desistiu';
  END IF;

  SELECT * INTO m FROM tournament_matches WHERE id = p_match_id;
  IF m.id IS NULL THEN
    RAISE EXCEPTION 'Jogo não encontrado';
  END IF;
  v_tournament := tournament_of_category(m.category_id);
  IF NOT can_score_tournament(v_tournament, m.category_id) THEN
    RAISE EXCEPTION 'Não podes marcar resultados nesta categoria'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT COALESCE(NULLIF(regexp_replace(COALESCE(rules->>'scoring', ''), '[^0-9]', '', 'g'), '')::int, 9)
    INTO v_max FROM tournaments WHERE id = v_tournament;

  -- #458: na desistência, o resultado até ali vem do ecrã (o marcador não
  -- consegue gravar um resultado a meio, por isso m.score_* estava sempre
  -- vazio e ficava sempre 0-9).
  IF p_kind = 'desistencia' AND p_score_a IS NOT NULL AND p_score_b IS NOT NULL THEN
    v_a := GREATEST(p_score_a, 0);
    v_b := GREATEST(p_score_b, 0);
  ELSE
    v_a := COALESCE(m.score_a, 0);
    v_b := COALESCE(m.score_b, 0);
  END IF;
  IF p_kind = 'falta' OR (v_a = 0 AND v_b = 0) THEN
    v_a := CASE WHEN p_loser = 'a' THEN 0 ELSE v_max END;
    v_b := CASE WHEN p_loser = 'b' THEN 0 ELSE v_max END;
  ELSIF (p_loser = 'a' AND v_a > v_b) OR (p_loser = 'b' AND v_b > v_a) THEN
    SELECT v_b, v_a INTO v_a, v_b;
  END IF;

  v_loser_id  := CASE WHEN p_loser = 'a' THEN m.entry_a_id ELSE m.entry_b_id END;
  v_winner_id := CASE WHEN p_loser = 'a' THEN m.entry_b_id ELSE m.entry_a_id END;

  -- Também aqui: uma falta é um jogo que aconteceu (ou que devia ter
  -- acontecido), e quem lá estava fica registado. Não dá pontos — mas
  -- deixa o histórico coerente com o resto.
  PERFORM freeze_match_players(p_match_id);

  UPDATE tournament_matches SET
    score_a = v_a, score_b = v_b,
    status = p_kind,
    winner_entry_id = v_winner_id,
    walkover_justified = CASE WHEN p_kind = 'falta' THEN p_justified ELSE NULL END,
    ended_at = NOW(),
    corrected_by = CASE WHEN m.status IN ('terminado','falta','desistencia') THEN auth.uid() ELSE corrected_by END,
    corrected_at = CASE WHEN m.status IN ('terminado','falta','desistencia') THEN NOW() ELSE corrected_at END
  WHERE id = p_match_id;

  IF v_loser_id IS NOT NULL THEN
    UPDATE tournament_entries SET status = 'desistiu' WHERE id = v_loser_id;

    -- #459: quem sai não joga o resto do grupo. Os jogos de grupo dele ainda
    -- por jogar passam a falta a favor do adversário — senão ficavam na
    -- lista do marcador e o grupo nunca fechava. Só grupo: no quadro, perder
    -- este jogo já o tira de lá.
    FOR r IN
      SELECT * FROM tournament_matches
       WHERE category_id = m.category_id AND stage = 'grupo' AND id <> p_match_id
         AND status = 'marcado'
         AND (entry_a_id = v_loser_id OR entry_b_id = v_loser_id)
    LOOP
      PERFORM freeze_match_players(r.id);
      UPDATE tournament_matches SET
        score_a = CASE WHEN r.entry_a_id = v_loser_id THEN 0 ELSE v_max END,
        score_b = CASE WHEN r.entry_b_id = v_loser_id THEN 0 ELSE v_max END,
        status = 'falta',
        winner_entry_id = CASE WHEN r.entry_a_id = v_loser_id THEN r.entry_b_id ELSE r.entry_a_id END,
        walkover_justified = NULL,
        ended_at = NOW()
      WHERE id = r.id;
    END LOOP;
  END IF;

  PERFORM tournament_advance_winner(p_match_id);

  UPDATE tournaments SET status = 'a_decorrer'
   WHERE id = v_tournament AND status = 'sorteado';

  -- Categoria ja fechada? Entao isto foi uma CORRECAO, e os pontos que ja
  -- foram dados estao errados. Desfaz-se e da-se tudo outra vez do zero.
  -- Sem isto ficava o resultado certo no ecra e os pontos errados no
  -- ranking -- pior do que nao deixar corrigir, porque ninguem desconfia.
  IF (SELECT status FROM tournament_categories WHERE id = m.category_id) = 'terminada' THEN
    PERFORM recalculate_category_points(m.category_id);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION mark_walkover(UUID, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER) FROM public, anon;
GRANT EXECUTE ON FUNCTION mark_walkover(UUID, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER) TO authenticated;
