-- ════════════════════════════════════════════════════════════════════════════
-- O horário de um professor, gravado por quem gere as aulas dele
-- (Dev 4, 26 set 2026; plano aprovado pelo Francisco no mesmo dia)
--
-- Porquê: a policy «Owner manages own availability» (migration_teacher_profiles)
-- só deixa o próprio professor escrever em teacher_availability. O Tiago
-- (admin do A2N) tem de pôr o horário do Diogo, e a equipa Alinho o do Daniel
-- (sem clube). Esta função deixa quem pode editar as aulas desse professor
-- (can_edit_lessons: o próprio, o admin do clube, a equipa Alinho) trocar o
-- horário semanal inteiro de uma vez.
--
-- Ordem: depois de migration_lessons_1_base.sql (can_edit_lessons). Não
-- redefine nada que outra migração tenha redefinido. Pode correr outra vez.
-- ════════════════════════════════════════════════════════════════════════════

-- p_slots: [{ "day_of_week": "terca", "start_time": "09:00", "end_time": "13:00" }, ...]
CREATE OR REPLACE FUNCTION set_teacher_availability(p_teacher_profile_id UUID, p_slots JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_teacher_profile_id IS NULL OR NOT can_edit_lessons(p_teacher_profile_id) THEN
    RAISE EXCEPTION 'Sem permissão para mudar o horário deste professor';
  END IF;

  -- Tudo numa transação: se uma linha falhar (dia inválido, fim antes do
  -- início), o horário antigo fica como estava.
  DELETE FROM teacher_availability WHERE teacher_profile_id = p_teacher_profile_id;
  INSERT INTO teacher_availability (teacher_profile_id, day_of_week, start_time, end_time)
  SELECT p_teacher_profile_id, s->>'day_of_week', (s->>'start_time')::time, (s->>'end_time')::time
  FROM jsonb_array_elements(COALESCE(p_slots, '[]'::jsonb)) s;
END;
$$;

REVOKE EXECUTE ON FUNCTION set_teacher_availability(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_teacher_availability(UUID, JSONB) TO authenticated;

-- Verificação (só leitura):
-- SELECT proname, proacl FROM pg_proc WHERE proname = 'set_teacher_availability';
