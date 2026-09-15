-- Dono do grupo/clube + convidar como admin (Trello #261).
--
-- ⚠️ Correr DEPOIS de migration_delete_self_serve_group.sql — redefine
-- get_organization_delete_blocker() para passar a exigir o dono.
--
-- ── Porquê ────────────────────────────────────────────────────────────────
-- Vários admins já existiam (admin_set_membership_admin), mas qualquer admin
-- podia retirar o admin a outro, ou removê-lo — incluindo a quem criou o
-- grupo ou paga a subscrição. Com um admin só nunca foi problema; com vários,
-- um admin promovido pode expulsar o dono do próprio grupo.
--
-- Regras copiadas do WhatsApp (Centro de Ajuda, set 2026):
--   grupos      — "Não é possível remover o criador original de um grupo, que
--                  permanece como administrador/a até sair do mesmo."
--   comunidades — um único proprietário, que pode transferir a propriedade a
--                  um admin; se apagar a conta, passa a outro admin.
-- Não copiámos o "outro membro escolhido aleatoriamente" quando o único admin
-- sai: num grupo com subscrição a posse não deve cair ao acaso. Aqui o dono
-- não pode sair sem passar a posse (a app já não deixava sair o único admin).
--
-- ── Segurança ─────────────────────────────────────────────────────────────
-- owner_id não entra no GRANT UPDATE (colunas) de organizations, nem is_admin
-- no de memberships, e organization_invites só tem políticas SELECT/DELETE —
-- nada disto se altera por PATCH direto. Tudo passa pelas funções abaixo, que
-- são SECURITY DEFINER e validam aqui dentro.

-- ── 1. Dono ────────────────────────────────────────────────────────────────
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN organizations.owner_id IS
  'Dono (Trello #261): não pode ser despromovido nem removido; pode passar a posse a outro admin. NULL só se não restar nenhum membro não-convidado.';

-- Grupos que já existem: o admin mais antigo passa a dono.
-- ⚠️ Rever antes de dar por fechado — nos grupos-piloto o admin mais antigo
-- pode não ser quem devia ser dono. Para ver a lista:
--   SELECT o.name, o.kind, p.name AS dono
--   FROM organizations o LEFT JOIN profiles p ON p.id = o.owner_id ORDER BY o.name;
-- Para corrigir um: transfer_organization_ownership() como platform admin.
UPDATE organizations o
SET owner_id = first_admin.user_id
FROM (
  SELECT DISTINCT ON (organization_id) organization_id, user_id
  FROM memberships
  WHERE is_admin
  ORDER BY organization_id, created_at ASC NULLS LAST, user_id
) AS first_admin
WHERE first_admin.organization_id = o.id
  AND o.owner_id IS NULL;

-- Um grupo novo ganha dono no momento em que recebe o primeiro admin. Cobre
-- todos os caminhos de criação (create_self_serve_group, create_organization,
-- create_group) sem ter de mexer em cada um.
CREATE OR REPLACE FUNCTION set_owner_on_first_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_admin AND NOT NEW.is_guest THEN
    UPDATE organizations SET owner_id = NEW.user_id
    WHERE id = NEW.organization_id AND owner_id IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_owner_on_first_admin ON memberships;
CREATE TRIGGER trg_set_owner_on_first_admin
  AFTER INSERT OR UPDATE OF is_admin ON memberships
  FOR EACH ROW EXECUTE FUNCTION set_owner_on_first_admin();

-- Se o dono desaparecer (conta apagada → FK ON DELETE SET NULL), a posse
-- passa ao admin mais antigo; sem outro admin, ao membro mais antigo, que é
-- promovido a admin. Convidados do WhatsApp nunca ficam donos.
CREATE OR REPLACE FUNCTION reassign_owner_when_cleared()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_owner UUID;
  v_is_admin BOOLEAN;
BEGIN
  SELECT user_id, is_admin INTO v_new_owner, v_is_admin
  FROM memberships
  WHERE organization_id = NEW.id
    AND user_id <> OLD.owner_id
    AND NOT is_guest
  ORDER BY is_admin DESC, created_at ASC NULLS LAST, user_id
  LIMIT 1;

  IF v_new_owner IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT v_is_admin THEN
    UPDATE memberships SET is_admin = TRUE
    WHERE organization_id = NEW.id AND user_id = v_new_owner;
  END IF;

  UPDATE organizations SET owner_id = v_new_owner
  WHERE id = NEW.id AND owner_id IS NULL;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reassign_owner_when_cleared ON organizations;
CREATE TRIGGER trg_reassign_owner_when_cleared
  AFTER UPDATE OF owner_id ON organizations
  FOR EACH ROW
  WHEN (OLD.owner_id IS NOT NULL AND NEW.owner_id IS NULL)
  EXECUTE FUNCTION reassign_owner_when_cleared();

-- ── 2. Proteger o dono ─────────────────────────────────────────────────────
-- Mesmas verificações de sempre (schema.sql), mais a do dono.
CREATE OR REPLACE FUNCTION admin_set_membership_admin(p_organization_id UUID, p_user_id UUID, p_is_admin BOOLEAN)
RETURNS void AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM memberships
    WHERE organization_id = p_organization_id AND user_id = auth.uid() AND is_admin
  ) THEN
    RAISE EXCEPTION 'Apenas admins podem alterar permissões de administrador';
  END IF;
  IF p_user_id = auth.uid() AND p_is_admin = FALSE THEN
    RAISE EXCEPTION 'Não podes remover a tua própria permissão de admin';
  END IF;
  IF p_is_admin = FALSE
     AND EXISTS (SELECT 1 FROM organizations WHERE id = p_organization_id AND owner_id = p_user_id) THEN
    RAISE EXCEPTION 'Não é possível retirar o admin ao dono';
  END IF;

  UPDATE memberships SET is_admin = p_is_admin
  WHERE organization_id = p_organization_id AND user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION admin_set_membership_admin(UUID, UUID, BOOLEAN) FROM anon, public;
GRANT EXECUTE ON FUNCTION admin_set_membership_admin(UUID, UUID, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION admin_remove_member(p_organization_id UUID, p_user_id UUID)
RETURNS void AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM memberships
    WHERE organization_id = p_organization_id AND user_id = auth.uid() AND is_admin
  ) THEN
    RAISE EXCEPTION 'Apenas admins podem remover membros';
  END IF;
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Não podes remover-te a ti próprio';
  END IF;
  IF EXISTS (SELECT 1 FROM organizations WHERE id = p_organization_id AND owner_id = p_user_id) THEN
    RAISE EXCEPTION 'Não é possível remover o dono';
  END IF;

  DELETE FROM memberships WHERE organization_id = p_organization_id AND user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION admin_remove_member(UUID, UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION admin_remove_member(UUID, UUID) TO authenticated;

-- Igual a migration_global_directory_and_gerir.sql, com o dono à frente.
CREATE OR REPLACE FUNCTION leave_organization(p_organization_id UUID)
RETURNS void AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM organizations WHERE id = p_organization_id AND owner_id = auth.uid()) THEN
    RAISE EXCEPTION 'És o dono — passa a posse a outro admin antes de saíres';
  END IF;

  IF (
    SELECT is_admin FROM memberships
    WHERE user_id = auth.uid() AND organization_id = p_organization_id
  ) AND (
    SELECT COUNT(*) FROM memberships
    WHERE organization_id = p_organization_id AND is_admin = TRUE
  ) <= 1 THEN
    RAISE EXCEPTION 'És o único admin deste clube — torna outra pessoa admin antes de saíres';
  END IF;

  DELETE FROM memberships WHERE user_id = auth.uid() AND organization_id = p_organization_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION leave_organization(UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION leave_organization(UUID) TO authenticated;

-- ── 3. Passar a posse ──────────────────────────────────────────────────────
-- Só o dono (ou um platform admin, para corrigir a lista inicial acima), e
-- só para alguém que já seja admin — como no WhatsApp.
CREATE OR REPLACE FUNCTION transfer_organization_ownership(p_organization_id UUID, p_new_owner_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
BEGIN
  SELECT owner_id INTO v_owner FROM organizations WHERE id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Grupo não encontrado';
  END IF;

  IF NOT (
    v_owner = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_platform_admin)
  ) THEN
    RAISE EXCEPTION 'Só o dono pode passar a posse';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM memberships
    WHERE organization_id = p_organization_id AND user_id = p_new_owner_id AND is_admin AND NOT is_guest
  ) THEN
    RAISE EXCEPTION 'A posse só pode passar para um admin';
  END IF;

  UPDATE organizations SET owner_id = p_new_owner_id WHERE id = p_organization_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION transfer_organization_ownership(UUID, UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION transfer_organization_ownership(UUID, UUID) TO authenticated;

-- ── 4. Eliminar grupo: só o dono ───────────────────────────────────────────
-- Igual a migration_delete_self_serve_group.sql, com 'not_admin' → 'not_owner'.
CREATE OR REPLACE FUNCTION get_organization_delete_blocker(p_org_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_org organizations%ROWTYPE;
  v_is_platform_admin BOOLEAN;
BEGIN
  IF auth.uid() IS NULL
     OR COALESCE((auth.jwt()->>'is_anonymous')::boolean, FALSE) THEN
    RETURN 'not_authenticated';
  END IF;

  SELECT * INTO v_org FROM organizations WHERE id = p_org_id;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  SELECT COALESCE(is_platform_admin, FALSE) INTO v_is_platform_admin
  FROM profiles WHERE id = auth.uid();

  IF NOT (v_org.owner_id = auth.uid() OR COALESCE(v_is_platform_admin, FALSE)) THEN
    RETURN 'not_owner';
  END IF;

  IF NOT v_org.self_serve THEN
    RETURN 'not_self_serve';
  END IF;

  IF EXISTS (SELECT 1 FROM organizations WHERE parent_organization_id = p_org_id) THEN
    RETURN 'has_subgroups';
  END IF;

  IF EXISTS (SELECT 1 FROM games            WHERE organization_id = p_org_id)
  OR EXISTS (SELECT 1 FROM game_recurrences WHERE organization_id = p_org_id)
  OR EXISTS (SELECT 1 FROM group_matches    WHERE organization_id = p_org_id)
  OR EXISTS (SELECT 1 FROM player_stats     WHERE organization_id = p_org_id)
  OR EXISTS (SELECT 1 FROM mix_player_stats WHERE organization_id = p_org_id)
  OR EXISTS (SELECT 1 FROM vouchers         WHERE organization_id = p_org_id) THEN
    RETURN 'has_activity';
  END IF;

  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_organization_delete_blocker(UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION get_organization_delete_blocker(UUID) TO authenticated;

-- ── 5. Convidar como admin ─────────────────────────────────────────────────
ALTER TABLE organization_invites
  ADD COLUMN IF NOT EXISTS as_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- DROP + CREATE em vez de CREATE OR REPLACE: com um parâmetro a mais o
-- OR REPLACE criaria uma segunda versão ao lado da antiga, e o PostgREST
-- recusa escolher entre duas quando a chamada usa parâmetros com nome.
DROP FUNCTION IF EXISTS invite_to_organization(UUID, UUID);

CREATE FUNCTION invite_to_organization(p_organization_id UUID, p_user_id UUID, p_as_admin BOOLEAN DEFAULT FALSE)
RETURNS TEXT AS $$
DECLARE
  v_existing_status TEXT;
BEGIN
  IF NOT is_org_admin(p_organization_id) THEN
    RAISE EXCEPTION 'Apenas admins podem convidar membros';
  END IF;

  IF EXISTS (
    SELECT 1 FROM memberships
    WHERE organization_id = p_organization_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Este jogador já é membro do clube';
  END IF;

  SELECT status INTO v_existing_status
  FROM organization_invites
  WHERE organization_id = p_organization_id AND invited_user_id = p_user_id;

  IF v_existing_status IS NULL THEN
    INSERT INTO organization_invites (organization_id, invited_user_id, invited_by, as_admin)
    VALUES (p_organization_id, p_user_id, auth.uid(), COALESCE(p_as_admin, FALSE));
  ELSE
    -- Reenviar, ou reabrir depois de recusado: fica com a intenção mais
    -- recente (um convite de membro pendente pode passar a convite de admin).
    UPDATE organization_invites
    SET status = 'pending',
        invited_by = auth.uid(),
        as_admin = COALESCE(p_as_admin, FALSE),
        created_at = CASE WHEN v_existing_status = 'pending' THEN created_at ELSE TIMEZONE('utc', NOW()) END
    WHERE organization_id = p_organization_id AND invited_user_id = p_user_id;
  END IF;

  RETURN 'pending';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION invite_to_organization(UUID, UUID, BOOLEAN) FROM anon, public;
GRANT EXECUTE ON FUNCTION invite_to_organization(UUID, UUID, BOOLEAN) TO authenticated;

-- Igual a migration_self_serve_groups.sql, mais o ramo do convite de admin:
-- um admin escolheu esta pessoa, por isso entra logo como admin, sem passar
-- pelo pedido de aprovação que os convites de membro têm nos grupos da
-- Comunidade.
CREATE OR REPLACE FUNCTION accept_organization_invite(p_invite_id UUID)
RETURNS VOID AS $$
DECLARE
  v_org_id UUID;
  v_as_admin BOOLEAN;
BEGIN
  SELECT organization_id, as_admin INTO v_org_id, v_as_admin
  FROM organization_invites
  WHERE id = p_invite_id AND invited_user_id = auth.uid() AND status = 'pending';

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Convite não encontrado ou já resolvido';
  END IF;

  IF EXISTS (SELECT 1 FROM organizations WHERE id = v_org_id AND self_serve)
     AND NOT EXISTS (SELECT 1 FROM memberships WHERE organization_id = v_org_id AND user_id = auth.uid())
     AND (SELECT COUNT(*) FROM memberships WHERE organization_id = v_org_id) >= 30 THEN
    RAISE EXCEPTION 'Grupo já atingiu o limite de 30 membros';
  END IF;

  IF v_as_admin THEN
    INSERT INTO memberships (user_id, organization_id, is_admin)
    VALUES (auth.uid(), v_org_id, TRUE)
    ON CONFLICT (user_id, organization_id) DO UPDATE SET is_admin = TRUE;

    DELETE FROM membership_requests
    WHERE user_id = auth.uid() AND organization_id = v_org_id AND status = 'pending';
  ELSIF EXISTS (SELECT 1 FROM organizations WHERE id = v_org_id AND self_serve) THEN
    INSERT INTO membership_requests (user_id, organization_id)
    VALUES (auth.uid(), v_org_id)
    ON CONFLICT (user_id, organization_id) WHERE (status = 'pending') DO NOTHING;
  ELSE
    INSERT INTO memberships (user_id, organization_id)
    VALUES (auth.uid(), v_org_id)
    ON CONFLICT (user_id, organization_id) DO NOTHING;
  END IF;

  UPDATE organization_invites SET status = 'accepted' WHERE id = p_invite_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION accept_organization_invite(UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION accept_organization_invite(UUID) TO authenticated;

-- A lista de convites recebidos passa a dizer se é para admin. Muda o tipo
-- devolvido, por isso DROP + CREATE.
DROP FUNCTION IF EXISTS list_incoming_organization_invites();

CREATE FUNCTION list_incoming_organization_invites()
RETURNS TABLE (
  id UUID,
  organization_id UUID,
  organization_name TEXT,
  organization_logo_url TEXT,
  invited_by_name TEXT,
  created_at TIMESTAMPTZ,
  as_admin BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT oi.id, o.id, o.name, o.group_logo_url, p.name, oi.created_at, oi.as_admin
  FROM organization_invites oi
  JOIN organizations o ON o.id = oi.organization_id
  JOIN profiles p ON p.id = oi.invited_by
  WHERE oi.invited_user_id = auth.uid() AND oi.status = 'pending'
  ORDER BY oi.created_at DESC;
$$;

REVOKE EXECUTE ON FUNCTION list_incoming_organization_invites() FROM anon, public;
GRANT EXECUTE ON FUNCTION list_incoming_organization_invites() TO authenticated;
