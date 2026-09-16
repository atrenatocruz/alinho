-- ════════════════════════════════════════════════════════════════════════
-- Elo — cap de dominância + financiamento do bónus por derrota inesperada
-- (revisão de 2026-09-15; correr DEPOIS de migration_elo_partner_shield.sql)
--
-- Caso que motivou: mix onde o jogador mais forte (M4 contra um campo de
-- M6) ficou com o maior ganho de pontos do mix, e quem perdeu contra ele
-- (claramente mais fraco, uma derrota esperada e barata no Elo core) pagou
-- a fatia maior do imposto que financia o bónus do vencedor — só porque
-- tinha o rating mais alto entre quem não foi 100% vitórias, não por ter
-- perdido de forma surpreendente contra alguém.
--
-- Duas mudanças, ambas dentro de apply_mix_elo (o Elo por-jogo em
-- apply_elo_pairing NÃO MUDA — já desconta corretamente pela força do
-- adversário via E_a; só o bónus fixo por cima é que não descontava):
--
--   A. CAP no ganho total do mix (Elo + bónus somados), só do lado de quem
--      tem, em média, adversários muito mais fracos nesse mix — nunca do
--      lado de quem está a perder ou a dar a reviravolta:
--        diferença média para os adversários < 150  -> sem teto
--        150-300                                    -> teto de 15 pontos
--        >= 300                                      -> teto de 5 pontos
--      "diferença média" usa o rating de CADA jogador (o próprio E os
--      adversários) no INÍCIO do mix (antes de qualquer delta desse mix),
--      não o que vai mudando ronda a ronda -- por isso apply_mix_elo tira
--      um snapshot logo à entrada (rating_before) e usa-o dos dois lados;
--      a média de adversários é calculada dentro do próprio loop de jogos,
--      a partir desse snapshot, não a partir de nada devolvido por
--      apply_elo_pairing (que continua a usar rating AO VIVO para o Elo em
--      si — correto para o Elo, errado se fosse usado para o cap). O cap
--      corre ANTES do financiamento (ver B) para que este financie o
--      bónus já cortado, não o bruto.
--
--   B. Financiamento do bónus deixa de ser proporcional ao rating do
--      pagador, e deixa de normalizar para financiar sempre 100% do
--      bónus. Passa a ser uma taxa ABSOLUTA por pagador, na mesma escala
--      do próprio prémio (1% do rating, pesado pelo E que o perdedor já
--      tinha nesse jogo específico, com os ratings de início de mix) —
--      só escalada para BAIXO (nunca para cima) se a soma ultrapassar o
--      que é preciso financiar. Perder contra alguém claramente mais
--      forte (E baixo) financia ~0 em absoluto, seja qual for o tamanho
--      do grupo de pagadores — não só relativamente aos outros pagadores,
--      que era o problema da normalização antiga. Se ninguém perdeu de
--      forma surpreendente contra os premiados, ou a soma ficar abaixo do
--      necessário, o que sobra fica por financiar -- aceite, o cap A já
--      limita o cenário de campo muito mais fraco a valores pequenos.
--
-- apply_elo_pairing não precisa de mudar nada para isto: fica exatamente
-- como em migration_elo_partner_shield.sql, sem DROP/CREATE, sem risco
-- para confirm_private_match nem para migration_elo_backfill_v2.sql.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION apply_mix_elo(p_game_id UUID, p_winner_team_id UUID)
RETURNS void AS $$
DECLARE
  m RECORD;
  pl RECORD;
  v_s_a NUMERIC;
  v_had_matches BOOLEAN := FALSE;
  v_bonus_total NUMERIC;
  v_raw_tax_total NUMERIC;
  v_a_rating_before NUMERIC;
  v_b_rating_before NUMERIC;
  v_e_a_before NUMERIC;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _elo_night (
    pid UUID PRIMARY KEY,
    delta NUMERIC NOT NULL DEFAULT 0,
    played INTEGER NOT NULL DEFAULT 0,
    won INTEGER NOT NULL DEFAULT 0,
    bonus NUMERIC NOT NULL DEFAULT 0,
    rating_before NUMERIC,
    opp_r_sum NUMERIC NOT NULL DEFAULT 0,
    surprise_weight NUMERIC NOT NULL DEFAULT 0
  ) ON COMMIT DROP;
  TRUNCATE _elo_night;

  -- Snapshot do rating de cada jogador ANTES de qualquer delta deste mix —
  -- a régua usada pelo cap (gap contra a média dos adversários) e pelo
  -- financiamento (E de cada derrota), para não se mexerem sozinhos à
  -- medida que as rondas do próprio mix vão correndo.
  INSERT INTO _elo_night (pid, rating_before)
  SELECT DISTINCT pid, COALESCE(pr.rating, 900)
  FROM (
    SELECT player1_id AS pid FROM teams WHERE game_id = p_game_id
    UNION
    SELECT player2_id FROM teams WHERE game_id = p_game_id
  ) t
  JOIN profiles pr ON pr.id = t.pid
  ON CONFLICT (pid) DO NOTHING;

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

    v_s_a := CASE
      WHEN m.score_a IS NOT NULL AND m.score_a = m.score_b THEN 0.5
      WHEN m.winner_team_id = m.team_a_id THEN 1
      ELSE 0
    END;

    -- Ratings de início de mix das duas duplas deste jogo — a régua do cap
    -- (média de adversários), não o rating ao vivo que apply_elo_pairing já
    -- vai ter mexido para outros jogadores nesta mesma ronda.
    SELECT AVG(rating_before) INTO v_a_rating_before FROM _elo_night WHERE pid IN (m.a1, m.a2);
    SELECT AVG(rating_before) INTO v_b_rating_before FROM _elo_night WHERE pid IN (m.b1, m.b2);

    FOR pl IN
      SELECT * FROM apply_elo_pairing(m.a1, m.a2, m.b1, m.b2, v_s_a, p_partner_chosen => FALSE)
    LOOP
      INSERT INTO _elo_night (pid, delta, played, won, opp_r_sum)
      VALUES (pl.pid, pl.delta, 1, CASE WHEN pl.s = 1 THEN 1 ELSE 0 END,
              CASE WHEN pl.pid IN (m.a1, m.a2) THEN v_b_rating_before ELSE v_a_rating_before END)
      ON CONFLICT (pid) DO UPDATE
      SET delta = _elo_night.delta + EXCLUDED.delta,
          played = _elo_night.played + 1,
          won = _elo_night.won + EXCLUDED.won,
          opp_r_sum = _elo_night.opp_r_sum + EXCLUDED.opp_r_sum;
    END LOOP;
  END LOOP;

  IF v_had_matches THEN
    IF p_winner_team_id IS NOT NULL THEN
      -- Recompensa (inalterada): +1% do próprio rating por estar na equipa
      -- vencedora do mix, +0,5% extra por 100% de vitórias.
      UPDATE _elo_night n
      SET bonus = (CASE WHEN n.pid IN (SELECT unnest(ARRAY[player1_id, player2_id])
                                       FROM teams WHERE id = p_winner_team_id)
                        THEN 0.01 ELSE 0 END
                 + CASE WHEN n.played > 0 AND n.won = n.played THEN 0.005 ELSE 0 END)
                * COALESCE((SELECT pr.rating FROM profiles pr WHERE pr.id = n.pid), 900)
      WHERE TRUE;
    END IF;

    -- Cap de dominância — corre ANTES do financiamento: só do lado de
    -- quem ganhou por ter, em média, adversários muito mais fracos nesse
    -- mix — nunca no lado do azarão nem de quem está a perder. Correndo
    -- aqui primeiro, o financiamento a seguir paga o bónus já cortado,
    -- não o bruto.
    UPDATE _elo_night n
    SET bonus = bonus + LEAST(0,
          (CASE WHEN g.gap >= 300 THEN 5 WHEN g.gap >= 150 THEN 15 END) - (n.delta + n.bonus))
    FROM (
      SELECT pid, (rating_before - opp_r_sum / NULLIF(played, 0)) AS gap
      FROM _elo_night WHERE played > 0
    ) g
    WHERE g.pid = n.pid
      AND g.gap >= 150
      AND (n.delta + n.bonus) > 0;

    IF p_winner_team_id IS NOT NULL THEN
      -- Financiamento: paga quem perdeu ESPECIFICAMENTE contra um premiado,
      -- pesado pelo E que já tinha nesse jogo (ratings de início de mix) —
      -- não mais "quem tem mais rating no grupo".
      FOR m IN
        SELECT mt.winner_team_id, mt.team_a_id, mt.team_b_id,
               ta.player1_id AS a1, ta.player2_id AS a2,
               tb.player1_id AS b1, tb.player2_id AS b2
        FROM matches mt
        JOIN teams ta ON ta.id = mt.team_a_id
        JOIN teams tb ON tb.id = mt.team_b_id
        WHERE mt.game_id = p_game_id AND mt.winner_team_id IS NOT NULL
      LOOP
        IF NOT EXISTS (
          SELECT 1 FROM _elo_night n
          WHERE n.bonus > 0
            AND n.pid = ANY(CASE WHEN m.winner_team_id = m.team_a_id
                                  THEN ARRAY[m.a1, m.a2] ELSE ARRAY[m.b1, m.b2] END)
        ) THEN
          CONTINUE;
        END IF;

        SELECT AVG(rating_before) INTO v_a_rating_before FROM _elo_night WHERE pid IN (m.a1, m.a2);
        SELECT AVG(rating_before) INTO v_b_rating_before FROM _elo_night WHERE pid IN (m.b1, m.b2);
        v_e_a_before := 1 / (1 + power(10::numeric, (v_b_rating_before - v_a_rating_before) / 400));

        IF m.winner_team_id = m.team_a_id THEN
          UPDATE _elo_night SET surprise_weight = surprise_weight + (1 - v_e_a_before)
          WHERE pid IN (m.b1, m.b2);
        ELSE
          UPDATE _elo_night SET surprise_weight = surprise_weight + v_e_a_before
          WHERE pid IN (m.a1, m.a2);
        END IF;
      END LOOP;

      -- v_bonus_total já reflete o cap (correu antes). A taxa de cada
      -- pagador é absoluta (mesma escala do prémio, 1% do próprio rating,
      -- pesada pelo E) e só é escalada para BAIXO se a soma ultrapassar o
      -- que é preciso financiar — nunca para cima. Uma derrota totalmente
      -- esperada (surprise_weight ≈ 0) paga ~0 em absoluto, seja qual for
      -- o tamanho do grupo de pagadores.
      SELECT COALESCE(SUM(bonus), 0) INTO v_bonus_total FROM _elo_night WHERE bonus > 0;
      SELECT COALESCE(SUM(surprise_weight * 0.01 * rating_before), 0) INTO v_raw_tax_total
      FROM _elo_night WHERE bonus = 0 AND surprise_weight > 0;

      IF v_bonus_total > 0 AND v_raw_tax_total > 0 THEN
        UPDATE _elo_night
        SET bonus = - (surprise_weight * 0.01 * rating_before) * LEAST(1, v_bonus_total / v_raw_tax_total)
        WHERE bonus = 0 AND surprise_weight > 0;
      END IF;
      -- Se v_raw_tax_total = 0 (ninguém perdeu de forma surpreendente
      -- contra os premiados) ou ficar abaixo de v_bonus_total, o que sobra
      -- fica por financiar — aceite, ver cabeçalho.
    END IF;

    UPDATE _elo_night SET delta = delta + bonus WHERE bonus <> 0;

    UPDATE profiles pr
    SET rating = GREATEST(0, COALESCE(pr.rating, 900) + n.bonus)
    FROM _elo_night n
    WHERE pr.id = n.pid AND n.bonus <> 0;
  END IF;

  UPDATE mix_player_stats mps
  SET rating_delta = ROUND(n.delta, 2),
      rating_after = ROUND(COALESCE(pr.rating, 900), 2)
  FROM _elo_night n
  JOIN profiles pr ON pr.id = n.pid
  WHERE mps.game_id = p_game_id AND mps.user_id = n.pid AND n.played > 0;
END;
$$ LANGUAGE plpgsql SET search_path = public;

REVOKE ALL ON FUNCTION apply_mix_elo(UUID, UUID) FROM public, anon, authenticated;
