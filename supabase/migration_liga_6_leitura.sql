-- supabase/migration_liga_6_leitura.sql
-- ════════════════════════════════════════════════════════════════════════
-- Liga entre Clubes — Fase 1, parte 6: leituras (página pública, encontro,
-- equipa, Home) e lembretes de prazo. Correr primeiro: migrações 1 a 5.
--
-- Tudo o que um visitante sem sessão vê sai daqui, com colunas escolhidas à
-- mão — nunca um select * de uma tabela (lição dos torneios). Nada de
-- e-mails, telefones, ranking exato (só a banda) ou candidaturas alheias.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_league_page(p_slug TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_l leagues; v_manage BOOLEAN; v_my UUID[];
BEGIN
  SELECT * INTO v_l FROM leagues WHERE slug = p_slug;
  IF v_l.id IS NULL THEN RETURN NULL; END IF;
  v_manage := auth.uid() IS NOT NULL AND can_manage_league(v_l.id);
  IF v_l.status = 'rascunho' AND NOT v_manage THEN RETURN NULL; END IF;
  v_my := CASE WHEN auth.uid() IS NULL THEN '{}'::uuid[]
               ELSE ARRAY(SELECT t.id FROM league_teams t WHERE t.league_id = v_l.id AND represents_league_team(t.id)) END;

  RETURN jsonb_build_object(
    'league', jsonb_build_object(
      'id', v_l.id, 'slug', v_l.slug, 'name', v_l.name, 'kind', v_l.kind, 'scope', v_l.scope, 'district', v_l.district,
      'season_label', v_l.season_label, 'description', v_l.description, 'status', v_l.status,
      'applications_close_at', v_l.applications_close_at, 'max_teams_per_category', v_l.max_teams_per_category,
      'owner', (SELECT jsonb_build_object('name', o.name, 'slug', o.slug, 'logo', o.group_logo_url)
                  FROM organizations o WHERE o.id = v_l.owner_org_id)),
    'categories', (SELECT COALESCE(jsonb_agg(to_jsonb(c) - 'league_id' - 'created_at' ORDER BY c.gender, c.level), '[]'::jsonb)
                     FROM league_categories c WHERE c.league_id = v_l.id),
    'teams', (SELECT COALESCE(jsonb_agg(
                jsonb_build_object('id', t.id, 'category_id', t.category_id, 'name', COALESCE(t.name, o.name),
                                   'club_slug', o.slug, 'logo', o.group_logo_url, 'status', t.status)
                || CASE WHEN v_manage OR t.id = ANY (v_my)
                        THEN jsonb_build_object('organization_id', t.organization_id, 'applied_at', t.applied_at,
                                                'reject_reason', t.reject_reason, 'waitlist_order', t.waitlist_order)
                        ELSE '{}'::jsonb END
                ORDER BY o.name), '[]'::jsonb)
                FROM league_teams t JOIN organizations o ON o.id = t.organization_id
               WHERE t.league_id = v_l.id AND (t.status = 'aprovada' OR v_manage OR t.id = ANY (v_my))),
    'rounds', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', r.id, 'category_id', r.category_id, 'number', r.number,
                                                           'window_start', r.window_start, 'window_end', r.window_end)
                                         ORDER BY r.number), '[]'::jsonb)
                 FROM league_rounds r WHERE r.league_id = v_l.id),
    'encounters', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                      'id', e.id, 'category_id', e.category_id, 'round_id', e.round_id,
                      'home_team_id', e.home_team_id, 'away_team_id', e.away_team_id,
                      'scheduled_at', e.scheduled_at, 'venue', e.venue_text, 'status', e.status,
                      'walkover_team_id', CASE WHEN e.status = 'oficial' THEN e.walkover_team_id END,
                      'sets', CASE WHEN e.status = 'oficial' AND e.walkover_team_id IS NULL
                                   THEN (SELECT jsonb_agg(m.sets ORDER BY m.slot) FROM league_matches m WHERE m.encounter_id = e.id) END)
                    ORDER BY e.scheduled_at NULLS LAST), '[]'::jsonb)
                     FROM league_encounters e WHERE e.league_id = v_l.id),
    'viewer', jsonb_build_object(
      'signed_in', auth.uid() IS NOT NULL, 'can_manage', v_manage,
      'is_owner', auth.uid() IS NOT NULL AND league_is_owner(v_l.id),
      'team_ids', to_jsonb(v_my),
      'admin_clubs', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name) ORDER BY o.name), '[]'::jsonb)
                        FROM memberships m JOIN organizations o ON o.id = m.organization_id
                       WHERE m.user_id = auth.uid() AND m.is_admin AND o.kind = 'club')));
END;
$$;

CREATE OR REPLACE FUNCTION get_league_encounter(p_encounter_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_e league_encounters; v_l leagues; v_c league_categories; v_r league_rounds;
  v_manage BOOLEAN; v_side TEXT; v_inside BOOLEAN; v_my_team UUID;
BEGIN
  SELECT * INTO v_e FROM league_encounters WHERE id = p_encounter_id;
  IF v_e.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_l FROM leagues WHERE id = v_e.league_id;
  v_manage := auth.uid() IS NOT NULL AND can_manage_league(v_l.id);
  IF v_l.status = 'rascunho' AND NOT v_manage THEN RETURN NULL; END IF;
  SELECT * INTO v_c FROM league_categories WHERE id = v_e.category_id;
  SELECT * INTO v_r FROM league_rounds WHERE id = v_e.round_id;
  v_side := CASE WHEN auth.uid() IS NULL THEN NULL ELSE league_side(v_e) END;
  v_inside := v_manage OR v_side IS NOT NULL;
  v_my_team := CASE v_side WHEN 'home' THEN v_e.home_team_id WHEN 'away' THEN v_e.away_team_id END;

  RETURN jsonb_build_object(
    'encounter', jsonb_build_object(
      'id', v_e.id, 'status', v_e.status, 'scheduled_at', v_e.scheduled_at, 'venue', v_e.venue_text,
      'round_number', v_r.number, 'window_start', v_r.window_start, 'window_end', v_r.window_end,
      'home_team_id', v_e.home_team_id, 'away_team_id', v_e.away_team_id,
      'walkover_team_id', CASE WHEN v_e.status = 'oficial' THEN v_e.walkover_team_id END,
      'proposed_by_team_id', v_e.proposed_by_team_id, 'submitted_by_team_id', v_e.submitted_by_team_id,
      'submitted_at', v_e.submitted_at, 'resolution_note', v_e.resolution_note,
      'contest_reason', CASE WHEN v_inside THEN v_e.contest_reason END),
    'league', jsonb_build_object('slug', v_l.slug, 'name', v_l.name, 'kind', v_l.kind),
    'category', to_jsonb(v_c) - 'league_id' - 'created_at',
    'home', (SELECT jsonb_build_object('id', t.id, 'name', COALESCE(t.name, o.name), 'logo', o.group_logo_url)
               FROM league_teams t JOIN organizations o ON o.id = t.organization_id WHERE t.id = v_e.home_team_id),
    'away', (SELECT jsonb_build_object('id', t.id, 'name', COALESCE(t.name, o.name), 'logo', o.group_logo_url)
               FROM league_teams t JOIN organizations o ON o.id = t.organization_id WHERE t.id = v_e.away_team_id),
    'matches', CASE WHEN (v_e.status = 'oficial' AND v_e.walkover_team_id IS NULL) OR (v_inside AND v_e.status IN ('submetido', 'contestado')) THEN
      (SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'slot', m.slot, 'sets', m.sets, 'winner', m.winner,
          'home', jsonb_build_array(jsonb_build_object('id', m.home_p1, 'name', (SELECT name FROM profiles WHERE id = m.home_p1)),
                                    jsonb_build_object('id', m.home_p2, 'name', (SELECT name FROM profiles WHERE id = m.home_p2))),
          'away', jsonb_build_array(jsonb_build_object('id', m.away_p1, 'name', (SELECT name FROM profiles WHERE id = m.away_p1)),
                                    jsonb_build_object('id', m.away_p2, 'name', (SELECT name FROM profiles WHERE id = m.away_p2))))
        ORDER BY m.slot), '[]'::jsonb) FROM league_matches m WHERE m.encounter_id = v_e.id)
      ELSE '[]'::jsonb END,
    'rosters', CASE WHEN v_inside THEN jsonb_build_object(
      'home', (SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', p.id, 'name', p.name, 'gender', p.gender,
                                                            'band', league_band(r.rating_at_entry)) ORDER BY p.name), '[]'::jsonb)
                 FROM league_roster r JOIN profiles p ON p.id = r.user_id WHERE r.team_id = v_e.home_team_id AND r.removed_at IS NULL),
      'away', (SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', p.id, 'name', p.name, 'gender', p.gender,
                                                            'band', league_band(r.rating_at_entry)) ORDER BY p.name), '[]'::jsonb)
                 FROM league_roster r JOIN profiles p ON p.id = r.user_id WHERE r.team_id = v_e.away_team_id AND r.removed_at IS NULL))
      END,
    'viewer', jsonb_build_object(
      'side', v_side, 'can_manage', v_manage,
      'can_submit', v_side IN ('home', 'away') AND (v_e.status IN ('por_marcar', 'proposto', 'marcado')
                    OR (v_e.status = 'submetido' AND v_e.submitted_by_team_id = v_my_team))
                    AND (v_e.scheduled_at IS NULL OR v_e.scheduled_at <= NOW()),
      'can_answer', v_side IN ('home', 'away') AND v_e.status = 'submetido'
                    AND v_e.submitted_by_team_id <> v_my_team AND v_e.submitted_by IS DISTINCT FROM auth.uid(),
      'can_propose', v_side IN ('home', 'away') AND v_e.status IN ('por_marcar', 'proposto', 'marcado'),
      'can_accept', v_side IN ('home', 'away') AND v_e.status = 'proposto' AND v_e.proposed_by_team_id <> v_my_team));
END;
$$;

CREATE OR REPLACE FUNCTION get_league_team(p_team_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_t league_teams; v_c league_categories; v_l leagues; v_edit BOOLEAN;
BEGIN
  SELECT * INTO v_t FROM league_teams WHERE id = p_team_id;
  IF v_t.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_l FROM leagues WHERE id = v_t.league_id;
  v_edit := represents_league_team(v_t.id);
  IF v_t.status <> 'aprovada' AND NOT (v_edit OR can_manage_league(v_l.id)) THEN RETURN NULL; END IF;
  SELECT * INTO v_c FROM league_categories WHERE id = v_t.category_id;
  RETURN jsonb_build_object(
    'team', jsonb_build_object('id', v_t.id, 'status', v_t.status,
      'name', (SELECT COALESCE(v_t.name, o.name) FROM organizations o WHERE o.id = v_t.organization_id),
      'category', to_jsonb(v_c) - 'league_id' - 'created_at',
      'league', jsonb_build_object('slug', v_l.slug, 'name', v_l.name)),
    'roster', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', r.id, 'user_id', p.id, 'name', p.name,
                                                            'band', league_band(r.rating_at_entry),
                                                            'band_now', league_band(COALESCE(p.rating, 900)),
                                                            'added_at', r.added_at) ORDER BY p.name), '[]'::jsonb)
                 FROM league_roster r JOIN profiles p ON p.id = r.user_id WHERE r.team_id = v_t.id AND r.removed_at IS NULL),
    'captains', (SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', p.id, 'name', p.name) ORDER BY p.name), '[]'::jsonb)
                   FROM league_captains c JOIN profiles p ON p.id = c.user_id WHERE c.team_id = v_t.id),
    'viewer', jsonb_build_object('can_edit', v_edit, 'is_club_admin', is_org_admin(v_t.organization_id),
                                 'locked', league_roster_locked(v_c.id), 'roster_max', v_c.roster_max));
END;
$$;

-- Os membros do clube que se podem pôr no plantel, com o motivo de quem não pode.
CREATE OR REPLACE FUNCTION league_roster_candidates(p_team_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_t league_teams; v_c league_categories; v_ceiling NUMERIC;
BEGIN
  SELECT * INTO v_t FROM league_teams WHERE id = p_team_id;
  IF v_t.id IS NULL OR NOT represents_league_team(p_team_id) THEN RAISE EXCEPTION 'not_team_rep'; END IF;
  SELECT * INTO v_c FROM league_categories WHERE id = v_t.category_id;
  v_ceiling := CASE v_c.level WHEN 1 THEN NULL WHEN 2 THEN 1800 WHEN 3 THEN 1600 WHEN 4 THEN 1400
                              WHEN 5 THEN 1200 WHEN 6 THEN 1000 ELSE 700 END;
  RETURN (SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'user_id', p.id, 'name', p.name, 'gender', p.gender, 'band', league_band(COALESCE(p.rating, 900)),
            'problem', CASE
              WHEN EXISTS (SELECT 1 FROM league_roster r WHERE r.league_id = v_t.league_id AND r.user_id = p.id AND r.removed_at IS NULL) THEN 'already_in_league'
              WHEN NULLIF(p.gender, '') IS NULL THEN 'gender_missing'
              WHEN v_c.gender <> 'misto' AND p.gender <> v_c.gender THEN 'gender'
              WHEN v_ceiling IS NOT NULL AND COALESCE(p.rating, 900) >= v_ceiling + v_c.rating_tolerance THEN 'level'
            END) ORDER BY p.name), '[]'::jsonb)
            FROM memberships m JOIN profiles p ON p.id = m.user_id
           WHERE m.organization_id = v_t.organization_id AND NOT m.is_guest
             AND NOT EXISTS (SELECT 1 FROM league_roster r WHERE r.team_id = v_t.id AND r.user_id = p.id AND r.removed_at IS NULL));
END;
$$;

-- A Home: os meus encontros (estou no plantel ou falo pela equipa) e as
-- ligas abertas a que os meus clubes ainda não concorreram.
CREATE OR REPLACE FUNCTION my_league_agenda()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_me UUID := auth.uid();
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('encounters', '[]'::jsonb, 'open_leagues', '[]'::jsonb); END IF;
  RETURN jsonb_build_object(
    'encounters', (SELECT COALESCE(jsonb_agg(x ORDER BY x->>'scheduled_at' NULLS LAST), '[]'::jsonb) FROM (
      SELECT jsonb_build_object(
        'id', e.id, 'league_slug', l.slug, 'league_name', l.name, 'league_kind', l.kind,
        'category_gender', c.gender, 'category_level', c.level, 'round_number', r.number, 'window_end', r.window_end,
        'home_name', COALESCE(th.name, oh.name), 'away_name', COALESCE(ta.name, oa.name),
        'home_logo', oh.group_logo_url, 'away_logo', oa.group_logo_url,
        'my_side', CASE WHEN EXISTS (SELECT 1 FROM league_roster x WHERE x.team_id = e.home_team_id AND x.user_id = v_me AND x.removed_at IS NULL)
                          OR represents_league_team(e.home_team_id) THEN 'home' ELSE 'away' END,
        'scheduled_at', e.scheduled_at, 'venue', e.venue_text, 'status', e.status,
        'needs_my_answer', e.status = 'submetido' AND e.submitted_by IS DISTINCT FROM v_me
                           AND ((represents_league_team(e.home_team_id) AND e.submitted_by_team_id = e.away_team_id)
                             OR (represents_league_team(e.away_team_id) AND e.submitted_by_team_id = e.home_team_id))) AS x
        FROM league_encounters e
        JOIN leagues l ON l.id = e.league_id
        JOIN league_categories c ON c.id = e.category_id
        JOIN league_rounds r ON r.id = e.round_id
        JOIN league_teams th ON th.id = e.home_team_id JOIN organizations oh ON oh.id = th.organization_id
        JOIN league_teams ta ON ta.id = e.away_team_id JOIN organizations oa ON oa.id = ta.organization_id
       WHERE e.status <> 'cancelado' AND l.status IN ('a_decorrer', 'terminada')
         AND r.window_end >= CURRENT_DATE - 30
         AND (EXISTS (SELECT 1 FROM league_roster x WHERE x.user_id = v_me AND x.removed_at IS NULL AND x.team_id IN (e.home_team_id, e.away_team_id))
           OR represents_league_team(e.home_team_id) OR represents_league_team(e.away_team_id))) s),
    'open_leagues', (SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
          'slug', l.slug, 'name', l.name, 'kind', l.kind, 'district', l.district,
          'applications_close_at', l.applications_close_at, 'my_club_name', o.name,
          'category_codes', (SELECT jsonb_agg(jsonb_build_object('gender', c.gender, 'level', c.level) ORDER BY c.gender, c.level)
                               FROM league_categories c WHERE c.league_id = l.id))), '[]'::jsonb)
        FROM leagues l
        JOIN memberships m ON m.user_id = v_me AND m.is_admin
        JOIN organizations o ON o.id = m.organization_id AND o.kind = 'club'
       WHERE l.status = 'inscricoes'
         AND (l.applications_close_at IS NULL OR l.applications_close_at > NOW())
         AND (l.district IS NULL OR o.district IS NULL OR l.district = o.district OR l.scope = 'nacional')
         AND l.owner_org_id IS DISTINCT FROM o.id
         AND NOT EXISTS (SELECT 1 FROM league_teams t WHERE t.league_id = l.id AND t.organization_id = o.id)));
END;
$$;

-- Lembrete: 2 dias antes do fim da janela, a quem fala por cada lado de um
-- encontro ainda por jogar. Uma vez só por encontro.
CREATE OR REPLACE FUNCTION league_deadline_reminders()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE e RECORD; n INTEGER := 0;
BEGIN
  FOR e IN
    SELECT le.*, l.slug, l.name AS league_name FROM league_encounters le
      JOIN league_rounds r ON r.id = le.round_id JOIN leagues l ON l.id = le.league_id
     WHERE r.window_end = CURRENT_DATE + 2 AND le.status IN ('por_marcar', 'proposto', 'marcado')
       AND NOT EXISTS (SELECT 1 FROM notifications nt WHERE nt.kind = 'league_deadline_soon' AND nt.data->>'encounter_id' = le.id::text)
  LOOP
    INSERT INTO notifications (user_id, kind, data)
    SELECT DISTINCT u, 'league_deadline_soon',
           jsonb_build_object('league_id', e.league_id, 'league_slug', e.slug, 'league_name', e.league_name, 'encounter_id', e.id)
      FROM (SELECT league_team_rep_ids(e.home_team_id) AS u UNION SELECT league_team_rep_ids(e.away_team_id)) s;
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

-- cron.schedule substitui o trabalho se já existir: pode correr outra vez.
SELECT cron.schedule('league-deadline-reminders', '0 8 * * *', $$SELECT public.league_deadline_reminders()$$);

REVOKE ALL ON FUNCTION get_league_page(TEXT), get_league_encounter(UUID), get_league_team(UUID),
  league_roster_candidates(UUID), my_league_agenda(), league_deadline_reminders() FROM public;
GRANT EXECUTE ON FUNCTION get_league_page(TEXT), get_league_encounter(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_league_team(UUID), league_roster_candidates(UUID), my_league_agenda() TO authenticated;
REVOKE ALL ON FUNCTION league_deadline_reminders() FROM anon, authenticated;
