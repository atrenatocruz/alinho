-- ════════════════════════════════════════════════════════════════════════════
-- Aulas 11 — o professor fecha dias ou horas (Dev 4, 27 set 2026)
-- SPEC: design-handoff/2026-09-27-horario-em-semana/SPEC-calendario-2.md,
-- assunto 2 (APROVADO, Francisco, 27 set: «Sim»).
--
-- Férias, feriados, um dia em que não pode — sem mexer no horário da semana.
--   · teacher_closures: de/até (datas) e, se não for o dia todo, das/às.
--     É da pessoa (vale em todos os clubes onde dá aulas).
--   · teacher_busy (corpo da _3) passa a devolver também os fechos, com
--     kind 'closed'. Por isso, sem mais nada: ninguém pede aula nessas horas
--     (request_lesson), ninguém propõe lá outra hora (lesson_request_slot_ok),
--     e quem marca vê «ocupado» (get_teacher_booking).
--   · close_teacher_days(): grava o fecho e, se o professor escolheu
--     «Fechar e recusar o pedido», recusa os pedidos por responder nessas
--     horas (reject_lesson_request: avisa o aluno e desfaz junções).
--     As aulas já marcadas ficam (SPEC ponto 4, até o Diogo responder).
--   · open_teacher_days(): «Abrir» — apaga o fecho.
--   · list_my_teacher_closures(): «Dias fechados» (os que ainda não passaram).
-- Não mexe nas turmas (essas têm o «Cancelar período»).
--
-- Ordem: depois da _10 (reject_lesson_request com a junção). Redefine
-- teacher_busy, que só existe na _3 — corpo vivo comparado a 27 set.
-- Pode correr outra vez.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. A tabela ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS teacher_closures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  start_time TIME,            -- NULL = o dia todo
  end_time TIME,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (to_date >= from_date),
  CHECK ((start_time IS NULL AND end_time IS NULL) OR (start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time))
);
CREATE INDEX IF NOT EXISTS idx_teacher_closures_user ON teacher_closures (user_id, to_date);
ALTER TABLE teacher_closures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Own closures" ON teacher_closures;
CREATE POLICY "Own closures" ON teacher_closures FOR SELECT TO authenticated USING (user_id = auth.uid());
REVOKE ALL ON teacher_closures FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON teacher_closures FROM authenticated;
-- Escreve-se só pelas RPCs.

-- ── 2. O que está ocupado passa a incluir o fechado (corpo da _3 + fechos) ──
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
     AND l.starts_at < p_to AND l.starts_at + make_interval(mins => l.duration_minutes) > p_from
  UNION ALL
  -- Fechado: cada dia do intervalo, o dia todo ou das/às (hora de Lisboa).
  SELECT x.s, x.e, 'closed'
    FROM teacher_closures c
    CROSS JOIN LATERAL generate_series(c.from_date, c.to_date, INTERVAL '1 day') g
    CROSS JOIN LATERAL (SELECT
        ((g::date + COALESCE(c.start_time, TIME '00:00')) AT TIME ZONE 'Europe/Lisbon') AS s,
        (CASE WHEN c.start_time IS NULL THEN (g::date + 1) + TIME '00:00' ELSE g::date + c.end_time END) AT TIME ZONE 'Europe/Lisbon' AS e) x
   WHERE c.user_id = p_user AND x.s < p_to AND x.e > p_from;
$$;

-- ── 3. Fechar ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION close_teacher_days(p_from DATE, p_to DATE, p_start TIME, p_end TIME, p_reject_requests BOOLEAN)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID; r RECORD;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM teacher_profiles WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Só um professor pode fechar dias';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN RAISE EXCEPTION 'A data de fim tem de ser depois da de início'; END IF;
  IF p_to < (NOW() AT TIME ZONE 'Europe/Lisbon')::date THEN RAISE EXCEPTION 'Esses dias já passaram'; END IF;
  IF (p_start IS NULL) <> (p_end IS NULL) OR (p_start IS NOT NULL AND p_end <= p_start) THEN
    RAISE EXCEPTION 'A hora de fim tem de ser depois da de início';
  END IF;

  INSERT INTO teacher_closures (user_id, from_date, to_date, start_time, end_time)
  VALUES (auth.uid(), p_from, p_to, p_start, p_end)
  RETURNING id INTO v_id;

  -- «Fechar e recusar o pedido»: os pedidos por responder nessas horas.
  IF p_reject_requests THEN
    FOR r IN
      SELECT DISTINCT q.id FROM lesson_requests q
        JOIN teacher_profiles tp ON tp.id = q.teacher_profile_id
        JOIN teacher_busy(auth.uid(), (p_from::timestamp AT TIME ZONE 'Europe/Lisbon'), ((p_to + 1)::timestamp AT TIME ZONE 'Europe/Lisbon')) b
          ON b.kind = 'closed'
         AND q.starts_at < b.ends_at AND q.starts_at + make_interval(mins => q.duration_minutes) > b.starts_at
       WHERE tp.user_id = auth.uid() AND q.status = 'pending'
    LOOP
      PERFORM reject_lesson_request(r.id);
    END LOOP;
  END IF;
  RETURN v_id;
END;
$$;

-- ── 4. Abrir ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION open_teacher_days(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM teacher_closures WHERE id = p_id AND user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Não encontrado'; END IF;
END;
$$;

-- ── 5. «Dias fechados» ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION list_my_teacher_closures()
RETURNS SETOF teacher_closures LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM teacher_closures
   WHERE user_id = auth.uid() AND to_date >= (NOW() AT TIME ZONE 'Europe/Lisbon')::date
   ORDER BY from_date, start_time NULLS FIRST;
$$;

-- ── 6. Permissões: explícitas (o Supabase dá EXECUTE a anon e authenticated) ─
REVOKE EXECUTE ON FUNCTION teacher_busy(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION close_teacher_days(DATE, DATE, TIME, TIME, BOOLEAN), open_teacher_days(UUID), list_my_teacher_closures()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION close_teacher_days(DATE, DATE, TIME, TIME, BOOLEAN), open_teacher_days(UUID), list_my_teacher_closures()
  TO authenticated;

-- Verificação (só leitura):
-- SELECT proname, proacl FROM pg_proc WHERE proname IN
--   ('teacher_busy', 'close_teacher_days', 'open_teacher_days', 'list_my_teacher_closures');
