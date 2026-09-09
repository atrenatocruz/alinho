-- ════════════════════════════════════════════════════════════════════════
-- Provisório passa de <5 para <8 jogos (2 mixes) + rating_games no
-- ranking global (spec 2026-09-08, revisão do Ruben: "1 mix não é
-- suficiente para perceber se o jogador é bom ou mau").
--
-- 1. O limiar de PROVISÓRIO (escudo/amortecedor de parceiro — ver
--    migration_elo_partner_shield.sql) sobe para 8 jogos contados, e o
--    K de calibração ALINHA com ele (revisão do Ruben, mesma sessão):
--    K=40 nos jogos 1-8 ("enquanto és NOVO, o teu rating mexe a
--    dobrar"), K=30 do 9º ao 20º, K=20 depois. Um só conceito de
--    "novo" em todo o sistema — rótulo, escudo de parceiro e K.
-- 2. get_global_rankings ganha rating_games, para a UI marcar
--    provisórios (~902 · "provisório" · pill NOVO no avatar).
--
-- Depois de correr: re-correr migration_elo_backfill_v2.sql para o
-- histórico refletir o limiar novo.
-- ════════════════════════════════════════════════════════════════════════

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
    IF pl.partner_r IS NULL OR pl.side_s <> 1 THEN
      v_share := 0.5;
    ELSE
      v_w := LEAST(0.65, GREATEST(0.35, pl.partner_r / NULLIF(pl.r + pl.partner_r, 0)));
      v_share := COALESCE(v_w, 0.5);
    END IF;

    -- K alinhado com o limiar de provisório: 40 enquanto NOVO (<8),
    -- 30 até ao 20º jogo, 20 depois.
    v_k := CASE WHEN pl.rating_games < 8 THEN 40
                WHEN pl.rating_games < 20 THEN 30
                ELSE 20 END;

    v_delta := v_k * (pl.side_s - pl.side_e) * v_share * 2;

    -- Escudo/amortecedor de parceiro provisório — limiar 8 jogos
    -- (2 mixes). Mix (parceiro atribuído): derrota 0, vitória metade.
    -- Amigável (parceiro escolhido): ×0.5 nas duas direções.
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

-- ── get_global_rankings + rating_games (RETURNS muda → DROP primeiro) ───

DROP FUNCTION IF EXISTS get_global_rankings();

CREATE OR REPLACE FUNCTION get_global_rankings()
RETURNS TABLE (
  user_id UUID,
  name TEXT,
  avatar_url TEXT,
  rating NUMERIC,
  gender TEXT,
  club_points BIGINT,
  private_points BIGINT,
  total_points BIGINT,
  mix_wins BIGINT,
  mixes_played BIGINT,
  rating_games INTEGER
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH club AS (
    SELECT
      ps.user_id,
      SUM(ps.total_points) AS club_points,
      SUM(ps.mix_wins) AS mix_wins,
      SUM(ps.mixes_played) AS mixes_played
    FROM player_stats ps
    JOIN organizations o ON o.id = ps.organization_id
    WHERE o.is_global = TRUE
    GROUP BY ps.user_id
  ),
  private AS (
    SELECT pms.user_id, SUM(pms.points_earned) AS private_points
    FROM private_match_stats pms
    GROUP BY pms.user_id
  )
  SELECT
    p.id,
    p.name,
    p.avatar_url,
    p.rating,
    p.gender,
    COALESCE(club.club_points, 0) AS club_points,
    COALESCE(private.private_points, 0) AS private_points,
    COALESCE(club.club_points, 0) + COALESCE(private.private_points, 0) AS total_points,
    COALESCE(club.mix_wins, 0) AS mix_wins,
    COALESCE(club.mixes_played, 0) AS mixes_played,
    p.rating_games
  FROM profiles p
  LEFT JOIN club ON club.user_id = p.id
  LEFT JOIN private ON private.user_id = p.id
  WHERE club.user_id IS NOT NULL OR private.user_id IS NOT NULL OR p.rating IS NOT NULL
  ORDER BY p.rating DESC NULLS LAST, total_points DESC, p.name ASC;
$$;

REVOKE ALL ON FUNCTION get_global_rankings() FROM public, anon;
GRANT EXECUTE ON FUNCTION get_global_rankings() TO authenticated;
