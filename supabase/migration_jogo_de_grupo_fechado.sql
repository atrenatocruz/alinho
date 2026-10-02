-- ═════════════════════════════════════════════════════════════════════════
-- Link de um jogo de um grupo onde não estou: dizer de que grupo é
--
-- PORQUÊ. SPEC design-handoff/2026-10-01-jogo-de-grupo-fechado (aprovada
-- pelo Francisco a 2 out): hoje quem abre o link vê «Jogo não encontrado»,
-- e o jogo existe — só não é visível. Ecrã: Dev 2 (formato combinado com
-- ele).
--
-- O QUE FAZ. get_game_org_hint(p_game_id) RETURNS TABLE (org_name,
-- org_slug, org_kind, org_logo_url, org_visible). Nada do jogo.
--   · Procura o id nos mixes / jogos em aberto (games) e, se não estiver
--     lá, nos jogos entre amigos (private_matches, pela raiz da sessão).
--   · Sem linhas: o jogo não existe (foi apagado), é rascunho, está
--     cancelado, ou é um jogo entre amigos sem grupo → «Jogo não encontrado».
--   · org_visible = o grupo ou clube tem página para quem não é membro —
--     a mesma regra do get_club_profile: pesquisável (org_is_findable), ou
--     global, ou criado pelo próprio utilizador (self_serve). Senão é
--     «privado»: org_name, org_slug e org_logo_url vêm a null (o nome não
--     sai da base de dados) e só vem o org_kind.
--   · Só com sessão.
--
-- Dev 3, 2 out 2026 · ecrã: Dev 2
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.get_game_org_hint(p_game_id UUID)
RETURNS TABLE (org_name TEXT, org_slug TEXT, org_kind TEXT, org_logo_url TEXT, org_visible BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH dono AS (
    SELECT g.organization_id AS org_id
      FROM games g
     WHERE g.id = p_game_id AND g.status NOT IN ('draft', 'cancelled')
    UNION ALL
    SELECT r.organization_id
      FROM private_matches pm
      JOIN private_matches r ON r.id = COALESCE(pm.session_id, pm.id)
     WHERE pm.id = p_game_id
       AND NOT EXISTS (SELECT 1 FROM games g2 WHERE g2.id = p_game_id)
  ), org AS (
    SELECT o.*, (org_is_findable(o) OR o.is_global OR o.self_serve) AS visivel
      FROM dono d JOIN organizations o ON o.id = d.org_id
     WHERE auth.uid() IS NOT NULL
     LIMIT 1
  )
  SELECT CASE WHEN visivel THEN name END,
         CASE WHEN visivel THEN slug END,
         kind,
         CASE WHEN visivel THEN group_logo_url END,
         visivel
    FROM org;
$$;
REVOKE ALL ON FUNCTION public.get_game_org_hint(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_game_org_hint(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_game_org_hint(UUID) TO authenticated;

-- O mesmo para um torneio (Dev 1, 2 out): aceita o slug ou o id, como o
-- get_tournament_page. Sem linhas: não existe (ou foi apagado) ou ainda é
-- rascunho.
CREATE OR REPLACE FUNCTION public.get_tournament_org_hint(p_tournament TEXT)
RETURNS TABLE (org_name TEXT, org_slug TEXT, org_kind TEXT, org_logo_url TEXT, org_visible BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH org AS (
    SELECT o.*, (org_is_findable(o) OR o.is_global OR o.self_serve) AS visivel
      FROM tournaments t JOIN organizations o ON o.id = t.organization_id
     WHERE (t.slug = p_tournament OR t.id::text = p_tournament)
       AND t.status <> 'rascunho'
       AND auth.uid() IS NOT NULL
     LIMIT 1
  )
  SELECT CASE WHEN visivel THEN name END,
         CASE WHEN visivel THEN slug END,
         kind,
         CASE WHEN visivel THEN group_logo_url END,
         visivel
    FROM org;
$$;
REVOKE ALL ON FUNCTION public.get_tournament_org_hint(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_tournament_org_hint(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_tournament_org_hint(TEXT) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT has_function_privilege('anon', 'public.get_game_org_hint(uuid)', 'EXECUTE');  -- false
