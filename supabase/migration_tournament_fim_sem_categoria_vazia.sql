-- ═════════════════════════════════════════════════════════════════════════
-- #539 — Uma categoria sem inscritos já não deixa o torneio aberto para
-- sempre.
--
-- O que se passava (Dev 1, 24 set): o torneio só passa a «terminado» quando
-- TODAS as categorias estão fechadas (finish_category). Uma categoria que
-- nunca é sorteada — por exemplo, porque ficou sem inscritos — nunca fecha,
-- e o torneio ficava «a decorrer» para sempre. No Smash Cup há 7
-- categorias, algumas com poucas vagas.
--
-- O que faz: no fim da finish_category, a condição «não há categoria por
-- terminar» passa a ignorar as categorias sem ninguém inscrito (sem
-- nenhuma inscrição que não tenha desistido). Nada se apaga e nada muda
-- numa categoria com inscrições: essa continua a ter de ser fechada.
-- Uma inscrição num torneio terminado já é recusada
-- (migration_fix_inscricoes_por_categoria.sql), por isso a categoria vazia
-- não recebe ninguém depois.
--
-- NÃO acerta torneios que já estejam presos hoje: o estado «terminado» do
-- torneio entra nas contas do ranking (#440, em pausa por decisão do
-- Francisco). Para ver se há algum, só leitura:
--   SELECT t.id, t.name, t.status FROM tournaments t
--    WHERE t.status <> 'terminado'
--      AND EXISTS (SELECT 1 FROM tournament_categories c WHERE c.tournament_id = t.id AND c.status = 'terminada')
--      AND NOT EXISTS (SELECT 1 FROM tournament_categories c
--                       WHERE c.tournament_id = t.id AND c.status <> 'terminada'
--                         AND EXISTS (SELECT 1 FROM tournament_entries e
--                                      WHERE e.category_id = c.id AND e.status <> 'desistiu'));
--
-- Parte do corpo vivo (há três ficheiros com a finish_category): troca só
-- o fragmento, recusa se não o encontrar exatamente uma vez, e diz «já
-- estava» se repetido. Mesma assinatura: as permissões ficam; repõem-se
-- explicitamente na mesma (REVOKE de PUBLIC e anon, GRANT a authenticated).
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  c_fim_mau CONSTANT TEXT :=
    '(AND NOT EXISTS \(SELECT 1 FROM tournament_categories c\s+WHERE c\.tournament_id = v_tournament AND c\.status <> ''terminada'')(\);)';
  c_fim_bom CONSTANT TEXT := '\1
                        -- #539: uma categoria sem ninguém inscrito não
                        -- impede o torneio de terminar.
                        AND EXISTS (SELECT 1 FROM tournament_entries e
                                     WHERE e.category_id = c.id AND e.status <> ''desistiu'')\2';
  f     RECORD;
  v_def TEXT;
  v_n   INTEGER := 0;
BEGIN
  FOR f IN SELECT p.oid, pg_get_function_identity_arguments(p.oid) AS args
             FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'finish_category' LOOP
    v_n := v_n + 1;
    v_def := pg_get_functiondef(f.oid);
    IF position('#539' IN v_def) > 0 THEN
      RAISE NOTICE 'finish_category(%): a regra do #539 já estava.', f.args;
      CONTINUE;
    END IF;
    IF (SELECT count(*) FROM regexp_matches(v_def, c_fim_mau, 'g')) <> 1 THEN
      RAISE EXCEPTION 'finish_category(%) mudou: o fim do torneio não aparece exatamente uma vez. Ler o corpo vivo.', f.args;
    END IF;
    EXECUTE regexp_replace(v_def, c_fim_mau, c_fim_bom);
    IF position('#539' IN pg_get_functiondef(f.oid)) = 0 THEN
      RAISE EXCEPTION 'finish_category(%): a regra do #539 não ficou. Parar e ler.', f.args;
    END IF;
    RAISE NOTICE 'finish_category(%): categorias sem inscritos já não impedem o fim do torneio.', f.args;
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
