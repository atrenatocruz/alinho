-- ═══════════════════════════════════════════════════════════════════════
-- Aulas — Fase 3, entrega 2: o aluno pede uma aula (Trello #392, assunto 1)
-- + professores com nome para todos na Comunidade (falha do QA, 26 set)
-- (Dev 4, 26 set 2026; desenho aprovado pelo Francisco a 26 set:
--  design-handoff/2026-09-26-marcar-aulas/SPEC.md.)
--
-- O que faz:
--   · lesson_requests — o pedido de aula: professor (perfil = clube), dia e
--     hora, duração, tipo, preço no momento do pedido e como o aluno quer ser
--     contactado. Uma aprovação só, a do professor (Francisco, 26 set): a
--     resposta do professor vem na entrega 3.
--   · request_lesson / cancel_lesson_request / get_teacher_booking /
--     list_my_lesson_requests.
--   · list_teachers_public — nome, foto, género e nível dos professores
--     aprovados, sem abrir as regras da profiles (a Comunidade mostrava «?»
--     a quem não partilhava um grupo com o professor).
--
-- RGPD (Francisco, 26 set: «ele dá o contacto porque quer»):
--   · O telefone só se guarda se o aluno escolher «Pelo WhatsApp» — é ele que
--     o dá, para aquele pedido. Com «Por email» não se guarda nada: o email
--     lê-se da conta, só por quem recebe o pedido (entrega 3).
--   · Guarda-se só no pedido (contact_phone), só em dígitos, e nunca sai por
--     SELECT direto: o aluno lê as suas linhas; o professor, por RPC.
--   · Apaga-se quando o pedido fecha: ao cancelar ou recusar, logo; aceite,
--     7 dias depois da aula (purge_lesson_request_contacts, cron diário).
--   · Apagar a conta apaga os pedidos (ON DELETE CASCADE).
--
-- Marcar aulas continua escondido pela bandeira lessons até 11 out: as RPCs
-- do aluno recusam com a bandeira desligada (a equipa Alinho passa).
--
-- Depende de: migration_lessons_1_base.sql (lesson_prices, lesson_peak,
--   lesson_price_row, lesson_notify, teacher_profile_active),
--   migration_feature_flag_lessons.sql, migration_teacher_decision_b.sql.
-- Quem corre: o System Integrator, com o «corre» do Francisco. Nenhum dev.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. O pedido ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lesson_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_profile_id UUID NOT NULL REFERENCES teacher_profiles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL,
  duration_minutes SMALLINT NOT NULL CHECK (duration_minutes IN (60, 90, 120)),
  lesson_type TEXT NOT NULL CHECK (lesson_type IN ('private', 'duo', 'trio', 'quad')),
  price_per_person NUMERIC(7,2),
  price_peak BOOLEAN,
  contact_via TEXT NOT NULL CHECK (contact_via IN ('whatsapp', 'email')),
  contact_phone TEXT CHECK (contact_phone IS NULL OR contact_phone ~ '^[0-9]{9,15}$'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
  lesson_id UUID REFERENCES lessons(id) ON DELETE SET NULL,
  court_booked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  -- O telefone só existe com WhatsApp.
  CHECK (contact_via = 'whatsapp' OR contact_phone IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_lesson_requests_teacher ON lesson_requests (teacher_profile_id, status, starts_at);
CREATE INDEX IF NOT EXISTS idx_lesson_requests_user ON lesson_requests (user_id, status);

ALTER TABLE lesson_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Own lesson requests" ON lesson_requests;
CREATE POLICY "Own lesson requests" ON lesson_requests FOR SELECT USING (user_id = auth.uid());
-- Escrita só pelas RPCs; ninguém lê as linhas dos outros diretamente.
REVOKE ALL ON lesson_requests FROM anon;
REVOKE INSERT, UPDATE, DELETE ON lesson_requests FROM authenticated;

-- ── 2. Auxiliares ───────────────────────────────────────────────────────
-- Marcar aulas ligado para quem chama? (bandeira lessons, ou equipa Alinho)
CREATE OR REPLACE FUNCTION lessons_enabled_for_me()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT enabled FROM feature_flags WHERE key = 'lessons'), FALSE)
      OR COALESCE((SELECT is_platform_admin FROM profiles WHERE id = auth.uid()), FALSE);
$$;

-- Os perfis ativos (um por clube) da mesma pessoa que o perfil dado.
CREATE OR REPLACE FUNCTION teacher_sibling_profiles(p_tp UUID)
RETURNS SETOF teacher_profiles LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.* FROM teacher_profiles s
   WHERE s.user_id = (SELECT user_id FROM teacher_profiles WHERE id = p_tp)
     AND teacher_profile_active(s.id);
$$;

-- Ocupado para um professor (qualquer clube): pedidos por responder ou
-- aceites, e aulas não canceladas.
CREATE OR REPLACE FUNCTION teacher_busy(p_user UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS TABLE (starts_at TIMESTAMPTZ, ends_at TIMESTAMPTZ, kind TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.starts_at, r.starts_at + make_interval(mins => r.duration_minutes), 'request'
    FROM lesson_requests r JOIN teacher_profiles tp ON tp.id = r.teacher_profile_id
   WHERE tp.user_id = p_user AND r.status IN ('pending', 'accepted')
     AND r.starts_at < p_to AND r.starts_at + make_interval(mins => r.duration_minutes) > p_from
  UNION ALL
  SELECT l.starts_at, l.starts_at + make_interval(mins => l.duration_minutes), 'lesson'
    FROM lessons l JOIN teacher_profiles tp ON tp.id = l.teacher_profile_id
   WHERE tp.user_id = p_user AND l.status <> 'cancelled'
     AND l.starts_at < p_to AND l.starts_at + make_interval(mins => l.duration_minutes) > p_from;
$$;

-- ── 3. Professores para todos (Comunidade) ─────────────────────────────
-- Os professores ativos, com nome e foto, sem abrir a profiles. O mesmo que
-- a página do professor já mostra a qualquer pessoa com sessão.
CREATE OR REPLACE FUNCTION list_teachers_public()
RETURNS TABLE (
  id UUID, user_id UUID, organization_id UUID, club_status TEXT, status TEXT, zone TEXT, contact TEXT,
  name TEXT, avatar_url TEXT, gender TEXT, rating NUMERIC,
  org_name TEXT, org_slug TEXT, availability JSONB, created_at TIMESTAMPTZ
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tp.id, tp.user_id, tp.organization_id, tp.club_status, tp.status, tp.zone, tp.contact,
         p.name, p.avatar_url, p.gender, p.rating,
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

-- ── 4. O ecrã «Pedir aula» ──────────────────────────────────────────────
-- Tudo o que o ecrã precisa, dos próximos 14 dias, para os clubes todos do
-- professor: horário semanal, horas de ponta, preços, o que está ocupado
-- (sem detalhe) e os pedidos meus a este professor.
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

-- ── 5. Pedir ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION request_lesson(
  p_teacher_profile_id UUID, p_starts_at TIMESTAMPTZ, p_duration SMALLINT, p_type TEXT,
  p_contact_via TEXT, p_phone TEXT DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  tp teacher_profiles;
  v_local TIMESTAMP := p_starts_at AT TIME ZONE 'Europe/Lisbon';
  v_wd SMALLINT := EXTRACT(ISODOW FROM p_starts_at AT TIME ZONE 'Europe/Lisbon')::SMALLINT;
  v_day TEXT;
  v_end TIMESTAMPTZ := p_starts_at + make_interval(mins => p_duration);
  v_peak TEXT;
  v_price lesson_prices;
  v_phone TEXT;
  v_id UUID;
  v_student TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT lessons_enabled_for_me() THEN
    RAISE EXCEPTION 'A marcação de aulas ainda não está aberta';
  END IF;
  SELECT * INTO tp FROM teacher_profiles WHERE id = p_teacher_profile_id;
  IF NOT FOUND OR NOT teacher_profile_active(tp.id) THEN RAISE EXCEPTION 'Professor não encontrado'; END IF;
  IF tp.user_id = auth.uid() THEN RAISE EXCEPTION 'Não podes pedir uma aula a ti próprio'; END IF;
  IF p_starts_at <= NOW() OR p_starts_at > NOW() + INTERVAL '15 days' THEN
    RAISE EXCEPTION 'Escolhe um dia dos próximos 14 dias';
  END IF;
  IF extract(minute FROM v_local)::INT NOT IN (0, 30) THEN RAISE EXCEPTION 'As aulas começam à hora ou à meia hora'; END IF;

  -- Cabe num bloco do horário semanal deste professor, neste clube.
  v_day := (ARRAY['segunda','terca','quarta','quinta','sexta','sabado','domingo'])[v_wd];
  IF NOT EXISTS (
    SELECT 1 FROM teacher_availability ta
     WHERE ta.teacher_profile_id = tp.id AND ta.day_of_week = v_day
       AND v_local::TIME >= ta.start_time
       AND (v_local + make_interval(mins => p_duration))::TIME <= ta.end_time
       AND (v_local + make_interval(mins => p_duration))::DATE = v_local::DATE
  ) THEN
    RAISE EXCEPTION 'Essa hora não cabe no horário do professor';
  END IF;

  -- Não choca com o que já está pedido ou marcado (em qualquer clube dele).
  IF EXISTS (SELECT 1 FROM teacher_busy(tp.user_id, p_starts_at, v_end)) THEN
    RAISE EXCEPTION 'Essa hora já está ocupada';
  END IF;

  -- Preço em vigor (ponta se a aula toca na hora de ponta).
  v_peak := lesson_peak(tp.organization_id, v_wd, v_local::TIME, p_duration);
  v_price := lesson_price_row(tp.id, tp.organization_id, p_type, p_duration, v_peak <> 'off', v_local::DATE);
  IF v_price.id IS NULL OR v_price.price_lesson IS NULL THEN
    RAISE EXCEPTION 'Este professor não tem preço para essa aula';
  END IF;

  -- Contacto: só se guarda o telefone com WhatsApp, e é o aluno que o dá.
  IF p_contact_via NOT IN ('whatsapp', 'email') THEN RAISE EXCEPTION 'Escolhe como o professor fala contigo'; END IF;
  IF p_contact_via = 'whatsapp' THEN
    v_phone := NULLIF(regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g'), '');
    IF v_phone IS NULL THEN
      SELECT NULLIF(regexp_replace(split_part(whatsapp_jid, '@', 1), '\D', '', 'g'), '') INTO v_phone
        FROM profiles WHERE id = auth.uid();
    END IF;
    IF v_phone IS NULL OR length(v_phone) < 9 OR length(v_phone) > 15 THEN
      RAISE EXCEPTION 'Falta o teu número de telefone';
    END IF;
    IF length(v_phone) = 9 THEN v_phone := '351' || v_phone; END IF;
  END IF;

  INSERT INTO lesson_requests (teacher_profile_id, user_id, starts_at, duration_minutes, lesson_type,
                               price_per_person, price_peak, contact_via, contact_phone)
  VALUES (tp.id, auth.uid(), p_starts_at, p_duration, p_type,
          v_price.price_lesson, v_peak <> 'off', p_contact_via, v_phone)
  RETURNING id INTO v_id;

  -- Aviso ao professor no sino (o email vem na entrega 3).
  SELECT name INTO v_student FROM profiles WHERE id = auth.uid();
  PERFORM lesson_notify(tp.user_id, 'lesson_request_new', NULL, jsonb_build_object(
    'request_id', v_id, 'student_name', v_student, 'starts_at', p_starts_at, 'duration_minutes', p_duration,
    'lesson_type', p_type, 'org_name', (SELECT name FROM organizations WHERE id = tp.organization_id),
    'contact_via', p_contact_via));
  RETURN v_id;
END;
$$;

-- ── 6. Cancelar (o aluno) ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cancel_lesson_request(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r lesson_requests;
BEGIN
  SELECT * INTO r FROM lesson_requests WHERE id = p_id AND user_id = auth.uid();
  IF NOT FOUND OR r.status <> 'pending' THEN RAISE EXCEPTION 'Pedido não encontrado ou já resolvido'; END IF;
  -- Fechado: o telefone apaga-se logo.
  UPDATE lesson_requests SET status = 'cancelled', contact_phone = NULL, resolved_at = NOW(), resolved_by = auth.uid()
   WHERE id = p_id;
  PERFORM lesson_notify((SELECT user_id FROM teacher_profiles WHERE id = r.teacher_profile_id), 'lesson_request_cancelled', NULL,
    jsonb_build_object('request_id', p_id, 'student_name', (SELECT name FROM profiles WHERE id = auth.uid()), 'starts_at', r.starts_at));
END;
$$;

-- Os meus pedidos (Home e página do professor): sem o telefone.
CREATE OR REPLACE FUNCTION list_my_lesson_requests()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', r.id, 'teacher_profile_id', r.teacher_profile_id,
           'teacher_name', p.name, 'org_name', o.name, 'starts_at', r.starts_at, 'duration_minutes', r.duration_minutes,
           'lesson_type', r.lesson_type, 'price_per_person', r.price_per_person, 'contact_via', r.contact_via,
           'status', r.status) ORDER BY r.starts_at), '[]'::jsonb)
    FROM lesson_requests r JOIN teacher_profiles tp ON tp.id = r.teacher_profile_id
    JOIN profiles p ON p.id = tp.user_id LEFT JOIN organizations o ON o.id = tp.organization_id
   WHERE r.user_id = auth.uid() AND r.status IN ('pending', 'accepted')
     AND r.starts_at + make_interval(mins => r.duration_minutes) > NOW();
$$;

-- ── 7. RGPD: o telefone não fica mais do que o preciso ──────────────────
CREATE OR REPLACE FUNCTION purge_lesson_request_contacts()
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE lesson_requests SET contact_phone = NULL
   WHERE contact_phone IS NOT NULL
     AND (status IN ('rejected', 'cancelled')
          OR (status = 'accepted' AND starts_at < NOW() - INTERVAL '7 days'));
$$;
DO $$ BEGIN
  PERFORM cron.unschedule('purge-lesson-request-contacts');
EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('purge-lesson-request-contacts', '17 4 * * *', $$SELECT purge_lesson_request_contacts()$$);

-- ── 8. Permissões: explícitas (o Supabase dá EXECUTE a anon e authenticated) ─
REVOKE EXECUTE ON FUNCTION lessons_enabled_for_me(), teacher_sibling_profiles(UUID),
  teacher_busy(UUID, TIMESTAMPTZ, TIMESTAMPTZ), purge_lesson_request_contacts(),
  list_teachers_public(), get_teacher_booking(UUID),
  request_lesson(UUID, TIMESTAMPTZ, SMALLINT, TEXT, TEXT, TEXT), cancel_lesson_request(UUID), list_my_lesson_requests()
  FROM PUBLIC, anon;
-- Internas: nem authenticated.
REVOKE EXECUTE ON FUNCTION lessons_enabled_for_me(), teacher_sibling_profiles(UUID),
  teacher_busy(UUID, TIMESTAMPTZ, TIMESTAMPTZ), purge_lesson_request_contacts()
  FROM authenticated;
GRANT EXECUTE ON FUNCTION list_teachers_public(), get_teacher_booking(UUID),
  request_lesson(UUID, TIMESTAMPTZ, SMALLINT, TEXT, TEXT, TEXT), cancel_lesson_request(UUID), list_my_lesson_requests()
  TO authenticated;

COMMIT;

-- ── Verificação (depois de correr) ──────────────────────────────────────
-- SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
--        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth
--   FROM pg_proc p WHERE p.proname IN ('list_teachers_public','get_teacher_booking','request_lesson',
--     'cancel_lesson_request','list_my_lesson_requests','lessons_enabled_for_me','teacher_busy',
--     'teacher_sibling_profiles','purge_lesson_request_contacts');
--   → anon = false em todas; auth = true só nas 5 primeiras.
-- SELECT * FROM cron.job WHERE jobname = 'purge-lesson-request-contacts';  → 1 linha.
-- SELECT count(*) FROM list_teachers_public();  (com sessão) → os professores ativos.
