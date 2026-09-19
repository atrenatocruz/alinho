-- ════════════════════════════════════════════════════════════════════════
-- Elo — entrada do nível 1 a Iniciante, primeiros jogos drásticos e
-- partilha na dupla simétrica (Trello #288).
--
-- ⚠️  PROPOSTA PARA VALIDAR (Renato + Ruben) — o cálculo do Elo é deles.
--     Parecer no cartão «#288 — Pontos ao inscrever: poder escolher o nível
--     de 1 a Iniciante, não só até 5» (Selected/Ready). O Francisco pediu
--     (19 set) para ir para o dev para validarem. Não correr sem o "sim".
--
-- Três mudanças, que saem juntas (o cartão diz que 2 e 3 são a mesma
-- entrega):
--
--   1. PARTILHA NA DUPLA — o mais forte ganha menos E perde menos.
--      Hoje (migration_elo_provisional_8.sql) a partilha w só se aplica às
--      vitórias; nas derrotas é 50/50. Resultado: o mais forte da dupla
--      desce e o mais fraco sobe sem razão, jogo após jogo. Passa a usar o
--      mesmo w nas derrotas: w = rating do parceiro / (meu + parceiro),
--      limitado a [35%, 65%] — quem é mais forte tem w < 50% e mexe menos
--      nos dois sentidos. Empate continua 50/50.
--
--   2. ENTRADA DE NÍVEL 1 A INICIANTE (hoje máx. 1100 = nível 5).
--      Pontos de entrada: 1: 1900 · 2: 1700 · 3: 1500 · 4: 1300 · 5: 1100 ·
--      6: 850 · Iniciante: 600 (cada um dentro da sua banda — ver
--      ratingBand em src/lib/elo.js). Quem já está NÃO muda: a função só
--      atua em contas ainda não classificadas (rating_onboarded_at nulo),
--      como antes. As chaves antigas (iniciado/regular/avancado) continuam
--      a funcionar com os valores antigos, para quem tem a app em cache.
--
--   3. PRIMEIROS JOGOS DRÁSTICOS — K numa só tabela (elo_k_factor):
--      1.º jogo 120 · 2.º 90 · 3.º 70 · 4.º-8.º 50 · 9.º-20.º 30 · depois 20.
--      Os limiares 8 e 20 continuam os mesmos (8 = "novo"/provisório, igual
--      ao escudo de parceiro e à marca NOVO na app).
--
-- O que NÃO muda: escudo de parceiro provisório, apply_mix_elo (cap de
-- dominância, prémio e financiamento — ficam à espera da análise de 20 out),
-- confirm_private_match, finalize_mix. Assinatura de apply_elo_pairing igual.
--
-- Ordem: depois de migration_elo_provisional_8.sql e de
-- migration_elo_dominance_cap.sql.
-- Recalcular o histórico (os 8 mixes já jogados) é recomendado no parecer:
-- decisão do Renato. Atenção que migration_elo_backfill_v3.sql repete os
-- jogos entre amigos sem olhar ao consentimento de ranking (ver o plano
-- técnico das aulas, secção 2).
-- ════════════════════════════════════════════════════════════════════════

-- ── 3. K numa só tabela ───────────────────────────────────────────────────
-- p_games = jogos já contados ANTES deste (0 = primeiro jogo).
CREATE OR REPLACE FUNCTION elo_k_factor(p_games INTEGER)
RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN COALESCE(p_games, 0) = 0 THEN 120
    WHEN p_games = 1 THEN 90
    WHEN p_games = 2 THEN 70
    WHEN p_games < 8 THEN 50
    WHEN p_games < 20 THEN 30
    ELSE 20 END;
$$;

-- ── 1 + 3. apply_elo_pairing ──────────────────────────────────────────────
-- Igual a migration_elo_provisional_8.sql, exceto: K de elo_k_factor e a
-- partilha w também nas derrotas.
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
           COALESCE(pr.rating, 900) AS r,
           pr.rating_games,
           (SELECT COALESCE(pr2.rating, 900) FROM profiles pr2 WHERE pr2.id = t.partner) AS partner_r,
           (SELECT pr2.rating_games FROM profiles pr2 WHERE pr2.id = t.partner) AS partner_games
    FROM (VALUES (p_a1, p_a2, TRUE), (p_a2, p_a1, TRUE),
                 (p_b1, p_b2, FALSE), (p_b2, p_b1, FALSE)) AS t(player_id, partner, is_a)
    JOIN profiles pr ON pr.id = t.player_id
  LOOP
    -- Partilha na dupla (#288): o mais forte ganha menos E perde menos.
    -- Sem parceiro, ou empate, 50/50.
    IF pl.partner_r IS NULL OR pl.side_s NOT IN (0, 1) THEN
      v_share := 0.5;
    ELSE
      v_w := LEAST(0.65, GREATEST(0.35, pl.partner_r / NULLIF(pl.r + pl.partner_r, 0)));
      v_share := COALESCE(v_w, 0.5);
    END IF;

    v_k := elo_k_factor(pl.rating_games);

    v_delta := v_k * (pl.side_s - pl.side_e) * v_share * 2;

    -- Escudo/amortecedor de parceiro provisório — sem mudanças.
    IF pl.rating_games >= 8 AND pl.partner_games IS NOT NULL AND pl.partner_games < 8 THEN
      IF p_partner_chosen THEN
        v_delta := v_delta * 0.5;
      ELSE
        v_delta := CASE WHEN v_delta < 0 THEN 0 ELSE v_delta * 0.5 END;
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
REVOKE ALL ON FUNCTION elo_k_factor(INTEGER) FROM public, anon;

-- ── 2. Entrada do nível 1 a Iniciante ─────────────────────────────────────
CREATE OR REPLACE FUNCTION complete_rating_onboarding(p_level TEXT)
RETURNS void AS $$
DECLARE
  v_anchor INTEGER;
BEGIN
  v_anchor := CASE p_level
    WHEN 'n1' THEN 1900
    WHEN 'n2' THEN 1700
    WHEN 'n3' THEN 1500
    WHEN 'n4' THEN 1300
    WHEN 'n5' THEN 1100
    WHEN 'n6' THEN 850
    WHEN 'iniciante' THEN 600
    -- chaves antigas (app em cache), valores antigos
    WHEN 'iniciado' THEN 700
    WHEN 'regular'  THEN 900
    WHEN 'avancado' THEN 1100
  END;
  IF v_anchor IS NULL THEN
    RAISE EXCEPTION 'Nível inválido';
  END IF;

  -- Só contas ainda não classificadas: quem já está não muda. Mantém os
  -- deltas de jogos feitos antes de escolher o nível (baseline 900).
  UPDATE profiles
  SET rating = GREATEST(0, v_anchor + (COALESCE(rating, 900) - 900)),
      rating_anchor = v_anchor,
      rating_onboarded_at = NOW()
  WHERE id = auth.uid() AND rating_onboarded_at IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION complete_rating_onboarding(TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION complete_rating_onboarding(TEXT) TO authenticated;
