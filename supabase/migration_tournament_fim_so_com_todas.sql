-- ═════════════════════════════════════════════════════════════════════════
-- Torneio: só termina quando todas as categorias com gente terminaram
--
-- PORQUÊ. QA, 30 set (GRAVE, antes do Smash Cup): terminar a M4 terminou o
-- torneio inteiro com a F4 e a MX4 ainda em inscrições. A regra do #539
-- («uma categoria sem ninguém inscrito não impede o torneio de terminar»)
-- só contava como «com gente» as categorias com duplas 'validada' ou
-- 'selecionada' — 'por_validar', 'sem_parceiro', 'convite' e 'suplente'
-- contavam como categoria vazia. Em produção o corpo é o mesmo; hoje não há
-- nenhum torneio fechado a meio (SELECT, 30 set).
--
-- O QUE FAZ. Em finish_category (corpo VIVO, 1 troca; «já estava»): uma
-- categoria por terminar impede o torneio de terminar se tiver alguém
-- inscrito em qualquer estado menos 'desistiu'. Uma categoria sem ninguém
-- (ou só com desistências) continua a não impedir (#539).
--
-- Dev 3, 30 set 2026 · pedido do QA e do PO
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  c_mau CONSTANT TEXT := 'e\.status IN \(''validada'', ''selecionada''\)';
  c_bom CONSTANT TEXT := 'e.status <> ''desistiu''';
  v_def TEXT := pg_get_functiondef('public.finish_category(uuid, uuid, uuid, uuid)'::regprocedure);
BEGIN
  IF v_def LIKE '%e.status <> ''desistiu''%' THEN
    RAISE NOTICE 'finish_category: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'finish_category: a regra do #539 não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE regexp_replace(v_def, c_mau, c_bom);
END $$;

REVOKE ALL ON FUNCTION public.finish_category(UUID, UUID, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finish_category(UUID, UUID, UUID, UUID) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_functiondef('public.finish_category(uuid,uuid,uuid,uuid)'::regprocedure) LIKE '%e.status <> ''desistiu''%';  -- true
--   SELECT count(DISTINCT t.id) FROM tournaments t JOIN tournament_categories c ON c.tournament_id = t.id
--    WHERE t.status = 'terminado' AND c.status <> 'terminada'
--      AND EXISTS (SELECT 1 FROM tournament_entries e WHERE e.category_id = c.id AND e.status <> 'desistiu');  -- 0
