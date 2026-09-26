-- ════════════════════════════════════════════════════════════════════════════
-- Aulas 7 — o preço da turma: «Tabela», «Outro preço» ou «Promoção»
-- (Dev 4, 26 set 2026; #342 «Nova turma em 3 passos», SPEC-turma.md, aprovado
-- pelo Francisco a 26 set, com o aviso da promoção 7 dias antes)
--
-- As colunas já existem desde a migration_lessons_1_base.sql:
--   lesson_series.promo_price_month — o preço por aluno/mês que substitui a tabela
--   lesson_series.promo_until       — até quando (NULL = para sempre)
-- e todas as contas do preço já fazem COALESCE(promo_price_month, tabela).
-- Por isso NÃO se redefine nenhuma função de preço:
--   «Outro preço» = promo_price_month, promo_until NULL (fica para sempre);
--   «Promoção»    = promo_price_month + promo_until;
--   «Tabela»      = as duas a NULL.
-- Um trabalho diário avisa os alunos 7 dias antes do fim da promoção e, no dia
-- a seguir ao fim, limpa as duas colunas: o preço volta sozinho à tabela.
--
-- Ordem: depois de migration_lessons_1_base.sql (lesson_notify,
-- lesson_series_label, can_edit_lessons). Não redefine nada de outra
-- migração. Pode correr outra vez.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Pôr o preço de uma turma ─────────────────────────────────────────────
-- p_price NULL → volta à tabela. p_until NULL com preço → «Outro preço».
CREATE OR REPLACE FUNCTION set_lesson_series_price(p_series_id UUID, p_price NUMERIC, p_until DATE)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s lesson_series;
BEGIN
  SELECT * INTO s FROM lesson_series WHERE id = p_series_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esta turma já não existe';
  END IF;
  IF NOT (can_edit_lessons(s.teacher_profile_id)
          OR (s.organization_id IS NOT NULL AND is_org_admin(s.organization_id))) THEN
    RAISE EXCEPTION 'Sem permissão para mudar o preço desta turma';
  END IF;
  IF p_price IS NOT NULL AND p_price < 0 THEN
    RAISE EXCEPTION 'O preço não pode ser negativo';
  END IF;
  IF p_price IS NULL AND p_until IS NOT NULL THEN
    RAISE EXCEPTION 'Falta o preço da promoção';
  END IF;
  IF p_until IS NOT NULL AND p_until < (NOW() AT TIME ZONE 'Europe/Lisbon')::date THEN
    RAISE EXCEPTION 'A promoção tem de acabar hoje ou depois';
  END IF;

  UPDATE lesson_series
     SET promo_price_month = p_price,
         promo_until = CASE WHEN p_price IS NULL THEN NULL ELSE p_until END
   WHERE id = p_series_id;
END;
$$;

-- ── 2. Fim das promoções (todos os dias) ────────────────────────────────────
-- Avisa quem está na turma 7 dias antes e, passado o último dia, volta à tabela.
CREATE OR REPLACE FUNCTION process_lesson_promotions()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_today DATE := (NOW() AT TIME ZONE 'Europe/Lisbon')::date; r RECORD;
BEGIN
  FOR r IN
    SELECT s.id AS series_id, s.promo_price_month, s.promo_until, e.user_id,
           (lesson_price_row(s.teacher_profile_id, s.organization_id, s.lesson_type, s.duration_minutes,
                             s.price_peak, s.promo_until + 1)).price_month AS table_price
      FROM lesson_series s
      JOIN lesson_enrolments e ON e.series_id = s.id AND e.status IN ('accepted', 'confirmed', 'leaving')
     WHERE s.promo_until = v_today + 7 AND s.promo_price_month IS NOT NULL AND s.status <> 'ended'
  LOOP
    PERFORM lesson_notify(r.user_id, 'lesson_promo_ending', NULL, jsonb_build_object(
      'series_id', r.series_id, 'series_label', lesson_series_label(r.series_id),
      'promo_price', r.promo_price_month, 'until', r.promo_until, 'table_price', r.table_price));
  END LOOP;

  UPDATE lesson_series SET promo_price_month = NULL, promo_until = NULL
   WHERE promo_until IS NOT NULL AND promo_until < v_today;
END;
$$;

DO $$ BEGIN
  PERFORM cron.unschedule('process-lesson-promotions');
EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('process-lesson-promotions', '27 6 * * *', $$SELECT process_lesson_promotions()$$);

-- ── 3. Permissões: explícitas (o Supabase dá EXECUTE a anon e authenticated) ─
REVOKE EXECUTE ON FUNCTION set_lesson_series_price(UUID, NUMERIC, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_lesson_series_price(UUID, NUMERIC, DATE) TO authenticated;
-- Interna: só o cron.
REVOKE EXECUTE ON FUNCTION process_lesson_promotions() FROM PUBLIC, anon, authenticated;

-- Verificação (só leitura):
-- SELECT proname, proacl FROM pg_proc WHERE proname IN ('set_lesson_series_price', 'process_lesson_promotions');
-- SELECT jobname, schedule FROM cron.job WHERE jobname = 'process-lesson-promotions';
