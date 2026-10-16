-- ═════════════════════════════════════════════════════════════════════════
-- Perfil › Jogos com vida: a lista toda, a pesquisa, os meses e os filtros
--
-- PORQUÊ. SPEC design-handoff/2026-10-12-perfil-jogos-com-vida (Francisco,
-- 12 out: «Tá melhor no perfil»; plano okay a 12 out). Ecrã: Dev 4 (nomes
-- combinados com ele). Só leitura: nada muda no que se grava.
--
-- O QUE FAZ
--   1. played_event_rows(p_uid) (interna): todos os jogos de uma pessoa —
--      mixes ('mix'; 'open' nos jogos em aberto), torneios (uma linha por
--      categoria), jogos entre amigos ('friends': sessões com pelo menos uma
--      ronda dela com resultado, e jogos clássicos confirmados). Com o texto
--      para a pesquisa (nome do jogo, clube, sítio, categoria e os nomes de
--      quem jogou).
--   2. get_my_played_history(p_user_id, p_before, p_limit, p_kind, p_query,
--      p_month) → {rows, total}. Substitui a de 3 argumentos (#629; os
--      campos de antes ficam todos). Novos por linha:
--      · wins, games («3 de 4 vitórias»; nos amigos são rondas);
--      · partner_name («Tiago L.»; NULL quando os parceiros rodam);
--      · phase no torneio: 'campeoes' (1.º), 'final' (2.º), 'meias' (3.º/4.º);
--      · nos amigos: team_a, team_b (nomes curtos), score_a, score_b,
--        my_team ('a'|'b'), status ('pending' = falta enviar | 'sent'),
--        ranking_state ('counted'|'waiting'|'rejected'|'not_ranked'),
--        duration_minutes (do 1.º resultado ao «Terminar»; NULL se < 15 min,
--        > 4 h, ou se as rondas foram metidas todas de uma vez);
--      · achievements [{key, rarity}]: as conquistas dadas quando esse jogo
--        fechou (a app não guarda o jogo de cada conquista, só a hora; liga-se
--        pela hora, até 10 minutos depois; as de torneio só nos torneios,
--        as de kudos só nos mixes);
--      · kudos: os recebidos nesse mix (só os mixes têm kudos).
--      Filtros: p_kind ('mix'|'open'|'tournament'|'friends'), p_query
--      (pesquisa), p_month (qualquer dia do mês: só esse mês). p_before
--      pagina (ao descer).
--   3. get_my_played_months(p_user_id, p_kind, p_query) → [{month, games,
--      titles, points, kudos}], do mais recente para trás: o resumo do mês e
--      a folha «Ir para um mês».
--   4. get_my_played_kinds(p_user_id, p_query) → [{kind, count}]: só os tipos
--      que a pessoa jogou, para as pastilhas.
--   Os números são os do «Já jogados» (won, place, rating_delta). De outra
--   pessoa só com os resultados visíveis (results_visibility); senão vazio.
--
-- ORDEM. Depois de migration_lugares_e_historico.sql e de
-- migration_historico_local.sql.
--
-- Dev 3, 12 out 2026 · ecrã: Dev 4
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 0. Pode ver os jogos desta pessoa? ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.played_history_visible(p_uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT auth.uid() IS NOT NULL AND p_uid IS NOT NULL
     AND (p_uid = auth.uid() OR can_view_section(p_uid, (SELECT results_visibility FROM profiles WHERE id = p_uid)));
$function$;
REVOKE ALL ON FUNCTION public.played_history_visible(UUID) FROM PUBLIC, anon, authenticated;

-- ── 1. Todos os jogos de uma pessoa ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.played_event_rows(p_uid UUID)
RETURNS TABLE(kind TEXT, event_id UUID, session_id UUID, title TEXT, category_code TEXT, starts_at TIMESTAMPTZ,
              org_name TEXT, org_slug TEXT, format TEXT, location TEXT, won BOOLEAN, wins INTEGER, games INTEGER,
              rating_delta NUMERIC, kudos INTEGER, src TEXT, ref UUID, done_at TIMESTAMPTZ, search TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  -- Mixes (e jogos em aberto) acabados.
  SELECT CASE WHEN g.origin = 'open_slot' THEN 'open' ELSE 'mix' END, g.id, NULL::uuid, g.title, NULL::text, g.date,
         o.name, o.slug, g.format, NULL::text, COALESCE(s.mix_won, FALSE),
         COALESCE(s.matches_won, 0), COALESCE(s.matches_played, 0), s.rating_delta,
         (SELECT count(*)::int FROM mix_kudos k WHERE k.game_id = g.id AND k.recipient_id = p_uid),
         'mix', g.id, s.created_at,
         lower(concat_ws(' ', g.title, o.name,
               (SELECT string_agg(COALESCE(pp.name, gg.name), ' ')
                  FROM teams t
                  CROSS JOIN LATERAL (VALUES (t.player1_id, t.player1_guest_id), (t.player2_id, t.player2_guest_id)) AS x(uid, gid)
                  LEFT JOIN profiles pp ON pp.id = x.uid
                  LEFT JOIN game_guests gg ON gg.id = x.gid
                 WHERE t.game_id = g.id)))
    FROM mix_player_stats s
    JOIN games g ON g.id = s.game_id
    LEFT JOIN organizations o ON o.id = g.organization_id
   WHERE s.user_id = p_uid AND g.status IN ('finished', 'completed')
  UNION ALL
  -- Torneios: uma linha por categoria jogada.
  SELECT 'tournament', t.id, NULL, t.name, c.code,
         COALESCE(CASE WHEN c.day_date IS NOT NULL THEN (c.day_date + COALESCE(c.start_time, time '00:00')) AT TIME ZONE 'Europe/Lisbon' END,
                  t.starts_on::timestamp AT TIME ZONE 'Europe/Lisbon'),
         o.name, o.slug, NULL, t.location, COALESCE(s.final_position = 1, FALSE),
         COALESCE(s.matches_won, 0), COALESCE(s.matches_played, 0), s.rating_delta, 0,
         'tournament', s.category_id, s.created_at,
         lower(concat_ws(' ', t.name, c.code, c.name, o.name, t.location,
               (SELECT string_agg(concat_ws(' ', p1.name, e.guest1_name, p2.name, e.guest_name), ' ')
                  FROM tournament_entries e
                  LEFT JOIN profiles p1 ON p1.id = e.player1_id
                  LEFT JOIN profiles p2 ON p2.id = e.player2_id
                 WHERE e.category_id = c.id AND e.status IN ('validada', 'selecionada'))))
    FROM tournament_player_stats s
    JOIN tournament_categories c ON c.id = s.category_id
    JOIN tournaments t ON t.id = c.tournament_id
    LEFT JOIN organizations o ON o.id = t.organization_id
   WHERE s.user_id = p_uid AND t.status = 'terminado'
  UNION ALL
  -- Jogos entre amigos (sessões) em que a pessoa jogou uma ronda com resultado.
  SELECT 'friends', r.id, r.id, NULL, NULL, (r.scheduled_date + COALESCE(r.scheduled_time, time '00:00')) AT TIME ZONE 'Europe/Lisbon',
         o.name, o.slug, r.pairing_mode, r.location,
         COALESCE((friend_match_me_json(r.id, p_uid)->>'i_won')::boolean, FALSE),
         mr.won, mr.played,
         (SELECT sum(st.rating_delta) FROM private_match_stats st JOIN private_matches x ON x.id = st.private_match_id
           WHERE (x.id = r.id OR x.session_id = r.id OR x.friend_pair_of = r.id) AND st.user_id = p_uid),
         0, 'friends', r.id, r.finished_at,
         lower(concat_ws(' ', o.name, r.location,
               (SELECT string_agg(COALESCE(pp.name, i.guest_name), ' ')
                  FROM private_match_invitees i LEFT JOIN profiles pp ON pp.id = i.user_id
                 WHERE i.match_id = r.id AND i.status <> 'declined')))
    FROM private_matches r
    LEFT JOIN organizations o ON o.id = r.organization_id
    CROSS JOIN LATERAL (
      SELECT count(*) FILTER (WHERE x.winner_team = CASE WHEN p_uid IN (x.team_a_player1_id, x.team_a_player2_id) THEN 'a' ELSE 'b' END)::int AS won,
             count(*)::int AS played
        FROM private_matches x
       WHERE (x.id = r.id OR x.session_id = r.id) AND x.winner_team IS NOT NULL
         AND p_uid IN (x.team_a_player1_id, x.team_a_player2_id, x.team_b_player1_id, x.team_b_player2_id)) mr
   WHERE r.is_friend_session AND mr.played > 0
  UNION ALL
  -- Jogos entre amigos clássicos (um jogo só), confirmados.
  SELECT 'friends', pm.id, NULL, NULL, NULL,
         COALESCE(CASE WHEN pm.scheduled_date IS NOT NULL THEN (pm.scheduled_date + COALESCE(pm.scheduled_time, time '00:00')) AT TIME ZONE 'Europe/Lisbon' END, pm.played_at),
         o.name, o.slug, NULL, pm.location,
         COALESCE(pm.winner_team = CASE WHEN p_uid IN (pm.team_a_player1_id, pm.team_a_player2_id) THEN 'a' ELSE 'b' END, FALSE),
         CASE WHEN pm.winner_team = CASE WHEN p_uid IN (pm.team_a_player1_id, pm.team_a_player2_id) THEN 'a' ELSE 'b' END THEN 1 ELSE 0 END, 1,
         (SELECT st.rating_delta FROM private_match_stats st WHERE st.private_match_id = pm.id AND st.user_id = p_uid),
         0, 'classic', pm.id,
         COALESCE((SELECT min(st.created_at) FROM private_match_stats st WHERE st.private_match_id = pm.id), pm.confirmed_at),
         lower(concat_ws(' ', o.name, pm.location,
               (SELECT string_agg(pp.name, ' ') FROM profiles pp
                 WHERE pp.id IN (pm.team_a_player1_id, pm.team_a_player2_id, pm.team_b_player1_id, pm.team_b_player2_id)),
               pm.team_a_player2_guest_name, pm.team_b_player1_guest_name, pm.team_b_player2_guest_name))
    FROM private_matches pm
    LEFT JOIN organizations o ON o.id = pm.organization_id
   WHERE NOT COALESCE(pm.is_friend_session, FALSE) AND pm.session_id IS NULL AND pm.friend_pair_of IS NULL
     AND pm.status = 'confirmed'
     AND p_uid IN (pm.team_a_player1_id, pm.team_a_player2_id, pm.team_b_player1_id, pm.team_b_player2_id);
$function$;
REVOKE ALL ON FUNCTION public.played_event_rows(UUID) FROM PUBLIC, anon, authenticated;

-- ── 2. A lista ──────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_my_played_history(UUID, TIMESTAMPTZ, INTEGER);

CREATE OR REPLACE FUNCTION public.get_my_played_history(
  p_user_id UUID DEFAULT NULL, p_before TIMESTAMPTZ DEFAULT NULL, p_limit INTEGER DEFAULT 50,
  p_kind TEXT DEFAULT NULL, p_query TEXT DEFAULT NULL, p_month DATE DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid   UUID := COALESCE(p_user_id, auth.uid());
  v_q     TEXT := NULLIF(lower(btrim(COALESCE(p_query, ''))), '');
  v_from  TIMESTAMPTZ;
  v_to    TIMESTAMPTZ;
  v_rows  JSONB;
  v_total INTEGER;
BEGIN
  IF NOT played_history_visible(v_uid) THEN
    RETURN jsonb_build_object('rows', '[]'::jsonb, 'total', 0);
  END IF;
  IF p_month IS NOT NULL THEN
    v_from := date_trunc('month', p_month)::timestamp AT TIME ZONE 'Europe/Lisbon';
    v_to   := (date_trunc('month', p_month) + interval '1 month')::timestamp AT TIME ZONE 'Europe/Lisbon';
  END IF;

  WITH ev AS (
    SELECT * FROM played_event_rows(v_uid) e
     WHERE (p_kind IS NULL OR e.kind = p_kind)
       AND (v_q IS NULL OR e.search LIKE '%' || v_q || '%')
       AND (v_from IS NULL OR (e.starts_at >= v_from AND e.starts_at < v_to))
  ), pagina AS (
    SELECT * FROM ev WHERE p_before IS NULL OR ev.starts_at < p_before
     ORDER BY ev.starts_at DESC NULLS LAST, ev.event_id, ev.category_code
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 100))
  ), mais AS (
    SELECT p.*,
           -- O lugar (mix e torneio).
           (SELECT jsonb_build_object('place', f.place, 'total', f.total) FROM mix_final_places(p.ref) f
             WHERE p.src = 'mix' AND f.user_id = v_uid LIMIT 1) AS lugar_mix,
           (SELECT jsonb_build_object('place', s.final_position,
                                      'total', (SELECT count(*)::int FROM tournament_entries e WHERE e.category_id = p.ref AND e.status IN ('validada', 'selecionada')),
                                      'entry_id', s.entry_id)
              FROM tournament_player_stats s WHERE p.src = 'tournament' AND s.category_id = p.ref AND s.user_id = v_uid) AS lugar_torneio,
           -- O par em que joguei mais rondas (amigos, pares fixos).
           (SELECT to_jsonb(q) FROM friend_match_pair_rows(p.ref) q
             WHERE p.src = 'friends' AND COALESCE(p.format, 'fixed') <> 'rotating' AND v_uid IN (q.a1, q.a2, q.b1, q.b2)
             ORDER BY q.rounds_a + q.rounds_b DESC LIMIT 1) AS par,
           (SELECT to_jsonb(x) FROM private_matches x WHERE p.src IN ('friends', 'classic') AND x.id = p.ref) AS pm
      FROM pagina p
  )
  SELECT (SELECT count(*) FROM ev),
         COALESCE((SELECT jsonb_agg(jsonb_build_object(
           'kind', m.kind, 'event_id', m.event_id, 'session_id', m.session_id, 'title', m.title,
           'category_code', m.category_code, 'starts_at', m.starts_at, 'org_name', m.org_name, 'org_slug', m.org_slug,
           'format', m.format, 'location', m.location,
           'place', COALESCE((m.lugar_mix->>'place')::int, (m.lugar_torneio->>'place')::int),
           'total', COALESCE((m.lugar_mix->>'total')::int, (m.lugar_torneio->>'total')::int),
           'won', m.won, 'wins', m.wins, 'games', m.games,
           'rounds_won', CASE WHEN m.src = 'friends' THEN m.wins END,
           'rounds_played', CASE WHEN m.src = 'friends' THEN m.games END,
           'rating_delta', m.rating_delta, 'kudos', m.kudos,
           'phase', CASE WHEN m.src = 'tournament' THEN CASE (m.lugar_torneio->>'place')::int WHEN 1 THEN 'campeoes' WHEN 2 THEN 'final'
                                                                                              WHEN 3 THEN 'meias' WHEN 4 THEN 'meias' END END,
           'partner_name', CASE
             WHEN m.src = 'mix' AND m.format <> 'americano' THEN (
               SELECT live_short_name(COALESCE(pp.name, gg.name)) FROM teams t
                 LEFT JOIN profiles pp ON pp.id = CASE WHEN t.player1_id = v_uid THEN t.player2_id ELSE t.player1_id END
                 LEFT JOIN game_guests gg ON gg.id = CASE WHEN t.player1_id = v_uid THEN t.player2_guest_id ELSE t.player1_guest_id END
                WHERE t.game_id = m.ref AND v_uid IN (t.player1_id, t.player2_id)
                  AND (SELECT count(*) FROM teams t2 WHERE t2.game_id = m.ref AND v_uid IN (t2.player1_id, t2.player2_id)) = 1)
             WHEN m.src = 'tournament' THEN (
               SELECT live_short_name(CASE WHEN e.player1_id = v_uid THEN COALESCE(p2.name, e.guest_name) ELSE COALESCE(p1.name, e.guest1_name) END)
                 FROM tournament_entries e LEFT JOIN profiles p1 ON p1.id = e.player1_id LEFT JOIN profiles p2 ON p2.id = e.player2_id
                WHERE e.id = (m.lugar_torneio->>'entry_id')::uuid)
             WHEN m.src = 'friends' AND m.par IS NOT NULL THEN (
               SELECT live_short_name(COALESCE(pp.name, CASE WHEN v_uid::text = m.par->>'a1' THEN m.par->>'a2g' WHEN v_uid::text = m.par->>'a2' THEN m.par->>'a1g'
                                                            WHEN v_uid::text = m.par->>'b1' THEN m.par->>'b2g' ELSE m.par->>'b1g' END))
                 FROM (SELECT 1) one LEFT JOIN profiles pp ON pp.id = (CASE WHEN v_uid::text = m.par->>'a1' THEN m.par->>'a2' WHEN v_uid::text = m.par->>'a2' THEN m.par->>'a1'
                                                                           WHEN v_uid::text = m.par->>'b1' THEN m.par->>'b2' ELSE m.par->>'b1' END)::uuid)
             WHEN m.src = 'classic' THEN (
               SELECT live_short_name(COALESCE(pp.name, CASE WHEN v_uid::text = m.pm->>'team_a_player1_id' THEN m.pm->>'team_a_player2_guest_name'
                                                            WHEN v_uid::text = m.pm->>'team_b_player1_id' THEN m.pm->>'team_b_player2_guest_name' END))
                 FROM (SELECT 1) one LEFT JOIN profiles pp ON pp.id = (CASE WHEN v_uid::text = m.pm->>'team_a_player1_id' THEN m.pm->>'team_a_player2_id'
                                                                           WHEN v_uid::text = m.pm->>'team_a_player2_id' THEN m.pm->>'team_a_player1_id'
                                                                           WHEN v_uid::text = m.pm->>'team_b_player1_id' THEN m.pm->>'team_b_player2_id'
                                                                           ELSE m.pm->>'team_b_player1_id' END)::uuid)
           END,
           'team_a', CASE
             WHEN m.par IS NOT NULL THEN jsonb_build_array(
               (SELECT live_short_name(COALESCE((SELECT name FROM profiles WHERE id = (m.par->>'a1')::uuid), m.par->>'a1g'))),
               (SELECT live_short_name(COALESCE((SELECT name FROM profiles WHERE id = (m.par->>'a2')::uuid), m.par->>'a2g'))))
             WHEN m.src = 'classic' THEN jsonb_build_array(
               (SELECT live_short_name(name) FROM profiles WHERE id = (m.pm->>'team_a_player1_id')::uuid),
               (SELECT live_short_name(COALESCE((SELECT name FROM profiles WHERE id = (m.pm->>'team_a_player2_id')::uuid), m.pm->>'team_a_player2_guest_name')))) END,
           'team_b', CASE
             WHEN m.par IS NOT NULL THEN jsonb_build_array(
               (SELECT live_short_name(COALESCE((SELECT name FROM profiles WHERE id = (m.par->>'b1')::uuid), m.par->>'b1g'))),
               (SELECT live_short_name(COALESCE((SELECT name FROM profiles WHERE id = (m.par->>'b2')::uuid), m.par->>'b2g'))))
             WHEN m.src = 'classic' THEN jsonb_build_array(
               (SELECT live_short_name(COALESCE((SELECT name FROM profiles WHERE id = (m.pm->>'team_b_player1_id')::uuid), m.pm->>'team_b_player1_guest_name'))),
               (SELECT live_short_name(COALESCE((SELECT name FROM profiles WHERE id = (m.pm->>'team_b_player2_id')::uuid), m.pm->>'team_b_player2_guest_name')))) END,
           'score_a', CASE WHEN m.par IS NOT NULL THEN (m.par->>'rounds_a')::int WHEN m.src = 'classic' THEN (m.pm->>'score_a')::int END,
           'score_b', CASE WHEN m.par IS NOT NULL THEN (m.par->>'rounds_b')::int WHEN m.src = 'classic' THEN (m.pm->>'score_b')::int END,
           'my_team', CASE
             WHEN m.par IS NOT NULL THEN CASE WHEN v_uid::text IN (m.par->>'a1', m.par->>'a2') THEN 'a' ELSE 'b' END
             WHEN m.src = 'classic' THEN CASE WHEN v_uid::text IN (m.pm->>'team_a_player1_id', m.pm->>'team_a_player2_id') THEN 'a' ELSE 'b' END END,
           'status', CASE WHEN m.src = 'friends' THEN CASE WHEN m.pm->>'finished_at' IS NULL THEN 'pending' ELSE 'sent' END
                          WHEN m.src = 'classic' THEN 'sent' END,
           'ranking_state', CASE WHEN m.src = 'friends' THEN friend_match_ranking_state(m.ref)
                                 WHEN m.src = 'classic' THEN CASE WHEN m.rating_delta IS NOT NULL THEN 'counted' ELSE 'not_ranked' END END,
           'duration_minutes', CASE WHEN m.src = 'friends' THEN (
             SELECT CASE WHEN d.mins < 15 OR d.mins > 240 OR (d.n > 1 AND d.spread < interval '2 minutes') THEN NULL ELSE d.mins END
               FROM (SELECT round(extract(epoch FROM (m.pm->>'finished_at')::timestamptz - min(x.result_at)) / 60)::int AS mins,
                            max(x.result_at) - min(x.result_at) AS spread, count(x.result_at) AS n
                       FROM private_matches x WHERE (x.id = m.ref OR x.session_id = m.ref) AND x.result_at IS NOT NULL) d
              WHERE d.n > 0 AND m.pm->>'finished_at' IS NOT NULL) END,
           'achievements', COALESCE((
             SELECT jsonb_agg(jsonb_build_object('key', pa.achievement_key, 'rarity', a.rarity) ORDER BY a.sort, pa.awarded_at)
               FROM player_achievements pa LEFT JOIN achievements a ON a.key = pa.achievement_key
              WHERE pa.user_id = v_uid AND m.done_at IS NOT NULL
                AND pa.awarded_at >= m.done_at - interval '1 minute' AND pa.awarded_at < m.done_at + interval '10 minutes'
                -- As de torneio só no torneio, as de kudos só no mix, as de aulas em nenhum.
                AND (a.category IS DISTINCT FROM 'torneio' OR m.src = 'tournament')
                AND (a.category IS DISTINCT FROM 'kudos' OR m.src = 'mix')
                AND a.category IS DISTINCT FROM 'aulas'), '[]'::jsonb))
           ORDER BY m.starts_at DESC NULLS LAST, m.event_id, m.category_code)
           FROM mais m), '[]'::jsonb)
    INTO v_total, v_rows;

  RETURN jsonb_build_object('rows', v_rows, 'total', v_total);
END;
$function$;
REVOKE ALL ON FUNCTION public.get_my_played_history(UUID, TIMESTAMPTZ, INTEGER, TEXT, TEXT, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_played_history(UUID, TIMESTAMPTZ, INTEGER, TEXT, TEXT, DATE) TO authenticated;

-- ── 3. Os meses ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_played_months(p_user_id UUID DEFAULT NULL, p_kind TEXT DEFAULT NULL, p_query TEXT DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT CASE WHEN NOT played_history_visible(COALESCE(p_user_id, auth.uid())) THEN '[]'::jsonb ELSE COALESCE((
    SELECT jsonb_agg(jsonb_build_object('month', z.month, 'games', z.games, 'titles', z.titles,
                                        'points', z.points, 'kudos', z.kudos) ORDER BY z.month DESC)
      FROM (
        SELECT date_trunc('month', e.starts_at AT TIME ZONE 'Europe/Lisbon')::date AS month,
               count(*)::int AS games,
               count(*) FILTER (WHERE e.won AND e.kind IN ('mix', 'open', 'tournament'))::int AS titles,
               round(COALESCE(sum(e.rating_delta), 0))::int AS points,
               COALESCE(sum(e.kudos), 0)::int AS kudos
          FROM played_event_rows(COALESCE(p_user_id, auth.uid())) e
         WHERE e.starts_at IS NOT NULL
           AND (p_kind IS NULL OR e.kind = p_kind)
           AND (NULLIF(lower(btrim(COALESCE(p_query, ''))), '') IS NULL OR e.search LIKE '%' || lower(btrim(p_query)) || '%')
         GROUP BY 1) z), '[]'::jsonb) END;
$function$;
REVOKE ALL ON FUNCTION public.get_my_played_months(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_played_months(UUID, TEXT, TEXT) TO authenticated;

-- ── 4. Os tipos ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_played_kinds(p_user_id UUID DEFAULT NULL, p_query TEXT DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT CASE WHEN NOT played_history_visible(COALESCE(p_user_id, auth.uid())) THEN '[]'::jsonb ELSE COALESCE((
    SELECT jsonb_agg(jsonb_build_object('kind', z.kind, 'count', z.n)
                     ORDER BY array_position(ARRAY['mix', 'tournament', 'friends', 'open'], z.kind))
      FROM (
        SELECT e.kind, count(*)::int AS n
          FROM played_event_rows(COALESCE(p_user_id, auth.uid())) e
         WHERE NULLIF(lower(btrim(COALESCE(p_query, ''))), '') IS NULL OR e.search LIKE '%' || lower(btrim(p_query)) || '%'
         GROUP BY e.kind) z), '[]'::jsonb) END;
$function$;
REVOKE ALL ON FUNCTION public.get_my_played_kinds(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_played_kinds(UUID, TEXT) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT count(*) FROM pg_proc WHERE proname = 'get_my_played_history';  -- 1 (só a de 6 argumentos)
--   SELECT has_function_privilege('authenticated', 'public.played_event_rows(uuid)', 'EXECUTE');  -- false
--   SELECT has_function_privilege('anon', 'public.get_my_played_months(uuid,text,text)', 'EXECUTE');  -- false
