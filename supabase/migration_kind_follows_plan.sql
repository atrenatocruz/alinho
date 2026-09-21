-- ════════════════════════════════════════════════════════════════════════
-- Migration: o tipo (clube/grupo) passa a seguir o plano.
--
-- Francisco, 18 set 2026: "Só és clube se tiveres a subscrição club. Até lá
-- és sempre grupo. A gente não tem de trocar isso manualmente." E: "se eu
-- cancelar ou reduzir a subscrição ele volta a grupo com as limitações do
-- seu plano." Objetivo: qualquer dono de clube, em qualquer país, passa de
-- grupo a clube só por pagar a subscrição, sem nos pedir nada.
--
-- Substitui a regra de 15 set ("o plano é independente do tipo", escrita em
-- migration_organization_plan_tier.sql). PROPOSTA — A VALIDAR PELO RENATO.
--
-- O QUE FAZ
-- 1. Trigger em organizations: plan_tier = 'club' → kind = 'club'; qualquer
--    outro plano → kind = 'group'. Grupos dentro de um clube
--    (parent_organization_id) são sempre 'group'. Corre em INSERT e em
--    qualquer UPDATE de plan_tier, parent_organization_id ou kind — por isso
--    não há forma de ficarem desencontrados (admin_set_organization_plan,
--    SQL à mão, e os pagamentos quando existirem).
--    Nome escolhido para correr DEPOIS de trg_inherit_parent_plan_tier
--    (os triggers BEFORE correm por ordem alfabética): um subgrupo herda
--    primeiro o plano do clube e só depois se decide o tipo.
--
-- 2. Onde "ser clube" era usado para querer dizer "ser público", passa a
--    olhar para is_global. Sem isto, o "+1 Grupo de Padel" (público, plano
--    Community) perdia, ao passar a grupo: a lista de membros visível a
--    não-membros, os mixes abertos na página dele, o ranking de
--    organizações e o nome dele na pesquisa de jogadores. Bate com a decisão
--    de 16 set (https://trello.com/c/FfeecRhJ): público vê membros,
--    fechado não.
--    Funções: get_club_profile, list_organization_members,
--    get_organization_rankings, list_players, search_players.
--
-- 3. O que É de clube continua a exigir kind = 'club' — e agora isso quer
--    dizer "tem plano Club": professores (policy de teacher_profiles),
--    grupos dentro do clube (create_group, list_club_groups).
--
-- AO BAIXAR DE PLANO
-- Ninguém é expulso, nada se apaga. Quem estiver acima dos limites do plano
-- novo fica, só não pode criar mais (migration_plan_limits.sql). Os
-- subgrupos e os professores ficam guardados; a app só os mostra quando
-- kind = 'club', por isso voltam se o clube voltar a subscrever.
--
-- NÃO INCLUÍDO — FALTA
-- get_player_profile também filtra os clubes do jogador por
-- kind = 'club' ("os meus clubes" no perfil). Tem 7 versões nos ficheiros e
-- não é seguro reescrevê-la sem ler a que está viva. Até ser corrigida, o
-- "+1 Grupo de Padel" deixa de aparecer nessa lista quando passar a grupo.
--
-- DADOS: no fim, recalcula o tipo de todas as organizações. Em produção a
-- 18 set: "+ 1 Grupo de Padel" (pro) → grupo · "Clube de teste" (free) →
-- grupo · "Alinho Grupo Padel" (club) → fica clube. Query de revisão no fim.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- Testado em alinho-dev a 18 set 2026.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. O tipo segue o plano ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION kind_follows_plan()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.kind := CASE
    WHEN NEW.parent_organization_id IS NOT NULL THEN 'group'
    WHEN NEW.plan_tier = 'club' THEN 'club'
    ELSE 'group'
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_kind_follows_plan ON organizations;
CREATE TRIGGER trg_kind_follows_plan
  BEFORE INSERT OR UPDATE OF plan_tier, parent_organization_id, kind ON organizations
  FOR EACH ROW EXECUTE FUNCTION kind_follows_plan();

-- ── 2. Público em vez de "clube" ────────────────────────────────────────

-- Página do clube/grupo. Duas mudanças, marcadas com ◆.
CREATE OR REPLACE FUNCTION public.get_club_profile(p_slug text)
 RETURNS TABLE(id uuid, name text, slug text, description text, location text, phone text, instagram text, website text, group_logo_url text, kind text, parent_organization_id uuid, parent_name text, parent_slug text, open_join boolean, member_count bigint, my_status text, open_games jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      ) AND NOT o.is_global THEN '[]'::jsonb  -- ◆ era (o.kind = 'group' OR NOT o.is_global)
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
      OR o.is_global   -- ◆ era (o.kind = 'club' AND o.is_global = TRUE)
      OR o.self_serve  -- ◆ era (o.kind = 'group' AND o.self_serve): um grupo criado
                       --   por um utilizador que suba a Club continua a ter página
    );
$function$;

-- Lista de membros: pública num clube/grupo público, só para membros num
-- fechado — seja clube ou grupo.
CREATE OR REPLACE FUNCTION public.list_organization_members(p_organization_id uuid)
 RETURNS TABLE(id uuid, name text, avatar_url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.id, p.name, p.avatar_url
  FROM memberships m
  JOIN profiles p ON p.id = m.user_id
  WHERE m.organization_id = p_organization_id
    AND m.is_guest = FALSE
    AND can_view_section(p.id, p.clubs_visibility)
    AND EXISTS (
      SELECT 1 FROM organizations o
      WHERE o.id = p_organization_id
        AND (
          o.is_global = TRUE
          OR is_org_admin(o.id)
          OR EXISTS (
            SELECT 1 FROM memberships vm WHERE vm.organization_id = o.id AND vm.user_id = auth.uid()
          )
        )
    )
  ORDER BY p.name;
$function$;

-- Ranking de organizações: as públicas de topo, clubes e grupos.
CREATE OR REPLACE FUNCTION public.get_organization_rankings()
 RETURNS TABLE(id uuid, name text, slug text, group_logo_url text, kind text, member_count bigint, total_points bigint, avg_rating numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    o.id,
    o.name,
    o.slug,
    o.group_logo_url,
    o.kind,
    (SELECT COUNT(*) FROM memberships m WHERE m.organization_id = o.id) AS member_count,
    COALESCE((SELECT SUM(ps.total_points) FROM player_stats ps WHERE ps.organization_id = o.id), 0) AS total_points,
    (
      SELECT AVG(p.rating)
      FROM memberships m
      JOIN profiles p ON p.id = m.user_id
      WHERE m.organization_id = o.id
        AND m.is_guest = FALSE
        AND p.rating IS NOT NULL
    ) AS avg_rating
  FROM organizations o
  WHERE o.is_global = TRUE AND o.parent_organization_id IS NULL  -- era AND o.kind = 'club'
  ORDER BY avg_rating DESC NULLS LAST, o.name;
$function$;

-- Pesquisa de jogadores: o nome do clube/grupo ao lado do jogador. Mantém
-- os clubes que já apareciam e junta os grupos públicos.
CREATE OR REPLACE FUNCTION public.list_players(p_limit integer DEFAULT 20)
 RETURNS TABLE(id uuid, name text, avatar_url text, club_names text, rating numeric, gender text, preferred_side text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.id, p.name, p.avatar_url, clubs.club_names, p.rating, p.gender, p.preferred_side
  FROM profiles p
  LEFT JOIN LATERAL (
    SELECT string_agg(DISTINCT o.name, ', ' ORDER BY o.name) AS club_names
    FROM memberships m
    JOIN organizations o ON o.id = m.organization_id
    WHERE m.user_id = p.id AND (o.kind = 'club' OR o.is_global)  -- era o.kind = 'club'
  ) clubs ON true
  WHERE p.id <> auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM memberships m WHERE m.user_id = p.id AND m.is_test = true
    )
  ORDER BY p.created_at DESC
  LIMIT p_limit;
$function$;

CREATE OR REPLACE FUNCTION public.search_players(p_query text)
 RETURNS TABLE(id uuid, name text, avatar_url text, club_names text, rating numeric, gender text, preferred_side text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.id, p.name, p.avatar_url, clubs.club_names, p.rating, p.gender, p.preferred_side
  FROM profiles p
  LEFT JOIN LATERAL (
    SELECT string_agg(DISTINCT o.name, ', ' ORDER BY o.name) AS club_names
    FROM memberships m
    JOIN organizations o ON o.id = m.organization_id
    WHERE m.user_id = p.id AND (o.kind = 'club' OR o.is_global)  -- era o.kind = 'club'
  ) clubs ON true
  WHERE length(trim(p_query)) >= 2
    AND p.id <> auth.uid()
    AND p.name ILIKE '%' || trim(p_query) || '%'
    AND NOT EXISTS (
      SELECT 1 FROM memberships m WHERE m.user_id = p.id AND m.is_test = true
    )
  ORDER BY p.name
  LIMIT 10;
$function$;

-- ── 3. Dados: recalcular o tipo de todas ────────────────────────────────
-- O SET toca em plan_tier, e é isso que dispara o trigger.
UPDATE organizations SET plan_tier = plan_tier;

-- ── Revisão (Renato) — antes e depois: ──────────────────────────────────
-- SELECT name, kind, plan_tier, is_global, searchable,
--        parent_organization_id IS NOT NULL AS dentro_de_clube
-- FROM organizations ORDER BY kind, name;
