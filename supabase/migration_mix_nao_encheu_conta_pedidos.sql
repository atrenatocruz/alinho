-- ═════════════════════════════════════════════════════════════════════════
-- Mix que não encheu: o aviso a quem organiza conta os pedidos
--
-- PORQUÊ. SPEC 2026-10-02-mix-aprovar-quem-entra, ponto 10 (Francisco, 2
-- out), deixado para o envio seguinte ao «aprovar quem entra»; vai na
-- sexta com ele (PO, 6 out). Texto do ecrã (Dev 2), com pedidos: «O mix não
-- encheu. N pessoas pediram para entrar: aceita-as para fechar o mix, tira
-- campos ou cancela. Se nada mudar, cancela-se hoje à noite.»
--
-- O QUE FAZ. No process_unfilled_mixes (corpo VIVO, 1 troca; «já estava»),
-- o aviso 'mix_not_filled' passa a levar 'requests': quantos pedidos
-- ('requested') estão por decidir nesse mix. 0 = o texto de sempre. Os
-- pedidos não caducam: ficam no rascunho e quem organiza pode aceitá-los
-- antes de voltar a publicar.
--
-- Ordem: depois da migration_mix_aprovar_quem_entra.sql (sem ela não há
-- pedidos e conta sempre 0, sem partir nada) e da migration_mix_nao_encheu.
-- Dev 3, 6 out 2026 · ecrã: Dev 2
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  c_mau CONSTANT TEXT := '(''mix_not_filled'', g\.id,[[:space:]]+jsonb_build_object\(''game_title'', g\.title, ''game_date'', g\.date)\)';
  c_bom CONSTANT TEXT := '\1,
             ''requests'', (SELECT count(*) FROM participants rq
                            WHERE rq.game_id = g.id AND rq.status = ''requested''))';
  v_def TEXT := pg_get_functiondef('public.process_unfilled_mixes()'::regprocedure);
BEGIN
  IF v_def LIKE '%''requests''%' THEN
    RAISE NOTICE 'process_unfilled_mixes: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'process_unfilled_mixes: o pedaço a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE regexp_replace(v_def, c_mau, c_bom);
END $$;

REVOKE EXECUTE ON FUNCTION public.process_unfilled_mixes() FROM PUBLIC, anon, authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_functiondef('public.process_unfilled_mixes()'::regprocedure) LIKE '%''requests''%';  -- true
