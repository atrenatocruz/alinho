-- ═════════════════════════════════════════════════════════════════════════
-- Jogos entre amigos: a lista com vida (dados)
--
-- PORQUÊ. SPEC design-handoff/2026-10-12-lista-jogos-amigos (Francisco,
-- 12 out: «Bem melhor»). Pedido do Bugs, que faz o ecrã; ordem do PO.
-- Só leitura: nada muda no que se grava.
--
-- O QUE FAZ
--   1. friend_match_pairs_json: cada pessoa dos pares ganha 'avatar_url'.
--   2. list_my_friend_sessions, por jogo, além do que já mandava:
--      · people_list: [{invitee_id, user_id, name, avatar_url, status}] de
--        quem foi convidado e não recusou (status pending, accepted, guest)
--        — as fotos de quem respondeu e os lugares que faltam.
--        ('people' continua a ser o número, como antes.)
--      · current_round {number, court_number, round_kind, round_points_to,
--        started_at} e live_pair {team_a, team_b, rounds_a, rounds_b}: a
--        ronda em curso (a minha, se eu jogar nela) e quantas rondas cada
--        dupla dessa ronda já ganhou à outra. NULL sem ronda em curso.
--      · rounds_count: rondas com resultado.
--      · first_result_at, last_result_at: das rondas (result_at, de
--        migration_amigos_hora_da_ronda.sql).
--      · i_won: o jogo acabou e ganhei mais do que perdi — em pares fixos,
--        pares ganhos contra perdidos; a rodar, rondas ganhas contra
--        perdidas.
--      · my_rounds_won, my_rounds_played, best_partner {user_id, name,
--        avatar_url}: só a rodar (NULL nos outros). A melhor dupla é com quem
--        ganhei mais rondas (depois, com quem joguei mais); NULL sem nenhuma
--        ronda ganha.
--
-- ORDEM. Depois de migration_amigos_so_convidados.sql, de
-- migration_amigos_o_fim.sql e de migration_amigos_hora_da_ronda.sql.
--
-- Dev 3, 12 out 2026 · ecrã: Bugs
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Uma pessoa de um jogo: com conta (nome e foto) ou convidado (nome) ──
CREATE OR REPLACE FUNCTION public.friend_match_person_json(p_user UUID, p_guest TEXT)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT jsonb_build_object('user_id', p_user,
                            'name', COALESCE((SELECT name FROM profiles WHERE id = p_user), p_guest),
                            'avatar_url', (SELECT avatar_url FROM profiles WHERE id = p_user));
$function$;
REVOKE ALL ON FUNCTION public.friend_match_person_json(UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- ── 1. Os pares, com as fotos ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.friend_match_pairs_json(p_root UUID)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'pair_key', q.pair_key,
           'team_a', jsonb_build_array(friend_match_person_json(q.a1, q.a1g), friend_match_person_json(q.a2, q.a2g)),
           'team_b', jsonb_build_array(friend_match_person_json(q.b1, q.b1g), friend_match_person_json(q.b2, q.b2g)),
           'rounds_a', q.rounds_a, 'rounds_b', q.rounds_b, 'games_a', q.games_a, 'games_b', q.games_b,
           'winner', q.winner,
           'counts', EXISTS (SELECT 1 FROM private_matches p JOIN private_match_stats st ON st.private_match_id = p.id
                              WHERE p.friend_pair_of = p_root AND p.pair_key = q.pair_key),
           'waiting', cardinality(q.pending_people) > 0)
         ORDER BY q.first_round), '[]'::jsonb)
    FROM friend_match_pair_rows(p_root) q;
$function$;

-- ── 2a. A ronda em curso e as rondas que cada dupla já ganhou ───────────
CREATE OR REPLACE FUNCTION public.friend_match_live_json(p_root UUID, p_uid UUID)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH l AS (
    SELECT g.*,
           least(COALESCE(g.team_a_player1_id::text, 'g:' || lower(btrim(g.team_a_player1_guest_name))),
                 COALESCE(g.team_a_player2_id::text, 'g:' || lower(btrim(g.team_a_player2_guest_name)))) || '+' ||
           greatest(COALESCE(g.team_a_player1_id::text, 'g:' || lower(btrim(g.team_a_player1_guest_name))),
                    COALESCE(g.team_a_player2_id::text, 'g:' || lower(btrim(g.team_a_player2_guest_name)))) AS ka,
           least(COALESCE(g.team_b_player1_id::text, 'g:' || lower(btrim(g.team_b_player1_guest_name))),
                 COALESCE(g.team_b_player2_id::text, 'g:' || lower(btrim(g.team_b_player2_guest_name)))) || '+' ||
           greatest(COALESCE(g.team_b_player1_id::text, 'g:' || lower(btrim(g.team_b_player1_guest_name))),
                    COALESCE(g.team_b_player2_id::text, 'g:' || lower(btrim(g.team_b_player2_guest_name)))) AS kb
      FROM private_matches g
     WHERE (g.id = p_root OR g.session_id = p_root)
       AND g.started_at IS NOT NULL AND g.winner_team IS NULL
     ORDER BY (p_uid IS NOT NULL AND p_uid IN (g.team_a_player1_id, g.team_a_player2_id, g.team_b_player1_id, g.team_b_player2_id)) DESC,
              COALESCE(g.round_number, g.game_number, 1), COALESCE(g.court_number, 1)
     LIMIT 1
  ), d AS (
    -- As rondas já com resultado, com as chaves das duas duplas.
    SELECT r.winner_team,
           least(COALESCE(r.team_a_player1_id::text, 'g:' || lower(btrim(r.team_a_player1_guest_name))),
                 COALESCE(r.team_a_player2_id::text, 'g:' || lower(btrim(r.team_a_player2_guest_name)))) || '+' ||
           greatest(COALESCE(r.team_a_player1_id::text, 'g:' || lower(btrim(r.team_a_player1_guest_name))),
                    COALESCE(r.team_a_player2_id::text, 'g:' || lower(btrim(r.team_a_player2_guest_name)))) AS ka,
           least(COALESCE(r.team_b_player1_id::text, 'g:' || lower(btrim(r.team_b_player1_guest_name))),
                 COALESCE(r.team_b_player2_id::text, 'g:' || lower(btrim(r.team_b_player2_guest_name)))) || '+' ||
           greatest(COALESCE(r.team_b_player1_id::text, 'g:' || lower(btrim(r.team_b_player1_guest_name))),
                    COALESCE(r.team_b_player2_id::text, 'g:' || lower(btrim(r.team_b_player2_guest_name)))) AS kb
      FROM private_matches r
     WHERE (r.id = p_root OR r.session_id = p_root)
       AND r.score_a IS NOT NULL AND r.score_b IS NOT NULL AND r.winner_team IN ('a', 'b')
  )
  SELECT jsonb_build_object(
           'current_round', jsonb_build_object('number', COALESCE(l.round_number, l.game_number, 1),
                                               'court_number', COALESCE(l.court_number, 1),
                                               'round_kind', l.round_kind, 'round_points_to', l.round_points_to,
                                               'started_at', l.started_at),
           'live_pair', jsonb_build_object(
              'team_a', jsonb_build_array(friend_match_person_json(l.team_a_player1_id, l.team_a_player1_guest_name),
                                          friend_match_person_json(l.team_a_player2_id, l.team_a_player2_guest_name)),
              'team_b', jsonb_build_array(friend_match_person_json(l.team_b_player1_id, l.team_b_player1_guest_name),
                                          friend_match_person_json(l.team_b_player2_id, l.team_b_player2_guest_name)),
              'rounds_a', (SELECT count(*) FROM d WHERE (d.ka = l.ka AND d.kb = l.kb AND d.winner_team = 'a')
                                                     OR (d.ka = l.kb AND d.kb = l.ka AND d.winner_team = 'b')),
              'rounds_b', (SELECT count(*) FROM d WHERE (d.ka = l.ka AND d.kb = l.kb AND d.winner_team = 'b')
                                                     OR (d.ka = l.kb AND d.kb = l.ka AND d.winner_team = 'a'))))
    FROM l;
$function$;
REVOKE ALL ON FUNCTION public.friend_match_live_json(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- ── 2b. Eu neste jogo: rondas, vitória e melhor dupla ───────────────────
CREATE OR REPLACE FUNCTION public.friend_match_me_json(p_root UUID, p_uid UUID)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH root AS (
    SELECT pairing_mode, finished_at FROM private_matches WHERE id = p_root
  ), r AS (
    SELECT m.*,
           CASE WHEN p_uid IN (m.team_a_player1_id, m.team_a_player2_id) THEN 'a'
                WHEN p_uid IN (m.team_b_player1_id, m.team_b_player2_id) THEN 'b' END AS side
      FROM private_matches m
     WHERE (m.id = p_root OR m.session_id = p_root)
       AND m.score_a IS NOT NULL AND m.score_b IS NOT NULL AND m.winner_team IS NOT NULL
  ), mine AS (
    SELECT r.winner_team = r.side AS won,
           r.winner_team IN ('a', 'b') AND r.winner_team <> r.side AS lost,
           CASE WHEN r.side = 'a' THEN CASE WHEN r.team_a_player1_id = p_uid THEN r.team_a_player2_id ELSE r.team_a_player1_id END
                ELSE CASE WHEN r.team_b_player1_id = p_uid THEN r.team_b_player2_id ELSE r.team_b_player1_id END END AS pid,
           CASE WHEN r.side = 'a' THEN CASE WHEN r.team_a_player1_id = p_uid THEN r.team_a_player2_guest_name ELSE r.team_a_player1_guest_name END
                ELSE CASE WHEN r.team_b_player1_id = p_uid THEN r.team_b_player2_guest_name ELSE r.team_b_player1_guest_name END END AS pg
      FROM r WHERE r.side IS NOT NULL
  ), bp AS (
    SELECT mine.pid, max(mine.pg) AS pg, count(*) FILTER (WHERE mine.won) AS w, count(*) AS n
      FROM mine
     GROUP BY mine.pid, CASE WHEN mine.pid IS NULL THEN lower(btrim(mine.pg)) END
    HAVING count(*) FILTER (WHERE mine.won) > 0
     ORDER BY 3 DESC, 4 DESC, 2
     LIMIT 1
  ), pares AS (
    SELECT count(*) FILTER (WHERE q.winner = s.side) AS won, count(*) FILTER (WHERE q.winner IN ('a', 'b') AND q.winner <> s.side) AS lost
      FROM friend_match_pair_rows(p_root) q
      CROSS JOIN LATERAL (SELECT CASE WHEN p_uid IN (q.a1, q.a2) THEN 'a' WHEN p_uid IN (q.b1, q.b2) THEN 'b' END AS side) s
     WHERE s.side IS NOT NULL
  ), rot AS (
    SELECT COALESCE((SELECT pairing_mode FROM root), 'fixed') = 'rotating' AS a_rodar
  )
  SELECT jsonb_build_object(
    'i_won', p_uid IS NOT NULL AND (SELECT finished_at FROM root) IS NOT NULL
             AND CASE WHEN (SELECT a_rodar FROM rot)
                      THEN (SELECT count(*) FILTER (WHERE won) > count(*) FILTER (WHERE lost) FROM mine)
                      ELSE (SELECT won > lost FROM pares) END,
    'my_rounds_won', CASE WHEN (SELECT a_rodar FROM rot) THEN (SELECT count(*) FILTER (WHERE won) FROM mine) END,
    'my_rounds_played', CASE WHEN (SELECT a_rodar FROM rot) THEN (SELECT count(*) FROM mine) END,
    'best_partner', CASE WHEN (SELECT a_rodar FROM rot) THEN (SELECT friend_match_person_json(bp.pid, bp.pg) FROM bp) END);
$function$;
REVOKE ALL ON FUNCTION public.friend_match_me_json(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- ── 2c. A lista ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_my_friend_sessions()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'match_id', m.id, 'scheduled_date', m.scheduled_date, 'scheduled_time', m.scheduled_time,
           'location', m.location, 'court', m.court, 'is_creator', m.creator_id = auth.uid(),
           'org_name', (SELECT o.name FROM organizations o WHERE o.id = m.organization_id),
           'pairing_mode', m.pairing_mode,
           'people', (SELECT count(*) FROM private_match_invitees x WHERE x.match_id = m.id AND x.status <> 'declined'),
           'accepted', (SELECT count(*) FROM private_match_invitees x WHERE x.match_id = m.id AND x.status IN ('accepted', 'guest')),
           'pending', (SELECT count(*) FROM private_match_invitees x WHERE x.match_id = m.id AND x.status = 'pending'),
           'people_list', COALESCE((SELECT jsonb_agg(friend_match_person_json(x.user_id, x.guest_name)
                                                     || jsonb_build_object('invitee_id', x.id, 'status', x.status)
                                                     ORDER BY x.created_at)
                                      FROM private_match_invitees x WHERE x.match_id = m.id AND x.status <> 'declined'), '[]'::jsonb),
           'finished_at', m.finished_at,
           'ranking_state', friend_match_ranking_state(m.id),
           'waiting_for', friend_match_waiting_for(m.id),
           'pairs', friend_match_pairs_json(m.id),
           'games_counted', (SELECT count(DISTINCT gp.id) FROM private_matches gp JOIN private_match_stats gs ON gs.private_match_id = gp.id
                              WHERE gp.friend_pair_of = m.id),
           'live', EXISTS (SELECT 1 FROM private_matches g WHERE (g.id = m.id OR g.session_id = m.id)
                             AND g.started_at IS NOT NULL AND g.winner_team IS NULL),
           'rounds_count', (SELECT count(*) FROM private_matches g WHERE (g.id = m.id OR g.session_id = m.id)
                              AND g.score_a IS NOT NULL AND g.score_b IS NOT NULL AND g.winner_team IS NOT NULL),
           'first_result_at', (SELECT min(g.result_at) FROM private_matches g WHERE g.id = m.id OR g.session_id = m.id),
           'last_result_at', (SELECT max(g.result_at) FROM private_matches g WHERE g.id = m.id OR g.session_id = m.id))
           || COALESCE(friend_match_live_json(m.id, auth.uid()), jsonb_build_object('current_round', NULL, 'live_pair', NULL))
           || friend_match_me_json(m.id, auth.uid())
           ORDER BY m.scheduled_date DESC, m.scheduled_time DESC NULLS LAST), '[]'::jsonb)
    FROM private_matches m
   WHERE m.is_friend_session
     AND (m.creator_id = auth.uid()
          OR EXISTS (SELECT 1 FROM private_match_invitees i
                      WHERE i.match_id = m.id AND i.user_id = auth.uid() AND i.status = 'accepted'));
$function$;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_functiondef('public.list_my_friend_sessions()'::regprocedure) LIKE '%friend_match_me_json%';  -- true
--   SELECT pg_get_functiondef('public.friend_match_me_json(uuid,uuid)'::regprocedure) LIKE '%best_partner%';  -- true
--   SELECT has_function_privilege('authenticated', 'public.friend_match_me_json(uuid,uuid)', 'EXECUTE');  -- false
