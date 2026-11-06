-- Fecho de profiles a quem não tem sessão (5 nov 2026).
-- Corrido em produção a 5 nov às 09:39 UTC pelo SI. Já corrido também no alinho-dev.
-- Encontrado pelo agente de Bugs, confirmado pelo SI: com a chave pública, sem sessão, liam-se
-- todas as colunas (email, phone_hash, whatsapp_jid, birthday...) dos membros das organizações
-- is_global, porque a política era para public e usa in_global_org(id).
--
-- O que muda: anon deixa de ver linhas de profiles. Quem tem sessão vê o mesmo de antes.
-- O que não muda: as vistas tournament_public_entries e tournament_public_notices correm como
-- dono, por isso os nomes nos torneios públicos continuam. As funções SECURITY DEFINER também.
--
-- Para desfazer:
--   ALTER POLICY "See own profile, org-mates, or global-org members" ON public.profiles TO public;
--   GRANT EXECUTE ON FUNCTION public.in_global_org(uuid), public.shares_org_with(uuid) TO anon;

BEGIN;

DO $$
DECLARE v_qual text;
BEGIN
  SELECT pg_get_expr(polqual, polrelid) INTO v_qual
  FROM pg_policy
  WHERE polrelid = 'public.profiles'::regclass
    AND polname = 'See own profile, org-mates, or global-org members';

  IF v_qual IS DISTINCT FROM '((id = auth.uid()) OR shares_org_with(id) OR in_global_org(id))' THEN
    RAISE EXCEPTION 'Política de profiles diferente da esperada: %', v_qual;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policy p
    WHERE (pg_get_expr(p.polqual, p.polrelid) ~ '(in_global_org|shares_org_with)'
           OR pg_get_expr(p.polwithcheck, p.polrelid) ~ '(in_global_org|shares_org_with)')
      AND p.polrelid <> 'public.profiles'::regclass
      AND NOT p.polroles = ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'authenticated')]::oid[]
  ) THEN
    RAISE EXCEPTION 'Outra política aberta a anon usa estas funções: parar e rever';
  END IF;
END $$;

ALTER POLICY "See own profile, org-mates, or global-org members" ON public.profiles TO authenticated;

REVOKE EXECUTE ON FUNCTION public.in_global_org(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.shares_org_with(uuid) FROM anon;

COMMIT;
