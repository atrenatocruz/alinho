-- ═════════════════════════════════════════════════════════════════════════
-- FECHAR UMA CATEGORIA DEIXA DE REBENTAR QUANDO A FINAL TEVE RESULTADO
-- (Dev 3, 24 set 2026) — P0, apanhado pelos agentes do Renato.
--
-- Pode-se correr outra vez sem estragar: se já estiver corrigido, não faz
-- nada.
--
-- ─────────────────────────────────────────────────────────────────────────
-- O ERRO
-- ─────────────────────────────────────────────────────────────────────────
-- `finish_category` → `apply_tournament_elo` rebenta com
--     21000 «UPDATE requires a WHERE clause»
-- sempre que a final teve um resultado normal. Sem isto não há pódio.
--
-- A causa: `UPDATE _elo_torneio SET delta = delta + bonus;` — um UPDATE sem
-- WHERE, de propósito (mexe em todas as linhas de uma tabela temporária).
-- O Supabase tem o `pg_safeupdate` ligado para os pedidos que chegam pela
-- app, e ele recusa QUALQUER UPDATE sem WHERE, mesmo numa tabela temporária.
--
-- **Já tinha acontecido exatamente isto nos mixes** — ver
-- `migration_fix_apply_mix_elo_safeupdate.sql`. A `apply_tournament_elo` foi
-- escrita a partir da dos mixes (Dev 3) e não levou o `WHERE TRUE` que essa
-- já tinha. Está em três ficheiros: `migration_tournaments_finish.sql`,
-- `migration_tournaments_who_played.sql` e `migration_tournaments_recalc.sql`.
--
-- Porque é que os testes não apanharam: o `pg_safeupdate` só está ligado nos
-- pedidos que vêm da app (PostgREST). Um teste feito no editor SQL, ou pelo
-- papel de administração, não o tem — o mesmo UPDATE passa. E não se pode
-- ligar à mão num teste: `LOAD 'safeupdate'` é recusado. **Uma função que
-- mexe em tabelas temporárias tem de ser testada chamada pela app, ou lida à
-- procura de UPDATE/DELETE sem WHERE.**
--
-- ─────────────────────────────────────────────────────────────────────────
-- A CORREÇÃO: NÃO TRAZ O CORPO DA FUNÇÃO ESCRITO
-- ─────────────────────────────────────────────────────────────────────────
-- A `apply_tournament_elo` é redefinida por três migrações e produção já
-- mudou a meio de um dia várias vezes. Escrever aqui o corpo inteiro
-- arriscava apagar o que produção tenha e este ficheiro não.
--
-- Por isso: lê o corpo VIVO de cada função que tenha esse UPDATE, acrescenta
-- só `WHERE TRUE` (mexe nas mesmas linhas — só satisfaz a verificação), e
-- recria-a. Tudo o resto fica exatamente como estava, incluindo quem a pode
-- chamar e com que poderes corre.
-- ═════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  c_mau   CONSTANT TEXT := 'UPDATE\s+_elo_torneio\s+SET\s+delta\s*=\s*delta\s*\+\s*bonus\s*;';
  c_bom   CONSTANT TEXT := 'UPDATE _elo_torneio SET delta = delta + bonus WHERE TRUE;';
  f       RECORD;
  v_def   TEXT;
  v_novo  TEXT;
  v_feitas INTEGER := 0;
BEGIN
  FOR f IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosrc ~ c_mau
  LOOP
    v_def  := pg_get_functiondef(f.oid);
    v_novo := regexp_replace(v_def, c_mau, c_bom, 'g');

    IF v_novo = v_def THEN
      RAISE EXCEPTION 'Encontrei o UPDATE sem WHERE em %(%), mas não o consegui substituir. Não adivinho — ler o corpo vivo.', f.proname, f.args;
    END IF;

    EXECUTE v_novo;
    v_feitas := v_feitas + 1;
    RAISE NOTICE 'Corrigida: %(%)', f.proname, f.args;
  END LOOP;

  IF v_feitas = 0 THEN
    RAISE NOTICE 'Nenhuma função tinha o UPDATE sem WHERE — já estava corrigido, nada a fazer.';
  END IF;

  -- Confirmar que não ficou nenhuma. Se ficar, rebenta em vez de nos deixar
  -- pensar que o pódio já funciona.
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.prosrc ~ c_mau) THEN
    RAISE EXCEPTION 'Ainda há funções com o UPDATE sem WHERE. Fechar categorias continua partido.';
  END IF;
END $$;

-- ═════════════════════════════════════════════════════════════════════════
-- PARA CORRER EM PRODUÇÃO ANTES (só leitura): quais funções têm o problema
-- ═════════════════════════════════════════════════════════════════════════
--   SELECT p.proname, pg_get_function_identity_arguments(p.oid)
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND p.prosrc ~ 'UPDATE\s+_elo_torneio\s+SET\s+delta\s*=\s*delta\s*\+\s*bonus\s*;';
--
-- Esperado: `apply_tournament_elo`. Depois de correr este ficheiro: nenhuma.
