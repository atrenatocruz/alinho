-- ═══════════════════════════════════════════════════════════════════════
-- #447 — Entrar por link num grupo cheio: fica um PEDIDO, não um erro
-- (Bugs, 25 set 2026; decisão do Francisco a 25 set: «opção 2, o pedido
-- fica à espera».)
--
-- Hoje, com o grupo no limite do plano, o link dá erro («Grupo já atingiu o
-- limite de N membros do plano») e o admin nunca sabe que alguém tentou
-- entrar. Passa a ficar um pedido pendente em membership_requests — o mesmo
-- que a função já faz para os grupos self-serve umas linhas acima. O admin
-- vê-o no Gerir, com o aviso de que o grupo está no limite; aprovar com o
-- grupo cheio continua a dar a mensagem do limite (approve_membership_request
-- não muda), e depois de abrir lugar aprovar funciona.
--
-- Quem já é membro e volta a abrir o link continua a entrar sem erro (o teste
-- de membro vem antes, igual).
--
-- ESCRITA A PARTIR DO CORPO VIVO de produção, lido pelo System Integrator a
-- 25 set à noite: length(prosrc)=1235, md5 sem chr(13) =
-- 0dcb55a1e936c782f36216faac9b84ab. O passo 0 pára se tiver mudado.
-- Só muda o ramo do limite: RAISE EXCEPTION → INSERT do pedido + RETURN.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 0. Trava: parar se produção já não é o que foi lido ────────────────
DO $$
DECLARE
  v_md5 TEXT;
BEGIN
  SELECT md5(replace(p.prosrc, chr(13), '')) INTO v_md5
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'join_organization';
  IF v_md5 IS DISTINCT FROM '0dcb55a1e936c782f36216faac9b84ab' THEN
    RAISE EXCEPTION 'join_organization mudou desde 25 set à noite (md5 %). Parar e ler o corpo vivo outra vez.', v_md5;
  END IF;
END $$;

-- ── 1. join_organization: grupo cheio → pedido pendente ────────────────
CREATE OR REPLACE FUNCTION public.join_organization(p_slug TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org_id UUID;
  v_self_serve BOOLEAN;
  v_max INTEGER;
BEGIN
  SELECT id, self_serve INTO v_org_id, v_self_serve
  FROM organizations WHERE slug = p_slug;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Organização não encontrada';
  END IF;

  -- Already a member: no-op, same idempotency the callers rely on.
  IF EXISTS (
    SELECT 1 FROM memberships WHERE user_id = auth.uid() AND organization_id = v_org_id
  ) THEN
    RETURN v_org_id;
  END IF;

  IF v_self_serve THEN
    INSERT INTO membership_requests (user_id, organization_id)
    VALUES (auth.uid(), v_org_id)
    ON CONFLICT (user_id, organization_id) WHERE (status = 'pending') DO NOTHING;
    RETURN v_org_id;
  END IF;

  -- Grupo no limite do plano (#447, decisão do Francisco a 25 set): em vez de
  -- recusar à porta, fica um pedido à espera. O admin vê-o no Gerir com o
  -- aviso do limite; approve_membership_request continua a travar até haver
  -- lugar. A app sabe que ficou pedido porque a pessoa não ficou membro.
  v_max := org_max_members(v_org_id);
  IF v_max IS NOT NULL
     AND (SELECT COUNT(*) FROM memberships WHERE organization_id = v_org_id) >= v_max THEN
    INSERT INTO membership_requests (user_id, organization_id)
    VALUES (auth.uid(), v_org_id)
    ON CONFLICT (user_id, organization_id) WHERE (status = 'pending') DO NOTHING;
    RETURN v_org_id;
  END IF;

  INSERT INTO memberships (user_id, organization_id)
  VALUES (auth.uid(), v_org_id)
  ON CONFLICT (user_id, organization_id) DO NOTHING;

  RETURN v_org_id;
END;
$$;

-- ── 2. Permissões (regra do System Integrator, 25 set) ──────────────────
-- Hoje: {postgres, authenticated, service_role}. O CREATE OR REPLACE mantém
-- as permissões, mas o REVOKE explícito fica para não depender disso.
REVOKE EXECUTE ON FUNCTION public.join_organization(TEXT) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_organization(TEXT) TO authenticated;

-- ── 3. Verificação ──────────────────────────────────────────────────────
DO $$
DECLARE
  v_src TEXT;
BEGIN
  IF has_function_privilege('anon', 'public.join_organization(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon ainda pode chamar join_organization. Parar e ler.';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.join_organization(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated deixou de poder chamar join_organization. Parar e ler.';
  END IF;
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = 'public.join_organization(text)'::regprocedure;
  -- Contar ocorrências, não LIKE: o INSERT em membership_requests já existia
  -- uma vez (ramo self-serve); depois desta migração são DUAS.
  IF (length(v_src) - length(replace(v_src, 'INSERT INTO membership_requests', ''))) / length('INSERT INTO membership_requests') <> 2 THEN
    RAISE EXCEPTION 'join_organization não ficou com o pedido no ramo do limite. Parar e ler.';
  END IF;
  IF position('Grupo já atingiu o limite' IN v_src) > 0 THEN
    RAISE EXCEPTION 'join_organization ainda recusa com erro no limite. Parar e ler.';
  END IF;
  RAISE NOTICE '#447 pronto: link num grupo cheio deixa um pedido pendente.';
END $$;

-- ── Depois de correr (System Integrator) ────────────────────────────────
-- A mensagem do limite continua em approve_membership_request (não muda):
--   SELECT position('Grupo já atingiu o limite' IN prosrc) > 0
--     FROM pg_proc WHERE proname = 'approve_membership_request';   -- true
