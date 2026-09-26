-- ═══════════════════════════════════════════════════════════════════════
-- Página do professor: o nível respeita a escolha de cada um
-- (Dev 4, 26 set 2026; decisão do PO a 26 set: como a lista de membros, o
-- nível passa por can_view_section com results_visibility. O género fica só
-- para «Professor/Professora».)
--
-- ESCRITA A PARTIR DO CORPO VIVO de get_teacher_page, lido pelo PO a 26 set
-- ~01h30 (Alinho/Infraestrutura/2026-09-26-corpos-vivos-aulas.sql). A ÚNICA
-- mudança é a linha do 'rating'. O passo 0 pára se o corpo tiver mudado.
-- Não depende de mais nenhuma. Quem corre: o System Integrator, com o
-- «corre» do Francisco.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE v TEXT;
BEGIN
  SELECT md5(p.prosrc) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_teacher_page';
  IF v IS DISTINCT FROM '777e2b7b53f10e6d5840887bf1e49a09' THEN
    RAISE EXCEPTION 'O corpo vivo de get_teacher_page mudou desde 26 set (md5 %). Não correr: avisar o Dev 4.', v;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.get_teacher_page(p_teacher_profile_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE tp teacher_profiles; v_teacher JSONB; v_items JSONB; v_prices JSONB;
BEGIN
  SELECT * INTO tp FROM teacher_profiles WHERE id = p_teacher_profile_id;
  IF NOT FOUND OR NOT teacher_profile_active(tp.id) THEN RETURN NULL; END IF;

  SELECT jsonb_build_object(
    'teacher_profile_id', tp.id, 'user_id', tp.user_id, 'name', p.name, 'avatar_url', p.avatar_url,
    'gender', p.gender, 'rating', CASE WHEN can_view_section(p.id, p.results_visibility) THEN p.rating END, 'contact', tp.contact, 'zone', tp.zone,
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
$function$;

REVOKE EXECUTE ON FUNCTION public.get_teacher_page(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_teacher_page(uuid, date, date) TO authenticated;

COMMIT;

-- Verificação: SELECT position('can_view_section' in prosrc) > 0 FROM pg_proc WHERE proname = 'get_teacher_page';  → true
