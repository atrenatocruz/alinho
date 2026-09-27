-- ═════════════════════════════════════════════════════════════════════════
-- Página do torneio: `waitlist_count` em cada categoria (Smash Cup)
--
-- PORQUÊ. Melhoria aprovada pelo Francisco (pedido do Dev 1, 27 set): o topo
-- do torneio passa a dizer «62 duplas» e, por baixo, «+38 suplentes».
-- Depois de fechar as inscrições, os suplentes têm status 'suplente' e não
-- entram no entry_count — faltava o número deles. O ecrã já soma
-- c.waitlist_count se vier; sem ele fica como hoje.
--
-- COMO. Mesmo método do taken_count (migration_tournaments_integridade.sql):
-- lê o corpo VIVO de cada tournament_page_json, junta o campo a seguir ao
-- entry_count da categoria, e recusa se não encontrar a âncora exatamente
-- uma vez. Diz «já estava» se já correu. Só leitura: não muda mais nada.
--
-- Dev 3, 27 set 2026 · ecrã: Dev 1
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  c_ancora CONSTANT TEXT :=
    '(WHERE e\.category_id = c\.id AND e\.status IN \(''validada'',\s*''selecionada''\)\) AS entry_count)';
  c_novo   CONSTANT TEXT :=
    E'\\1,\n               (SELECT count(*) FROM tournament_entries e\n                 WHERE e.category_id = c.id AND e.status = ''suplente'') AS waitlist_count';
  f      RECORD;
  v_n    INTEGER;
  v_novo TEXT;
  v_feitas INTEGER := 0;
BEGIN
  FOR f IN SELECT p.oid, pg_get_function_identity_arguments(p.oid) AS args, p.prosrc
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'tournament_page_json' LOOP
    v_feitas := v_feitas + 1;
    IF position('AS waitlist_count' IN f.prosrc) > 0 THEN
      RAISE NOTICE 'tournament_page_json(%): já estava', f.args;
      CONTINUE;
    END IF;
    SELECT count(*) INTO v_n FROM regexp_matches(f.prosrc, c_ancora, 'g');
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'tournament_page_json(%): esperava o entry_count da categoria 1 vez, encontrei %. Ler o corpo vivo.', f.args, v_n;
    END IF;
    v_novo := regexp_replace(pg_get_functiondef(f.oid), c_ancora, c_novo);
    EXECUTE v_novo;
    RAISE NOTICE 'tournament_page_json(%): waitlist_count junto', f.args;
  END LOOP;
  IF v_feitas = 0 THEN
    RAISE EXCEPTION 'Não existe tournament_page_json. Parar e ler.';
  END IF;
END $$;

COMMIT;

-- Verificar depois de correr (true em cada versão):
--   SELECT pg_get_function_identity_arguments(oid), prosrc LIKE '%AS waitlist_count%'
--     FROM pg_proc WHERE proname = 'tournament_page_json';
