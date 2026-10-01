-- ═════════════════════════════════════════════════════════════════════════
-- Telemóvel repetido: só avisar (#598)
--
-- PORQUÊ. Francisco, 1 out (topo do cartão #598): «só avisa». Quem põe um
-- telemóvel que já existe noutra conta é avisado e pode continuar, sem
-- bloqueio, até haver SMS (#596). Ecrã: Dev 4.
--
-- O QUE FAZ. my_phone_in_other_account() → boolean: o telemóvel que a
-- pessoa tem AGORA no perfil (profiles.phone_hash, que a app grava) está
-- noutra conta? Não diz de quem. Sem argumentos de propósito: uma função
-- que recebesse um hash deixava testar números de outras pessoas para
-- saber se estão na Alinho. Os convidados do WhatsApp com o mesmo número
-- não contam (são a própria pessoa antes de ter conta; desde 29 set já não
-- se juntam ao confirmar o número — ficam por juntar até haver SMS, #596),
-- nem os perfis já juntados.
--
-- Dev 3, 1 out 2026 · ecrã: Dev 4
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.my_phone_in_other_account()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM profiles me
      JOIN profiles o ON o.phone_hash = me.phone_hash AND o.id <> me.id
     WHERE me.id = auth.uid()
       AND me.phone_hash IS NOT NULL
       AND COALESCE(o.email, '') NOT LIKE 'guest-%@whatsapp.alinho.pt'
       AND o.name NOT LIKE '% (juntado)');
$$;
REVOKE ALL ON FUNCTION public.my_phone_in_other_account() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.my_phone_in_other_account() FROM anon;
GRANT EXECUTE ON FUNCTION public.my_phone_in_other_account() TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT has_function_privilege('anon', 'public.my_phone_in_other_account()', 'EXECUTE');  -- false
