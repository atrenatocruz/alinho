-- ════════════════════════════════════════════════════════════════════════
-- Migration: estatísticas da evolução do ranking (ideia do Francisco, 16 out)
--
-- Três leituras novas para a página «Estatísticas» do perfil (próprio e de
-- terceiros): a linha do tempo do ranking (um ponto por evento, com
-- rating_delta e rating_after), as vitórias-derrotas por adversário e por
-- parceiro. Nada se escreve: o delta continua por EVENTO, como está nas
-- tabelas (mix_player_stats / tournament_player_stats / private_match_stats).
--
-- Privacidade: as três respeitam profiles.results_visibility através do
-- played_history_visible() (migration_perfil_jogos_com_vida.sql) — o mesmo
-- porteiro do histórico de jogos. Perfil escondido → NULL, e o ecrã mostra
-- o aviso com o cadeado, como hoje na grelha de resultados.
--
-- Âmbito do «contra quem»/«com quem»: mixes (matches/teams) e jogos entre
-- amigos (private_matches) — o mesmo dos confrontos diretos de hoje; os
-- jogos de torneio ficam de fora nesta versão. Convidados sem conta nunca
-- aparecem (não têm perfil).
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. A linha do tempo do ranking ───────────────────────────────────────
-- Reaproveita o played_event_rows() (a união viva de mixes, torneios e
-- amigos) e acrescenta-lhe o rating_after por evento. Só eventos que
-- mexeram no ranking (rating_delta IS NOT NULL); ordem cronológica pelo
-- momento em que os pontos entraram (done_at), com a data do evento para
-- mostrar. Numa sessão entre amigos o rating_after é o do último jogo dela.
CREATE OR REPLACE FUNCTION public.get_rating_timeline(p_user_id UUID DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid UUID := COALESCE(p_user_id, auth.uid());
BEGIN
  IF NOT played_history_visible(v_uid) THEN
    RETURN NULL;
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'kind', r.kind,
             'event_id', r.event_id,
             'title', r.title,
             'category_code', r.category_code,
             'org_name', r.org_name,
             'starts_at', r.starts_at,
             'done_at', r.done_at,
             'won', r.won,
             'wins', r.wins,
             'games', r.games,
             'rating_delta', r.rating_delta,
             'rating_after', ra.after
           ) ORDER BY COALESCE(r.done_at, r.starts_at), r.event_id)
      FROM played_event_rows(v_uid) r
      CROSS JOIN LATERAL (
        SELECT CASE r.src
                 WHEN 'mix' THEN
                   (SELECT s.rating_after FROM mix_player_stats s
                     WHERE s.game_id = r.ref AND s.user_id = v_uid)
                 WHEN 'tournament' THEN
                   (SELECT s.rating_after FROM tournament_player_stats s
                     WHERE s.category_id = r.ref AND s.user_id = v_uid)
                 WHEN 'classic' THEN
                   (SELECT s.rating_after FROM private_match_stats s
                     WHERE s.private_match_id = r.ref AND s.user_id = v_uid)
                 ELSE
                   (SELECT s.rating_after
                      FROM private_match_stats s
                      JOIN private_matches x ON x.id = s.private_match_id
                     WHERE (x.id = r.ref OR x.session_id = r.ref OR x.friend_pair_of = r.ref)
                       AND s.user_id = v_uid
                     ORDER BY s.created_at DESC LIMIT 1)
               END AS after
      ) ra
     WHERE r.rating_delta IS NOT NULL
  ), '[]'::jsonb);
END;
$function$;
REVOKE ALL ON FUNCTION public.get_rating_timeline(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_rating_timeline(UUID) TO authenticated;

-- ── 2. Vitórias e derrotas por adversário ────────────────────────────────
-- Generaliza o get_head_to_head_summary (1 adversário de cada vez) para
-- todos de uma vez. Jogos de mix sem vencedor (empates por desempatar) e
-- mixes cancelados ficam de fora; convidados sem conta (id NULL) também.
CREATE OR REPLACE FUNCTION public.get_rating_opponents(p_user_id UUID DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid UUID := COALESCE(p_user_id, auth.uid());
BEGIN
  IF NOT played_history_visible(v_uid) THEN
    RETURN NULL;
  END IF;
  RETURN COALESCE((
    WITH mix_pairs AS (
      SELECT pb.pid AS opp, (m.winner_team_id = ta.id) = pa.is_a AS won
        FROM matches m
        JOIN teams ta ON ta.id = m.team_a_id
        JOIN teams tb ON tb.id = m.team_b_id
        JOIN games g ON g.id = m.game_id
        CROSS JOIN LATERAL (VALUES
          (ta.player1_id, TRUE), (ta.player2_id, TRUE),
          (tb.player1_id, FALSE), (tb.player2_id, FALSE)
        ) AS pa(pid, is_a)
        CROSS JOIN LATERAL (VALUES
          (ta.player1_id, TRUE), (ta.player2_id, TRUE),
          (tb.player1_id, FALSE), (tb.player2_id, FALSE)
        ) AS pb(pid, is_a)
       WHERE m.winner_team_id IS NOT NULL
         AND g.status IS DISTINCT FROM 'cancelled'
         AND pa.pid = v_uid AND pa.is_a <> pb.is_a AND pb.pid IS NOT NULL
    ),
    private_pairs AS (
      SELECT opp.pid AS opp, pms.won
        FROM private_matches pm
        JOIN private_match_stats pms ON pms.private_match_id = pm.id AND pms.user_id = v_uid
        CROSS JOIN LATERAL (VALUES
          (pm.team_a_player1_id, 'a'), (pm.team_a_player2_id, 'a'),
          (pm.team_b_player1_id, 'b'), (pm.team_b_player2_id, 'b')
        ) AS opp(pid, side)
       WHERE pm.status = 'confirmed'
         AND opp.pid IS NOT NULL AND opp.pid <> v_uid
         AND opp.side <> CASE WHEN v_uid IN (pm.team_a_player1_id, pm.team_a_player2_id) THEN 'a' ELSE 'b' END
    ),
    agg AS (
      SELECT opp,
             count(*) FILTER (WHERE won)::int     AS wins,
             count(*) FILTER (WHERE NOT won)::int AS losses,
             count(*)::int                        AS total
        FROM (SELECT * FROM mix_pairs UNION ALL SELECT * FROM private_pairs) c
       GROUP BY opp
       ORDER BY count(*) DESC
       LIMIT 100
    )
    SELECT jsonb_agg(jsonb_build_object(
             'id', a.opp, 'name', p.name, 'avatar_url', p.avatar_url,
             'wins', a.wins, 'losses', a.losses, 'total', a.total
           ) ORDER BY a.total DESC, p.name)
      FROM agg a
      JOIN profiles p ON p.id = a.opp
  ), '[]'::jsonb);
END;
$function$;
REVOKE ALL ON FUNCTION public.get_rating_opponents(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_rating_opponents(UUID) TO authenticated;

-- ── 3. Vitórias e derrotas por parceiro ──────────────────────────────────
-- O suggest_partners conta jogos juntos mas não vitórias, e só serve o
-- próprio; esta conta V-D com cada parceiro, para qualquer perfil visível.
CREATE OR REPLACE FUNCTION public.get_rating_partners(p_user_id UUID DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid UUID := COALESCE(p_user_id, auth.uid());
BEGIN
  IF NOT played_history_visible(v_uid) THEN
    RETURN NULL;
  END IF;
  RETURN COALESCE((
    WITH mix_mates AS (
      SELECT CASE WHEN t.player1_id = v_uid THEN t.player2_id ELSE t.player1_id END AS mate,
             (m.winner_team_id = t.id) AS won
        FROM matches m
        JOIN teams t ON t.id IN (m.team_a_id, m.team_b_id)
        JOIN games g ON g.id = m.game_id
       WHERE m.winner_team_id IS NOT NULL
         AND g.status IS DISTINCT FROM 'cancelled'
         AND v_uid IN (t.player1_id, t.player2_id)
    ),
    private_mates AS (
      SELECT CASE WHEN v_uid = pm.team_a_player1_id THEN pm.team_a_player2_id
                  WHEN v_uid = pm.team_a_player2_id THEN pm.team_a_player1_id
                  WHEN v_uid = pm.team_b_player1_id THEN pm.team_b_player2_id
                  ELSE pm.team_b_player1_id
             END AS mate,
             pms.won
        FROM private_matches pm
        JOIN private_match_stats pms ON pms.private_match_id = pm.id AND pms.user_id = v_uid
       WHERE pm.status = 'confirmed'
    ),
    agg AS (
      SELECT mate,
             count(*) FILTER (WHERE won)::int     AS wins,
             count(*) FILTER (WHERE NOT won)::int AS losses,
             count(*)::int                        AS total
        FROM (SELECT * FROM mix_mates UNION ALL SELECT * FROM private_mates) c
       WHERE mate IS NOT NULL
       GROUP BY mate
       ORDER BY count(*) DESC
       LIMIT 100
    )
    SELECT jsonb_agg(jsonb_build_object(
             'id', a.mate, 'name', p.name, 'avatar_url', p.avatar_url,
             'wins', a.wins, 'losses', a.losses, 'total', a.total
           ) ORDER BY a.total DESC, p.name)
      FROM agg a
      JOIN profiles p ON p.id = a.mate
  ), '[]'::jsonb);
END;
$function$;
REVOKE ALL ON FUNCTION public.get_rating_partners(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_rating_partners(UUID) TO authenticated;

COMMIT;

-- ── Verificar depois de correr ───────────────────────────────────────────
-- SELECT has_function_privilege('anon', 'get_rating_timeline(uuid)', 'EXECUTE');   -- false
-- SELECT has_function_privilege('authenticated', 'get_rating_timeline(uuid)', 'EXECUTE'); -- true
-- SELECT has_function_privilege('anon', 'get_rating_opponents(uuid)', 'EXECUTE');  -- false
-- SELECT has_function_privilege('anon', 'get_rating_partners(uuid)', 'EXECUTE');   -- false
-- Com sessão: SELECT get_rating_timeline(NULL); — [] ou a tua linha do tempo.
