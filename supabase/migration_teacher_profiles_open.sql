-- ─── Professores: sem clube, com zona, visíveis a todos (Trello #274, #283) ──
-- Francisco, 16 set 2026 (épico «Comunidade vs. Rankings»):
-- - Um professor normalmente tem clube, mas pode não ter → "Sem clube
--   associado". O pedido passa a fazer-se no Perfil.
-- - Encontra-se na pesquisa da Comunidade por nome, clube ou zona.
-- - Professores aprovados veem-se por qualquer jogador (antes: só membros do
--   mesmo clube), como os jogadores desde 11 set.
--
-- Quem aprova (Francisco, 16 set) — dois passos independentes:
-- 1. `status`: a equipa Alinho (super admin / admin da plataforma) confirma
--    que a pessoa é professor. Os admins do clube deixam de fazer isto.
-- 2. `club_status`: se escolheu um clube, os admins desse clube aceitam-no
--    como professor do clube. Só CLUBES — um grupo nunca tem professores.
--    Sem clube, club_status fica NULL.
-- O clube só aparece ao lado do professor depois de o clube aceitar.
-- Que prova se pede: ainda por definir.
-- Independente das outras migrações por correr.

-- ── 1. Colunas ──────────────────────────────────────────────────────────────
ALTER TABLE teacher_profiles ALTER COLUMN organization_id DROP NOT NULL;
ALTER TABLE teacher_profiles ADD COLUMN IF NOT EXISTS zone TEXT;
ALTER TABLE teacher_profiles ADD COLUMN IF NOT EXISTS club_status TEXT
  CHECK (club_status IN ('pending', 'accepted', 'rejected'));

-- Os pedidos que já existem foram decididos pelo clube: o clube já os aceitou
-- (aprovado), recusou, ou ainda tem para decidir (pendente).
UPDATE teacher_profiles
SET club_status = CASE status WHEN 'approved' THEN 'accepted' WHEN 'rejected' THEN 'rejected' ELSE 'pending' END
WHERE organization_id IS NOT NULL AND club_status IS NULL;

-- UNIQUE (user_id, organization_id) não trava NULLs repetidos: no máximo um
-- pedido "sem clube" por pessoa.
CREATE UNIQUE INDEX IF NOT EXISTS teacher_profiles_one_without_club
  ON teacher_profiles (user_id) WHERE organization_id IS NULL;

-- O professor pode corrigir contacto e zona (antes só contacto). Estados só
-- mudam pelas funções abaixo.
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
-- Qualquer jogador pede. Com clube: tem de ser um CLUBE (nunca um grupo) e
-- entra à espera do clube; já não é preciso ser membro — é o clube que aceita.
-- Sem clube: club_status vazio. Entra sempre como pendente.
DROP POLICY IF EXISTS "Members can request to teach" ON teacher_profiles;
CREATE POLICY "Members can request to teach"
  ON teacher_profiles FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND status = 'pending'
    AND (
      (organization_id IS NULL AND club_status IS NULL)
      OR (
        club_status = 'pending'
        AND EXISTS (SELECT 1 FROM organizations o WHERE o.id = teacher_profiles.organization_id AND o.kind = 'club')
      )
    )
  );

-- ── 4. Equipa Alinho: é professor? ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION approve_teacher_profile(p_id UUID)
RETURNS void AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM teacher_profiles WHERE id = p_id AND status = 'pending') THEN
    RAISE EXCEPTION 'Pedido não encontrado ou já resolvido';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_platform_admin) THEN
    RAISE EXCEPTION 'Só a equipa Alinho pode aprovar pedidos de professor';
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
BEGIN
  IF NOT EXISTS (SELECT 1 FROM teacher_profiles WHERE id = p_id AND status = 'pending') THEN
    RAISE EXCEPTION 'Pedido não encontrado ou já resolvido';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_platform_admin) THEN
    RAISE EXCEPTION 'Só a equipa Alinho pode recusar pedidos de professor';
  END IF;

  UPDATE teacher_profiles
  SET status = 'rejected', resolved_at = NOW(), resolved_by = auth.uid()
  WHERE id = p_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION reject_teacher_profile(UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION reject_teacher_profile(UUID) TO authenticated;

-- ── 5. Clube: aceita como professor do clube? ───────────────────────────────
-- Admins do clube (ou da plataforma). Não depende do passo 4 — pode vir antes
-- ou depois.
CREATE OR REPLACE FUNCTION resolve_teacher_club(p_id UUID, p_accept BOOLEAN)
RETURNS void AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT organization_id INTO v_org_id
  FROM teacher_profiles WHERE id = p_id AND club_status = 'pending';
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Pedido não encontrado ou já resolvido';
  END IF;
  IF NOT (
    is_org_admin(v_org_id)
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_platform_admin)
  ) THEN
    RAISE EXCEPTION 'Só os admins do clube podem aceitar professores';
  END IF;

  UPDATE teacher_profiles
  SET club_status = CASE WHEN p_accept THEN 'accepted' ELSE 'rejected' END
  WHERE id = p_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION resolve_teacher_club(UUID, BOOLEAN) FROM anon, public;
GRANT EXECUTE ON FUNCTION resolve_teacher_club(UUID, BOOLEAN) TO authenticated;
