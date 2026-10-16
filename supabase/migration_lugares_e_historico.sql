-- ═════════════════════════════════════════════════════════════════════════
-- Perfil › Jogos: o lugar certo em cada mix, a lista única e os títulos
--
-- PORQUÊ. QA (via PO, 12 out): no Perfil › Jogos os lugares estavam errados
-- («Viva 2.º de 6» para quem ficou em 4.º; «1.º de 6» num americano de 4).
-- O Profile.jsx somava os points_earned das duplas: os convidados contavam
-- 0, não seguia o sobe e desce e, no americano, contava as duplas que
-- rodam. Os torneios nem apareciam, e um torneio ganho dava 0 títulos.
-- Plano aprovado pelo Francisco a 12 out. Ecrã: Dev 4.
--
-- O QUE FAZ
--   1. mix_final_places(p_game_id) (interna): o lugar de cada pessoa
--      (com conta ou convidado) num mix, com as regras do fim do mix:
--      · americano: cada pessoa por pontos, depois pela diferença (a regra
--        do «ganhou o mix» e do voucher); total = pessoas;
--      · sobe e desce: a última ronda com os resultados todos — campo 1 à
--        frente, em cada campo quem ganhou antes de quem perdeu;
--      · com final: final → 1.º e 2.º, jogo do 3.º lugar → 3.º e 4.º (sem
--        ele, os vencidos das meias partilham o 3.º), campos de
--        classificação c → 2c−1 e 2c;
--      · quem não ficou arrumado por isso (ou sem final): vitórias, depois
--        diferença, depois pontos marcados; iguais partilham o lugar;
--      · a dupla vencedora escolhida no fim do mix é sempre o 1.º.
--      Nos formatos de duplas o total são as duplas (pessoas ÷ 2); com
--      parceiros a rodar, cada pessoa fica com o melhor lugar que teve.
--   2. get_my_played_history(p_user_id, p_before, p_limit) → {rows, total}:
--      mixes ('mix'; 'open' nos jogos em aberto), torneios (uma linha por
--      categoria), jogos entre amigos ('friends': sessões com resultados e
--      jogos clássicos confirmados). Por linha: kind, event_id,
--      session_id, title, category_code, starts_at, org_name, org_slug,
--      format, place, total, won, rounds_won, rounds_played, rating_delta.
--      won bate com o i_won do «Já jogados» (mix_won; torneio: 1.º lugar;
--      amigos: friend_match_me_json). Os amigos não têm lugar.
--      De outra pessoa só com os resultados visíveis (can_view_section,
--      results_visibility, como no get_player_profile); senão vem vazio.
--   3. get_player_titles(p_user_id) → {mixes, tournaments, total}: mixes
--      ganhos + torneios ganhos (1.º lugar). Os amigos não contam. NULL se
--      os resultados não forem visíveis.
--
-- ORDEM. Depois de migration_amigos_lista_com_vida.sql (usa o
-- friend_match_me_json).
--
-- Dev 3, 12 out 2026 · ecrã: Dev 4
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. O lugar de cada pessoa num mix ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.mix_final_places(p_game_id UUID)
RETURNS TABLE(who UUID, user_id UUID, place INTEGER, total INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH g AS (
    SELECT id, format, winner_team_id FROM games WHERE id = p_game_id
  ), m AS (
    SELECT * FROM matches
     WHERE game_id = p_game_id AND score_a IS NOT NULL AND score_b IS NOT NULL
  ),
  -- ── Americano: cada pessoa ──
  am_pp AS (
    SELECT COALESCE(ta.player1_id, ta.player1_guest_id) AS who, ta.player1_id AS uid, m.score_a AS f, m.score_b AS c FROM m JOIN teams ta ON ta.id = m.team_a_id
    UNION ALL SELECT COALESCE(ta.player2_id, ta.player2_guest_id), ta.player2_id, m.score_a, m.score_b FROM m JOIN teams ta ON ta.id = m.team_a_id
    UNION ALL SELECT COALESCE(tb.player1_id, tb.player1_guest_id), tb.player1_id, m.score_b, m.score_a FROM m JOIN teams tb ON tb.id = m.team_b_id
    UNION ALL SELECT COALESCE(tb.player2_id, tb.player2_guest_id), tb.player2_id, m.score_b, m.score_a FROM m JOIN teams tb ON tb.id = m.team_b_id
  ), am AS (
    SELECT a.who, max(a.uid::text)::uuid AS uid, sum(a.f) AS pontos, sum(a.f) - sum(a.c) AS diferenca
      FROM am_pp a WHERE a.who IS NOT NULL GROUP BY a.who
  ), am_out AS (
    SELECT am.who, am.uid,
           (RANK() OVER (ORDER BY am.pontos DESC, am.diferenca DESC))::int AS place,
           (SELECT count(*) FROM am)::int AS total
      FROM am
  ),
  -- ── Duplas ──
  tm AS (
    SELECT DISTINCT x.team_id FROM matches mm
     CROSS JOIN LATERAL (VALUES (mm.team_a_id), (mm.team_b_id)) AS x(team_id)
     WHERE mm.game_id = p_game_id AND x.team_id IS NOT NULL
  ), st AS (
    -- Vitórias, diferença e pontos (fase de grupos; no sobe e desce, tudo).
    SELECT tm.team_id,
           count(*) FILTER (WHERE m.winner_team_id = tm.team_id) AS wins,
           COALESCE(sum(CASE WHEN m.team_a_id = tm.team_id THEN m.score_a - m.score_b ELSE m.score_b - m.score_a END), 0) AS diff,
           COALESCE(sum(CASE WHEN m.team_a_id = tm.team_id THEN m.score_a ELSE m.score_b END), 0) AS scored
      FROM tm
      LEFT JOIN m ON tm.team_id IN (m.team_a_id, m.team_b_id)
                 AND ((SELECT format FROM g) = 'sobe_desce' OR m.phase IS NULL OR m.phase = 'group')
     GROUP BY tm.team_id
  ), lr AS (
    -- Sobe e desce: a última ronda com os resultados todos.
    SELECT max(r.round_number) AS r FROM (
      SELECT mm.round_number FROM matches mm WHERE mm.game_id = p_game_id
       GROUP BY mm.round_number HAVING bool_and(mm.score_a IS NOT NULL AND mm.score_b IS NOT NULL)) r
  ), sd AS (
    SELECT y.team_id, (ROW_NUMBER() OVER (ORDER BY y.court, y.k))::int AS place
      FROM (
        SELECT mm.court_number AS court, 1 AS k, CASE WHEN mm.winner_team_id = mm.team_b_id THEN mm.team_b_id ELSE mm.team_a_id END AS team_id
          FROM matches mm WHERE mm.game_id = p_game_id AND mm.round_number = (SELECT r FROM lr)
        UNION ALL
        SELECT mm.court_number, 2, CASE WHEN mm.winner_team_id = mm.team_b_id THEN mm.team_a_id ELSE mm.team_b_id END
          FROM matches mm WHERE mm.game_id = p_game_id AND mm.round_number = (SELECT r FROM lr)
      ) y
     WHERE (SELECT format FROM g) = 'sobe_desce'
  ), ko AS (
    -- Com final: os jogos que decidem lugares.
    SELECT mm.winner_team_id AS team_id, 1 AS place FROM m mm WHERE mm.phase = 'final' AND mm.winner_team_id IS NOT NULL
    UNION ALL SELECT CASE WHEN mm.winner_team_id = mm.team_a_id THEN mm.team_b_id ELSE mm.team_a_id END, 2 FROM m mm WHERE mm.phase = 'final' AND mm.winner_team_id IS NOT NULL
    UNION ALL SELECT mm.winner_team_id, 3 FROM m mm WHERE mm.phase = 'third' AND mm.winner_team_id IS NOT NULL
    UNION ALL SELECT CASE WHEN mm.winner_team_id = mm.team_a_id THEN mm.team_b_id ELSE mm.team_a_id END, 4 FROM m mm WHERE mm.phase = 'third' AND mm.winner_team_id IS NOT NULL
    UNION ALL SELECT mm.winner_team_id, 2 * mm.court_number - 1 FROM m mm WHERE mm.phase = 'placement' AND mm.winner_team_id IS NOT NULL
    UNION ALL SELECT CASE WHEN mm.winner_team_id = mm.team_a_id THEN mm.team_b_id ELSE mm.team_a_id END, 2 * mm.court_number FROM m mm WHERE mm.phase = 'placement' AND mm.winner_team_id IS NOT NULL
    -- Sem jogo do 3.º lugar, os vencidos das meias partilham o 3.º.
    UNION ALL SELECT CASE WHEN mm.winner_team_id = mm.team_a_id THEN mm.team_b_id ELSE mm.team_a_id END, 3 FROM m mm
     WHERE mm.phase = 'semi' AND mm.winner_team_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM m f WHERE f.phase = 'final' AND f.winner_team_id IS NOT NULL)
       AND NOT EXISTS (SELECT 1 FROM m t WHERE t.phase = 'third' AND t.winner_team_id IS NOT NULL)
  ), assigned AS (
    SELECT team_id, place FROM sd
    UNION ALL
    SELECT team_id, min(place) FROM ko WHERE (SELECT format FROM g) <> 'sobe_desce' GROUP BY team_id
  ), rest AS (
    SELECT st.team_id,
           ((SELECT count(*) FROM assigned) + RANK() OVER (ORDER BY st.wins DESC, st.diff DESC, st.scored DESC))::int AS place
      FROM st WHERE st.team_id NOT IN (SELECT team_id FROM assigned)
  ), allp AS (
    SELECT * FROM assigned UNION ALL SELECT * FROM rest
  ), fin AS (
    -- A dupla vencedora escolhida no fim do mix é sempre o 1.º.
    SELECT a.team_id,
           (RANK() OVER (ORDER BY (a.team_id = (SELECT winner_team_id FROM g)) IS TRUE DESC, a.place))::int AS place
      FROM allp a
  ), team_pp AS (
    SELECT COALESCE(t.player1_id, t.player1_guest_id) AS who, t.player1_id AS uid, f.place FROM fin f JOIN teams t ON t.id = f.team_id
    UNION ALL SELECT COALESCE(t.player2_id, t.player2_guest_id), t.player2_id, f.place FROM fin f JOIN teams t ON t.id = f.team_id
  ), team_out AS (
    -- Com parceiros a rodar a mesma pessoa está em várias duplas: o melhor lugar.
    SELECT DISTINCT ON (tp.who) tp.who, tp.uid, tp.place,
           ceil((SELECT count(DISTINCT x.who) FROM team_pp x WHERE x.who IS NOT NULL) / 2.0)::int AS total
      FROM team_pp tp WHERE tp.who IS NOT NULL
     ORDER BY tp.who, tp.place
  )
  SELECT a.who, a.uid, a.place, a.total FROM am_out a WHERE (SELECT format FROM g) = 'americano'
  UNION ALL
  SELECT t.who, t.uid, t.place, t.total FROM team_out t WHERE (SELECT format FROM g) IS DISTINCT FROM 'americano';
$function$;
REVOKE ALL ON FUNCTION public.mix_final_places(UUID) FROM PUBLIC, anon, authenticated;

-- ── 2. A lista dos jogos de uma pessoa ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_played_history(p_user_id UUID DEFAULT NULL, p_before TIMESTAMPTZ DEFAULT NULL, p_limit INTEGER DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid   UUID := COALESCE(p_user_id, auth.uid());
  v_rows  JSONB;
  v_total INTEGER;
BEGIN
  IF auth.uid() IS NULL OR v_uid IS NULL THEN
    RETURN jsonb_build_object('rows', '[]'::jsonb, 'total', 0);
  END IF;
  -- De outra pessoa, só com os resultados visíveis (como no perfil).
  IF v_uid <> auth.uid()
     AND NOT can_view_section(v_uid, (SELECT results_visibility FROM profiles WHERE id = v_uid)) THEN
    RETURN jsonb_build_object('rows', '[]'::jsonb, 'total', 0);
  END IF;

  WITH ev AS (
    -- Mixes (e jogos em aberto) acabados.
    SELECT CASE WHEN g.origin = 'open_slot' THEN 'open' ELSE 'mix' END AS kind,
           g.id AS event_id, NULL::uuid AS session_id, g.title, NULL::text AS category_code, g.date AS starts_at,
           o.name AS org_name, o.slug AS org_slug, g.format,
           s.mix_won AS won, NULL::int AS rounds_won, NULL::int AS rounds_played, s.rating_delta,
           'mix'::text AS src, g.id AS ref
      FROM mix_player_stats s
      JOIN games g ON g.id = s.game_id
      LEFT JOIN organizations o ON o.id = g.organization_id
     WHERE s.user_id = v_uid AND g.status IN ('finished', 'completed')
    UNION ALL
    -- Torneios: uma linha por categoria jogada.
    SELECT 'tournament', t.id, NULL, t.name, c.code,
           COALESCE(CASE WHEN c.day_date IS NOT NULL THEN (c.day_date + COALESCE(c.start_time, time '00:00')) AT TIME ZONE 'Europe/Lisbon' END,
                    t.starts_on::timestamp AT TIME ZONE 'Europe/Lisbon'),
           o.name, o.slug, NULL,
           s.final_position = 1, NULL, NULL, s.rating_delta,
           'tournament', s.category_id
      FROM tournament_player_stats s
      JOIN tournament_categories c ON c.id = s.category_id
      JOIN tournaments t ON t.id = c.tournament_id
      LEFT JOIN organizations o ON o.id = t.organization_id
     WHERE s.user_id = v_uid AND t.status = 'terminado'
    UNION ALL
    -- Jogos entre amigos (sessões) em que a pessoa jogou uma ronda com resultado.
    SELECT 'friends', r.id, r.id, NULL, NULL,
           (r.scheduled_date + COALESCE(r.scheduled_time, time '00:00')) AT TIME ZONE 'Europe/Lisbon',
           o.name, o.slug, r.pairing_mode,
           (friend_match_me_json(r.id, v_uid)->>'i_won')::boolean,
           (SELECT count(*) FILTER (WHERE x.winner_team = CASE WHEN v_uid IN (x.team_a_player1_id, x.team_a_player2_id) THEN 'a' ELSE 'b' END)::int
              FROM private_matches x WHERE (x.id = r.id OR x.session_id = r.id) AND x.winner_team IS NOT NULL
               AND v_uid IN (x.team_a_player1_id, x.team_a_player2_id, x.team_b_player1_id, x.team_b_player2_id)),
           (SELECT count(*)::int
              FROM private_matches x WHERE (x.id = r.id OR x.session_id = r.id) AND x.winner_team IS NOT NULL
               AND v_uid IN (x.team_a_player1_id, x.team_a_player2_id, x.team_b_player1_id, x.team_b_player2_id)),
           (SELECT sum(st.rating_delta) FROM private_match_stats st JOIN private_matches x ON x.id = st.private_match_id
             WHERE (x.id = r.id OR x.session_id = r.id OR x.friend_pair_of = r.id) AND st.user_id = v_uid),
           'friends', r.id
      FROM private_matches r
      LEFT JOIN organizations o ON o.id = r.organization_id
     WHERE r.is_friend_session
       AND EXISTS (SELECT 1 FROM private_matches x WHERE (x.id = r.id OR x.session_id = r.id) AND x.winner_team IS NOT NULL
                      AND v_uid IN (x.team_a_player1_id, x.team_a_player2_id, x.team_b_player1_id, x.team_b_player2_id))
    UNION ALL
    -- Jogos entre amigos clássicos (um jogo só), confirmados.
    SELECT 'friends', pm.id, NULL, NULL, NULL,
           COALESCE(CASE WHEN pm.scheduled_date IS NOT NULL THEN (pm.scheduled_date + COALESCE(pm.scheduled_time, time '00:00')) AT TIME ZONE 'Europe/Lisbon' END, pm.played_at),
           o.name, o.slug, NULL,
           pm.winner_team = CASE WHEN v_uid IN (pm.team_a_player1_id, pm.team_a_player2_id) THEN 'a' ELSE 'b' END,
           NULL, NULL,
           (SELECT st.rating_delta FROM private_match_stats st WHERE st.private_match_id = pm.id AND st.user_id = v_uid),
           'classic', pm.id
      FROM private_matches pm
      LEFT JOIN organizations o ON o.id = pm.organization_id
     WHERE NOT COALESCE(pm.is_friend_session, FALSE) AND pm.session_id IS NULL AND pm.friend_pair_of IS NULL
       AND pm.status = 'confirmed'
       AND v_uid IN (pm.team_a_player1_id, pm.team_a_player2_id, pm.team_b_player1_id, pm.team_b_player2_id)
  ), pagina AS (
    SELECT * FROM ev WHERE p_before IS NULL OR ev.starts_at < p_before
     ORDER BY ev.starts_at DESC NULLS LAST, ev.event_id
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 100))
  )
  SELECT (SELECT count(*) FROM ev),
         COALESCE((SELECT jsonb_agg(jsonb_build_object(
                     'kind', p.kind, 'event_id', p.event_id, 'session_id', p.session_id, 'title', p.title,
                     'category_code', p.category_code, 'starts_at', p.starts_at, 'org_name', p.org_name, 'org_slug', p.org_slug,
                     'format', p.format, 'place', lg.place, 'total', lg.total, 'won', COALESCE(p.won, FALSE),
                     'rounds_won', p.rounds_won, 'rounds_played', p.rounds_played, 'rating_delta', p.rating_delta)
                     ORDER BY p.starts_at DESC NULLS LAST, p.event_id)
                     FROM pagina p
                     LEFT JOIN LATERAL (
                       SELECT f.place, f.total FROM mix_final_places(p.ref) f
                        WHERE p.src = 'mix' AND f.user_id = v_uid
                       UNION ALL
                       SELECT s.final_position,
                              (SELECT count(*)::int FROM tournament_entries e WHERE e.category_id = p.ref AND e.status IN ('validada', 'selecionada'))
                         FROM tournament_player_stats s
                        WHERE p.src = 'tournament' AND s.category_id = p.ref AND s.user_id = v_uid
                       LIMIT 1) lg ON TRUE), '[]'::jsonb)
    INTO v_total, v_rows;

  RETURN jsonb_build_object('rows', v_rows, 'total', v_total);
END;
$function$;
REVOKE ALL ON FUNCTION public.get_my_played_history(UUID, TIMESTAMPTZ, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_played_history(UUID, TIMESTAMPTZ, INTEGER) TO authenticated;

-- ── 3. Os títulos ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_player_titles(p_user_id UUID DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH u AS (SELECT COALESCE(p_user_id, auth.uid()) AS id), c AS (
    SELECT (SELECT count(*) FROM mix_player_stats s JOIN games g ON g.id = s.game_id
             WHERE s.user_id = (SELECT id FROM u) AND s.mix_won AND g.status IN ('finished', 'completed'))::int AS mixes,
           (SELECT count(*) FROM tournament_player_stats s JOIN tournament_categories tc ON tc.id = s.category_id
              JOIN tournaments t ON t.id = tc.tournament_id
             WHERE s.user_id = (SELECT id FROM u) AND s.final_position = 1 AND t.status = 'terminado')::int AS tournaments
  )
  SELECT CASE WHEN auth.uid() IS NULL THEN NULL
              WHEN (SELECT id FROM u) <> auth.uid()
                   AND NOT can_view_section((SELECT id FROM u), (SELECT results_visibility FROM profiles WHERE id = (SELECT id FROM u))) THEN NULL
              ELSE jsonb_build_object('mixes', c.mixes, 'tournaments', c.tournaments, 'total', c.mixes + c.tournaments) END
    FROM c;
$function$;
REVOKE ALL ON FUNCTION public.get_player_titles(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_player_titles(UUID) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT has_function_privilege('authenticated', 'public.mix_final_places(uuid)', 'EXECUTE');  -- false
--   SELECT has_function_privilege('anon', 'public.get_my_played_history(uuid,timestamptz,integer)', 'EXECUTE');  -- false
--   SELECT has_function_privilege('authenticated', 'public.get_player_titles(uuid)', 'EXECUTE');  -- true
