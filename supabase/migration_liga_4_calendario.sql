-- supabase/migration_liga_4_calendario.sql
-- ════════════════════════════════════════════════════════════════════════
-- Liga entre Clubes — Fase 1, parte 4: gravar o calendário e marcar datas.
-- Correr primeiro: migrações 1 a 3.
--
-- O calendário é calculado no browser (src/lib/leagueSchedule.js) e aqui só
-- se VALIDA: todas as equipas aprovadas, ninguém duas vezes por jornada, cada
-- par uma vez (casa e fora: cada ordem uma vez), número certo de jornadas.
-- Assim o algoritmo vive num sítio só e o servidor continua a mandar.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION save_league_schedule(p_category_id UUID, p_rounds JSONB, p_first_start DATE, p_round_days INTEGER)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_c league_categories; v_l leagues;
  v_n INTEGER; v_expected_rounds INTEGER; v_expected_pairs INTEGER; v_pairs INTEGER; v_rounds INTEGER;
  v_round_id UUID; r INTEGER; v_flat JSONB;
BEGIN
  SELECT * INTO v_c FROM league_categories WHERE id = p_category_id FOR UPDATE;
  IF v_c.id IS NULL THEN RAISE EXCEPTION 'category_not_found'; END IF;
  IF NOT can_manage_league(v_c.league_id) THEN RAISE EXCEPTION 'not_league_manager'; END IF;
  SELECT * INTO v_l FROM leagues WHERE id = v_c.league_id FOR UPDATE;
  IF v_l.status NOT IN ('inscricoes', 'a_decorrer') THEN RAISE EXCEPTION 'league_closed'; END IF;
  IF v_c.status = 'terminada' THEN RAISE EXCEPTION 'category_finished'; END IF;
  -- Refazer o calendário só enquanto nada foi jogado.
  IF EXISTS (SELECT 1 FROM league_encounters WHERE category_id = v_c.id AND status IN ('submetido', 'contestado', 'oficial')) THEN
    RAISE EXCEPTION 'schedule_has_results';
  END IF;
  IF p_first_start IS NULL OR p_round_days IS NULL OR p_round_days NOT BETWEEN 3 AND 60 THEN RAISE EXCEPTION 'schedule_dates'; END IF;

  SELECT count(*) INTO v_n FROM league_teams WHERE category_id = v_c.id AND status = 'aprovada';
  IF v_n < 2 THEN RAISE EXCEPTION 'not_enough_teams'; END IF;

  -- Achata o JSON numa só lista (sem tabela temporária: pg_temp não pode ser sequestrado).
  SELECT COALESCE(jsonb_agg(jsonb_build_object('num', x.ri, 'home', e->>'home', 'away', e->>'away')), '[]'::jsonb) INTO v_flat
    FROM jsonb_array_elements(p_rounds) WITH ORDINALITY AS x(rnd, ri), jsonb_array_elements(x.rnd) AS e;

  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(v_flat) AS q(num INTEGER, home UUID, away UUID)
              WHERE home IS NULL OR away IS NULL OR home = away
                 OR home NOT IN (SELECT id FROM league_teams WHERE category_id = v_c.id AND status = 'aprovada')
                 OR away NOT IN (SELECT id FROM league_teams WHERE category_id = v_c.id AND status = 'aprovada')) THEN
    RAISE EXCEPTION 'schedule_team_invalid';
  END IF;
  IF EXISTS (SELECT 1 FROM (SELECT num, home AS t FROM jsonb_to_recordset(v_flat) AS q(num INTEGER, home UUID, away UUID)
                            UNION ALL SELECT num, away FROM jsonb_to_recordset(v_flat) AS q(num INTEGER, home UUID, away UUID)) s
              GROUP BY num, t HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'schedule_team_twice';
  END IF;

  v_expected_rounds := (CASE WHEN v_n % 2 = 0 THEN v_n - 1 ELSE v_n END) * (CASE WHEN v_c.home_away THEN 2 ELSE 1 END);
  v_expected_pairs := v_n * (v_n - 1) / 2 * (CASE WHEN v_c.home_away THEN 2 ELSE 1 END);
  SELECT count(DISTINCT num), COALESCE(max(num), 0) INTO v_rounds, r FROM jsonb_to_recordset(v_flat) AS q(num INTEGER, home UUID, away UUID);
  IF v_rounds <> v_expected_rounds OR r <> v_expected_rounds THEN RAISE EXCEPTION 'schedule_rounds'; END IF;
  IF v_c.home_away THEN
    IF EXISTS (SELECT 1 FROM jsonb_to_recordset(v_flat) AS q(num INTEGER, home UUID, away UUID) GROUP BY home, away HAVING count(*) <> 1) THEN
      RAISE EXCEPTION 'schedule_pairs';
    END IF;
    SELECT count(*) INTO v_pairs FROM (SELECT DISTINCT home, away FROM jsonb_to_recordset(v_flat) AS q(num INTEGER, home UUID, away UUID)) s;
  ELSE
    IF EXISTS (SELECT 1 FROM jsonb_to_recordset(v_flat) AS q(num INTEGER, home UUID, away UUID)
                GROUP BY least(home, away), greatest(home, away) HAVING count(*) <> 1) THEN
      RAISE EXCEPTION 'schedule_pairs';
    END IF;
    SELECT count(*) INTO v_pairs FROM (SELECT DISTINCT least(home, away), greatest(home, away) FROM jsonb_to_recordset(v_flat) AS q(num INTEGER, home UUID, away UUID)) s;
  END IF;
  IF v_pairs <> v_expected_pairs THEN RAISE EXCEPTION 'schedule_pairs'; END IF;

  -- Tudo certo: substitui o calendário anterior (nada estava jogado).
  DELETE FROM league_rounds WHERE category_id = v_c.id;
  FOR r IN 1..v_expected_rounds LOOP
    INSERT INTO league_rounds (league_id, category_id, number, window_start, window_end)
    VALUES (v_c.league_id, v_c.id, r, p_first_start + (r - 1) * p_round_days, p_first_start + r * p_round_days - 1)
    RETURNING id INTO v_round_id;
    INSERT INTO league_encounters (league_id, category_id, round_id, home_team_id, away_team_id)
    SELECT v_c.league_id, v_c.id, v_round_id, q.home, q.away FROM jsonb_to_recordset(v_flat) AS q(num INTEGER, home UUID, away UUID) WHERE q.num = r;
  END LOOP;

  UPDATE league_categories SET status = 'a_decorrer' WHERE id = v_c.id;
  UPDATE leagues SET status = 'a_decorrer' WHERE id = v_l.id AND status = 'inscricoes';
  PERFORM league_log(v_l.id, NULL, 'schedule_saved', jsonb_build_object('category_id', v_c.id, 'pairs', v_pairs));
  PERFORM league_notify(ARRAY(SELECT league_team_rep_ids(t.id) FROM league_teams t WHERE t.category_id = v_c.id AND t.status = 'aprovada'),
    'league_schedule_published', jsonb_build_object('league_id', v_l.id, 'league_slug', v_l.slug, 'league_name', v_l.name,
                                                    'category_id', v_c.id));
  RETURN v_pairs;
END;
$$;

-- O lado de quem chama num encontro: 'home', 'away' ou NULL.
CREATE OR REPLACE FUNCTION league_side(p_e league_encounters)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN represents_league_team(p_e.home_team_id) AND represents_league_team(p_e.away_team_id) THEN 'both'
              WHEN represents_league_team(p_e.home_team_id) THEN 'home'
              WHEN represents_league_team(p_e.away_team_id) THEN 'away' END;
$$;

CREATE OR REPLACE FUNCTION league_check_window(p_e league_encounters, p_when TIMESTAMPTZ)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_r league_rounds;
BEGIN
  SELECT * INTO v_r FROM league_rounds WHERE id = p_e.round_id;
  -- O dia conta em Lisboa (como o resto da app). Sem ronda ou sem data → fora da janela.
  IF v_r.id IS NULL OR p_when IS NULL
     OR ((p_when AT TIME ZONE 'Europe/Lisbon')::date BETWEEN v_r.window_start AND v_r.window_end) IS NOT TRUE THEN
    RAISE EXCEPTION 'outside_window';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION propose_encounter_time(p_encounter_id UUID, p_when TIMESTAMPTZ, p_venue TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_e league_encounters; v_side TEXT; v_team UUID; v_other UUID;
BEGIN
  SELECT * INTO v_e FROM league_encounters WHERE id = p_encounter_id FOR UPDATE;
  IF v_e.id IS NULL THEN RAISE EXCEPTION 'encounter_not_found'; END IF;
  v_side := league_side(v_e);
  IF v_side IS NULL THEN RAISE EXCEPTION 'not_team_rep'; END IF;
  IF v_side = 'both' THEN RAISE EXCEPTION 'conflict_of_interest'; END IF;
  IF p_when IS NULL THEN RAISE EXCEPTION 'schedule_dates'; END IF;
  IF v_e.status NOT IN ('por_marcar', 'proposto', 'marcado') THEN RAISE EXCEPTION 'encounter_locked'; END IF;
  PERFORM league_check_window(v_e, p_when);
  v_team := CASE v_side WHEN 'home' THEN v_e.home_team_id ELSE v_e.away_team_id END;
  v_other := CASE v_side WHEN 'home' THEN v_e.away_team_id ELSE v_e.home_team_id END;
  UPDATE league_encounters
     SET scheduled_at = p_when, venue_text = NULLIF(trim(p_venue), ''), status = 'proposto', proposed_by_team_id = v_team
   WHERE id = p_encounter_id;
  PERFORM league_log(v_e.league_id, v_e.id, 'time_proposed', jsonb_build_object('when', p_when, 'team_id', v_team));
  PERFORM league_notify(ARRAY(SELECT league_team_rep_ids(v_other)), 'league_time_proposed',
    jsonb_build_object('league_id', v_e.league_id, 'league_slug', (SELECT slug FROM leagues WHERE id = v_e.league_id),
                       'encounter_id', v_e.id, 'when', p_when, 'league_name', (SELECT name FROM leagues WHERE id = v_e.league_id)));
END;
$$;

CREATE OR REPLACE FUNCTION accept_encounter_time(p_encounter_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_e league_encounters; v_side TEXT; v_team UUID;
BEGIN
  SELECT * INTO v_e FROM league_encounters WHERE id = p_encounter_id FOR UPDATE;
  IF v_e.id IS NULL THEN RAISE EXCEPTION 'encounter_not_found'; END IF;
  v_side := league_side(v_e);
  IF v_side IS NULL THEN RAISE EXCEPTION 'not_team_rep'; END IF;
  IF v_side = 'both' THEN RAISE EXCEPTION 'conflict_of_interest'; END IF;
  IF v_e.status <> 'proposto' THEN RAISE EXCEPTION 'nothing_to_accept'; END IF;
  v_team := CASE v_side WHEN 'home' THEN v_e.home_team_id ELSE v_e.away_team_id END;
  IF v_team = v_e.proposed_by_team_id THEN RAISE EXCEPTION 'not_your_proposal'; END IF;
  UPDATE league_encounters SET status = 'marcado' WHERE id = p_encounter_id;
  PERFORM league_log(v_e.league_id, v_e.id, 'time_accepted', jsonb_build_object('when', v_e.scheduled_at));
  PERFORM league_notify(ARRAY(SELECT league_team_rep_ids(v_e.proposed_by_team_id)), 'league_time_accepted',
    jsonb_build_object('league_id', v_e.league_id, 'league_slug', (SELECT slug FROM leagues WHERE id = v_e.league_id),
                       'encounter_id', v_e.id, 'when', v_e.scheduled_at, 'league_name', (SELECT name FROM leagues WHERE id = v_e.league_id)));
END;
$$;

-- Quem organiza pode marcar diretamente (o recurso quando os clubes não se entendem).
CREATE OR REPLACE FUNCTION set_encounter_time(p_encounter_id UUID, p_when TIMESTAMPTZ, p_venue TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_e league_encounters;
BEGIN
  SELECT * INTO v_e FROM league_encounters WHERE id = p_encounter_id FOR UPDATE;
  IF v_e.id IS NULL THEN RAISE EXCEPTION 'encounter_not_found'; END IF;
  IF NOT can_manage_league(v_e.league_id) THEN RAISE EXCEPTION 'not_league_manager'; END IF;
  IF p_when IS NULL THEN RAISE EXCEPTION 'schedule_dates'; END IF;
  IF v_e.status NOT IN ('por_marcar', 'proposto', 'marcado') THEN RAISE EXCEPTION 'encounter_locked'; END IF;
  UPDATE league_encounters SET scheduled_at = p_when, venue_text = NULLIF(trim(p_venue), ''), status = 'marcado', proposed_by_team_id = NULL
   WHERE id = p_encounter_id;
  PERFORM league_log(v_e.league_id, v_e.id, 'time_set_by_organizer', jsonb_build_object('when', p_when));
  PERFORM league_notify(ARRAY(SELECT league_team_rep_ids(v_e.home_team_id) UNION SELECT league_team_rep_ids(v_e.away_team_id)),
    'league_time_accepted', jsonb_build_object('league_id', v_e.league_id, 'league_slug', (SELECT slug FROM leagues WHERE id = v_e.league_id),
                                               'encounter_id', v_e.id, 'when', p_when, 'league_name', (SELECT name FROM leagues WHERE id = v_e.league_id)));
END;
$$;

REVOKE ALL ON FUNCTION league_side(league_encounters), league_check_window(league_encounters, TIMESTAMPTZ) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION save_league_schedule(UUID, JSONB, DATE, INTEGER), propose_encounter_time(UUID, TIMESTAMPTZ, TEXT),
  accept_encounter_time(UUID), set_encounter_time(UUID, TIMESTAMPTZ, TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION save_league_schedule(UUID, JSONB, DATE, INTEGER), propose_encounter_time(UUID, TIMESTAMPTZ, TEXT),
  accept_encounter_time(UUID), set_encounter_time(UUID, TIMESTAMPTZ, TEXT) TO authenticated;
