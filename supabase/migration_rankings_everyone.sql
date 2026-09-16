-- ─── Rankings: toda a gente aparece (épico #271, «Rankings: escalas, filtros…») ──
-- Francisco, 16 set 2026: nos Rankings aparece toda a gente. Quem não tem
-- nível (não devia acontecer — é pedido no registo) fica no fim, marcado
-- "Sem nível", e não com 0 pontos. O ecrã trata da etiqueta; aqui só se deixa
-- de excluir quem ainda não tem pontos nem jogos.
--
-- NÃO muda a ordem de quem já estava: rating DESC NULLS LAST continua a pôr
-- os sem nível no fim. As escalas separadas (M/F/Misto) ficam por acordar com
-- o Ruben e o Renato — esta lista continua a misturar, como hoje.
--
-- Quem mais usa get_global_rankings (GameDetails: pontos para formar duplas;
-- Perfil/PlayerDetails: "Estás em #N") só lê rating por user_id ou procura a
-- própria posição — as linhas novas têm rating NULL e ficam no fim; o Perfil
-- passa a ignorar a posição de quem não tem nível.
--
-- Base: migration_elo_provisional_8.sql (a versão mais recente). As colunas
-- não mudam, por isso chega CREATE OR REPLACE.

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
  -- Antes: só quem tinha estatísticas ou rating. Agora toda a gente com nome
  -- (um perfil sem nome ainda não acabou o registo).
  WHERE COALESCE(trim(p.name), '') <> ''
  ORDER BY p.rating DESC NULLS LAST, total_points DESC, p.name ASC;
$$;

REVOKE ALL ON FUNCTION get_global_rankings() FROM public, anon;
GRANT EXECUTE ON FUNCTION get_global_rankings() TO authenticated;

-- ── Ranking de um clube ou grupo: todos os membros ─────────────────────────
-- O filtro "âmbito: um clube ou grupo" dos Rankings. Antes o ecrã juntava
-- player_stats com memberships lidas diretamente — mas o RLS de memberships
-- só deixa um não-admin ler a PRÓPRIA linha, por isso o "Por clube" podia
-- mostrar só o próprio jogador. Esta função devolve todos os membros (sem
-- convidados nem contas de teste), com ou sem jogos, e as estatísticas desse
-- clube quando existem.
--
-- Acesso: igual ao de player_stats / get_xp_rankings — membro da org, quem a
-- gere, ou org com os mixes abertos (is_global).
CREATE OR REPLACE FUNCTION get_organization_player_rankings(p_organization_id UUID)
RETURNS TABLE (
  user_id UUID,
  name TEXT,
  avatar_url TEXT,
  rating NUMERIC,
  gender TEXT,
  rating_games INTEGER,
  game_wins INTEGER,
  game_losses INTEGER,
  mix_wins INTEGER,
  mixes_played INTEGER
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    p.id, p.name, p.avatar_url, p.rating, p.gender, p.rating_games,
    COALESCE(ps.game_wins, 0), COALESCE(ps.game_losses, 0),
    COALESCE(ps.mix_wins, 0), COALESCE(ps.mixes_played, 0)
  FROM memberships m
  JOIN profiles p ON p.id = m.user_id
  LEFT JOIN player_stats ps ON ps.user_id = m.user_id AND ps.organization_id = m.organization_id
  WHERE m.organization_id = p_organization_id
    AND m.is_guest = FALSE
    AND COALESCE(m.is_test, FALSE) = FALSE
    AND (
      EXISTS (
        SELECT 1 FROM memberships me
        WHERE me.organization_id = p_organization_id AND me.user_id = auth.uid()
      )
      OR is_org_admin(p_organization_id)
      OR org_is_global(p_organization_id)
    )
  ORDER BY p.rating DESC NULLS LAST, COALESCE(ps.mix_wins, 0) DESC, COALESCE(ps.game_wins, 0) DESC, p.name ASC;
$$;

REVOKE ALL ON FUNCTION get_organization_player_rankings(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION get_organization_player_rankings(UUID) TO authenticated;
