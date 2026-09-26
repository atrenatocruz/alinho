-- ═════════════════════════════════════════════════════════════════════════
-- #539 (ponta solta) — Para o torneio terminar, só contam as categorias com
-- inscrições CONFIRMADAS (validada ou selecionada). Decisão do PO, 26 set
-- («a regra do automático»), depois de o QA a encontrar no TESTE.
--
-- O que se passava: a 1.ª correção do #539 (migration_tournament_fim_sem
-- _categoria_vazia.sql) ignorava só as categorias sem nenhuma inscrição
-- viva. Uma categoria que nunca joga mas tem uma inscrição por confirmar
-- (sem parceiro, convite, por validar ou suplente) continuava a prender o
-- torneio para sempre. O TESTE está assim.
--
-- O que faz, na finish_category (todas as versões, corpo vivo):
--   · se a 1.ª correção do #539 já lá está: troca «e.status <> 'desistiu'»
--     por «e.status IN ('validada', 'selecionada')»;
--   · se ainda não correu: acrescenta já a condição nova (este ficheiro
--     substitui-a — não é preciso correr a outra);
--   · se já tiver a condição nova: «já estava».
-- Nada se apaga, e nenhuma categoria muda de estado. Um «Cancelar
-- categoria» para o organizador fica para depois de 13 out.
--
-- Não acerta torneios já presos (o estado do torneio entra no ranking, #440
-- em pausa): isso fica para decidir à parte.
--
-- Mesma assinatura: as permissões ficam; repõem-se explicitamente (REVOKE
-- de PUBLIC e anon, GRANT a authenticated).
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  -- Com a 1.ª correção do #539 já lá.
  c_v1_mau CONSTANT TEXT :=
    '(AND EXISTS \(SELECT 1 FROM tournament_entries e\s+WHERE e\.category_id = c\.id AND )e\.status <> ''desistiu''\)';
  c_v1_bom CONSTANT TEXT := '\1e.status IN (''validada'', ''selecionada''))';
  -- Sem a 1.ª correção: o fim do torneio como estava.
  c_v0_mau CONSTANT TEXT :=
    '(AND NOT EXISTS \(SELECT 1 FROM tournament_categories c\s+WHERE c\.tournament_id = v_tournament AND c\.status <> ''terminada'')(\);)';
  c_v0_bom CONSTANT TEXT := '\1
                        -- #539: só contam as categorias com inscrições
                        -- confirmadas (validada ou selecionada).
                        AND EXISTS (SELECT 1 FROM tournament_entries e
                                     WHERE e.category_id = c.id AND e.status IN (''validada'', ''selecionada''))\2';
  f     RECORD;
  v_def TEXT;
  v_n   INTEGER := 0;
BEGIN
  FOR f IN SELECT p.oid, pg_get_function_identity_arguments(p.oid) AS args
             FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'finish_category' LOOP
    v_n := v_n + 1;
    v_def := pg_get_functiondef(f.oid);
    IF v_def ~ 'e\.status IN \(''validada'', ''selecionada''\)' THEN
      RAISE NOTICE 'finish_category(%): já só contava as confirmadas.', f.args;
      CONTINUE;
    ELSIF (SELECT count(*) FROM regexp_matches(v_def, c_v1_mau, 'g')) = 1 THEN
      EXECUTE regexp_replace(v_def, c_v1_mau, c_v1_bom);
    ELSIF (SELECT count(*) FROM regexp_matches(v_def, c_v0_mau, 'g')) = 1 THEN
      EXECUTE regexp_replace(v_def, c_v0_mau, c_v0_bom);
    ELSE
      RAISE EXCEPTION 'finish_category(%) mudou: o fim do torneio não tem a forma esperada. Ler o corpo vivo.', f.args;
    END IF;
    IF pg_get_functiondef(f.oid) !~ 'e\.status IN \(''validada'', ''selecionada''\)' THEN
      RAISE EXCEPTION 'finish_category(%): a regra nova não ficou. Parar e ler.', f.args;
    END IF;
    RAISE NOTICE 'finish_category(%): só as categorias com inscrições confirmadas impedem o fim do torneio.', f.args;
  END LOOP;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'Não existe finish_category. Parar e ler.';
  END IF;
END $$;

DO $$
DECLARE f RECORD;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'finish_category' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
  END LOOP;
END $$;
