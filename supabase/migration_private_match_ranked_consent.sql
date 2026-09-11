-- ════════════════════════════════════════════════════════════════════════
-- Jogo individual entre amigos: ranked opcional com validação de todos
-- (Trello #233, design: docs/superpowers/specs/2026-09-10-jogo-individual-
-- ranked-opcional-design.md). Estende migration_private_match_elo.sql
-- (2026-09-08) — não a substitui.
--
-- 1. O criador escolhe, ao criar, se o jogo é proposto como ranked, e
--    define data (obrigatória), hora/local (opcionais, local com o mesmo
--    autocomplete do Google Places que os mixes já usam) e o formato de
--    pontuação: pontos_simples (um resultado só, ex.: 21-15) ou sets
--    (a pessoa escolhe quantos, 2 a 9 — sem regras rígidas de "quem fecha
--    primeiro", ao contrário do que os mixes usam em match_sets, porque os
--    amigos nem sempre jogam pelas regras todas). private_match_sets é a
--    tabela equivalente a match_sets, mas própria: um jogo privado não
--    passa pela tabela `matches`, exclusiva dos mixes.
-- 2. Qualquer um dos 4 lugares pode ser um jogador da app (procura aberta,
--    já existente via search_players) OU um nome sem conta — este último
--    nunca conta para ranking, por não haver com quem confirmar.
-- 3. Cada jogador com conta responde com um de 3 estados — aceitar tudo
--    (fica no registo E aceita ranking), aceitar sem ranking (fica no
--    registo, recusa só o ranking) ou recusar (sai do registo por
--    completo — a posição volta a ficar por preencher, tal como nunca
--    tivesse sido ocupada). "Nunca respondeu" fica pendente para sempre,
--    sem prazo — não bloqueia nada, só não conta para o Elo enquanto não
--    houver resposta.
-- 4. O Elo (e os pontos planos de private_match_stats, que alimentam o
--    ranking global secundário) só se aplicam se: o jogo foi proposto como
--    ranked, TODOS os 4 lugares são jogadores da app (nenhum é um nome
--    sem conta) e todos os 4 responderam "aceitar tudo". Falhando
--    qualquer uma destas condições o jogo confirma na mesma (resultado
--    visível, histórico guardado) mas fica "amigável" — sem Elo, sem
--    pontos no ranking global. Isto vai além do que o design pedia
--    literalmente (só falava do Elo) porque deixar os pontos planos
--    contarem para o mesmo ranking global tornaria "amigável" uma meia-
--    verdade — a decidir com a equipa se for preciso recuar.
--
-- Correr este ficheiro inteiro no Supabase → SQL Editor, ANTES do merge.
-- NOT LIVE until run there — this file existing in the repo changes
-- nothing on its own.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Colunas novas em private_matches ──────────────────────────────────

ALTER TABLE private_matches ADD COLUMN IF NOT EXISTS ranked_intent BOOLEAN NOT NULL DEFAULT TRUE;
COMMENT ON COLUMN private_matches.ranked_intent IS 'Proposto pelo criador ao criar. Só se torna Elo real se todos os 4 lugares forem jogadores da app e todos aceitarem — ver confirm_private_match.';

ALTER TABLE private_matches ADD COLUMN IF NOT EXISTS scheduled_date DATE;
UPDATE private_matches SET scheduled_date = played_at::date WHERE scheduled_date IS NULL;
ALTER TABLE private_matches ALTER COLUMN scheduled_date SET NOT NULL;
ALTER TABLE private_matches ADD COLUMN IF NOT EXISTS scheduled_time TIME;
ALTER TABLE private_matches ADD COLUMN IF NOT EXISTS location TEXT;
-- Mesmo padrão do useGooglePlacesAutocomplete (GerirClube.jsx): texto
-- formatado da morada + coordenadas para uso futuro (mapa/proximidade).
-- NULL quando a pessoa escreve a morada à mão em vez de escolher da lista.
ALTER TABLE private_matches ADD COLUMN IF NOT EXISTS location_latitude DOUBLE PRECISION;
ALTER TABLE private_matches ADD COLUMN IF NOT EXISTS location_longitude DOUBLE PRECISION;

-- Dois formatos apenas — dos 4 dos mixes (pontos_simples/pro_set_9/
-- melhor_2_sets/melhor_3_sets), só o primeiro sobrevive aqui tal e qual;
-- os outros três eram demasiado rígidos para o que os amigos realmente
-- jogam (nem sempre seguem as regras todas, às vezes é mais de 3 sets) —
-- por isso 'sets' é genérico: a pessoa escolhe quantos sets (num_sets,
-- 2 a 9) e o resultado é sempre esse número exato de sets, sem regra de
-- "quem fecha primeiro" nem super-tiebreak automático.
ALTER TABLE private_matches ADD COLUMN IF NOT EXISTS scoring_format TEXT NOT NULL DEFAULT 'pontos_simples';
ALTER TABLE private_matches DROP CONSTRAINT IF EXISTS private_matches_scoring_format_check;
ALTER TABLE private_matches ADD CONSTRAINT private_matches_scoring_format_check
  CHECK (scoring_format IN ('pontos_simples', 'sets'));

ALTER TABLE private_matches ADD COLUMN IF NOT EXISTS num_sets INTEGER;
ALTER TABLE private_matches DROP CONSTRAINT IF EXISTS private_matches_num_sets_check;
ALTER TABLE private_matches ADD CONSTRAINT private_matches_num_sets_check CHECK (
  (scoring_format = 'sets' AND num_sets BETWEEN 2 AND 9)
  OR (scoring_format <> 'sets' AND num_sets IS NULL)
);

-- Estado de consentimento por lugar. 'guest' = nome sem conta (nunca
-- respondeu porque não há com quem — tratado como presente mas nunca
-- elegível para ranking). O lugar do criador (team_a_player1) nunca é
-- 'guest' nem fica NULL — é sempre quem chamou create_private_match.
ALTER TABLE private_matches ADD COLUMN IF NOT EXISTS team_a_player1_status TEXT NOT NULL DEFAULT 'accepted_all';
ALTER TABLE private_matches ADD COLUMN IF NOT EXISTS team_a_player2_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE private_matches ADD COLUMN IF NOT EXISTS team_b_player1_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE private_matches ADD COLUMN IF NOT EXISTS team_b_player2_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE private_matches DROP CONSTRAINT IF EXISTS private_matches_status_values_check;
ALTER TABLE private_matches ADD CONSTRAINT private_matches_status_values_check CHECK (
  team_a_player1_status IN ('pending', 'accepted_all', 'accepted_no_ranking', 'rejected', 'guest')
  AND team_a_player2_status IN ('pending', 'accepted_all', 'accepted_no_ranking', 'rejected', 'guest')
  AND team_b_player1_status IN ('pending', 'accepted_all', 'accepted_no_ranking', 'rejected', 'guest')
  AND team_b_player2_status IN ('pending', 'accepted_all', 'accepted_no_ranking', 'rejected', 'guest')
);

-- Nome de amigos sem conta na app, um por lugar opcional (nunca no lugar
-- do criador). Mutuamente exclusivo com o *_id do mesmo lugar.
ALTER TABLE private_matches ADD COLUMN IF NOT EXISTS team_a_player2_guest_name TEXT;
ALTER TABLE private_matches ADD COLUMN IF NOT EXISTS team_b_player1_guest_name TEXT;
ALTER TABLE private_matches ADD COLUMN IF NOT EXISTS team_b_player2_guest_name TEXT;
ALTER TABLE private_matches DROP CONSTRAINT IF EXISTS private_matches_guest_xor_id_check;
ALTER TABLE private_matches ADD CONSTRAINT private_matches_guest_xor_id_check CHECK (
  (team_a_player2_id IS NULL OR team_a_player2_guest_name IS NULL)
  AND (team_b_player1_id IS NULL OR team_b_player1_guest_name IS NULL)
  AND (team_b_player2_id IS NULL OR team_b_player2_guest_name IS NULL)
);

-- ── 2. private_match_sets: por-set, mesma forma que match_sets ──────────
-- Referencia private_matches diretamente (um jogo privado não passa pela
-- tabela `matches`, exclusiva dos mixes) — só por isso é uma tabela
-- separada e não a mesma.
CREATE TABLE IF NOT EXISTS private_match_sets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  private_match_id UUID NOT NULL REFERENCES private_matches(id) ON DELETE CASCADE,
  set_number INTEGER NOT NULL CHECK (set_number BETWEEN 1 AND 9),
  score_a INTEGER NOT NULL,
  score_b INTEGER NOT NULL,
  is_super_tiebreak BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  UNIQUE (private_match_id, set_number)
);
ALTER TABLE private_match_sets ENABLE ROW LEVEL SECURITY;

-- Mesma forma que "Players can view their private matches" — sem política
-- de escrita, tal como private_matches: só se escreve via
-- submit_private_match_score (SECURITY DEFINER).
DROP POLICY IF EXISTS "Players can view their private match sets" ON private_match_sets;
CREATE POLICY "Players can view their private match sets"
  ON private_match_sets FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM private_matches pm
    WHERE pm.id = private_match_sets.private_match_id
      AND auth.uid() = ANY (ARRAY_REMOVE(ARRAY[
        pm.team_a_player1_id, pm.team_a_player2_id, pm.team_b_player1_id, pm.team_b_player2_id
      ], NULL))
  ));

-- ── 3. create_private_match: intenção, agenda, formato, convidados ──────
-- Assinatura muda (mais parâmetros, ordem diferente) — DROP explícito para
-- não deixar a versão antiga a viver lado a lado como overload.
DROP FUNCTION IF EXISTS create_private_match(UUID, UUID, UUID);

CREATE OR REPLACE FUNCTION create_private_match(
  p_ranked_intent BOOLEAN,
  p_scheduled_date DATE,
  p_scoring_format TEXT DEFAULT 'pontos_simples',
  p_num_sets INTEGER DEFAULT NULL,
  p_scheduled_time TIME DEFAULT NULL,
  p_location TEXT DEFAULT NULL,
  p_location_latitude DOUBLE PRECISION DEFAULT NULL,
  p_location_longitude DOUBLE PRECISION DEFAULT NULL,
  p_team_a_player2_id UUID DEFAULT NULL,
  p_team_a_player2_guest_name TEXT DEFAULT NULL,
  p_team_b_player1_id UUID DEFAULT NULL,
  p_team_b_player1_guest_name TEXT DEFAULT NULL,
  p_team_b_player2_id UUID DEFAULT NULL,
  p_team_b_player2_guest_name TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_filled UUID[];
  v_creator_status TEXT;
BEGIN
  IF p_scheduled_date IS NULL THEN
    RAISE EXCEPTION 'A data do jogo é obrigatória';
  END IF;
  IF p_scoring_format NOT IN ('pontos_simples', 'sets') THEN
    RAISE EXCEPTION 'Formato de pontuação inválido';
  END IF;
  IF p_scoring_format = 'sets' AND (p_num_sets IS NULL OR p_num_sets NOT BETWEEN 2 AND 9) THEN
    RAISE EXCEPTION 'Escolhe quantos sets (entre 2 e 9)';
  END IF;
  IF p_scoring_format = 'pontos_simples' THEN
    p_num_sets := NULL;
  END IF;
  IF (p_team_a_player2_id IS NOT NULL AND p_team_a_player2_guest_name IS NOT NULL)
     OR (p_team_b_player1_id IS NOT NULL AND p_team_b_player1_guest_name IS NOT NULL)
     OR (p_team_b_player2_id IS NOT NULL AND p_team_b_player2_guest_name IS NOT NULL) THEN
    RAISE EXCEPTION 'Escolhe um jogador da app OU um nome, não os dois, para o mesmo lugar';
  END IF;

  v_filled := ARRAY_REMOVE(ARRAY[auth.uid(), p_team_a_player2_id, p_team_b_player1_id, p_team_b_player2_id], NULL);
  IF (SELECT COUNT(*) FROM unnest(v_filled)) <> (SELECT COUNT(DISTINCT x) FROM unnest(v_filled) AS x) THEN
    RAISE EXCEPTION 'Cada jogador só pode ocupar uma posição no jogo';
  END IF;

  -- O criador consente logo ao propor a intenção — sem isso não havia
  -- pergunta nenhuma a fazer-lhe sobre o seu próprio lugar.
  v_creator_status := CASE WHEN p_ranked_intent THEN 'accepted_all' ELSE 'accepted_no_ranking' END;

  INSERT INTO private_matches (
    creator_id, team_a_player1_id, team_a_player2_id, team_b_player1_id, team_b_player2_id,
    ranked_intent, scheduled_date, scheduled_time, location, location_latitude, location_longitude,
    scoring_format, num_sets,
    team_a_player1_status,
    team_a_player2_status, team_a_player2_guest_name,
    team_b_player1_status, team_b_player1_guest_name,
    team_b_player2_status, team_b_player2_guest_name
  )
  VALUES (
    auth.uid(), auth.uid(), p_team_a_player2_id, p_team_b_player1_id, p_team_b_player2_id,
    p_ranked_intent, p_scheduled_date, p_scheduled_time, p_location, p_location_latitude, p_location_longitude,
    p_scoring_format, p_num_sets,
    v_creator_status,
    CASE WHEN p_team_a_player2_guest_name IS NOT NULL THEN 'guest' ELSE 'pending' END, p_team_a_player2_guest_name,
    CASE WHEN p_team_b_player1_guest_name IS NOT NULL THEN 'guest' ELSE 'pending' END, p_team_b_player1_guest_name,
    CASE WHEN p_team_b_player2_guest_name IS NOT NULL THEN 'guest' ELSE 'pending' END, p_team_b_player2_guest_name
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION create_private_match(
  BOOLEAN, DATE, TEXT, INTEGER, TIME, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, UUID, TEXT, UUID, TEXT, UUID, TEXT
) FROM public;
GRANT EXECUTE ON FUNCTION create_private_match(
  BOOLEAN, DATE, TEXT, INTEGER, TIME, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, UUID, TEXT, UUID, TEXT, UUID, TEXT
) TO authenticated;

-- ── 4. claim_private_match_slot: também bloqueia lugares só-por-nome ────
-- Um lugar ocupado por um nome sem conta não é "aberto" para um link de
-- convite — se a pessoa criar conta entretanto, o criador tem de apagar e
-- recriar o jogo (limitação aceite por agora, fora do pedido original).

CREATE OR REPLACE FUNCTION claim_private_match_slot(p_match_id UUID, p_slot TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match private_matches;
BEGIN
  IF p_slot IS NULL OR p_slot NOT IN ('team_a_player2', 'team_b_player1', 'team_b_player2') THEN
    RAISE EXCEPTION 'Posição inválida';
  END IF;

  SELECT * INTO v_match FROM private_matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jogo não encontrado';
  END IF;
  IF v_match.status <> 'pending' THEN
    RAISE EXCEPTION 'Este jogo já não aceita novos jogadores';
  END IF;

  IF auth.uid() = ANY (ARRAY_REMOVE(ARRAY[
    v_match.team_a_player1_id, v_match.team_a_player2_id,
    v_match.team_b_player1_id, v_match.team_b_player2_id
  ], NULL)) THEN
    RAISE EXCEPTION 'Já estás neste jogo';
  END IF;

  IF p_slot = 'team_a_player2' THEN
    IF v_match.team_a_player2_id IS NOT NULL OR v_match.team_a_player2_guest_name IS NOT NULL THEN
      RAISE EXCEPTION 'Esta posição já foi ocupada';
    END IF;
    UPDATE private_matches SET team_a_player2_id = auth.uid(), team_a_player2_status = 'pending' WHERE id = p_match_id;
  ELSIF p_slot = 'team_b_player1' THEN
    IF v_match.team_b_player1_id IS NOT NULL OR v_match.team_b_player1_guest_name IS NOT NULL THEN
      RAISE EXCEPTION 'Esta posição já foi ocupada';
    END IF;
    UPDATE private_matches SET team_b_player1_id = auth.uid(), team_b_player1_status = 'pending' WHERE id = p_match_id;
  ELSE
    IF v_match.team_b_player2_id IS NOT NULL OR v_match.team_b_player2_guest_name IS NOT NULL THEN
      RAISE EXCEPTION 'Esta posição já foi ocupada';
    END IF;
    UPDATE private_matches SET team_b_player2_id = auth.uid(), team_b_player2_status = 'pending' WHERE id = p_match_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION claim_private_match_slot(UUID, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION claim_private_match_slot(UUID, TEXT) TO authenticated;

-- ── 5. respond_to_private_match: a resposta individual de cada jogador ──

CREATE OR REPLACE FUNCTION respond_to_private_match(p_match_id UUID, p_response TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match private_matches;
  v_slot TEXT;
  v_effective_response TEXT := p_response;
BEGIN
  IF p_response NOT IN ('accept_all', 'accept_no_ranking', 'reject') THEN
    RAISE EXCEPTION 'Resposta inválida';
  END IF;

  SELECT * INTO v_match FROM private_matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jogo não encontrado';
  END IF;
  IF v_match.status <> 'pending' THEN
    RAISE EXCEPTION 'Este jogo já foi confirmado';
  END IF;

  v_slot := CASE
    WHEN v_match.team_a_player1_id = auth.uid() THEN 'team_a_player1'
    WHEN v_match.team_a_player2_id = auth.uid() THEN 'team_a_player2'
    WHEN v_match.team_b_player1_id = auth.uid() THEN 'team_b_player1'
    WHEN v_match.team_b_player2_id = auth.uid() THEN 'team_b_player2'
    ELSE NULL
  END;
  IF v_slot IS NULL THEN
    RAISE EXCEPTION 'Não fazes parte deste jogo';
  END IF;

  -- Sem intenção de ranking não há pergunta de ranking a responder — só
  -- fica aceitar o registo ou recusar.
  IF NOT v_match.ranked_intent AND p_response = 'accept_all' THEN
    v_effective_response := 'accept_no_ranking';
  END IF;

  IF v_effective_response = 'reject' THEN
    IF v_slot = 'team_a_player1' THEN
      RAISE EXCEPTION 'Quem criou o jogo não pode recusar a própria criação — elimina o jogo em vez disso';
    END IF;
    -- Sai do registo por completo: a posição volta a ficar por preencher,
    -- tal como nunca tivesse sido ocupada — aplica-se mesmo em jogos sem
    -- ranking (a escolha de ficar associado ao registo é sempre
    -- individual, independente de contar ou não para o Elo).
    EXECUTE format('UPDATE private_matches SET %I = NULL, %I = ''pending'' WHERE id = $1',
      v_slot || '_id', v_slot || '_status') USING p_match_id;
  ELSE
    EXECUTE format('UPDATE private_matches SET %I = $2 WHERE id = $1', v_slot || '_status')
      USING p_match_id, v_effective_response;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION respond_to_private_match(UUID, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION respond_to_private_match(UUID, TEXT) TO authenticated;

-- ── 6. submit_private_match_score: aceita também sets ───────────────────

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
  IF p_score_a IS NULL OR p_score_b IS NULL OR p_score_a = p_score_b THEN
    RAISE EXCEPTION 'Resultado inválido';
  END IF;
  IF p_score_a < 0 OR p_score_b < 0 THEN
    RAISE EXCEPTION 'Resultado inválido';
  END IF;

  UPDATE private_matches
  SET score_a = p_score_a,
      score_b = p_score_b,
      winner_team = CASE WHEN p_score_a > p_score_b THEN 'a' ELSE 'b' END,
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

REVOKE ALL ON FUNCTION submit_private_match_score(UUID, INTEGER, INTEGER, JSONB) FROM public;
GRANT EXECUTE ON FUNCTION submit_private_match_score(UUID, INTEGER, INTEGER, JSONB) TO authenticated;

-- ── 7. confirm_private_match: Elo/pontos só se ranked unânime ───────────

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
END;
$$;

REVOKE ALL ON FUNCTION confirm_private_match(UUID) FROM public;
GRANT EXECUTE ON FUNCTION confirm_private_match(UUID) TO authenticated;

-- ── 8. get_my_private_matches: devolve os campos novos ──────────────────

DROP FUNCTION IF EXISTS get_my_private_matches();

CREATE OR REPLACE FUNCTION get_my_private_matches()
RETURNS TABLE (
  id UUID,
  status TEXT,
  score_a INTEGER,
  score_b INTEGER,
  winner_team TEXT,
  played_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  is_creator BOOLEAN,
  ranked_intent BOOLEAN,
  scheduled_date DATE,
  scheduled_time TIME,
  location TEXT,
  location_latitude DOUBLE PRECISION,
  location_longitude DOUBLE PRECISION,
  scoring_format TEXT,
  num_sets INTEGER,
  team_a_player1_id UUID, team_a_player1_name TEXT, team_a_player1_avatar TEXT, team_a_player1_status TEXT,
  team_a_player2_id UUID, team_a_player2_name TEXT, team_a_player2_avatar TEXT, team_a_player2_status TEXT, team_a_player2_guest_name TEXT,
  team_b_player1_id UUID, team_b_player1_name TEXT, team_b_player1_avatar TEXT, team_b_player1_status TEXT, team_b_player1_guest_name TEXT,
  team_b_player2_id UUID, team_b_player2_name TEXT, team_b_player2_avatar TEXT, team_b_player2_status TEXT, team_b_player2_guest_name TEXT,
  my_points INTEGER,
  score_submitted_by UUID,
  score_submitted_by_name TEXT,
  my_rating_delta NUMERIC,
  my_rating_after NUMERIC
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    pm.id, pm.status, pm.score_a, pm.score_b, pm.winner_team, pm.played_at, pm.confirmed_at,
    pm.creator_id = auth.uid(),
    pm.ranked_intent, pm.scheduled_date, pm.scheduled_time, pm.location, pm.location_latitude, pm.location_longitude,
    pm.scoring_format, pm.num_sets,
    pm.team_a_player1_id, pa1.name, pa1.avatar_url, pm.team_a_player1_status,
    pm.team_a_player2_id, pa2.name, pa2.avatar_url, pm.team_a_player2_status, pm.team_a_player2_guest_name,
    pm.team_b_player1_id, pb1.name, pb1.avatar_url, pm.team_b_player1_status, pm.team_b_player1_guest_name,
    pm.team_b_player2_id, pb2.name, pb2.avatar_url, pm.team_b_player2_status, pm.team_b_player2_guest_name,
    pms.points_earned,
    pm.score_submitted_by, psub.name,
    pms.rating_delta, pms.rating_after
  FROM private_matches pm
  LEFT JOIN profiles pa1 ON pa1.id = pm.team_a_player1_id
  LEFT JOIN profiles pa2 ON pa2.id = pm.team_a_player2_id
  LEFT JOIN profiles pb1 ON pb1.id = pm.team_b_player1_id
  LEFT JOIN profiles pb2 ON pb2.id = pm.team_b_player2_id
  LEFT JOIN profiles psub ON psub.id = pm.score_submitted_by
  LEFT JOIN private_match_stats pms ON pms.private_match_id = pm.id AND pms.user_id = auth.uid()
  WHERE auth.uid() = ANY (
    ARRAY_REMOVE(ARRAY[pm.team_a_player1_id, pm.team_a_player2_id, pm.team_b_player1_id, pm.team_b_player2_id], NULL)
  )
  ORDER BY pm.played_at DESC;
$$;

REVOKE ALL ON FUNCTION get_my_private_matches() FROM public;
GRANT EXECUTE ON FUNCTION get_my_private_matches() TO authenticated;
