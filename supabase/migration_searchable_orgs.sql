-- ─── Clubes e grupos sempre pesquisáveis (Trello #272, épico #271) ───────────
-- Francisco, 16 set 2026: qualquer clube ou grupo, público ou privado, tem de
-- se poder encontrar na pesquisa da Comunidade — tal como um jogador.
--
-- Até aqui `is_global` fazia três coisas de uma vez: aparecer na pesquisa,
-- mostrar os mixes a quem não é membro (Home → explorar, list_explore_events)
-- e contar para o ranking geral / abrir player_stats. Ligá-lo num grupo de
-- amigos só para ser encontrado expunha a agenda do grupo a desconhecidos.
-- Por isso, decisão do Francisco (opção "dois interruptores"):
--
--   searchable  (NOVO)  "Aparecer na pesquisa"  — ligado por defeito.
--   is_global   (igual) "Mostrar os mixes a quem não é membro" — o que já era.
--
-- Os que já existem ficam como estão: searchable = is_global. Só os criados
-- a partir daqui começam pesquisáveis (create_self_serve_group continua a
-- criar com is_global = FALSE, logo a agenda de um grupo novo fica fechada).
--
-- O que NÃO muda (a "fuga" de 26 ago, migration_club_scoped_groups.sql):
-- - A pesquisa nunca devolve nomes de membros — só nome, tipo, nº de membros
--   e nível médio. A lista de membros continua em list_organization_members,
--   que não é tocada aqui.
-- - Um grupo DENTRO de um clube só aparece a membros desse clube, e o nº de
--   membros / nível médio desse grupo só a quem é do grupo ou o gere — a
--   mesma visibilidade em camadas de list_club_groups.
--
-- ORDEM: correr DEPOIS de migration_plan_limits.sql (follow_organization
-- abaixo parte da versão dessa migração e usa org_max_members).
-- PROPOSTA — por confirmar pelo Renato antes de correr.

-- ── 1. Coluna nova ──────────────────────────────────────────────────────────
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS searchable BOOLEAN NOT NULL DEFAULT TRUE;

-- Os que já existem: exatamente como hoje (só aparecia quem era is_global).
UPDATE organizations SET searchable = is_global;

-- O admin muda-a no Gerir. GRANT de coluna soma-se aos que já existem
-- (migration_self_serve_groups.sql §7, migration_organization_location_grant.sql).
GRANT UPDATE (searchable) ON organizations TO authenticated;

-- ── 2. Quem aparece na pesquisa ─────────────────────────────────────────────
-- Uma org é "encontrável" por quem chama se estiver pesquisável e, sendo um
-- grupo dentro de um clube, se quem chama for membro desse clube.
CREATE OR REPLACE FUNCTION org_is_findable(p_org organizations)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT p_org.searchable
    AND (
      p_org.parent_organization_id IS NULL
      OR EXISTS (
        SELECT 1 FROM memberships m
        WHERE m.organization_id = p_org.parent_organization_id AND m.user_id = auth.uid()
      )
    );
$$;

REVOKE ALL ON FUNCTION org_is_findable(organizations) FROM public;
GRANT EXECUTE ON FUNCTION org_is_findable(organizations) TO authenticated;

-- nº de membros e nível médio: públicos, exceto num grupo dentro de um clube,
-- onde só os vê quem é do grupo ou o gere (igual a list_club_groups).
CREATE OR REPLACE FUNCTION org_stats_visible(p_org organizations)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT p_org.parent_organization_id IS NULL
    OR is_org_admin(p_org.id)
    OR EXISTS (
      SELECT 1 FROM memberships m WHERE m.organization_id = p_org.id AND m.user_id = auth.uid()
    );
$$;

REVOKE ALL ON FUNCTION org_stats_visible(organizations) FROM public;
GRANT EXECUTE ON FUNCTION org_stats_visible(organizations) TO authenticated;

-- ── 3. Diretório e pesquisa — mesmas colunas de migration_comunidade_card_details.sql ──
CREATE OR REPLACE FUNCTION list_global_organizations()
RETURNS TABLE (
  id UUID,
  name TEXT,
  slug TEXT,
  group_logo_url TEXT,
  kind TEXT,
  parent_organization_id UUID,
  parent_name TEXT,
  open_join BOOLEAN,
  member_count BIGINT,
  my_status TEXT,
  location TEXT,
  avg_rating NUMERIC
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    o.id, o.name, o.slug, o.group_logo_url, o.kind, o.parent_organization_id, parent.name,
    o.open_join,
    CASE WHEN org_stats_visible(o)
      THEN (SELECT COUNT(*) FROM memberships m WHERE m.organization_id = o.id)
    END,
    CASE
      WHEN EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = o.id AND m.user_id = auth.uid()) THEN 'member'
      WHEN EXISTS (SELECT 1 FROM membership_requests r WHERE r.organization_id = o.id AND r.user_id = auth.uid() AND r.status = 'pending') THEN 'pending'
      ELSE 'none'
    END,
    o.location,
    CASE WHEN org_stats_visible(o) THEN (
      SELECT AVG(p.rating)
      FROM memberships m
      JOIN profiles p ON p.id = m.user_id
      WHERE m.organization_id = o.id
        AND m.is_guest = FALSE
        AND p.rating IS NOT NULL
    ) END
  FROM organizations o
  LEFT JOIN organizations parent ON parent.id = o.parent_organization_id
  WHERE org_is_findable(o)
  ORDER BY o.name;
$$;

REVOKE ALL ON FUNCTION list_global_organizations() FROM public;
GRANT EXECUTE ON FUNCTION list_global_organizations() TO authenticated;

CREATE OR REPLACE FUNCTION search_organizations(p_query TEXT)
RETURNS TABLE (
  id UUID,
  name TEXT,
  slug TEXT,
  group_logo_url TEXT,
  kind TEXT,
  parent_organization_id UUID,
  parent_name TEXT,
  open_join BOOLEAN,
  member_count BIGINT,
  my_status TEXT,
  location TEXT,
  avg_rating NUMERIC
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    o.id, o.name, o.slug, o.group_logo_url, o.kind, o.parent_organization_id, parent.name,
    o.open_join,
    CASE WHEN org_stats_visible(o)
      THEN (SELECT COUNT(*) FROM memberships m WHERE m.organization_id = o.id)
    END,
    CASE
      WHEN EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = o.id AND m.user_id = auth.uid()) THEN 'member'
      WHEN EXISTS (SELECT 1 FROM membership_requests r WHERE r.organization_id = o.id AND r.user_id = auth.uid() AND r.status = 'pending') THEN 'pending'
      ELSE 'none'
    END,
    o.location,
    CASE WHEN org_stats_visible(o) THEN (
      SELECT AVG(p.rating)
      FROM memberships m
      JOIN profiles p ON p.id = m.user_id
      WHERE m.organization_id = o.id
        AND m.is_guest = FALSE
        AND p.rating IS NOT NULL
    ) END
  FROM organizations o
  LEFT JOIN organizations parent ON parent.id = o.parent_organization_id
  WHERE org_is_findable(o)
    AND o.name ILIKE '%' || trim(p_query) || '%'
  ORDER BY o.name
  LIMIT 20;
$$;

REVOKE ALL ON FUNCTION search_organizations(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION search_organizations(TEXT) TO authenticated;

-- ── 4. Página do clube/grupo — abre para quem o encontrou na pesquisa ───────
-- Base: migration_self_serve_groups.sql. Diferenças:
-- - também abre quando org_is_findable (senão o resultado da pesquisa dava
--   "não encontrado");
-- - open_games (a agenda) só vai para não-membros se is_global — num clube
--   pesquisável mas com os mixes fechados, fica vazia. Nos grupos já era
--   sempre vazia para não-membros e continua.
CREATE OR REPLACE FUNCTION get_club_profile(p_slug TEXT)
RETURNS TABLE (
  id UUID,
  name TEXT,
  slug TEXT,
  description TEXT,
  location TEXT,
  phone TEXT,
  instagram TEXT,
  website TEXT,
  group_logo_url TEXT,
  kind TEXT,
  parent_organization_id UUID,
  parent_name TEXT,
  parent_slug TEXT,
  open_join BOOLEAN,
  member_count BIGINT,
  my_status TEXT,
  open_games JSONB
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    o.id, o.name, o.slug, o.description, o.location, o.phone, o.instagram, o.website,
    o.group_logo_url, o.kind, o.parent_organization_id, parent.name, parent.slug,
    o.open_join,
    CASE WHEN org_stats_visible(o)
      THEN (SELECT COUNT(*) FROM memberships m WHERE m.organization_id = o.id)
    END,
    CASE
      WHEN EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = o.id AND m.user_id = auth.uid()) THEN 'member'
      WHEN EXISTS (SELECT 1 FROM membership_requests r WHERE r.organization_id = o.id AND r.user_id = auth.uid() AND r.status = 'pending') THEN 'pending'
      ELSE 'none'
    END,
    CASE
      WHEN NOT (
        is_org_admin(o.id) OR EXISTS (
          SELECT 1 FROM memberships m WHERE m.organization_id = o.id AND m.user_id = auth.uid()
        )
      ) AND (o.kind = 'group' OR NOT o.is_global) THEN '[]'::jsonb
      ELSE COALESCE((
        SELECT json_agg(json_build_object(
          'id', g.id,
          'title', g.title,
          'date', g.date,
          'location', g.location,
          'max_players', COALESCE(g.max_players, g.num_courts * 4),
          'confirmed_count', (
            SELECT COALESCE(SUM(1 + (p.partner_id IS NOT NULL)::int), 0)
            FROM participants p WHERE p.game_id = g.id AND p.status = 'confirmed'
          )
        ) ORDER BY g.date)
        FROM games g
        WHERE g.organization_id = o.id AND g.status NOT IN ('finished', 'completed', 'cancelled', 'pending')
      ), '[]'::json)::jsonb
    END
  FROM organizations o
  LEFT JOIN organizations parent ON parent.id = o.parent_organization_id
  WHERE o.slug = p_slug
    AND (
      org_is_findable(o)
      OR is_org_admin(o.id)
      OR EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = o.id AND m.user_id = auth.uid())
      OR (o.kind = 'club' AND o.is_global = TRUE)
      OR (o.kind = 'group' AND o.self_serve)
    );
$$;

REVOKE ALL ON FUNCTION get_club_profile(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION get_club_profile(TEXT) TO authenticated;

-- ── 5. Entrar / pedir entrada ───────────────────────────────────────────────
-- Base: migration_plan_limits.sql. Diferenças:
-- - Um grupo self-serve com "Entrada livre" deixa entrar logo (antes pedia
--   sempre, mesmo marcado como aberto).
-- - "Entrada livre" vale para quem se pode encontrar (searchable) ou tem os
--   mixes abertos (is_global); pedir entrada também.
-- - Grupo dentro de um clube: igual — só membros do clube, e sempre pedido.
CREATE OR REPLACE FUNCTION follow_organization(p_organization_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_kind TEXT;
  v_parent_id UUID;
  v_is_global BOOLEAN;
  v_searchable BOOLEAN;
  v_open_join BOOLEAN;
  v_self_serve BOOLEAN;
  v_max INTEGER;
BEGIN
  SELECT kind, parent_organization_id, is_global, searchable, open_join, self_serve
    INTO v_kind, v_parent_id, v_is_global, v_searchable, v_open_join, v_self_serve
  FROM organizations WHERE id = p_organization_id;

  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'Clube não encontrado';
  END IF;

  IF EXISTS (
    SELECT 1 FROM memberships WHERE user_id = auth.uid() AND organization_id = p_organization_id
  ) THEN
    RETURN 'joined';
  END IF;

  IF v_kind = 'group' AND v_parent_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM memberships WHERE user_id = auth.uid() AND organization_id = v_parent_id
    ) THEN
      RAISE EXCEPTION 'Só membros do clube podem pedir para entrar neste grupo';
    END IF;
  ELSIF v_open_join AND (v_is_global OR v_searchable) THEN
    v_max := org_max_members(p_organization_id);
    IF v_max IS NOT NULL
       AND (SELECT COUNT(*) FROM memberships WHERE organization_id = p_organization_id) >= v_max THEN
      RAISE EXCEPTION 'Grupo já atingiu o limite de % membros do plano', v_max;
    END IF;
    INSERT INTO memberships (user_id, organization_id)
    VALUES (auth.uid(), p_organization_id)
    ON CONFLICT (user_id, organization_id) DO NOTHING;
    RETURN 'joined';
  ELSIF NOT (v_is_global OR v_searchable OR (v_kind = 'group' AND v_self_serve)) THEN
    RAISE EXCEPTION 'Este clube não é público';
  END IF;

  INSERT INTO membership_requests (user_id, organization_id)
  VALUES (auth.uid(), p_organization_id)
  ON CONFLICT (user_id, organization_id) WHERE (status = 'pending') DO NOTHING;
  RETURN 'pending';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── 6. Revisão (Renato) ─────────────────────────────────────────────────────
-- Quem fica pesquisável depois de correr (deve ser igual a quem era is_global):
-- SELECT name, kind, self_serve, searchable, is_global, open_join FROM organizations ORDER BY kind, name;
