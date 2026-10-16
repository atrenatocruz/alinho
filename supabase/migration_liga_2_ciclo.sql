-- supabase/migration_liga_2_ciclo.sql
-- ════════════════════════════════════════════════════════════════════════
-- Liga entre Clubes — Fase 1, parte 2: criar, editar, publicar, cancelar e
-- apagar ligas; categorias; co-organizadores; avisos no sino.
-- Correr primeiro: migration_liga_1_base.sql.
--
-- «O que impede alguém de chamar isto diretamente?» (CLAUDE.md): cada RPC
-- verifica quem chama logo no início — dono (league_is_owner), organizador
-- (can_manage_league) ou admin do clube dono. O tipo da liga NUNCA muda
-- depois de criada: não há parâmetro para isso.
-- ════════════════════════════════════════════════════════════════════════

-- ── Internas (sem EXECUTE para ninguém) ────────────────────────────────
CREATE OR REPLACE FUNCTION league_log(p_league_id UUID, p_encounter_id UUID, p_kind TEXT, p_payload JSONB DEFAULT '{}'::jsonb)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO league_events (league_id, encounter_id, actor_id, kind, payload)
  VALUES (p_league_id, p_encounter_id, auth.uid(), p_kind, COALESCE(p_payload, '{}'::jsonb));
$$;

-- Avisos no sino. Nunca a quem fez a ação; sem repetidos.
CREATE OR REPLACE FUNCTION league_notify(p_user_ids UUID[], p_kind TEXT, p_data JSONB)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO notifications (user_id, kind, actor_id, data)
  SELECT DISTINCT u, p_kind, auth.uid(), p_data
    FROM unnest(p_user_ids) AS u
   WHERE u IS NOT NULL AND u IS DISTINCT FROM auth.uid();
$$;

-- Quem fala por uma equipa: os admins do clube e os capitães.
CREATE OR REPLACE FUNCTION league_team_rep_ids(p_team_id UUID)
RETURNS SETOF UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.user_id FROM league_teams t JOIN memberships m ON m.organization_id = t.organization_id AND m.is_admin
   WHERE t.id = p_team_id
  UNION
  SELECT c.user_id FROM league_captains c WHERE c.team_id = p_team_id;
$$;

-- Quem organiza: os donos (admins do clube dono, ou da plataforma na Liga
-- Alinho) e os co-organizadores.
CREATE OR REPLACE FUNCTION league_manager_ids(p_league_id UUID)
RETURNS SETOF UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.user_id FROM leagues l JOIN memberships m ON m.organization_id = l.owner_org_id AND m.is_admin
   WHERE l.id = p_league_id AND l.kind = 'comunitaria'
  UNION
  SELECT p.id FROM leagues l JOIN profiles p ON p.is_platform_admin
   WHERE l.id = p_league_id AND l.kind = 'alinho'
  UNION
  SELECT o.user_id FROM league_organizers o WHERE o.league_id = p_league_id;
$$;

CREATE OR REPLACE FUNCTION league_slugify(p_name TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT trim(BOTH '-' FROM regexp_replace(lower(translate(p_name,
    'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
    'aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn')), '[^a-z0-9]+', '-', 'g'));
$$;

-- ── Criar ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION create_league(
  p_kind TEXT, p_owner_org_id UUID, p_name TEXT, p_scope TEXT, p_district TEXT,
  p_season_label TEXT, p_description TEXT, p_applications_close_at TIMESTAMPTZ, p_max_teams INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me UUID := auth.uid();
  v_org organizations;
  v_id UUID;
  v_slug TEXT;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  IF p_kind = 'alinho' THEN
    -- Só a plataforma cria Liga Alinho — nunca por dados do cliente.
    IF NOT league_is_platform_admin() THEN RAISE EXCEPTION 'not_platform_admin'; END IF;
    p_owner_org_id := NULL;
  ELSIF p_kind = 'comunitaria' THEN
    SELECT * INTO v_org FROM organizations WHERE id = p_owner_org_id;
    IF v_org.id IS NULL OR NOT is_org_admin(p_owner_org_id) THEN RAISE EXCEPTION 'not_club_admin'; END IF;
    -- Grupos não criam ligas (spec): só clubes.
    IF v_org.kind IS DISTINCT FROM 'club' THEN RAISE EXCEPTION 'groups_cannot_create'; END IF;
  ELSE
    RAISE EXCEPTION 'kind_invalid';
  END IF;
  IF length(trim(COALESCE(p_name, ''))) NOT BETWEEN 3 AND 80 THEN RAISE EXCEPTION 'name_invalid'; END IF;
  IF COALESCE(p_scope, '') NOT IN ('local', 'regional', 'nacional') THEN RAISE EXCEPTION 'scope_invalid'; END IF;
  IF p_max_teams IS NOT NULL AND p_max_teams NOT BETWEEN 2 AND 64 THEN RAISE EXCEPTION 'max_teams_invalid'; END IF;
  IF p_applications_close_at IS NOT NULL AND p_applications_close_at < NOW() THEN RAISE EXCEPTION 'deadline_past'; END IF;

  v_slug := league_slugify(p_name) || '-' || substr(md5(gen_random_uuid()::text), 1, 5);
  INSERT INTO leagues (slug, name, kind, owner_org_id, scope, district, season_label, description,
                       applications_close_at, max_teams_per_category, created_by)
  VALUES (v_slug, trim(p_name), p_kind, p_owner_org_id, p_scope, NULLIF(trim(p_district), ''),
          NULLIF(trim(p_season_label), ''), NULLIF(trim(p_description), ''), p_applications_close_at, p_max_teams, v_me)
  RETURNING id INTO v_id;
  PERFORM league_log(v_id, NULL, 'league_created', jsonb_build_object('kind', p_kind));
  RETURN jsonb_build_object('id', v_id, 'slug', v_slug);
END;
$$;

CREATE OR REPLACE FUNCTION update_league(
  p_league_id UUID, p_name TEXT, p_scope TEXT, p_district TEXT, p_season_label TEXT,
  p_description TEXT, p_applications_close_at TIMESTAMPTZ, p_max_teams INTEGER)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_l leagues;
BEGIN
  SELECT * INTO v_l FROM leagues WHERE id = p_league_id FOR UPDATE;
  IF v_l.id IS NULL THEN RAISE EXCEPTION 'league_not_found'; END IF;
  IF NOT can_manage_league(p_league_id) THEN RAISE EXCEPTION 'not_league_manager'; END IF;
  IF v_l.status IN ('terminada', 'cancelada') THEN RAISE EXCEPTION 'league_closed'; END IF;
  IF length(trim(COALESCE(p_name, ''))) NOT BETWEEN 3 AND 80 THEN RAISE EXCEPTION 'name_invalid'; END IF;
  IF COALESCE(p_scope, '') NOT IN ('local', 'regional', 'nacional') THEN RAISE EXCEPTION 'scope_invalid'; END IF;
  IF p_max_teams IS NOT NULL AND p_max_teams NOT BETWEEN 2 AND 64 THEN RAISE EXCEPTION 'max_teams_invalid'; END IF;
  UPDATE leagues
     SET name = trim(p_name), scope = p_scope, district = NULLIF(trim(p_district), ''),
         season_label = NULLIF(trim(p_season_label), ''), description = NULLIF(trim(p_description), ''),
         applications_close_at = p_applications_close_at, max_teams_per_category = p_max_teams
   WHERE id = p_league_id;
  PERFORM league_log(p_league_id, NULL, 'league_updated');
END;
$$;

CREATE OR REPLACE FUNCTION publish_league(p_league_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_l leagues;
BEGIN
  SELECT * INTO v_l FROM leagues WHERE id = p_league_id FOR UPDATE;
  IF v_l.id IS NULL THEN RAISE EXCEPTION 'league_not_found'; END IF;
  IF NOT can_manage_league(p_league_id) THEN RAISE EXCEPTION 'not_league_manager'; END IF;
  IF v_l.status <> 'rascunho' THEN RAISE EXCEPTION 'league_not_draft'; END IF;
  IF NOT EXISTS (SELECT 1 FROM league_categories WHERE league_id = p_league_id) THEN RAISE EXCEPTION 'no_categories'; END IF;
  UPDATE leagues SET status = 'inscricoes' WHERE id = p_league_id;
  PERFORM league_log(p_league_id, NULL, 'league_published');
END;
$$;

-- Cancelar: só o dono. Encontros por jogar ficam cancelados; o que já é
-- oficial fica no histórico.
CREATE OR REPLACE FUNCTION cancel_league(p_league_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT league_is_owner(p_league_id) THEN RAISE EXCEPTION 'not_league_owner'; END IF;
  UPDATE leagues SET status = 'cancelada' WHERE id = p_league_id AND status NOT IN ('terminada', 'cancelada');
  IF NOT FOUND THEN RAISE EXCEPTION 'league_closed'; END IF;
  UPDATE league_encounters SET status = 'cancelado' WHERE league_id = p_league_id AND status <> 'oficial';
  PERFORM league_log(p_league_id, NULL, 'league_cancelled');
  PERFORM league_notify(ARRAY(SELECT league_team_rep_ids(t.id) FROM league_teams t
                               WHERE t.league_id = p_league_id AND t.status IN ('aprovada', 'pendente', 'suplente')),
                        'league_cancelled', jsonb_build_object('league_id', p_league_id,
                          'league_name', (SELECT name FROM leagues WHERE id = p_league_id)));
END;
$$;

-- Apagar: só o dono, e só antes de haver encontros (depois, cancelar).
CREATE OR REPLACE FUNCTION delete_league(p_league_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT league_is_owner(p_league_id) THEN RAISE EXCEPTION 'not_league_owner'; END IF;
  IF EXISTS (SELECT 1 FROM league_encounters WHERE league_id = p_league_id) THEN RAISE EXCEPTION 'league_has_encounters'; END IF;
  DELETE FROM leagues WHERE id = p_league_id;
END;
$$;

-- ── Categorias ─────────────────────────────────────────────────────────
-- Os mesmos limites de src/lib/leagueConfig.js. Só se mexe enquanto a
-- categoria está em inscrições (antes do calendário).
CREATE OR REPLACE FUNCTION upsert_league_category(
  p_league_id UUID, p_category_id UUID, p_gender TEXT, p_level INTEGER, p_rating_tolerance INTEGER,
  p_matches_per_encounter INTEGER, p_home_away BOOLEAN, p_points_win INTEGER, p_points_draw INTEGER,
  p_points_loss INTEGER, p_points_walkover INTEGER, p_roster_max INTEGER, p_roster_locks_at_round INTEGER)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_l leagues; v_c league_categories; v_id UUID;
BEGIN
  SELECT * INTO v_l FROM leagues WHERE id = p_league_id;
  IF v_l.id IS NULL THEN RAISE EXCEPTION 'league_not_found'; END IF;
  IF NOT can_manage_league(p_league_id) THEN RAISE EXCEPTION 'not_league_manager'; END IF;
  IF v_l.status IN ('terminada', 'cancelada') THEN RAISE EXCEPTION 'league_closed'; END IF;
  IF COALESCE(p_gender, '') NOT IN ('masculino', 'feminino', 'misto') THEN RAISE EXCEPTION 'gender_invalid'; END IF;
  IF p_level IS NULL OR p_level NOT BETWEEN 1 AND 7 THEN RAISE EXCEPTION 'level_invalid'; END IF;
  IF p_rating_tolerance IS NULL OR p_rating_tolerance NOT BETWEEN 0 AND 200 THEN RAISE EXCEPTION 'tolerance_invalid'; END IF;
  IF p_matches_per_encounter IS NULL OR p_matches_per_encounter NOT IN (1, 2, 3, 5) THEN RAISE EXCEPTION 'matches_invalid'; END IF;
  IF NOT (p_points_win > p_points_draw AND p_points_draw >= p_points_loss AND p_points_loss >= p_points_walkover) THEN
    RAISE EXCEPTION 'points_invalid';
  END IF;
  IF p_roster_max IS NULL OR p_roster_max < p_matches_per_encounter * 2 OR p_roster_max > 40 THEN RAISE EXCEPTION 'roster_max_invalid'; END IF;
  IF p_roster_locks_at_round IS NULL OR p_roster_locks_at_round < 1 THEN RAISE EXCEPTION 'lock_round_invalid'; END IF;

  IF p_category_id IS NULL THEN
    BEGIN
      INSERT INTO league_categories (league_id, gender, level, rating_tolerance, matches_per_encounter, home_away,
        points_win, points_draw, points_loss, points_walkover, roster_max, roster_locks_at_round)
      VALUES (p_league_id, p_gender, p_level, p_rating_tolerance, p_matches_per_encounter, COALESCE(p_home_away, FALSE),
        p_points_win, p_points_draw, p_points_loss, p_points_walkover, p_roster_max, p_roster_locks_at_round)
      RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'category_exists';
    END;
  ELSE
    SELECT * INTO v_c FROM league_categories WHERE id = p_category_id AND league_id = p_league_id FOR UPDATE;
    IF v_c.id IS NULL THEN RAISE EXCEPTION 'category_not_found'; END IF;
    IF v_c.status <> 'inscricoes' OR EXISTS (SELECT 1 FROM league_rounds WHERE category_id = v_c.id) THEN
      RAISE EXCEPTION 'category_started';
    END IF;
    BEGIN
      UPDATE league_categories
         SET gender = p_gender, level = p_level, rating_tolerance = p_rating_tolerance,
             matches_per_encounter = p_matches_per_encounter, home_away = COALESCE(p_home_away, FALSE),
             points_win = p_points_win, points_draw = p_points_draw, points_loss = p_points_loss,
             points_walkover = p_points_walkover, roster_max = p_roster_max, roster_locks_at_round = p_roster_locks_at_round
       WHERE id = v_c.id;
    EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'category_exists';
    END;
    v_id := v_c.id;
  END IF;
  PERFORM league_log(p_league_id, NULL, 'category_saved', jsonb_build_object('category_id', v_id));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION delete_league_category(p_category_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_c league_categories;
BEGIN
  SELECT * INTO v_c FROM league_categories WHERE id = p_category_id FOR UPDATE;
  IF v_c.id IS NULL THEN RAISE EXCEPTION 'category_not_found'; END IF;
  IF NOT can_manage_league(v_c.league_id) THEN RAISE EXCEPTION 'not_league_manager'; END IF;
  IF v_c.status <> 'inscricoes' OR EXISTS (SELECT 1 FROM league_teams WHERE category_id = v_c.id AND status = 'aprovada') THEN
    RAISE EXCEPTION 'category_started';
  END IF;
  DELETE FROM league_categories WHERE id = v_c.id;
  PERFORM league_log(v_c.league_id, NULL, 'category_deleted', jsonb_build_object('category_id', v_c.id));
END;
$$;

-- ── Co-organizadores ───────────────────────────────────────────────────
-- Só o dono nomeia. Um co-organizador nunca se promove (não há RPC para
-- isso) e só se pode tirar a si próprio.
CREATE OR REPLACE FUNCTION add_league_organizer(p_league_id UUID, p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT league_is_owner(p_league_id) THEN RAISE EXCEPTION 'not_league_owner'; END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id) THEN RAISE EXCEPTION 'user_not_found'; END IF;
  INSERT INTO league_organizers (league_id, user_id, added_by) VALUES (p_league_id, p_user_id, auth.uid())
  ON CONFLICT DO NOTHING;
  PERFORM league_log(p_league_id, NULL, 'organizer_added', jsonb_build_object('user_id', p_user_id));
  PERFORM league_notify(ARRAY[p_user_id], 'league_organizer_added',
    jsonb_build_object('league_id', p_league_id, 'league_slug', (SELECT slug FROM leagues WHERE id = p_league_id),
                       'league_name', (SELECT name FROM leagues WHERE id = p_league_id)));
END;
$$;

CREATE OR REPLACE FUNCTION remove_league_organizer(p_league_id UUID, p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (league_is_owner(p_league_id) OR p_user_id = auth.uid()) THEN RAISE EXCEPTION 'not_league_owner'; END IF;
  DELETE FROM league_organizers WHERE league_id = p_league_id AND user_id = p_user_id;
  PERFORM league_log(p_league_id, NULL, 'organizer_removed', jsonb_build_object('user_id', p_user_id));
END;
$$;

REVOKE ALL ON FUNCTION league_log(UUID, UUID, TEXT, JSONB), league_notify(UUID[], TEXT, JSONB),
  league_team_rep_ids(UUID), league_manager_ids(UUID) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION create_league(TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, INTEGER),
  update_league(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, INTEGER), publish_league(UUID), cancel_league(UUID),
  delete_league(UUID), upsert_league_category(UUID, UUID, TEXT, INTEGER, INTEGER, INTEGER, BOOLEAN, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER),
  delete_league_category(UUID), add_league_organizer(UUID, UUID), remove_league_organizer(UUID, UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION create_league(TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, INTEGER),
  update_league(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, INTEGER), publish_league(UUID), cancel_league(UUID),
  delete_league(UUID), upsert_league_category(UUID, UUID, TEXT, INTEGER, INTEGER, INTEGER, BOOLEAN, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER),
  delete_league_category(UUID), add_league_organizer(UUID, UUID), remove_league_organizer(UUID, UUID) TO authenticated;
