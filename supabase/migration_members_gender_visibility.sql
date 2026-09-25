-- ═════════════════════════════════════════════════════════════════════════
-- #419 (remendo urgente) — a lista de membros não mostra o género de quem
-- esconde os resultados.
--
-- O que se passa (System Integrator, 25 set): a 1.ª versão do #419 (commit
-- 0460b71) correu em produção sem aviso. A list_organization_members viva
-- devolve `p.gender` a qualquer membro, mesmo quando a pessoa escolheu
-- esconder os resultados (`results_visibility`). A correção 5ce71d7, que
-- punha o género sob a mesma regra do nível, nunca correu.
--
-- O que faz: só isto, no corpo vivo —
--   «…THEN p.rating END, p.gender FROM»
--   → «…THEN p.rating END, CASE WHEN can_view_section(p.id,
--      p.results_visibility) THEN p.gender END FROM»
-- O género só serve para a letra da banda (M/F): vem quando o nível vem.
--
-- Troca só o fragmento, recusa se não o encontrar exatamente uma vez (em
-- cada versão da função), e diz «já estava» se o género já estiver
-- protegido. Mesma assinatura e mesmas colunas: as permissões ficam; na
-- mesma, REVOKE explícito de PUBLIC e anon, e GRANT só a authenticated.
--
-- Depois disto, a migration_club_page_pieces.sql (a versão de hoje) diz
-- «já tinha» nesta função quando correr com o ecrã do Dev 1.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  c_gen_mau CONSTANT TEXT := '(THEN p\.rating END,\s*)p\.gender(\s+FROM)';
  c_gen_bom CONSTANT TEXT := '\1CASE WHEN can_view_section(p.id, p.results_visibility) THEN p.gender END\2';
  f     RECORD;
  v_def TEXT;
  v_n   INTEGER := 0;
BEGIN
  IF to_regprocedure('public.can_view_section(uuid, text)') IS NULL THEN
    RAISE EXCEPTION 'Falta can_view_section(uuid, text). Parar e ler.';
  END IF;

  FOR f IN SELECT p.oid, pg_get_function_identity_arguments(p.oid) AS args
             FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname = 'list_organization_members' LOOP
    v_n := v_n + 1;
    v_def := pg_get_functiondef(f.oid);
    IF v_def ~ 'THEN p\.gender END' THEN
      RAISE NOTICE 'list_organization_members(%): o género já estava protegido.', f.args;
      CONTINUE;
    END IF;
    IF (SELECT count(*) FROM regexp_matches(v_def, c_gen_mau, 'g')) <> 1 THEN
      RAISE EXCEPTION 'list_organization_members(%): não tem a forma da 1.ª versão do #419 (0460b71). Ler o corpo vivo.', f.args;
    END IF;
    EXECUTE regexp_replace(v_def, c_gen_mau, c_gen_bom);
    RAISE NOTICE 'Corrigida: list_organization_members(%)', f.args;
  END LOOP;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'Não existe list_organization_members. Parar e ler.';
  END IF;

  -- Confirmação: nenhuma versão devolve o género sem a regra.
  IF EXISTS (SELECT 1 FROM pg_proc p
              WHERE p.pronamespace = 'public'::regnamespace
                AND p.proname = 'list_organization_members'
                AND pg_get_functiondef(p.oid) !~ 'THEN p\.gender END') THEN
    RAISE EXCEPTION 'Ainda há uma list_organization_members com o género à vista. Parar e ler.';
  END IF;
END $$;

DO $$
DECLARE f RECORD;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname = 'list_organization_members' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
  END LOOP;
END $$;
