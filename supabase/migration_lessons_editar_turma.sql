-- ═════════════════════════════════════════════════════════════════════════
-- Aulas: «Editar turma» (update_lesson_series) e o preço de cada inscrição
--
-- PORQUÊ. Auditoria «editar tem tudo do criar», ponto 6
-- (design-handoff/2026-09-27-editar-tem-tudo/AUDITORIA.md), aprovada pelo
-- Francisco. Ecrã: Dev 4 (nome e campos dele, 28 set). Frase aprovada do
-- preço: «O preço novo vale para quem se inscrever a partir de agora.»
-- PO, 28 set: cada inscrição guarda o preço do mês com que a pessoa entrou;
-- as que já existem ficam com o preço atual da turma; ninguém muda de preço.
--
-- O QUE FAZ.
--   1. lesson_enrolments.month_price — a mensalidade de quem está inscrito.
--      As inscrições aceites/confirmadas/de saída ficam já com o preço de
--      hoje da turma. confirm_enrolment passa a usar a da inscrição, se
--      houver, e a guardá-la (troca no corpo VIVO, 1 vez; «já estava»).
--   2. NOVA update_lesson_series(p_series_id, p_fields jsonb): os campos do
--      create_lesson_series; o que não vier fica. Só can_edit_lessons do
--      professor ou o admin do clube (e, se mudar o professor, também do
--      novo). Com a turma a meio:
--        · dia, hora, duração e professor mudam das próximas aulas em
--          diante: as aulas futuras já geradas mudam de dia/hora dentro da
--          mesma semana (as presenças ficam); a que já teria passado sai; as
--          passadas ficam como estão; o gerador preenche o resto;
--        · os alunos inscritos recebem 'lesson_series_changed' (com
--          series_label e o que mudou);
--        · mudar o professor para outro perfil volta a pedir a aceitação
--          dele (pending_teacher), como no criar;
--        · o preço de tabela novo vale para as inscrições novas (o preço
--          «Outro preço/Promoção» continua no set_lesson_series_price).
--      Erros: not_allowed, teacher_not_active, other_club, no_price,
--      series_ended, e os das regras da tabela (horas, nível…).
--
-- Dev 3, 28 set 2026 · ecrã: Dev 4
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.generate_series_lessons(uuid)') IS NULL
     OR to_regprocedure('public.lesson_price_row(uuid, uuid, text, smallint, boolean, date)') IS NULL
     OR to_regprocedure('public.can_edit_lessons(uuid)') IS NULL
     OR to_regprocedure('public.lesson_notify(uuid, text, uuid, jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Faltam peças das aulas (migration_lessons_1_base.sql). Parar e ler.';
  END IF;
END $$;

-- ── 1. O preço de cada inscrição ────────────────────────────────────────
ALTER TABLE lesson_enrolments ADD COLUMN IF NOT EXISTS month_price NUMERIC(7,2);

UPDATE lesson_enrolments e
   SET month_price = COALESCE(s.promo_price_month,
                              (lesson_price_row(s.teacher_profile_id, s.organization_id, s.lesson_type,
                                                s.duration_minutes, s.price_peak, CURRENT_DATE)).price_month)
  FROM lesson_series s
 WHERE s.id = e.series_id AND e.month_price IS NULL
   AND e.status IN ('accepted', 'confirmed', 'leaving');

DO $$
DECLARE
  c_mes_mau CONSTANT TEXT := 'v_month := COALESCE\(s\.promo_price_month,';
  c_mes_bom CONSTANT TEXT := 'v_month := COALESCE(e.month_price, s.promo_price_month,';
  c_upd_mau CONSTANT TEXT := '(first_month_amount = CASE WHEN v_total > 0 THEN ROUND\(v_month \* v_left / v_total, 2\) END)';
  c_upd_bom CONSTANT TEXT := '\1,
      month_price = v_month';
  v_def TEXT := pg_get_functiondef('public.confirm_enrolment(uuid)'::regprocedure);
BEGIN
  IF v_def LIKE '%e.month_price%' THEN
    RAISE NOTICE 'confirm_enrolment: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_mes_mau, 'g')) <> 1
     OR (SELECT count(*) FROM regexp_matches(v_def, c_upd_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'confirm_enrolment: os pedaços a trocar não aparecem 1 vez. Parar e ler.';
  END IF;
  EXECUTE regexp_replace(regexp_replace(v_def, c_mes_mau, c_mes_bom), c_upd_mau, c_upd_bom);
END $$;

-- ── 2. Editar a turma ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_lesson_series(p_series_id UUID, p_fields JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s        lesson_series%ROWTYPE;
  n        lesson_series%ROWTYPE;
  v_tp     teacher_profiles%ROWTYPE;
  f        JSONB := COALESCE(p_fields, '{}'::jsonb);
  v_sched  BOOLEAN;
  v_teach  BOOLEAN;
  l        RECORD;
  v_date   DATE;
  v_start  TIMESTAMPTZ;
  v_changes JSONB := '[]'::jsonb;
  v_days   CONSTANT TEXT[] := ARRAY['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];
  e        RECORD;
BEGIN
  SELECT * INTO s FROM lesson_series WHERE id = p_series_id FOR UPDATE;
  IF s.id IS NULL OR auth.uid() IS NULL
     OR NOT (can_edit_lessons(s.teacher_profile_id) OR is_org_admin(s.organization_id)) THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  IF s.status = 'ended' THEN RAISE EXCEPTION 'series_ended'; END IF;

  -- O que fica: o que vier no p_fields; o resto como estava.
  n := s;
  IF f ? 'teacher_profile_id' THEN n.teacher_profile_id := (f->>'teacher_profile_id')::uuid; END IF;
  IF f ? 'day_of_week'        THEN n.day_of_week := (f->>'day_of_week')::smallint; END IF;
  IF f ? 'start_time'         THEN n.start_time := (f->>'start_time')::time; END IF;
  IF f ? 'duration_minutes'   THEN n.duration_minutes := (f->>'duration_minutes')::smallint; END IF;
  IF f ? 'lesson_type'        THEN n.lesson_type := f->>'lesson_type'; END IF;
  IF f ? 'price_peak'         THEN n.price_peak := (f->>'price_peak')::boolean; END IF;
  IF f ? 'starts_on'          THEN n.starts_on := COALESCE((f->>'starts_on')::date, s.starts_on); END IF;
  IF f ? 'level_from'         THEN n.level_from := NULLIF(f->>'level_from', '')::smallint; END IF;
  IF f ? 'level_to'           THEN n.level_to := NULLIF(f->>'level_to', '')::smallint; END IF;
  IF f ? 'gender_restriction' THEN n.gender_restriction := COALESCE(f->>'gender_restriction', 'misto'); END IF;
  IF f ? 'visibility'         THEN n.visibility := COALESCE(f->>'visibility', 'public'); END IF;
  IF f ? 'close_hours_before' THEN n.close_hours_before := COALESCE((f->>'close_hours_before')::smallint, s.close_hours_before); END IF;
  IF f ? 'accepts_trial'      THEN n.accepts_trial := COALESCE((f->>'accepts_trial')::boolean, s.accepts_trial); END IF;
  IF f ? 'trial_free'         THEN n.trial_free := COALESCE((f->>'trial_free')::boolean, s.trial_free); END IF;
  IF f ? 'announce_whatsapp'  THEN n.announce_whatsapp := COALESCE((f->>'announce_whatsapp')::boolean, s.announce_whatsapp); END IF;
  IF f ? 'court'              THEN n.court := NULLIF(btrim(f->>'court'), ''); END IF;

  v_teach := n.teacher_profile_id IS DISTINCT FROM s.teacher_profile_id;
  v_sched := n.day_of_week IS DISTINCT FROM s.day_of_week OR n.start_time IS DISTINCT FROM s.start_time
          OR n.duration_minutes IS DISTINCT FROM s.duration_minutes;

  IF v_teach THEN
    SELECT * INTO v_tp FROM teacher_profiles WHERE id = n.teacher_profile_id;
    IF v_tp.id IS NULL OR NOT teacher_profile_active(v_tp.id) THEN RAISE EXCEPTION 'teacher_not_active'; END IF;
    IF v_tp.organization_id IS DISTINCT FROM s.organization_id THEN RAISE EXCEPTION 'other_club'; END IF;
    IF NOT (can_edit_lessons(v_tp.id) OR is_org_admin(s.organization_id)) THEN RAISE EXCEPTION 'not_allowed'; END IF;
    -- Outro professor volta a aceitar a turma (como no criar).
    IF v_tp.user_id IS DISTINCT FROM auth.uid() THEN
      n.status := 'pending_teacher';
      n.teacher_accepted_at := NULL;
    ELSE
      n.status := 'active';
      n.teacher_accepted_at := NOW();
    END IF;
  END IF;
  IF n.price_peak IS NULL THEN RAISE EXCEPTION 'no_price'; END IF;
  IF n.promo_price_month IS NULL
     AND (lesson_price_row(n.teacher_profile_id, n.organization_id, n.lesson_type, n.duration_minutes,
                           n.price_peak, CURRENT_DATE)).price_month IS NULL THEN
    RAISE EXCEPTION 'no_price';
  END IF;

  UPDATE lesson_series SET
    teacher_profile_id = n.teacher_profile_id, day_of_week = n.day_of_week, start_time = n.start_time,
    duration_minutes = n.duration_minutes, lesson_type = n.lesson_type, price_peak = n.price_peak,
    starts_on = n.starts_on, level_from = n.level_from, level_to = n.level_to,
    gender_restriction = n.gender_restriction, visibility = n.visibility,
    close_hours_before = n.close_hours_before, accepts_trial = n.accepts_trial, trial_free = n.trial_free,
    announce_whatsapp = n.announce_whatsapp, court = n.court,
    status = n.status, teacher_accepted_at = n.teacher_accepted_at,
    version = COALESCE(version, 1) + 1
  WHERE id = s.id;

  -- As aulas futuras já geradas acompanham (as passadas ficam como estão).
  FOR l IN SELECT * FROM lessons WHERE series_id = s.id AND starts_at > NOW() ORDER BY starts_at LOOP
    v_date := (l.starts_at AT TIME ZONE 'Europe/Lisbon')::date;
    IF v_sched THEN
      v_date := v_date + (n.day_of_week - EXTRACT(ISODOW FROM v_date)::int);
    END IF;
    v_start := (v_date + n.start_time) AT TIME ZONE 'Europe/Lisbon';
    IF v_start <= NOW() OR v_date < n.starts_on OR (n.ends_on IS NOT NULL AND v_date > n.ends_on) THEN
      -- Esta já não se dá (teria passado, ou fica fora das datas da turma).
      DELETE FROM lessons WHERE id = l.id AND starts_at > NOW();
    ELSE
      UPDATE lessons SET
        starts_at = v_start, duration_minutes = n.duration_minutes, lesson_type = n.lesson_type,
        teacher_profile_id = n.teacher_profile_id,
        close_at = v_start - make_interval(hours => n.close_hours_before),
        price_per_person = COALESCE((lesson_price_row(n.teacher_profile_id, n.organization_id, n.lesson_type,
                                     n.duration_minutes, n.price_peak, v_date)).price_lesson, price_per_person),
        price_peak = n.price_peak, level_from = n.level_from, level_to = n.level_to,
        gender_restriction = n.gender_restriction, visibility = n.visibility, court = n.court,
        accepts_trial = n.accepts_trial, trial_free = n.trial_free,
        updated_by = auth.uid(), updated_at = NOW(), version = COALESCE(version, 1) + 1
      WHERE id = l.id;
    END IF;
  END LOOP;
  PERFORM generate_series_lessons(s.id);

  -- Os alunos inscritos sabem do que mudou.
  IF n.day_of_week IS DISTINCT FROM s.day_of_week THEN v_changes := v_changes || '"day"'::jsonb; END IF;
  IF n.start_time IS DISTINCT FROM s.start_time THEN v_changes := v_changes || '"time"'::jsonb; END IF;
  IF n.duration_minutes IS DISTINCT FROM s.duration_minutes THEN v_changes := v_changes || '"duration"'::jsonb; END IF;
  IF v_teach THEN v_changes := v_changes || '"teacher"'::jsonb; END IF;
  IF jsonb_array_length(v_changes) > 0 THEN
    FOR e IN SELECT DISTINCT user_id FROM lesson_enrolments
              WHERE series_id = s.id AND status IN ('accepted', 'confirmed', 'leaving') AND user_id IS NOT NULL LOOP
      PERFORM lesson_notify(e.user_id, 'lesson_series_changed', NULL, jsonb_build_object(
        'series_id', s.id,
        'series_label', v_days[n.day_of_week] || ' ' || to_char(n.start_time, 'HH24:MI'),
        'old_label', v_days[s.day_of_week] || ' ' || to_char(s.start_time, 'HH24:MI'),
        'changes', v_changes,
        'duration_minutes', n.duration_minutes,
        'teacher_name', (SELECT p.name FROM teacher_profiles tp JOIN profiles p ON p.id = tp.user_id
                          WHERE tp.id = n.teacher_profile_id)));
    END LOOP;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.update_lesson_series(UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_lesson_series(UUID, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_lesson_series(UUID, JSONB) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT count(*) FROM lesson_enrolments WHERE status IN ('accepted', 'confirmed', 'leaving') AND month_price IS NULL;  -- 0 (se a turma tiver preço)
--   SELECT pg_get_functiondef('public.confirm_enrolment(uuid)'::regprocedure) LIKE '%e.month_price%';  -- true
--   SELECT has_function_privilege('anon', 'public.update_lesson_series(uuid, jsonb)', 'EXECUTE');       -- false
