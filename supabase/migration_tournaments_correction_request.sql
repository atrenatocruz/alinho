-- ════════════════════════════════════════════════════════════════════════
-- TORNEIOS, PARTE 14: UM JOGADOR PODE PEDIR A CORREÇÃO DE UM RESULTADO
-- (Dev 3, 23 set 2026) — a outra metade da regra de 22 set.
--
-- CORRER DEPOIS de `migration_tournaments_recalc.sql`. Pode-se correr
-- outra vez sem estragar.
--
-- A REGRA (Francisco, 22 set): «o admin pode sempre corrigir um resultado,
-- mesmo depois de o jogo estar fechado. **Quem não é admin pode pedir a
-- correção ao admin.**» A primeira metade ficou feita na parte 13; esta é
-- a segunda.
--
-- O QUE FALTAVA: um jogador que visse o resultado dele errado não tinha por
-- onde avisar — tinha de encontrar alguém da organização e dizer-lho de
-- viva voz. Num torneio de três dias e centenas de pessoas, isso perde-se.
--
-- DIFERENÇA PARA O MODELO DOS JOGOS DE GRUPO, e é de propósito: lá, a
-- correção é aceite pelos OUTROS JOGADORES (`accept_group_match_correction`).
-- Aqui quem decide é a ORGANIZAÇÃO. Num torneio há um dono do resultado —
-- o marcador e o admin — e pôr quatro estranhos a negociar um resultado no
-- meio de um quadro era pior do que o problema.
--
-- Só há UM pedido por jogo de cada vez: o segundo substitui o primeiro, e
-- fica registado quem o fez. Um pedido não muda nada sozinho — só quando a
-- organização aceita é que o resultado muda (e aí, se a categoria já estiver
-- fechada, os pontos são recalculados pela parte 13).
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE tournament_matches
  ADD COLUMN IF NOT EXISTS pending_score_a INTEGER,
  ADD COLUMN IF NOT EXISTS pending_score_b INTEGER,
  ADD COLUMN IF NOT EXISTS pending_by      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pending_note    TEXT,
  ADD COLUMN IF NOT EXISTS pending_at      TIMESTAMPTZ;

-- ── 1. Pedir ────────────────────────────────────────────────────────────
-- Só quem jogou aquele jogo. Não é «qualquer pessoa do torneio»: o
-- resultado de um jogo é dos quatro que lá estiveram.
CREATE OR REPLACE FUNCTION request_match_correction(
  p_match_id UUID, p_score_a INTEGER, p_score_b INTEGER, p_note TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m         tournament_matches;
  v_jogou   BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Precisas de ter sessão iniciada';
  END IF;

  SELECT * INTO m FROM tournament_matches WHERE id = p_match_id;
  IF m.id IS NULL THEN
    RAISE EXCEPTION 'Jogo não encontrado';
  END IF;
  IF m.status NOT IN ('terminado','falta','desistencia') THEN
    RAISE EXCEPTION 'Este jogo ainda não tem resultado para corrigir';
  END IF;
  IF p_score_a IS NULL OR p_score_b IS NULL OR p_score_a < 0 OR p_score_b < 0 THEN
    RAISE EXCEPTION 'Resultado inválido';
  END IF;
  IF p_score_a = p_score_b THEN
    RAISE EXCEPTION 'Um jogo não pode acabar empatado';
  END IF;
  IF p_score_a = m.score_a AND p_score_b = m.score_b THEN
    RAISE EXCEPTION 'Esse é o resultado que já lá está';
  END IF;

  -- Jogou este jogo? Primeiro pelo que ficou congelado (#442), que é a
  -- verdade de quem esteve em campo; se o jogo for anterior a isso, pela
  -- inscrição.
  SELECT EXISTS (
    SELECT 1 FROM tournament_match_players p
     WHERE p.match_id = p_match_id AND p.user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM tournament_entries e
     WHERE e.id IN (m.entry_a_id, m.entry_b_id)
       AND auth.uid() IN (e.player1_id, e.player2_id)
  ) INTO v_jogou;

  IF NOT v_jogou THEN
    RAISE EXCEPTION 'Só quem jogou este jogo pode pedir a correção'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE tournament_matches
     SET pending_score_a = p_score_a,
         pending_score_b = p_score_b,
         pending_by = auth.uid(),
         pending_note = NULLIF(trim(p_note), ''),
         pending_at = NOW()
   WHERE id = p_match_id;
END;
$$;

-- ── 2. Responder ────────────────────────────────────────────────────────
-- A organização aceita ou recusa. Aceitar grava o resultado pedido pelo
-- caminho normal — logo, se a categoria já estiver fechada, os pontos são
-- recalculados (parte 13) sem nada de especial aqui.
CREATE OR REPLACE FUNCTION resolve_match_correction(p_match_id UUID, p_accept BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m            tournament_matches;
  v_tournament UUID;
BEGIN
  SELECT * INTO m FROM tournament_matches WHERE id = p_match_id;
  IF m.id IS NULL THEN
    RAISE EXCEPTION 'Jogo não encontrado';
  END IF;
  v_tournament := tournament_of_category(m.category_id);
  IF NOT can_score_tournament(v_tournament, m.category_id) THEN
    RAISE EXCEPTION 'Só a organização responde a pedidos de correção'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF m.pending_by IS NULL THEN
    RAISE EXCEPTION 'Não há nenhum pedido de correção neste jogo';
  END IF;

  IF p_accept THEN
    -- Limpa ANTES de gravar: o `save_match_result` pode disparar o
    -- recálculo, e não queremos o pedido pendurado a meio disso.
    UPDATE tournament_matches
       SET pending_score_a = NULL, pending_score_b = NULL,
           pending_by = NULL, pending_note = NULL, pending_at = NULL
     WHERE id = p_match_id;
    PERFORM save_match_result(p_match_id, m.pending_score_a, m.pending_score_b, NULL);
  ELSE
    UPDATE tournament_matches
       SET pending_score_a = NULL, pending_score_b = NULL,
           pending_by = NULL, pending_note = NULL, pending_at = NULL
     WHERE id = p_match_id;
  END IF;
END;
$$;

-- ── 3. A organização vê os pedidos ──────────────────────────────────────
-- Acrescenta o pedido pendente à lista que o ecrã do marcador já usa. Sem
-- isto, o pedido ficava guardado e ninguém dava por ele — que é o problema
-- que este ficheiro veio resolver.
CREATE OR REPLACE FUNCTION list_tournament_matches_to_score(p_tournament_id UUID, p_date DATE DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_out JSONB;
BEGIN
  IF NOT can_score_tournament(p_tournament_id) THEN
    RAISE EXCEPTION 'Não estás a marcar resultados neste torneio'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.scheduled_at NULLS LAST, x.court), '[]'::jsonb)
    INTO v_out
  FROM (
    SELECT m.id AS match_id, c.id AS category_id, c.code AS category_code, c.name AS category_name,
           g.name AS group_label, m.round AS round_label, m.stage,
           crt.name AS court, m.scheduled_at, m.previous_scheduled_at, m.status,
           tournament_team_json(m.entry_a_id) AS team_a,
           tournament_team_json(m.entry_b_id) AS team_b,
           m.source_a, m.source_b,
           m.score_a, m.score_b, m.sets, m.winner_entry_id, m.walkover_justified,
           cp.name AS corrected_by_name, m.corrected_at,
           -- O pedido de correção, se houver.
           CASE WHEN m.pending_by IS NULL THEN NULL ELSE jsonb_build_object(
             'score_a', m.pending_score_a,
             'score_b', m.pending_score_b,
             'note', m.pending_note,
             'at', m.pending_at,
             'by_name', (SELECT p.name FROM profiles p WHERE p.id = m.pending_by)
           ) END AS correction_request
    FROM tournament_matches m
    JOIN tournament_categories c ON c.id = m.category_id
    LEFT JOIN tournament_groups g ON g.id = m.group_id
    LEFT JOIN tournament_courts crt ON crt.id = m.court_id
    LEFT JOIN profiles cp ON cp.id = m.corrected_by
    WHERE c.tournament_id = p_tournament_id
      AND (p_date IS NULL OR (m.scheduled_at AT TIME ZONE 'Europe/Lisbon')::date = p_date)
      AND can_score_tournament(p_tournament_id, c.id)
  ) x;

  RETURN v_out;
END;
$$;

-- ── 4. Quem pode chamar o quê ───────────────────────────────────────────
REVOKE ALL ON FUNCTION request_match_correction(UUID, INTEGER, INTEGER, TEXT) FROM public, anon;
REVOKE ALL ON FUNCTION resolve_match_correction(UUID, BOOLEAN) FROM public, anon;
REVOKE ALL ON FUNCTION list_tournament_matches_to_score(UUID, DATE) FROM public, anon;
GRANT EXECUTE ON FUNCTION request_match_correction(UUID, INTEGER, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION resolve_match_correction(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION list_tournament_matches_to_score(UUID, DATE) TO authenticated;
