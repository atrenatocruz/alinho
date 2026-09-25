-- ═════════════════════════════════════════════════════════════════════════
-- #542 — Convidados do WhatsApp e contas de teste não ocupam lugares do
-- plano.
--
-- O que se passava (verificação BA, 24 set, nas funções vivas): as funções
-- que deixam entrar alguém num grupo ou clube contam TODAS as linhas de
-- `memberships` contra o limite do plano, convidados do bot incluídos
-- (`is_guest`). A regra do «#343» diz que os convidados não contam. Num
-- grupo Free (40 lugares), os convidados podiam barrar sócios reais.
--
-- O que faz:
--   1. Um só sítio para a conta: org_counted_member_count(org) — os membros
--      que ocupam lugar, sem convidados (is_guest) nem contas de teste
--      (is_test).
--   2. As cinco portas de entrada passam a perguntar-lhe, em vez de contar
--      tudo: join_organization, follow_organization,
--      approve_membership_request, accept_organization_invite e
--      teacher_join_club (#550). Em cada uma troca-se só o fragmento
--      «(SELECT COUNT(*) FROM memberships WHERE organization_id = X)».
--
-- NÃO mexe no org_max_members (Renato, 23 set: limite + um lugar por cada
-- super admin lá dentro). Os super admins continuam contados de um lado e
-- somados do outro, como ele desenhou, e a mensagem «limite de N membros»
-- continua a dizer o número do plano.
--
-- Parte do corpo vivo de cada função (todas as versões com esse nome):
-- troca só o fragmento, recusa se não o encontrar exatamente uma vez, e diz
-- «já estava» se já usar a conta nova. Sem mudar assinaturas: as
-- permissões ficam; a função nova tem REVOKE explícito de PUBLIC e anon.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

-- ── 0. Peças de que depende ─────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'memberships'
                    AND column_name IN ('is_guest', 'is_test')
                  HAVING count(*) = 2) THEN
    RAISE EXCEPTION 'Faltam memberships.is_guest ou memberships.is_test. Parar e ler.';
  END IF;
END $$;

-- ── 1. A conta, num sítio só ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.org_counted_member_count(p_organization_id UUID)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Quem ocupa lugar no plano: não os convidados do bot nem as contas de
  -- teste (regra do #343; #542).
  SELECT COUNT(*) FROM memberships m
   WHERE m.organization_id = p_organization_id
     AND NOT COALESCE(m.is_guest, FALSE)
     AND NOT COALESCE(m.is_test, FALSE);
$$;

REVOKE ALL ON FUNCTION public.org_counted_member_count(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.org_counted_member_count(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.org_counted_member_count(UUID) TO authenticated;

-- ── 2. As cinco portas de entrada passam a usá-la ───────────────────────
DO $$
DECLARE
  c_conta_mau CONSTANT TEXT :=
    '\(SELECT COUNT\(\*\) FROM memberships WHERE organization_id = (\w+)\)(\s*>=\s*v_max)';
  c_conta_bom CONSTANT TEXT := 'org_counted_member_count(\1)\2';
  v_nomes CONSTANT TEXT[] := ARRAY['join_organization', 'follow_organization',
    'approve_membership_request', 'accept_organization_invite', 'teacher_join_club'];
  f      RECORD;
  v_def  TEXT;
  v_n    INTEGER;
  v_vistas TEXT[] := '{}';
BEGIN
  FOR f IN SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
             FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (v_nomes)
            ORDER BY p.proname LOOP
    v_vistas := array_append(v_vistas, f.proname::text);
    v_def := pg_get_functiondef(f.oid);
    IF position('org_counted_member_count(' IN v_def) > 0 THEN
      RAISE NOTICE '%(%): já usava a conta sem convidados.', f.proname, f.args;
      CONTINUE;
    END IF;
    v_n := (SELECT count(*) FROM regexp_matches(v_def, c_conta_mau, 'g'));
    IF v_n <> 1 THEN
      RAISE EXCEPTION '%(%): a conta dos membros aparece % vezes (esperava 1). Ler o corpo vivo.', f.proname, f.args, v_n;
    END IF;
    EXECUTE regexp_replace(v_def, c_conta_mau, c_conta_bom);
    RAISE NOTICE 'Corrigida: %(%)', f.proname, f.args;
  END LOOP;

  -- As cinco têm de existir: se faltar uma, alguém a mudou de nome.
  IF (SELECT count(DISTINCT x) FROM unnest(v_vistas) x) <> 5 THEN
    RAISE EXCEPTION 'Esperava as cinco portas (%), encontrei: %. Parar e ler.', v_nomes, v_vistas;
  END IF;
END $$;

-- ── 3. Confirmação ──────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p
              WHERE p.pronamespace = 'public'::regnamespace
                AND p.proname IN ('join_organization', 'follow_organization',
                  'approve_membership_request', 'accept_organization_invite', 'teacher_join_club')
                AND pg_get_functiondef(p.oid) ~ 'SELECT COUNT\(\*\) FROM memberships WHERE organization_id = \w+\)\s*>=\s*v_max') THEN
    RAISE EXCEPTION 'Ainda há uma porta a contar os convidados. Parar e ler.';
  END IF;
  IF has_function_privilege('anon', 'public.org_counted_member_count(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon ainda pode chamar org_counted_member_count. Parar e ler.';
  END IF;
  RAISE NOTICE '#542: convidados e contas de teste deixam de ocupar lugares.';
END $$;
