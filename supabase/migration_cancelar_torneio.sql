-- ═════════════════════════════════════════════════════════════════════════
-- Cancelar o torneio
--
-- PORQUÊ. UX, SPEC 2026-09-26-acoes-do-evento (assunto 1), com a decisão do
-- Francisco (via PO): «eu quero poder cancelar sempre, mesmo com inscritos ou
-- não». Num torneio cancelado não se joga e ninguém ganha pontos; os
-- inscritos são avisados; aparece no que já passou como «Cancelado». Sem
-- inscritos, o ecrã continua a chamar o delete_tournament. Ecrã: Dev 1.
--
-- O QUE FAZ
--   1. Estado novo 'cancelado' em tournaments (+ cancelled_at, cancelled_by).
--   2. cancel_tournament(p_tournament_id) → jsonb {notified}. Só admin do
--      clube ('not_allowed'). Qualquer estado antes de 'terminado'
--      ('already_finished'); cancelar outra vez não faz nada. Uma categoria
--      já terminada com pontos dados recusa ('category_finished') — tirar
--      pontos espera pelo Ruben Bernardo. As categorias em inscrições
--      fecham. Avisa quem continua inscrito (menos quem desistiu e quem
--      cancela): 'tournament_cancelled' {tournament_id, tournament_slug,
--      tournament_name}; os avisos antigos por ler deste torneio ficam lidos.
--   3. Depois de cancelado (trocas no corpo VIVO, 1 vez cada; «já estava»):
--      · list_open_tournaments: não aparece nas inscrições abertas;
--      · tournament_signup: não aceita inscrições;
--      · list_my_tournament_invites: os convites deixam de aparecer;
--      · tournament_matches_result_guard: não se grava resultado nem falta
--        ('tournament_cancelled');
--      · finish_category: não se termina categoria (os pontos só se dão aí).
--   4. delete_tournament («Eliminar o torneio»): apaga em qualquer estado
--      menos terminado/cancelado ('already_finished'), desde que não haja
--      inscrição nenhuma, nem desistida ('has_entries' → o ecrã passa a
--      «Cancelar o torneio»).
--   Os jogos com resultado ficam como estão. O nível só se dá ao terminar
--   uma categoria, por isso um torneio cancelado a meio não deixa rasto.
--   As vistas públicas continuam a mostrá-lo (com status 'cancelado').
--
-- Dev 3, 1 out 2026 · ecrã: Dev 1
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. O estado ─────────────────────────────────────────────────────────
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES profiles(id) ON DELETE SET NULL;
DO $$
DECLARE v_name TEXT;
BEGIN
  SELECT conname INTO v_name FROM pg_constraint
   WHERE conrelid = 'public.tournaments'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%rascunho%';
  IF v_name IS NOT NULL AND pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = v_name AND conrelid = 'public.tournaments'::regclass)) NOT LIKE '%cancelado%' THEN
    EXECUTE format('ALTER TABLE tournaments DROP CONSTRAINT %I', v_name);
    ALTER TABLE tournaments ADD CONSTRAINT tournaments_status_check
      CHECK (status IN ('rascunho', 'inscricoes', 'fechado', 'sorteado', 'a_decorrer', 'terminado', 'cancelado'));
  END IF;
END $$;

-- ── 2. Cancelar ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_tournament(p_tournament_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_t        tournaments%ROWTYPE;
  v_data     JSONB;
  v_notified INTEGER;
BEGIN
  SELECT * INTO v_t FROM tournaments WHERE id = p_tournament_id FOR UPDATE;
  IF v_t.id IS NULL OR auth.uid() IS NULL OR NOT is_tournament_admin(p_tournament_id) THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  IF v_t.status = 'cancelado' THEN RETURN jsonb_build_object('notified', 0); END IF;
  IF v_t.status = 'terminado' THEN RAISE EXCEPTION 'already_finished'; END IF;
  -- Tirar pontos já dados espera pela decisão do Ruben.
  IF EXISTS (SELECT 1 FROM tournament_categories c
              WHERE c.tournament_id = p_tournament_id AND c.status = 'terminada'
                AND EXISTS (SELECT 1 FROM tournament_player_stats s
                             WHERE s.category_id = c.id AND s.rating_delta IS NOT NULL)) THEN
    RAISE EXCEPTION 'category_finished';
  END IF;

  UPDATE tournaments SET status = 'cancelado', cancelled_at = NOW(), cancelled_by = auth.uid()
   WHERE id = p_tournament_id;
  UPDATE tournament_categories SET status = 'fechada'
   WHERE tournament_id = p_tournament_id AND status = 'inscricoes';

  UPDATE notifications SET read_at = NOW()
   WHERE read_at IS NULL AND data->>'tournament_id' = p_tournament_id::text;

  v_data := jsonb_build_object('tournament_id', v_t.id, 'tournament_slug', v_t.slug, 'tournament_name', v_t.name);
  INSERT INTO notifications (user_id, kind, actor_id, data)
  SELECT DISTINCT u.uid, 'tournament_cancelled', auth.uid(), v_data
    FROM tournament_entries e
    JOIN tournament_categories c ON c.id = e.category_id,
         LATERAL (VALUES (e.player1_id),
                         (CASE WHEN e.partner_accepted_at IS NOT NULL THEN e.player2_id END)) AS u(uid)
   WHERE c.tournament_id = p_tournament_id AND e.status <> 'desistiu'
     AND u.uid IS NOT NULL AND u.uid <> auth.uid();
  GET DIAGNOSTICS v_notified = ROW_COUNT;

  RETURN jsonb_build_object('notified', v_notified);
END;
$function$;
REVOKE ALL ON FUNCTION public.cancel_tournament(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_tournament(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.cancel_tournament(UUID) TO authenticated;

-- ── 3. Depois de cancelado ──────────────────────────────────────────────
DO $$
DECLARE
  f     RECORD;
  v_def TEXT;
BEGIN
  FOR f IN SELECT * FROM (VALUES
      ('public.list_open_tournaments(integer, uuid, boolean)',
       't\.status NOT IN \(''rascunho'', ''terminado''\)',
       't.status NOT IN (''rascunho'', ''terminado'', ''cancelado'')',
       '''terminado'', ''cancelado'''),
      ('public.tournament_signup(uuid, uuid, text, text, text)',
       'v_tournament\.status IN \(''rascunho'', ''terminado''\)',
       'v_tournament.status IN (''rascunho'', ''terminado'', ''cancelado'')',
       '''terminado'', ''cancelado'''),
      ('public.list_my_tournament_invites()',
       '(WHERE e\.player2_id = auth\.uid\(\) AND e\.status = ''convite'')',
       '\1
     AND NOT EXISTS (SELECT 1 FROM tournament_categories cc JOIN tournaments tc ON tc.id = cc.tournament_id
                      WHERE cc.id = e.category_id AND tc.status = ''cancelado'')',
       'tc.status = ''cancelado'''),
      ('public.tournament_matches_result_guard()',
       '(WHERE c\.id = NEW\.category_id;)',
       '\1
  -- Torneio cancelado: não se joga (1 out).
  IF EXISTS (SELECT 1 FROM tournaments WHERE id = v_tournament AND status = ''cancelado'') THEN
    RAISE EXCEPTION ''tournament_cancelled'';
  END IF;',
       'tournament_cancelled'),
      -- Eliminar (UX, 1 out, pelo Dev 1): sem inscrições — nem desistidas,
      -- que são história de alguém — apaga-se em qualquer estado menos
      -- terminado ou cancelado. Com inscrições, o ecrã passa a «Cancelar».
      ('public.delete_tournament(uuid)',
       'IF EXISTS \(SELECT 1 FROM tournaments WHERE id = p_tournament_id AND status <> ''rascunho''\) THEN\s+RAISE EXCEPTION ''Só se apaga um torneio em rascunho'';',
       'IF EXISTS (SELECT 1 FROM tournaments WHERE id = p_tournament_id AND status IN (''terminado'', ''cancelado'')) THEN
    RAISE EXCEPTION ''already_finished'';',
       'already_finished'),
      ('public.delete_tournament(uuid)',
       'RAISE EXCEPTION ''Este torneio já tem inscrições: não se apaga'';',
       'RAISE EXCEPTION ''has_entries'';',
       'has_entries'),
      ('public.finish_category(uuid, uuid, uuid, uuid)',
       '(v_tournament := tournament_of_category\(p_category_id\);)',
       '\1
  -- Torneio cancelado: ninguém ganha pontos (1 out).
  IF EXISTS (SELECT 1 FROM tournaments WHERE id = v_tournament AND status = ''cancelado'') THEN
    RAISE EXCEPTION ''tournament_cancelled'';
  END IF;',
       'tournament_cancelled')
    ) AS t(sig, mau, bom, marca) LOOP
    v_def := pg_get_functiondef(f.sig::regprocedure);
    IF v_def LIKE '%' || f.marca || '%' THEN
      RAISE NOTICE '%: já estava', f.sig;
      CONTINUE;
    END IF;
    IF (SELECT count(*) FROM regexp_matches(v_def, f.mau, 'g')) <> 1 THEN
      RAISE EXCEPTION '%: o pedaço a trocar não aparece 1 vez. Parar e ler.', f.sig;
    END IF;
    EXECUTE regexp_replace(v_def, f.mau, f.bom);
  END LOOP;
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT has_function_privilege('anon', 'public.cancel_tournament(uuid)', 'EXECUTE');  -- false
--   SELECT count(*) FROM pg_proc WHERE proname IN ('tournament_matches_result_guard', 'finish_category')
--      AND pg_get_functiondef(oid) LIKE '%tournament_cancelled%';  -- 2
