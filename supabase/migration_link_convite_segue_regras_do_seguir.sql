-- ═════════════════════════════════════════════════════════════════════════
-- Link de convite (?org=<nome>): segue as regras do «Seguir» da Comunidade
--
-- O QUE MUDA em join_organization(p_slug)
--   · Entrada aberta (open_join) e não self-serve: entra logo, como antes.
--   · Entrada fechada: fica um pedido, que o admin aprova no Gerir (igual
--     ao follow_organization). Antes entrava logo.
--   · Subgrupo de um clube: só quem já é membro do clube pode pedir ou entrar
--     (a mesma frase do follow_organization).
--   · Self-serve e grupo no limite do plano: pedido, como antes (#447).
--   · Já membro: devolve o grupo sem mexer, como antes.
--
-- A APP. Nada a mudar: a Home já mostra «pedido enviado» quando a pessoa não
-- ficou membro (get_club_profile.my_status). A função continua a devolver o
-- id do grupo. O convite por nome em Gerir › Convidar não passa por aqui.
--
-- Para desfazer (só em emergência): voltar a correr o CREATE OR REPLACE de
-- supabase/migration_447_link_grupo_cheio_fica_pedido.sql (md5 sem \r d988ecc9…).
--
-- Dev 3, 9 nov 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  v_m TEXT;
BEGIN
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_m
    FROM pg_proc WHERE oid = 'public.join_organization(text)'::regprocedure;
  IF v_m NOT IN ('d988ecc95e57b544c7ea37ecec8e1e75', '8abfb2d9e1515a1d329a6dc2aaf8e308') THEN
    RAISE EXCEPTION 'join_organization diferente do esperado (%): parar e rever', v_m;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.join_organization(p_slug text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id UUID;
  v_self_serve BOOLEAN;
  v_kind TEXT;
  v_parent_id UUID;
  v_open_join BOOLEAN;
  v_max INTEGER;
BEGIN
  SELECT id, self_serve, kind, parent_organization_id, open_join
    INTO v_org_id, v_self_serve, v_kind, v_parent_id, v_open_join
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

  -- Subgrupo de um clube: só quem já é do clube (regra do follow_organization).
  IF v_kind = 'group' AND v_parent_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM memberships WHERE user_id = auth.uid() AND organization_id = v_parent_id
  ) THEN
    RAISE EXCEPTION 'Só membros do clube podem pedir para entrar neste grupo';
  END IF;

  -- Self-serve, ou entrada fechada (9 nov): fica um pedido para o admin
  -- aprovar no Gerir, como no «Seguir» da Comunidade.
  IF v_self_serve OR NOT COALESCE(v_open_join, false) THEN
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
     AND org_counted_member_count(v_org_id) >= v_max THEN
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
$function$;

REVOKE ALL ON FUNCTION public.join_organization(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.join_organization(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.join_organization(text) TO authenticated, service_role;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.join_organization(text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.join_organization(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Acessos de join_organization errados';
  END IF;
END $$;

COMMIT;
