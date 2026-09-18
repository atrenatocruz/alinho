-- ════════════════════════════════════════════════════════════════════════
-- Aulas com professores — Fase 1: professores, preços, turmas, inscrição e
-- dia a dia (Trello #49).
--
-- ⚠️  PROPOSTA — NÃO CORRER sem o "sim" do Renato ao modelo.
--     Escrita pelo Dev 1 a 18 set 2026, com autorização do Francisco, para o
--     Renato rever um ficheiro concreto. Modelo e decisões:
--     design-handoff/2026-09-18-aulas-com-treinadores/PLANO-TECNICO.md
--     (cópia: docs/superpowers/specs/2026-09-18-aulas-fase0-modelo-design.md).
--     Os ecrãs que usam estas funções já estão no dev (src/lib/lessonsApi.js).
--
-- Ordem (depende de):
--   migration_teacher_profiles_open.sql   (organization_id opcional, club_status)
--   migration_mix_notices.sql             (tabela notifications — opcional:
--                                          sem ela os avisos não se gravam)
--   migration_instagram_follow_system.sql (is_mutual_follow)
--   migration_club_scoped_groups.sql      (is_org_admin)
--
-- Princípios:
--   · Escrita só por RPCs SECURITY DEFINER; as tabelas novas não têm policies
--     de INSERT/UPDATE/DELETE.
--   · Nomes dos alunos só saem por RPC (colegas na mesma aula, amigos, quem
--     gere). lesson_enrolments / lesson_attendees: cada um só lê as suas.
--   · Não toca em games, participants, process_due_game_recurrences, rankings.
--   · Horas "de relógio" em Lisboa (day_of_week 1 = segunda, TIME) e
--     TIMESTAMPTZ nas aulas concretas.
--
-- Fora desta fase (ficam para as migrações seguintes): avulsas/experimentais/
-- convites (2), blocos livres de data e pedidos (3), fecho "A decidir",
-- compensações e promoções (4), quem gere, versão, XP, kudos, vouchers (5).
-- As colunas de promoção já existem aqui (decisão do Francisco, 18 set:
-- promoção com preço fixo mensal ou por aula), mas sem ecrã nem RPC ainda.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Professor: teacher_profiles ganha "quem gere" e a ordem no clube ──

ALTER TABLE teacher_profiles ADD COLUMN IF NOT EXISTS managed_by TEXT NOT NULL DEFAULT 'both'
  CHECK (managed_by IN ('club', 'teacher', 'both'));
ALTER TABLE teacher_profiles ADD COLUMN IF NOT EXISTS sort_order INTEGER;

-- Perfil que pode ter aulas: aprovado pela equipa Alinho e, com clube,
-- aceite pelo clube.
CREATE OR REPLACE FUNCTION teacher_profile_active(p_tp UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM teacher_profiles tp
    WHERE tp.id = p_tp AND tp.status = 'approved'
      AND (tp.organization_id IS NULL OR tp.club_status = 'accepted')
  );
$$;

CREATE OR REPLACE FUNCTION is_platform_admin_me()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT is_platform_admin FROM profiles WHERE id = auth.uid()), FALSE);
$$;

-- Pode criar/editar turmas, aulas e preços deste professor. Até à Fase 5
-- managed_by fica 'both' (o professor e o clube editam).
CREATE OR REPLACE FUNCTION can_edit_lessons(p_tp UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM teacher_profiles tp
    WHERE tp.id = p_tp AND (
      (tp.user_id = auth.uid() AND tp.managed_by IN ('teacher', 'both'))
      OR (tp.organization_id IS NOT NULL AND tp.managed_by IN ('club', 'both') AND is_org_admin(tp.organization_id))
    )
  ) OR is_platform_admin_me();
$$;

-- Marcar faltas: o professor e o clube, sempre (mesmo com managed_by='club',
-- "a Ana só vê e marca faltas").
CREATE OR REPLACE FUNCTION can_mark_attendance(p_tp UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM teacher_profiles tp
    WHERE tp.id = p_tp AND (tp.user_id = auth.uid() OR (tp.organization_id IS NOT NULL AND is_org_admin(tp.organization_id)))
  ) OR is_platform_admin_me();
$$;

-- Vê tudo da agenda (nomes incluídos), mesmo sem poder editar.
CREATE OR REPLACE FUNCTION can_view_lesson_admin(p_tp UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT can_mark_attendance(p_tp);
$$;

-- Banda de nível (1..6, 7 = Iniciante) — as mesmas fronteiras de src/lib/elo.js.
CREATE OR REPLACE FUNCTION lesson_band(p_rating NUMERIC)
RETURNS SMALLINT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_rating IS NULL THEN NULL
    WHEN p_rating >= 1800 THEN 1 WHEN p_rating >= 1600 THEN 2 WHEN p_rating >= 1400 THEN 3
    WHEN p_rating >= 1200 THEN 4 WHEN p_rating >= 1000 THEN 5 WHEN p_rating >= 700 THEN 6
    ELSE 7 END::SMALLINT;
$$;

CREATE OR REPLACE FUNCTION lesson_capacity(p_type TEXT)
RETURNS SMALLINT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_type WHEN 'private' THEN 1 WHEN 'duo' THEN 2 WHEN 'trio' THEN 3 WHEN 'quad' THEN 4 END::SMALLINT;
$$;

-- ── 2. Preços e horas de ponta ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS club_peak_hours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  CHECK (end_time > start_time)
);
CREATE INDEX IF NOT EXISTS idx_club_peak_hours_org ON club_peak_hours (organization_id);

-- Tabela acordada clube/professor (SPEC §7): tipo × duração × ponta/fora,
-- com mês (turma) e aula (avulsa). Revisões com valid_from — nunca se apaga
-- o histórico. teacher_profile_id NULL = preço do clube para todos.
CREATE TABLE IF NOT EXISTS lesson_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  teacher_profile_id UUID REFERENCES teacher_profiles(id) ON DELETE CASCADE,
  lesson_type TEXT NOT NULL CHECK (lesson_type IN ('private', 'duo', 'trio', 'quad', 'trial')),
  duration_minutes SMALLINT NOT NULL CHECK (duration_minutes IN (60, 90, 120)),
  peak BOOLEAN NOT NULL,
  price_month NUMERIC(7,2) CHECK (price_month IS NULL OR price_month >= 0),
  price_lesson NUMERIC(7,2) CHECK (price_lesson IS NULL OR price_lesson >= 0),
  valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (organization_id IS NOT NULL OR teacher_profile_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS lesson_prices_once
  ON lesson_prices (COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid),
                    COALESCE(teacher_profile_id, '00000000-0000-0000-0000-000000000000'::uuid),
                    lesson_type, duration_minutes, peak, valid_from);

-- Preço em vigor numa data: primeiro o do professor, senão o do clube.
CREATE OR REPLACE FUNCTION lesson_price_row(p_tp UUID, p_org UUID, p_type TEXT, p_duration SMALLINT, p_peak BOOLEAN, p_on DATE)
RETURNS lesson_prices LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT lp.* FROM lesson_prices lp
  WHERE lp.lesson_type = p_type AND lp.duration_minutes = p_duration AND lp.peak = p_peak AND lp.valid_from <= p_on
    AND (lp.teacher_profile_id = p_tp OR (lp.teacher_profile_id IS NULL AND lp.organization_id = p_org))
  ORDER BY (lp.teacher_profile_id IS NOT NULL) DESC, lp.valid_from DESC
  LIMIT 1;
$$;

-- 'peak' | 'off' | 'mixed' (mixed: quem cria escolhe o preço).
CREATE OR REPLACE FUNCTION lesson_peak(p_org UUID, p_weekday SMALLINT, p_start TIME, p_duration SMALLINT)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH r AS (
    SELECT start_time, end_time FROM club_peak_hours WHERE organization_id = p_org AND day_of_week = p_weekday
  )
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM r WHERE p_start >= r.start_time AND p_start + make_interval(mins => p_duration) <= r.end_time) THEN 'peak'
    WHEN EXISTS (SELECT 1 FROM r WHERE p_start < r.end_time AND p_start + make_interval(mins => p_duration) > r.start_time) THEN 'mixed'
    ELSE 'off' END;
$$;

-- ── 3. Turmas e inscrições ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lesson_series (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_profile_id UUID NOT NULL REFERENCES teacher_profiles(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  start_time TIME NOT NULL,
  duration_minutes SMALLINT NOT NULL CHECK (duration_minutes IN (60, 90, 120)),
  lesson_type TEXT NOT NULL CHECK (lesson_type IN ('private', 'duo', 'trio', 'quad')),
  level_from SMALLINT CHECK (level_from BETWEEN 1 AND 7),
  level_to SMALLINT CHECK (level_to BETWEEN 1 AND 7),
  gender_restriction TEXT NOT NULL DEFAULT 'misto' CHECK (gender_restriction IN ('misto', 'masculino', 'feminino')),
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'club', 'invited')),
  close_hours_before SMALLINT NOT NULL DEFAULT 24 CHECK (close_hours_before >= 12),
  accepts_trial BOOLEAN NOT NULL DEFAULT TRUE,
  trial_free BOOLEAN NOT NULL DEFAULT TRUE,
  announce_whatsapp BOOLEAN NOT NULL DEFAULT FALSE,
  price_peak BOOLEAN NOT NULL,
  promo_price_month NUMERIC(7,2),               -- Fase 4 (promoção mensal)
  promo_until DATE,                             -- por decidir; sem ecrã
  prize TEXT, has_voucher BOOLEAN NOT NULL DEFAULT FALSE,   -- Fase 5
  court TEXT,
  starts_on DATE NOT NULL,
  ends_on DATE,
  teacher_accepted_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending_teacher', 'active', 'ended')),
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1,
  CHECK (level_from IS NULL OR level_to IS NULL OR level_from >= level_to)
);
CREATE INDEX IF NOT EXISTS idx_lesson_series_tp ON lesson_series (teacher_profile_id);
CREATE INDEX IF NOT EXISTS idx_lesson_series_org ON lesson_series (organization_id);

CREATE TABLE IF NOT EXISTS lesson_enrolments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id UUID NOT NULL REFERENCES lesson_series(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'accepted', 'confirmed', 'leaving', 'ended', 'rejected', 'withdrawn')),
  starts_on DATE,
  ends_on DATE,
  first_month_amount NUMERIC(7,2),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ, accepted_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  confirmed_at TIMESTAMPTZ, cancelled_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS lesson_enrolments_one_open
  ON lesson_enrolments (series_id, user_id) WHERE status IN ('requested', 'accepted', 'confirmed', 'leaving');
CREATE INDEX IF NOT EXISTS idx_lesson_enrolments_user ON lesson_enrolments (user_id);

-- ── 4. Aulas concretas e quem vai ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lesson_cancellations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_profile_id UUID NOT NULL REFERENCES teacher_profiles(id) ON DELETE CASCADE,
  series_id UUID REFERENCES lesson_series(id) ON DELETE CASCADE,
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('illness', 'holiday', 'vacation', 'other')),
  note TEXT,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (to_date >= from_date)
);

CREATE TABLE IF NOT EXISTS lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id UUID REFERENCES lesson_series(id) ON DELETE CASCADE,
  teacher_profile_id UUID NOT NULL REFERENCES teacher_profiles(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL,
  duration_minutes SMALLINT NOT NULL CHECK (duration_minutes IN (60, 90, 120)),
  lesson_type TEXT NOT NULL CHECK (lesson_type IN ('private', 'duo', 'trio', 'quad')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'confirmed', 'deciding', 'cancelled')),
  close_at TIMESTAMPTZ,
  price_per_person NUMERIC(7,2),
  price_peak BOOLEAN,
  promo_price NUMERIC(7,2),                     -- Fase 4 (promoção por aula)
  level_from SMALLINT, level_to SMALLINT,
  gender_restriction TEXT NOT NULL DEFAULT 'misto' CHECK (gender_restriction IN ('misto', 'masculino', 'feminino')),
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'club', 'invited')),
  court TEXT,
  accepts_trial BOOLEAN NOT NULL DEFAULT FALSE,
  trial_free BOOLEAN NOT NULL DEFAULT FALSE,
  cancel_reason TEXT CHECK (cancel_reason IN ('illness', 'holiday', 'vacation', 'other')),
  cancel_note TEXT,
  cancelled_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  cancelled_at TIMESTAMPTZ,
  cancellation_id UUID REFERENCES lesson_cancellations(id) ON DELETE SET NULL,
  prize TEXT, has_voucher BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS lessons_series_once ON lessons (series_id, starts_at) WHERE series_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lessons_tp_start ON lessons (teacher_profile_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_lessons_org_start ON lessons (organization_id, starts_at);

-- A forma (turma, avulsa, experimental, convite, compensação) é do aluno.
CREATE TABLE IF NOT EXISTS lesson_attendees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  guest_name TEXT,
  role TEXT NOT NULL CHECK (role IN ('class', 'single', 'trial', 'free_invite', 'compensation', 'guest')),
  status TEXT NOT NULL CHECK (status IN ('invited', 'requested', 'accepted', 'confirmed', 'not_going', 'absent', 'declined', 'left')),
  price NUMERIC(7,2),
  added_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  marked_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  marked_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  CHECK ((user_id IS NULL) <> (guest_name IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS lesson_attendees_once ON lesson_attendees (lesson_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lesson_attendees_user ON lesson_attendees (user_id);

-- Lugares ocupados: aceites/confirmados e convidados sem conta. "Não vai" e
-- falta libertam o lugar nesse dia.
CREATE OR REPLACE FUNCTION lesson_taken(p_lesson UUID)
RETURNS INTEGER LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COUNT(*)::INTEGER FROM lesson_attendees WHERE lesson_id = p_lesson AND status IN ('accepted', 'confirmed');
$$;

-- ── 5. Quem vê (RLS) ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION lesson_visible_to_me(p_visibility TEXT, p_org UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE p_visibility
    WHEN 'public' THEN auth.uid() IS NOT NULL
    WHEN 'club' THEN EXISTS (SELECT 1 FROM memberships WHERE organization_id = p_org AND user_id = auth.uid())
    ELSE FALSE END;
$$;

ALTER TABLE club_peak_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE lesson_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE lesson_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE lesson_enrolments ENABLE ROW LEVEL SECURITY;
ALTER TABLE lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE lesson_attendees ENABLE ROW LEVEL SECURITY;
ALTER TABLE lesson_cancellations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Prices are public" ON lesson_prices;
CREATE POLICY "Prices are public" ON lesson_prices FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS "Peak hours are public" ON club_peak_hours;
CREATE POLICY "Peak hours are public" ON club_peak_hours FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "See series" ON lesson_series;
CREATE POLICY "See series" ON lesson_series FOR SELECT TO authenticated USING (
  can_view_lesson_admin(teacher_profile_id)
  OR (status = 'active' AND lesson_visible_to_me(visibility, organization_id))
  OR EXISTS (SELECT 1 FROM lesson_enrolments e WHERE e.series_id = lesson_series.id AND e.user_id = auth.uid())
);

DROP POLICY IF EXISTS "See lessons" ON lessons;
CREATE POLICY "See lessons" ON lessons FOR SELECT TO authenticated USING (
  can_view_lesson_admin(teacher_profile_id)
  OR lesson_visible_to_me(visibility, organization_id)
  OR EXISTS (SELECT 1 FROM lesson_attendees a WHERE a.lesson_id = lessons.id AND a.user_id = auth.uid())
);

DROP POLICY IF EXISTS "Own enrolments" ON lesson_enrolments;
CREATE POLICY "Own enrolments" ON lesson_enrolments FOR SELECT TO authenticated USING (
  user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM lesson_series s WHERE s.id = lesson_enrolments.series_id AND can_view_lesson_admin(s.teacher_profile_id))
);

DROP POLICY IF EXISTS "Own attendance" ON lesson_attendees;
CREATE POLICY "Own attendance" ON lesson_attendees FOR SELECT TO authenticated USING (
  user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM lessons l WHERE l.id = lesson_attendees.lesson_id AND can_view_lesson_admin(l.teacher_profile_id))
);

DROP POLICY IF EXISTS "Managers see cancellations" ON lesson_cancellations;
CREATE POLICY "Managers see cancellations" ON lesson_cancellations FOR SELECT TO authenticated USING (
  can_view_lesson_admin(teacher_profile_id)
);

REVOKE INSERT, UPDATE, DELETE ON club_peak_hours, lesson_prices, lesson_series, lesson_enrolments,
  lessons, lesson_attendees, lesson_cancellations FROM anon, authenticated;
REVOKE ALL ON club_peak_hours, lesson_prices, lesson_series, lesson_enrolments,
  lessons, lesson_attendees, lesson_cancellations FROM anon;

-- ── 6. Avisos (sino) ──────────────────────────────────────────────────────
-- notifications vem de migration_mix_notices.sql. Se ainda não existir, os
-- avisos simplesmente não se gravam. O bot só lê os kinds de mix
-- (whatsapp-bot/src/mixNotices.js), por isso ignora os lesson_*.

ALTER TABLE IF EXISTS notifications ADD COLUMN IF NOT EXISTS lesson_id UUID REFERENCES lessons(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION lesson_notify(p_user UUID, p_kind TEXT, p_lesson UUID, p_data JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_user IS NULL OR to_regclass('public.notifications') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE 'INSERT INTO notifications (user_id, kind, actor_id, lesson_id, data) VALUES ($1, $2, $3, $4, $5)'
    USING p_user, p_kind, auth.uid(), p_lesson, COALESCE(p_data, '{}'::jsonb);
END;
$$;

-- Nome curto de uma turma para os avisos ("Turma a 4 de terças").
CREATE OR REPLACE FUNCTION lesson_series_label(p_series UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT 'Turma ' || CASE s.lesson_type WHEN 'private' THEN 'privada' WHEN 'duo' THEN 'a 2' WHEN 'trio' THEN 'a 3' ELSE 'a 4' END
    || ' de ' || (ARRAY['segundas','terças','quartas','quintas','sextas','sábados','domingos'])[s.day_of_week]
  FROM lesson_series s WHERE s.id = p_series;
$$;

-- ── 7. Gerar as aulas da turma (4 semanas à frente) ───────────────────────
-- Função e cron próprios: NÃO mexe em process_due_game_recurrences.

CREATE OR REPLACE FUNCTION generate_series_lessons(p_series UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s lesson_series;
  d DATE;
  v_start TIMESTAMPTZ;
  v_lesson UUID;
  v_price NUMERIC;
  c lesson_cancellations;
BEGIN
  SELECT * INTO s FROM lesson_series WHERE id = p_series;
  IF NOT FOUND OR s.status <> 'active' THEN RETURN; END IF;

  FOR d IN
    SELECT g::date FROM generate_series(GREATEST(s.starts_on, (NOW() AT TIME ZONE 'Europe/Lisbon')::date),
                                        (NOW() AT TIME ZONE 'Europe/Lisbon')::date + 28, INTERVAL '1 day') g
    WHERE EXTRACT(ISODOW FROM g) = s.day_of_week AND (s.ends_on IS NULL OR g::date <= s.ends_on)
  LOOP
    v_start := (d + s.start_time) AT TIME ZONE 'Europe/Lisbon';
    v_price := (lesson_price_row(s.teacher_profile_id, s.organization_id, s.lesson_type, s.duration_minutes, s.price_peak, d)).price_lesson;
    SELECT * INTO c FROM lesson_cancellations lc
      WHERE lc.teacher_profile_id = s.teacher_profile_id AND (lc.series_id IS NULL OR lc.series_id = s.id)
        AND d BETWEEN lc.from_date AND lc.to_date
      ORDER BY lc.created_at DESC LIMIT 1;

    INSERT INTO lessons (series_id, teacher_profile_id, organization_id, starts_at, duration_minutes, lesson_type,
                         status, close_at, price_per_person, price_peak, level_from, level_to, gender_restriction,
                         visibility, court, accepts_trial, trial_free,
                         cancel_reason, cancel_note, cancellation_id, cancelled_at, created_by)
    VALUES (s.id, s.teacher_profile_id, s.organization_id, v_start, s.duration_minutes, s.lesson_type,
            CASE WHEN c.id IS NULL THEN 'open' ELSE 'cancelled' END,
            v_start - make_interval(hours => s.close_hours_before), v_price, s.price_peak, s.level_from, s.level_to,
            s.gender_restriction, s.visibility, s.court, s.accepts_trial, s.trial_free,
            c.reason, c.note, c.id, CASE WHEN c.id IS NULL THEN NULL ELSE NOW() END, s.created_by)
    ON CONFLICT (series_id, starts_at) WHERE series_id IS NOT NULL DO NOTHING
    RETURNING id INTO v_lesson;

    IF v_lesson IS NOT NULL THEN
      INSERT INTO lesson_attendees (lesson_id, user_id, role, status, added_by)
      SELECT v_lesson, e.user_id, 'class', 'confirmed', e.accepted_by
      FROM lesson_enrolments e
      WHERE e.series_id = s.id AND e.status IN ('confirmed', 'leaving')
        AND (e.starts_on IS NULL OR e.starts_on <= d) AND (e.ends_on IS NULL OR e.ends_on >= d)
      ON CONFLICT (lesson_id, user_id) WHERE user_id IS NOT NULL DO NOTHING;
      UPDATE lessons SET status = 'confirmed'
        WHERE id = v_lesson AND status = 'open' AND lesson_taken(v_lesson) >= lesson_capacity(lesson_type);
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION process_due_lesson_series()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM lesson_series WHERE status = 'active' LOOP
    PERFORM generate_series_lessons(r.id);
  END LOOP;
  -- Inscrições a sair: no dia seguinte a ends_on passam a 'ended'.
  UPDATE lesson_enrolments SET status = 'ended'
    WHERE status = 'leaving' AND ends_on < (NOW() AT TIME ZONE 'Europe/Lisbon')::date;
  -- "A decidir" à hora-limite fica para a Fase 4.
END;
$$;

REVOKE ALL ON FUNCTION generate_series_lessons(UUID), process_due_lesson_series() FROM public, anon, authenticated;

SELECT cron.schedule('process-lesson-series', '7 * * * *', $$SELECT process_due_lesson_series()$$);

-- ── 8. RPCs de gestão (professor / clube) ─────────────────────────────────

CREATE OR REPLACE FUNCTION set_club_peak_hours(p_organization_id UUID, p_ranges JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (is_org_admin(p_organization_id) OR is_platform_admin_me()) THEN
    RAISE EXCEPTION 'Só a gestão do clube pode mudar as horas de ponta';
  END IF;
  DELETE FROM club_peak_hours WHERE organization_id = p_organization_id;
  INSERT INTO club_peak_hours (organization_id, day_of_week, start_time, end_time)
  SELECT p_organization_id, (r->>'day_of_week')::smallint, (r->>'start_time')::time, (r->>'end_time')::time
  FROM jsonb_array_elements(COALESCE(p_ranges, '[]'::jsonb)) r;
END;
$$;

-- Grava uma revisão nova da tabela, em vigor a partir de hoje. Linhas que
-- deixam de existir ficam a NULL (não há) nesta revisão.
CREATE OR REPLACE FUNCTION set_lesson_prices(p_organization_id UUID, p_teacher_profile_id UUID, p_prices JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_teacher_profile_id IS NULL THEN
    IF NOT (is_org_admin(p_organization_id) OR is_platform_admin_me()) THEN
      RAISE EXCEPTION 'Só a gestão do clube pode mudar a tabela de preços';
    END IF;
  ELSIF NOT can_edit_lessons(p_teacher_profile_id) THEN
    RAISE EXCEPTION 'Sem permissão para mudar estes preços';
  END IF;

  DELETE FROM lesson_prices
  WHERE organization_id IS NOT DISTINCT FROM p_organization_id
    AND teacher_profile_id IS NOT DISTINCT FROM p_teacher_profile_id
    AND valid_from = CURRENT_DATE;

  INSERT INTO lesson_prices (organization_id, teacher_profile_id, lesson_type, duration_minutes, peak,
                             price_month, price_lesson, valid_from, created_by)
  SELECT p_organization_id, p_teacher_profile_id, r->>'lesson_type', (r->>'duration_minutes')::smallint, (r->>'peak')::boolean,
         NULLIF(r->>'price_month', '')::numeric, NULLIF(r->>'price_lesson', '')::numeric, CURRENT_DATE, auth.uid()
  FROM jsonb_array_elements(COALESCE(p_prices, '[]'::jsonb)) r;
END;
$$;

CREATE OR REPLACE FUNCTION set_teacher_sort_order(p_organization_id UUID, p_teacher_profile_ids UUID[])
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (is_org_admin(p_organization_id) OR is_platform_admin_me()) THEN
    RAISE EXCEPTION 'Só a gestão do clube pode ordenar os professores';
  END IF;
  UPDATE teacher_profiles tp SET sort_order = o.ord
  FROM unnest(p_teacher_profile_ids) WITH ORDINALITY AS o(id, ord)
  WHERE tp.id = o.id AND tp.organization_id = p_organization_id;
END;
$$;

CREATE OR REPLACE FUNCTION create_lesson_series(p_fields JSONB)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tp teacher_profiles;
  v_id UUID;
  v_type TEXT := p_fields->>'lesson_type';
  v_dur SMALLINT := (p_fields->>'duration_minutes')::smallint;
  v_peak BOOLEAN := (p_fields->>'price_peak')::boolean;
BEGIN
  SELECT * INTO v_tp FROM teacher_profiles WHERE id = (p_fields->>'teacher_profile_id')::uuid;
  IF NOT FOUND OR NOT teacher_profile_active(v_tp.id) THEN
    RAISE EXCEPTION 'Este professor ainda não pode dar aulas';
  END IF;
  IF NOT can_edit_lessons(v_tp.id) THEN
    RAISE EXCEPTION 'Sem permissão para criar turmas deste professor';
  END IF;
  IF v_peak IS NULL THEN
    RAISE EXCEPTION 'Falta escolher o preço de hora de ponta ou fora de ponta';
  END IF;
  -- O preço vem da tabela e não se edita aqui (SPEC §6.2).
  IF (lesson_price_row(v_tp.id, v_tp.organization_id, v_type, v_dur, v_peak, CURRENT_DATE)).price_month IS NULL THEN
    RAISE EXCEPTION 'Não há mensalidade na tabela de preços para esta turma';
  END IF;

  INSERT INTO lesson_series (teacher_profile_id, organization_id, day_of_week, start_time, duration_minutes, lesson_type,
                             level_from, level_to, gender_restriction, visibility, close_hours_before,
                             accepts_trial, trial_free, announce_whatsapp, price_peak, court, starts_on,
                             teacher_accepted_at, status, created_by)
  VALUES (v_tp.id, v_tp.organization_id, (p_fields->>'day_of_week')::smallint, (p_fields->>'start_time')::time, v_dur, v_type,
          NULLIF(p_fields->>'level_from', '')::smallint, NULLIF(p_fields->>'level_to', '')::smallint,
          COALESCE(p_fields->>'gender_restriction', 'misto'), COALESCE(p_fields->>'visibility', 'public'),
          COALESCE((p_fields->>'close_hours_before')::smallint, 24),
          COALESCE((p_fields->>'accepts_trial')::boolean, TRUE), COALESCE((p_fields->>'trial_free')::boolean, TRUE),
          COALESCE((p_fields->>'announce_whatsapp')::boolean, FALSE), v_peak, p_fields->>'court',
          COALESCE((p_fields->>'starts_on')::date, CURRENT_DATE),
          CASE WHEN v_tp.user_id = auth.uid() THEN NOW() END,
          -- "O professor aceita o que o clube cria por ele" (SPEC §5).
          CASE WHEN v_tp.user_id = auth.uid() THEN 'active' ELSE 'pending_teacher' END,
          auth.uid())
  RETURNING id INTO v_id;

  PERFORM generate_series_lessons(v_id);
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION accept_lesson_series(p_series_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE lesson_series s SET status = 'active', teacher_accepted_at = NOW()
  FROM teacher_profiles tp
  WHERE s.id = p_series_id AND tp.id = s.teacher_profile_id AND tp.user_id = auth.uid() AND s.status = 'pending_teacher';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esta turma não está à tua espera';
  END IF;
  PERFORM generate_series_lessons(p_series_id);
END;
$$;

CREATE OR REPLACE FUNCTION resolve_enrolment(p_enrolment_id UUID, p_accept BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e lesson_enrolments; s lesson_series; v_teacher TEXT;
BEGIN
  SELECT * INTO e FROM lesson_enrolments WHERE id = p_enrolment_id FOR UPDATE;
  IF NOT FOUND OR e.status <> 'requested' THEN RAISE EXCEPTION 'Este pedido já foi respondido'; END IF;
  SELECT * INTO s FROM lesson_series WHERE id = e.series_id;
  IF NOT can_edit_lessons(s.teacher_profile_id) THEN RAISE EXCEPTION 'Sem permissão para responder a este pedido'; END IF;

  UPDATE lesson_enrolments
  SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'rejected' END, accepted_at = NOW(), accepted_by = auth.uid()
  WHERE id = e.id;

  SELECT p.name INTO v_teacher FROM teacher_profiles tp JOIN profiles p ON p.id = tp.user_id WHERE tp.id = s.teacher_profile_id;
  PERFORM lesson_notify(e.user_id, CASE WHEN p_accept THEN 'lesson_enrolment_accepted' ELSE 'lesson_enrolment_rejected' END, NULL,
    jsonb_build_object('teacher_name', v_teacher, 'teacher_profile_id', s.teacher_profile_id, 'series_label', lesson_series_label(s.id)));
END;
$$;

CREATE OR REPLACE FUNCTION mark_lesson_absence(p_lesson_id UUID, p_user_id UUID, p_note TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l lessons;
BEGIN
  SELECT * INTO l FROM lessons WHERE id = p_lesson_id;
  IF NOT FOUND OR NOT can_mark_attendance(l.teacher_profile_id) THEN RAISE EXCEPTION 'Sem permissão para marcar faltas'; END IF;
  UPDATE lesson_attendees SET status = 'absent', marked_by = auth.uid(), marked_note = NULLIF(TRIM(p_note), ''), updated_at = NOW()
  WHERE lesson_id = p_lesson_id AND user_id = p_user_id AND status IN ('confirmed', 'not_going');
  IF NOT FOUND THEN RAISE EXCEPTION 'Este aluno não está nesta aula'; END IF;
  UPDATE lessons SET status = 'open' WHERE id = p_lesson_id AND status = 'confirmed';
END;
$$;

CREATE OR REPLACE FUNCTION cancel_lesson(p_lesson_id UUID, p_reason TEXT, p_note TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l lessons; v_teacher TEXT; a RECORD;
BEGIN
  SELECT * INTO l FROM lessons WHERE id = p_lesson_id FOR UPDATE;
  IF NOT FOUND OR NOT can_edit_lessons(l.teacher_profile_id) THEN RAISE EXCEPTION 'Sem permissão para cancelar esta aula'; END IF;
  IF l.status = 'cancelled' THEN RETURN; END IF;
  UPDATE lessons SET status = 'cancelled', cancel_reason = p_reason, cancel_note = NULLIF(TRIM(p_note), ''),
                     cancelled_by = auth.uid(), cancelled_at = NOW()
  WHERE id = p_lesson_id;
  SELECT p.name INTO v_teacher FROM teacher_profiles tp JOIN profiles p ON p.id = tp.user_id WHERE tp.id = l.teacher_profile_id;
  FOR a IN SELECT user_id FROM lesson_attendees WHERE lesson_id = p_lesson_id AND user_id IS NOT NULL AND status IN ('accepted', 'confirmed', 'not_going') LOOP
    PERFORM lesson_notify(a.user_id, 'lesson_cancelled', p_lesson_id,
      jsonb_build_object('teacher_name', v_teacher, 'lesson_id', p_lesson_id, 'lesson_date', l.starts_at, 'reason', p_reason));
  END LOOP;
  -- A mensalidade não muda; a compensação entra na Fase 4.
END;
$$;

CREATE OR REPLACE FUNCTION cancel_lesson_period(p_series_id UUID, p_from DATE, p_to DATE, p_reason TEXT, p_note TEXT)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s lesson_series; v_cancel UUID; v_n INTEGER := 0; r RECORD;
BEGIN
  SELECT * INTO s FROM lesson_series WHERE id = p_series_id;
  IF NOT FOUND OR NOT can_edit_lessons(s.teacher_profile_id) THEN RAISE EXCEPTION 'Sem permissão para cancelar estas aulas'; END IF;
  IF p_to < p_from THEN RAISE EXCEPTION 'A data de fim tem de ser depois da de início'; END IF;
  INSERT INTO lesson_cancellations (teacher_profile_id, series_id, from_date, to_date, reason, note, created_by)
  VALUES (s.teacher_profile_id, s.id, p_from, p_to, p_reason, NULLIF(TRIM(p_note), ''), auth.uid())
  RETURNING id INTO v_cancel;
  -- As aulas que já existem nesse intervalo; as que o cron criar depois
  -- já nascem canceladas (generate_series_lessons lê lesson_cancellations).
  FOR r IN SELECT id FROM lessons
           WHERE series_id = s.id AND status <> 'cancelled'
             AND (starts_at AT TIME ZONE 'Europe/Lisbon')::date BETWEEN p_from AND p_to LOOP
    PERFORM cancel_lesson(r.id, p_reason, p_note);
    UPDATE lessons SET cancellation_id = v_cancel WHERE id = r.id;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

-- ── 9. RPCs do aluno ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION request_enrolment(p_series_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s lesson_series; v_gender TEXT; v_taken INTEGER; v_id UUID; v_tp_user UUID; v_me TEXT;
BEGIN
  SELECT * INTO s FROM lesson_series WHERE id = p_series_id;
  IF NOT FOUND OR s.status <> 'active' OR NOT lesson_visible_to_me(s.visibility, s.organization_id) THEN
    RAISE EXCEPTION 'Esta turma não está disponível';
  END IF;
  SELECT gender, name INTO v_gender, v_me FROM profiles WHERE id = auth.uid();
  IF s.gender_restriction <> 'misto' AND v_gender IS DISTINCT FROM s.gender_restriction THEN
    RAISE EXCEPTION 'Esta turma é só para %', CASE s.gender_restriction WHEN 'masculino' THEN 'homens' ELSE 'mulheres' END;
  END IF;
  SELECT COUNT(*) INTO v_taken FROM lesson_enrolments WHERE series_id = s.id AND status IN ('accepted', 'confirmed', 'leaving');
  IF v_taken >= lesson_capacity(s.lesson_type) THEN
    RAISE EXCEPTION 'Esta turma está completa';
  END IF;
  -- O nível não bloqueia: o pedido vai sempre para o professor, que decide.
  INSERT INTO lesson_enrolments (series_id, user_id) VALUES (s.id, auth.uid()) RETURNING id INTO v_id;

  SELECT user_id INTO v_tp_user FROM teacher_profiles WHERE id = s.teacher_profile_id;
  PERFORM lesson_notify(v_tp_user, 'lesson_enrolment_request', NULL,
    jsonb_build_object('student_name', v_me, 'series_label', lesson_series_label(s.id),
                       'org_slug', (SELECT slug FROM organizations WHERE id = s.organization_id)));
  RETURN jsonb_build_object('enrolment_id', v_id, 'status', 'requested');
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Já pediste para entrar nesta turma';
END;
$$;

-- Depois de o professor aceitar, o aluno confirma: fica inscrito a partir
-- da próxima aula, com o ajuste do 1.º mês (SPEC §3.5 — igual a
-- firstMonthAmount em src/lib/lessons.js).
CREATE OR REPLACE FUNCTION confirm_enrolment(p_enrolment_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e lesson_enrolments; s lesson_series; v_start DATE; v_total INTEGER; v_left INTEGER; v_month NUMERIC; v_today DATE;
BEGIN
  SELECT * INTO e FROM lesson_enrolments WHERE id = p_enrolment_id AND user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND OR e.status <> 'accepted' THEN RAISE EXCEPTION 'Este pedido não está à espera da tua confirmação'; END IF;
  SELECT * INTO s FROM lesson_series WHERE id = e.series_id;
  v_today := (NOW() AT TIME ZONE 'Europe/Lisbon')::date;
  SELECT MIN(g::date) INTO v_start FROM generate_series(GREATEST(v_today, s.starts_on), GREATEST(v_today, s.starts_on) + 6, INTERVAL '1 day') g
    WHERE EXTRACT(ISODOW FROM g) = s.day_of_week;
  SELECT COUNT(*) FILTER (WHERE TRUE), COUNT(*) FILTER (WHERE g::date >= v_start)
    INTO v_total, v_left
    FROM generate_series(date_trunc('month', v_start)::date, (date_trunc('month', v_start) + INTERVAL '1 month - 1 day')::date, INTERVAL '1 day') g
    WHERE EXTRACT(ISODOW FROM g) = s.day_of_week;
  v_month := COALESCE(s.promo_price_month, (lesson_price_row(s.teacher_profile_id, s.organization_id, s.lesson_type, s.duration_minutes, s.price_peak, v_start)).price_month);

  UPDATE lesson_enrolments
  SET status = 'confirmed', confirmed_at = NOW(), starts_on = v_start,
      first_month_amount = CASE WHEN v_total > 0 THEN ROUND(v_month * v_left / v_total, 2) END
  WHERE id = e.id;

  -- Entra já nas aulas que o cron criou.
  INSERT INTO lesson_attendees (lesson_id, user_id, role, status, added_by)
  SELECT l.id, auth.uid(), 'class', 'confirmed', e.accepted_by FROM lessons l
  WHERE l.series_id = s.id AND (l.starts_at AT TIME ZONE 'Europe/Lisbon')::date >= v_start AND l.status <> 'cancelled'
  ON CONFLICT (lesson_id, user_id) WHERE user_id IS NOT NULL DO NOTHING;
  UPDATE lessons l SET status = 'confirmed'
    WHERE l.series_id = s.id AND l.status = 'open' AND lesson_taken(l.id) >= lesson_capacity(l.lesson_type);
END;
$$;

CREATE OR REPLACE FUNCTION decline_enrolment(p_enrolment_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE lesson_enrolments SET status = 'withdrawn', cancelled_at = NOW()
  WHERE id = p_enrolment_id AND user_id = auth.uid() AND status = 'accepted';
  IF NOT FOUND THEN RAISE EXCEPTION 'Este pedido não está à espera da tua confirmação'; END IF;
END;
$$;

-- Retirar um pedido, ou cancelar a inscrição — que só conta no fim do mês
-- (SPEC §3.4): continua nas aulas até ao último dia do mês.
CREATE OR REPLACE FUNCTION cancel_enrolment(p_enrolment_id UUID)
RETURNS DATE LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e lesson_enrolments; v_end DATE;
BEGIN
  SELECT * INTO e FROM lesson_enrolments WHERE id = p_enrolment_id AND user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inscrição não encontrada'; END IF;
  IF e.status IN ('requested', 'accepted') THEN
    UPDATE lesson_enrolments SET status = 'withdrawn', cancelled_at = NOW() WHERE id = e.id;
    RETURN NULL;
  END IF;
  IF e.status <> 'confirmed' THEN RAISE EXCEPTION 'Esta inscrição já não está ativa'; END IF;
  v_end := (date_trunc('month', (NOW() AT TIME ZONE 'Europe/Lisbon')::date) + INTERVAL '1 month - 1 day')::date;
  UPDATE lesson_enrolments SET status = 'leaving', ends_on = v_end, cancelled_at = NOW() WHERE id = e.id;
  DELETE FROM lesson_attendees a USING lessons l
  WHERE a.lesson_id = l.id AND l.series_id = e.series_id AND a.user_id = auth.uid() AND a.role = 'class'
    AND (l.starts_at AT TIME ZONE 'Europe/Lisbon')::date > v_end;
  RETURN v_end;
END;
$$;

-- "Não posso ir" (p_going = false) / "Afinal vou" (true): só esse dia, até à
-- hora da aula; a mensalidade não muda.
CREATE OR REPLACE FUNCTION set_lesson_attendance(p_lesson_id UUID, p_going BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l lessons; v_tp_user UUID; v_me TEXT;
BEGIN
  SELECT * INTO l FROM lessons WHERE id = p_lesson_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Aula não encontrada'; END IF;
  IF l.starts_at <= NOW() THEN RAISE EXCEPTION 'Esta aula já começou'; END IF;
  IF l.status = 'cancelled' THEN RAISE EXCEPTION 'Esta aula foi cancelada'; END IF;
  IF p_going AND lesson_taken(p_lesson_id) >= lesson_capacity(l.lesson_type)
     AND NOT EXISTS (SELECT 1 FROM lesson_attendees WHERE lesson_id = p_lesson_id AND user_id = auth.uid() AND status = 'confirmed') THEN
    RAISE EXCEPTION 'O teu lugar já foi ocupado nesta aula';
  END IF;
  UPDATE lesson_attendees
  SET status = CASE WHEN p_going THEN 'confirmed' ELSE 'not_going' END, marked_by = NULL, marked_note = NULL, updated_at = NOW()
  WHERE lesson_id = p_lesson_id AND user_id = auth.uid() AND status IN ('confirmed', 'not_going');
  IF NOT FOUND THEN RAISE EXCEPTION 'Não estás nesta aula'; END IF;
  UPDATE lessons SET status = CASE WHEN lesson_taken(id) >= lesson_capacity(lesson_type) THEN 'confirmed' ELSE 'open' END
  WHERE id = p_lesson_id AND status IN ('open', 'confirmed');
  IF NOT p_going THEN
    SELECT user_id INTO v_tp_user FROM teacher_profiles WHERE id = l.teacher_profile_id;
    SELECT name INTO v_me FROM profiles WHERE id = auth.uid();
    PERFORM lesson_notify(v_tp_user, 'lesson_student_not_going', p_lesson_id,
      jsonb_build_object('student_name', v_me, 'lesson_id', p_lesson_id, 'lesson_date', l.starts_at));
  END IF;
END;
$$;

-- ── 10. Leitura ───────────────────────────────────────────────────────────

-- Separador Professores da página do clube, pela ordem do clube.
CREATE OR REPLACE FUNCTION list_club_teachers(p_organization_id UUID)
RETURNS TABLE (teacher_profile_id UUID, user_id UUID, name TEXT, avatar_url TEXT, gender TEXT, rating NUMERIC,
               level_from SMALLINT, level_to SMALLINT, from_price NUMERIC,
               next_free_start TIMESTAMPTZ, next_free_end TIMESTAMPTZ, open_series_count INTEGER, full_series_count INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH t AS (
    SELECT tp.* FROM teacher_profiles tp
    WHERE tp.organization_id = p_organization_id AND teacher_profile_active(tp.id)
  ),
  s AS (
    SELECT ls.teacher_profile_id, ls.level_from, ls.level_to,
           (SELECT COUNT(*) FROM lesson_enrolments e WHERE e.series_id = ls.id AND e.status IN ('accepted', 'confirmed', 'leaving')) AS taken,
           lesson_capacity(ls.lesson_type) AS cap
    FROM lesson_series ls
    WHERE ls.organization_id = p_organization_id AND ls.status = 'active' AND lesson_visible_to_me(ls.visibility, ls.organization_id)
  ),
  free AS (
    -- Próximo horário semanal (teacher_availability) nos 7 dias seguintes.
    -- Não desconta ainda as aulas marcadas por cima (Fase 3, com os blocos).
    SELECT DISTINCT ON (ta.teacher_profile_id) ta.teacher_profile_id,
           ((g::date + ta.start_time) AT TIME ZONE 'Europe/Lisbon') AS fs,
           ((g::date + ta.end_time) AT TIME ZONE 'Europe/Lisbon') AS fe
    FROM teacher_availability ta
    CROSS JOIN generate_series((NOW() AT TIME ZONE 'Europe/Lisbon')::date, (NOW() AT TIME ZONE 'Europe/Lisbon')::date + 6, INTERVAL '1 day') g
    WHERE ta.teacher_profile_id IN (SELECT id FROM t)
      AND EXTRACT(ISODOW FROM g) = array_position(ARRAY['segunda','terca','quarta','quinta','sexta','sabado','domingo'], ta.day_of_week)
      AND ((g::date + ta.end_time) AT TIME ZONE 'Europe/Lisbon') > NOW()
    ORDER BY ta.teacher_profile_id, fs
  )
  SELECT t.id, t.user_id, p.name, p.avatar_url, p.gender, p.rating,
         (SELECT MAX(s.level_from) FROM s WHERE s.teacher_profile_id = t.id),
         (SELECT MIN(s.level_to) FROM s WHERE s.teacher_profile_id = t.id),
         (SELECT MIN(lp.price_lesson) FROM lesson_prices lp
            WHERE lp.price_lesson IS NOT NULL AND lp.lesson_type <> 'trial' AND lp.valid_from <= CURRENT_DATE
              AND (lp.teacher_profile_id = t.id OR (lp.teacher_profile_id IS NULL AND lp.organization_id = p_organization_id))),
         f.fs, f.fe,
         (SELECT COUNT(*)::INTEGER FROM s WHERE s.teacher_profile_id = t.id AND s.taken < s.cap),
         (SELECT COUNT(*)::INTEGER FROM s WHERE s.teacher_profile_id = t.id AND s.taken >= s.cap)
  FROM t JOIN profiles p ON p.id = t.user_id
  LEFT JOIN free f ON f.teacher_profile_id = t.id
  ORDER BY t.sort_order NULLS LAST, p.name;
$$;

-- Perfil e disponibilidade de um professor entre duas datas.
CREATE OR REPLACE FUNCTION get_teacher_page(p_teacher_profile_id UUID, p_from DATE, p_to DATE)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE tp teacher_profiles; v_teacher JSONB; v_items JSONB; v_prices JSONB;
BEGIN
  SELECT * INTO tp FROM teacher_profiles WHERE id = p_teacher_profile_id;
  IF NOT FOUND OR NOT teacher_profile_active(tp.id) THEN RETURN NULL; END IF;

  SELECT jsonb_build_object(
    'teacher_profile_id', tp.id, 'user_id', tp.user_id, 'name', p.name, 'avatar_url', p.avatar_url,
    'gender', p.gender, 'rating', p.rating, 'contact', tp.contact, 'zone', tp.zone,
    'organization_id', tp.organization_id, 'org_name', o.name, 'org_slug', o.slug, 'org_city', o.location,
    'level_from', (SELECT MAX(level_from) FROM lesson_series WHERE teacher_profile_id = tp.id AND status = 'active'),
    'level_to', (SELECT MIN(level_to) FROM lesson_series WHERE teacher_profile_id = tp.id AND status = 'active'))
  INTO v_teacher
  FROM profiles p LEFT JOIN organizations o ON o.id = tp.organization_id
  WHERE p.id = tp.user_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(lp)), '[]'::jsonb) INTO v_prices FROM lesson_prices lp
  WHERE lp.teacher_profile_id = tp.id OR (lp.teacher_profile_id IS NULL AND lp.organization_id = tp.organization_id);

  WITH les AS (
    SELECT l.*, s.day_of_week AS wd,
           (SELECT COUNT(*) FROM lesson_enrolments e WHERE e.series_id = l.series_id AND e.status IN ('accepted', 'confirmed', 'leaving')) AS s_taken,
           lesson_visible_to_me(l.visibility, l.organization_id) AS visible,
           -- 'leaving' (cancelou, fica até ao fim do mês) continua inscrito para o ecrã.
           (SELECT CASE e.status WHEN 'leaving' THEN 'confirmed' ELSE e.status END FROM lesson_enrolments e WHERE e.series_id = l.series_id AND e.user_id = auth.uid()
              AND e.status IN ('requested', 'accepted', 'confirmed', 'leaving') LIMIT 1) AS my_status,
           (SELECT e.id FROM lesson_enrolments e WHERE e.series_id = l.series_id AND e.user_id = auth.uid()
              AND e.status IN ('requested', 'accepted', 'confirmed', 'leaving') LIMIT 1) AS my_enrolment_id,
           s.promo_price_month, s.price_peak AS s_peak
    FROM lessons l LEFT JOIN lesson_series s ON s.id = l.series_id
    WHERE l.teacher_profile_id = tp.id AND l.status <> 'cancelled'
      AND (l.starts_at AT TIME ZONE 'Europe/Lisbon')::date BETWEEN p_from AND p_to
  ),
  items AS (
    SELECT jsonb_build_object(
      'kind', CASE WHEN les.series_id IS NOT NULL AND les.visible THEN 'series' ELSE 'busy' END,
      'series_id', CASE WHEN les.visible THEN les.series_id END,
      'starts_at', les.starts_at, 'ends_at', les.starts_at + make_interval(mins => les.duration_minutes),
      'weekday', EXTRACT(ISODOW FROM les.starts_at AT TIME ZONE 'Europe/Lisbon')::int,
      'lesson_type', CASE WHEN les.visible THEN les.lesson_type END,
      'taken', CASE WHEN les.visible THEN les.s_taken END,
      'capacity', lesson_capacity(les.lesson_type),
      'avg_rating', CASE WHEN les.visible THEN (SELECT AVG(pr.rating) FROM lesson_attendees a JOIN profiles pr ON pr.id = a.user_id
                                                 WHERE a.lesson_id = les.id AND a.status IN ('accepted', 'confirmed')) END,
      'avg_gender', CASE les.gender_restriction WHEN 'feminino' THEN 'feminino' ELSE 'masculino' END,
      'price_month', CASE WHEN les.visible AND les.series_id IS NOT NULL THEN COALESCE(les.promo_price_month,
          (lesson_price_row(tp.id, tp.organization_id, les.lesson_type, les.duration_minutes, les.s_peak, (les.starts_at AT TIME ZONE 'Europe/Lisbon')::date)).price_month) END,
      'my_status', les.my_status, 'my_enrolment_id', les.my_enrolment_id) AS j,
      les.starts_at AS at
    FROM les
    UNION ALL
    -- Horário livre semanal (sem descontar aulas; os blocos certos são da Fase 3).
    SELECT jsonb_build_object('kind', 'free',
             'starts_at', (g::date + ta.start_time) AT TIME ZONE 'Europe/Lisbon',
             'ends_at', (g::date + ta.end_time) AT TIME ZONE 'Europe/Lisbon',
             'weekday', EXTRACT(ISODOW FROM g)::int),
           (g::date + ta.start_time) AT TIME ZONE 'Europe/Lisbon'
    FROM teacher_availability ta
    CROSS JOIN generate_series(p_from, p_to, INTERVAL '1 day') g
    WHERE ta.teacher_profile_id = tp.id
      AND EXTRACT(ISODOW FROM g) = array_position(ARRAY['segunda','terca','quarta','quinta','sexta','sabado','domingo'], ta.day_of_week)
  )
  SELECT COALESCE(jsonb_agg(j ORDER BY at), '[]'::jsonb) INTO v_items FROM items;

  RETURN jsonb_build_object('teacher', v_teacher, 'prices', v_prices, 'items', v_items);
END;
$$;

-- Gerir → Aulas → Turmas.
CREATE OR REPLACE FUNCTION list_club_series(p_organization_id UUID)
RETURNS TABLE (series_id UUID, teacher_profile_id UUID, teacher_name TEXT, weekday SMALLINT, start_time TEXT,
               duration_minutes SMALLINT, lesson_type TEXT, taken INTEGER, capacity SMALLINT, price_month NUMERIC,
               level_from SMALLINT, level_to SMALLINT, gender_restriction TEXT, visibility TEXT, status TEXT,
               pending_requests INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.teacher_profile_id, p.name, s.day_of_week, to_char(s.start_time, 'HH24:MI'), s.duration_minutes, s.lesson_type,
         (SELECT COUNT(*)::INTEGER FROM lesson_enrolments e WHERE e.series_id = s.id AND e.status IN ('accepted', 'confirmed', 'leaving')),
         lesson_capacity(s.lesson_type),
         COALESCE(s.promo_price_month, (lesson_price_row(s.teacher_profile_id, s.organization_id, s.lesson_type, s.duration_minutes, s.price_peak, CURRENT_DATE)).price_month),
         s.level_from, s.level_to, s.gender_restriction, s.visibility, s.status,
         (SELECT COUNT(*)::INTEGER FROM lesson_enrolments e WHERE e.series_id = s.id AND e.status = 'requested')
  FROM lesson_series s
  JOIN teacher_profiles tp ON tp.id = s.teacher_profile_id
  JOIN profiles p ON p.id = tp.user_id
  WHERE s.organization_id = p_organization_id AND s.status <> 'ended' AND can_view_lesson_admin(s.teacher_profile_id)
  ORDER BY s.day_of_week, s.start_time;
$$;

-- Gerir a turma: alunos, pedidos e a próxima aula (só quem gere).
CREATE OR REPLACE FUNCTION get_series_roster(p_series_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s lesson_series; v_series JSONB; v_next lessons;
BEGIN
  SELECT * INTO s FROM lesson_series WHERE id = p_series_id;
  IF NOT FOUND OR NOT can_view_lesson_admin(s.teacher_profile_id) THEN RAISE EXCEPTION 'Sem permissão para ver esta turma'; END IF;
  SELECT to_jsonb(r) INTO v_series FROM list_club_series(s.organization_id) r WHERE r.series_id = s.id;
  SELECT * INTO v_next FROM lessons WHERE series_id = s.id AND starts_at > NOW() ORDER BY starts_at LIMIT 1;

  RETURN jsonb_build_object(
    'series', v_series,
    'students', COALESCE((SELECT jsonb_agg(jsonb_build_object('enrolment_id', e.id, 'user_id', e.user_id, 'name', p.name,
                 'avatar_url', p.avatar_url, 'rating', p.rating, 'gender', p.gender, 'status', e.status) ORDER BY p.name)
               FROM lesson_enrolments e JOIN profiles p ON p.id = e.user_id
               WHERE e.series_id = s.id AND e.status IN ('accepted', 'confirmed', 'leaving')), '[]'::jsonb),
    'requests', COALESCE((SELECT jsonb_agg(jsonb_build_object('enrolment_id', e.id, 'user_id', e.user_id, 'name', p.name,
                 'avatar_url', p.avatar_url, 'rating', p.rating, 'gender', p.gender, 'requested_at', e.requested_at) ORDER BY e.requested_at)
               FROM lesson_enrolments e JOIN profiles p ON p.id = e.user_id
               WHERE e.series_id = s.id AND e.status = 'requested'), '[]'::jsonb),
    'hidden_count', 0,
    'next_lesson', CASE WHEN v_next.id IS NULL THEN NULL ELSE jsonb_build_object(
      'lesson_id', v_next.id, 'starts_at', v_next.starts_at,
      'attendees', COALESCE((SELECT jsonb_agg(jsonb_build_object('user_id', a.user_id, 'name', COALESCE(p.name, a.guest_name),
                     'rating', p.rating, 'gender', p.gender, 'role', a.role, 'status', a.status,
                     'marked_by_name', mb.name, 'marked_note', a.marked_note) ORDER BY COALESCE(p.name, a.guest_name))
                   FROM lesson_attendees a LEFT JOIN profiles p ON p.id = a.user_id LEFT JOIN profiles mb ON mb.id = a.marked_by
                   WHERE a.lesson_id = v_next.id AND a.status IN ('accepted', 'confirmed', 'not_going', 'absent')), '[]'::jsonb)) END);
END;
$$;

-- Linha comum às aulas da Home (list_my_lessons / list_lesson_events).
CREATE OR REPLACE FUNCTION lesson_row_json(l lessons, p_my_status TEXT, p_marked_by TEXT)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'lesson_id', l.id, 'series_id', l.series_id, 'starts_at', l.starts_at,
    'ends_at', l.starts_at + make_interval(mins => l.duration_minutes),
    'lesson_type', l.lesson_type,
    'form', COALESCE((SELECT a.role FROM lesson_attendees a WHERE a.lesson_id = l.id AND a.user_id = auth.uid()),
                     CASE WHEN l.series_id IS NULL THEN 'single' ELSE 'class' END),
    'status', l.status, 'cancel_reason', l.cancel_reason, 'cancel_note', l.cancel_note,
    'teacher_name', p.name, 'teacher_profile_id', l.teacher_profile_id,
    'organization', CASE WHEN o.id IS NULL THEN NULL ELSE jsonb_build_object('id', o.id, 'name', o.name, 'kind', o.kind,
                      'group_logo_url', o.group_logo_url, 'latitude', o.latitude, 'longitude', o.longitude) END,
    'price_month', CASE WHEN l.series_id IS NOT NULL THEN COALESCE(s.promo_price_month,
                      (lesson_price_row(l.teacher_profile_id, l.organization_id, l.lesson_type, l.duration_minutes, COALESCE(l.price_peak, TRUE), (l.starts_at AT TIME ZONE 'Europe/Lisbon')::date)).price_month) END,
    'price_per_person', COALESCE(l.promo_price, l.price_per_person),
    'taken', lesson_taken(l.id), 'capacity', lesson_capacity(l.lesson_type),
    'avg_rating', (SELECT AVG(pr.rating) FROM lesson_attendees a JOIN profiles pr ON pr.id = a.user_id
                   WHERE a.lesson_id = l.id AND a.status IN ('accepted', 'confirmed')),
    'avg_gender', CASE l.gender_restriction WHEN 'feminino' THEN 'feminino' ELSE 'masculino' END,
    'my_status', p_my_status, 'marked_by_name', p_marked_by)
  FROM teacher_profiles tp
  JOIN profiles p ON p.id = tp.user_id
  LEFT JOIN organizations o ON o.id = l.organization_id
  LEFT JOIN lesson_series s ON s.id = l.series_id
  WHERE tp.id = l.teacher_profile_id;
$$;

-- As minhas aulas (uma por semana na turma). Falta marcada pelo professor
-- aparece como "não vais", com quem marcou.
CREATE OR REPLACE FUNCTION list_my_lessons(p_from DATE, p_to DATE)
RETURNS SETOF JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT lesson_row_json(l,
           CASE a.status WHEN 'absent' THEN 'not_going' ELSE a.status END,
           CASE WHEN a.status = 'absent' THEN mb.name END)
  FROM lesson_attendees a
  JOIN lessons l ON l.id = a.lesson_id
  LEFT JOIN profiles mb ON mb.id = a.marked_by
  WHERE a.user_id = auth.uid() AND a.status IN ('invited', 'requested', 'accepted', 'confirmed', 'not_going', 'absent')
    AND (l.starts_at AT TIME ZONE 'Europe/Lisbon')::date BETWEEN p_from AND p_to
  ORDER BY l.starts_at;
$$;

-- Aulas em aberto que posso ver: sem nomes, sem as completas, sem as minhas.
-- A distância filtra-se na Home (como os eventos de explorar).
CREATE OR REPLACE FUNCTION list_lesson_events(p_from DATE, p_to DATE)
RETURNS SETOF JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT lesson_row_json(l, NULL, NULL)
  FROM lessons l
  WHERE l.status = 'open' AND l.starts_at > NOW()
    AND (l.starts_at AT TIME ZONE 'Europe/Lisbon')::date BETWEEN p_from AND p_to
    AND lesson_visible_to_me(l.visibility, l.organization_id)
    AND lesson_taken(l.id) < lesson_capacity(l.lesson_type)
    AND NOT EXISTS (SELECT 1 FROM lesson_attendees a WHERE a.lesson_id = l.id AND a.user_id = auth.uid())
    -- Na Fase 1 só há turmas: a aula de uma turma aparece a quem ainda não
    -- está nela, para pedir para entrar na turma.
  ORDER BY l.starts_at;
$$;

-- Página de uma aula: nomes só dos colegas na mesma aula, amigos e quem gere.
CREATE OR REPLACE FUNCTION get_lesson(p_lesson_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  l lessons; v_admin BOOLEAN; v_mine lesson_attendees; v_in BOOLEAN; v_students JSONB; v_hidden INTEGER; v_row JSONB;
BEGIN
  SELECT * INTO l FROM lessons WHERE id = p_lesson_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_admin := can_view_lesson_admin(l.teacher_profile_id);
  SELECT * INTO v_mine FROM lesson_attendees WHERE lesson_id = l.id AND user_id = auth.uid();
  v_in := v_mine.id IS NOT NULL AND v_mine.status IN ('accepted', 'confirmed', 'not_going', 'absent');
  IF NOT (v_admin OR v_mine.id IS NOT NULL OR lesson_visible_to_me(l.visibility, l.organization_id)) THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', a.user_id, 'name', COALESCE(p.name, a.guest_name), 'avatar_url', p.avatar_url,
           'rating', p.rating, 'gender', p.gender, 'is_me', a.user_id = auth.uid(),
           'friend', a.user_id <> auth.uid() AND is_mutual_follow(auth.uid(), a.user_id)) ORDER BY (a.user_id = auth.uid()) DESC, p.name), '[]'::jsonb)
    INTO v_students
  FROM lesson_attendees a LEFT JOIN profiles p ON p.id = a.user_id
  WHERE a.lesson_id = l.id AND a.status IN ('accepted', 'confirmed')
    AND (v_admin OR v_in OR a.user_id = auth.uid() OR (a.user_id IS NOT NULL AND is_mutual_follow(auth.uid(), a.user_id)));

  SELECT lesson_taken(l.id) - jsonb_array_length(v_students) INTO v_hidden;

  v_row := lesson_row_json(l, CASE v_mine.status WHEN 'absent' THEN 'not_going' ELSE v_mine.status END, NULL)
           || jsonb_build_object('court', l.court, 'location', (SELECT location FROM organizations WHERE id = l.organization_id),
                                 'level_from', l.level_from, 'level_to', l.level_to, 'close_at', l.close_at);

  RETURN jsonb_build_object(
    'lesson', v_row,
    'teacher', (SELECT jsonb_build_object('teacher_profile_id', tp.id, 'name', p.name, 'contact', tp.contact)
                FROM teacher_profiles tp JOIN profiles p ON p.id = tp.user_id WHERE tp.id = l.teacher_profile_id),
    'students', v_students,
    'hidden_count', GREATEST(v_hidden, 0),
    'avg_rating', (SELECT AVG(pr.rating) FROM lesson_attendees a JOIN profiles pr ON pr.id = a.user_id
                   WHERE a.lesson_id = l.id AND a.status IN ('accepted', 'confirmed')),
    'my_status', CASE v_mine.status WHEN 'absent' THEN 'not_going' ELSE v_mine.status END,
    'my_enrolment_id', (SELECT e.id FROM lesson_enrolments e WHERE e.series_id = l.series_id AND e.user_id = auth.uid()
                          AND e.status = 'confirmed' LIMIT 1));
END;
$$;

-- ── 11. Permissões das funções ────────────────────────────────────────────

REVOKE ALL ON FUNCTION
  teacher_profile_active(UUID), is_platform_admin_me(), can_edit_lessons(UUID), can_mark_attendance(UUID),
  can_view_lesson_admin(UUID), lesson_price_row(UUID, UUID, TEXT, SMALLINT, BOOLEAN, DATE),
  lesson_peak(UUID, SMALLINT, TIME, SMALLINT), lesson_taken(UUID), lesson_visible_to_me(TEXT, UUID),
  lesson_notify(UUID, TEXT, UUID, JSONB), lesson_series_label(UUID), lesson_row_json(lessons, TEXT, TEXT),
  set_club_peak_hours(UUID, JSONB), set_lesson_prices(UUID, UUID, JSONB), set_teacher_sort_order(UUID, UUID[]),
  create_lesson_series(JSONB), accept_lesson_series(UUID), resolve_enrolment(UUID, BOOLEAN),
  mark_lesson_absence(UUID, UUID, TEXT), cancel_lesson(UUID, TEXT, TEXT), cancel_lesson_period(UUID, DATE, DATE, TEXT, TEXT),
  request_enrolment(UUID), confirm_enrolment(UUID), decline_enrolment(UUID), cancel_enrolment(UUID),
  set_lesson_attendance(UUID, BOOLEAN), list_club_teachers(UUID), get_teacher_page(UUID, DATE, DATE),
  list_club_series(UUID), get_series_roster(UUID), list_my_lessons(DATE, DATE), list_lesson_events(DATE, DATE),
  get_lesson(UUID)
FROM public, anon;

GRANT EXECUTE ON FUNCTION
  set_club_peak_hours(UUID, JSONB), set_lesson_prices(UUID, UUID, JSONB), set_teacher_sort_order(UUID, UUID[]),
  create_lesson_series(JSONB), accept_lesson_series(UUID), resolve_enrolment(UUID, BOOLEAN),
  mark_lesson_absence(UUID, UUID, TEXT), cancel_lesson(UUID, TEXT, TEXT), cancel_lesson_period(UUID, DATE, DATE, TEXT, TEXT),
  request_enrolment(UUID), confirm_enrolment(UUID), decline_enrolment(UUID), cancel_enrolment(UUID),
  set_lesson_attendance(UUID, BOOLEAN), list_club_teachers(UUID), get_teacher_page(UUID, DATE, DATE),
  list_club_series(UUID), get_series_roster(UUID), list_my_lessons(DATE, DATE), list_lesson_events(DATE, DATE),
  get_lesson(UUID),
  -- usadas pelas policies (RLS corre como o utilizador)
  can_view_lesson_admin(UUID), can_mark_attendance(UUID), is_platform_admin_me(), lesson_visible_to_me(TEXT, UUID),
  lesson_capacity(TEXT), lesson_band(NUMERIC)
TO authenticated;

-- ── 12. Revisão (Renato) ──────────────────────────────────────────────────
-- SELECT id, user_id, organization_id, status, club_status, managed_by FROM teacher_profiles;
-- SELECT * FROM cron.job WHERE jobname = 'process-lesson-series';
