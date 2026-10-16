-- supabase/migration_liga_3_inscricoes.sql
-- ════════════════════════════════════════════════════════════════════════
-- Liga entre Clubes — Fase 1, parte 3: candidaturas dos clubes, capitães e
-- plantel. Correr primeiro: migrações 1 e 2.
--
-- Fluxo (spec §9): o admin do clube candidata → pendente → quem organiza
-- aprova / rejeita / põe como suplente → o clube é avisado. Lotação vista com
-- a categoria trancada (FOR UPDATE), para duas aprovações ao mesmo tempo não
-- passarem o máximo.
-- ════════════════════════════════════════════════════════════════════════

-- O plantel fecha quando começa a jornada N da categoria (N = roster_locks_at_round).
CREATE OR REPLACE FUNCTION league_roster_locked(p_category_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM league_rounds r JOIN league_categories c ON c.id = r.category_id
     WHERE r.category_id = p_category_id AND r.number = c.roster_locks_at_round AND r.window_start <= CURRENT_DATE);
$$;

CREATE OR REPLACE FUNCTION apply_to_league(p_category_id UUID, p_organization_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_c league_categories; v_l leagues; v_org organizations; v_t league_teams; v_id UUID;
BEGIN
  SELECT * INTO v_c FROM league_categories WHERE id = p_category_id;
  IF v_c.id IS NULL THEN RAISE EXCEPTION 'category_not_found'; END IF;
  SELECT * INTO v_l FROM leagues WHERE id = v_c.league_id;
  SELECT * INTO v_org FROM organizations WHERE id = p_organization_id;
  IF v_org.id IS NULL OR NOT is_org_admin(p_organization_id) THEN RAISE EXCEPTION 'not_club_admin'; END IF;
  IF v_org.kind IS DISTINCT FROM 'club' THEN RAISE EXCEPTION 'groups_cannot_apply'; END IF;
  IF v_l.status <> 'inscricoes' OR v_c.status <> 'inscricoes'
     OR (v_l.applications_close_at IS NOT NULL AND NOW() > v_l.applications_close_at) THEN
    RAISE EXCEPTION 'applications_closed';
  END IF;

  SELECT * INTO v_t FROM league_teams WHERE category_id = p_category_id AND organization_id = p_organization_id FOR UPDATE;
  IF v_t.id IS NOT NULL THEN
    -- Quem se retirou ou foi rejeitado pode voltar a pedir; o resto é repetido.
    IF v_t.status NOT IN ('retirada', 'rejeitada') THEN RAISE EXCEPTION 'already_applied'; END IF;
    UPDATE league_teams SET status = 'pendente', applied_by = auth.uid(), applied_at = NOW(),
           decided_by = NULL, decided_at = NULL, reject_reason = NULL, waitlist_order = NULL
     WHERE id = v_t.id;
    v_id := v_t.id;
  ELSE
    INSERT INTO league_teams (league_id, category_id, organization_id, applied_by)
    VALUES (v_l.id, p_category_id, p_organization_id, auth.uid())
    RETURNING id INTO v_id;
  END IF;
  PERFORM league_log(v_l.id, NULL, 'application_sent', jsonb_build_object('team_id', v_id));
  PERFORM league_notify(ARRAY(SELECT league_manager_ids(v_l.id)), 'league_application_received',
    jsonb_build_object('league_id', v_l.id, 'league_slug', v_l.slug, 'league_name', v_l.name,
                       'club_name', v_org.name, 'team_id', v_id));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION withdraw_application(p_team_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_t league_teams; v_c league_categories; v_l leagues;
BEGIN
  SELECT * INTO v_t FROM league_teams WHERE id = p_team_id FOR UPDATE;
  IF v_t.id IS NULL THEN RAISE EXCEPTION 'team_not_found'; END IF;
  IF NOT is_org_admin(v_t.organization_id) THEN RAISE EXCEPTION 'not_club_admin'; END IF;
  SELECT * INTO v_c FROM league_categories WHERE id = v_t.category_id;
  IF v_c.status <> 'inscricoes' THEN RAISE EXCEPTION 'category_started'; END IF;
  IF v_t.status NOT IN ('pendente', 'suplente', 'aprovada') THEN RAISE EXCEPTION 'cannot_withdraw'; END IF;
  UPDATE league_teams SET status = 'retirada', waitlist_order = NULL WHERE id = p_team_id;
  -- O plantel acaba com o pedido: os jogadores ficam livres para outro clube e,
  -- se o clube voltar a pedir, não reaparece um plantel antigo.
  UPDATE league_roster SET removed_at = NOW() WHERE team_id = p_team_id AND removed_at IS NULL;
  SELECT * INTO v_l FROM leagues WHERE id = v_t.league_id;
  PERFORM league_log(v_t.league_id, NULL, 'application_withdrawn', jsonb_build_object('team_id', p_team_id));
  PERFORM league_notify(ARRAY(SELECT league_manager_ids(v_l.id)), 'league_application_withdrawn',
    jsonb_build_object('league_id', v_l.id, 'league_slug', v_l.slug, 'league_name', v_l.name,
                       'club_name', (SELECT name FROM organizations WHERE id = v_t.organization_id), 'team_id', p_team_id));
END;
$$;

CREATE OR REPLACE FUNCTION decide_application(p_team_id UUID, p_decision TEXT, p_reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_t league_teams; v_c league_categories; v_l leagues; v_count INTEGER;
BEGIN
  SELECT * INTO v_t FROM league_teams WHERE id = p_team_id;
  IF v_t.id IS NULL THEN RAISE EXCEPTION 'team_not_found'; END IF;
  IF NOT can_manage_league(v_t.league_id) THEN RAISE EXCEPTION 'not_league_manager'; END IF;
  IF p_decision NOT IN ('aprovada', 'rejeitada', 'suplente') THEN RAISE EXCEPTION 'decision_invalid'; END IF;
  -- A categoria trancada: duas aprovações ao mesmo tempo esperam uma pela outra.
  SELECT * INTO v_c FROM league_categories WHERE id = v_t.category_id FOR UPDATE;
  SELECT * INTO v_l FROM leagues WHERE id = v_t.league_id;
  SELECT * INTO v_t FROM league_teams WHERE id = p_team_id FOR UPDATE;
  IF v_c.status <> 'inscricoes' THEN RAISE EXCEPTION 'category_started'; END IF;
  IF v_t.status NOT IN ('pendente', 'suplente') THEN RAISE EXCEPTION 'team_already_decided'; END IF;

  IF p_decision = 'aprovada' AND v_l.max_teams_per_category IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM league_teams WHERE category_id = v_c.id AND status = 'aprovada';
    IF v_count >= v_l.max_teams_per_category THEN RAISE EXCEPTION 'category_full'; END IF;
  END IF;
  IF p_decision = 'rejeitada' AND length(trim(COALESCE(p_reason, ''))) > 500 THEN RAISE EXCEPTION 'reason_too_long'; END IF;

  UPDATE league_teams
     SET status = p_decision, decided_by = auth.uid(), decided_at = NOW(),
         reject_reason = CASE WHEN p_decision = 'rejeitada' THEN NULLIF(trim(p_reason), '') END,
         waitlist_order = CASE WHEN p_decision = 'suplente'
           THEN (SELECT COALESCE(max(waitlist_order), 0) + 1 FROM league_teams WHERE category_id = v_c.id AND status = 'suplente') END
   WHERE id = p_team_id;
  PERFORM league_log(v_l.id, NULL, 'application_decided', jsonb_build_object('team_id', p_team_id, 'decision', p_decision));
  PERFORM league_notify(ARRAY(SELECT league_team_rep_ids(p_team_id)), 'league_application_decided',
    jsonb_build_object('league_id', v_l.id, 'league_slug', v_l.slug, 'league_name', v_l.name,
                       'team_id', p_team_id, 'decision', p_decision, 'reason', NULLIF(trim(p_reason), '')));
END;
$$;

CREATE OR REPLACE FUNCTION set_league_captain(p_team_id UUID, p_user_id UUID, p_on BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_t league_teams;
BEGIN
  SELECT * INTO v_t FROM league_teams WHERE id = p_team_id;
  IF v_t.id IS NULL THEN RAISE EXCEPTION 'team_not_found'; END IF;
  -- Só o admin do clube nomeia capitães (um capitão não nomeia outros).
  IF NOT is_org_admin(v_t.organization_id) THEN RAISE EXCEPTION 'not_club_admin'; END IF;
  IF p_on THEN
    IF NOT EXISTS (SELECT 1 FROM memberships WHERE organization_id = v_t.organization_id AND user_id = p_user_id AND NOT is_guest) THEN
      RAISE EXCEPTION 'not_member';
    END IF;
    INSERT INTO league_captains (team_id, user_id) VALUES (p_team_id, p_user_id) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM league_captains WHERE team_id = p_team_id AND user_id = p_user_id;
  END IF;
  PERFORM league_log(v_t.league_id, NULL, CASE WHEN p_on THEN 'captain_added' ELSE 'captain_removed' END,
                     jsonb_build_object('team_id', p_team_id, 'user_id', p_user_id));
END;
$$;

-- Os mesmos critérios de src/lib/leagueEligibility.js (playerProblem).
CREATE OR REPLACE FUNCTION add_to_roster(p_team_id UUID, p_user_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_t league_teams; v_c league_categories; v_p profiles; v_ceiling NUMERIC; v_count INTEGER; v_id UUID;
BEGIN
  SELECT * INTO v_t FROM league_teams WHERE id = p_team_id FOR UPDATE;
  IF v_t.id IS NULL THEN RAISE EXCEPTION 'team_not_found'; END IF;
  IF NOT represents_league_team(p_team_id) THEN RAISE EXCEPTION 'not_team_rep'; END IF;
  IF v_t.status <> 'aprovada' THEN RAISE EXCEPTION 'team_not_approved'; END IF;
  SELECT * INTO v_c FROM league_categories WHERE id = v_t.category_id;
  IF v_c.status = 'terminada' THEN RAISE EXCEPTION 'category_finished'; END IF;
  IF league_roster_locked(v_c.id) THEN RAISE EXCEPTION 'roster_locked'; END IF;
  IF NOT EXISTS (SELECT 1 FROM memberships WHERE organization_id = v_t.organization_id AND user_id = p_user_id AND NOT is_guest) THEN
    RAISE EXCEPTION 'not_member';
  END IF;
  SELECT * INTO v_p FROM profiles WHERE id = p_user_id;
  IF NULLIF(v_p.gender, '') IS NULL THEN RAISE EXCEPTION 'gender_missing'; END IF;
  IF v_c.gender <> 'misto' AND v_p.gender <> v_c.gender THEN RAISE EXCEPTION 'gender'; END IF;
  v_ceiling := CASE v_c.level WHEN 1 THEN NULL WHEN 2 THEN 1800 WHEN 3 THEN 1600 WHEN 4 THEN 1400
                              WHEN 5 THEN 1200 WHEN 6 THEN 1000 ELSE 700 END;
  IF v_ceiling IS NOT NULL AND COALESCE(v_p.rating, 900) >= v_ceiling + v_c.rating_tolerance THEN RAISE EXCEPTION 'level'; END IF;
  SELECT count(*) INTO v_count FROM league_roster WHERE team_id = p_team_id AND removed_at IS NULL;
  IF v_count >= v_c.roster_max THEN RAISE EXCEPTION 'roster_full'; END IF;
  BEGIN
    INSERT INTO league_roster (league_id, team_id, user_id, rating_at_entry, added_by)
    VALUES (v_t.league_id, p_team_id, p_user_id, COALESCE(v_p.rating, 900), auth.uid())
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'already_in_league';
  END;
  PERFORM league_log(v_t.league_id, NULL, 'roster_added', jsonb_build_object('team_id', p_team_id, 'user_id', p_user_id));
  PERFORM league_notify(ARRAY[p_user_id], 'league_roster_added',
    jsonb_build_object('league_id', v_t.league_id, 'league_slug', (SELECT slug FROM leagues WHERE id = v_t.league_id),
                       'league_name', (SELECT name FROM leagues WHERE id = v_t.league_id),
                       'club_name', (SELECT name FROM organizations WHERE id = v_t.organization_id)));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION remove_from_roster(p_roster_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_r league_roster;
BEGIN
  SELECT * INTO v_r FROM league_roster WHERE id = p_roster_id FOR UPDATE;
  IF v_r.id IS NULL OR v_r.removed_at IS NOT NULL THEN RAISE EXCEPTION 'roster_not_found'; END IF;
  IF NOT represents_league_team(v_r.team_id) THEN RAISE EXCEPTION 'not_team_rep'; END IF;
  UPDATE league_roster SET removed_at = NOW() WHERE id = p_roster_id;
  PERFORM league_log(v_r.league_id, NULL, 'roster_removed', jsonb_build_object('team_id', v_r.team_id, 'user_id', v_r.user_id));
END;
$$;

REVOKE ALL ON FUNCTION league_roster_locked(UUID), apply_to_league(UUID, UUID), withdraw_application(UUID),
  decide_application(UUID, TEXT, TEXT), set_league_captain(UUID, UUID, BOOLEAN), add_to_roster(UUID, UUID),
  remove_from_roster(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION league_roster_locked(UUID), apply_to_league(UUID, UUID), withdraw_application(UUID),
  decide_application(UUID, TEXT, TEXT), set_league_captain(UUID, UUID, BOOLEAN), add_to_roster(UUID, UUID),
  remove_from_roster(UUID) TO authenticated;
