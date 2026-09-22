-- ════════════════════════════════════════════════════════════════════════
-- Eliminar um grupo/clube volta a ser só do DONO (Trello #261).
--
-- Regressão: desde os vários admins (#261), get_organization_delete_blocker
-- aceita QUALQUER admin da organização — `is_org_admin(p_org_id)`. Ou seja,
-- um admin convidado pode apagar o grupo inteiro, com os membros, convites
-- e ligação ao WhatsApp, sem ser dono dele.
--
-- O ecrã já está do lado certo: GerirClube.jsx trata o código 'not_owner' e
-- tem o texto «Só o dono do clube o pode eliminar.» em pt e en. Só a base
-- de dados é que ficou permissiva — e é ela a fronteira que conta, porque
-- qualquer pessoa pode chamar a função diretamente, sem passar pelo ecrã.
--
-- O que muda: a verificação passa de "é admin" para "é o dono
-- (organizations.owner_id) ou admin da plataforma". Tudo o resto —
-- self_serve, subgrupos, atividade — fica igual.
--
-- Nota: organizations.owner_id pode ser NULL em organizações antigas
-- (criadas antes do dono existir, ou cujo dono apagou a conta —
-- ON DELETE SET NULL). Nesses casos ninguém que não seja admin da
-- plataforma consegue eliminar, o que é o lado seguro: o Renato ou o
-- Francisco resolvem à mão.
--
-- É seguro re-correr.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_organization_delete_blocker(p_org_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_org organizations%ROWTYPE;
  v_is_platform_admin BOOLEAN;
BEGIN
  IF auth.uid() IS NULL OR COALESCE((auth.jwt()->>'is_anonymous')::boolean, FALSE) THEN
    RETURN 'not_authenticated';
  END IF;

  SELECT * INTO v_org FROM organizations WHERE id = p_org_id;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  SELECT COALESCE(is_platform_admin, FALSE) INTO v_is_platform_admin FROM profiles WHERE id = auth.uid();

  -- Só o dono, ou a plataforma. Antes bastava ser admin da organização.
  IF NOT (v_org.owner_id = auth.uid() OR v_is_platform_admin) THEN
    RETURN 'not_owner';
  END IF;

  IF NOT v_org.self_serve AND NOT v_is_platform_admin THEN
    RETURN 'not_self_serve';
  END IF;

  IF EXISTS (SELECT 1 FROM organizations WHERE parent_organization_id = p_org_id) THEN
    RETURN 'has_subgroups';
  END IF;

  IF EXISTS (SELECT 1 FROM games WHERE organization_id = p_org_id)
     OR EXISTS (SELECT 1 FROM game_recurrences WHERE organization_id = p_org_id)
     OR EXISTS (SELECT 1 FROM group_matches WHERE organization_id = p_org_id)
     OR EXISTS (SELECT 1 FROM player_stats WHERE organization_id = p_org_id)
     OR EXISTS (SELECT 1 FROM mix_player_stats WHERE organization_id = p_org_id) THEN
    RETURN 'has_activity';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION get_organization_delete_blocker(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION get_organization_delete_blocker(UUID) TO authenticated;

-- ── Verificação ──────────────────────────────────────────────────────────
-- Deve dizer que a função já exige o dono:
-- SELECT pg_get_functiondef(oid) ~ 'owner_id = auth.uid' AS exige_dono
-- FROM pg_proc WHERE proname = 'get_organization_delete_blocker';
--
-- Organizações sem dono definido (só a plataforma as pode eliminar):
-- SELECT count(*) FROM organizations WHERE owner_id IS NULL;
