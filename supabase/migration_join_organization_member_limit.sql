-- ═════════════════════════════════════════════════════════════════════════
-- ENTRAR POR LINK TAMBÉM RESPEITA O LIMITE DE MEMBROS DO PLANO
-- (23 set 2026) — cartão #447.
--
-- CORRER DEPOIS de migration_self_serve_groups.sql e de
-- migration_plan_limits.sql (usa org_max_members). Pode-se correr outra vez
-- sem estragar.
--
-- Havia três portas para entrar num grupo e só duas viam o limite:
-- approve_membership_request e accept_organization_invite travam;
-- join_organization (o link partilhado no WhatsApp) inseria direto. Passa a
-- fazer a mesma verificação, com a mesma mensagem.
--
-- Quem já é membro e volta a abrir o link continua a entrar sem erro (o
-- teste de membro vem antes). Grupos self-serve continuam a criar um pedido
-- — é na aprovação desse pedido que o limite já trava.
--
-- POR DECIDIR (Francisco): em vez de recusar à porta, deixar um pedido à
-- espera para o admin ver. Até lá, a resposta é a mesma dos outros caminhos.
-- Redefinida a partir da versão de migration_self_serve_groups.sql.
-- ═════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION join_organization(p_slug TEXT)
RETURNS UUID AS $$
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

  -- Mesma verificação de approve_membership_request / accept_organization_invite (#447).
  v_max := org_max_members(v_org_id);
  IF v_max IS NOT NULL
     AND (SELECT COUNT(*) FROM memberships WHERE organization_id = v_org_id) >= v_max THEN
    RAISE EXCEPTION 'Grupo já atingiu o limite de % membros do plano', v_max;
  END IF;

  INSERT INTO memberships (user_id, organization_id)
  VALUES (auth.uid(), v_org_id)
  ON CONFLICT (user_id, organization_id) DO NOTHING;

  RETURN v_org_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
