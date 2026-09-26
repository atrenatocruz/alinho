-- ═══════════════════════════════════════════════════════════════════════
-- Aulas — Fase 3, entrega 3c: «Juntar pedidos» (Trello #392)
-- (Dev 4, 26 set 2026. Desenho de 18 set, SPEC §6.1: «dois pedidos que
--  chocam aparecem juntos com a sugestão de os juntar; a proposta mostra a
--  cada aluno o que muda para ele». Regra da lista das aprovações do
--  Francisco, 26 set: o aluno só aceita se lhe mudar a hora, o dia, o preço
--  ou o tipo; «tudo o resto sem aprovação».)
--
-- O que faz:
--   · lesson_merges — a proposta de junção: professor (perfil = clube), dia e
--     hora, duração, tipo e preço por pessoa (da tabela em vigor).
--   · lesson_requests ganha merge_id e merge_answer ('pending' | 'accepted').
--   · propose_lesson_merge(ids[], starts_at, duration, type) — o professor.
--     Para cada pedido, se nada muda para esse aluno (mesma hora, duração,
--     tipo e preço), fica logo 'accepted'; senão 'pending' e o aluno recebe
--     o aviso com o que muda. Se ninguém tem de responder, marca logo.
--   · answer_lesson_merge(merge_id, accept) — o aluno. Aceitar; quando todos
--     aceitaram, a aula fica marcada com todos. Recusar: o pedido dele sai da
--     junção e volta a ser um pedido normal; se sobrar só um, a junção cai.
--   · cancel_lesson_merge(merge_id) — o professor desfaz a junção.
--   · list_my_teacher_requests / list_my_lesson_requests / get_teacher_booking
--     — redefinidas (deste trabalho) com a junção.
--
-- Depende de: migration_lessons_5_proposals.sql.
-- Quem corre: o System Integrator, com o «corre» do Francisco. Nenhum dev.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS lesson_merges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_profile_id UUID NOT NULL REFERENCES teacher_profiles(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL,
  duration_minutes SMALLINT NOT NULL CHECK (duration_minutes IN (60, 90, 120)),
  lesson_type TEXT NOT NULL CHECK (lesson_type IN ('duo', 'trio', 'quad')),
  price_per_person NUMERIC(7,2),
  price_peak BOOLEAN,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'booked', 'cancelled')),
  lesson_id UUID REFERENCES lessons(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL
);
ALTER TABLE lesson_merges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON lesson_merges FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON lesson_merges FROM authenticated;
-- Ninguém lê diretamente: sai pelas RPCs.

ALTER TABLE lesson_requests ADD COLUMN IF NOT EXISTS merge_id UUID REFERENCES lesson_merges(id) ON DELETE SET NULL;
ALTER TABLE lesson_requests ADD COLUMN IF NOT EXISTS merge_answer TEXT CHECK (merge_answer IN ('pending', 'accepted'));

-- ── 1. Marcar a junção (interna) ────────────────────────────────────────
CREATE OR REPLACE FUNCTION book_lesson_merge(p_merge UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m lesson_merges;
  tp teacher_profiles;
  v_lesson UUID;
  v_teacher TEXT;
  v_org TEXT;
  r RECORD;
BEGIN
  SELECT * INTO m FROM lesson_merges WHERE id = p_merge FOR UPDATE;
  SELECT * INTO tp FROM teacher_profiles WHERE id = m.teacher_profile_id;
  IF EXISTS (SELECT 1 FROM teacher_busy(tp.user_id, m.starts_at, m.starts_at + make_interval(mins => m.duration_minutes)) b
              WHERE b.kind = 'lesson') THEN
    RAISE EXCEPTION 'Já há uma aula a essa hora';
  END IF;

  INSERT INTO lessons (teacher_profile_id, organization_id, starts_at, duration_minutes, lesson_type, status,
                       price_per_person, price_peak, visibility, created_by)
  VALUES (tp.id, tp.organization_id, m.starts_at, m.duration_minutes, m.lesson_type, 'confirmed',
          m.price_per_person, m.price_peak, 'invited', tp.user_id)
  RETURNING id INTO v_lesson;

  SELECT name INTO v_teacher FROM profiles WHERE id = tp.user_id;
  SELECT name INTO v_org FROM organizations WHERE id = tp.organization_id;
  FOR r IN SELECT * FROM lesson_requests WHERE merge_id = p_merge AND status = 'pending' LOOP
    INSERT INTO lesson_attendees (lesson_id, user_id, role, status, price, added_by)
    VALUES (v_lesson, r.user_id, 'single', 'confirmed', m.price_per_person, tp.user_id);
    UPDATE lesson_requests
       SET status = 'accepted', lesson_id = v_lesson, resolved_at = NOW(), resolved_by = tp.user_id,
           original_starts_at = COALESCE(original_starts_at, starts_at), starts_at = m.starts_at,
           proposed_starts_at = NULL, proposed_by = NULL, proposed_at = NULL
     WHERE id = r.id;
    PERFORM lesson_notify(r.user_id, 'lesson_request_accepted', v_lesson, jsonb_build_object(
      'request_id', r.id, 'teacher_name', v_teacher, 'org_name', v_org, 'starts_at', m.starts_at,
      'duration_minutes', m.duration_minutes, 'lesson_type', m.lesson_type));
  END LOOP;
  UPDATE lesson_merges SET status = 'booked', lesson_id = v_lesson WHERE id = p_merge;

  PERFORM lesson_notify(tp.user_id, 'lesson_merge_booked', v_lesson, jsonb_build_object(
    'org_name', v_org, 'starts_at', m.starts_at, 'lesson_type', m.lesson_type));
  IF tp.organization_id IS NOT NULL THEN
    PERFORM lesson_notify(mb.user_id, 'lesson_needs_court', v_lesson, jsonb_build_object(
      'teacher_name', v_teacher, 'student_name', '', 'org_name', v_org, 'starts_at', m.starts_at,
      'duration_minutes', m.duration_minutes))
      FROM memberships mb
     WHERE mb.organization_id = tp.organization_id AND mb.is_admin AND mb.user_id <> tp.user_id;
  END IF;
  RETURN v_lesson;
END;
$$;

-- ── 2. Propor a junção (o professor) ────────────────────────────────────
CREATE OR REPLACE FUNCTION propose_lesson_merge(p_request_ids UUID[], p_starts_at TIMESTAMPTZ, p_duration SMALLINT, p_type TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tp UUID;
  tp teacher_profiles;
  v_local TIMESTAMP := p_starts_at AT TIME ZONE 'Europe/Lisbon';
  v_wd SMALLINT := EXTRACT(ISODOW FROM p_starts_at AT TIME ZONE 'Europe/Lisbon')::SMALLINT;
  v_day TEXT;
  v_peak TEXT;
  v_price lesson_prices;
  v_merge UUID;
  v_waiting INT := 0;
  r RECORD;
BEGIN
  IF auth.uid() IS NULL OR NOT lessons_enabled_for_me() THEN RAISE EXCEPTION 'A marcação de aulas ainda não está aberta'; END IF;
  IF array_length(p_request_ids, 1) IS NULL OR array_length(p_request_ids, 1) < 2 THEN RAISE EXCEPTION 'Escolhe pelo menos dois pedidos'; END IF;
  IF array_length(p_request_ids, 1) > lesson_capacity(p_type) THEN RAISE EXCEPTION 'São mais alunos do que cabem nesse tipo de aula'; END IF;

  -- Todos por responder, do mesmo professor e clube, sem outra junção.
  SELECT min(teacher_profile_id::TEXT)::UUID INTO v_tp FROM lesson_requests WHERE id = ANY(p_request_ids);
  IF (SELECT count(*) FROM lesson_requests WHERE id = ANY(p_request_ids) AND teacher_profile_id = v_tp
        AND status = 'pending' AND merge_id IS NULL) <> array_length(p_request_ids, 1) THEN
    RAISE EXCEPTION 'Só se juntam pedidos por responder, do mesmo clube';
  END IF;
  SELECT * INTO tp FROM teacher_profiles WHERE id = v_tp;
  IF tp.user_id <> auth.uid() THEN RAISE EXCEPTION 'Só o professor pode juntar pedidos'; END IF;

  -- Cabe no horário e não choca com outra coisa (fora estes pedidos).
  IF p_starts_at <= NOW() THEN RAISE EXCEPTION 'Essa hora já passou'; END IF;
  IF extract(minute FROM v_local)::INT NOT IN (0, 30) THEN RAISE EXCEPTION 'As aulas começam à hora ou à meia hora'; END IF;
  v_day := (ARRAY['segunda','terca','quarta','quinta','sexta','sabado','domingo'])[v_wd];
  IF NOT EXISTS (
    SELECT 1 FROM teacher_availability ta
     WHERE ta.teacher_profile_id = tp.id AND ta.day_of_week = v_day
       AND v_local::TIME >= ta.start_time
       AND (v_local + make_interval(mins => p_duration))::TIME <= ta.end_time
       AND (v_local + make_interval(mins => p_duration))::DATE = v_local::DATE
  ) THEN
    RAISE EXCEPTION 'Essa hora não cabe no teu horário';
  END IF;
  IF EXISTS (
    SELECT 1 FROM teacher_busy(tp.user_id, p_starts_at, p_starts_at + make_interval(mins => p_duration)) b
     WHERE b.kind = 'lesson'
        OR NOT EXISTS (SELECT 1 FROM lesson_requests x WHERE x.id = ANY(p_request_ids)
                        AND x.starts_at = b.starts_at AND x.starts_at + make_interval(mins => x.duration_minutes) = b.ends_at)
  ) THEN
    RAISE EXCEPTION 'Essa hora já está ocupada';
  END IF;

  v_peak := lesson_peak(tp.organization_id, v_wd, v_local::TIME, p_duration);
  v_price := lesson_price_row(tp.id, tp.organization_id, p_type, p_duration, v_peak <> 'off', v_local::DATE);
  IF v_price.id IS NULL OR v_price.price_lesson IS NULL THEN RAISE EXCEPTION 'Não tens preço para essa aula'; END IF;

  INSERT INTO lesson_merges (teacher_profile_id, starts_at, duration_minutes, lesson_type, price_per_person, price_peak, created_by)
  VALUES (tp.id, p_starts_at, p_duration, p_type, v_price.price_lesson, v_peak <> 'off', auth.uid())
  RETURNING id INTO v_merge;

  -- A cada aluno: só aceita se lhe mudar alguma coisa (Francisco, 26 set).
  FOR r IN SELECT * FROM lesson_requests WHERE id = ANY(p_request_ids) LOOP
    IF r.starts_at = p_starts_at AND r.duration_minutes = p_duration AND r.lesson_type = p_type
       AND r.price_per_person IS NOT DISTINCT FROM v_price.price_lesson THEN
      UPDATE lesson_requests SET merge_id = v_merge, merge_answer = 'accepted' WHERE id = r.id;
    ELSE
      UPDATE lesson_requests SET merge_id = v_merge, merge_answer = 'pending',
             proposed_starts_at = NULL, proposed_by = NULL, proposed_at = NULL WHERE id = r.id;
      v_waiting := v_waiting + 1;
      PERFORM lesson_notify(r.user_id, 'lesson_merge_proposed', NULL, jsonb_build_object(
        'merge_id', v_merge, 'request_id', r.id, 'teacher_profile_id', tp.id,
        'teacher_name', (SELECT name FROM profiles WHERE id = tp.user_id),
        'starts_at', p_starts_at, 'lesson_type', p_type, 'price_per_person', v_price.price_lesson,
        'was_starts_at', r.starts_at, 'was_type', r.lesson_type, 'was_price', r.price_per_person));
    END IF;
  END LOOP;

  IF v_waiting = 0 THEN PERFORM book_lesson_merge(v_merge); END IF;
  RETURN v_merge;
END;
$$;

-- ── 3. O aluno responde ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION answer_lesson_merge(p_merge_id UUID, p_accept BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r lesson_requests; m lesson_merges; v_left INT;
BEGIN
  SELECT * INTO r FROM lesson_requests WHERE merge_id = p_merge_id AND user_id = auth.uid() AND status = 'pending' FOR UPDATE;
  IF NOT FOUND OR r.merge_answer <> 'pending' THEN RAISE EXCEPTION 'Proposta não encontrada ou já respondida'; END IF;
  SELECT * INTO m FROM lesson_merges WHERE id = p_merge_id FOR UPDATE;
  IF m.status <> 'pending' THEN RAISE EXCEPTION 'Esta proposta já não está em aberto'; END IF;

  IF p_accept THEN
    UPDATE lesson_requests SET merge_answer = 'accepted' WHERE id = r.id;
    IF NOT EXISTS (SELECT 1 FROM lesson_requests WHERE merge_id = p_merge_id AND status = 'pending' AND merge_answer = 'pending') THEN
      PERFORM book_lesson_merge(p_merge_id);
    END IF;
  ELSE
    -- Sai da junção: volta a ser um pedido normal.
    UPDATE lesson_requests SET merge_id = NULL, merge_answer = NULL WHERE id = r.id;
    SELECT count(*) INTO v_left FROM lesson_requests WHERE merge_id = p_merge_id AND status = 'pending';
    PERFORM lesson_notify((SELECT user_id FROM teacher_profiles WHERE id = m.teacher_profile_id), 'lesson_merge_declined', NULL,
      jsonb_build_object('merge_id', p_merge_id, 'student_name', (SELECT name FROM profiles WHERE id = auth.uid()), 'starts_at', m.starts_at));
    IF v_left < 2 THEN
      UPDATE lesson_requests SET merge_id = NULL, merge_answer = NULL WHERE merge_id = p_merge_id;
      UPDATE lesson_merges SET status = 'cancelled' WHERE id = p_merge_id;
    ELSIF NOT EXISTS (SELECT 1 FROM lesson_requests WHERE merge_id = p_merge_id AND status = 'pending' AND merge_answer = 'pending') THEN
      PERFORM book_lesson_merge(p_merge_id);
    END IF;
  END IF;
END;
$$;

-- ── 4. O professor desfaz a junção ──────────────────────────────────────
CREATE OR REPLACE FUNCTION cancel_lesson_merge(p_merge_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m lesson_merges;
BEGIN
  SELECT * INTO m FROM lesson_merges WHERE id = p_merge_id FOR UPDATE;
  IF NOT FOUND OR m.status <> 'pending' THEN RAISE EXCEPTION 'Junção não encontrada'; END IF;
  IF (SELECT user_id FROM teacher_profiles WHERE id = m.teacher_profile_id) <> auth.uid() THEN
    RAISE EXCEPTION 'Só o professor pode desfazer a junção';
  END IF;
  UPDATE lesson_requests SET merge_id = NULL, merge_answer = NULL WHERE merge_id = p_merge_id;
  UPDATE lesson_merges SET status = 'cancelled' WHERE id = p_merge_id;
END;
$$;

-- ── 5. As listas trazem a junção (redefinidas; deste trabalho) ─────────
CREATE OR REPLACE FUNCTION lesson_merge_json(p_merge UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('id', m.id, 'starts_at', m.starts_at, 'duration_minutes', m.duration_minutes,
           'lesson_type', m.lesson_type, 'price_per_person', m.price_per_person, 'status', m.status)
    FROM lesson_merges m WHERE m.id = p_merge;
$$;

CREATE OR REPLACE FUNCTION list_my_teacher_requests()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', r.id, 'teacher_profile_id', r.teacher_profile_id, 'status', r.status,
      'created_at', r.created_at, 'starts_at', r.starts_at, 'original_starts_at', r.original_starts_at,
      'proposed_starts_at', r.proposed_starts_at, 'proposed_by', r.proposed_by,
      'merge', CASE WHEN r.merge_id IS NOT NULL THEN lesson_merge_json(r.merge_id) END, 'merge_answer', r.merge_answer,
      'duration_minutes', r.duration_minutes, 'lesson_type', r.lesson_type, 'price_per_person', r.price_per_person,
      'org_name', o.name, 'lesson_id', r.lesson_id, 'court_booked_at', r.court_booked_at,
      'student', jsonb_build_object('user_id', s.id, 'name', s.name, 'avatar_url', s.avatar_url, 'gender', s.gender,
                   'rating', CASE WHEN can_view_section(s.id, s.results_visibility) THEN s.rating END),
      'contact_via', r.contact_via,
      'contact_href', CASE
        WHEN r.status IN ('pending', 'accepted') AND r.contact_via = 'whatsapp' AND r.contact_phone IS NOT NULL
          THEN 'https://wa.me/' || r.contact_phone
        WHEN r.status IN ('pending', 'accepted') AND r.contact_via = 'email'
          THEN 'mailto:' || (SELECT u.email FROM auth.users u WHERE u.id = r.user_id)
        END
    ) ORDER BY r.status <> 'pending', r.starts_at), '[]'::jsonb)
    FROM lesson_requests r
    JOIN teacher_profiles tp ON tp.id = r.teacher_profile_id
    JOIN profiles s ON s.id = r.user_id
    LEFT JOIN organizations o ON o.id = tp.organization_id
   WHERE tp.user_id = auth.uid()
     AND r.status IN ('pending', 'accepted')
     AND r.starts_at + make_interval(mins => r.duration_minutes) > NOW() - INTERVAL '1 day';
$$;

CREATE OR REPLACE FUNCTION list_my_lesson_requests()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', r.id, 'teacher_profile_id', r.teacher_profile_id,
           'teacher_name', p.name, 'teacher_gender', p.gender, 'org_name', o.name, 'starts_at', r.starts_at,
           'original_starts_at', r.original_starts_at, 'proposed_starts_at', r.proposed_starts_at, 'proposed_by', r.proposed_by,
           'merge', CASE WHEN r.merge_id IS NOT NULL THEN lesson_merge_json(r.merge_id) END, 'merge_answer', r.merge_answer,
           'duration_minutes', r.duration_minutes, 'lesson_type', r.lesson_type, 'price_per_person', r.price_per_person,
           'contact_via', r.contact_via, 'status', r.status) ORDER BY r.starts_at), '[]'::jsonb)
    FROM lesson_requests r JOIN teacher_profiles tp ON tp.id = r.teacher_profile_id
    JOIN profiles p ON p.id = tp.user_id LEFT JOIN organizations o ON o.id = tp.organization_id
   WHERE r.user_id = auth.uid() AND r.status IN ('pending', 'accepted')
     AND r.starts_at + make_interval(mins => r.duration_minutes) > NOW();
$$;

CREATE OR REPLACE FUNCTION get_teacher_booking(p_teacher_profile_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user UUID;
  v_from TIMESTAMPTZ := date_trunc('day', NOW() AT TIME ZONE 'Europe/Lisbon') AT TIME ZONE 'Europe/Lisbon';
  v_to TIMESTAMPTZ;
BEGIN
  IF auth.uid() IS NULL OR NOT lessons_enabled_for_me() THEN RETURN NULL; END IF;
  SELECT user_id INTO v_user FROM teacher_profiles WHERE id = p_teacher_profile_id;
  IF v_user IS NULL OR NOT teacher_profile_active(p_teacher_profile_id) THEN RETURN NULL; END IF;
  v_to := v_from + INTERVAL '15 days';

  RETURN jsonb_build_object(
    'teacher', (SELECT jsonb_build_object('user_id', p.id, 'name', p.name, 'gender', p.gender, 'avatar_url', p.avatar_url)
                  FROM profiles p WHERE p.id = v_user),
    'profiles', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'teacher_profile_id', s.id, 'organization_id', s.organization_id, 'org_name', o.name,
        'availability', COALESCE((SELECT jsonb_agg(jsonb_build_object('day_of_week', ta.day_of_week,
                           'start_time', ta.start_time, 'end_time', ta.end_time))
                           FROM teacher_availability ta WHERE ta.teacher_profile_id = s.id), '[]'::jsonb),
        'peak_hours', COALESCE((SELECT jsonb_agg(jsonb_build_object('day_of_week', ph.day_of_week,
                           'start_time', ph.start_time, 'end_time', ph.end_time))
                           FROM club_peak_hours ph WHERE ph.organization_id = s.organization_id), '[]'::jsonb),
        'prices', COALESCE((SELECT jsonb_agg(to_jsonb(lp)) FROM lesson_prices lp
                           WHERE lp.teacher_profile_id = s.id
                              OR (lp.teacher_profile_id IS NULL AND lp.organization_id = s.organization_id)), '[]'::jsonb)
      ) ORDER BY s.created_at), '[]'::jsonb)
      FROM teacher_sibling_profiles(p_teacher_profile_id) s LEFT JOIN organizations o ON o.id = s.organization_id),
    'busy', (SELECT COALESCE(jsonb_agg(jsonb_build_object('starts_at', b.starts_at, 'ends_at', b.ends_at, 'kind', b.kind)), '[]'::jsonb)
               FROM teacher_busy(v_user, v_from, v_to) b),
    'mine', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', r.id, 'teacher_profile_id', r.teacher_profile_id,
               'starts_at', r.starts_at, 'duration_minutes', r.duration_minutes, 'lesson_type', r.lesson_type,
               'price_per_person', r.price_per_person, 'contact_via', r.contact_via, 'status', r.status,
               'original_starts_at', r.original_starts_at, 'proposed_starts_at', r.proposed_starts_at, 'proposed_by', r.proposed_by,
               'merge', CASE WHEN r.merge_id IS NOT NULL THEN lesson_merge_json(r.merge_id) END, 'merge_answer', r.merge_answer,
               'org_name', o.name) ORDER BY r.starts_at), '[]'::jsonb)
               FROM lesson_requests r JOIN teacher_profiles tp ON tp.id = r.teacher_profile_id
               LEFT JOIN organizations o ON o.id = tp.organization_id
              WHERE r.user_id = auth.uid() AND tp.user_id = v_user AND r.status IN ('pending', 'accepted')
                AND r.starts_at + make_interval(mins => r.duration_minutes) > NOW()),
    -- Só um sim/não: tem a conta ligada ao WhatsApp? (sem o número)
    'i_have_whatsapp', (SELECT whatsapp_jid IS NOT NULL FROM profiles WHERE id = auth.uid())
  );
END;
$$;

-- Aceitar e propor outra hora não mexem num pedido que está numa junção
-- (redefinidas; deste trabalho, _5 — só acrescenta essa verificação).
CREATE OR REPLACE FUNCTION accept_lesson_request(p_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r lesson_requests; v_teacher UUID; v_err TEXT;
BEGIN
  SELECT * INTO r FROM lesson_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR r.status <> 'pending' THEN RAISE EXCEPTION 'Pedido não encontrado ou já resolvido'; END IF;
  -- Numa junção por responder, o pedido segue a junção (desfaz-se primeiro).
  IF r.merge_id IS NOT NULL THEN RAISE EXCEPTION 'Este pedido está numa junção por responder'; END IF;
  SELECT user_id INTO v_teacher FROM teacher_profiles WHERE id = r.teacher_profile_id;
  IF v_teacher <> auth.uid() THEN RAISE EXCEPTION 'Só o professor pode responder a este pedido'; END IF;
  IF r.proposed_by = 'teacher' THEN RAISE EXCEPTION 'Propuseste outra hora: agora é o aluno que aceita'; END IF;
  -- Com uma proposta do aluno por responder, aceitar é aceitar essa hora.
  IF COALESCE(r.proposed_starts_at, r.starts_at) <= NOW() THEN RAISE EXCEPTION 'Essa hora já passou'; END IF;
  -- A hora proposta pelo aluno volta a ser verificada (nota do System
  -- Integrator, 26 set: entretanto pode ter entrado outro pedido).
  IF r.proposed_starts_at IS NOT NULL THEN
    v_err := lesson_request_slot_ok(p_id, r.proposed_starts_at);
    IF v_err IS NOT NULL THEN RAISE EXCEPTION '%', v_err; END IF;
  END IF;
  RETURN book_lesson_request(p_id, COALESCE(r.proposed_starts_at, r.starts_at));
END;
$$;

CREATE OR REPLACE FUNCTION propose_lesson_time(p_id UUID, p_starts_at TIMESTAMPTZ)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r lesson_requests; v_teacher UUID; v_role TEXT; v_err TEXT; v_names JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT lessons_enabled_for_me() THEN RAISE EXCEPTION 'A marcação de aulas ainda não está aberta'; END IF;
  SELECT * INTO r FROM lesson_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR r.status <> 'pending' THEN RAISE EXCEPTION 'Pedido não encontrado ou já resolvido'; END IF;
  -- Numa junção por responder, o pedido segue a junção (desfaz-se primeiro).
  IF r.merge_id IS NOT NULL THEN RAISE EXCEPTION 'Este pedido está numa junção por responder'; END IF;
  SELECT user_id INTO v_teacher FROM teacher_profiles WHERE id = r.teacher_profile_id;
  v_role := CASE WHEN auth.uid() = v_teacher THEN 'teacher' WHEN auth.uid() = r.user_id THEN 'student' END;
  IF v_role IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado'; END IF;
  v_err := lesson_request_slot_ok(p_id, p_starts_at);
  IF v_err IS NOT NULL THEN RAISE EXCEPTION '%', v_err; END IF;

  UPDATE lesson_requests
     SET proposed_starts_at = p_starts_at, proposed_by = v_role, proposed_at = NOW(),
         original_starts_at = COALESCE(original_starts_at, starts_at)
   WHERE id = p_id;

  v_names := jsonb_build_object('request_id', p_id,
    'teacher_name', (SELECT name FROM profiles WHERE id = v_teacher),
    'student_name', (SELECT name FROM profiles WHERE id = r.user_id),
    'starts_at', p_starts_at, 'original_starts_at', COALESCE(r.original_starts_at, r.starts_at),
    'duration_minutes', r.duration_minutes, 'teacher_profile_id', r.teacher_profile_id);
  PERFORM lesson_notify(CASE WHEN v_role = 'teacher' THEN r.user_id ELSE v_teacher END,
    CASE WHEN v_role = 'teacher' THEN 'lesson_time_proposed_by_teacher' ELSE 'lesson_time_proposed_by_student' END,
    NULL, v_names);
END;
$$;

-- ── 6. Permissões explícitas ────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION book_lesson_merge(UUID), propose_lesson_merge(UUID[], TIMESTAMPTZ, SMALLINT, TEXT),
  answer_lesson_merge(UUID, BOOLEAN), cancel_lesson_merge(UUID), lesson_merge_json(UUID),
  list_my_teacher_requests(), list_my_lesson_requests(), get_teacher_booking(UUID),
  accept_lesson_request(UUID), propose_lesson_time(UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION book_lesson_merge(UUID), lesson_merge_json(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION propose_lesson_merge(UUID[], TIMESTAMPTZ, SMALLINT, TEXT), answer_lesson_merge(UUID, BOOLEAN),
  cancel_lesson_merge(UUID), list_my_teacher_requests(), list_my_lesson_requests(), get_teacher_booking(UUID),
  accept_lesson_request(UUID), propose_lesson_time(UUID, TIMESTAMPTZ)
  TO authenticated;

COMMIT;

-- Verificação: anon sem EXECUTE em todas; authenticated sem EXECUTE só em
-- book_lesson_merge e lesson_merge_json; lesson_merges sem SELECT para anon.
