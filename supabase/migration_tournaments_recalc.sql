-- ⚠️⚠️ NÃO VOLTAR A CORRER ESTE FICHEIRO INTEIRO (Dev 3, 25 set 2026, #491).
-- Tem o CREATE OR REPLACE da mark_walkover ANTIGA, de 4 argumentos: sem as
-- faltas em cadeia do #459 e sem as regras do #491. Correr isto outra vez
-- deixa duas mark_walkover em produção (chamadas «ambíguas», PGRST203, como
-- no #465). A que vale é a de 6 argumentos, da
-- migration_tournaments_walkover_rest.sql + migration_tournament_walkover
-- _guards.sql. Precisas de outra peça daqui? Copia só essa função.
--
-- ════════════════════════════════════════════════════════════════════════
-- TORNEIOS, PARTE 13: CORRIGIR UM RESULTADO DEPOIS DE FECHAR ACERTA OS PONTOS
-- (Dev 3, 23 set 2026) — cartão #449 (P0).
--
-- CORRER DEPOIS de todas as anteriores (base → prizes). Pode-se correr
-- outra vez sem estragar.
--
-- A REGRA (Francisco, 22 set, em `Alinho/notas-entre-devs/`): «o admin pode
-- sempre corrigir um resultado, mesmo depois de o jogo estar fechado», com
-- recálculo do que depender dele.
--
-- O QUE FALTAVA: corrigir funcionava, mas **nada recalculava os pontos**.
-- Ficava o resultado certo no ecrã e os pontos errados no ranking — que é
-- pior do que não deixar corrigir, porque ninguém desconfia.
--
-- PORQUE SE FAZ AGORA: as migrações ainda não correram em produção, logo
-- ainda não há um único ponto de torneio dado a ninguém. Depois disso,
-- mexer nisto é mexer em pontos que as pessoas já viram no perfil.
--
-- COMO: não se recalcula «a diferença». Desfaz-se o que foi dado e dá-se
-- tudo outra vez do zero. É exato porque o `tournament_player_stats` guarda
-- o delta que cada pessoa levou, e o `tournament_match_players` (#442)
-- guarda quem jogou cada jogo — sem esses dois, isto não se fazia bem.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. A categoria guarda o seu pódio ───────────────────────────────────
-- Sem isto, uma categoria só de grupos (cujo pódio veio do ecrã, porque o
-- desempate vive nas contas testadas de tournamentFormat.js) perdia o
-- pódio ao recalcular. Com quadro, continua a sair da final.
ALTER TABLE tournament_categories
  ADD COLUMN IF NOT EXISTS champion_entry_id  UUID REFERENCES tournament_entries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS runner_up_entry_id UUID REFERENCES tournament_entries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS third_entry_id     UUID REFERENCES tournament_entries(id) ON DELETE SET NULL;

-- ── 2. Desfazer o que foi dado ──────────────────────────────────────────
-- Subtrai a cada pessoa exatamente o que levou, e devolve os jogos
-- contados. Não mexe em mais nada: o que a pessoa ganhou noutros torneios
-- ou noutros mixes entretanto fica como está.
CREATE OR REPLACE FUNCTION undo_tournament_elo(p_category_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n INTEGER;
BEGIN
  UPDATE profiles pr
     SET rating = GREATEST(0, COALESCE(pr.rating, 900) - COALESCE(s.rating_delta, 0)),
         rating_games = GREATEST(0, pr.rating_games - COALESCE(s.matches_played, 0))
    FROM tournament_player_stats s
   WHERE s.category_id = p_category_id AND pr.id = s.user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  DELETE FROM tournament_player_stats WHERE category_id = p_category_id;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION undo_tournament_elo(UUID) FROM public, anon, authenticated;

-- ── 3. Recalcular do zero ───────────────────────────────────────────────
-- Corre sozinha quando se corrige um resultado de uma categoria já
-- fechada. Desfaz, volta a decidir o pódio e volta a distribuir.
CREATE OR REPLACE FUNCTION recalculate_category_points(p_category_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_final      tournament_matches;
  v_third_m    tournament_matches;
  v_champion   UUID;
  v_runner_up  UUID;
  v_third_id   UUID;
  v_desfeitos  INTEGER;
BEGIN
  IF (SELECT status FROM tournament_categories WHERE id = p_category_id) <> 'terminada' THEN
    RETURN jsonb_build_object('skipped', TRUE);
  END IF;

  v_desfeitos := undo_tournament_elo(p_category_id);

  -- O pódio pode ter MUDADO com a correção: se a final foi corrigida, o
  -- campeão é outro, e com ele o bónus de 1% e os lugares. É o caso que o
  -- PO mandou destacar no cartão.
  SELECT * INTO v_final FROM tournament_matches
   WHERE category_id = p_category_id AND stage = 'principal' AND round = 'F'
   ORDER BY bracket_slot LIMIT 1;

  IF v_final.id IS NOT NULL AND v_final.winner_entry_id IS NOT NULL THEN
    v_champion := v_final.winner_entry_id;
    v_runner_up := CASE WHEN v_final.entry_a_id = v_champion
                        THEN v_final.entry_b_id ELSE v_final.entry_a_id END;
    SELECT * INTO v_third_m FROM tournament_matches
     WHERE category_id = p_category_id AND stage = '3lugar' LIMIT 1;
    v_third_id := v_third_m.winner_entry_id;
  ELSE
    -- Só grupos: o pódio foi decidido pelo ecrã quando se fechou, e fica.
    -- Se a correção mudar a classificação do grupo, quem tem de o dizer é
    -- o organizador — o desempate não se repete aqui em SQL.
    SELECT champion_entry_id, runner_up_entry_id, third_entry_id
      INTO v_champion, v_runner_up, v_third_id
      FROM tournament_categories WHERE id = p_category_id;
  END IF;

  PERFORM apply_tournament_elo(p_category_id, v_champion);

  UPDATE tournament_player_stats s
     SET final_position = CASE WHEN s.entry_id = v_champion THEN 1
                               WHEN s.entry_id = v_runner_up THEN 2
                               WHEN s.entry_id = v_third_id THEN 3 END
   WHERE s.category_id = p_category_id;

  UPDATE tournament_categories
     SET champion_entry_id = v_champion,
         runner_up_entry_id = v_runner_up,
         third_entry_id = v_third_id
   WHERE id = p_category_id;

  RETURN jsonb_build_object(
    'recalculated', TRUE, 'undone', v_desfeitos, 'champion', v_champion,
    'players_rated', (SELECT count(*) FROM tournament_player_stats WHERE category_id = p_category_id));
END;
$$;

REVOKE ALL ON FUNCTION recalculate_category_points(UUID) FROM public, anon, authenticated;

-- ── 4. Guardar o pódio ao fechar ────────────────────────────────────────
-- Só acrescenta a gravação do pódio nas colunas novas; o resto é igual.
CREATE OR REPLACE FUNCTION finish_category(
  p_category_id UUID,
  p_champion UUID DEFAULT NULL,
  p_runner_up UUID DEFAULT NULL,
  p_third UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tournament UUID;
  v_status     TEXT;
  v_falta      INTEGER;
  v_final      tournament_matches;
  v_third_m    tournament_matches;
  v_champion   UUID;
  v_runner_up  UUID;
  v_third_id   UUID;
  v_id         UUID;
BEGIN
  v_tournament := tournament_of_category(p_category_id);
  IF v_tournament IS NULL THEN
    RAISE EXCEPTION 'Categoria não encontrada';
  END IF;
  IF NOT is_tournament_admin(v_tournament) THEN
    RAISE EXCEPTION 'Só um admin do clube pode fechar a categoria'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT status INTO v_status FROM tournament_categories WHERE id = p_category_id;
  IF v_status = 'terminada' THEN
    RAISE EXCEPTION 'Esta categoria já está fechada';
  END IF;
  IF v_status NOT IN ('sorteada','a_decorrer') THEN
    RAISE EXCEPTION 'Esta categoria ainda não foi sorteada';
  END IF;

  SELECT count(*) INTO v_falta
    FROM tournament_matches m
   WHERE m.category_id = p_category_id
     AND m.entry_a_id IS NOT NULL AND m.entry_b_id IS NOT NULL
     AND m.status IN ('marcado','a_decorrer');
  IF v_falta = 1 THEN
    RAISE EXCEPTION 'Ainda falta 1 jogo por marcar nesta categoria';
  END IF;
  IF v_falta > 0 THEN
    RAISE EXCEPTION 'Ainda faltam % jogos por marcar nesta categoria', v_falta;
  END IF;

  SELECT * INTO v_final FROM tournament_matches
   WHERE category_id = p_category_id AND stage = 'principal' AND round = 'F'
   ORDER BY bracket_slot LIMIT 1;

  IF v_final.id IS NOT NULL THEN
    IF v_final.winner_entry_id IS NULL THEN
      RAISE EXCEPTION 'A final ainda não foi jogada';
    END IF;
    v_champion := v_final.winner_entry_id;
    v_runner_up := CASE WHEN v_final.entry_a_id = v_champion
                        THEN v_final.entry_b_id ELSE v_final.entry_a_id END;
    SELECT * INTO v_third_m FROM tournament_matches
     WHERE category_id = p_category_id AND stage = '3lugar' LIMIT 1;
    v_third_id := v_third_m.winner_entry_id;
  ELSE
    IF p_champion IS NULL THEN
      RAISE EXCEPTION 'Esta categoria não tem final: diz quem ficou em primeiro';
    END IF;
    FOREACH v_id IN ARRAY array_remove(ARRAY[p_champion, p_runner_up, p_third], NULL) LOOP
      IF NOT EXISTS (SELECT 1 FROM tournament_entries e
                      WHERE e.id = v_id AND e.category_id = p_category_id
                        AND e.status = 'selecionada') THEN
        RAISE EXCEPTION 'Há uma dupla do pódio que não é desta categoria';
      END IF;
    END LOOP;
    IF p_runner_up IS NOT NULL AND p_runner_up = p_champion THEN
      RAISE EXCEPTION 'A mesma dupla não pode ficar em dois lugares';
    END IF;
    IF p_third IS NOT NULL AND p_third IN (p_champion, p_runner_up) THEN
      RAISE EXCEPTION 'A mesma dupla não pode ficar em dois lugares';
    END IF;
    v_champion := p_champion;
    v_runner_up := p_runner_up;
    v_third_id := p_third;
  END IF;

  PERFORM apply_tournament_elo(p_category_id, v_champion);

  UPDATE tournament_player_stats s
     SET final_position = CASE WHEN s.entry_id = v_champion THEN 1
                               WHEN s.entry_id = v_runner_up THEN 2
                               WHEN s.entry_id = v_third_id THEN 3 END
   WHERE s.category_id = p_category_id;

  -- Guardado para o recálculo: sem isto, corrigir um resultado numa
  -- categoria só de grupos perdia o pódio.
  UPDATE tournament_categories
     SET status = 'terminada',
         champion_entry_id = v_champion,
         runner_up_entry_id = v_runner_up,
         third_entry_id = v_third_id
   WHERE id = p_category_id;

  UPDATE tournaments SET status = 'terminado'
   WHERE id = v_tournament
     AND NOT EXISTS (SELECT 1 FROM tournament_categories c
                      WHERE c.tournament_id = v_tournament AND c.status <> 'terminada');

  RETURN jsonb_build_object(
    'champion', v_champion, 'runner_up', v_runner_up, 'third', v_third_id,
    'from_bracket', v_final.id IS NOT NULL,
    'players_rated', (SELECT count(*) FROM tournament_player_stats WHERE category_id = p_category_id));
END;
$$;

REVOKE ALL ON FUNCTION finish_category(UUID, UUID, UUID, UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION finish_category(UUID, UUID, UUID, UUID) TO authenticated;

-- ── 5. As duas portas por onde um resultado muda ────────────────────────
-- Redefinidas so para acrescentar o recalculo quando a categoria ja esta
-- fechada. O resto e igual ao que esta em `migration_tournaments_who_played.sql`.

CREATE OR REPLACE FUNCTION save_match_result(
  p_match_id UUID, p_score_a INTEGER, p_score_b INTEGER, p_sets JSONB DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m            tournament_matches;
  v_tournament UUID;
  v_winner     UUID;
  v_is_fix     BOOLEAN;
BEGIN
  SELECT * INTO m FROM tournament_matches WHERE id = p_match_id;
  IF m.id IS NULL THEN
    RAISE EXCEPTION 'Jogo não encontrado';
  END IF;
  v_tournament := tournament_of_category(m.category_id);
  IF NOT can_score_tournament(v_tournament, m.category_id) THEN
    RAISE EXCEPTION 'Não podes marcar resultados nesta categoria'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_score_a IS NULL OR p_score_b IS NULL OR p_score_a < 0 OR p_score_b < 0 THEN
    RAISE EXCEPTION 'Resultado inválido';
  END IF;
  IF p_score_a = p_score_b THEN
    RAISE EXCEPTION 'Um jogo não pode acabar empatado';
  END IF;
  IF m.entry_a_id IS NULL OR m.entry_b_id IS NULL THEN
    RAISE EXCEPTION 'Este jogo ainda não tem as duas duplas';
  END IF;

  v_winner := CASE WHEN p_score_a > p_score_b THEN m.entry_a_id ELSE m.entry_b_id END;
  v_is_fix := m.status IN ('terminado','falta','desistencia');

  -- Antes de gravar o resultado: quem esteve em campo. Numa correção não
  -- faz nada — a equipa do jogo já está congelada e não se reescreve.
  PERFORM freeze_match_players(p_match_id);

  UPDATE tournament_matches SET
    score_a = p_score_a, score_b = p_score_b,
    sets = p_sets,
    status = 'terminado',
    winner_entry_id = v_winner,
    walkover_justified = NULL,
    started_at = COALESCE(started_at, NOW()),
    ended_at = NOW(),
    corrected_by = CASE WHEN v_is_fix THEN auth.uid() ELSE corrected_by END,
    corrected_at = CASE WHEN v_is_fix THEN NOW() ELSE corrected_at END
  WHERE id = p_match_id;

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
CREATE OR REPLACE FUNCTION mark_walkover(
  p_match_id UUID, p_kind TEXT, p_loser TEXT, p_justified BOOLEAN DEFAULT NULL)
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

  v_a := COALESCE(m.score_a, 0);
  v_b := COALESCE(m.score_b, 0);
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

REVOKE ALL ON FUNCTION save_match_result(UUID, INTEGER, INTEGER, JSONB) FROM public, anon;
REVOKE ALL ON FUNCTION mark_walkover(UUID, TEXT, TEXT, BOOLEAN) FROM public, anon;
GRANT EXECUTE ON FUNCTION save_match_result(UUID, INTEGER, INTEGER, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION mark_walkover(UUID, TEXT, TEXT, BOOLEAN) TO authenticated;

-- ── 6. O arredondamento, para a ida e volta fechar a zero ──────────────
-- Apanhado a testar esta parte: corrigir um resultado para o MESMO valor
-- deixava dois jogadores em oito com um cêntimo de diferença, e o erro
-- crescia a cada correção. Só muda onde se arredonda — os números que as
-- pessoas veem são os mesmos, porque o rating já só tem dois decimais.
CREATE OR REPLACE FUNCTION apply_tournament_elo(p_category_id UUID, p_champion_entry_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m RECORD;
  pl RECORD;
  v_r_a NUMERIC;
  v_r_b NUMERIC;
  v_e_a NUMERIC;
  v_s_a NUMERIC;
  v_w NUMERIC;
  v_share NUMERIC;
  v_k INTEGER;
  v_delta NUMERIC;
  v_had_matches BOOLEAN := FALSE;
  v_bonus_total NUMERIC;
  v_payer_rating_sum NUMERIC;
  v_campeoes UUID[];
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _elo_torneio (
    pid UUID PRIMARY KEY,
    delta NUMERIC NOT NULL DEFAULT 0,
    played INTEGER NOT NULL DEFAULT 0,
    won INTEGER NOT NULL DEFAULT 0,
    bonus NUMERIC NOT NULL DEFAULT 0
  ) ON COMMIT DROP;
  TRUNCATE _elo_torneio;

  FOR m IN
    SELECT mt.id, mt.score_a, mt.score_b, mt.winner_entry_id, mt.entry_a_id,
           -- Quem esteve em campo. A ordem não interessa: o que interessa é
           -- que sejam as pessoas DAQUELE jogo.
           (SELECT array_agg(p.user_id) FROM tournament_match_players p
             WHERE p.match_id = mt.id AND p.side = 'a' AND p.user_id IS NOT NULL) AS lado_a,
           (SELECT array_agg(p.user_id) FROM tournament_match_players p
             WHERE p.match_id = mt.id AND p.side = 'b' AND p.user_id IS NOT NULL) AS lado_b,
           ea.player1_id AS ea1, ea.player2_id AS ea2,
           eb.player1_id AS eb1, eb.player2_id AS eb2
    FROM tournament_matches mt
    JOIN tournament_entries ea ON ea.id = mt.entry_a_id
    JOIN tournament_entries eb ON eb.id = mt.entry_b_id
    WHERE mt.category_id = p_category_id
      AND mt.status = 'terminado'
      AND mt.winner_entry_id IS NOT NULL
    ORDER BY mt.scheduled_at NULLS LAST, mt.created_at, mt.id
  LOOP
    DECLARE
      v_a UUID[] := COALESCE(m.lado_a, ARRAY_REMOVE(ARRAY[m.ea1, m.ea2], NULL));
      v_b UUID[] := COALESCE(m.lado_b, ARRAY_REMOVE(ARRAY[m.eb1, m.eb2], NULL));
    BEGIN
      v_had_matches := TRUE;

      SELECT AVG(COALESCE(pr.rating, 900)) INTO v_r_a
      FROM unnest(v_a) AS pid JOIN profiles pr ON pr.id = pid;
      SELECT AVG(COALESCE(pr.rating, 900)) INTO v_r_b
      FROM unnest(v_b) AS pid JOIN profiles pr ON pr.id = pid;
      IF v_r_a IS NULL OR v_r_b IS NULL THEN
        CONTINUE;
      END IF;

      v_s_a := CASE
        WHEN m.score_a IS NOT NULL AND m.score_a = m.score_b THEN 0.5
        WHEN m.winner_entry_id = m.entry_a_id THEN 1
        ELSE 0
      END;
      v_e_a := 1 / (1 + power(10::numeric, (v_r_b - v_r_a) / 400));

      FOR pl IN
        SELECT t.pid,
               CASE WHEN t.is_a THEN v_s_a ELSE 1 - v_s_a END AS s,
               CASE WHEN t.is_a THEN v_e_a ELSE 1 - v_e_a END AS e,
               COALESCE(pr.rating, 900) AS r,
               pr.rating_games,
               (SELECT COALESCE(pr2.rating, 900) FROM profiles pr2 WHERE pr2.id = t.partner) AS partner_r
        FROM (
          SELECT v_a[1] AS pid, v_a[2] AS partner, TRUE AS is_a WHERE array_length(v_a,1) >= 1
          UNION ALL SELECT v_a[2], v_a[1], TRUE WHERE array_length(v_a,1) >= 2
          UNION ALL SELECT v_b[1], v_b[2], FALSE WHERE array_length(v_b,1) >= 1
          UNION ALL SELECT v_b[2], v_b[1], FALSE WHERE array_length(v_b,1) >= 2
        ) AS t
        JOIN profiles pr ON pr.id = t.pid
      LOOP
        IF pl.partner_r IS NULL THEN
          v_share := 1;
        ELSIF pl.s = 0.5 THEN
          v_share := 0.5;
        ELSE
          v_w := LEAST(0.65, GREATEST(0.35, pl.partner_r / NULLIF(pl.r + pl.partner_r, 0)));
          v_w := COALESCE(v_w, 0.5);
          v_share := CASE WHEN pl.s = 1 THEN v_w ELSE 1 - v_w END;
        END IF;

        v_k := CASE WHEN pl.rating_games < 5 THEN 40
                    WHEN pl.rating_games < 20 THEN 30
                    ELSE 20 END;

        -- ARREDONDAR AQUI, e nao so no fim. O `profiles.rating` e
        -- numeric(7,2): cada soma e arredondada ao gravar. Se o que se
        -- acumula tiver mais casas do que o que se aplicou, o
        -- `undo_tournament_elo` subtrai um numero que nunca foi dado, e o
        -- erro ACUMULA a cada correcao (medido: 0,01 a primeira, 0,06 a
        -- quinta, sempre no mesmo sentido). Arredondado aqui, o que o
        -- `tournament_player_stats` guarda e exatamente o que foi aplicado,
        -- e a ida e volta fecha a zero por construcao.
        v_delta := ROUND(v_k * (pl.s - pl.e) * v_share * 2, 2);

        UPDATE profiles
        SET rating = GREATEST(0, COALESCE(rating, 900) + v_delta),
            rating_games = rating_games + 1
        WHERE id = pl.pid;

        INSERT INTO _elo_torneio (pid, delta, played, won)
        VALUES (pl.pid, v_delta, 1, CASE WHEN pl.s = 1 THEN 1 ELSE 0 END)
        ON CONFLICT (pid) DO UPDATE
        SET delta = _elo_torneio.delta + EXCLUDED.delta,
            played = _elo_torneio.played + 1,
            won = _elo_torneio.won + EXCLUDED.won;
      END LOOP;
    END;
  END LOOP;

  IF v_had_matches AND p_champion_entry_id IS NOT NULL THEN
    -- O bonus de campeao vai para quem JOGOU A FINAL, nao para quem estiver
    -- na inscricao no fim. Sem isto, a ultima linha desta funcao desfazia o
    -- que o resto dela passou a fazer: no ensaio, quem jogou 1 dos 4 jogos
    -- levava o bonus e quem jogou 3 nao levava nada.
    -- Sem final (categoria so de grupos) ou sem equipa congelada, cai para
    -- as pessoas da inscricao, que e a melhor verdade que ha.
    SELECT array_agg(mp.user_id) INTO v_campeoes
      FROM tournament_match_players mp
      JOIN tournament_matches fm ON fm.id = mp.match_id
     WHERE fm.category_id = p_category_id
       AND fm.stage = 'principal' AND fm.round = 'F'
       AND fm.winner_entry_id = p_champion_entry_id
       AND mp.user_id IS NOT NULL
       AND mp.side = CASE WHEN fm.entry_a_id = p_champion_entry_id THEN 'a' ELSE 'b' END;

    IF v_campeoes IS NULL THEN
      SELECT array_remove(ARRAY[player1_id, player2_id], NULL) INTO v_campeoes
        FROM tournament_entries WHERE id = p_champion_entry_id;
    END IF;

    UPDATE _elo_torneio n
    SET bonus = (CASE WHEN n.pid = ANY (v_campeoes) THEN 0.01 ELSE 0 END
               + CASE WHEN n.played > 0 AND n.won = n.played THEN 0.005 ELSE 0 END)
              * COALESCE((SELECT pr.rating FROM profiles pr WHERE pr.id = n.pid), 900);
    -- Pela mesma razao do delta: o que se acumula tem de ser o que se aplica.
    UPDATE _elo_torneio SET bonus = ROUND(bonus, 2) WHERE bonus <> 0;

    SELECT COALESCE(SUM(bonus), 0) INTO v_bonus_total FROM _elo_torneio WHERE bonus > 0;
    SELECT COALESCE(SUM(COALESCE(pr.rating, 900)), 0) INTO v_payer_rating_sum
    FROM _elo_torneio n JOIN profiles pr ON pr.id = n.pid
    WHERE n.bonus = 0;

    IF v_bonus_total > 0 AND v_payer_rating_sum > 0 THEN
      UPDATE _elo_torneio n
      SET bonus = ROUND(- v_bonus_total * COALESCE(pr.rating, 900) / v_payer_rating_sum, 2)
      FROM profiles pr
      WHERE pr.id = n.pid AND n.bonus = 0;

      UPDATE _elo_torneio SET delta = delta + bonus WHERE TRUE;  -- WHERE TRUE: o pg_safeupdate recusa UPDATE sem WHERE (ver migration_fix_tournament_elo_safeupdate.sql)

      UPDATE profiles pr
      SET rating = GREATEST(0, COALESCE(pr.rating, 900) + n.bonus)
      FROM _elo_torneio n
      WHERE pr.id = n.pid;
    END IF;
  END IF;

  INSERT INTO tournament_player_stats (category_id, user_id, entry_id, matches_played, matches_won, rating_delta, rating_after)
  SELECT p_category_id, n.pid,
         (SELECT p.entry_id FROM tournament_match_players p
            JOIN tournament_matches mm ON mm.id = p.match_id
           WHERE mm.category_id = p_category_id AND p.user_id = n.pid LIMIT 1),
         n.played, n.won, ROUND(n.delta, 2), ROUND(COALESCE(pr.rating, 900), 2)
  FROM _elo_torneio n JOIN profiles pr ON pr.id = n.pid
  ON CONFLICT (category_id, user_id) DO UPDATE
  SET matches_played = EXCLUDED.matches_played,
      matches_won = EXCLUDED.matches_won,
      rating_delta = EXCLUDED.rating_delta,
      rating_after = EXCLUDED.rating_after;
END;
$$;

REVOKE ALL ON FUNCTION apply_tournament_elo(UUID, UUID) FROM public, anon, authenticated;
