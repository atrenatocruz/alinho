-- ─── Professores: sem clube, com zona, visíveis a todos (Trello #274, #283) ──
-- Francisco, 16 set 2026 (épico «Comunidade vs. Rankings»):
-- - Um professor normalmente tem clube, mas pode não ter → "Sem clube
--   associado". O pedido passa a fazer-se no Perfil.
-- - Encontra-se na pesquisa da Comunidade por nome, clube ou zona.
-- - Professores aprovados veem-se por qualquer jogador (antes: só membros do
--   mesmo clube), como os jogadores desde 11 set.
--
-- POR DEFINIR (Francisco, cartão «Professores: pedido e verificação»): quem
-- aprova e que prova se pede. Até lá, PROPOSTA: com clube → os admins desse
-- clube (como hoje); sem clube → os admins da plataforma.
-- Independente das outras migrações por correr.

-- ── 1. Colunas ──────────────────────────────────────────────────────────────
ALTER TABLE teacher_profiles ALTER COLUMN organization_id DROP NOT NULL;
ALTER TABLE teacher_profiles ADD COLUMN IF NOT EXISTS zone TEXT;

-- UNIQUE (user_id, organization_id) não trava NULLs repetidos: no máximo um
-- pedido "sem clube" por pessoa.
CREATE UNIQUE INDEX IF NOT EXISTS teacher_profiles_one_without_club
  ON teacher_profiles (user_id) WHERE organization_id IS NULL;

-- O professor pode corrigir contacto e zona (antes só contacto).
GRANT UPDATE (contact, zone) ON teacher_profiles TO authenticated;

-- ── 2. Quem vê ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "View teacher profiles" ON teacher_profiles;
CREATE POLICY "View teacher profiles"
  ON teacher_profiles FOR SELECT
  USING (
    status = 'approved'
    OR user_id = auth.uid()
    OR (organization_id IS NOT NULL AND is_org_admin(organization_id))
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_platform_admin)
  );

-- Horários: a mesma regra do perfil a que pertencem.
DROP POLICY IF EXISTS "View availability with parent profile" ON teacher_availability;
CREATE POLICY "View availability with parent profile"
  ON teacher_availability FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM teacher_profiles tp
      WHERE tp.id = teacher_availability.teacher_profile_id
        AND (
          tp.status = 'approved'
          OR tp.user_id = auth.uid()
          OR (tp.organization_id IS NOT NULL AND is_org_admin(tp.organization_id))
          OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_platform_admin)
        )
    )
  );

-- ── 3. Pedir ────────────────────────────────────────────────────────────────
-- Com clube: só quem é membro desse clube (como antes). Sem clube: qualquer
-- jogador. Entra sempre como pendente.
DROP POLICY IF EXISTS "Members can request to teach" ON teacher_profiles;
CREATE POLICY "Members can request to teach"
  ON teacher_profiles FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND status = 'pending'
    AND (
      organization_id IS NULL
      OR EXISTS (
        SELECT 1 FROM memberships m
        WHERE m.organization_id = teacher_profiles.organization_id AND m.user_id = auth.uid()
      )
    )
  );

-- ── 4. Aprovar / recusar ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION approve_teacher_profile(p_id UUID)
RETURNS void AS $$
DECLARE
  v_org_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM teacher_profiles WHERE id = p_id AND status = 'pending') THEN
    RAISE EXCEPTION 'Pedido não encontrado ou já resolvido';
  END IF;
  SELECT organization_id INTO v_org_id FROM teacher_profiles WHERE id = p_id;
  IF NOT (
    (v_org_id IS NOT NULL AND is_org_admin(v_org_id))
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_platform_admin)
  ) THEN
    RAISE EXCEPTION 'Apenas admins podem aprovar pedidos de professor';
  END IF;

  UPDATE teacher_profiles
  SET status = 'approved', resolved_at = NOW(), resolved_by = auth.uid()
  WHERE id = p_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION approve_teacher_profile(UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION approve_teacher_profile(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION reject_teacher_profile(p_id UUID)
RETURNS void AS $$
DECLARE
  v_org_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM teacher_profiles WHERE id = p_id AND status = 'pending') THEN
    RAISE EXCEPTION 'Pedido não encontrado ou já resolvido';
  END IF;
  SELECT organization_id INTO v_org_id FROM teacher_profiles WHERE id = p_id;
  IF NOT (
    (v_org_id IS NOT NULL AND is_org_admin(v_org_id))
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_platform_admin)
  ) THEN
    RAISE EXCEPTION 'Apenas admins podem recusar pedidos de professor';
  END IF;

  UPDATE teacher_profiles
  SET status = 'rejected', resolved_at = NOW(), resolved_by = auth.uid()
  WHERE id = p_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION reject_teacher_profile(UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION reject_teacher_profile(UUID) TO authenticated;
