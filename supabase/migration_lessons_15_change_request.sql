-- ════════════════════════════════════════════════════════════════════════════
-- Aulas 15 — «Mudar o pedido» (Dev 4, 28 set 2026)
-- AUDITORIA.md, ponto 7 (plano aprovado pelo Francisco, 28 set: «sim»).
-- Enquanto o professor não aceitou, o aluno muda o seu pedido com os mesmos
-- passos do «Marcar aula»: o dia e a hora, a duração, o tipo e o contacto.
--
--   · update_lesson_request(): só o próprio aluno, só pedidos por responder e
--     fora de uma junção por responder (numa junção, o pedido segue a junção).
--     As mesmas verificações do request_lesson (horário do professor, ocupado
--     sem contar com este pedido, 3 meses, hora ou meia hora — tudo pelo
--     lesson_request_slot_ok vivo), o preço refeito (lesson_request_price) e
--     o telefone como no request_lesson. Uma hora proposta por alguém deixa
--     de valer: o pedido novo é o que conta. O professor recebe um aviso.
--   · Se alguma verificação falhar, nada muda (a função toda é uma transação).
--
-- Ordem: depois da _13 (lesson_request_slot_ok com 3 meses) e da _12 ('trial').
-- Pode correr outra vez.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_lesson_request(
  p_id UUID, p_starts_at TIMESTAMPTZ, p_duration SMALLINT, p_type TEXT,
  p_contact_via TEXT, p_phone TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r lesson_requests;
  v_teacher UUID;
  v_err TEXT;
  v_price RECORD;
  v_phone TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT lessons_enabled_for_me() THEN
    RAISE EXCEPTION 'A marcação de aulas ainda não está aberta';
  END IF;
  SELECT * INTO r FROM lesson_requests WHERE id = p_id AND user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'O professor já respondeu a este pedido'; END IF;
  IF r.merge_id IS NOT NULL THEN RAISE EXCEPTION 'Este pedido está numa junção por responder'; END IF;
  IF p_duration NOT IN (60, 90, 120) THEN RAISE EXCEPTION 'Escolhe a duração'; END IF;
  IF p_type NOT IN ('private', 'duo', 'trio', 'quad', 'trial') THEN RAISE EXCEPTION 'Escolhe o tipo de aula'; END IF;

  -- Contacto: como no request_lesson.
  IF p_contact_via NOT IN ('whatsapp', 'email') THEN RAISE EXCEPTION 'Escolhe como o professor fala contigo'; END IF;
  IF p_contact_via = 'whatsapp' THEN
    v_phone := NULLIF(regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g'), '');
    IF v_phone IS NULL THEN v_phone := r.contact_phone; END IF;
    IF v_phone IS NULL THEN
      SELECT NULLIF(regexp_replace(split_part(whatsapp_jid, '@', 1), '\D', '', 'g'), '') INTO v_phone
        FROM profiles WHERE id = auth.uid();
    END IF;
    IF v_phone IS NULL OR length(v_phone) < 9 OR length(v_phone) > 15 THEN
      RAISE EXCEPTION 'Falta o teu número de telefone';
    END IF;
    IF length(v_phone) = 9 THEN v_phone := '351' || v_phone; END IF;
  END IF;

  -- O pedido passa a ser o novo; as verificações leem-no já mudado (e o
  -- ocupado não conta com ele). Se falharem, a exceção desfaz tudo.
  UPDATE lesson_requests
     SET starts_at = p_starts_at, duration_minutes = p_duration, lesson_type = p_type,
         contact_via = p_contact_via, contact_phone = v_phone,
         proposed_starts_at = NULL, proposed_by = NULL, proposed_at = NULL, original_starts_at = NULL
   WHERE id = p_id;

  v_err := lesson_request_slot_ok(p_id, p_starts_at);
  IF v_err IS NOT NULL THEN RAISE EXCEPTION '%', v_err; END IF;
  SELECT * INTO v_price FROM lesson_request_price(p_id, p_starts_at);
  IF v_price.price IS NULL THEN RAISE EXCEPTION 'Este professor não tem preço para essa aula'; END IF;
  UPDATE lesson_requests SET price_per_person = v_price.price, price_peak = v_price.peak WHERE id = p_id;

  SELECT user_id INTO v_teacher FROM teacher_profiles WHERE id = r.teacher_profile_id;
  PERFORM lesson_notify(v_teacher, 'lesson_request_changed', NULL, jsonb_build_object(
    'request_id', p_id, 'student_name', (SELECT name FROM profiles WHERE id = auth.uid()),
    'starts_at', p_starts_at, 'was_starts_at', r.starts_at, 'duration_minutes', p_duration,
    'lesson_type', p_type, 'contact_via', p_contact_via));
END;
$$;

REVOKE EXECUTE ON FUNCTION update_lesson_request(UUID, TIMESTAMPTZ, SMALLINT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION update_lesson_request(UUID, TIMESTAMPTZ, SMALLINT, TEXT, TEXT, TEXT) TO authenticated;

-- Verificação (só leitura):
-- SELECT proacl FROM pg_proc WHERE proname = 'update_lesson_request';
