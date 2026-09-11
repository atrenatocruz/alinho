-- ════════════════════════════════════════════════════════════════════════
-- Comunidade aberta a todos (Francisco, 11 set 2026)
--
-- Reverte a restrição de "só vês quem partilha clube/grupo contigo (ou está
-- num clube global)" adicionada em migration_club_scoped_groups.sql
-- (26 ago 2026) — decisão explícita: a Comunidade serve para encontrar
-- QUALQUER jogador da app e mandar pedido de amizade, independentemente de
-- grupo/clube. "Privado" nas definições do perfil (activity/results/clubs_
-- visibility) continua a controlar só o que se vê DENTRO do perfil de
-- alguém (estatísticas, clubes, confrontos diretos via get_player_profile/
-- get_head_to_head_*) — nunca controlou se a pessoa aparece na pesquisa, e
-- continua a não controlar isso depois desta migração.
--
-- Não mexe na política RLS da tabela `profiles` (continua restrita —
-- shares_org_with/in_global_org) nem em get_player_profile — só nestas duas
-- RPCs SECURITY DEFINER, que já devolvem apenas colunas não sensíveis
-- (id/name/avatar_url/club_names), exatamente para poderem ser mais abertas
-- que a tabela em si sem expor nada sensível (email, phone_hash, etc.).
--
-- Nota para o Renato: isto reabre, de propósito, a "fuga" que
-- migration_club_scoped_groups.sql tinha fechado (ver a subgroup ali) —
-- decisão explícita do Francisco de que não era uma fuga, era o
-- comportamento errado. Se houver uma razão forte para manter o scoping
-- por grupo, falar antes de correr isto.
--
-- Correr este ficheiro inteiro no Supabase → SQL Editor.
-- ════════════════════════════════════════════════════════════════════════

-- Postgres won't let CREATE OR REPLACE change a function's OUT-parameter
-- row type — drop first (same reason migration_comunidade_card_details.sql
-- had to, when it added rating/gender/preferred_side to these same two
-- functions).
DROP FUNCTION IF EXISTS search_players(TEXT);
DROP FUNCTION IF EXISTS list_players(INTEGER);

CREATE OR REPLACE FUNCTION search_players(p_query TEXT)
RETURNS TABLE (id UUID, name TEXT, avatar_url TEXT, club_names TEXT, rating NUMERIC, gender TEXT, preferred_side TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.name, p.avatar_url, clubs.club_names, p.rating, p.gender, p.preferred_side
  FROM profiles p
  LEFT JOIN LATERAL (
    SELECT string_agg(DISTINCT o.name, ', ' ORDER BY o.name) AS club_names
    FROM memberships m
    JOIN organizations o ON o.id = m.organization_id
    WHERE m.user_id = p.id AND o.kind = 'club'
  ) clubs ON true
  WHERE length(trim(p_query)) >= 2
    AND p.id <> auth.uid()
    AND p.name ILIKE '%' || trim(p_query) || '%'
    AND NOT EXISTS (
      SELECT 1 FROM memberships m WHERE m.user_id = p.id AND m.is_test = true
    )
  ORDER BY p.name
  LIMIT 10;
$$;

REVOKE ALL ON FUNCTION search_players(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION search_players(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION list_players(p_limit INTEGER DEFAULT 20)
RETURNS TABLE (id UUID, name TEXT, avatar_url TEXT, club_names TEXT, rating NUMERIC, gender TEXT, preferred_side TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.name, p.avatar_url, clubs.club_names, p.rating, p.gender, p.preferred_side
  FROM profiles p
  LEFT JOIN LATERAL (
    SELECT string_agg(DISTINCT o.name, ', ' ORDER BY o.name) AS club_names
    FROM memberships m
    JOIN organizations o ON o.id = m.organization_id
    WHERE m.user_id = p.id AND o.kind = 'club'
  ) clubs ON true
  WHERE p.id <> auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM memberships m WHERE m.user_id = p.id AND m.is_test = true
    )
  ORDER BY p.created_at DESC
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION list_players(INTEGER) FROM public;
GRANT EXECUTE ON FUNCTION list_players(INTEGER) TO authenticated;
