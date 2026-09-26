-- ═══════════════════════════════════════════════════════════════════════
-- Aulas — Fase 3, entrega 3b: «Propor outra hora» dos dois lados
-- (Trello #392; Dev 4, 26 set 2026; lista das aprovações das aulas aprovada
-- pelo Francisco a 26 set, no fim de design-handoff/2026-09-26-marcar-aulas/
-- SPEC.md.)
--
-- A regra (Francisco, 26 set: «têm de alinhar a aula se querem noutro dia.
-- Ele pode propor»):
--   · O professor aceita o pedido tal como veio → o aluno fica logo inscrito
--     (sem mudança).
--   · Qualquer um dos dois pode propor outra hora. Quem RECEBE a proposta é
--     quem a aceita: aceita, recusa, ou propõe outra. Fica marcada quando um
--     aceita a última proposta do outro.
--   · Recusar: o professor recusa o pedido; o aluno cancela-o. Os dois
--     perguntam antes (no ecrã).
--
-- O que muda:
--   · lesson_requests ganha proposed_starts_at / proposed_by / proposed_at
--     (a última proposta) e original_starts_at (a hora que o aluno pediu).
--   · propose_lesson_time(p_id, p_starts_at) — professor ou aluno do pedido.
--   · accept_lesson_proposal(p_id) — quem recebeu a última proposta.
--   · accept_lesson_request(p_id) — redefinida (é deste trabalho, entrega 3a):
--     com uma proposta do aluno por responder, aceitar = aceitar essa hora;
--     com uma proposta do próprio professor por responder, recusa (quem
--     aceita é o aluno). A marcação passa a book_lesson_request (interna).
--   · list_my_teacher_requests, list_my_lesson_requests e get_teacher_booking
--     — redefinidas (deste trabalho) para trazer a proposta.
--
-- Depende de: migration_lessons_4_teacher_responds.sql.
-- Quem corre: o System Integrator, com o «corre» do Francisco. Nenhum dev.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE lesson_requests ADD COLUMN IF NOT EXISTS proposed_starts_at TIMESTAMPTZ;
ALTER TABLE lesson_requests ADD COLUMN IF NOT EXISTS proposed_by TEXT CHECK (proposed_by IN ('teacher', 'student'));
ALTER TABLE lesson_requests ADD COLUMN IF NOT EXISTS proposed_at TIMESTAMPTZ;
ALTER TABLE lesson_requests ADD COLUMN IF NOT EXISTS original_starts_at TIMESTAMPTZ;

-- ── 1. Cabe no horário e está livre? (interna) ──────────────────────────
CREATE OR REPLACE FUNCTION lesson_request_slot_ok(p_request UUID, p_starts_at TIMESTAMPTZ)
RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r lesson_requests;
  tp teacher_profiles;
  v_local TIMESTAMP := p_starts_at AT TIME ZONE 'Europe/Lisbon';
  v_day TEXT;
BEGIN
  SELECT * INTO r FROM lesson_requests WHERE id = p_request;
  SELECT * INTO tp FROM teacher_profiles WHERE id = r.teacher_profile_id;
  IF p_starts_at <= NOW() OR p_starts_at > NOW() + INTERVAL '15 days' THEN RETURN 'Escolhe um dia dos próximos 14 dias'; END IF;
  IF extract(minute FROM v_local)::INT NOT IN (0, 30) THEN RETURN 'As aulas começam à hora ou à meia hora'; END IF;
  v_day := (ARRAY['segunda','terca','quarta','quinta','sexta','sabado','domingo'])[EXTRACT(ISODOW FROM v_local)::INT];
  IF NOT EXISTS (
    SELECT 1 FROM teacher_availability ta
     WHERE ta.teacher_profile_id = tp.id AND ta.day_of_week = v_day
       AND v_local::TIME >= ta.start_time
       AND (v_local + make_interval(mins => r.duration_minutes))::TIME <= ta.end_time
       AND (v_local + make_interval(mins => r.duration_minutes))::DATE = v_local::DATE
  ) THEN
    RETURN 'Essa hora não cabe no horário do professor';
  END IF;
  -- Ocupado, sem contar com este mesmo pedido.
  IF EXISTS (
    SELECT 1 FROM teacher_busy(tp.user_id, p_starts_at, p_starts_at + make_interval(mins => r.duration_minutes)) b
     WHERE NOT (b.kind = 'request' AND b.starts_at = r.starts_at
                AND b.ends_at = r.starts_at + make_interval(mins => r.duration_minutes))
  ) THEN
    RETURN 'Essa hora já está ocupada';
  END IF;
  RETURN NULL;
END;
$$;

-- ── 2. Marcar a aula (interna): usada pelo aceitar e pelo aceitar proposta ─
CREATE OR REPLACE FUNCTION book_lesson_request(p_id UUID, p_starts_at TIMESTAMPTZ)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r lesson_requests;
  tp teacher_profiles;
  v_lesson UUID;
  v_teacher TEXT;
  v_org TEXT;
  v_moved BOOLEAN;
BEGIN
  SELECT * INTO r FROM lesson_requests WHERE id = p_id FOR UPDATE;
  SELECT * INTO tp FROM teacher_profiles WHERE id = r.teacher_profile_id;
  IF EXISTS (SELECT 1 FROM teacher_busy(tp.user_id, p_starts_at, p_starts_at + make_interval(mins => r.duration_minutes)) b
              WHERE b.kind = 'lesson') THEN
    RAISE EXCEPTION 'Já há uma aula a essa hora';
  END IF;
  v_moved := p_starts_at <> COALESCE(r.original_starts_at, r.starts_at);

  INSERT INTO lessons (teacher_profile_id, organization_id, starts_at, duration_minutes, lesson_type, status,
                       price_per_person, price_peak, visibility, created_by)
  VALUES (tp.id, tp.organization_id, p_starts_at, r.duration_minutes, r.lesson_type, 'confirmed',
          r.price_per_person, r.price_peak, 'invited', auth.uid())
  RETURNING id INTO v_lesson;
  INSERT INTO lesson_attendees (lesson_id, user_id, role, status, price, added_by)
  VALUES (v_lesson, r.user_id, 'single', 'confirmed', r.price_per_person, auth.uid());

  UPDATE lesson_requests
     SET status = 'accepted', lesson_id = v_lesson, resolved_at = NOW(), resolved_by = auth.uid(),
         original_starts_at = COALESCE(original_starts_at, starts_at), starts_at = p_starts_at,
         proposed_starts_at = NULL, proposed_by = NULL, proposed_at = NULL
   WHERE id = p_id;

  SELECT name INTO v_teacher FROM profiles WHERE id = tp.user_id;
  SELECT name INTO v_org FROM organizations WHERE id = tp.organization_id;
  -- Quem não aceitou fica a saber que está marcada.
  PERFORM lesson_notify(CASE WHEN auth.uid() = tp.user_id THEN r.user_id ELSE tp.user_id END,
    CASE WHEN auth.uid() = tp.user_id THEN 'lesson_request_accepted' ELSE 'lesson_proposal_accepted' END, v_lesson, jsonb_build_object(
      'request_id', p_id, 'teacher_name', v_teacher, 'student_name', (SELECT name FROM profiles WHERE id = r.user_id),
      'org_name', v_org, 'starts_at', p_starts_at, 'duration_minutes', r.duration_minutes, 'lesson_type', r.lesson_type,
      'moved', v_moved, 'original_starts_at', COALESCE(r.original_starts_at, r.starts_at)));

  IF tp.organization_id IS NOT NULL THEN
    PERFORM lesson_notify(m.user_id, 'lesson_needs_court', v_lesson, jsonb_build_object(
      'teacher_name', v_teacher, 'student_name', (SELECT name FROM profiles WHERE id = r.user_id),
      'org_name', v_org, 'starts_at', p_starts_at, 'duration_minutes', r.duration_minutes))
      FROM memberships m
     WHERE m.organization_id = tp.organization_id AND m.is_admin AND m.user_id <> tp.user_id;
  END IF;
  RETURN v_lesson;
END;
$$;

-- ── 3. Aceitar (o professor) ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION accept_lesson_request(p_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r lesson_requests; v_teacher UUID;
BEGIN
  SELECT * INTO r FROM lesson_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR r.status <> 'pending' THEN RAISE EXCEPTION 'Pedido não encontrado ou já resolvido'; END IF;
  SELECT user_id INTO v_teacher FROM teacher_profiles WHERE id = r.teacher_profile_id;
  IF v_teacher <> auth.uid() THEN RAISE EXCEPTION 'Só o professor pode responder a este pedido'; END IF;
  IF r.proposed_by = 'teacher' THEN RAISE EXCEPTION 'Propuseste outra hora: agora é o aluno que aceita'; END IF;
  -- Com uma proposta do aluno por responder, aceitar é aceitar essa hora.
  IF COALESCE(r.proposed_starts_at, r.starts_at) <= NOW() THEN RAISE EXCEPTION 'Essa hora já passou'; END IF;
  RETURN book_lesson_request(p_id, COALESCE(r.proposed_starts_at, r.starts_at));
END;
$$;

-- ── 4. Propor outra hora (os dois lados) ────────────────────────────────
CREATE OR REPLACE FUNCTION propose_lesson_time(p_id UUID, p_starts_at TIMESTAMPTZ)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r lesson_requests; v_teacher UUID; v_role TEXT; v_err TEXT; v_names JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT lessons_enabled_for_me() THEN RAISE EXCEPTION 'A marcação de aulas ainda não está aberta'; END IF;
  SELECT * INTO r FROM lesson_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR r.status <> 'pending' THEN RAISE EXCEPTION 'Pedido não encontrado ou já resolvido'; END IF;
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

-- ── 5. Aceitar a última proposta (quem a recebeu) ───────────────────────
CREATE OR REPLACE FUNCTION accept_lesson_proposal(p_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r lesson_requests; v_teacher UUID; v_role TEXT; v_err TEXT;
BEGIN
  SELECT * INTO r FROM lesson_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR r.status <> 'pending' OR r.proposed_starts_at IS NULL THEN
    RAISE EXCEPTION 'Proposta não encontrada ou já resolvida';
  END IF;
  SELECT user_id INTO v_teacher FROM teacher_profiles WHERE id = r.teacher_profile_id;
  v_role := CASE WHEN auth.uid() = v_teacher THEN 'teacher' WHEN auth.uid() = r.user_id THEN 'student' END;
  IF v_role IS NULL OR v_role = r.proposed_by THEN RAISE EXCEPTION 'Quem aceita é quem recebeu a proposta'; END IF;
  v_err := lesson_request_slot_ok(p_id, r.proposed_starts_at);
  IF v_err IS NOT NULL THEN RAISE EXCEPTION '%', v_err; END IF;
  RETURN book_lesson_request(p_id, r.proposed_starts_at);
END;
$$;

-- ── 6. As listas trazem a proposta ──────────────────────────────────────
CREATE OR REPLACE FUNCTION list_my_teacher_requests()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', r.id, 'teacher_profile_id', r.teacher_profile_id, 'status', r.status,
      'created_at', r.created_at, 'starts_at', r.starts_at, 'original_starts_at', r.original_starts_at,
      'proposed_starts_at', r.proposed_starts_at, 'proposed_by', r.proposed_by,
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
           'duration_minutes', r.duration_minutes, 'lesson_type', r.lesson_type, 'price_per_person', r.price_per_person,
           'contact_via', r.contact_via, 'status', r.status) ORDER BY r.starts_at), '[]'::jsonb)
    FROM lesson_requests r JOIN teacher_profiles tp ON tp.id = r.teacher_profile_id
    JOIN profiles p ON p.id = tp.user_id LEFT JOIN organizations o ON o.id = tp.organization_id
   WHERE r.user_id = auth.uid() AND r.status IN ('pending', 'accepted')
     AND r.starts_at + make_interval(mins => r.duration_minutes) > NOW();
$$;

-- O ecrã «Pedir aula» mostra os pedidos meus com a proposta (redefinida;
-- é deste trabalho, entrega 2 — só acrescenta os campos da proposta).
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

-- ── 7. Permissões explícitas ────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION lesson_request_slot_ok(UUID, TIMESTAMPTZ), book_lesson_request(UUID, TIMESTAMPTZ),
  accept_lesson_request(UUID), propose_lesson_time(UUID, TIMESTAMPTZ), accept_lesson_proposal(UUID),
  list_my_teacher_requests(), list_my_lesson_requests(), get_teacher_booking(UUID)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION lesson_request_slot_ok(UUID, TIMESTAMPTZ), book_lesson_request(UUID, TIMESTAMPTZ)
  FROM authenticated;
GRANT EXECUTE ON FUNCTION accept_lesson_request(UUID), propose_lesson_time(UUID, TIMESTAMPTZ),
  accept_lesson_proposal(UUID), list_my_teacher_requests(), list_my_lesson_requests(), get_teacher_booking(UUID)
  TO authenticated;

COMMIT;

-- Verificação: anon sem EXECUTE nas 7; authenticated sem EXECUTE só em
-- lesson_request_slot_ok e book_lesson_request.
