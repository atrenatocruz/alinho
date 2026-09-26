-- ════════════════════════════════════════════════════════════════════════════
-- Aulas 8 — mudar a hora recalcula o preço (Dev 4, 26 set 2026)
--
-- Falha encontrada pelo QA (26 set, pelo PO): propose_lesson_time,
-- accept_lesson_proposal e book_lesson_request usavam o price_per_person e o
-- price_peak do pedido ORIGINAL. Uma aula movida de fora de ponta para a hora
-- de ponta (ou ao contrário) ficava com o preço errado. Só a
-- propose_lesson_merge recalculava.
--
-- Correção:
--   · lesson_request_price(): o preço e a ponta de um pedido a uma hora
--     qualquer, com as mesmas contas do request_lesson (lesson_peak +
--     lesson_price_row);
--   · propose_lesson_time: ao propor, o pedido passa a ter o preço da hora
--     proposta (é o que as listas e a proposta mostram, sem as redefinir);
--     sem preço para essa hora, não deixa propor;
--   · book_lesson_request: ao marcar, volta a calcular à hora final — o preço
--     da aula é sempre o da hora em que acontece.
--
-- Ordem: depois de migration_lessons_6_merge.sql (propose_lesson_time vem de
-- lá, com a verificação da junção) e da _5 (book_lesson_request). Os corpos
-- são os desses ficheiros, só com o preço acrescentado. Pode correr outra vez.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. O preço de um pedido a uma hora ──────────────────────────────────────
CREATE OR REPLACE FUNCTION lesson_request_price(p_id UUID, p_starts_at TIMESTAMPTZ,
                                                OUT price NUMERIC, OUT peak BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r lesson_requests;
  tp teacher_profiles;
  v_local TIMESTAMP := p_starts_at AT TIME ZONE 'Europe/Lisbon';
  v_wd SMALLINT := EXTRACT(ISODOW FROM p_starts_at AT TIME ZONE 'Europe/Lisbon')::SMALLINT;
BEGIN
  SELECT * INTO r FROM lesson_requests WHERE id = p_id;
  SELECT * INTO tp FROM teacher_profiles WHERE id = r.teacher_profile_id;
  peak := lesson_peak(tp.organization_id, v_wd, v_local::TIME, r.duration_minutes) <> 'off';
  price := (lesson_price_row(tp.id, tp.organization_id, r.lesson_type, r.duration_minutes, peak, v_local::DATE)).price_lesson;
END;
$$;

-- ── 2. Propor outra hora: o pedido passa a ter o preço dessa hora ───────────
-- (corpo da migration_lessons_6_merge.sql + o preço)
CREATE OR REPLACE FUNCTION propose_lesson_time(p_id UUID, p_starts_at TIMESTAMPTZ)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r lesson_requests; v_teacher UUID; v_role TEXT; v_err TEXT; v_names JSONB; v_price RECORD;
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
  SELECT * INTO v_price FROM lesson_request_price(p_id, p_starts_at);
  IF v_price.price IS NULL THEN RAISE EXCEPTION 'Este professor não tem preço para essa hora'; END IF;

  UPDATE lesson_requests
     SET proposed_starts_at = p_starts_at, proposed_by = v_role, proposed_at = NOW(),
         original_starts_at = COALESCE(original_starts_at, starts_at),
         price_per_person = v_price.price, price_peak = v_price.peak
   WHERE id = p_id;

  v_names := jsonb_build_object('request_id', p_id,
    'teacher_name', (SELECT name FROM profiles WHERE id = v_teacher),
    'student_name', (SELECT name FROM profiles WHERE id = r.user_id),
    'starts_at', p_starts_at, 'original_starts_at', COALESCE(r.original_starts_at, r.starts_at),
    'duration_minutes', r.duration_minutes, 'teacher_profile_id', r.teacher_profile_id,
    'price_per_person', v_price.price, 'was_price', r.price_per_person);
  PERFORM lesson_notify(CASE WHEN v_role = 'teacher' THEN r.user_id ELSE v_teacher END,
    CASE WHEN v_role = 'teacher' THEN 'lesson_time_proposed_by_teacher' ELSE 'lesson_time_proposed_by_student' END,
    NULL, v_names);
END;
$$;

-- ── 3. Marcar: o preço é o da hora em que a aula acontece ───────────────────
-- (corpo da migration_lessons_5_proposals.sql + o preço)
CREATE OR REPLACE FUNCTION book_lesson_request(p_id UUID, p_starts_at TIMESTAMPTZ)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r lesson_requests;
  tp teacher_profiles;
  v_lesson UUID;
  v_teacher TEXT;
  v_org TEXT;
  v_moved BOOLEAN;
  v_price RECORD;
BEGIN
  SELECT * INTO r FROM lesson_requests WHERE id = p_id FOR UPDATE;
  SELECT * INTO tp FROM teacher_profiles WHERE id = r.teacher_profile_id;
  IF EXISTS (SELECT 1 FROM teacher_busy(tp.user_id, p_starts_at, p_starts_at + make_interval(mins => r.duration_minutes)) b
              WHERE b.kind = 'lesson') THEN
    RAISE EXCEPTION 'Já há uma aula a essa hora';
  END IF;
  v_moved := p_starts_at <> COALESCE(r.original_starts_at, r.starts_at);
  -- A hora final pode não ser a do pedido: o preço volta a fazer-se.
  SELECT * INTO v_price FROM lesson_request_price(p_id, p_starts_at);
  IF v_price.price IS NOT NULL THEN
    r.price_per_person := v_price.price;
    r.price_peak := v_price.peak;
  END IF;

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
         proposed_starts_at = NULL, proposed_by = NULL, proposed_at = NULL,
         price_per_person = r.price_per_person, price_peak = r.price_peak
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

-- ── 4. Permissões: explícitas (o Supabase dá EXECUTE a anon e authenticated) ─
-- Internas (só as outras funções as chamam).
REVOKE EXECUTE ON FUNCTION lesson_request_price(UUID, TIMESTAMPTZ), book_lesson_request(UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION propose_lesson_time(UUID, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION propose_lesson_time(UUID, TIMESTAMPTZ) TO authenticated;

-- Verificação (só leitura):
-- SELECT proname, proacl FROM pg_proc
--  WHERE proname IN ('lesson_request_price', 'propose_lesson_time', 'book_lesson_request');
