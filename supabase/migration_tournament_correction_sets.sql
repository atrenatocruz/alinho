-- ═════════════════════════════════════════════════════════════════════════
-- #485 — Pedidos de correção de resultado: guardar o tie-break e os sets,
-- validar ao pedir, «correção pedida» no jogo e aviso no sino. Plano
-- aprovado pelo Francisco a 26 set; o ecrã é do Dev 2.
--
-- O que se passava (QA, 26 set, já no site):
--   1. resolve_match_correction chamava save_match_result(..., NULL): ao
--      aceitar, perdia-se o detalhe — um 9-8 corrigido perdia o «(7-5)», e
--      nos torneios por sets perdiam-se os sets.
--   2. request_match_correction aceitava resultados impossíveis (5-3 num pro
--      set a 9), que só rebentavam quando o organizador carregava em Aceitar.
--
-- O que faz:
--   1. tournament_matches ganha pending_sets (JSONB). O pedido guarda-os
--      (p_sets, na forma que o save_match_result já recebe:
--      [{score_a, score_b, tiebreak_a, tiebreak_b, is_super_tiebreak}]), e
--      o aceitar passa-os. Recusar ou aceitar limpa-os.
--   2. O pedido valida o resultado com a MESMA regra da trava do Renato
--      (tournament_matches_result_guard): pro set a N → quem ganha tem N e o
--      outro no máximo N-1; por sets → 2-0 ou 2-1. As frases são as da
--      trava.
--   3. tournament_public_matches ganha correction_pending (há um pedido por
--      resolver nesse jogo) — só o sim/não, nunca quem pediu. Nome combinado
--      com o Dev 2.
--   4. Aviso no sino aos admins do clube do torneio quando chega um pedido
--      (kind 'tournament_correction_requested'; data = { tournament_id,
--      tournament_slug, tournament_name, category_code, match_id,
--      requester_name }); um por admin e por jogo enquanto não for lido.
--      Ao responder (aceitar ou recusar), os avisos desse jogo ficam lidos
--      para todos.
--
-- request_match_correction muda de assinatura (ganha p_sets): a antiga
-- apaga-se na mesma transação (lição do PGRST203, #465), e a nova tem REVOKE
-- explícito de PUBLIC e anon, GRANT só a authenticated.
-- Tudo parte do corpo vivo: troca só os fragmentos, recusa se algum não
-- aparecer o número exato de vezes, e diz «já estava» se repetido.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 0. Peças de que depende ─────────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.request_match_correction(uuid, integer, integer, text)') IS NULL
     AND to_regprocedure('public.request_match_correction(uuid, integer, integer, text, jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Não existe request_match_correction (migration_tournaments_correction_request.sql). Parar e ler.';
  END IF;
  IF to_regprocedure('public.save_match_result(uuid, integer, integer, jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Falta save_match_result(uuid, integer, integer, jsonb). Parar e ler.';
  END IF;
  IF to_regclass('public.notifications') IS NULL THEN
    RAISE EXCEPTION 'Falta a tabela notifications. Parar e ler.';
  END IF;
END $$;

ALTER TABLE tournament_matches ADD COLUMN IF NOT EXISTS pending_sets JSONB;

-- ── 1. Pedir: guarda os sets, valida, avisa ─────────────────────────────
DO $$
DECLARE
  c_head_mau CONSTANT TEXT := '(p_note text DEFAULT NULL::text)\)';
  c_head_bom CONSTANT TEXT := '\1, p_sets jsonb DEFAULT NULL::jsonb)';
  c_decl_mau CONSTANT TEXT := '(v_jogou\s+BOOLEAN;)';
  c_decl_bom CONSTANT TEXT := '\1
  v_scoring TEXT;
  v_hi      INTEGER;
  v_lo      INTEGER;
  v_n       INTEGER;';
  c_val_mau  CONSTANT TEXT := '(RAISE EXCEPTION ''Esse é o resultado que já lá está'';\s+END IF;)';
  c_val_bom  CONSTANT TEXT := '\1

  -- #485: a mesma regra da trava do resultado (tournament_matches_result
  -- _guard), agora já ao pedir — antes só rebentava ao aceitar.
  SELECT t.rules->>''scoring'' INTO v_scoring
    FROM tournament_categories c JOIN tournaments t ON t.id = c.tournament_id
   WHERE c.id = m.category_id;
  v_hi := GREATEST(p_score_a, p_score_b);
  v_lo := LEAST(p_score_a, p_score_b);
  IF COALESCE(v_scoring, ''pro_set_9'') LIKE ''pro_set_%'' THEN
    v_n := COALESCE(NULLIF(regexp_replace(COALESCE(v_scoring, ''''), ''[^0-9]'', '''', ''g''), '''')::int, 9);
    IF v_hi <> v_n OR v_lo > v_n - 1 THEN
      RAISE EXCEPTION ''Resultado impossível num pro set a %: %-%.'', v_n, p_score_a, p_score_b;
    END IF;
  ELSIF v_scoring IN (''melhor_2_sets'', ''melhor_3_sets'') THEN
    IF v_hi <> 2 OR v_lo > 1 THEN
      RAISE EXCEPTION ''Em sets, o resultado é 2-0 ou 2-1 (recebido %-%).'', p_score_a, p_score_b;
    END IF;
  END IF;';
  c_set_mau  CONSTANT TEXT := '(pending_note = NULLIF\(trim\(p_note\), ''''\),)';
  c_set_bom  CONSTANT TEXT := '\1
         pending_sets = p_sets,';
  c_fim_mau  CONSTANT TEXT := '(pending_at = NOW\(\)\s+WHERE id = p_match_id;)';
  c_fim_bom  CONSTANT TEXT := '\1

  -- #485: aviso no sino aos admins do clube do torneio — um por admin e
  -- por jogo enquanto não for lido (um segundo pedido substitui o primeiro).
  INSERT INTO notifications (user_id, kind, actor_id, data)
  SELECT DISTINCT mb.user_id, ''tournament_correction_requested'', auth.uid(),
         jsonb_build_object(
           ''tournament_id'', t.id, ''tournament_slug'', t.slug, ''tournament_name'', t.name,
           ''category_code'', c.code, ''match_id'', m.id,
           ''requester_name'', (SELECT name FROM profiles WHERE id = auth.uid()))
    FROM tournament_categories c
    JOIN tournaments t ON t.id = c.tournament_id
    JOIN memberships mb ON mb.organization_id = t.organization_id AND mb.is_admin
   WHERE c.id = m.category_id
     AND mb.user_id IS DISTINCT FROM auth.uid()
     AND NOT EXISTS (SELECT 1 FROM notifications n
                      WHERE n.user_id = mb.user_id AND n.kind = ''tournament_correction_requested''
                        AND n.read_at IS NULL AND n.data->>''match_id'' = m.id::text);';
  v_old  REGPROCEDURE := to_regprocedure('public.request_match_correction(uuid, integer, integer, text)');
  v_def  TEXT;
BEGIN
  IF v_old IS NULL THEN
    RAISE NOTICE 'request_match_correction: já tinha p_sets — já estava.';
    RETURN;
  END IF;
  v_def := pg_get_functiondef(v_old);
  IF (SELECT count(*) FROM regexp_matches(v_def, c_head_mau, 'g')) <> 1
     OR (SELECT count(*) FROM regexp_matches(v_def, c_decl_mau, 'g')) <> 1
     OR (SELECT count(*) FROM regexp_matches(v_def, c_val_mau, 'g')) <> 1
     OR (SELECT count(*) FROM regexp_matches(v_def, c_set_mau, 'g')) <> 1
     OR (SELECT count(*) FROM regexp_matches(v_def, c_fim_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'request_match_correction mudou: algum fragmento não aparece exatamente uma vez. Ler o corpo vivo.';
  END IF;
  v_def := regexp_replace(v_def, c_head_mau, c_head_bom);
  v_def := regexp_replace(v_def, c_decl_mau, c_decl_bom);
  v_def := regexp_replace(v_def, c_val_mau, c_val_bom);
  v_def := regexp_replace(v_def, c_set_mau, c_set_bom);
  v_def := regexp_replace(v_def, c_fim_mau, c_fim_bom);
  -- Assinatura nova: a antiga sai na mesma transação (senão ficavam duas).
  EXECUTE 'DROP FUNCTION public.request_match_correction(uuid, integer, integer, text)';
  EXECUTE v_def;
  RAISE NOTICE 'request_match_correction: guarda os sets, valida o resultado e avisa os admins.';
END $$;

REVOKE ALL ON FUNCTION public.request_match_correction(UUID, INTEGER, INTEGER, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_match_correction(UUID, INTEGER, INTEGER, TEXT, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.request_match_correction(UUID, INTEGER, INTEGER, TEXT, JSONB) TO authenticated;

-- ── 2. Responder: passa os sets, limpa-os, avisos lidos ─────────────────
DO $$
DECLARE
  c_save_mau  CONSTANT TEXT := '(PERFORM save_match_result\(p_match_id, m\.pending_score_a, m\.pending_score_b, )NULL\)';
  c_save_bom  CONSTANT TEXT := '\1m.pending_sets)';
  c_limpa_mau CONSTANT TEXT := 'pending_note = NULL, pending_at = NULL';
  c_limpa_bom CONSTANT TEXT := 'pending_note = NULL, pending_at = NULL, pending_sets = NULL';
  c_lido_mau  CONSTANT TEXT := '(RAISE EXCEPTION ''Não há nenhum pedido de correção neste jogo'';\s+END IF;)';
  c_lido_bom  CONSTANT TEXT := '\1

  -- #485: respondido o pedido, o aviso desse jogo fica lido para todos os
  -- admins (quem respondeu e os outros).
  UPDATE notifications
     SET read_at = NOW()
   WHERE kind = ''tournament_correction_requested'' AND read_at IS NULL
     AND data->>''match_id'' = p_match_id::text;';
  v_sig CONSTANT TEXT := 'public.resolve_match_correction(uuid, boolean)';
  v_def TEXT;
BEGIN
  v_def := pg_get_functiondef(v_sig::regprocedure);
  IF position('m.pending_sets' IN v_def) > 0 THEN
    RAISE NOTICE 'resolve_match_correction: já passava os sets — já estava.';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_save_mau, 'g')) <> 1
     OR (SELECT count(*) FROM regexp_matches(v_def, c_limpa_mau, 'g')) <> 2
     OR (SELECT count(*) FROM regexp_matches(v_def, c_lido_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'resolve_match_correction mudou: algum fragmento não aparece o número esperado de vezes. Ler o corpo vivo.';
  END IF;
  v_def := regexp_replace(v_def, c_save_mau, c_save_bom);
  v_def := regexp_replace(v_def, c_limpa_mau, c_limpa_bom, 'g');
  v_def := regexp_replace(v_def, c_lido_mau, c_lido_bom);
  EXECUTE v_def;
  RAISE NOTICE 'resolve_match_correction: aceitar grava os sets; os avisos ficam lidos.';
END $$;

REVOKE ALL ON FUNCTION public.resolve_match_correction(UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_match_correction(UUID, BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION public.resolve_match_correction(UUID, BOOLEAN) TO authenticated;

-- ── 3. «Correção pedida» no jogo ────────────────────────────────────────
DO $$
DECLARE
  c_col_mau CONSTANT TEXT := '(m\.winner_entry_id)(\s+FROM)';
  c_col_bom CONSTANT TEXT := '\1,
    (m.pending_by IS NOT NULL) AS correction_pending\2';
  v_def  TEXT;
  v_opts TEXT[];
BEGIN
  v_def := pg_get_viewdef('public.tournament_public_matches'::regclass);
  IF position('correction_pending' IN v_def) > 0 THEN
    RAISE NOTICE 'tournament_public_matches: já tinha correction_pending.';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_col_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'tournament_public_matches mudou: a última coluna não é a esperada. Ler a vista viva.';
  END IF;
  SELECT reloptions INTO v_opts FROM pg_class WHERE oid = 'public.tournament_public_matches'::regclass;
  EXECUTE format('CREATE OR REPLACE VIEW public.tournament_public_matches%s AS %s',
    CASE WHEN v_opts IS NULL THEN '' ELSE ' WITH (' || array_to_string(v_opts, ', ') || ')' END,
    regexp_replace(v_def, c_col_mau, c_col_bom));
  RAISE NOTICE 'tournament_public_matches: correction_pending acrescentado.';
END $$;

COMMIT;
