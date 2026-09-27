-- ════════════════════════════════════════════════════════════════════════════
-- Aulas 12 — «Aula experimental» no «Marcar aula» (Dev 4, 27 set 2026)
-- SPEC-calendario-2.md, assunto 3 (APROVADO, Francisco, 27 set: «Sim»; vem do
-- feedback do Diogo). «Que aula?»: «Aula avulsa» (o pedido de hoje) ou «Aula
-- experimental»: 1 h, sem tipo, com o preço da linha «Experimental» da tabela
-- do clube (0 € = grátis).
--
--   · lesson_requests.lesson_type passa a aceitar 'trial'.
--   · request_lesson NÃO muda: já vai buscar o preço com lesson_price_row(tipo,
--     duração), e a tabela só tem a experimental de 1 h — uma experimental com
--     outra duração não tem preço e é recusada («não tem preço para essa aula»).
--     Sem preço de experimental no clube, também é recusada.
--   · book_lesson_request (corpo da _8): a aula nasce como aula a um
--     ('private', porque lessons não conhece 'trial') e o aluno entra com o
--     papel 'trial' (lesson_attendees.role já o tem). O preço recalcula-se
--     como antes (lesson_request_price usa o tipo do pedido: 'trial', 60).
--
-- Ordem: depois da _8 (e da _11, se já tiver corrido; não depende dela).
-- Pode correr outra vez.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. O pedido aceita a experimental ──────────────────────────────────────
DO $$
DECLARE c TEXT;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.lesson_requests'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) ILIKE '%lesson_type%'
  LOOP
    EXECUTE format('ALTER TABLE lesson_requests DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE lesson_requests ADD CONSTRAINT lesson_requests_lesson_type_check
  CHECK (lesson_type IN ('private', 'duo', 'trio', 'quad', 'trial'));

-- ── 2. Marcar: a experimental é uma aula a um (corpo da _8 + a experimental) ─
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
  -- A experimental é uma aula a um, com o aluno como «experimental».
  VALUES (tp.id, tp.organization_id, p_starts_at, r.duration_minutes,
          CASE WHEN r.lesson_type = 'trial' THEN 'private' ELSE r.lesson_type END, 'confirmed',
          r.price_per_person, r.price_peak, 'invited', auth.uid())
  RETURNING id INTO v_lesson;
  INSERT INTO lesson_attendees (lesson_id, user_id, role, status, price, added_by)
  VALUES (v_lesson, r.user_id, CASE WHEN r.lesson_type = 'trial' THEN 'trial' ELSE 'single' END, 'confirmed', r.price_per_person, auth.uid());

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

-- ── 3. Permissões (iguais às da _8: interna) ────────────────────────────────
REVOKE EXECUTE ON FUNCTION book_lesson_request(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

-- Verificação (só leitura):
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'lesson_requests_lesson_type_check';
-- SELECT position('trial' in prosrc) > 0, proacl FROM pg_proc WHERE proname = 'book_lesson_request';
