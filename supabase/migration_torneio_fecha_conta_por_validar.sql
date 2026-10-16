-- ═════════════════════════════════════════════════════════════════════════
-- Torneio: o aviso «as inscrições fecharam» conta também as por validar
--
-- PORQUÊ. Relatório do QA (visto pelo Bugs; PO, 12 out): o aviso «as
-- inscrições fecharam com N duplas» dizia 0 quando as duplas estavam todas
-- por validar (pagamento por confirmar). O entry_count só conta as validadas
-- (a mesma conta da página).
--
-- O QUE FAZ. O aviso 'tournament_entries_closed' ganha pending_count (as
-- duplas 'por_validar'); o entry_count fica igual (validadas). O ecrã diz as
-- duas: «N duplas, M por validar». Corpo VIVO do close_due_registrations,
-- 1 troca («já estava»); CREATE OR REPLACE, as permissões ficam.
--
-- Dev 3, 12 out 2026 · texto do sino: Dev 1 / Bugs
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  c_mau CONSTANT TEXT := $a$WHERE c.tournament_id = t.id AND e.status IN ('validada', 'selecionada')))$a$;
  v_def TEXT := pg_get_functiondef('public.close_due_registrations()'::regprocedure);
BEGIN
  IF v_def LIKE '%pending_count%' THEN
    RAISE NOTICE 'close_due_registrations: já estava';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, c_mau, ''))) / length(c_mau) <> 1 THEN
    RAISE EXCEPTION 'close_due_registrations: o pedaço a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE replace(v_def, c_mau,
       $b$WHERE c.tournament_id = t.id AND e.status IN ('validada', 'selecionada')),$b$ || E'\n'
    || $b$             -- E as que ainda esperam pela confirmação do pagamento (QA, 12 out).$b$ || E'\n'
    || $b$             'pending_count', (SELECT count(*) FROM tournament_entries e$b$ || E'\n'
    || $b$                                 JOIN tournament_categories c ON c.id = e.category_id$b$ || E'\n'
    || $b$                                WHERE c.tournament_id = t.id AND e.status = 'por_validar'))$b$);
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_functiondef('public.close_due_registrations()'::regprocedure) LIKE '%pending_count%';  -- true
