-- ════════════════════════════════════════════════════════════════════════
-- Elo de duplas — escudo de parceiro provisório (revisão de 2026-09-08,
-- 2ª iteração; SUBSTITUI migration_elo_doubles_fix.sql — correr só este,
-- e depois migration_elo_backfill_v2.sql).
--
-- Regras com parceiro PROVISÓRIO (<5 jogos contados), para um jogador
-- ESTABELECIDO (≥5):
--   · MIX (parceiro atribuído pela app — não o escolheste):
--       derrota = 0 pontos perdidos (safeguard: o erro de auto-avaliação
--       do novato não sai do teu bolso) · vitória conta METADE (um
--       novato sub-avaliado fortíssimo carregava-te com vitórias
--       inflacionadas — free Elo nos dois sentidos, fechado dos dois).
--   · AMIGÁVEL (parceiro escolhido por ti): amortecedor ×0.5 nas duas
--       direções — com escolha de parceiro, um safeguard total seria uma
--       máquina de farmar pontos sem risco.
-- O provisório em si corrige sempre ao ritmo normal (K40).
-- Mantém-se da iteração anterior: cap 35/65 só nas vitórias (o mais
-- fraco ganha mais); derrotas repartem 50/50; divisor 400; K 40/30/20.
--
-- A distinção mix/amigável entra como parâmetro p_partner_chosen
-- (DEFAULT true = escolhido, o caso conservador): a assinatura muda, por
-- isso DROP da versão antiga + recriação dos callers.
-- ════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS apply_elo_pairing(UUID, UUID, UUID, UUID, NUMERIC);

CREATE OR REPLACE FUNCTION apply_elo_pairing(
  p_a1 UUID, p_a2 UUID, p_b1 UUID, p_b2 UUID, p_s_a NUMERIC,
  p_partner_chosen BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (pid UUID, delta NUMERIC, s NUMERIC) AS $$
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
  -- Rating de cada dupla = média dos jogadores presentes (um jogador a
  -- solo numa dupla conta sozinho).
  SELECT AVG(COALESCE(pr.rating, 900)) INTO v_r_a
  FROM unnest(ARRAY[p_a1, p_a2]) AS u(player_id)
  JOIN profiles pr ON pr.id = u.player_id;
  SELECT AVG(COALESCE(pr.rating, 900)) INTO v_r_b
  FROM unnest(ARRAY[p_b1, p_b2]) AS u(player_id)
  JOIN profiles pr ON pr.id = u.player_id;
  IF v_r_a IS NULL OR v_r_b IS NULL THEN
    RETURN; -- dupla sem jogadores conhecidos — nada a pontuar
  END IF;

  v_e_a := 1 / (1 + power(10::numeric, (v_r_b - v_r_a) / 400));

  -- Snapshot dos 4 jogadores num só query (inclui o rating_games do
  -- parceiro, para o escudo/amortecedor). Os cursores de um FOR são
  -- insensíveis a alterações da própria transação depois de abertos —
  -- todos usam os ratings de início do jogo.
  FOR pl IN
    SELECT t.player_id,
           CASE WHEN t.is_a THEN p_s_a ELSE 1 - p_s_a END AS side_s,
           CASE WHEN t.is_a THEN v_e_a ELSE 1 - v_e_a END AS side_e,
           COALESCE(pr.rating, 900) AS r,
           pr.rating_games,
           (SELECT COALESCE(pr2.rating, 900) FROM profiles pr2 WHERE pr2.id = t.partner) AS partner_r,
           (SELECT pr2.rating_games FROM profiles pr2 WHERE pr2.id = t.partner) AS partner_games
    FROM (VALUES (p_a1, p_a2, TRUE), (p_a2, p_a1, TRUE),
                 (p_b1, p_b2, FALSE), (p_b2, p_b1, FALSE)) AS t(player_id, partner, is_a)
    JOIN profiles pr ON pr.id = t.player_id
  LOOP
    -- Fatias da dupla: na VITÓRIA o mais fraco leva a maior fatia
    -- (cap [35%, 65%]); na DERROTA é 50/50 (a regra antiga "o mais
    -- forte absorve mais" castigava quem carrega). Empate/solo: 50/50.
    IF pl.partner_r IS NULL OR pl.side_s <> 1 THEN
      v_share := 0.5;
    ELSE
      v_w := LEAST(0.65, GREATEST(0.35, pl.partner_r / NULLIF(pl.r + pl.partner_r, 0)));
      v_share := COALESCE(v_w, 0.5);
    END IF;

    -- K individual estilo FIDE, pelo nº de jogos já contabilizados.
    v_k := CASE WHEN pl.rating_games < 5 THEN 40
                WHEN pl.rating_games < 20 THEN 30
                ELSE 20 END;

    -- share × 2 para que 50/50 seja o K×(S−E) clássico.
    v_delta := v_k * (pl.side_s - pl.side_e) * v_share * 2;

    -- Escudo/amortecedor de parceiro provisório (ver cabeçalho): o rating
    -- declarado do provisório ainda não é informação fiável, em nenhuma
    -- das direções.
    IF pl.rating_games >= 5 AND pl.partner_games IS NOT NULL AND pl.partner_games < 5 THEN
      IF p_partner_chosen THEN
        v_delta := v_delta * 0.5;                       -- amigável: ×0.5 sempre
      ELSE
        v_delta := CASE WHEN v_delta < 0 THEN 0         -- mix: derrota não desconta
                        ELSE v_delta * 0.5 END;         -- mix: vitória a metade
      END IF;
    END IF;

    UPDATE profiles
    SET rating = GREATEST(0, COALESCE(rating, 900) + v_delta),
        rating_games = rating_games + 1
    WHERE id = pl.player_id;

    pid := pl.player_id;
    delta := v_delta;
    s := pl.side_s;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql SET search_path = public;

REVOKE ALL ON FUNCTION apply_elo_pairing(UUID, UUID, UUID, UUID, NUMERIC, BOOLEAN) FROM public, anon, authenticated;

-- ── apply_mix_elo: passa a declarar o contexto "parceiro atribuído" ─────
-- Única mudança face à versão viva: p_partner_chosen => FALSE na chamada
-- ao núcleo. (confirm_private_match não precisa de mexer — omite o
-- parâmetro e apanha o DEFAULT TRUE, que é o caso amigável.)

CREATE OR REPLACE FUNCTION apply_mix_elo(p_game_id UUID, p_winner_team_id UUID)
RETURNS void AS $$
DECLARE
  m RECORD;
  pl RECORD;
  v_s_a NUMERIC;
  v_had_matches BOOLEAN := FALSE;
  v_bonus_total NUMERIC;
  v_payer_rating_sum NUMERIC;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _elo_night (
    pid UUID PRIMARY KEY,
    delta NUMERIC NOT NULL DEFAULT 0,
    played INTEGER NOT NULL DEFAULT 0,
    won INTEGER NOT NULL DEFAULT 0,
    bonus NUMERIC NOT NULL DEFAULT 0
  ) ON COMMIT DROP;
  TRUNCATE _elo_night;

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
      INSERT INTO _elo_night (pid, delta, played, won)
      VALUES (pl.pid, pl.delta, 1, CASE WHEN pl.s = 1 THEN 1 ELSE 0 END)
      ON CONFLICT (pid) DO UPDATE
      SET delta = _elo_night.delta + EXCLUDED.delta,
          played = _elo_night.played + 1,
          won = _elo_night.won + EXCLUDED.won;
    END LOOP;
  END LOOP;

  IF v_had_matches AND p_winner_team_id IS NOT NULL THEN
    UPDATE _elo_night n
    SET bonus = (CASE WHEN n.pid IN (SELECT unnest(ARRAY[player1_id, player2_id])
                                     FROM teams WHERE id = p_winner_team_id)
                      THEN 0.01 ELSE 0 END
               + CASE WHEN n.played > 0 AND n.won = n.played THEN 0.005 ELSE 0 END)
              * COALESCE((SELECT pr.rating FROM profiles pr WHERE pr.id = n.pid), 900)
    WHERE TRUE;

    SELECT COALESCE(SUM(bonus), 0) INTO v_bonus_total FROM _elo_night WHERE bonus > 0;
    SELECT COALESCE(SUM(COALESCE(pr.rating, 900)), 0) INTO v_payer_rating_sum
    FROM _elo_night n JOIN profiles pr ON pr.id = n.pid
    WHERE n.bonus = 0;

    IF v_bonus_total > 0 AND v_payer_rating_sum > 0 THEN
      UPDATE _elo_night n
      SET bonus = - v_bonus_total * COALESCE(pr.rating, 900) / v_payer_rating_sum
      FROM profiles pr
      WHERE pr.id = n.pid AND n.bonus = 0;

      UPDATE _elo_night SET delta = delta + bonus WHERE TRUE;

      UPDATE profiles pr
      SET rating = GREATEST(0, COALESCE(pr.rating, 900) + n.bonus)
      FROM _elo_night n
      WHERE pr.id = n.pid;
    END IF;
  END IF;

  UPDATE mix_player_stats mps
  SET rating_delta = ROUND(n.delta, 2),
      rating_after = ROUND(COALESCE(pr.rating, 900), 2)
  FROM _elo_night n
  JOIN profiles pr ON pr.id = n.pid
  WHERE mps.game_id = p_game_id AND mps.user_id = n.pid;
END;
$$ LANGUAGE plpgsql SET search_path = public;

REVOKE ALL ON FUNCTION apply_mix_elo(UUID, UUID) FROM public, anon, authenticated;
