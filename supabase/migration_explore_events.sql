-- ════════════════════════════════════════════════════════════════════════
-- Home nova, Fase 2 — explorar eventos fora dos próprios clubes
-- (Homepage unificada, Trello #258). Wireframes:
-- https://claude.ai/artifact/JsYuipCSsUv4sLMnzAZtoU
--
-- Decisões do Francisco (16 set 2026):
-- - Só aparecem eventos de clubes/grupos que ESTÃO na Comunidade
--   (organizations.is_global). Os invisíveis continuam invisíveis — a
--   própria follow_organization recusa pedidos a clubes não públicos.
-- - Nomes de jogadores ESCONDIDOS a não-membros. Só se diz que um amigo
--   que o jogador segue é membro daquele clube/grupo.
-- - Pedido recusado: os eventos desse clube deixam de aparecer, sem mensagem.
--
-- SEGURANÇA — proposta, por acordar com o Renato
-- As tabelas NÃO abrem: games/participants continuam só para membros. O
-- único caminho é esta função, que escolhe o que devolve:
-- - eventos futuros de orgs is_global onde o jogador NÃO é membro;
-- - grupos dentro de um clube só se o jogador já for membro desse clube
--   (é a mesma regra que follow_organization aplica aos pedidos);
-- - por evento: nº de pessoas confirmadas, nível médio (sem convidados),
--   nunca quem são;
-- - por clube: nomes dos amigos que o jogador segue e que são membros —
--   informação que ele já teria ao abrir o perfil desses amigos;
-- - o estado do pedido de entrada do próprio.
--
-- ROBUSTEZ A MIGRAÇÕES POR CORRER
-- O evento vem como `to_jsonb(g)` e não coluna a coluna: level, origin,
-- age_restriction, latitude/longitude vivem em migrações que podem ainda não
-- ter corrido. Nomear uma coluna inexistente partia a criação desta função;
-- o JSON simplesmente não traz a chave. `created_by` sai do JSON — não é
-- preciso a quem explora.
--
-- Correr este ficheiro inteiro no Supabase → SQL Editor. Idempotente.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION list_explore_events(p_from TIMESTAMPTZ)
RETURNS TABLE (
  game JSONB,
  organization JSONB,
  people_count INTEGER,
  avg_rating NUMERIC,
  friends_in_org TEXT[],
  my_request_status TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH me AS (SELECT auth.uid() AS id),
  my_orgs AS (
    SELECT m.organization_id FROM memberships m, me WHERE m.user_id = me.id
  ),
  last_request AS (
    SELECT DISTINCT ON (r.organization_id) r.organization_id, r.status
    FROM membership_requests r, me
    WHERE r.user_id = me.id
    ORDER BY r.organization_id, r.created_at DESC
  ),
  explore_orgs AS (
    SELECT o.*
    FROM organizations o
    WHERE o.is_global
      AND o.id NOT IN (SELECT organization_id FROM my_orgs)
      AND (o.parent_organization_id IS NULL OR o.parent_organization_id IN (SELECT organization_id FROM my_orgs))
      AND NOT EXISTS (
        SELECT 1 FROM last_request lr WHERE lr.organization_id = o.id AND lr.status = 'rejected'
      )
  )
  SELECT
    to_jsonb(g) - 'created_by',
    jsonb_build_object(
      'id', o.id,
      'name', o.name,
      'slug', o.slug,
      'kind', o.kind,
      'group_logo_url', o.group_logo_url,
      'open_join', o.open_join,
      'latitude', to_jsonb(o) -> 'latitude',
      'longitude', to_jsonb(o) -> 'longitude'
    ),
    COALESCE((
      SELECT SUM(1 + CASE WHEN p.partner_id IS NOT NULL THEN 1 ELSE 0 END)::INTEGER
      FROM participants p WHERE p.game_id = g.id AND p.status = 'confirmed'
    ), 0),
    (
      SELECT AVG(pr.rating)
      FROM participants p
      JOIN profiles pr ON pr.id IN (p.user_id, p.partner_id)
      LEFT JOIN memberships mm ON mm.user_id = pr.id AND mm.organization_id = g.organization_id
      WHERE p.game_id = g.id AND p.status = 'confirmed'
        AND pr.rating IS NOT NULL AND COALESCE(mm.is_guest, false) = false
    ),
    COALESCE((
      SELECT ARRAY_AGG(fp.name ORDER BY fp.name)
      FROM follows f
      JOIN memberships fm ON fm.user_id = f.followed_id AND fm.organization_id = o.id
      JOIN profiles fp ON fp.id = f.followed_id
      WHERE f.follower_id = (SELECT id FROM me) AND f.status = 'accepted'
    ), ARRAY[]::TEXT[]),
    (SELECT lr.status FROM last_request lr WHERE lr.organization_id = o.id)
  FROM games g
  JOIN explore_orgs o ON o.id = g.organization_id
  WHERE g.date >= p_from
    AND g.status IN ('open', 'closed', 'in_progress')
  ORDER BY g.date;
$$;

REVOKE ALL ON FUNCTION list_explore_events(TIMESTAMPTZ) FROM public, anon;
GRANT EXECUTE ON FUNCTION list_explore_events(TIMESTAMPTZ) TO authenticated;
