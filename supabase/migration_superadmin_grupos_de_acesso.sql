-- ═════════════════════════════════════════════════════════════════════════
-- Superadmin com o modo ligado volta a ter como seus os grupos de acesso
--
-- PORQUÊ. Bug em produção (PO, 29 out). A migration_superadmin_escondido.sql
-- (18 out) passou as inscrições de acesso do superadmin para
-- memberships_superadmin_acesso, para os outros não o verem nas listas. Mas a
-- app (AuthContext) só lê memberships, e por isso o superadmin deixou de ter
-- esses grupos como seus: na Home os mixes deles aparecem como «Pedir para
-- entrar» (caso real: o Francisco no Jota Padeleiros).
-- Regra do Francisco: para os outros é sempre um utilizador normal; com o
-- modo ligado vê e entra em tudo como antes de 18 out; com o modo desligado
-- vê a app como um jogador.
--
-- O QUE FAZ. get_my_superadmin_groups(): só leitura. Com o modo ligado
-- (is_platform_admin_me), devolve as linhas de memberships_superadmin_acesso
-- da própria conta que não têm par em memberships, no formato de
-- memberships.select('*, organization:organizations(*)'): um array jsonb com
-- as colunas da inscrição (sem moved_at) e «organization». Com o modo
-- desligado, ou para quem não é superadmin, devolve []. Não mexe em nenhuma
-- tabela nem nas listas que os outros veem. A app (Dev 2) junta estas linhas
-- às inscrições quando o modo está ligado.
--
-- ORDEM. Qualquer (a tabela e is_platform_admin_me já existem).
--
-- Dev 3, 29 out 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.get_my_superadmin_groups()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg((to_jsonb(a) - 'moved_at') || jsonb_build_object('organization', to_jsonb(o))
                            ORDER BY a.created_at, a.id), '[]'::jsonb)
    FROM memberships_superadmin_acesso a
    JOIN organizations o ON o.id = a.organization_id
   WHERE a.user_id = auth.uid()
     AND COALESCE(is_platform_admin_me(), FALSE)
     AND NOT EXISTS (SELECT 1 FROM memberships m
                      WHERE m.user_id = a.user_id AND m.organization_id = a.organization_id);
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_superadmin_groups() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_superadmin_groups() TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT has_function_privilege('anon', 'public.get_my_superadmin_groups()', 'EXECUTE'),
--          has_function_privilege('authenticated', 'public.get_my_superadmin_groups()', 'EXECUTE');
--     → false, true
--   SELECT provolatile, prosecdef FROM pg_proc WHERE proname = 'get_my_superadmin_groups';  → s, true
