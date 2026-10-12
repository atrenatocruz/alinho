-- ═════════════════════════════════════════════════════════════════════════
-- Torneio: a página diz quantas inscrições o «Cancelar torneio» vai avisar
--
-- PORQUÊ. Dev 1 + UX (12 out, escolha B): a confirmação do cancelar mostra
-- o número certo («As 87 inscrições recebem um aviso»), em vez de somar
-- validadas e por validar no ecrã (faltavam convites, sem dupla e suplentes).
--
-- O QUE FAZ. tournament_page_json ganha tournament.notify_count: as
-- inscrições que o cancel_tournament avisa — todas as que não desistiram,
-- com ou sem dupla, suplentes incluídas. Corpo VIVO, 1 troca literal («já
-- estava»); devolve jsonb na mesma: CREATE OR REPLACE, as permissões ficam.
--
-- ORDEM. Depois de migration_torneio_pagina_por_validar.sql (a troca
-- encosta-se ao pending_count que essa acrescenta).
--
-- Dev 3, 12 out 2026 · ecrã: Dev 1
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  c_tor CONSTANT TEXT := $a$WHERE c.tournament_id = t.id AND e.status = 'por_validar') AS pending_count,$a$;
  v_def TEXT := pg_get_functiondef('public.tournament_page_json(uuid,boolean)'::regprocedure);
BEGIN
  IF v_def LIKE '%notify_count%' THEN
    RAISE NOTICE 'tournament_page_json: já estava';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, c_tor, ''))) / length(c_tor) <> 1 THEN
    RAISE EXCEPTION 'tournament_page_json: o pedaço a trocar não aparece 1 vez (correu o migration_torneio_pagina_por_validar.sql?). Parar e ler.';
  END IF;
  v_def := replace(v_def, c_tor, c_tor
    || $b$ (SELECT count(*) FROM tournament_entries e JOIN tournament_categories c ON c.id = e.category_id WHERE c.tournament_id = t.id AND e.status <> 'desistiu') AS notify_count,$b$);
  EXECUTE v_def;
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_functiondef('public.tournament_page_json(uuid,boolean)'::regprocedure) LIKE '%notify_count%';  -- true
