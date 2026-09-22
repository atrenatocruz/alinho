-- Email de convite de clube (spec: docs/superpowers/specs/2026-09-21-smtp-email-transacional-design.md)
--
-- A Edge Function `send-email` envia um email ao convidado quando um admin o
-- convida para um clube. Esta migração dá-lhe a forma atómica de garantir
-- "um email por convite": quem conseguir marcar emailed_at é quem envia.
--
-- Correr à mão no SQL Editor ANTES de fazer deploy da função.

ALTER TABLE organization_invites ADD COLUMN IF NOT EXISTS emailed_at TIMESTAMPTZ;

-- Identifica o convite pelo par (clube, convidado) — é UNIQUE na tabela e é o
-- que o cliente tem à mão depois de invite_to_organization, que não devolve o id.
--
-- Só devolve uma linha se este chamador criou o convite, o convite está
-- pendente e ainda não foi enviado email para esta "vida" do convite.
-- invite_to_organization repõe created_at quando reabre um convite recusado,
-- por isso emailed_at < created_at volta a permitir um envio nesse caso —
-- mas reenviar um convite ainda pendente não gera segundo email.
--
-- p_caller_id vem do JWT que a Edge Function já validou: a função corre com
-- a service-role key, onde auth.uid() é NULL. Por isso mesmo o EXECUTE é só
-- para service_role — chamado por um utilizador, p_caller_id seria forjável.
CREATE OR REPLACE FUNCTION claim_organization_invite_email(p_organization_id UUID, p_invited_user_id UUID, p_caller_id UUID)
RETURNS TABLE (
  invited_user_id UUID,
  invited_language TEXT,
  organization_name TEXT,
  invited_by_name TEXT,
  as_admin BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    UPDATE organization_invites oi
    SET emailed_at = TIMEZONE('utc', NOW())
    WHERE oi.organization_id = p_organization_id
      AND oi.invited_user_id = p_invited_user_id
      AND oi.invited_by = p_caller_id
      AND oi.status = 'pending'
      AND (oi.emailed_at IS NULL OR oi.emailed_at < oi.created_at)
    RETURNING oi.invited_user_id, oi.organization_id, oi.invited_by, oi.as_admin
  )
  SELECT c.invited_user_id, invited.language, o.name, inviter.name, c.as_admin
  FROM claimed c
  JOIN organizations o ON o.id = c.organization_id
  JOIN profiles invited ON invited.id = c.invited_user_id
  JOIN profiles inviter ON inviter.id = c.invited_by;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION claim_organization_invite_email(UUID, UUID, UUID) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION claim_organization_invite_email(UUID, UUID, UUID) TO service_role;
