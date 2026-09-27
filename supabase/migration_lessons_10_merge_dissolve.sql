-- ════════════════════════════════════════════════════════════════════════════
-- Aulas 10 — se um aluno sai de uma junção, a junção desfaz-se
-- (Dev 4, 27 set 2026; falha apontada pelo System Integrator ao rever a _6,
-- pedida pelo PO)
--
-- Falha: um pedido cancelado pelo aluno (cancel_lesson_request) ou recusado
-- pelo professor (reject_lesson_request) ficava com o merge_id. Quando os
-- outros aceitavam, book_lesson_merge marcava a aula conjunta só com quem
-- restava — uma «aula a 2» só com um aluno, ao preço de aula a 2. O mesmo
-- quando um de três dizia «Fico com o meu pedido»: a junção seguia com dois,
-- ao preço de aula a 3.
--
-- Correção: dissolve_lesson_merge() desfaz a junção, devolve cada um dos
-- outros ao seu pedido (hora, tipo e preço de antes, que nunca mudaram) e
-- avisa-os (lesson_merge_dissolved). É chamada quando alguém sai:
--   · cancel_lesson_request  (corpo da _3 + a junção)
--   · reject_lesson_request  (corpo da _4 + a junção)
--   · answer_lesson_merge    (corpo da _6; recusar desfaz sempre)
--
-- Ordem: depois da _6 (lesson_merges). Não depende da _7 a _9. Os corpos são
-- os desses ficheiros; comparar com os vivos antes de correr. Pode correr
-- outra vez.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Desfazer uma junção (interna) ────────────────────────────────────────
CREATE OR REPLACE FUNCTION dissolve_lesson_merge(p_merge UUID, p_leaving UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m lesson_merges; r RECORD; v_teacher TEXT;
BEGIN
  SELECT * INTO m FROM lesson_merges WHERE id = p_merge FOR UPDATE;
  IF NOT FOUND OR m.status <> 'pending' THEN RETURN; END IF;
  SELECT p.name INTO v_teacher FROM teacher_profiles tp JOIN profiles p ON p.id = tp.user_id WHERE tp.id = m.teacher_profile_id;

  FOR r IN SELECT * FROM lesson_requests WHERE merge_id = p_merge AND id <> p_leaving AND status = 'pending' LOOP
    PERFORM lesson_notify(r.user_id, 'lesson_merge_dissolved', NULL, jsonb_build_object(
      'request_id', r.id, 'teacher_name', v_teacher, 'teacher_profile_id', r.teacher_profile_id,
      'lesson_date', m.starts_at, 'starts_at', r.starts_at));
  END LOOP;
  UPDATE lesson_requests SET merge_id = NULL, merge_answer = NULL WHERE merge_id = p_merge;
  UPDATE lesson_merges SET status = 'cancelled' WHERE id = p_merge;
END;
$$;

-- ── 2. O aluno cancela (corpo da _3 + a junção) ─────────────────────────────
CREATE OR REPLACE FUNCTION cancel_lesson_request(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r lesson_requests;
BEGIN
  SELECT * INTO r FROM lesson_requests WHERE id = p_id AND user_id = auth.uid();
  IF NOT FOUND OR r.status <> 'pending' THEN RAISE EXCEPTION 'Pedido não encontrado ou já resolvido'; END IF;
  -- Numa junção por responder: desfaz-se, e os outros voltam ao seu pedido.
  IF r.merge_id IS NOT NULL THEN PERFORM dissolve_lesson_merge(r.merge_id, p_id); END IF;
  -- Fechado: o telefone apaga-se logo.
  UPDATE lesson_requests SET status = 'cancelled', contact_phone = NULL, resolved_at = NOW(), resolved_by = auth.uid()
   WHERE id = p_id;
  PERFORM lesson_notify((SELECT user_id FROM teacher_profiles WHERE id = r.teacher_profile_id), 'lesson_request_cancelled', NULL,
    jsonb_build_object('request_id', p_id, 'student_name', (SELECT name FROM profiles WHERE id = auth.uid()), 'starts_at', r.starts_at));
END;
$$;

-- ── 3. O professor recusa (corpo da _4 + a junção) ──────────────────────────
CREATE OR REPLACE FUNCTION reject_lesson_request(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r lesson_requests; v_teacher UUID;
BEGIN
  SELECT * INTO r FROM lesson_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR r.status <> 'pending' THEN RAISE EXCEPTION 'Pedido não encontrado ou já resolvido'; END IF;
  SELECT user_id INTO v_teacher FROM teacher_profiles WHERE id = r.teacher_profile_id;
  IF v_teacher <> auth.uid() THEN RAISE EXCEPTION 'Só o professor pode responder a este pedido'; END IF;
  IF r.merge_id IS NOT NULL THEN PERFORM dissolve_lesson_merge(r.merge_id, p_id); END IF;
  -- Fechado: o telefone apaga-se logo.
  UPDATE lesson_requests SET status = 'rejected', contact_phone = NULL, resolved_at = NOW(), resolved_by = auth.uid()
   WHERE id = p_id;
  PERFORM lesson_notify(r.user_id, 'lesson_request_rejected', NULL, jsonb_build_object(
    'request_id', p_id, 'teacher_name', (SELECT name FROM profiles WHERE id = v_teacher), 'starts_at', r.starts_at));
END;
$$;

-- ── 4. Responder à junção (corpo da _6; recusar desfaz sempre) ──────────────
CREATE OR REPLACE FUNCTION answer_lesson_merge(p_merge_id UUID, p_accept BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r lesson_requests; m lesson_merges;
BEGIN
  SELECT * INTO r FROM lesson_requests WHERE merge_id = p_merge_id AND user_id = auth.uid() AND status = 'pending' FOR UPDATE;
  IF NOT FOUND OR r.merge_answer <> 'pending' THEN RAISE EXCEPTION 'Proposta não encontrada ou já respondida'; END IF;
  SELECT * INTO m FROM lesson_merges WHERE id = p_merge_id FOR UPDATE;
  IF m.status <> 'pending' THEN RAISE EXCEPTION 'Esta proposta já não está em aberto'; END IF;

  IF p_accept THEN
    UPDATE lesson_requests SET merge_answer = 'accepted' WHERE id = r.id;
    IF NOT EXISTS (SELECT 1 FROM lesson_requests WHERE merge_id = p_merge_id AND status = 'pending' AND merge_answer = 'pending') THEN
      PERFORM book_lesson_merge(p_merge_id);
    END IF;
  ELSE
    -- «Fico com o meu pedido»: a junção era para todos (o tipo e o preço
    -- contam com eles); sem um, desfaz-se e cada um volta ao seu pedido.
    PERFORM lesson_notify((SELECT user_id FROM teacher_profiles WHERE id = m.teacher_profile_id), 'lesson_merge_declined', NULL,
      jsonb_build_object('merge_id', p_merge_id, 'student_name', (SELECT name FROM profiles WHERE id = auth.uid()), 'starts_at', m.starts_at));
    PERFORM dissolve_lesson_merge(p_merge_id, r.id);
  END IF;
END;
$$;

-- ── 5. Permissões: explícitas (o Supabase dá EXECUTE a anon e authenticated) ─
REVOKE EXECUTE ON FUNCTION dissolve_lesson_merge(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION cancel_lesson_request(UUID), reject_lesson_request(UUID), answer_lesson_merge(UUID, BOOLEAN)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION cancel_lesson_request(UUID), reject_lesson_request(UUID), answer_lesson_merge(UUID, BOOLEAN)
  TO authenticated;

-- Verificação (só leitura):
-- SELECT proname, proacl FROM pg_proc
--  WHERE proname IN ('dissolve_lesson_merge', 'cancel_lesson_request', 'reject_lesson_request', 'answer_lesson_merge');
