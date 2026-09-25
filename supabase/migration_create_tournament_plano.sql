-- ═════════════════════════════════════════════════════════════════════════
-- #523 — Criar torneios só a partir do plano Community (Community e Club).
-- Decisão do Francisco, 25 set, 23h55 («avança»), com o #538.
--
-- O que se passava (BA, 24 set, confirmado em produção): a create_tournament
-- só verificava se a pessoa é admin do grupo ou clube. Um admin de um grupo
-- Free criava um torneio chamando a base de dados diretamente, sem passar
-- pelo ecrã.
--
-- O que faz: na create_tournament, logo a seguir a «Só um admin do clube
-- pode criar torneios», recusa se o plano da organização não for Community
-- ou Club. Pelo PLANO (organizations.plan_tier), não pelo tipo.
--   Na base de dados os planos chamam-se: free = Free, plus = Squad,
--   pro = Community, club = Club (plan_limits).
--   · Os super admins da plataforma passam sempre — são quem monta os
--     torneios dos parceiros (é a mesma exceção da can_manage_org
--     _tournaments). Se o PO quiser que também eles respeitem o plano, é
--     tirar essa linha.
--   · Só a criação: os torneios que já existem num grupo Free continuam a
--     poder ser geridos (editar, sortear, marcar). O botão no Gerir é do
--     agente de Bugs.
--
-- ⚠️ ANTES DE CORRER (System Integrator, só leitura): confirmar o plano das
-- organizações que vão criar torneios nos próximos dias — o Smash Cup
-- verdadeiro ainda não foi criado:
--   SELECT o.name, o.plan_tier, count(t.id) AS torneios
--     FROM organizations o LEFT JOIN tournaments t ON t.organization_id = o.id
--    GROUP BY o.id ORDER BY torneios DESC;
--
-- Parte do corpo vivo: troca só o fragmento, recusa se não o encontrar
-- exatamente uma vez, «já estava» se repetido. Mesma assinatura: as
-- permissões ficam; repõem-se explicitamente (REVOKE PUBLIC e anon, GRANT a
-- authenticated).
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  c_quem_mau CONSTANT TEXT :=
    '(RAISE EXCEPTION ''Só um admin do clube pode criar torneios''\s+USING ERRCODE = ''insufficient_privilege'';\s+END IF;)';
  c_quem_bom CONSTANT TEXT := '\1
  -- #523: torneios a partir do plano Community (pro) — pelo plano, não pelo
  -- tipo. Os super admins da plataforma passam sempre.
  IF org_plan_tier(p_organization_id) NOT IN (''pro'', ''club'')
     AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_platform_admin) THEN
    RAISE EXCEPTION ''Os torneios são a partir do plano Community. Muda o plano para criar um torneio.''
      USING ERRCODE = ''insufficient_privilege'';
  END IF;';
  f     RECORD;
  v_def TEXT;
  v_n   INTEGER := 0;
BEGIN
  IF to_regprocedure('public.org_plan_tier(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Falta org_plan_tier(uuid). Parar e ler.';
  END IF;
  FOR f IN SELECT p.oid, pg_get_function_identity_arguments(p.oid) AS args
             FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'create_tournament' LOOP
    v_n := v_n + 1;
    v_def := pg_get_functiondef(f.oid);
    IF position('#523' IN v_def) > 0 THEN
      RAISE NOTICE 'create_tournament(%): a regra do plano já estava.', f.args;
      CONTINUE;
    END IF;
    IF (SELECT count(*) FROM regexp_matches(v_def, c_quem_mau, 'g')) <> 1 THEN
      RAISE EXCEPTION 'create_tournament(%) mudou: a verificação do admin não aparece exatamente uma vez. Ler o corpo vivo.', f.args;
    END IF;
    EXECUTE regexp_replace(v_def, c_quem_mau, c_quem_bom);
    IF position('#523' IN pg_get_functiondef(f.oid)) = 0 THEN
      RAISE EXCEPTION 'create_tournament(%): a regra do plano não ficou. Parar e ler.', f.args;
    END IF;
    RAISE NOTICE 'create_tournament(%): só a partir do plano Community.', f.args;
  END LOOP;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'Não existe create_tournament. Parar e ler.';
  END IF;
END $$;

DO $$
DECLARE f RECORD;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'create_tournament' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
  END LOOP;
END $$;
