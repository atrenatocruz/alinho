-- ═══════════════════════════════════════════════════════════════════════
-- Aulas — Fase 3, entrega 3: o professor recebe e responde (Trello #392,
-- assunto 2) + o nível dos professores respeita a escolha de cada um
-- (Dev 4, 26 set 2026; desenho aprovado pelo Francisco a 26 set:
--  design-handoff/2026-09-26-marcar-aulas/SPEC.md.)
--
-- O que faz:
--   · list_my_teacher_requests — os pedidos que o professor recebeu (todos os
--     clubes dele), com o botão de contacto que o aluno escolheu (WhatsApp:
--     wa.me/<número>; email: mailto:<email da conta>). Só o professor desse
--     pedido os vê. O número vai só dentro do link, nunca num campo à parte.
--   · accept_lesson_request(p_id) — o professor aceita o pedido tal como o
--     aluno o fez: o aluno fica logo inscrito, sem confirmar (Francisco,
--     26 set). Cria a aula (lessons) e o aluno nela (lesson_attendees,
--     'single', 'confirmed'), para aparecer na Home dele como marcada.
--     O admin do clube recebe «Aula aceite · precisa de campo».
--     «Propor outra hora» (o aluno aceita ou recusa a hora nova) vem numa
--     migração à parte, depois da lista de aprovações do Francisco.
--   · reject_lesson_request — recusa; o telefone apaga-se logo (RGPD).
--   · mark_lesson_court_booked — «Já marquei» (o aviso «Precisa de ti»).
--   · claim_lesson_request_email / claim_lesson_request_student_email — a
--     guarda «só uma vez» dos emails (Edge Function send-email). Só o
--     service_role as chama.
--   · list_teachers_public: o nível passa pela escolha de cada pessoa
--     (can_view_section com results_visibility), como a lista de membros (PO,
--     26 set). O género fica só para «Professor/Professora».
--   · lesson_requests: REVOKE TRUNCATE (higiene, pedido do System Integrator).
--
-- NÃO redefine get_teacher_page aqui: o nível dessa função muda numa
-- migração à parte, escrita a partir do corpo vivo.
--
-- Depende de: migration_lessons_3_requests.sql.
-- Quem corre: o System Integrator, com o «corre» do Francisco. Nenhum dev.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

REVOKE TRUNCATE ON lesson_requests FROM authenticated, anon;

-- Guardas «só uma vez» dos emails.
ALTER TABLE lesson_requests ADD COLUMN IF NOT EXISTS teacher_emailed_at TIMESTAMPTZ;
ALTER TABLE lesson_requests ADD COLUMN IF NOT EXISTS student_emailed_for TEXT;

-- ── 1. O nível dos professores respeita a escolha de cada um ───────────
CREATE OR REPLACE FUNCTION list_teachers_public()
RETURNS TABLE (
  id UUID, user_id UUID, organization_id UUID, club_status TEXT, status TEXT, zone TEXT, contact TEXT,
  name TEXT, avatar_url TEXT, gender TEXT, rating NUMERIC,
  org_name TEXT, org_slug TEXT, availability JSONB, created_at TIMESTAMPTZ
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tp.id, tp.user_id, tp.organization_id, tp.club_status, tp.status, tp.zone, tp.contact,
         p.name, p.avatar_url, p.gender,
         CASE WHEN can_view_section(p.id, p.results_visibility) THEN p.rating END,
         o.name, o.slug,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('teacher_profile_id', ta.teacher_profile_id,
                     'day_of_week', ta.day_of_week, 'start_time', ta.start_time, 'end_time', ta.end_time))
                     FROM teacher_availability ta WHERE ta.teacher_profile_id = tp.id), '[]'::jsonb),
         tp.created_at
    FROM teacher_profiles tp
    JOIN profiles p ON p.id = tp.user_id
    LEFT JOIN organizations o ON o.id = tp.organization_id
   WHERE auth.uid() IS NOT NULL AND teacher_profile_active(tp.id);
$$;

-- ── 2. Os pedidos que o professor recebeu ──────────────────────────────
CREATE OR REPLACE FUNCTION list_my_teacher_requests()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', r.id, 'teacher_profile_id', r.teacher_profile_id, 'status', r.status,
      'created_at', r.created_at, 'starts_at', r.starts_at,
      'duration_minutes', r.duration_minutes, 'lesson_type', r.lesson_type, 'price_per_person', r.price_per_person,
      'org_name', o.name, 'lesson_id', r.lesson_id, 'court_booked_at', r.court_booked_at,
      'student', jsonb_build_object('user_id', s.id, 'name', s.name, 'avatar_url', s.avatar_url, 'gender', s.gender,
                   'rating', CASE WHEN can_view_section(s.id, s.results_visibility) THEN s.rating END),
      'contact_via', r.contact_via,
      -- O contacto só vai dentro do link do botão (o professor não o vê escrito).
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

-- ── 3. Aceitar ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION accept_lesson_request(p_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r lesson_requests;
  tp teacher_profiles;
  v_lesson UUID;
  v_teacher TEXT;
  v_org TEXT;
BEGIN
  SELECT * INTO r FROM lesson_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR r.status <> 'pending' THEN RAISE EXCEPTION 'Pedido não encontrado ou já resolvido'; END IF;
  SELECT * INTO tp FROM teacher_profiles WHERE id = r.teacher_profile_id;
  IF tp.user_id <> auth.uid() THEN RAISE EXCEPTION 'Só o professor pode responder a este pedido'; END IF;
  IF r.starts_at <= NOW() THEN RAISE EXCEPTION 'Essa hora já passou'; END IF;

  -- Não choca com outra coisa já marcada ou pedida (fora este pedido).
  IF EXISTS (
    SELECT 1 FROM teacher_busy(tp.user_id, r.starts_at, r.starts_at + make_interval(mins => r.duration_minutes)) b
     WHERE b.kind = 'lesson'
  ) THEN
    RAISE EXCEPTION 'Já tens uma aula a essa hora';
  END IF;

  INSERT INTO lessons (teacher_profile_id, organization_id, starts_at, duration_minutes, lesson_type, status,
                       price_per_person, price_peak, visibility, created_by)
  VALUES (tp.id, tp.organization_id, r.starts_at, r.duration_minutes, r.lesson_type, 'confirmed',
          r.price_per_person, r.price_peak, 'invited', auth.uid())
  RETURNING id INTO v_lesson;
  INSERT INTO lesson_attendees (lesson_id, user_id, role, status, price, added_by)
  VALUES (v_lesson, r.user_id, 'single', 'confirmed', r.price_per_person, auth.uid());

  UPDATE lesson_requests SET status = 'accepted', lesson_id = v_lesson, resolved_at = NOW(), resolved_by = auth.uid()
   WHERE id = p_id;

  SELECT name INTO v_teacher FROM profiles WHERE id = tp.user_id;
  SELECT name INTO v_org FROM organizations WHERE id = tp.organization_id;
  PERFORM lesson_notify(r.user_id, 'lesson_request_accepted', v_lesson, jsonb_build_object(
    'request_id', p_id, 'teacher_name', v_teacher, 'org_name', v_org, 'starts_at', r.starts_at,
    'duration_minutes', r.duration_minutes, 'lesson_type', r.lesson_type));

  -- O admin do clube sabe que vai ser preciso campo (Francisco, 25 set).
  IF tp.organization_id IS NOT NULL THEN
    PERFORM lesson_notify(m.user_id, 'lesson_needs_court', v_lesson, jsonb_build_object(
      'teacher_name', v_teacher, 'student_name', (SELECT name FROM profiles WHERE id = r.user_id),
      'org_name', v_org, 'starts_at', r.starts_at, 'duration_minutes', r.duration_minutes))
      FROM memberships m
     WHERE m.organization_id = tp.organization_id AND m.is_admin AND m.user_id <> tp.user_id;
  END IF;
  RETURN v_lesson;
END;
$$;

-- ── 4. Recusar ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION reject_lesson_request(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r lesson_requests; v_teacher UUID;
BEGIN
  SELECT * INTO r FROM lesson_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR r.status <> 'pending' THEN RAISE EXCEPTION 'Pedido não encontrado ou já resolvido'; END IF;
  SELECT user_id INTO v_teacher FROM teacher_profiles WHERE id = r.teacher_profile_id;
  IF v_teacher <> auth.uid() THEN RAISE EXCEPTION 'Só o professor pode responder a este pedido'; END IF;
  -- Fechado: o telefone apaga-se logo.
  UPDATE lesson_requests SET status = 'rejected', contact_phone = NULL, resolved_at = NOW(), resolved_by = auth.uid()
   WHERE id = p_id;
  PERFORM lesson_notify(r.user_id, 'lesson_request_rejected', NULL, jsonb_build_object(
    'request_id', p_id, 'teacher_name', (SELECT name FROM profiles WHERE id = v_teacher), 'starts_at', r.starts_at));
END;
$$;

-- ── 5. «Já marquei» (o campo, com a receção do clube) ───────────────────
CREATE OR REPLACE FUNCTION mark_lesson_court_booked(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE lesson_requests r SET court_booked_at = COALESCE(r.court_booked_at, NOW())
    FROM teacher_profiles tp
   WHERE r.id = p_id AND tp.id = r.teacher_profile_id AND tp.user_id = auth.uid() AND r.status = 'accepted';
  IF NOT FOUND THEN RAISE EXCEPTION 'Aula não encontrada'; END IF;
END;
$$;

-- ── 6. Emails: guardas «só uma vez» (só a Edge Function, com service_role) ─
-- Ao professor, quando chega um pedido. Quem chama é o aluno desse pedido.
CREATE OR REPLACE FUNCTION claim_lesson_request_email(p_request_id UUID, p_caller_id UUID)
RETURNS TABLE (teacher_user_id UUID, teacher_language TEXT, student_name TEXT, student_user_id UUID,
               starts_at TIMESTAMPTZ, duration_minutes SMALLINT, lesson_type TEXT, price_per_person NUMERIC,
               org_name TEXT, contact_via TEXT, contact_phone TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE lesson_requests r SET teacher_emailed_at = NOW()
    FROM teacher_profiles tp, profiles t, profiles s
   WHERE r.id = p_request_id AND r.user_id = p_caller_id AND r.status = 'pending' AND r.teacher_emailed_at IS NULL
     AND tp.id = r.teacher_profile_id AND t.id = tp.user_id AND s.id = r.user_id
  RETURNING tp.user_id, t.language, s.name, s.id, r.starts_at, r.duration_minutes, r.lesson_type, r.price_per_person,
            (SELECT name FROM organizations WHERE id = tp.organization_id), r.contact_via, r.contact_phone;
$$;

-- Ao aluno, quando o professor responde, se escolheu «Por email». Quem chama
-- é o professor desse pedido. Uma vez por estado (aceite / recusado).
CREATE OR REPLACE FUNCTION claim_lesson_request_student_email(p_request_id UUID, p_caller_id UUID)
RETURNS TABLE (student_user_id UUID, student_language TEXT, teacher_name TEXT, status TEXT,
               starts_at TIMESTAMPTZ, duration_minutes SMALLINT,
               lesson_type TEXT, org_name TEXT, lesson_id UUID)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE lesson_requests r SET student_emailed_for = r.status
    FROM teacher_profiles tp, profiles t, profiles s
   WHERE r.id = p_request_id AND r.contact_via = 'email' AND r.status IN ('accepted', 'rejected')
     AND r.student_emailed_for IS DISTINCT FROM r.status
     AND tp.id = r.teacher_profile_id AND tp.user_id = p_caller_id AND t.id = tp.user_id AND s.id = r.user_id
  RETURNING s.id, s.language, t.name, r.status, r.starts_at, r.duration_minutes,
            r.lesson_type, (SELECT name FROM organizations WHERE id = tp.organization_id), r.lesson_id;
$$;

-- ── 7. Permissões explícitas ────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION list_teachers_public(), list_my_teacher_requests(),
  accept_lesson_request(UUID), reject_lesson_request(UUID), mark_lesson_court_booked(UUID),
  claim_lesson_request_email(UUID, UUID), claim_lesson_request_student_email(UUID, UUID)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION claim_lesson_request_email(UUID, UUID), claim_lesson_request_student_email(UUID, UUID)
  FROM authenticated;
GRANT EXECUTE ON FUNCTION claim_lesson_request_email(UUID, UUID), claim_lesson_request_student_email(UUID, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION list_teachers_public(), list_my_teacher_requests(),
  accept_lesson_request(UUID), reject_lesson_request(UUID), mark_lesson_court_booked(UUID)
  TO authenticated;

COMMIT;

-- ── Verificação (depois de correr) ──────────────────────────────────────
-- SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
--        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth
--   FROM pg_proc p WHERE p.proname IN ('list_teachers_public','list_my_teacher_requests','accept_lesson_request',
--     'reject_lesson_request','mark_lesson_court_booked','claim_lesson_request_email','claim_lesson_request_student_email');
--   → anon = false em todas; auth = false só nas duas claim_*.
-- SELECT has_table_privilege('authenticated', 'lesson_requests', 'TRUNCATE');  → false
