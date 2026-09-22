-- Email de boas-vindas (Edge Function send-email, tipo `welcome`)
--
-- Um único email por conta, na primeira sessão — cobre tanto quem cria conta
-- com email + password (dispara depois de confirmar o email, que é quando a
-- primeira sessão existe) como quem entra com Google (primeiro login).
--
-- Correr à mão no SQL Editor ANTES de fazer redeploy da função send-email.
-- Correr DEPOIS de migration_organization_invite_email.sql (mesmo padrão).

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS welcome_emailed_at TIMESTAMPTZ;

-- Quem já cá estava não recebe "bem-vindo" com meses de atraso: marca-se
-- tudo como já enviado. Só perfis criados depois desta migração ficam a NULL.
UPDATE profiles SET welcome_emailed_at = TIMEZONE('utc', NOW()) WHERE welcome_emailed_at IS NULL;

-- Marca o envio e devolve o que a função precisa para compor o email. Só
-- devolve linha na primeira chamada (welcome_emailed_at IS NULL): duas
-- chamadas concorrentes → só uma envia.
--
-- p_user_id vem do JWT que a Edge Function já validou (a função corre com a
-- service-role key, onde auth.uid() é NULL) e a função só o passa como o
-- próprio chamador — ninguém pede o email de boas-vindas de outra pessoa.
-- EXECUTE só para service_role: chamado por um utilizador, seria forjável.
CREATE OR REPLACE FUNCTION claim_welcome_email(p_user_id UUID)
RETURNS TABLE (
  name TEXT,
  language TEXT
) AS $$
BEGIN
  RETURN QUERY
  UPDATE profiles p
  SET welcome_emailed_at = TIMEZONE('utc', NOW())
  WHERE p.id = p_user_id
    AND p.welcome_emailed_at IS NULL
  RETURNING p.name, p.language;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION claim_welcome_email(UUID) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION claim_welcome_email(UUID) TO service_role;
