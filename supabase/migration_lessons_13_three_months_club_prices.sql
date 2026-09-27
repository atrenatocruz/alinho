-- ════════════════════════════════════════════════════════════════════════════
-- Aulas 13 — marcar até 3 meses à frente; num clube, os preços são do clube
-- (Dev 4, 27 set 2026; SPEC-calendario-2.md, «Decisões de 27 set», Francisco:
-- «sim» às duas, vindas do feedback do Diogo)
--
-- 1. Marcar até 3 meses (antes, 14 dias): request_lesson e
--    lesson_request_slot_ok trocam «15 days» por «92 days» e a frase do erro.
--    Troca-se SÓ esse fragmento no corpo vivo (regra da casa: pg_safeupdate e
--    o corpo vivo) — o passo 0 pára se o corpo vivo não for o esperado.
-- 2. get_teacher_busy_range(): o ocupado de um professor (aulas, pedidos,
--    fechos — teacher_busy) entre duas datas, até 3 meses; o calendário
--    pede cada semana ao navegar. O get_teacher_booking não muda (15 dias).
-- 3. set_lesson_prices recusa preços do professor quando o perfil tem clube
--    («num clube, os preços são sempre os do clube»). O clube continua a gravar
--    a sua tabela (teacher_profile_id NULL); o professor sem clube, a dele.
-- 4. propose_lesson_merge recusa juntar uma aula experimental (nota do SI ao
--    rever a _12: juntá-la mudava-lhe o tipo e o preço, e deixava de ser
--    experimental). Mesmo método: só o fragmento, no corpo vivo.
--
-- Ordem: depois da _11 (teacher_busy com fechos). Pode correr outra vez (o
-- passo 0 aceita o corpo já trocado e não troca duas vezes).
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 0 + 1. Trocar só o fragmento, nos corpos vivos ─────────────────────────
DO $$
DECLARE
  f RECORD;
  v_src TEXT;
  v_def TEXT;
BEGIN
  FOR f IN SELECT * FROM (VALUES
      ('request_lesson', 'fee0faaea3d2b4a00f7c0ac8f001429b'),
      ('lesson_request_slot_ok', '875823e68caf165a5ee8d7642dd671d9'),
      ('set_lesson_prices', '77b15f4e35a5cc2ac23acbd0d7a3509b'),
      ('propose_lesson_merge', '747a211d2bd3a1d16505453b7ae885ac')) AS x(name, md5)
  LOOP
    SELECT p.prosrc, pg_get_functiondef(p.oid) INTO v_src, v_def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = f.name;
    IF v_src IS NULL THEN RAISE EXCEPTION 'Falta a função %', f.name; END IF;

    IF md5(v_src) <> f.md5 THEN
      -- Já trocada numa corrida anterior? Então segue; senão, pára.
      IF (f.name IN ('request_lesson', 'lesson_request_slot_ok') AND position('92 days' in v_src) > 0)
         OR (f.name = 'set_lesson_prices' AND position('os preços são os do clube' in v_src) > 0)
         OR (f.name = 'propose_lesson_merge' AND position('não se junta a outras' in v_src) > 0) THEN
        CONTINUE;
      END IF;
      RAISE EXCEPTION 'O corpo vivo de % mudou (md5 %). Não correr: avisar o Dev 4.', f.name, md5(v_src);
    END IF;

    IF f.name = 'propose_lesson_merge' THEN
      -- Âncora de uma linha só (as quebras de linha do ficheiro não contam).
      IF position('SELECT * INTO tp FROM teacher_profiles WHERE id = v_tp;' in v_def) = 0 THEN
        RAISE EXCEPTION 'propose_lesson_merge: fragmento não encontrado';
      END IF;
      v_def := replace(v_def, 'SELECT * INTO tp FROM teacher_profiles WHERE id = v_tp;',
        'IF EXISTS (SELECT 1 FROM lesson_requests WHERE id = ANY(p_request_ids) AND lesson_type = ''trial'') THEN RAISE EXCEPTION ''A aula experimental não se junta a outras''; END IF; SELECT * INTO tp FROM teacher_profiles WHERE id = v_tp;');
    ELSIF f.name = 'set_lesson_prices' THEN
      IF position('ELSIF NOT can_edit_lessons(p_teacher_profile_id) THEN' in v_def) = 0 THEN
        RAISE EXCEPTION 'set_lesson_prices: fragmento não encontrado';
      END IF;
      v_def := replace(v_def, 'ELSIF NOT can_edit_lessons(p_teacher_profile_id) THEN',
        'ELSIF EXISTS (SELECT 1 FROM teacher_profiles WHERE id = p_teacher_profile_id AND organization_id IS NOT NULL) THEN RAISE EXCEPTION ''Num clube, os preços são os do clube''; ELSIF NOT can_edit_lessons(p_teacher_profile_id) THEN');
    ELSE
      IF position('INTERVAL ''15 days''' in v_def) = 0 THEN
        RAISE EXCEPTION '%: fragmento não encontrado', f.name;
      END IF;
      v_def := replace(v_def, 'INTERVAL ''15 days''', 'INTERVAL ''92 days''');
      v_def := replace(v_def, 'Escolhe um dia dos próximos 14 dias', 'Escolhe um dia dos próximos 3 meses');
    END IF;
    EXECUTE v_def;
  END LOOP;
END $$;

-- ── 2. O ocupado entre duas datas (o calendário, semana a semana) ──────────
CREATE OR REPLACE FUNCTION get_teacher_busy_range(p_teacher_profile_id UUID, p_from DATE, p_to DATE)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user UUID; v_today DATE := (NOW() AT TIME ZONE 'Europe/Lisbon')::date;
BEGIN
  IF auth.uid() IS NULL OR NOT lessons_enabled_for_me() THEN RETURN NULL; END IF;
  SELECT user_id INTO v_user FROM teacher_profiles WHERE id = p_teacher_profile_id;
  IF v_user IS NULL OR NOT teacher_profile_active(p_teacher_profile_id) THEN RETURN NULL; END IF;
  -- Só de hoje a 3 meses, e no máximo 5 semanas de cada vez.
  p_from := GREATEST(p_from, v_today - 7);
  p_to := LEAST(p_to, v_today + 92, p_from + 35);
  IF p_to < p_from THEN RETURN '[]'::jsonb; END IF;
  RETURN (SELECT COALESCE(jsonb_agg(jsonb_build_object('starts_at', b.starts_at, 'ends_at', b.ends_at, 'kind', b.kind)), '[]'::jsonb)
            FROM teacher_busy(v_user, p_from::timestamp AT TIME ZONE 'Europe/Lisbon', (p_to + 1)::timestamp AT TIME ZONE 'Europe/Lisbon') b);
END;
$$;

REVOKE EXECUTE ON FUNCTION get_teacher_busy_range(UUID, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_teacher_busy_range(UUID, DATE, DATE) TO authenticated;

COMMIT;

-- Verificação (só leitura):
-- SELECT proname, position('92 days' in prosrc) > 0 FROM pg_proc WHERE proname IN ('request_lesson', 'lesson_request_slot_ok');
-- SELECT position('os preços são os do clube' in prosrc) > 0 FROM pg_proc WHERE proname = 'set_lesson_prices';
-- SELECT position('não se junta a outras' in prosrc) > 0 FROM pg_proc WHERE proname = 'propose_lesson_merge';
-- SELECT proacl FROM pg_proc WHERE proname IN ('request_lesson', 'lesson_request_slot_ok', 'set_lesson_prices', 'get_teacher_busy_range');
