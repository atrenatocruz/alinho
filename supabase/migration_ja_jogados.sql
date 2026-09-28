-- ═════════════════════════════════════════════════════════════════════════
-- «Já jogados» e os jogos entre amigos do grupo à vista dos membros
--
-- PORQUÊ. Aprovado pelo Francisco:
--   · design-handoff/2026-09-27-jogos-jogados-do-clube/SPEC.md («Já jogados»
--     na Home e na página do clube/grupo), com a atualização de 28 set;
--   · design-handoff/2026-09-27-historico-no-gerir/SPEC.md, «Quem vê os jogos
--     entre amigos de um grupo» (28 set): «Toda a gente que está no grupo pode
--     ver. E se o grupo for público também… Elas podem esconder o perfil».
-- Ecrãs: Dev 2 (nomes combinados com ele).
--
-- PRIVACIDADE. Quem esconde os resultados (results_visibility 'friends' ou
-- 'private' — a regra do torneio) nunca sai daqui com nome, conta, nível ou
-- pontos a quem não jogou: vem hidden = true e o ecrã escreve «Dupla N». Os
-- jogos entre amigos SEM grupo continuam só para quem jogou.
--
-- O QUE FAZ.
--   1. friend_match_group_visible(p_root): a sessão é de um grupo, já tem
--      resultados, e eu sou membro do grupo ou o grupo é público (is_global).
--   2. NOVA get_friend_match_readonly(p_match_id): o mesmo que o
--      get_friend_match, só de leitura, para quem não joga — sem left_name,
--      emails, nível nem género, e com quem esconde os resultados escondido.
--      Por dentro chama o get_friend_match com uma marca desta transação
--      (alinho.fm_readonly = a sessão); o get_friend_match só a aceita para
--      essa sessão (troca 1 fragmento no corpo vivo).
--   3. NOVA list_played_events(p_organization_id, p_before, p_limit) →
--      { rows, total }: mixes e torneios acabados, e sessões entre amigos de
--      grupo com resultados, dos meus clubes/grupos (ou do clube/grupo dado,
--      se for membro ou público), do mais recente para trás.
--
-- Dev 3, 28 set 2026 · depois de migration_amigos_grupo_no_jogo.sql
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF pg_get_functiondef('public.get_friend_match(uuid)'::regprocedure) NOT LIKE '%friend_match_live_visible%' THEN
    RAISE EXCEPTION 'Falta a migration_a_decorrer_agora.sql. Parar e ler.';
  END IF;
  IF to_regprocedure('public.live_short_name(text)') IS NULL OR to_regprocedure('public.live_hides_results(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Faltam live_short_name / live_hides_results (migration_a_decorrer_agora.sql). Parar e ler.';
  END IF;
END $$;

-- ── 1. Quem pode ler uma sessão de grupo ────────────────────────────────
CREATE OR REPLACE FUNCTION public.friend_match_group_visible(p_root UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT r.organization_id IS NOT NULL
       AND auth.uid() IS NOT NULL
       AND EXISTS (SELECT 1 FROM private_matches g
                    WHERE (g.id = r.id OR g.session_id = r.id) AND g.winner_team IS NOT NULL)
       AND (EXISTS (SELECT 1 FROM memberships mb WHERE mb.organization_id = r.organization_id AND mb.user_id = auth.uid())
            OR EXISTS (SELECT 1 FROM organizations o WHERE o.id = r.organization_id AND o.is_global))
      FROM private_matches r
     WHERE r.id = p_root AND r.is_friend_session), FALSE);
$$;
REVOKE ALL ON FUNCTION public.friend_match_group_visible(UUID) FROM PUBLIC, anon, authenticated;

-- ── 2. Ler só de leitura ────────────────────────────────────────────────
DO $$
DECLARE
  c_mau CONSTANT TEXT := '(AND NOT friend_match_live_visible\(v_root\)) THEN';
  c_bom CONSTANT TEXT := '\1
     AND COALESCE(current_setting(''alinho.fm_readonly'', true), '''') <> v_root::text THEN';
  v_def TEXT := pg_get_functiondef('public.get_friend_match(uuid)'::regprocedure);
BEGIN
  IF v_def LIKE '%alinho.fm_readonly%' THEN
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

-- Esconde uma pessoa (pessoa ou lugar de equipa) de quem não jogou.
CREATE OR REPLACE FUNCTION public.friend_match_mask_person(p JSONB)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p IS NULL OR jsonb_typeof(p) <> 'object' THEN p
    WHEN NULLIF(p->>'user_id', '') IS NOT NULL AND live_hides_results((p->>'user_id')::uuid)
      THEN (p - 'rating' - 'gender' - 'left_name' - 'guest_email_sent' - 'avatar_url')
           || jsonb_build_object('user_id', NULL, 'name', NULL, 'hidden', TRUE)
    ELSE (p - 'rating' - 'gender' - 'left_name' - 'guest_email_sent') || jsonb_build_object('hidden', FALSE)
  END;
$$;
REVOKE ALL ON FUNCTION public.friend_match_mask_person(JSONB) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_friend_match_readonly(p_match_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_root UUID;
  j      JSONB;
  v_cre  UUID;
BEGIN
  SELECT COALESCE(session_id, id) INTO v_root FROM private_matches WHERE id = p_match_id;
  IF v_root IS NULL OR NOT friend_match_group_visible(v_root) THEN
    RAISE EXCEPTION 'Não estás neste jogo' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM set_config('alinho.fm_readonly', v_root::text, true);
  j := get_friend_match(p_match_id);
  PERFORM set_config('alinho.fm_readonly', '', true);

  SELECT creator_id INTO v_cre FROM private_matches WHERE id = v_root;
  -- o match: sem o nome de quem criou, se esconder
  IF live_hides_results(v_cre) THEN
    j := jsonb_set(j, '{match}', (j->'match') || jsonb_build_object('creator_id', NULL, 'creator_name', NULL, 'creator_hidden', TRUE));
  END IF;
  j := jsonb_set(j, '{match}', (j->'match') || jsonb_build_object('readonly', TRUE));
  -- as pessoas
  j := jsonb_set(j, '{invitees}', COALESCE((SELECT jsonb_agg(friend_match_mask_person(e))
                                              FROM jsonb_array_elements(j->'invitees') e), '[]'::jsonb));
  -- os jogos: as equipas e de quem se espera
  j := jsonb_set(j, '{games}', COALESCE((
         SELECT jsonb_agg(
                  g || jsonb_build_object(
                    'team_a', COALESCE((SELECT jsonb_agg(friend_match_mask_person(x)) FROM jsonb_array_elements(g->'team_a') x), '[]'::jsonb),
                    'team_b', COALESCE((SELECT jsonb_agg(friend_match_mask_person(x)) FROM jsonb_array_elements(g->'team_b') x), '[]'::jsonb),
                    'waiting_for', COALESCE((SELECT jsonb_agg(
                                       CASE WHEN EXISTS (SELECT 1 FROM private_match_invitees i
                                                          WHERE i.id::text = x->>'invitee_id' AND i.user_id IS NOT NULL
                                                            AND live_hides_results(i.user_id))
                                            THEN x || jsonb_build_object('name', NULL, 'hidden', TRUE)
                                            ELSE x || jsonb_build_object('hidden', FALSE) END)
                                     FROM jsonb_array_elements(g->'waiting_for') x), '[]'::jsonb))
                  ORDER BY (g->>'n')::int)
           FROM jsonb_array_elements(j->'games') g), '[]'::jsonb));
  RETURN j;
END;
$$;
REVOKE ALL ON FUNCTION public.get_friend_match_readonly(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_friend_match_readonly(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_friend_match_readonly(UUID) TO authenticated;

-- ── 3. Já jogados ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_played_events(
  p_organization_id UUID DEFAULT NULL, p_before TIMESTAMPTZ DEFAULT NULL, p_limit INTEGER DEFAULT 20)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me    UUID := auth.uid();
  v_today DATE := (NOW() AT TIME ZONE 'Europe/Lisbon')::date;
  v_orgs  UUID[];
  v_rows  JSONB;
  v_total INTEGER;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('rows', '[]'::jsonb, 'total', 0); END IF;
  IF p_organization_id IS NULL THEN
    SELECT array_agg(organization_id) INTO v_orgs FROM memberships WHERE user_id = v_me;
  ELSIF EXISTS (SELECT 1 FROM memberships WHERE user_id = v_me AND organization_id = p_organization_id)
        OR EXISTS (SELECT 1 FROM organizations WHERE id = p_organization_id AND is_global) THEN
    v_orgs := ARRAY[p_organization_id];
  END IF;
  v_orgs := COALESCE(v_orgs, '{}');

  WITH ev AS (
    -- mixes acabados
    SELECT 'mix'::text AS kind, g.id, NULL::text AS slug, g.title, g.date AS at,
           g.organization_id, o.name AS org_name, o.kind AS org_kind, o.group_logo_url AS org_logo,
           jsonb_build_object(
             'format', g.format,
             'players_count', (SELECT count(*) + count(partner_id) FROM participants WHERE game_id = g.id AND status = 'confirmed'),
             'i_played', EXISTS (SELECT 1 FROM mix_player_stats s WHERE s.game_id = g.id AND s.user_id = v_me)
                         OR EXISTS (SELECT 1 FROM participants p WHERE p.game_id = g.id AND p.status = 'confirmed'
                                      AND v_me IN (p.user_id, p.partner_id)),
             'my_points', (SELECT s.rating_delta FROM mix_player_stats s WHERE s.game_id = g.id AND s.user_id = v_me),
             'winner', (SELECT jsonb_build_object(
                           'label', CASE WHEN live_hides_results(t.player1_id) OR live_hides_results(t.player2_id)
                                         THEN 'Dupla ' || (SELECT count(*) FROM teams t2 WHERE t2.game_id = g.id
                                                             AND (t2.created_at, t2.id) <= (t.created_at, t.id))
                                         ELSE concat_ws(' / ', live_short_name(p1.name), live_short_name(p2.name)) END,
                           'anonymous', live_hides_results(t.player1_id) OR live_hides_results(t.player2_id))
                          FROM teams t
                          LEFT JOIN profiles p1 ON p1.id = t.player1_id
                          LEFT JOIN profiles p2 ON p2.id = t.player2_id
                         WHERE t.id = g.winner_team_id)) AS extra
      FROM games g JOIN organizations o ON o.id = g.organization_id
     WHERE g.organization_id = ANY (v_orgs) AND g.status IN ('finished', 'completed')
    UNION ALL
    -- torneios acabados
    SELECT 'tournament', t.id, t.slug, t.name, (t.ends_on + time '23:59') AT TIME ZONE 'Europe/Lisbon',
           t.organization_id, o.name, o.kind, o.group_logo_url,
           jsonb_build_object(
             'entries_count', (SELECT count(*) FROM tournament_entries e JOIN tournament_categories c ON c.id = e.category_id
                                WHERE c.tournament_id = t.id AND e.status IN ('validada', 'selecionada')),
             'players_count', NULL,
             'i_played', EXISTS (SELECT 1 FROM tournament_entries e JOIN tournament_categories c ON c.id = e.category_id
                                  WHERE c.tournament_id = t.id AND v_me IN (e.player1_id, e.player2_id)
                                    AND e.status IN ('validada', 'selecionada')),
             'my_points', NULL,
             'winner', (SELECT jsonb_build_object(
                           'label', CASE WHEN live_hides_results(e.player1_id) OR live_hides_results(e.player2_id)
                                         THEN 'Dupla ' || c.code
                                         ELSE COALESCE(NULLIF(btrim(e.team_name), ''),
                                                       concat_ws(' / ', live_short_name(COALESCE(p1.name, e.guest1_name)),
                                                                        live_short_name(COALESCE(p2.name, e.guest_name)))) END,
                           'anonymous', live_hides_results(e.player1_id) OR live_hides_results(e.player2_id),
                           'category_code', c.code)
                          FROM tournament_categories c
                          JOIN tournament_entries e ON e.id = c.champion_entry_id
                          LEFT JOIN profiles p1 ON p1.id = e.player1_id
                          LEFT JOIN profiles p2 ON p2.id = e.player2_id
                         WHERE c.tournament_id = t.id AND c.champion_entry_id IS NOT NULL
                         ORDER BY c.position, c.code LIMIT 1))
      FROM tournaments t JOIN organizations o ON o.id = t.organization_id
     WHERE t.organization_id = ANY (v_orgs) AND t.status = 'terminado'
    UNION ALL
    -- jogos entre amigos do grupo, já com resultados
    SELECT 'friends', r.id, NULL, NULL, (r.scheduled_date + COALESCE(r.scheduled_time, time '00:00')) AT TIME ZONE 'Europe/Lisbon',
           r.organization_id, o.name, o.kind, o.group_logo_url,
           jsonb_build_object(
             'creator_name', CASE WHEN live_hides_results(r.creator_id) THEN NULL ELSE pc.name END,
             'players_count', (SELECT count(*) FROM private_match_invitees i
                                WHERE i.match_id = r.id AND i.status IN ('accepted', 'guest')),
             'games_count', (SELECT count(*) FROM private_matches x
                              WHERE (x.id = r.id OR x.session_id = r.id) AND x.winner_team IS NOT NULL),
             'i_played', EXISTS (SELECT 1 FROM private_match_invitees i WHERE i.match_id = r.id AND i.user_id = v_me
                                    AND i.status = 'accepted'),
             'my_points', (SELECT sum(s.rating_delta) FROM private_match_stats s
                            JOIN private_matches x ON x.id = s.private_match_id
                           WHERE (x.id = r.id OR x.session_id = r.id) AND s.user_id = v_me),
             'winner', NULL)
      FROM private_matches r
      JOIN organizations o ON o.id = r.organization_id
      LEFT JOIN profiles pc ON pc.id = r.creator_id
     WHERE r.is_friend_session AND r.organization_id = ANY (v_orgs) AND r.scheduled_date <= v_today
       AND EXISTS (SELECT 1 FROM private_matches x WHERE (x.id = r.id OR x.session_id = r.id) AND x.winner_team IS NOT NULL)
  )
  SELECT (SELECT count(*) FROM ev),
         (SELECT COALESCE(jsonb_agg(
                   jsonb_build_object('kind', kind, 'id', id, 'slug', slug, 'title', title, 'date', at,
                                      'organization_id', organization_id, 'org_name', org_name, 'org_kind', org_kind,
                                      'org_logo', org_logo) || extra
                   ORDER BY at DESC, id), '[]'::jsonb)
            FROM (SELECT * FROM ev WHERE p_before IS NULL OR at < p_before
                   ORDER BY at DESC, id LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 100))) z)
    INTO v_total, v_rows;

  RETURN jsonb_build_object('rows', v_rows, 'total', v_total);
END;
$$;
REVOKE ALL ON FUNCTION public.list_played_events(UUID, TIMESTAMPTZ, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_played_events(UUID, TIMESTAMPTZ, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_played_events(UUID, TIMESTAMPTZ, INTEGER) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_functiondef('public.get_friend_match(uuid)'::regprocedure) LIKE '%alinho.fm_readonly%';  -- true
--   SELECT has_function_privilege('anon', 'public.list_played_events(uuid, timestamptz, integer)', 'EXECUTE');  -- false
--   SELECT has_function_privilege('anon', 'public.get_friend_match_readonly(uuid)', 'EXECUTE');                -- false
