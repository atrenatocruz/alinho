-- ═════════════════════════════════════════════════════════════════════════
-- ENSAIO DO RECÁLCULO DOS NÍVEIS, NUMA CÓPIA (#440)
-- (Dev 3, 24 set 2026)
--
-- GERADO a partir de `migration_ranking_soma_zero.sql` (partes 1 a 5) e de
-- `recalcular_niveis.sql`: é o MESMO código, só com `search_path` apontado
-- à cópia. Não editar à mão — mudar os originais e voltar a gerar
-- (ver o fim deste ficheiro).
--
-- Corre no alinho-dev, no esquema `ensaio_niveis`, com cópias das tabelas de
-- produção. Não toca em `public`: cada função tem `search_path =
-- ensaio_niveis` e nada mais, e o ficheiro recusa se o esquema não existir.
--
-- ─────────────────────────────────────────────────────────────────────────
-- ANTES: copiar de produção para `ensaio_niveis` (System Integrator)
-- ─────────────────────────────────────────────────────────────────────────
-- Com as colunas e chaves de PRODUÇÃO (o alinho-dev está atrasado nestas
-- tabelas), todas as linhas:
--   profiles                 (pelo menos id, name, rating, rating_anchor, rating_games; chave id)
--   games, teams, matches, mix_player_stats
--   private_matches, private_match_stats
--   group_matches
--   tournament_categories, tournament_matches, tournament_entries,
--   tournament_match_players, tournament_player_stats
--                            (com a regra UNIQUE (category_id, user_id))
-- Chaves primárias como em produção. Não são precisas as ligações entre
-- tabelas nem os gatilhos.
--
-- ─────────────────────────────────────────────────────────────────────────
-- DEPOIS
-- ─────────────────────────────────────────────────────────────────────────
--   SET search_path = ensaio_niveis;
--   SELECT * FROM recalcular_niveis(TRUE);   -- na cópia pode gravar: é descartável
-- E a lista pessoa a pessoa:
--   SELECT quem, antes, depois, diferenca, jogos_antes, jogos_depois, nota
--     FROM ensaio_niveis.recalcular_niveis(FALSE) WHERE tipo = 'pessoa'
--    ORDER BY abs(diferenca) DESC;
-- ═════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF to_regnamespace('ensaio_niveis') IS NULL THEN
    RAISE EXCEPTION 'Falta o esquema ensaio_niveis com as cópias de produção. Ver o topo do ficheiro.';
  END IF;
  IF to_regclass('ensaio_niveis.profiles') IS NULL OR to_regclass('ensaio_niveis.matches') IS NULL THEN
    RAISE EXCEPTION 'O esquema ensaio_niveis existe mas faltam as cópias das tabelas. Ver o topo do ficheiro.';
  END IF;
END $$;

-- Tudo o que se criar daqui para baixo vai para a cópia — e só para ela: se
-- o esquema não existisse, o Postgres recusava em vez de criar em public.
SET search_path = ensaio_niveis;

-- 1. AS DUAS ESCOLHAS DO RUBEN (convidado B, bónus pago) — trocam-se aqui
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION elo_opcoes()
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT '{"convidado": "B", "bonus_mix": "pago"}'::jsonb;
$$;


-- ═════════════════════════════════════════════════════════════════════════
-- 2. A CONTA DE UM JOGO (não lê nem escreve nada)
-- ═════════════════════════════════════════════════════════════════════════
-- p_r:     níveis [A1, A2, B1, B2]; NULL = lugar sem conta (convidado).
-- p_jogos: jogos que já contaram para o nível de cada um.
-- p_s_a:   resultado da dupla A — 1 ganhou, 0 perdeu, 0,5 empate.
-- Devolve quanto cada lugar mexe (NULL nos lugares sem conta).
CREATE OR REPLACE FUNCTION elo_jogo_deltas(
  p_r NUMERIC[], p_jogos INTEGER[], p_s_a NUMERIC, p_convidado TEXT DEFAULT 'B')
RETURNS NUMERIC[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_out     NUMERIC[] := ARRAY[NULL, NULL, NULL, NULL]::NUMERIC[];
  v_k       NUMERIC[] := ARRAY[NULL, NULL, NULL, NULL]::NUMERIC[];
  v_p       NUMERIC[] := ARRAY[0, 0, 0, 0]::NUMERIC[];
  v_na      INTEGER := 0;
  v_nb      INTEGER := 0;
  v_ra      NUMERIC;
  v_rb      NUMERIC;
  v_ea      NUMERIC;
  v_m       NUMERIC;
  v_w       NUMERIC;
  v_s_t     NUMERIC;
  v_soma    NUMERIC;
  v_ganha   INTEGER[];
  v_perde   INTEGER[];
  v_perdido NUMERIC := 0;
  v_dado    NUMERIC := 0;
  v_ultimo  INTEGER;
  i INTEGER;
  a INTEGER;
  b INTEGER;
BEGIN
  FOR i IN 1..4 LOOP
    IF p_r[i] IS NOT NULL THEN
      IF i <= 2 THEN v_na := v_na + 1; ELSE v_nb := v_nb + 1; END IF;
      v_k[i] := CASE WHEN COALESCE(p_jogos[i], 0) < 8  THEN 40
                     WHEN p_jogos[i] < 20              THEN 30
                     ELSE 20 END;
      v_out[i] := 0;
    END IF;
  END LOOP;
  -- Um lado sem ninguém com conta, ou jogo sem resultado: não há o que medir.
  -- (Sem resultado, as contas com NULL davam perdas do nível inteiro: o
  -- LEAST e o GREATEST do Postgres ignoram NULL.)
  IF v_na = 0 OR v_nb = 0 OR p_s_a IS NULL OR p_s_a NOT BETWEEN 0 AND 1 THEN
    RETURN ARRAY[NULL, NULL, NULL, NULL]::NUMERIC[];
  END IF;

  -- 1. Expectativa: média do nível de cada dupla (só de quem tem conta).
  SELECT avg(x) INTO v_ra FROM unnest(p_r[1:2]) x;
  SELECT avg(x) INTO v_rb FROM unnest(p_r[3:4]) x;
  v_ea := 1 / (1 + power(10::NUMERIC, (v_rb - v_ra) / 400));

  -- 2. Um K por jogo; quanto a dupla A mexe.
  SELECT avg(x) INTO v_m FROM unnest(v_k) x;
  v_m := 2 * v_m * (p_s_a - v_ea);
  IF p_convidado = 'B' THEN
    v_m := v_m * LEAST(v_na, v_nb) / 2.0;   -- dupla com convidado = uma pessoa
  END IF;
  IF round(v_m, 2) = 0 THEN
    RETURN v_out;
  END IF;

  -- 3. Dentro de cada dupla: a fatia de cada um, pesada pelo seu K.
  FOR i IN 0..1 LOOP
    a := 2 * i + 1;
    b := 2 * i + 2;
    v_s_t := CASE WHEN i = 0 THEN p_s_a ELSE 1 - p_s_a END;
    IF p_r[a] IS NULL OR p_r[b] IS NULL THEN
      IF p_r[a] IS NOT NULL THEN v_p[a] := 1; END IF;
      IF p_r[b] IS NOT NULL THEN v_p[b] := 1; END IF;
    ELSE
      -- Na vitória, o mais fraco leva mais (35–65 %). Os dois no 0: metade.
      v_w := CASE WHEN v_s_t = 1 AND p_r[a] + p_r[b] > 0
                  THEN LEAST(0.65, GREATEST(0.35, p_r[b] / (p_r[a] + p_r[b])))
                  ELSE 0.5 END;
      v_p[a] := v_w * v_k[a];
      v_p[b] := (1 - v_w) * v_k[b];
      v_soma := v_p[a] + v_p[b];
      v_p[a] := v_p[a] / v_soma;
      v_p[b] := v_p[b] / v_soma;
    END IF;
  END LOOP;

  IF v_m > 0 THEN
    v_ganha := ARRAY[1, 2]; v_perde := ARRAY[3, 4];
  ELSE
    v_ganha := ARRAY[3, 4]; v_perde := ARRAY[1, 2];
  END IF;
  v_m := abs(v_m);

  -- 4. Quem perde, perde a sua fatia — mas nunca abaixo de 0.
  FOREACH i IN ARRAY v_perde LOOP
    IF p_r[i] IS NOT NULL THEN
      v_out[i] := - LEAST(round(v_m * v_p[i], 2), GREATEST(p_r[i], 0));
      v_perdido := v_perdido - v_out[i];
    END IF;
  END LOOP;

  -- Quem ganha, reparte o que se perdeu DE FACTO; o último leva o acerto
  -- dos cêntimos, para a soma dar 0,00.
  FOREACH i IN ARRAY v_ganha LOOP
    IF p_r[i] IS NOT NULL THEN
      v_out[i] := round(v_perdido * v_p[i], 2);
      v_dado := v_dado + v_out[i];
      v_ultimo := i;
    END IF;
  END LOOP;
  v_out[v_ultimo] := v_out[v_ultimo] + (v_perdido - v_dado);

  RETURN v_out;
END;
$$;


-- ═════════════════════════════════════════════════════════════════════════
-- 3. apply_elo_pairing — mesma assinatura, a conta passa a ser a de cima
-- ═════════════════════════════════════════════════════════════════════════
-- `p_partner_chosen` fica só para as chamadas antigas continuarem a
-- funcionar: servia para o escudo do parceiro novo, que acabou.
CREATE OR REPLACE FUNCTION apply_elo_pairing(
  p_a1 UUID, p_a2 UUID, p_b1 UUID, p_b2 UUID, p_s_a NUMERIC,
  p_partner_chosen BOOLEAN DEFAULT TRUE)
RETURNS TABLE(pid UUID, delta NUMERIC, s NUMERIC)
LANGUAGE plpgsql
SET search_path = ensaio_niveis
AS $$
-- Conta de soma zero (#440): ver elo_jogo_deltas.
DECLARE
  v_ids UUID[] := ARRAY[p_a1, p_a2, p_b1, p_b2];
  v_r   NUMERIC[] := ARRAY[NULL, NULL, NULL, NULL]::NUMERIC[];
  v_g   INTEGER[] := ARRAY[NULL, NULL, NULL, NULL]::INTEGER[];
  v_d   NUMERIC[];
  v_rat NUMERIC;
  v_jog INTEGER;
  i     INTEGER;
BEGIN
  FOR i IN 1..4 LOOP
    IF v_ids[i] IS NOT NULL THEN
      v_rat := NULL;
      v_jog := NULL;
      SELECT COALESCE(pr.rating, 900), COALESCE(pr.rating_games, 0)
        INTO v_rat, v_jog
        FROM profiles pr WHERE pr.id = v_ids[i];
      v_r[i] := v_rat;
      v_g[i] := v_jog;
    END IF;
  END LOOP;

  v_d := elo_jogo_deltas(v_r, v_g, p_s_a, COALESCE(elo_opcoes() ->> 'convidado', 'B'));

  FOR i IN 1..4 LOOP
    CONTINUE WHEN v_d[i] IS NULL;
    UPDATE profiles
       SET rating = GREATEST(0, COALESCE(rating, 900) + v_d[i]),
           rating_games = rating_games + 1
     WHERE id = v_ids[i];
    pid   := v_ids[i];
    delta := v_d[i];
    s     := CASE WHEN i <= 2 THEN p_s_a ELSE 1 - p_s_a END;
    RETURN NEXT;
  END LOOP;
END;
$$;


-- ═════════════════════════════════════════════════════════════════════════
-- 4. apply_mix_elo — os jogos como antes; o bónus pago por inteiro
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION apply_mix_elo(p_game_id UUID, p_winner_team_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = ensaio_niveis
AS $$
-- Conta de soma zero (#440).
DECLARE
  m RECORD;
  pl RECORD;
  v_s_a            NUMERIC;
  v_had_matches    BOOLEAN := FALSE;
  v_bonus          TEXT := COALESCE(elo_opcoes() ->> 'bonus_mix', 'pago');
  v_premio_total   NUMERIC;
  v_peso_total     NUMERIC;
  v_cobrado        NUMERIC;
  v_acerto         NUMERIC;
  v_a_rating_before NUMERIC;
  v_b_rating_before NUMERIC;
  v_e_a_before     NUMERIC;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _elo_night (
    pid UUID PRIMARY KEY,
    delta NUMERIC NOT NULL DEFAULT 0,
    played INTEGER NOT NULL DEFAULT 0,
    won INTEGER NOT NULL DEFAULT 0,
    bonus NUMERIC NOT NULL DEFAULT 0,
    taxa NUMERIC NOT NULL DEFAULT 0,
    rating_before NUMERIC,
    opp_r_sum NUMERIC NOT NULL DEFAULT 0,
    surprise_weight NUMERIC NOT NULL DEFAULT 0
  ) ON COMMIT DROP;
  TRUNCATE _elo_night;

  -- Nível de cada um ANTES deste mix: a régua do limite e da surpresa, para
  -- não se mexer à medida que as rondas vão correndo.
  INSERT INTO _elo_night (pid, rating_before)
  SELECT DISTINCT t.pid, COALESCE(pr.rating, 900)
    FROM (SELECT player1_id AS pid FROM teams WHERE game_id = p_game_id
          UNION
          SELECT player2_id FROM teams WHERE game_id = p_game_id) t
    JOIN profiles pr ON pr.id = t.pid
  ON CONFLICT (pid) DO NOTHING;

  -- ── Os jogos: cada um soma zero ───────────────────────────────────────
  FOR m IN
    SELECT mt.score_a, mt.score_b, mt.winner_team_id, mt.team_a_id,
           ta.player1_id AS a1, ta.player2_id AS a2,
           tb.player1_id AS b1, tb.player2_id AS b2
      FROM matches mt
      JOIN teams ta ON ta.id = mt.team_a_id
      JOIN teams tb ON tb.id = mt.team_b_id
     WHERE mt.game_id = p_game_id
       AND mt.winner_team_id IS NOT NULL
     ORDER BY mt.round_number NULLS LAST, mt.created_at, mt.id
  LOOP
    v_had_matches := TRUE;
    v_s_a := CASE WHEN m.score_a IS NOT NULL AND m.score_a = m.score_b THEN 0.5
                  WHEN m.winner_team_id = m.team_a_id THEN 1
                  ELSE 0 END;

    SELECT AVG(rating_before) INTO v_a_rating_before FROM _elo_night WHERE pid IN (m.a1, m.a2);
    SELECT AVG(rating_before) INTO v_b_rating_before FROM _elo_night WHERE pid IN (m.b1, m.b2);

    FOR pl IN SELECT * FROM apply_elo_pairing(m.a1, m.a2, m.b1, m.b2, v_s_a, p_partner_chosen => FALSE) LOOP
      INSERT INTO _elo_night (pid, delta, played, won, opp_r_sum)
      VALUES (pl.pid, pl.delta, 1, CASE WHEN pl.s = 1 THEN 1 ELSE 0 END,
              CASE WHEN pl.pid IN (m.a1, m.a2) THEN v_b_rating_before ELSE v_a_rating_before END)
      ON CONFLICT (pid) DO UPDATE
      SET delta     = _elo_night.delta + EXCLUDED.delta,
          played    = _elo_night.played + 1,
          won       = _elo_night.won + EXCLUDED.won,
          opp_r_sum = _elo_night.opp_r_sum + EXCLUDED.opp_r_sum;
    END LOOP;
  END LOOP;

  -- ── O bónus do vencedor, pago por inteiro ─────────────────────────────
  IF v_had_matches AND p_winner_team_id IS NOT NULL AND v_bonus = 'pago' THEN
    -- Prémio como hoje: +1 % do próprio nível para a dupla vencedora do mix,
    -- +0,5 % a quem ganhou todos os jogos.
    UPDATE _elo_night n
       SET bonus = round(
             (CASE WHEN n.pid IN (SELECT unnest(ARRAY[player1_id, player2_id])
                                    FROM teams WHERE id = p_winner_team_id)
                   THEN 0.01 ELSE 0 END
            + CASE WHEN n.played > 0 AND n.won = n.played THEN 0.005 ELSE 0 END)
           * COALESCE((SELECT pr.rating FROM profiles pr WHERE pr.id = n.pid), 900), 2)
     WHERE TRUE;

    -- Limite para quem ganhou por ter adversários muito mais fracos: agora só
    -- corta o prémio (até 0), nunca os pontos dos jogos.
    UPDATE _elo_night n
       SET bonus = GREATEST(0, LEAST(n.bonus,
             (CASE WHEN g.gap >= 300 THEN 5 ELSE 15 END) - n.delta))
      FROM (SELECT pid, (rating_before - opp_r_sum / NULLIF(played, 0)) AS gap
              FROM _elo_night WHERE played > 0) g
     WHERE g.pid = n.pid AND g.gap >= 150 AND n.bonus > 0;

    -- Quem paga: quem perdeu contra um premiado, pesado pela surpresa dessa
    -- derrota (uma derrota esperada pesa quase nada).
    FOR m IN
      SELECT mt.winner_team_id, mt.team_a_id,
             ta.player1_id AS a1, ta.player2_id AS a2,
             tb.player1_id AS b1, tb.player2_id AS b2
        FROM matches mt
        JOIN teams ta ON ta.id = mt.team_a_id
        JOIN teams tb ON tb.id = mt.team_b_id
       WHERE mt.game_id = p_game_id AND mt.winner_team_id IS NOT NULL
    LOOP
      CONTINUE WHEN NOT EXISTS (
        SELECT 1 FROM _elo_night n
         WHERE n.bonus > 0
           AND n.pid = ANY (CASE WHEN m.winner_team_id = m.team_a_id
                                 THEN ARRAY[m.a1, m.a2] ELSE ARRAY[m.b1, m.b2] END));
      SELECT AVG(rating_before) INTO v_a_rating_before FROM _elo_night WHERE pid IN (m.a1, m.a2);
      SELECT AVG(rating_before) INTO v_b_rating_before FROM _elo_night WHERE pid IN (m.b1, m.b2);
      v_e_a_before := 1 / (1 + power(10::NUMERIC, (v_b_rating_before - v_a_rating_before) / 400));
      IF m.winner_team_id = m.team_a_id THEN
        UPDATE _elo_night SET surprise_weight = surprise_weight + (1 - v_e_a_before)
         WHERE pid IN (m.b1, m.b2);
      ELSE
        UPDATE _elo_night SET surprise_weight = surprise_weight + v_e_a_before
         WHERE pid IN (m.a1, m.a2);
      END IF;
    END LOOP;

    SELECT COALESCE(sum(bonus), 0) INTO v_premio_total FROM _elo_night WHERE bonus > 0;
    SELECT COALESCE(sum(surprise_weight * rating_before), 0) INTO v_peso_total
      FROM _elo_night WHERE bonus = 0 AND surprise_weight > 0;

    IF v_premio_total > 0 AND v_peso_total > 0 THEN
      -- Cada pagador paga a sua parte do prémio TODO (antes pagava-se só uma
      -- parte). Nunca abaixo de 0.
      UPDATE _elo_night n
         SET taxa = LEAST(round(v_premio_total * n.surprise_weight * n.rating_before / v_peso_total, 2),
                          GREATEST(COALESCE(pr.rating, 900), 0))
        FROM profiles pr
       WHERE pr.id = n.pid AND n.bonus = 0 AND n.surprise_weight > 0;
      SELECT COALESCE(sum(taxa), 0) INTO v_cobrado FROM _elo_night;

      -- O prémio é o que se cobrou: se alguém estava no 0, ou pelos cêntimos,
      -- os premiados recebem na proporção, e o maior leva o acerto.
      IF v_cobrado <> v_premio_total THEN
        UPDATE _elo_night SET bonus = round(bonus * v_cobrado / v_premio_total, 2) WHERE bonus > 0;
        SELECT v_cobrado - COALESCE(sum(bonus), 0) INTO v_acerto FROM _elo_night WHERE bonus > 0;
        UPDATE _elo_night SET bonus = bonus + v_acerto
         WHERE pid = (SELECT pid FROM _elo_night WHERE bonus > 0 ORDER BY bonus DESC, pid LIMIT 1);
      END IF;
    ELSE
      -- Ninguém para pagar: não há prémio.
      UPDATE _elo_night SET bonus = 0 WHERE bonus <> 0;
    END IF;

    UPDATE _elo_night SET delta = delta + bonus - taxa WHERE bonus <> 0 OR taxa <> 0;
    UPDATE profiles pr
       SET rating = GREATEST(0, COALESCE(pr.rating, 900) + n.bonus - n.taxa)
      FROM _elo_night n
     WHERE pr.id = n.pid AND (n.bonus <> 0 OR n.taxa <> 0);
  END IF;

  UPDATE mix_player_stats mps
     SET rating_delta = round(n.delta, 2),
         rating_after = round(COALESCE(pr.rating, 900), 2)
    FROM _elo_night n
    JOIN profiles pr ON pr.id = n.pid
   WHERE mps.game_id = p_game_id AND mps.user_id = n.pid AND n.played > 0;
END;
$$;


-- ═════════════════════════════════════════════════════════════════════════
-- 5. apply_tournament_elo — deixa de ter uma cópia própria das contas
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION apply_tournament_elo(p_category_id UUID, p_champion_entry_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = ensaio_niveis
AS $$
-- Conta de soma zero (#440): cada jogo passa por apply_elo_pairing.
DECLARE
  m RECORD;
  pl RECORD;
  v_s_a          NUMERIC;
  v_had_matches  BOOLEAN := FALSE;
  v_premio_total NUMERIC;
  v_peso_total   NUMERIC;
  v_cobrado      NUMERIC;
  v_acerto       NUMERIC;
  v_campeoes     UUID[];
  v_a            UUID[];
  v_b            UUID[];
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _elo_torneio (
    pid UUID PRIMARY KEY,
    delta NUMERIC NOT NULL DEFAULT 0,
    played INTEGER NOT NULL DEFAULT 0,
    won INTEGER NOT NULL DEFAULT 0,
    bonus NUMERIC NOT NULL DEFAULT 0,
    taxa NUMERIC NOT NULL DEFAULT 0
  ) ON COMMIT DROP;
  TRUNCATE _elo_torneio;

  FOR m IN
    SELECT mt.id, mt.score_a, mt.score_b, mt.winner_entry_id, mt.entry_a_id,
           -- Quem esteve em campo naquele jogo; sem isso, a inscrição.
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
    v_had_matches := TRUE;
    v_a := COALESCE(m.lado_a, array_remove(ARRAY[m.ea1, m.ea2], NULL));
    v_b := COALESCE(m.lado_b, array_remove(ARRAY[m.eb1, m.eb2], NULL));
    v_s_a := CASE WHEN m.score_a IS NOT NULL AND m.score_a = m.score_b THEN 0.5
                  WHEN m.winner_entry_id = m.entry_a_id THEN 1
                  ELSE 0 END;

    FOR pl IN SELECT * FROM apply_elo_pairing(v_a[1], v_a[2], v_b[1], v_b[2], v_s_a, p_partner_chosen => FALSE) LOOP
      INSERT INTO _elo_torneio (pid, delta, played, won)
      VALUES (pl.pid, pl.delta, 1, CASE WHEN pl.s = 1 THEN 1 ELSE 0 END)
      ON CONFLICT (pid) DO UPDATE
      SET delta  = _elo_torneio.delta + EXCLUDED.delta,
          played = _elo_torneio.played + 1,
          won    = _elo_torneio.won + EXCLUDED.won;
    END LOOP;
  END LOOP;

  IF v_had_matches AND p_champion_entry_id IS NOT NULL THEN
    -- O bónus de campeão vai para quem JOGOU A FINAL; sem final, para a
    -- inscrição campeã.
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
       SET bonus = round(
             (CASE WHEN n.pid = ANY (v_campeoes) THEN 0.01 ELSE 0 END
            + CASE WHEN n.played > 0 AND n.won = n.played THEN 0.005 ELSE 0 END)
           * COALESCE((SELECT pr.rating FROM profiles pr WHERE pr.id = n.pid), 900), 2)
     WHERE TRUE;

    -- Pagam todos os outros da categoria, na proporção do nível (como
    -- antes), mas nunca abaixo de 0; o prémio é o que se cobrou.
    SELECT COALESCE(sum(bonus), 0) INTO v_premio_total FROM _elo_torneio WHERE bonus > 0;
    SELECT COALESCE(sum(COALESCE(pr.rating, 900)), 0) INTO v_peso_total
      FROM _elo_torneio n JOIN profiles pr ON pr.id = n.pid
     WHERE n.bonus = 0;

    IF v_premio_total > 0 AND v_peso_total > 0 THEN
      UPDATE _elo_torneio n
         SET taxa = LEAST(round(v_premio_total * COALESCE(pr.rating, 900) / v_peso_total, 2),
                          GREATEST(COALESCE(pr.rating, 900), 0))
        FROM profiles pr
       WHERE pr.id = n.pid AND n.bonus = 0;
      SELECT COALESCE(sum(taxa), 0) INTO v_cobrado FROM _elo_torneio;
      IF v_cobrado <> v_premio_total THEN
        UPDATE _elo_torneio SET bonus = round(bonus * v_cobrado / v_premio_total, 2) WHERE bonus > 0;
        SELECT v_cobrado - COALESCE(sum(bonus), 0) INTO v_acerto FROM _elo_torneio WHERE bonus > 0;
        UPDATE _elo_torneio SET bonus = bonus + v_acerto
         WHERE pid = (SELECT pid FROM _elo_torneio WHERE bonus > 0 ORDER BY bonus DESC, pid LIMIT 1);
      END IF;
    ELSE
      UPDATE _elo_torneio SET bonus = 0 WHERE bonus <> 0;
    END IF;

    UPDATE _elo_torneio SET delta = delta + bonus - taxa WHERE bonus <> 0 OR taxa <> 0;
    UPDATE profiles pr
       SET rating = GREATEST(0, COALESCE(pr.rating, 900) + n.bonus - n.taxa)
      FROM _elo_torneio n
     WHERE pr.id = n.pid AND (n.bonus <> 0 OR n.taxa <> 0);
  END IF;

  INSERT INTO tournament_player_stats (category_id, user_id, entry_id, matches_played, matches_won, rating_delta, rating_after)
  SELECT p_category_id, n.pid,
         (SELECT p.entry_id FROM tournament_match_players p
            JOIN tournament_matches mm ON mm.id = p.match_id
           WHERE mm.category_id = p_category_id AND p.user_id = n.pid LIMIT 1),
         n.played, n.won, round(n.delta, 2), round(COALESCE(pr.rating, 900), 2)
    FROM _elo_torneio n JOIN profiles pr ON pr.id = n.pid
  ON CONFLICT (category_id, user_id) DO UPDATE
  SET matches_played = EXCLUDED.matches_played,
      matches_won    = EXCLUDED.matches_won,
      rating_delta   = EXCLUDED.rating_delta,
      rating_after   = EXCLUDED.rating_after;
END;
$$;



CREATE OR REPLACE FUNCTION recalcular_niveis(p_gravar BOOLEAN DEFAULT FALSE)
RETURNS TABLE(tipo TEXT, quando TIMESTAMPTZ, quem TEXT, id UUID,
              antes NUMERIC, depois NUMERIC, diferenca NUMERIC,
              jogos_antes INTEGER, jogos_depois INTEGER, nota TEXT)
LANGUAGE plpgsql
SET search_path = ensaio_niveis
AS $$
-- As colunas da lista (id, tipo, quando…) têm nomes iguais a colunas das
-- tabelas; dentro das consultas, ganha sempre a coluna da tabela.
#variable_conflict use_column
DECLARE
  c_ensaio   CONSTANT TEXT := 'recalcular_niveis: só ver — tudo desfeito';
  v_linhas   JSONB := '[]'::jsonb;
  v_antes    JSONB;
  e          RECORD;
  v_soma0    NUMERIC;
  v_soma1    NUMERIC;
  v_n        INTEGER := 0;
  pl         RECORD;
  v_deltas   JSONB;
BEGIN
  IF p_gravar AND current_date BETWEEN DATE '2026-10-08' AND DATE '2026-10-12' THEN
    RAISE EXCEPTION 'Não se recalculam níveis entre 8 e 12 out (Smash Cup).';
  END IF;
  IF to_regprocedure('elo_jogo_deltas(numeric[], integer[], numeric, text)') IS NULL THEN
    RAISE EXCEPTION 'Falta a conta nova: correr primeiro migration_ranking_soma_zero.sql.';
  END IF;

  BEGIN
    IF p_gravar THEN
      -- Ninguém fecha um mix nem confirma um jogo a meio disto.
      LOCK TABLE profiles IN SHARE ROW EXCLUSIVE MODE;
    END IF;

    -- ── Como está hoje ────────────────────────────────────────────────────
    SELECT jsonb_object_agg(p.id::text, jsonb_build_object(
             'r', p.rating, 'g', p.rating_games, 'nome', p.name,
             'ancora', p.rating_anchor))
      INTO v_antes
      FROM profiles p
     WHERE p.rating IS NOT NULL OR COALESCE(p.rating_games, 0) > 0;

    -- ── 1. Todos voltam ao início ──────────────────────────────────────
    UPDATE profiles
       SET rating = COALESCE(rating_anchor, 900),
           rating_games = 0
     WHERE rating IS NOT NULL OR COALESCE(rating_games, 0) > 0;

    -- ── 2. Tudo o que contou, por ordem de data ─────────────────────────
    FOR e IN
      SELECT * FROM (
        -- Mixes: os que tiveram o nível aplicado.
        SELECT 'mix'::text AS tipo, g.date AS quando, g.id AS ref, NULL::uuid AS ref2,
               COALESCE(g.title, '') AS nome
          FROM games g
         WHERE EXISTS (SELECT 1 FROM mix_player_stats s
                        WHERE s.game_id = g.id AND s.rating_delta IS NOT NULL)
        UNION ALL
        -- Jogos entre amigos que contaram (os que têm o registo do nível).
        SELECT 'amigos', COALESCE(pm.played_at, pm.confirmed_at, pm.created_at), pm.id, NULL, ''
          FROM private_matches pm
         WHERE EXISTS (SELECT 1 FROM private_match_stats s
                        WHERE s.private_match_id = pm.id
                          AND (to_jsonb(s) ->> 'rating_delta') IS NOT NULL)
        UNION ALL
        -- Jogos dentro do grupo que contaram.
        SELECT 'grupo',
               COALESCE((to_jsonb(gm) ->> 'played_at')::timestamptz,
                        (to_jsonb(gm) ->> 'locked_at')::timestamptz,
                        (to_jsonb(gm) ->> 'created_at')::timestamptz),
               gm.id, NULL, ''
          FROM group_matches gm
         WHERE (to_jsonb(gm) ->> 'ranked_applied')::boolean
        UNION ALL
        -- Torneios: cada categoria fechada com o nível aplicado.
        SELECT 'torneio',
               COALESCE((SELECT max(tm.scheduled_at) FROM tournament_matches tm
                          WHERE tm.category_id = c.id),
                        c.day_date::timestamptz),
               c.id, c.champion_entry_id, c.name
          FROM tournament_categories c
         WHERE EXISTS (SELECT 1 FROM tournament_player_stats s
                        WHERE s.category_id = c.id AND s.rating_delta IS NOT NULL)
      ) x
      ORDER BY quando NULLS LAST, tipo, ref
    LOOP
      -- Soma de TODOS (sem nível conta 900, como nas contas): quem joga pela
      -- primeira vez passa de 900 a 900 ± o jogo, e a soma continua certa.
      SELECT COALESCE(sum(COALESCE(rating, 900)), 0) INTO v_soma0 FROM profiles;

      IF e.tipo = 'mix' THEN
        PERFORM apply_mix_elo(e.ref, (SELECT winner_team_id FROM games WHERE id = e.ref));

      ELSIF e.tipo = 'amigos' THEN
        FOR pl IN
          SELECT r.* FROM private_matches pm,
                 LATERAL apply_elo_pairing(pm.team_a_player1_id, pm.team_a_player2_id,
                                           pm.team_b_player1_id, pm.team_b_player2_id,
                                           CASE WHEN pm.winner_team = 'a' THEN 1 ELSE 0 END) r
           WHERE pm.id = e.ref
        LOOP
          UPDATE private_match_stats
             SET rating_delta = round(pl.delta, 2),
                 rating_after = round((SELECT COALESCE(pr.rating, 900) FROM profiles pr WHERE pr.id = pl.pid), 2)
           WHERE private_match_id = e.ref AND user_id = pl.pid;
        END LOOP;

      ELSIF e.tipo = 'grupo' THEN
        v_deltas := '{}'::jsonb;
        FOR pl IN
          SELECT r.* FROM group_matches gm,
                 LATERAL apply_elo_pairing(gm.team_a_player1_id, gm.team_a_player2_id,
                                           gm.team_b_player1_id, gm.team_b_player2_id,
                                           CASE WHEN gm.applied_winner_team = 'a' THEN 1 ELSE 0 END) r
           WHERE gm.id = e.ref
        LOOP
          v_deltas := v_deltas || jsonb_build_object(pl.pid::text, pl.delta);
        END LOOP;
        -- O que se guarda é o que se desfaz se o resultado for corrigido.
        UPDATE group_matches SET applied_elo_deltas = v_deltas WHERE id = e.ref;

      ELSE
        PERFORM apply_tournament_elo(e.ref, e.ref2);
      END IF;

      SELECT COALESCE(sum(COALESCE(rating, 900)), 0) INTO v_soma1 FROM profiles;
      IF v_soma1 <> v_soma0 THEN
        RAISE EXCEPTION 'A soma dos níveis mudou % no % de % (%). Nada foi gravado.',
          v_soma1 - v_soma0, e.tipo, e.quando, e.ref;
      END IF;

      v_n := v_n + 1;
      v_linhas := v_linhas || jsonb_build_object(
        'tipo', e.tipo, 'quando', e.quando, 'quem', e.nome, 'id', e.ref,
        'antes', v_soma0, 'depois', v_soma1, 'diferenca', v_soma1 - v_soma0);
    END LOOP;

    -- ── 3. Pessoa a pessoa: antes e depois ──────────────────────────────
    v_linhas := v_linhas || COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'tipo', 'pessoa', 'quem', a.value ->> 'nome', 'id', p.id,
               'antes', (a.value ->> 'r')::numeric, 'depois', p.rating,
               'diferenca', p.rating - (a.value ->> 'r')::numeric,
               'jogos_antes', (a.value ->> 'g')::int, 'jogos_depois', p.rating_games,
               'nota', CASE
                 WHEN p.rating_games > (a.value ->> 'g')::int
                   THEN 'mais jogos agora: havia jogos a contar que não somavam no número'
                 WHEN p.rating_games < (a.value ->> 'g')::int
                   THEN 'menos jogos agora: tinha jogos contados que já não se encontram (acerto à mão ou jogo apagado)'
                 END))
        FROM jsonb_each(v_antes) a
        JOIN profiles p ON p.id = a.key::uuid), '[]'::jsonb);

    IF NOT p_gravar THEN
      RAISE EXCEPTION USING MESSAGE = c_ensaio;
    END IF;
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> c_ensaio THEN
        RAISE;
      END IF;
      -- Só ver: tudo o que se mexeu acima foi desfeito; a lista ficou.
  END;

  RETURN QUERY
  SELECT l ->> 'tipo', (l ->> 'quando')::timestamptz, l ->> 'quem', (l ->> 'id')::uuid,
         round((l ->> 'antes')::numeric, 2), round((l ->> 'depois')::numeric, 2),
         round((l ->> 'diferenca')::numeric, 2),
         (l ->> 'jogos_antes')::int, (l ->> 'jogos_depois')::int, l ->> 'nota'
    FROM jsonb_array_elements(v_linhas) l
   ORDER BY (l ->> 'tipo') = 'pessoa', (l ->> 'quando')::timestamptz,
            abs((l ->> 'diferenca')::numeric) DESC;
END;
$$;

RESET search_path;

-- ─────────────────────────────────────────────────────────────────────────
-- Como voltar a gerar: cabeçalho até ao primeiro SET search_path + partes
-- 1–5 de migration_ranking_soma_zero.sql + recalcular_niveis(), com
-- `SET search_path = public` trocado por `SET search_path = ensaio_niveis`.
-- ─────────────────────────────────────────────────────────────────────────
