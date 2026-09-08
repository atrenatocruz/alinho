-- ════════════════════════════════════════════════════════════════════════
-- [SUBSTITUÍDO no mesmo dia por migration_elo_partner_shield.sql — correr
--  esse em vez deste. Fica como registo da 1ª iteração.]
--
-- Fix do Elo de duplas (spec 2026-09-08): amortecedor de novatos +
-- derrotas 50/50.
--
-- Caso que motivou (Diogo Alexandre): um bom jogador perdia rating em
-- espiral porque (1) novatos entram a 900 sobre-avaliados e a média da
-- dupla inflava a expectativa dele — pagava o erro de auto-avaliação
-- alheio; e (2) a regra antiga mandava o mais forte absorver 65% das
-- derrotas — castigava precisamente quem carrega o parceiro fraco.
--
-- Mudanças em apply_elo_pairing (fonte única da matemática — mixes e
-- amigáveis apanham ambos):
--   A. Amortecedor: jogador estabelecido (≥5 jogos) com parceiro
--      provisório (<5 jogos) → delta ×0.5, nas duas direções. O novato
--      corrige ao ritmo normal (K40); o estabelecido deixa de pagar a
--      calibração dele por inteiro.
--   B. Fatias: vitória mantém o cap 35/65 (o mais fraco ganha mais);
--      DERROTA passa a 50/50 — fim do imposto do carregador.
--
-- Depois de correr isto, correr migration_elo_backfill_v2.sql para
-- recalcular o histórico com as regras novas.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION apply_elo_pairing(p_a1 UUID, p_a2 UUID, p_b1 UUID, p_b2 UUID, p_s_a NUMERIC)
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
  -- parceiro, para o amortecedor). Os cursores de um FOR são insensíveis
  -- a alterações da própria transação depois de abertos — todos usam os
  -- ratings de início do jogo.
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
    -- (cap [35%, 65%] — incentiva o carry para cima); na DERROTA é
    -- 50/50 — a regra antiga ("o mais forte absorve mais") castigava
    -- precisamente quem carrega um parceiro fraco e perde. Empate e
    -- jogador sem parceiro: 50/50.
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

    -- Amortecedor de novatos: estabelecido a jogar com provisório conta
    -- meio, nas duas direções. O rating declarado do provisório ainda não
    -- é informação fiável — o erro dele não deve sair por inteiro do
    -- bolso do parceiro (nem inflar-lho nas vitórias).
    IF pl.rating_games >= 5 AND pl.partner_games IS NOT NULL AND pl.partner_games < 5 THEN
      v_delta := v_delta * 0.5;
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

REVOKE ALL ON FUNCTION apply_elo_pairing(UUID, UUID, UUID, UUID, NUMERIC) FROM public, anon, authenticated;
