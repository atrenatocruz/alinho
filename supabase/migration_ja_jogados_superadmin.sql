-- ═════════════════════════════════════════════════════════════════════════
-- «Já jogados» de um clube ou grupo: também para o superadmin com o modo ligado
--
-- PORQUÊ. Francisco, 23 out: «Continuo sem ver nada como super admin». Na página
-- de um grupo onde não é membro, o separador «Já jogados» vinha vazio: a
-- list_played_events só responde a membros (ou a clubes globais).
--
-- O QUE FAZ. Com p_organization_id, aceita também is_platform_admin_me() (que já
-- exige platform_admins.mode_on). Com o modo desligado, igual a qualquer pessoa.
-- Sem p_organization_id (Home) fica como estava: os meus clubes e grupos.
-- Base: migration_ja_jogados_por_terminar.sql (corpo vivo de 23 out, md5 sem \r
-- 80026d6d). CREATE OR REPLACE com a mesma assinatura: os GRANT ficam.
--
-- Bugs, 25 out 2026. Corre: SI (alinho-dev e depois produção).
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.list_played_events(p_organization_id uuid DEFAULT NULL::uuid, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        OR EXISTS (SELECT 1 FROM organizations WHERE id = p_organization_id AND is_global)
        -- O superadmin com o modo ligado vê os «Já jogados» de qualquer clube ou
        -- grupo (Francisco, 23 out). is_platform_admin_me() já conta o mode_on.
        OR is_platform_admin_me() THEN
    v_orgs := ARRAY[p_organization_id];
  END IF;
  v_orgs := COALESCE(v_orgs, '{}');

  WITH ev AS (
    -- mixes acabados, e os de dias passados que ficaram por terminar (23 out)
    SELECT 'mix'::text AS kind, g.id, NULL::text AS slug, g.title, g.date AS at,
           g.organization_id, o.name AS org_name, o.kind AS org_kind, o.group_logo_url AS org_logo,
           jsonb_build_object(
             'origin', g.origin,
             'format', g.format,
             'por_terminar', g.status = 'in_progress',
             'players_count', (SELECT count(*) + count(partner_id) FROM participants WHERE game_id = g.id AND status = 'confirmed'),
             'i_played', EXISTS (SELECT 1 FROM mix_player_stats s WHERE s.game_id = g.id AND s.user_id = v_me)
                         OR EXISTS (SELECT 1 FROM participants p WHERE p.game_id = g.id AND p.status = 'confirmed'
                                      AND v_me IN (p.user_id, p.partner_id)),
             'my_points', (SELECT s.rating_delta FROM mix_player_stats s WHERE s.game_id = g.id AND s.user_id = v_me),
             'i_won', (SELECT s.mix_won FROM mix_player_stats s WHERE s.game_id = g.id AND s.user_id = v_me),
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
     WHERE g.organization_id = ANY (v_orgs)
       AND (g.status IN ('finished', 'completed')
            OR (g.status = 'in_progress' AND (g.date AT TIME ZONE 'Europe/Lisbon')::date < v_today))
    UNION ALL
    -- torneios acabados
    SELECT 'tournament', t.id, t.slug, t.name, (t.ends_on + time '23:59') AT TIME ZONE 'Europe/Lisbon',
           t.organization_id, o.name, o.kind, o.group_logo_url,
           jsonb_build_object(
             'entries_count', (SELECT count(*) FROM tournament_entries e JOIN tournament_categories c ON c.id = e.category_id
                                WHERE c.tournament_id = t.id AND e.status IN ('validada', 'selecionada')),
             'players_count', NULL,
             'i_won', CASE WHEN NOT EXISTS (SELECT 1 FROM tournament_categories c WHERE c.tournament_id = t.id AND c.champion_entry_id IS NOT NULL) THEN NULL
                           ELSE EXISTS (SELECT 1 FROM tournament_categories c JOIN tournament_entries e ON e.id = c.champion_entry_id
                                         WHERE c.tournament_id = t.id AND v_me IN (e.player1_id, e.player2_id)) END,
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
                           WHERE (x.id = r.id OR x.session_id = r.id OR x.friend_pair_of = r.id) AND s.user_id = v_me),
             'i_won', NULL,
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
$function$;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_functiondef('public.list_played_events(uuid,timestamptz,integer)'::regprocedure) LIKE '%is_platform_admin_me()%';  -- true
--   SELECT proacl FROM pg_proc WHERE oid = 'public.list_played_events(uuid,timestamptz,integer)'::regprocedure;
--     -- {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}  (igual)
