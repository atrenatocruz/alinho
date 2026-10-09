-- ═════════════════════════════════════════════════════════════════════════
-- Cancelar o meu pedido de entrada num clube/grupo fechado
--
-- PORQUÊ. A 8 out um jogador pediu por engano para entrar no «+ 1 Grupo de
-- Padel» e não conseguiu desfazer: o perfil do grupo só mostrava «Pedido
-- enviado», e membership_requests só tem políticas de escrita para os admins.
-- Francisco: «deveria dar para cancelar pedido, ou sair dum grupo».
--
-- O QUE FAZ
--   cancel_membership_request(p_organization_id) → 'cancelled': apaga o MEU
--   pedido pendente nesse clube/grupo. Deixa de aparecer nos «Pedidos de
--   entrada» do admin (que só lê os 'pending'), e a pessoa pode voltar a
--   pedir (follow_organization cria um novo). Apaga-se em vez de ganhar um
--   estado novo: o CHECK de status só tem pending/approved/rejected e um
--   pedido cancelado não tem história que interesse ao admin.
--   Sem pedido pendente (já foi aceite ou recusado): 'not_pending', sem erro
--   — a app recarrega e mostra o estado certo.
--
-- Bugs, 8 out 2026. Sem dependências: pode correr a qualquer altura, e mais
-- do que uma vez. Run this whole file in Supabase → SQL Editor → Run.
-- ═════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.cancel_membership_request(p_organization_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  DELETE FROM membership_requests
   WHERE organization_id = p_organization_id
     AND user_id = auth.uid()
     AND status = 'pending';
  IF NOT FOUND THEN
    RETURN 'not_pending';
  END IF;
  RETURN 'cancelled';
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_membership_request(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_membership_request(UUID) TO authenticated;

-- Verificar depois de correr:
--   SELECT has_function_privilege('anon', 'public.cancel_membership_request(uuid)', 'EXECUTE');           -- false
--   SELECT has_function_privilege('authenticated', 'public.cancel_membership_request(uuid)', 'EXECUTE');  -- true
