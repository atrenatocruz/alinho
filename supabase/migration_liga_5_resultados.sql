-- supabase/migration_liga_5_resultados.sql
-- ════════════════════════════════════════════════════════════════════════
-- Liga entre Clubes — Fase 1, parte 5: resultados e o que eles mexem.
-- Correr primeiro: migrações 1 a 4. Antes, ver Task 9 Step 1 (xp_events).
--
-- Fluxo (spec §10): um lado submete → o OUTRO lado confirma (oficial) ou
-- contesta → quem organiza resolve. Só o oficial mexe no ranking global
-- (apply_elo_pairing, decisão do Renato a 16 out), em player_stats do clube
-- que cada jogador representa, e no XP. Corrigir um oficial reverte e
-- reaplica com o que ficou guardado em applied_snapshot (o padrão de
-- apply/reverse_group_match_ranking). O XP não se retira (é monotónico, como
-- no resto da app) e o índice único impede que se repita.
-- ════════════════════════════════════════════════════════════════════════

-- ── XP com origem na liga ──────────────────────────────────────────────
-- Sem FK de propósito: as partidas são atualizadas no sítio (nunca apagadas
-- depois de contarem), e um ON DELETE SET NULL deixaria a linha sem origem.
ALTER TABLE xp_events ADD COLUMN IF NOT EXISTS source_league_match_id UUID;
ALTER TABLE xp_events DROP CONSTRAINT IF EXISTS xp_events_kind_check;
ALTER TABLE xp_events ADD CONSTRAINT xp_events_kind_check CHECK (kind IN
  ('mix_participation', 'mix_games', 'mix_win', 'friendly_match', 'friendly_win', 'kudos', 'league_match', 'league_win'));
DO $$
DECLARE c TEXT;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'xp_events'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%source_game_id IS NOT NULL%' AND conname <> 'xp_events_source_check';
  IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE xp_events DROP CONSTRAINT %I', c); END IF;
END $$;
ALTER TABLE xp_events DROP CONSTRAINT IF EXISTS xp_events_source_check;
ALTER TABLE xp_events ADD CONSTRAINT xp_events_source_check
  CHECK (source_game_id IS NOT NULL OR source_private_match_id IS NOT NULL OR source_league_match_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS xp_events_league_once
  ON xp_events (user_id, kind, source_league_match_id) WHERE source_league_match_id IS NOT NULL;

-- ── Validar uma partida (igual a src/lib/leagueResult.js) ──────────────
CREATE OR REPLACE FUNCTION league_match_winner(p_sets JSONB)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE n INTEGER; i INTEGER; h INTEGER; a INTEGER; hi INTEGER; lo INTEGER; wh INTEGER := 0; wa INTEGER := 0;
BEGIN
  IF jsonb_typeof(p_sets) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'sets_count'; END IF;
  n := jsonb_array_length(p_sets);
  IF n < 2 OR n > 3 THEN RAISE EXCEPTION 'sets_count'; END IF;
  FOR i IN 0..n - 1 LOOP
    IF wh = 2 OR wa = 2 THEN RAISE EXCEPTION 'sets_after_win'; END IF;
    IF jsonb_typeof(p_sets->i) IS DISTINCT FROM 'array' OR jsonb_array_length(p_sets->i) <> 2
       OR jsonb_typeof(p_sets->i->0) <> 'number' OR jsonb_typeof(p_sets->i->1) <> 'number' THEN
      RAISE EXCEPTION 'set_invalid';
    END IF;
    IF (p_sets->i->>0)::numeric <> floor((p_sets->i->>0)::numeric) OR (p_sets->i->>1)::numeric <> floor((p_sets->i->>1)::numeric) THEN
      RAISE EXCEPTION 'set_invalid';
    END IF;
    h := (p_sets->i->>0)::int; a := (p_sets->i->>1)::int;
    IF h < 0 OR a < 0 THEN RAISE EXCEPTION 'set_invalid'; END IF;
    hi := greatest(h, a); lo := least(h, a);
    IF i = 2 AND hi >= 10 THEN
      IF NOT (hi - lo >= 2 AND (hi = 10 OR hi - lo = 2)) THEN RAISE EXCEPTION 'set_invalid'; END IF;
    ELSIF NOT ((hi = 6 AND lo <= 4) OR (hi = 7 AND lo IN (5, 6))) THEN
      RAISE EXCEPTION 'set_invalid';
    END IF;
    IF h > a THEN wh := wh + 1; ELSE wa := wa + 1; END IF;
  END LOOP;
  IF wh < 2 AND wa < 2 THEN RAISE EXCEPTION 'no_winner'; END IF;
  RETURN CASE WHEN wh > wa THEN 'home' ELSE 'away' END;
END;
$$;

-- Valida as duplas e os sets e grava (atualiza no sítio, por slot).
CREATE OR REPLACE FUNCTION league_save_matches(p_e league_encounters, p_matches JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_c league_categories; m JSONB; v_slot INTEGER; v_h1 UUID; v_h2 UUID; v_a1 UUID; v_a2 UUID;
  v_home_used UUID[] := '{}'; v_away_used UUID[] := '{}'; v_slots INTEGER[] := '{}'; v_winner TEXT; g TEXT[];
BEGIN
  SELECT * INTO v_c FROM league_categories WHERE id = p_e.category_id;
  IF jsonb_typeof(p_matches) IS DISTINCT FROM 'array' OR jsonb_array_length(p_matches) <> v_c.matches_per_encounter THEN
    RAISE EXCEPTION 'matches_count';
  END IF;
  FOR m IN SELECT * FROM jsonb_array_elements(p_matches) LOOP
    v_slot := (m->>'slot')::int;
    IF v_slot IS NULL OR v_slot NOT BETWEEN 1 AND v_c.matches_per_encounter OR v_slot = ANY (v_slots) THEN RAISE EXCEPTION 'slot_invalid'; END IF;
    v_slots := v_slots || v_slot;
    v_h1 := (m->'home'->>0)::uuid; v_h2 := (m->'home'->>1)::uuid;
    v_a1 := (m->'away'->>0)::uuid; v_a2 := (m->'away'->>1)::uuid;
    IF v_h1 IS NULL OR v_h2 IS NULL OR v_a1 IS NULL OR v_a2 IS NULL OR v_h1 = v_h2 OR v_a1 = v_a2 THEN RAISE EXCEPTION 'incomplete'; END IF;
    -- Ninguém joga duas partidas no mesmo encontro.
    IF v_h1 = ANY (v_home_used) OR v_h2 = ANY (v_home_used) OR v_a1 = ANY (v_away_used) OR v_a2 = ANY (v_away_used) THEN
      RAISE EXCEPTION 'player_twice';
    END IF;
    v_home_used := v_home_used || v_h1 || v_h2;
    v_away_used := v_away_used || v_a1 || v_a2;
    IF (SELECT count(*) FROM league_roster WHERE team_id = p_e.home_team_id AND removed_at IS NULL AND user_id IN (v_h1, v_h2)) <> 2
       OR (SELECT count(*) FROM league_roster WHERE team_id = p_e.away_team_id AND removed_at IS NULL AND user_id IN (v_a1, v_a2)) <> 2 THEN
      RAISE EXCEPTION 'not_in_roster';
    END IF;
    FOREACH g SLICE 1 IN ARRAY ARRAY[
      ARRAY[(SELECT gender FROM profiles WHERE id = v_h1), (SELECT gender FROM profiles WHERE id = v_h2)],
      ARRAY[(SELECT gender FROM profiles WHERE id = v_a1), (SELECT gender FROM profiles WHERE id = v_a2)]] LOOP
      IF v_c.gender = 'misto' THEN
        IF NOT ('masculino' = ANY (g) AND 'feminino' = ANY (g)) THEN RAISE EXCEPTION 'pair_gender'; END IF;
      ELSIF g[1] IS DISTINCT FROM v_c.gender OR g[2] IS DISTINCT FROM v_c.gender THEN
        RAISE EXCEPTION 'pair_gender';
      END IF;
    END LOOP;
    v_winner := league_match_winner(m->'sets');
    INSERT INTO league_matches (encounter_id, slot, home_p1, home_p2, away_p1, away_p2, sets, winner)
    VALUES (p_e.id, v_slot, v_h1, v_h2, v_a1, v_a2, m->'sets', v_winner)
    ON CONFLICT (encounter_id, slot) DO UPDATE
      SET home_p1 = EXCLUDED.home_p1, home_p2 = EXCLUDED.home_p2, away_p1 = EXCLUDED.away_p1,
          away_p2 = EXCLUDED.away_p2, sets = EXCLUDED.sets, winner = EXCLUDED.winner;
  END LOOP;
END;
$$;

-- ── Ranking ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION apply_league_encounter_ranking(p_encounter_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_e league_encounters; v_home_org UUID; v_away_org UUID; mt league_matches; pl RECORD; slotrec RECORD;
  v_snap JSONB := '[]'::jsonb; v_deltas JSONB; v_points JSONB; v_won JSONB; v_org JSONB;
  v_rules JSONB; v_is_won BOOLEAN; v_pts INTEGER; v_when TIMESTAMPTZ; v_n INTEGER; v_xp INTEGER;
BEGIN
  SELECT * INTO v_e FROM league_encounters WHERE id = p_encounter_id;
  IF v_e.ranked_applied OR v_e.walkover_team_id IS NOT NULL OR v_e.status <> 'oficial' THEN RETURN; END IF;
  SELECT organization_id INTO v_home_org FROM league_teams WHERE id = v_e.home_team_id;
  SELECT organization_id INTO v_away_org FROM league_teams WHERE id = v_e.away_team_id;
  v_when := COALESCE(v_e.scheduled_at, NOW());

  FOR mt IN SELECT * FROM league_matches WHERE encounter_id = v_e.id ORDER BY slot LOOP
    v_deltas := '{}'::jsonb; v_points := '{}'::jsonb; v_won := '{}'::jsonb; v_org := '{}'::jsonb;
    FOR pl IN SELECT * FROM apply_elo_pairing(mt.home_p1, mt.home_p2, mt.away_p1, mt.away_p2,
                                              CASE WHEN mt.winner = 'home' THEN 1 ELSE 0 END) LOOP
      v_deltas := v_deltas || jsonb_build_object(pl.pid::text, pl.delta);
    END LOOP;
    FOR slotrec IN SELECT * FROM (VALUES
        (mt.home_p1, 'home', v_home_org), (mt.home_p2, 'home', v_home_org),
        (mt.away_p1, 'away', v_away_org), (mt.away_p2, 'away', v_away_org)) AS t(pid, side, org) LOOP
      v_is_won := slotrec.side = mt.winner;
      SELECT points_rules INTO v_rules FROM organizations WHERE id = slotrec.org;
      v_rules := COALESCE(v_rules, '{"point_per_match_played": 1, "point_per_match_win": 3}'::jsonb);
      v_pts := COALESCE((v_rules->>'point_per_match_played')::int, 1)
             + CASE WHEN v_is_won THEN COALESCE((v_rules->>'point_per_match_win')::int, 3) ELSE 0 END;
      INSERT INTO player_stats (user_id, organization_id, game_wins, game_losses, mix_wins, mixes_played, total_points)
      VALUES (slotrec.pid, slotrec.org, CASE WHEN v_is_won THEN 1 ELSE 0 END, CASE WHEN v_is_won THEN 0 ELSE 1 END, 0, 0, v_pts)
      ON CONFLICT (user_id, organization_id) DO UPDATE
        SET game_wins = player_stats.game_wins + EXCLUDED.game_wins,
            game_losses = player_stats.game_losses + EXCLUDED.game_losses,
            total_points = player_stats.total_points + EXCLUDED.total_points,
            updated_at = NOW();
      v_points := v_points || jsonb_build_object(slotrec.pid::text, v_pts);
      v_won := v_won || jsonb_build_object(slotrec.pid::text, v_is_won);
      v_org := v_org || jsonb_build_object(slotrec.pid::text, slotrec.org);
      -- XP: 10 por partida, +5 a quem ganha (como o jogo entre amigos). Só o que
      -- foi realmente inserido entra em profiles.xp (um reaplicar não repete).
      v_xp := 0;
      INSERT INTO xp_events (user_id, organization_id, kind, source_league_match_id, amount, occurred_at)
      VALUES (slotrec.pid, slotrec.org, 'league_match', mt.id, 10, v_when) ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n > 0 THEN v_xp := v_xp + 10; END IF;
      IF v_is_won THEN
        INSERT INTO xp_events (user_id, organization_id, kind, source_league_match_id, amount, occurred_at)
        VALUES (slotrec.pid, slotrec.org, 'league_win', mt.id, 5, v_when) ON CONFLICT DO NOTHING;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        IF v_n > 0 THEN v_xp := v_xp + 5; END IF;
      END IF;
      UPDATE profiles
         SET xp = xp + v_xp, last_played_at = GREATEST(COALESCE(last_played_at, v_when), v_when)
       WHERE id = slotrec.pid;
    END LOOP;
    v_snap := v_snap || jsonb_build_array(jsonb_build_object('slot', mt.slot, 'deltas', v_deltas, 'points', v_points, 'won', v_won, 'org', v_org));
  END LOOP;
  UPDATE league_encounters SET ranked_applied = TRUE, applied_snapshot = v_snap WHERE id = v_e.id;
END;
$$;

CREATE OR REPLACE FUNCTION reverse_league_encounter_ranking(p_encounter_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_e league_encounters; s JSONB; k TEXT; v_won BOOLEAN;
BEGIN
  SELECT * INTO v_e FROM league_encounters WHERE id = p_encounter_id;
  IF NOT v_e.ranked_applied THEN RETURN; END IF;
  FOR s IN SELECT * FROM jsonb_array_elements(v_e.applied_snapshot) LOOP
    FOR k IN SELECT jsonb_object_keys(s->'points') LOOP
      v_won := (s->'won'->>k)::boolean;
      UPDATE profiles
         SET rating = GREATEST(0, COALESCE(rating, 900) - COALESCE((s->'deltas'->>k)::numeric, 0)),
             rating_games = GREATEST(0, rating_games - 1)
       WHERE id = k::uuid;
      UPDATE player_stats
         SET game_wins = GREATEST(0, game_wins - CASE WHEN v_won THEN 1 ELSE 0 END),
             game_losses = GREATEST(0, game_losses - CASE WHEN v_won THEN 0 ELSE 1 END),
             total_points = GREATEST(0, total_points - COALESCE((s->'points'->>k)::int, 0)),
             updated_at = NOW()
       WHERE user_id = k::uuid AND organization_id = (s->'org'->>k)::uuid;
    END LOOP;
  END LOOP;
  UPDATE league_encounters SET ranked_applied = FALSE, applied_snapshot = NULL WHERE id = v_e.id;
END;
$$;

-- ── O fluxo ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION submit_encounter_result(p_encounter_id UUID, p_matches JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_e league_encounters; v_side TEXT; v_team UUID; v_other UUID;
BEGIN
  SELECT * INTO v_e FROM league_encounters WHERE id = p_encounter_id FOR UPDATE;
  IF v_e.id IS NULL THEN RAISE EXCEPTION 'encounter_not_found'; END IF;
  v_side := league_side(v_e);
  IF v_side IS NULL THEN RAISE EXCEPTION 'not_team_rep'; END IF;
  -- Quem fala pelos dois clubes não pode fazer as duas metades do fluxo.
  IF v_side = 'both' THEN RAISE EXCEPTION 'conflict_of_interest'; END IF;
  IF v_e.status IN ('oficial', 'contestado', 'cancelado') THEN RAISE EXCEPTION 'encounter_locked'; END IF;
  v_team := CASE v_side WHEN 'home' THEN v_e.home_team_id ELSE v_e.away_team_id END;
  v_other := CASE v_side WHEN 'home' THEN v_e.away_team_id ELSE v_e.home_team_id END;
  IF v_e.status = 'submetido' AND v_e.submitted_by_team_id <> v_team THEN RAISE EXCEPTION 'already_submitted_by_other'; END IF;
  IF v_e.scheduled_at IS NOT NULL AND v_e.scheduled_at > NOW() THEN RAISE EXCEPTION 'not_played_yet'; END IF;
  PERFORM league_save_matches(v_e, p_matches);
  UPDATE league_encounters
     SET status = 'submetido', submitted_by = auth.uid(), submitted_by_team_id = v_team, submitted_at = NOW(),
         contested_by = NULL, contested_at = NULL, contest_reason = NULL
   WHERE id = v_e.id;
  PERFORM league_log(v_e.league_id, v_e.id, 'result_submitted', jsonb_build_object('team_id', v_team, 'matches', p_matches));
  PERFORM league_notify(ARRAY(SELECT league_team_rep_ids(v_other)), 'league_result_to_confirm',
    jsonb_build_object('league_id', v_e.league_id, 'league_slug', (SELECT slug FROM leagues WHERE id = v_e.league_id),
                       'encounter_id', v_e.id,
                       'club_name', (SELECT o.name FROM league_teams t JOIN organizations o ON o.id = t.organization_id WHERE t.id = v_team)));
END;
$$;

-- Confirmar e contestar: só o lado que NÃO submeteu, e nunca quem submeteu.
CREATE OR REPLACE FUNCTION league_check_answerer(p_e league_encounters)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_side TEXT; v_team UUID;
BEGIN
  IF p_e.status <> 'submetido' THEN RAISE EXCEPTION 'nothing_to_confirm'; END IF;
  v_side := league_side(p_e);
  IF v_side IS NULL THEN RAISE EXCEPTION 'not_team_rep'; END IF;
  IF v_side = 'both' THEN RAISE EXCEPTION 'conflict_of_interest'; END IF;
  v_team := CASE v_side WHEN 'home' THEN p_e.home_team_id ELSE p_e.away_team_id END;
  IF v_team = p_e.submitted_by_team_id OR auth.uid() = p_e.submitted_by THEN RAISE EXCEPTION 'cannot_confirm_own'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION confirm_encounter_result(p_encounter_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_e league_encounters;
BEGIN
  SELECT * INTO v_e FROM league_encounters WHERE id = p_encounter_id FOR UPDATE;
  IF v_e.id IS NULL THEN RAISE EXCEPTION 'encounter_not_found'; END IF;
  PERFORM league_check_answerer(v_e);
  UPDATE league_encounters SET status = 'oficial', confirmed_by = auth.uid(), confirmed_at = NOW() WHERE id = v_e.id;
  PERFORM apply_league_encounter_ranking(v_e.id);
  PERFORM league_log(v_e.league_id, v_e.id, 'result_confirmed');
  PERFORM league_notify(ARRAY(SELECT league_team_rep_ids(v_e.submitted_by_team_id)), 'league_result_confirmed',
    jsonb_build_object('league_id', v_e.league_id, 'league_slug', (SELECT slug FROM leagues WHERE id = v_e.league_id), 'encounter_id', v_e.id, 'league_name', (SELECT name FROM leagues WHERE id = v_e.league_id)));
END;
$$;

CREATE OR REPLACE FUNCTION contest_encounter_result(p_encounter_id UUID, p_reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_e league_encounters;
BEGIN
  SELECT * INTO v_e FROM league_encounters WHERE id = p_encounter_id FOR UPDATE;
  IF v_e.id IS NULL THEN RAISE EXCEPTION 'encounter_not_found'; END IF;
  PERFORM league_check_answerer(v_e);
  IF length(trim(COALESCE(p_reason, ''))) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'reason_required'; END IF;
  UPDATE league_encounters SET status = 'contestado', contested_by = auth.uid(), contested_at = NOW(), contest_reason = trim(p_reason)
   WHERE id = v_e.id;
  PERFORM league_log(v_e.league_id, v_e.id, 'result_contested', jsonb_build_object('reason', trim(p_reason)));
  PERFORM league_notify(ARRAY(SELECT league_manager_ids(v_e.league_id)), 'league_result_contested',
    jsonb_build_object('league_id', v_e.league_id, 'league_slug', (SELECT slug FROM leagues WHERE id = v_e.league_id),
                       'encounter_id', v_e.id, 'reason', trim(p_reason), 'league_name', (SELECT name FROM leagues WHERE id = v_e.league_id)));
END;
$$;

-- Resolver (disputa, falta de comparência ou correção de um oficial).
CREATE OR REPLACE FUNCTION resolve_encounter(p_encounter_id UUID, p_matches JSONB, p_walkover_team_id UUID, p_note TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_e league_encounters; v_before JSONB;
BEGIN
  SELECT * INTO v_e FROM league_encounters WHERE id = p_encounter_id FOR UPDATE;
  IF v_e.id IS NULL THEN RAISE EXCEPTION 'encounter_not_found'; END IF;
  IF NOT can_manage_league(v_e.league_id) THEN RAISE EXCEPTION 'not_league_manager'; END IF;
  -- Quem representa uma das equipas não decide o próprio encontro: resolve um organizador neutro.
  IF league_side(v_e) IS NOT NULL THEN RAISE EXCEPTION 'conflict_of_interest'; END IF;
  IF v_e.status = 'cancelado' THEN RAISE EXCEPTION 'encounter_locked'; END IF;
  IF length(trim(COALESCE(p_note, ''))) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'note_required'; END IF;
  IF p_walkover_team_id IS NOT NULL AND p_walkover_team_id NOT IN (v_e.home_team_id, v_e.away_team_id) THEN
    RAISE EXCEPTION 'walkover_team_invalid';
  END IF;
  v_before := (SELECT COALESCE(jsonb_agg(to_jsonb(m) - 'encounter_id' ORDER BY m.slot), '[]'::jsonb) FROM league_matches m WHERE m.encounter_id = v_e.id);

  PERFORM reverse_league_encounter_ranking(v_e.id);
  IF p_walkover_team_id IS NULL THEN
    PERFORM league_save_matches(v_e, p_matches);
  END IF;
  UPDATE league_encounters
     SET status = 'oficial', walkover_team_id = p_walkover_team_id,
         resolved_by = auth.uid(), resolved_at = NOW(), resolution_note = trim(p_note)
   WHERE id = v_e.id;
  PERFORM apply_league_encounter_ranking(v_e.id);
  PERFORM league_log(v_e.league_id, v_e.id, 'result_resolved',
    jsonb_build_object('before', v_before, 'matches', p_matches, 'walkover_team_id', p_walkover_team_id, 'note', trim(p_note)));
  PERFORM league_notify(ARRAY(SELECT league_team_rep_ids(v_e.home_team_id) UNION SELECT league_team_rep_ids(v_e.away_team_id)),
    'league_result_resolved', jsonb_build_object('league_id', v_e.league_id, 'league_slug', (SELECT slug FROM leagues WHERE id = v_e.league_id),
                                                 'encounter_id', v_e.id, 'note', trim(p_note), 'league_name', (SELECT name FROM leagues WHERE id = v_e.league_id)));
END;
$$;

-- Fechar uma categoria: sem encontros por oficializar (spec §11 — nunca
-- campeão com disputas pendentes). A Fase 1 acaba pela tabela.
CREATE OR REPLACE FUNCTION finish_league_category(p_category_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_c league_categories;
BEGIN
  SELECT * INTO v_c FROM league_categories WHERE id = p_category_id FOR UPDATE;
  IF v_c.id IS NULL THEN RAISE EXCEPTION 'category_not_found'; END IF;
  IF NOT can_manage_league(v_c.league_id) THEN RAISE EXCEPTION 'not_league_manager'; END IF;
  IF v_c.status <> 'a_decorrer' THEN RAISE EXCEPTION 'category_not_running'; END IF;
  IF EXISTS (SELECT 1 FROM league_encounters WHERE category_id = v_c.id AND status NOT IN ('oficial', 'cancelado')) THEN
    RAISE EXCEPTION 'pending_encounters';
  END IF;
  UPDATE league_categories SET status = 'terminada' WHERE id = v_c.id;
  UPDATE leagues SET status = 'terminada'
   WHERE id = v_c.league_id AND NOT EXISTS (SELECT 1 FROM league_categories WHERE league_id = v_c.league_id AND status <> 'terminada');
  PERFORM league_log(v_c.league_id, NULL, 'category_finished', jsonb_build_object('category_id', v_c.id));
  PERFORM league_notify(ARRAY(SELECT league_team_rep_ids(t.id) FROM league_teams t WHERE t.category_id = v_c.id AND t.status = 'aprovada'),
    'league_finished', jsonb_build_object('league_id', v_c.league_id, 'league_slug', (SELECT slug FROM leagues WHERE id = v_c.league_id),
                                          'category_id', v_c.id, 'league_name', (SELECT name FROM leagues WHERE id = v_c.league_id)));
END;
$$;

REVOKE ALL ON FUNCTION league_save_matches(league_encounters, JSONB), apply_league_encounter_ranking(UUID),
  reverse_league_encounter_ranking(UUID), league_check_answerer(league_encounters) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION submit_encounter_result(UUID, JSONB), confirm_encounter_result(UUID), contest_encounter_result(UUID, TEXT),
  resolve_encounter(UUID, JSONB, UUID, TEXT), finish_league_category(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION league_match_winner(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION submit_encounter_result(UUID, JSONB), confirm_encounter_result(UUID), contest_encounter_result(UUID, TEXT),
  resolve_encounter(UUID, JSONB, UUID, TEXT), finish_league_category(UUID) TO authenticated;
