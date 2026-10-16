-- ═════════════════════════════════════════════════════════════════════════
-- Torneio: «Voltar a rascunho» não apaga um sorteio feito
--
-- PORQUÊ. SI, 14 out, ao correr a migration_torneio_voltar_a_rascunho.sql:
-- vindo de 'fechado', o torneio pode já ter categorias sorteadas. O voltar
-- a rascunho apagava as inscrições, e com elas os jogos do sorteio (por
-- cascata), e só repunha as categorias 'fechada'.
--
-- O QUE FAZ. set_tournament_status(…, 'rascunho') com alguma categoria já
-- sorteada (sorteada, a_decorrer ou terminada) recusa com
-- 'category_already_drawn', com o código da categoria no hint — o mesmo erro
-- da hora da categoria. Sem sorteio, igual a hoje. Corpo VIVO, 1 inserção
-- encostada à linha da migração anterior («já estava»).
--
-- ORDEM. Logo depois de migration_torneio_voltar_a_rascunho.sql.
--
-- Dev 3, 14 out 2026 · ecrã: Dev 1 (mostra o erro como na hora da categoria)
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  c_frag CONSTANT TEXT := '  -- como no mix (Francisco, 10 out): avisa e tira as inscrições.';
  c_novo CONSTANT TEXT := E'\n'
    || E'  -- Com sorteio feito não volta a rascunho: apagava os jogos (SI, 14 out).\n'
    || E'  IF p_status = ''rascunho'' AND v_current <> ''rascunho'' THEN\n'
    || E'    PERFORM 1 FROM tournament_categories\n'
    || E'      WHERE tournament_id = p_tournament_id AND status IN (''sorteada'', ''a_decorrer'', ''terminada'');\n'
    || E'    IF FOUND THEN\n'
    || E'      RAISE EXCEPTION ''category_already_drawn'' USING HINT = (\n'
    || E'        SELECT code FROM tournament_categories\n'
    || E'         WHERE tournament_id = p_tournament_id AND status IN (''sorteada'', ''a_decorrer'', ''terminada'')\n'
    || E'         ORDER BY position, code LIMIT 1);\n'
    || E'    END IF;\n'
    || E'  END IF;';
  v_def TEXT := replace(pg_get_functiondef('public.set_tournament_status(uuid,text)'::regprocedure), E'\r', '');
BEGIN
  IF position('Com sorteio feito não volta a rascunho' IN v_def) > 0 THEN
    RAISE NOTICE 'set_tournament_status: já estava';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, c_frag, ''))) / length(c_frag) <> 1 THEN
    RAISE EXCEPTION 'set_tournament_status: o pedaço a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE replace(v_def, c_frag, c_frag || c_novo);
END $$;

COMMIT;

-- Verificar depois de correr (true):
--   SELECT pg_get_functiondef('public.set_tournament_status(uuid,text)'::regprocedure) LIKE '%Com sorteio feito não volta a rascunho%';
