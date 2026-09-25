-- ═══════════════════════════════════════════════════════════════════════
-- #529 — Mix recorrente deixa de sair quando se perde o mix seguinte
-- (Bugs, 25 set 2026; plano aprovado pelo Francisco a 25 set.)
--
-- A exigência (cartão):
--   · Uma série ativa e não pausada nunca fica sem próximo mix. Se não houver
--     `pending`, o sistema cria o seguinte sozinho, no máximo em 5 minutos.
--   · Apagar no Gerir o próximo mix de uma série salta só essa data: a série
--     continua (skip_recurrence_game).
--   · Mudar a hora de lançamento sem próximo mix funciona, ou diz porque não
--     (ensure_recurrence_successor).
--   · Junta-se (PO, 25 set): o cron passa a respeitar a pausa. O corpo vivo
--     não olhava para `is_paused` (0 séries pausadas a 25 set).
--
-- ESCRITA A PARTIR DO CORPO VIVO de produção, lido pelo System Integrator a
-- 25 set ~17h: length(prosrc)=2394 (com CRLF), md5 sem chr(13) =
-- d9e44bb8d54da4625f1bc2171418ac2b. O passo 0 pára se o corpo tiver mudado.
-- Em relação ao corpo vivo, o process_due_game_recurrences só muda em:
--   (a) `AND gr.is_paused = false` na escolha dos `pending` a abrir;
--   (b) o INSERT passa para recurrence_insert_pending(), que copia também a
--       `age_restriction` (o corpo vivo esquecia-a) e só conta mais uma vez
--       em `occurrences_created` quando o mix é mesmo criado (o corpo vivo
--       contava também quando o ON CONFLICT não criava nada);
--   (c) no fim, repair_recurrences_without_successor().
-- Não se cria nenhum job de cron novo: a reparação corre no mesmo job
-- 'process-game-recurrences' (*/5), dentro da mesma função.
--
-- ⚠️ ANTES DE CORRER (System Integrator), ver que séries a reparação vai
-- reavivar logo no primeiro minuto — pode haver alguma parada de propósito
-- apagando o mix pendente em vez de desligar a recorrência:
--
--   SELECT gr.id, gr.title, o.name AS clube, gr.frequency,
--          (SELECT max(date) FROM games WHERE recurrence_id = gr.id) AS ultimo_mix
--     FROM game_recurrences gr JOIN organizations o ON o.id = gr.organization_id
--    WHERE gr.is_active AND NOT gr.is_paused
--      AND NOT EXISTS (SELECT 1 FROM games g WHERE g.recurrence_id = gr.id
--                       AND g.status IN ('pending', 'draft'));
--
-- Se a lista não vier vazia, mostrar ao Francisco antes de correr.
--
-- Estados: 'draft' (#544) conta como «tem próximo» — uma série criada em
-- rascunho só prepara a data seguinte quando o rascunho é publicado.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 0. Travas: parar se produção já não é o que foi lido ────────────────
DO $$
DECLARE
  v_md5 TEXT;
BEGIN
  SELECT md5(replace(p.prosrc, chr(13), '')) INTO v_md5
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'process_due_game_recurrences';
  IF v_md5 IS DISTINCT FROM 'd9e44bb8d54da4625f1bc2171418ac2b' THEN
    RAISE EXCEPTION 'process_due_game_recurrences mudou desde 25 set ~17h (md5 %). Parar e ler o corpo vivo outra vez.', v_md5;
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'game_recurrences'
         AND column_name IN ('is_paused', 'age_restriction', 'allow_pair_signup')) <> 3 THEN
    RAISE EXCEPTION 'Faltam colunas em game_recurrences (is_paused/age_restriction/allow_pair_signup). Parar e ler.';
  END IF;
END $$;

-- ── 1. A data seguinte de uma série (a mesma conta do cron) ─────────────
CREATE OR REPLACE FUNCTION public.recurrence_next_date(p_date TIMESTAMPTZ, p_frequency TEXT)
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT ((p_date AT TIME ZONE 'Europe/Lisbon') + (CASE p_frequency
            WHEN 'daily'   THEN interval '1 day'
            WHEN 'weekly'  THEN interval '1 week'
            WHEN 'monthly' THEN interval '1 month'
            WHEN 'yearly'  THEN interval '1 year'
          END)) AT TIME ZONE 'Europe/Lisbon';
$$;

-- ── 2. Criar o mix `pending` de uma data, com as escolhas da série ──────
-- Devolve o id do mix criado, ou NULL se já havia um mix nessa data.
CREATE OR REPLACE FUNCTION public.recurrence_insert_pending(p_recurrence_id UUID, p_date TIMESTAMPTZ)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec game_recurrences%ROWTYPE;
  v_id UUID;
BEGIN
  SELECT * INTO rec FROM game_recurrences WHERE id = p_recurrence_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  INSERT INTO games (
    organization_id, title, date, location, price_per_player, prize, has_voucher,
    num_courts, max_players, court_time_minutes, game_time_minutes, format,
    gender_restriction, age_restriction, auto_start_hours_before, level, pairing_mode, rotate_partners, allow_pair_signup, ranked,
    status, created_by, recurrence_id, is_recurrence_origin, launch_at
  )
  VALUES (
    rec.organization_id, rec.title, p_date, rec.location, rec.price_per_player, rec.prize, rec.has_voucher,
    rec.num_courts, rec.num_courts * 4, rec.court_time_minutes, rec.game_time_minutes, rec.format,
    rec.gender_restriction, rec.age_restriction, rec.auto_start_hours_before, rec.level, rec.pairing_mode, rec.rotate_partners, rec.allow_pair_signup, rec.ranked,
    'pending', rec.created_by, rec.id, false,
    p_date - make_interval(secs => rec.mix_offset_seconds)
  )
  ON CONFLICT (recurrence_id, date) WHERE recurrence_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    UPDATE game_recurrences
       SET occurrences_created = occurrences_created + 1, updated_at = now()
     WHERE id = rec.id;
  END IF;
  RETURN v_id;
END;
$$;

-- ── 3. Dar a uma série o próximo mix que lhe falta ──────────────────────
-- Resultado: 'exists' (já tinha pending), 'draft' (rascunho por publicar),
-- 'created', 'ended' (chegou ao fim: a série é desligada, como no cron),
-- 'paused', 'inactive', 'no_base' (nenhum mix de onde contar a data).
CREATE OR REPLACE FUNCTION public.create_recurrence_successor(p_recurrence_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  gr game_recurrences%ROWTYPE;
  v_status TEXT;
  v_last TIMESTAMPTZ;
  v_next TIMESTAMPTZ;
BEGIN
  SELECT * INTO gr FROM game_recurrences WHERE id = p_recurrence_id FOR UPDATE;
  IF NOT FOUND OR NOT gr.is_active THEN
    RETURN 'inactive';
  END IF;
  IF gr.is_paused THEN
    RETURN 'paused';
  END IF;

  SELECT status INTO v_status FROM games
   WHERE recurrence_id = gr.id AND status IN ('pending', 'draft')
   ORDER BY (status = 'pending') DESC
   LIMIT 1;
  IF v_status = 'pending' THEN
    RETURN 'exists';
  ELSIF v_status = 'draft' THEN
    RETURN 'draft';
  END IF;

  -- A partir do último mix da série, seja qual for o estado (um cancelado
  -- também ocupa a data), a primeira data que ainda não passou.
  SELECT max(date) INTO v_last FROM games WHERE recurrence_id = gr.id;
  IF v_last IS NULL THEN
    RETURN 'no_base';
  END IF;
  v_next := recurrence_next_date(v_last, gr.frequency);
  WHILE v_next <= now() LOOP
    v_next := recurrence_next_date(v_next, gr.frequency);
  END LOOP;

  IF (gr.ends_type = 'on_date' AND v_next > gr.ends_on)
     OR (gr.ends_type = 'after_occurrences' AND gr.occurrences_created >= gr.ends_after_occurrences) THEN
    UPDATE game_recurrences SET is_active = false, updated_at = now() WHERE id = gr.id;
    RETURN 'ended';
  END IF;

  PERFORM recurrence_insert_pending(gr.id, v_next);
  RETURN 'created';
END;
$$;

-- ── 4. A reparação que o cron corre: todas as séries sem próximo mix ────
CREATE OR REPLACE FUNCTION public.repair_recurrences_without_successor()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_created INTEGER := 0;
BEGIN
  FOR r IN
    SELECT gr.id FROM game_recurrences gr
     WHERE gr.is_active AND NOT gr.is_paused
       AND NOT EXISTS (SELECT 1 FROM games g
                        WHERE g.recurrence_id = gr.id AND g.status IN ('pending', 'draft'))
  LOOP
    -- Uma série com problemas nunca pode parar o cron: sem isto, um erro
    -- aqui desfazia também a abertura dos mixes feita antes, no mesmo job.
    BEGIN
      IF create_recurrence_successor(r.id) = 'created' THEN
        v_created := v_created + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '#529: a série % ficou sem próximo mix: % (%)', r.id, SQLERRM, SQLSTATE;
    END;
  END LOOP;
  RETURN v_created;
END;
$$;

-- ── 5. O cron: corpo vivo + pausa + INSERT partilhado + reparação ───────
CREATE OR REPLACE FUNCTION public.process_due_game_recurrences()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  rec RECORD;
  v_new_date TIMESTAMPTZ;
BEGIN
  FOR rec IN
    SELECT g.id AS pending_game_id, g.date AS pending_date, gr.*
    FROM games g
    JOIN game_recurrences gr ON gr.id = g.recurrence_id
    WHERE g.status = 'pending' AND g.launch_at <= now() AND gr.is_active = true
      AND gr.is_paused = false  -- #529: a pausa não era respeitada
    FOR UPDATE OF g SKIP LOCKED
  LOOP
    IF EXISTS (
      SELECT 1 FROM games
      WHERE recurrence_id = rec.id AND status IN ('open', 'closed', 'in_progress')
    ) THEN
      CONTINUE;
    END IF;

    UPDATE games SET status = 'open', updated_at = now(), launch_at = NULL WHERE id = rec.pending_game_id;

    v_new_date := recurrence_next_date(rec.pending_date, rec.frequency);

    IF (rec.ends_type = 'on_date' AND v_new_date > rec.ends_on)
       OR (rec.ends_type = 'after_occurrences' AND rec.occurrences_created >= rec.ends_after_occurrences) THEN
      UPDATE game_recurrences SET is_active = false, updated_at = now() WHERE id = rec.id;
      CONTINUE;
    END IF;

    -- #529: copia também age_restriction e só conta quando cria.
    PERFORM recurrence_insert_pending(rec.id, v_new_date);
  END LOOP;

  -- #529: nenhuma série ativa e não pausada fica sem próximo mix.
  PERFORM repair_recurrences_without_successor();
END;
$$;

-- ── 6. Para o Gerir (só admins do clube/grupo, ou da plataforma) ───────
CREATE OR REPLACE FUNCTION public.is_org_admin_or_platform(p_organization_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM memberships
                  WHERE organization_id = p_organization_id AND user_id = auth.uid() AND is_admin)
      OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_platform_admin);
$$;

-- Mudar a hora de lançamento numa série sem próximo mix: cria-o já, com a
-- hora nova (a série já foi atualizada antes de chamar isto).
CREATE OR REPLACE FUNCTION public.ensure_recurrence_successor(p_recurrence_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org UUID;
BEGIN
  SELECT organization_id INTO v_org FROM game_recurrences WHERE id = p_recurrence_id;
  IF v_org IS NULL OR NOT is_org_admin_or_platform(v_org) THEN
    RAISE EXCEPTION 'Só os admins do clube ou grupo podem mexer nesta recorrência.' USING ERRCODE = 'P0001';
  END IF;
  RETURN create_recurrence_successor(p_recurrence_id);
END;
$$;

-- Apagar o próximo mix de uma série = saltar essa data. A série continua:
-- cria-se logo o seguinte. Devolve a data do novo próximo mix, ou NULL se
-- a série chegou ao fim (e fica desligada).
CREATE OR REPLACE FUNCTION public.skip_recurrence_game(p_game_id UUID)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g games%ROWTYPE;
  gr game_recurrences%ROWTYPE;
  v_next TIMESTAMPTZ;
  v_last TIMESTAMPTZ;
BEGIN
  SELECT * INTO g FROM games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Este Mix já não existe.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT is_org_admin_or_platform(g.organization_id) THEN
    RAISE EXCEPTION 'Só os admins do clube ou grupo podem apagar este Mix.' USING ERRCODE = 'P0001';
  END IF;
  IF g.status <> 'pending' OR g.recurrence_id IS NULL OR g.is_recurrence_origin THEN
    RAISE EXCEPTION 'Este Mix não é o próximo de uma recorrência.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO gr FROM game_recurrences WHERE id = g.recurrence_id FOR UPDATE;

  DELETE FROM games WHERE id = g.id;
  -- A data saltada não conta como vez feita («termina ao fim de N»).
  UPDATE game_recurrences
     SET occurrences_created = GREATEST(occurrences_created - 1, 1), updated_at = now()
   WHERE id = gr.id
  RETURNING * INTO gr;

  IF NOT gr.is_active OR gr.is_paused THEN
    RETURN NULL;
  END IF;

  -- A seguir à data saltada, ou a um mix já marcado mais à frente.
  SELECT max(date) INTO v_last FROM games WHERE recurrence_id = gr.id;
  v_next := recurrence_next_date(GREATEST(g.date, COALESCE(v_last, g.date)), gr.frequency);
  WHILE v_next <= now() LOOP
    v_next := recurrence_next_date(v_next, gr.frequency);
  END LOOP;

  IF (gr.ends_type = 'on_date' AND v_next > gr.ends_on)
     OR (gr.ends_type = 'after_occurrences' AND gr.occurrences_created >= gr.ends_after_occurrences) THEN
    UPDATE game_recurrences SET is_active = false, updated_at = now() WHERE id = gr.id;
    RETURN NULL;
  END IF;

  PERFORM recurrence_insert_pending(gr.id, v_next);
  RETURN v_next;
END;
$$;

-- ── 7. Permissões (regra do System Integrator, 25 set) ──────────────────
-- O Supabase dá EXECUTE a anon por omissão: REVOKE explícito de anon e
-- PUBLIC, e depois GRANT só a quem precisa. O cron corre como postgres.
REVOKE EXECUTE ON FUNCTION public.recurrence_next_date(TIMESTAMPTZ, TEXT) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recurrence_insert_pending(UUID, TIMESTAMPTZ) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_recurrence_successor(UUID) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.repair_recurrences_without_successor() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.process_due_game_recurrences() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_org_admin_or_platform(UUID) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ensure_recurrence_successor(UUID) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.skip_recurrence_game(UUID) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_recurrence_successor(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.skip_recurrence_game(UUID) TO authenticated;

-- ── 8. Verificação: pára se alguma coisa não ficou como devia ───────────
DO $$
DECLARE
  f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.recurrence_next_date(timestamptz,text)',
    'public.recurrence_insert_pending(uuid,timestamptz)',
    'public.create_recurrence_successor(uuid)',
    'public.repair_recurrences_without_successor()',
    'public.process_due_game_recurrences()',
    'public.is_org_admin_or_platform(uuid)',
    'public.ensure_recurrence_successor(uuid)',
    'public.skip_recurrence_game(uuid)'
  ] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon ainda pode chamar %. Parar e ler.', f;
    END IF;
  END LOOP;
  IF has_function_privilege('authenticated', 'public.process_due_game_recurrences()', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated ainda pode chamar o cron. Parar e ler.';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.skip_recurrence_game(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.ensure_recurrence_successor(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'O Gerir não consegue chamar skip/ensure. Parar e ler.';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.process_due_game_recurrences()'::regprocedure)
       NOT LIKE '%gr.is_paused = false%repair_recurrences_without_successor()%' THEN
    RAISE EXCEPTION 'process_due_game_recurrences não ficou com a pausa e a reparação. Parar e ler.';
  END IF;
  RAISE NOTICE '#529 pronto. Nenhuma série fica sem próximo mix; a pausa é respeitada.';
END $$;

-- ── Depois de correr (System Integrator) ────────────────────────────────
-- 1. SELECT process_due_game_recurrences();  -- ou esperar pelo cron (5 min)
-- 2. A query do topo (séries sem próximo) tem de devolver 0 linhas.
-- 3. SELECT jobname, schedule, active FROM cron.job;  -- o mesmo job, sem novos
