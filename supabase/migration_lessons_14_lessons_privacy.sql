-- ════════════════════════════════════════════════════════════════════════════
-- Aulas 14 — calendário interativo e privacidade das aulas (Dev 4, 27 set 2026)
-- SPEC-calendario-2.md: assunto 4 + «MUDANÇA NO ASSUNTO 4» + «Privacidade das
-- aulas» (APROVADO, Francisco, 27 set; plano aprovado: «Sim avança»).
--
--   · profiles.lessons_visibility ('public' | 'friends' | 'private', por
--     omissão 'private'): «Aulas (onde e com quem treinas)» em Perfil ›
--     Privacidade. A pessoa escreve-a como as outras (GRANT UPDATE da coluna).
--   · get_teacher_lessons_detail(): as aulas de um professor entre duas datas
--     (até 5 semanas) — o tipo, o nível, a lotação, o preço da turma — e, de
--     quem lá está, SÓ quem deixou (can_view_section com lessons_visibility:
--     público, amigos = seguem-se um ao outro, privado = ninguém). Dos outros,
--     só a lotação. O professor nunca aparece como aluno.
--     Aulas que quem vê não pode ver (lesson_visible_to_me): só a hora, o tipo
--     e a lotação — nunca nomes nem preço.
--     Não sai a média de nível dos alunos (nota do SI, 27 set: numa aula a um
--     era o nível exato da pessoa). O nível que se mostra é o da turma.
--
-- Ordem: depois da _1 (lesson_visible_to_me, lesson_capacity, lesson_price_row)
-- e da migration_instagram_follow_system (can_view_section). Pode correr outra vez.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. A definição da pessoa ────────────────────────────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS lessons_visibility TEXT NOT NULL DEFAULT 'private'
  CHECK (lessons_visibility IN ('public', 'friends', 'private'));
GRANT UPDATE (lessons_visibility) ON profiles TO authenticated;

-- ── 2. As aulas de um professor, com os nomes permitidos ────────────────────
CREATE OR REPLACE FUNCTION get_teacher_lessons_detail(p_teacher_profile_id UUID, p_from DATE, p_to DATE)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT lessons_enabled_for_me() THEN RETURN NULL; END IF;
  SELECT user_id INTO v_user FROM teacher_profiles WHERE id = p_teacher_profile_id;
  IF v_user IS NULL OR NOT teacher_profile_active(p_teacher_profile_id) THEN RETURN NULL; END IF;
  p_to := LEAST(p_to, p_from + 35);

  RETURN (
    SELECT COALESCE(jsonb_agg(j ORDER BY at), '[]'::jsonb) FROM (
      SELECT l.starts_at AS at, jsonb_build_object(
        'lesson_id', CASE WHEN x.visible THEN l.id END,
        'series_id', CASE WHEN x.visible THEN l.series_id END,
        'teacher_profile_id', l.teacher_profile_id,
        'starts_at', l.starts_at,
        'ends_at', l.starts_at + make_interval(mins => l.duration_minutes),
        'lesson_type', l.lesson_type,
        'form', CASE WHEN l.series_id IS NOT NULL THEN 'series' ELSE 'single' END,
        'level_from', s.level_from, 'level_to', s.level_to,
        'gender_restriction', l.gender_restriction,
        'capacity', lesson_capacity(l.lesson_type),
        'taken', CASE WHEN l.series_id IS NOT NULL
                   THEN (SELECT COUNT(*) FROM lesson_enrolments e WHERE e.series_id = l.series_id AND e.status IN ('accepted', 'confirmed', 'leaving'))
                   ELSE (SELECT COUNT(*) FROM lesson_attendees a WHERE a.lesson_id = l.id AND a.status IN ('accepted', 'confirmed')) END,
        'price_month', CASE WHEN x.visible AND l.series_id IS NOT NULL THEN COALESCE(s.promo_price_month,
            (lesson_price_row(l.teacher_profile_id, l.organization_id, l.lesson_type, l.duration_minutes, s.price_peak,
                              (l.starts_at AT TIME ZONE 'Europe/Lisbon')::date)).price_month) END,
        'visible', x.visible,
        -- Os nomes: só de quem deixou (e nunca o próprio professor).
        'people', CASE WHEN x.visible THEN COALESCE((
            SELECT jsonb_agg(jsonb_build_object('user_id', pr.id, 'name', pr.name, 'avatar_url', pr.avatar_url,
                                                'me', pr.id = auth.uid()) ORDER BY pr.name)
              FROM lesson_attendees a JOIN profiles pr ON pr.id = a.user_id
             WHERE a.lesson_id = l.id AND a.status IN ('accepted', 'confirmed') AND a.user_id <> v_user
               AND can_view_section(pr.id, pr.lessons_visibility)), '[]'::jsonb) ELSE '[]'::jsonb END
      ) AS j
      FROM lessons l
      JOIN teacher_profiles tp ON tp.id = l.teacher_profile_id
      LEFT JOIN lesson_series s ON s.id = l.series_id
      CROSS JOIN LATERAL (SELECT lesson_visible_to_me(l.visibility, l.organization_id) AS visible) x
     WHERE tp.user_id = v_user AND l.status <> 'cancelled'
       AND (l.starts_at AT TIME ZONE 'Europe/Lisbon')::date BETWEEN p_from AND p_to
    ) q
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION get_teacher_lessons_detail(UUID, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_teacher_lessons_detail(UUID, DATE, DATE) TO authenticated;

-- Verificação (só leitura):
-- SELECT column_default FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'lessons_visibility';
-- SELECT proacl FROM pg_proc WHERE proname = 'get_teacher_lessons_detail';
