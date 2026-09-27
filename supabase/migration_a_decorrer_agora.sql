-- ═════════════════════════════════════════════════════════════════════════
-- «A decorrer agora»: o que está a decorrer nos clubes e grupos
--
-- PORQUÊ. Aprovado pelo Francisco a 27 set («Sim» · «Constrói já»),
-- design-handoff/2026-09-27-a-decorrer-agora/SPEC.md: «cativa as pessoas
-- que não foram a um mix verem o que se está a passar». Ecrãs: Dev 2 (faixa
-- da Home e do clube, mix, jogos entre amigos) e Dev 1 (torneio); nomes
-- combinados com os dois a 27 set.
--
-- O QUE FAZ.
--   1. private_matches.show_live (jogo entre amigos: «Mostrar a decorrer a
--      toda a gente?», Não por omissão). create_friend_match ganha
--      p_show_live DEFAULT false e update_friend_match p_show_live DEFAULT
--      NULL (NULL = não muda) — mudam de assinatura: sai a antiga.
--   2. list_live_events(p_organization_id DEFAULT NULL) → jsonb (array).
--      Sem id: os clubes/grupos das minhas memberships (a Home). Com id: esse
--      clube/grupo, se eu for membro ou se for is_global.
--        · 'mix': games.status 'in_progress'; ronda, total de rondas (a conta
--          do mixLogic.totalRounds), jogadores, campos, e quem vai à frente.
--        · 'tournament': 'a_decorrer' (ou 'sorteado') com hoje entre o início
--          e o fim; a categoria do jogo acabado mais recente; fase, jogos a
--          decorrer agora, último resultado.
--        · 'friends': show_live, a sessão é de hoje, já começou e ainda tem
--          jogos por marcar.
--   3. PRIVACIDADE.
--        · Quem esconde os resultados (results_visibility 'friends' ou
--          'private', a regra do torneio): o nome NUNCA sai daqui — «Dupla N»
--          (mix), a_name null + a_hidden (torneio).
--        · Jogo entre amigos: só com show_live; nunca com «Jogador sem
--          nome»; e só se nenhum jogador com conta esconder os resultados
--          (assim nenhum nome escondido chega a quem não joga). Vê-o quem é
--          do grupo; sem grupo, quem segue (aceite) um dos jogadores, ou joga.
--   4. get_friend_match deixa LER (só ler) quem o pode ver na faixa
--      (friend_match_live_visible). left_name continua só para quem criou.
--
-- Dev 3, 27 set 2026 · depois de migration_amigos_sem_nome_e_sair.sql
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 0. Peças de que depende ─────────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.create_friend_match(date, time, text, double precision, double precision, boolean, text, integer, text, jsonb, text, uuid, smallint)') IS NULL
     AND to_regprocedure('public.create_friend_match(date, time, text, double precision, double precision, boolean, text, integer, text, jsonb, text, uuid, smallint, boolean)') IS NULL THEN
    RAISE EXCEPTION 'Falta create_friend_match com p_game_minutes. Parar e ler.';
  END IF;
  IF to_regprocedure('public.update_friend_match(uuid, date, time, text, double precision, double precision, text, smallint, text, smallint)') IS NULL
     AND to_regprocedure('public.update_friend_match(uuid, date, time, text, double precision, double precision, text, smallint, text, smallint, boolean)') IS NULL THEN
    RAISE EXCEPTION 'Falta a migration_amigos_editar_e_sets.sql. Parar e ler.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'private_match_invitees' AND column_name = 'is_anonymous') THEN
    RAISE EXCEPTION 'Falta a migration_amigos_sem_nome_e_sair.sql. Parar e ler.';
  END IF;
  IF to_regprocedure('public.tournament_entries_hiding_results(uuid, uuid)') IS NULL
     OR to_regprocedure('public.tournament_board_visible(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'Faltam tournament_entries_hiding_results / tournament_board_visible. Parar e ler.';
  END IF;
END $$;

-- ── 1. Mostrar a decorrer (jogo entre amigos) ───────────────────────────
ALTER TABLE private_matches ADD COLUMN IF NOT EXISTS show_live BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
DECLARE
  c_old CONSTANT TEXT := 'public.create_friend_match(date, time, text, double precision, double precision, boolean, text, integer, text, jsonb, text, uuid, smallint)';
  c_new CONSTANT TEXT := 'public.create_friend_match(date, time, text, double precision, double precision, boolean, text, integer, text, jsonb, text, uuid, smallint, boolean)';
  c_par_mau CONSTANT TEXT := '(p_game_minutes smallint DEFAULT NULL::smallint)\)';
  c_par_bom CONSTANT TEXT := '\1, p_show_live boolean DEFAULT false)';
  c_col_mau CONSTANT TEXT := 'teams_mode, court, organization_id, game_minutes\)';
  c_col_bom CONSTANT TEXT := 'teams_mode, court, organization_id, game_minutes, show_live)';
  c_val_mau CONSTANT TEXT := '(p_organization_id, p_game_minutes)\)';
  c_val_bom CONSTANT TEXT := '\1, COALESCE(p_show_live, FALSE))';
  v_def TEXT;
BEGIN
  IF to_regprocedure(c_new) IS NOT NULL THEN
    RAISE NOTICE 'create_friend_match: já estava';
    RETURN;
  END IF;
  v_def := pg_get_functiondef(c_old::regprocedure);
  IF (SELECT count(*) FROM regexp_matches(v_def, c_par_mau, 'g')) <> 1
     OR (SELECT count(*) FROM regexp_matches(v_def, c_col_mau, 'g')) <> 1
     OR (SELECT count(*) FROM regexp_matches(v_def, c_val_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'create_friend_match: um dos pedaços a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  v_def := regexp_replace(v_def, c_par_mau, c_par_bom);
  v_def := regexp_replace(v_def, c_col_mau, c_col_bom);
  v_def := regexp_replace(v_def, c_val_mau, c_val_bom);
  EXECUTE 'DROP FUNCTION ' || c_old;
  EXECUTE v_def;
END $$;
REVOKE ALL ON FUNCTION public.create_friend_match(date, time, text, double precision, double precision, boolean, text, integer, text, jsonb, text, uuid, smallint, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_friend_match(date, time, text, double precision, double precision, boolean, text, integer, text, jsonb, text, uuid, smallint, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_friend_match(date, time, text, double precision, double precision, boolean, text, integer, text, jsonb, text, uuid, smallint, boolean) TO authenticated;

DO $$
DECLARE
  c_old CONSTANT TEXT := 'public.update_friend_match(uuid, date, time, text, double precision, double precision, text, smallint, text, smallint)';
  c_new CONSTANT TEXT := 'public.update_friend_match(uuid, date, time, text, double precision, double precision, text, smallint, text, smallint, boolean)';
  c_par_mau CONSTANT TEXT := '(p_num_sets smallint)\)';
  c_par_bom CONSTANT TEXT := '\1, p_show_live boolean DEFAULT NULL::boolean)';
  c_upd_mau CONSTANT TEXT := '(UPDATE private_matches SET game_minutes = p_game_minutes)';
  c_upd_bom CONSTANT TEXT := 'UPDATE private_matches SET show_live = COALESCE(p_show_live, show_live) WHERE id = v_root.id;
  \1';
  v_def TEXT;
BEGIN
  IF to_regprocedure(c_new) IS NOT NULL THEN
    RAISE NOTICE 'update_friend_match: já estava';
    RETURN;
  END IF;
  v_def := pg_get_functiondef(c_old::regprocedure);
  IF (SELECT count(*) FROM regexp_matches(v_def, c_par_mau, 'g')) <> 1
     OR (SELECT count(*) FROM regexp_matches(v_def, c_upd_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'update_friend_match: um dos pedaços a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  v_def := regexp_replace(regexp_replace(v_def, c_par_mau, c_par_bom), c_upd_mau, c_upd_bom);
  EXECUTE 'DROP FUNCTION ' || c_old;
  EXECUTE v_def;
END $$;
REVOKE ALL ON FUNCTION public.update_friend_match(uuid, date, time, text, double precision, double precision, text, smallint, text, smallint, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_friend_match(uuid, date, time, text, double precision, double precision, text, smallint, text, smallint, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_friend_match(uuid, date, time, text, double precision, double precision, text, smallint, text, smallint, boolean) TO authenticated;

-- ── 2. Peças pequenas ───────────────────────────────────────────────────
-- «Rita Figueira» → «Rita F.» (o shortName do shareData.js).
CREATE OR REPLACE FUNCTION public.live_short_name(p_name TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN p_name IS NULL OR btrim(p_name) = '' THEN NULL
    WHEN array_length(regexp_split_to_array(btrim(p_name), '\s+'), 1) < 2 THEN btrim(p_name)
    WHEN substring(regexp_replace((regexp_split_to_array(btrim(p_name), '\s+'))[array_length(regexp_split_to_array(btrim(p_name), '\s+'), 1)],
                                  '[^[:alpha:]]', '', 'g') FROM 1 FOR 1) = ''
      THEN (regexp_split_to_array(btrim(p_name), '\s+'))[1]
    ELSE (regexp_split_to_array(btrim(p_name), '\s+'))[1] || ' ' ||
         upper(substring(regexp_replace((regexp_split_to_array(btrim(p_name), '\s+'))[array_length(regexp_split_to_array(btrim(p_name), '\s+'), 1)],
                                        '[^[:alpha:]]', '', 'g') FROM 1 FOR 1)) || '.'
  END;
$$;
REVOKE ALL ON FUNCTION public.live_short_name(TEXT) FROM PUBLIC, anon, authenticated;

-- Esconde os resultados? (a regra do torneio: não é «public»)
CREATE OR REPLACE FUNCTION public.live_hides_results(p_user UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT results_visibility IN ('friends', 'private') FROM profiles WHERE id = p_user), FALSE);
$$;
REVOKE ALL ON FUNCTION public.live_hides_results(UUID) FROM PUBLIC, anon, authenticated;

-- Quem pode ver um jogo entre amigos a decorrer (e lê-lo em get_friend_match).
CREATE OR REPLACE FUNCTION public.friend_match_live_visible(p_root UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT r.show_live
       AND auth.uid() IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM private_match_invitees a WHERE a.match_id = r.id AND a.is_anonymous)
       AND NOT EXISTS (SELECT 1 FROM private_match_invitees h
                        WHERE h.match_id = r.id AND h.status <> 'declined' AND h.user_id IS NOT NULL
                          AND live_hides_results(h.user_id))
       AND (EXISTS (SELECT 1 FROM private_match_invitees me WHERE me.match_id = r.id AND me.user_id = auth.uid())
            OR (r.organization_id IS NOT NULL
                AND EXISTS (SELECT 1 FROM memberships mb WHERE mb.organization_id = r.organization_id AND mb.user_id = auth.uid()))
            OR (r.organization_id IS NULL
                AND EXISTS (SELECT 1 FROM private_match_invitees i
                              JOIN follows f ON f.followed_id = i.user_id
                             WHERE i.match_id = r.id AND i.status <> 'declined'
                               AND f.follower_id = auth.uid() AND f.status = 'accepted')))
      FROM private_matches r
     WHERE r.id = p_root AND r.is_friend_session), FALSE);
$$;
REVOKE ALL ON FUNCTION public.friend_match_live_visible(UUID) FROM PUBLIC, anon, authenticated;

-- ── 3. O que está a decorrer ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_live_events(p_organization_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today DATE := (NOW() AT TIME ZONE 'Europe/Lisbon')::date;
  v_orgs  UUID[];
  v_out   JSONB := '[]'::jsonb;
  g       RECORD;
  t       RECORD;
  c       RECORD;
  lm      RECORD;
  r       RECORD;
  v_lead  JSONB;
  v_hide  UUID[];
BEGIN
  IF auth.uid() IS NULL THEN RETURN '[]'::jsonb; END IF;
  IF p_organization_id IS NULL THEN
    SELECT array_agg(organization_id) INTO v_orgs FROM memberships WHERE user_id = auth.uid();
  ELSIF EXISTS (SELECT 1 FROM memberships WHERE user_id = auth.uid() AND organization_id = p_organization_id)
        OR EXISTS (SELECT 1 FROM organizations WHERE id = p_organization_id AND is_global) THEN
    v_orgs := ARRAY[p_organization_id];
  END IF;
  v_orgs := COALESCE(v_orgs, '{}');

  -- ── Mixes ──
  FOR g IN SELECT gm.*, o.name AS org_name, o.kind AS org_kind
             FROM games gm JOIN organizations o ON o.id = gm.organization_id
            WHERE gm.organization_id = ANY (v_orgs) AND gm.status = 'in_progress'
            ORDER BY gm.date LOOP
    v_lead := NULL;
    IF g.format = 'americano' OR COALESCE(g.rotate_partners, FALSE) THEN
      -- Cada um por si: o jogador com mais pontos, depois mais vitórias.
      SELECT jsonb_build_object(
               'label', CASE WHEN live_hides_results(x.pid) THEN 'Jogador escondido' ELSE live_short_name(p.name) END,
               'wins', x.wins, 'anonymous', live_hides_results(x.pid), 'team_number', NULL)
        INTO v_lead
        FROM (SELECT s.pid, sum(s.pts) AS pts, count(*) FILTER (WHERE s.won) AS wins
                FROM (SELECT unnest(ARRAY[ta.player1_id, ta.player2_id]) AS pid, m.score_a AS pts, m.winner_team_id = m.team_a_id AS won
                        FROM matches m JOIN teams ta ON ta.id = m.team_a_id
                       WHERE m.game_id = g.id AND m.winner_team_id IS NOT NULL
                      UNION ALL
                      SELECT unnest(ARRAY[tb.player1_id, tb.player2_id]), m.score_b, m.winner_team_id = m.team_b_id
                        FROM matches m JOIN teams tb ON tb.id = m.team_b_id
                       WHERE m.game_id = g.id AND m.winner_team_id IS NOT NULL) s
               WHERE s.pid IS NOT NULL
               GROUP BY s.pid
               ORDER BY sum(s.pts) DESC, count(*) FILTER (WHERE s.won) DESC
               LIMIT 1) x
        JOIN profiles p ON p.id = x.pid;
    ELSE
      -- Duplas: no sobe e desce, quem ganhou o campo 1 na última ronda com
      -- resultado; nos outros, a ordem do standings() (vitórias, saldo, pontos).
      WITH tn AS (
        SELECT tm.*, row_number() OVER (ORDER BY tm.created_at, tm.id) AS n FROM teams tm WHERE tm.game_id = g.id
      ), st AS (
        SELECT tn.id, tn.n, tn.player1_id, tn.player2_id,
               count(m.id) FILTER (WHERE m.winner_team_id = tn.id) AS wins,
               COALESCE(sum(CASE WHEN m.team_a_id = tn.id THEN m.score_a - m.score_b ELSE m.score_b - m.score_a END), 0) AS diff,
               COALESCE(sum(CASE WHEN m.team_a_id = tn.id THEN m.score_a ELSE m.score_b END), 0) AS pts
          FROM tn
          LEFT JOIN matches m ON m.game_id = g.id AND m.winner_team_id IS NOT NULL AND m.phase = 'group'
                             AND tn.id IN (m.team_a_id, m.team_b_id)
         GROUP BY tn.id, tn.n, tn.player1_id, tn.player2_id
      ), pick AS (
        SELECT st.* FROM st
         WHERE g.format = 'sobe_desce'
           AND st.id = (SELECT m.winner_team_id FROM matches m
                         WHERE m.game_id = g.id AND m.court_number = 1 AND m.winner_team_id IS NOT NULL
                         ORDER BY m.round_number DESC LIMIT 1)
        UNION ALL
        SELECT * FROM (SELECT st.* FROM st WHERE g.format <> 'sobe_desce' AND st.wins > 0
                        ORDER BY st.wins DESC, st.diff DESC, st.pts DESC LIMIT 1) z
      )
      SELECT jsonb_build_object(
               'label', CASE WHEN live_hides_results(pk.player1_id) OR live_hides_results(pk.player2_id)
                             THEN 'Dupla ' || pk.n
                             ELSE concat_ws(' / ', live_short_name(p1.name), live_short_name(p2.name)) END,
               'wins', pk.wins,
               'anonymous', live_hides_results(pk.player1_id) OR live_hides_results(pk.player2_id),
               'team_number', pk.n)
        INTO v_lead
        FROM (SELECT * FROM pick LIMIT 1) pk
        LEFT JOIN profiles p1 ON p1.id = pk.player1_id
        LEFT JOIN profiles p2 ON p2.id = pk.player2_id;
    END IF;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'kind', 'mix', 'id', g.id, 'title', g.title,
      'organization_id', g.organization_id, 'org_name', g.org_name, 'org_kind', g.org_kind,
      'round_number', (SELECT max(round_number) FROM matches WHERE game_id = g.id),
      'rounds_total', GREATEST(1, floor(COALESCE(g.court_time_minutes, 90)::numeric / NULLIF(COALESCE(g.game_time_minutes, 20), 0))::int),
      'players_count', (SELECT count(*) + count(partner_id) FROM participants WHERE game_id = g.id AND status = 'confirmed'),
      'courts', g.num_courts,
      'leader', v_lead));
  END LOOP;

  -- ── Torneios ──
  FOR t IN SELECT tr.*, o.name AS org_name, o.kind AS org_kind
             FROM tournaments tr JOIN organizations o ON o.id = tr.organization_id
            WHERE tr.organization_id = ANY (v_orgs)
              AND tr.status IN ('a_decorrer', 'sorteado')
              AND v_today BETWEEN tr.starts_on AND tr.ends_on
            ORDER BY tr.starts_on LOOP
    -- A categoria do jogo acabado mais recente (senão, a primeira sorteada).
    SELECT cat.* INTO c FROM tournament_categories cat
     WHERE cat.tournament_id = t.id AND cat.status IN ('sorteada', 'a_decorrer', 'terminada')
     ORDER BY (SELECT max(m.ended_at) FROM tournament_matches m
                WHERE m.category_id = cat.id AND m.winner_entry_id IS NOT NULL) DESC NULLS LAST,
              cat.position, cat.code
     LIMIT 1;
    CONTINUE WHEN c.id IS NULL OR NOT tournament_board_visible(t.id, c.id);

    v_hide := tournament_entries_hiding_results(NULL, c.id);
    lm := NULL;
    SELECT m.* INTO lm FROM tournament_matches m
     WHERE m.category_id = c.id AND m.winner_entry_id IS NOT NULL
     ORDER BY m.ended_at DESC NULLS LAST, m.scheduled_at DESC NULLS LAST
     LIMIT 1;
    IF lm.id IS NULL THEN
      SELECT m.* INTO lm FROM tournament_matches m WHERE m.category_id = c.id
       ORDER BY m.scheduled_at NULLS LAST, m.bracket_slot LIMIT 1;
    END IF;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'kind', 'tournament', 'id', t.id, 'tournament_id', t.id, 'slug', t.slug, 'name', t.name, 'title', t.name,
      'organization_id', t.organization_id, 'org_name', t.org_name, 'org_kind', t.org_kind,
      'category_code', c.code,
      'stage', CASE WHEN lm.stage = 'grupo' THEN 'groups' WHEN lm.id IS NULL THEN NULL ELSE 'knockout' END,
      'round', CASE WHEN lm.stage = 'grupo' THEN NULL ELSE lm.round END,
      'matches_live', (SELECT count(*) FROM tournament_matches m
                        WHERE m.category_id = c.id AND m.winner_entry_id IS NULL
                          AND (m.status = 'a_decorrer'
                               OR (m.status = 'marcado' AND m.scheduled_at <= NOW()
                                   AND NOW() < m.scheduled_at + make_interval(mins => COALESCE(m.duration_max_min,
                                                  NULLIF(t.rules->>'duration_max', '')::int, 60))))),
      'last_result', CASE WHEN lm.id IS NULL OR lm.winner_entry_id IS NULL THEN NULL ELSE (
        SELECT jsonb_build_object(
          'a_name', CASE WHEN ea.id = ANY (v_hide) THEN NULL
                         ELSE COALESCE(NULLIF(btrim(ea.team_name), ''),
                                       concat_ws(' / ', live_short_name(COALESCE(pa1.name, ea.guest1_name)),
                                                        live_short_name(COALESCE(pa2.name, ea.guest_name)))) END,
          'b_name', CASE WHEN eb.id = ANY (v_hide) THEN NULL
                         ELSE COALESCE(NULLIF(btrim(eb.team_name), ''),
                                       concat_ws(' / ', live_short_name(COALESCE(pb1.name, eb.guest1_name)),
                                                        live_short_name(COALESCE(pb2.name, eb.guest_name)))) END,
          'a_hidden', ea.id = ANY (v_hide),
          'b_hidden', eb.id = ANY (v_hide),
          'a_won', lm.winner_entry_id = lm.entry_a_id,
          'score', CASE WHEN jsonb_typeof(lm.sets) = 'array' AND jsonb_array_length(lm.sets) > 1
                        THEN (SELECT string_agg((s->>'score_a') || '-' || (s->>'score_b'), ' · ' ORDER BY ord)
                                FROM jsonb_array_elements(lm.sets) WITH ORDINALITY AS x(s, ord))
                        WHEN lm.score_a IS NOT NULL THEN lm.score_a || '-' || lm.score_b END)
          FROM tournament_entries ea
          JOIN tournament_entries eb ON eb.id = lm.entry_b_id
          LEFT JOIN profiles pa1 ON pa1.id = ea.player1_id
          LEFT JOIN profiles pa2 ON pa2.id = ea.player2_id
          LEFT JOIN profiles pb1 ON pb1.id = eb.player1_id
          LEFT JOIN profiles pb2 ON pb2.id = eb.player2_id
         WHERE ea.id = lm.entry_a_id) END));
  END LOOP;

  -- ── Jogos entre amigos (só com show_live) ──
  FOR r IN SELECT pm.*, o.name AS org_name, o.kind AS org_kind, pc.name AS creator_name
             FROM private_matches pm
             LEFT JOIN organizations o ON o.id = pm.organization_id
             LEFT JOIN profiles pc ON pc.id = pm.creator_id
            WHERE pm.is_friend_session AND pm.show_live AND pm.teams_set_at IS NOT NULL
              AND pm.scheduled_date = v_today
              AND ((p_organization_id IS NOT NULL AND pm.organization_id = p_organization_id AND pm.organization_id = ANY (v_orgs))
                   OR (p_organization_id IS NULL AND (pm.organization_id = ANY (v_orgs) OR pm.organization_id IS NULL)))
              AND friend_match_live_visible(pm.id)
              -- já começou (cronómetro ou resultado) e ainda falta marcar algum jogo
              AND EXISTS (SELECT 1 FROM private_matches x
                           WHERE (x.id = pm.id OR x.session_id = pm.id)
                             AND (x.started_at IS NOT NULL OR x.winner_team IS NOT NULL))
              AND EXISTS (SELECT 1 FROM private_matches x
                           WHERE (x.id = pm.id OR x.session_id = pm.id) AND x.winner_team IS NULL)
            ORDER BY pm.scheduled_time NULLS LAST LOOP
    v_lead := NULL;
    WITH sides AS (
      -- cada jogo com resultado, uma linha por lado (identidade = conta ou nome)
      SELECT x.id AS gid,
             ARRAY[COALESCE(x.team_a_player1_id::text, ''), COALESCE(x.team_a_player2_id::text, 'g:' || lower(x.team_a_player2_guest_name))] AS ids,
             ARRAY[pa1.name, COALESCE(pa2.name, x.team_a_player2_guest_name)] AS names,
             x.winner_team = 'a' AS won, x.score_a - x.score_b AS diff
        FROM private_matches x
        LEFT JOIN profiles pa1 ON pa1.id = x.team_a_player1_id
        LEFT JOIN profiles pa2 ON pa2.id = x.team_a_player2_id
       WHERE (x.id = r.id OR x.session_id = r.id) AND x.winner_team IS NOT NULL
      UNION ALL
      SELECT x.id,
             ARRAY[COALESCE(x.team_b_player1_id::text, 'g:' || lower(x.team_b_player1_guest_name)),
                   COALESCE(x.team_b_player2_id::text, 'g:' || lower(x.team_b_player2_guest_name))],
             ARRAY[COALESCE(pb1.name, x.team_b_player1_guest_name), COALESCE(pb2.name, x.team_b_player2_guest_name)],
             x.winner_team = 'b', x.score_b - x.score_a
        FROM private_matches x
        LEFT JOIN profiles pb1 ON pb1.id = x.team_b_player1_id
        LEFT JOIN profiles pb2 ON pb2.id = x.team_b_player2_id
       WHERE (x.id = r.id OR x.session_id = r.id) AND x.winner_team IS NOT NULL
    ), units AS (
      -- duplas fixas: a dupla; a rodar: cada jogador
      SELECT CASE WHEN r.pairing_mode = 'fixed' THEN least(ids[1], ids[2]) || '|' || greatest(ids[1], ids[2]) ELSE u.id END AS k,
             CASE WHEN r.pairing_mode = 'fixed'
                  THEN concat_ws(' / ', live_short_name(names[1]), live_short_name(names[2]))
                  ELSE live_short_name(u.nm) END AS label,
             won, diff
        FROM sides
        LEFT JOIN LATERAL (SELECT ids[i] AS id, names[i] AS nm FROM generate_series(1, 2) i
                            WHERE r.pairing_mode IS DISTINCT FROM 'fixed') u ON TRUE
       WHERE r.pairing_mode = 'fixed' OR u.id IS NOT NULL
    )
    SELECT jsonb_build_object('label', min(label), 'wins', count(*) FILTER (WHERE won), 'anonymous', FALSE, 'team_number', NULL)
      INTO v_lead
      FROM units
     GROUP BY k
    HAVING count(*) FILTER (WHERE won) > 0
     ORDER BY count(*) FILTER (WHERE won) DESC, sum(diff) DESC
     LIMIT 1;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'kind', 'friends', 'id', r.id, 'title', NULL, 'creator_name', r.creator_name,
      'organization_id', r.organization_id, 'org_name', r.org_name, 'org_kind', r.org_kind,
      'game_number', (SELECT min(COALESCE(x.game_number, 1)) FROM private_matches x
                       WHERE (x.id = r.id OR x.session_id = r.id) AND x.winner_team IS NULL),
      'games_total', (SELECT count(*) FROM private_matches x WHERE x.id = r.id OR x.session_id = r.id),
      'players_count', (SELECT count(*) FROM private_match_invitees i
                         WHERE i.match_id = r.id AND i.status IN ('accepted', 'guest', 'pending')),
      'leader', v_lead));
  END LOOP;

  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.list_live_events(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_live_events(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_live_events(UUID) TO authenticated;

-- ── 4. Ler o jogo entre amigos a decorrer ───────────────────────────────
DO $$
DECLARE
  c_mau CONSTANT TEXT := '\)\s*THEN\s*RAISE EXCEPTION ''Não estás neste jogo''';
  c_bom CONSTANT TEXT := ') AND NOT friend_match_live_visible(v_root) THEN
    RAISE EXCEPTION ''Não estás neste jogo''';
  v_def TEXT := pg_get_functiondef('public.get_friend_match(uuid)'::regprocedure);
BEGIN
  IF v_def LIKE '%friend_match_live_visible%' THEN
    RAISE NOTICE 'get_friend_match: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'get_friend_match: a verificação de acesso não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE regexp_replace(v_def, c_mau, c_bom);
END $$;
REVOKE ALL ON FUNCTION public.get_friend_match(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_friend_match(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_friend_match(uuid) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT to_regprocedure('public.create_friend_match(date, time, text, double precision, double precision, boolean, text, integer, text, jsonb, text, uuid, smallint)') IS NULL;  -- true (saiu a antiga)
--   SELECT to_regprocedure('public.update_friend_match(uuid, date, time, text, double precision, double precision, text, smallint, text, smallint)') IS NULL;  -- true
--   SELECT has_function_privilege('anon', 'public.list_live_events(uuid)', 'EXECUTE');  -- false
--   SELECT jsonb_array_length(list_live_events());  -- corre sem erro (com sessão)
