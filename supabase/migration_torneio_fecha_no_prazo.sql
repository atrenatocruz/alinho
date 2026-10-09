-- ═════════════════════════════════════════════════════════════════════════
-- Torneio: as inscrições fecham sozinhas quando o prazo acaba
--
-- PORQUÊ. Francisco aprovou o plano a 6 out (pelo Dev 1); o PO deu
-- prioridade para o main de sexta. Ecrã e textos: Dev 1.
--
-- O QUE FAZ
--   1. close_due_registrations(), a cada minuto (pg_cron, como o
--      open_due_registrations): cada torneio em 'inscricoes' com
--      entries_deadline <= agora passa a 'fechado', exatamente o que o
--      set_tournament_status(…, 'fechado') faz hoje (só o estado do torneio;
--      as categorias e as inscrições pendentes ficam como estão, como no
--      botão).
--   2. Aviso a cada admin do clube do torneio: 'tournament_entries_closed'
--      {tournament_id, tournament_slug, tournament_name, entry_count}; o
--      entry_count é o número de duplas que a página mostra (validadas e
--      selecionadas, sem desistências; UX, 6 out). Sai uma vez por
--      fecho (cada torneio fecha uma vez; só volta a fechar se alguém o
--      reabrir com um prazo novo). Só admins: os marcadores não recebem.
--   3. Reabrir com o prazo já passado é recusado no set_tournament_status
--      ('deadline_passed'; o ecrã diz «Muda primeiro o prazo»). Sem isto, o
--      cron voltava a fechar no minuto seguinte. Troca no corpo VIVO, 1 vez;
--      «já estava».
--
-- ATENÇÃO na primeira corrida em produção (lido a 6 out): há 1 torneio em
-- inscrições com o prazo já passado, o «Torneio de teste» (prazo 26 set).
-- Fecha no primeiro minuto e os admins desse clube recebem o aviso.
--
-- Dev 3, 6 out 2026 · ecrã: Dev 1
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1 e 2. Fechar no prazo, com aviso ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.close_due_registrations()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  t   RECORD;
  v_n INTEGER := 0;
BEGIN
  FOR t IN
    UPDATE tournaments SET status = 'fechado'
     WHERE status = 'inscricoes'
       AND entries_deadline IS NOT NULL AND entries_deadline <= NOW()
    RETURNING id, slug, name, organization_id
  LOOP
    INSERT INTO notifications (user_id, kind, data)
    SELECT m.user_id, 'tournament_entries_closed',
           jsonb_build_object('tournament_id', t.id, 'tournament_slug', t.slug, 'tournament_name', t.name,
             -- As duplas que a página mostra (a mesma conta da tournament_public).
             'entry_count', (SELECT count(*) FROM tournament_entries e
                               JOIN tournament_categories c ON c.id = e.category_id
                              WHERE c.tournament_id = t.id AND e.status IN ('validada', 'selecionada')))
      FROM memberships m
     WHERE m.organization_id = t.organization_id AND m.is_admin;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$function$;
-- Interna: só o pg_cron a chama.
REVOKE EXECUTE ON FUNCTION public.close_due_registrations() FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'close-due-registrations';
SELECT cron.schedule('close-due-registrations', '* * * * *', 'SELECT public.close_due_registrations()');

-- ── 3. Reabrir só com um prazo novo ─────────────────────────────────────
DO $$
DECLARE
  c_mau CONSTANT TEXT := '(  UPDATE tournaments SET status = p_status WHERE id = p_tournament_id;)';
  c_bom CONSTANT TEXT := '  -- Reabrir com o prazo já passado: o fecho automático voltava a fechar
  -- no minuto seguinte (6 out). Primeiro muda-se o prazo.
  IF p_status = ''inscricoes'' AND EXISTS (
       SELECT 1 FROM tournaments WHERE id = p_tournament_id
          AND entries_deadline IS NOT NULL AND entries_deadline <= NOW()) THEN
    RAISE EXCEPTION ''deadline_passed'';
  END IF;

\1';
  v_def TEXT := pg_get_functiondef('public.set_tournament_status(uuid, text)'::regprocedure);
BEGIN
  IF v_def LIKE '%deadline_passed%' THEN
    RAISE NOTICE 'set_tournament_status: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'set_tournament_status: o pedaço a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE regexp_replace(v_def, c_mau, c_bom);
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT schedule, command FROM cron.job WHERE jobname = 'close-due-registrations';  -- * * * * *
--   SELECT has_function_privilege('authenticated', 'public.close_due_registrations()', 'EXECUTE');  -- false
--   SELECT pg_get_functiondef('public.set_tournament_status(uuid,text)'::regprocedure) LIKE '%deadline_passed%';  -- true
