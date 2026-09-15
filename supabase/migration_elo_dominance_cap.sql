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
-- apply_elo_pairing não muda — já desconta corretamente pela força do
-- adversário via E_a; só o bónus fixo por cima é que não descontava):
--
--   A. CAP no ganho total do mix (Elo + bónus somados), só do lado de quem
--      tem, em média, adversários muito mais fracos nesse mix — nunca do
--      lado de quem está a perder ou a dar a reviravolta:
--        diferença média para os adversários < 150  -> sem teto
--        150-300                                    -> teto de 15 pontos
--        >= 300                                      -> teto de 5 pontos
--      "diferença média" usa o rating de CADA jogador no INÍCIO do mix
--      (antes de qualquer delta desse mix), não o que vai mudando ronda a
--      ronda -- para isso, apply_mix_elo tira agora um snapshot logo à
--      entrada.
--
--   B. Financiamento do bónus deixa de ser proporcional ao rating do
--      pagador. Passa a ser proporcional a quão inesperada foi a derrota
--      ESPECIFICAMENTE contra os premiados: usa o E que o perdedor já
--      tinha nesse jogo (com os ratings de início de mix, a mesma régua
--      do cap). Perder contra alguém claramente mais forte financia ~0;
--      perder contra alguém a um nível parecido financia mais. Se ninguém
--      perdeu de forma surpreendente contra os premiados, o bónus fica por
--      financiar -- o cap A já limita esse cenário a valores pequenos.
--
-- apply_elo_pairing precisa de devolver também a força média da equipa
-- adversária de cada jogador (opp_r), para apply_mix_elo poder calcular a
-- média de adversários do cap sem reconsultar profiles jogo a jogo. Muda
-- a forma da tabela devolvida -> DROP primeiro (mesmo padrão já usado em
-- migration_elo_partner_shield.sql); colunas extra são inofensivas para
-- confirm_private_match e para o backfill, que só leem campos por nome.
-- ════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS apply_elo_pairing(UUID, UUID, UUID, UUID, NUMERIC, BOOLEAN);

CREATE OR REPLACE FUNCTION apply_elo_pairing(
  p_a1 UUID, p_a2 UUID, p_b1 UUID, p_b2 UUID, p_s_a NUMERIC,
  p_partner_chosen BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (pid UUID, delta NUMERIC, s NUMERIC, opp_r NUMERIC) AS $$
DECLARE
  pl RECORD;
  v_r_a NUMERIC;
  v_r_b NUMERIC;
  v_e_a NUMERIC;
  v_w NUMERIC;
  v_share NUMERIC;
  v_k INTEGER;
  v_delta NUMERIC;
BEGIN
  SELECT AVG(COALESCE(pr.rating, 900)) INTO v_r_a
  FROM unnest(ARRAY[p_a1, p_a2]) AS u(player_id)
  JOIN profiles pr ON pr.id = u.player_id;
  SELECT AVG(COALESCE(pr.rating, 900)) INTO v_r_b
  FROM unnest(ARRAY[p_b1, p_b2]) AS u(player_id)
  JOIN profiles pr ON pr.id = u.player_id;
  IF v_r_a IS NULL OR v_r_b IS NULL THEN
    RETURN;
  END IF;

  v_e_a := 1 / (1 + power(10::numeric, (v_r_b - v_r_a) / 400));

  FOR pl IN
    SELECT t.player_id,
           CASE WHEN t.is_a THEN p_s_a ELSE 1 - p_s_a END AS side_s,
           CASE WHEN t.is_a THEN v_e_a ELSE 1 - v_e_a END AS side_e,
           CASE WHEN t.is_a THEN v_r_b ELSE v_r_a END AS side_opp_r,
           COALESCE(pr.rating, 900) AS r,
           pr.rating_games,
           (SELECT COALESCE(pr2.rating, 900) FROM profiles pr2 WHERE pr2.id = t.partner) AS partner_r,
           (SELECT pr2.rating_games FROM profiles pr2 WHERE pr2.id = t.partner) AS partner_games
    FROM (VALUES (p_a1, p_a2, TRUE), (p_a2, p_a1, TRUE),
                 (p_b1, p_b2, FALSE), (p_b2, p_b1, FALSE)) AS t(player_id, partner, is_a)
    JOIN profiles pr ON pr.id = t.player_id
  LOOP
    IF pl.partner_r IS NULL OR pl.side_s <> 1 THEN
      v_share := 0.5;
    ELSE
      v_w := LEAST(0.65, GREATEST(0.35, pl.partner_r / NULLIF(pl.r + pl.partner_r, 0)));
      v_share := COALESCE(v_w, 0.5);
    END IF;

    v_k := CASE WHEN pl.rating_games < 5 THEN 40
                WHEN pl.rating_games < 20 THEN 30
                ELSE 20 END;

    v_delta := v_k * (pl.side_s - pl.side_e) * v_share * 2;

    IF pl.rating_games >= 5 AND pl.partner_games IS NOT NULL AND pl.partner_games < 5 THEN
      IF p_partner_chosen THEN
        v_delta := v_delta * 0.5;
      ELSE
        v_delta := CASE WHEN v_delta < 0 THEN 0
                        ELSE v_delta * 0.5 END;
      END IF;
    END IF;

    UPDATE profiles
    SET rating = GREATEST(0, COALESCE(rating, 900) + v_delta),
        rating_games = rating_games + 1
    WHERE id = pl.player_id;

    pid := pl.player_id;
    delta := v_delta;
    s := pl.side_s;
    opp_r := pl.side_opp_r;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql SET search_path = public;

REVOKE ALL ON FUNCTION apply_elo_pairing(UUID, UUID, UUID, UUID, NUMERIC, BOOLEAN) FROM public, anon, authenticated;

-- ── apply_mix_elo: snapshot de início de mix + cap + novo financiamento ──

CREATE OR REPLACE FUNCTION apply_mix_elo(p_game_id UUID, p_winner_team_id UUID)
RETURNS void AS $$
DECLARE
  m RECORD;
  pl RECORD;
  v_s_a NUMERIC;
  v_had_matches BOOLEAN := FALSE;
  v_bonus_total NUMERIC;
  v_weight_sum NUMERIC;
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

    FOR pl IN
      SELECT * FROM apply_elo_pairing(m.a1, m.a2, m.b1, m.b2, v_s_a, p_partner_chosen => FALSE)
    LOOP
      INSERT INTO _elo_night (pid, delta, played, won, opp_r_sum)
      VALUES (pl.pid, pl.delta, 1, CASE WHEN pl.s = 1 THEN 1 ELSE 0 END, pl.opp_r)
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

      -- Financiamento novo: paga quem perdeu ESPECIFICAMENTE contra um
      -- premiado, pesado pelo E que já tinha nesse jogo (ratings de início
      -- de mix) — não mais "quem tem mais rating no grupo".
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

      SELECT COALESCE(SUM(bonus), 0) INTO v_bonus_total FROM _elo_night WHERE bonus > 0;
      SELECT COALESCE(SUM(surprise_weight), 0) INTO v_weight_sum FROM _elo_night WHERE bonus = 0;

      IF v_bonus_total > 0 AND v_weight_sum > 0 THEN
        UPDATE _elo_night
        SET bonus = - v_bonus_total * surprise_weight / v_weight_sum
        WHERE bonus = 0 AND surprise_weight > 0;
      END IF;
      -- Se v_weight_sum = 0 (ninguém perdeu de forma surpreendente contra
      -- os premiados), o bónus fica por financiar — aceite, ver cabeçalho.
    END IF;

    -- Cap de dominância: só do lado de quem ganhou por ter, em média,
    -- adversários muito mais fracos nesse mix — nunca no lado do azarão
    -- nem de quem está a perder.
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
