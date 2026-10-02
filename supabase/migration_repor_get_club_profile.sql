-- ═════════════════════════════════════════════════════════════════════════
-- Repor o get_club_profile (bug grave, 1 out)
--
-- PORQUÊ. A migration_mix_guest_sem_conta.sql (Ruben, corrida em produção a
-- 1 out) copiou o corpo antigo do get_club_profile (migration_searchable_
-- orgs, 16 set) e só lhe juntou a contagem dos convidados. Ficaram
-- desfeitas quatro correções (SI, 1 out):
--   1. kind_follows_plan (18 set): grupos globais e grupos self-serve;
--   2. platform_admins_invisible (23 set): o número de membros pela
--      org_visible_member_count, e não COUNT(*);
--   3. club_page_pieces (24–25 set): 'origin', 'recurrence_id' e 'my_state'
--      nos eventos; a lista 'locked' para quem não é membro;
--   4. mix_draft (25 set): os rascunhos ('draft') fora da página do clube.
--
-- O QUE FAZ. Volta a pôr o corpo de 27 set (Infraestrutura/teste-alinho-dev/
-- 10-funcoes-04.sql, cópia de produção dessa noite) e junta-lhe a única
-- coisa nova do Ruben: o parceiro convidado conta na confirmed_count
-- (p.partner_guest_id). Conferido a 1 out contra o corpo vivo de produção:
-- não há mais nada novo no dele. Precisa da coluna
-- participants.partner_guest_id (da guest_sem_conta), por isso corre
-- DEPOIS dela. Grants como hoje (anon incluído: a página do clube abre sem
-- sessão).
--
-- Dev 3, 1 out 2026 · pedido do SI
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'participants' AND column_name = 'partner_guest_id') THEN
    RAISE EXCEPTION 'Falta participants.partner_guest_id: correr primeiro migration_mix_guest_sem_conta.sql.';
  END IF;
END $$;

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
      THEN org_visible_member_count(o.id)
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
      ) AND NOT o.is_global THEN COALESCE((SELECT json_agg(json_build_object('id', g.id, 'title', g.title, 'date', g.date, 'origin', g.origin, 'locked', true) ORDER BY g.date) FROM games g WHERE g.organization_id = o.id AND g.status NOT IN ('finished', 'completed', 'cancelled', 'pending', 'draft')), '[]'::json)::jsonb  -- ◆ era (o.kind = 'group' OR NOT o.is_global)
      ELSE COALESCE((
        SELECT json_agg(json_build_object(
          'id', g.id,
          'title', g.title,
          'date', g.date,
          'location', g.location,
          'max_players', COALESCE(g.max_players, g.num_courts * 4), 'origin', g.origin, 'recurrence_id', g.recurrence_id, 'my_state', (SELECT CASE mp.status WHEN 'confirmed' THEN 'in' WHEN 'waitlisted' THEN 'waitlist' END FROM participants mp WHERE mp.game_id = g.id AND (mp.user_id = auth.uid() OR mp.partner_id = auth.uid()) ORDER BY (mp.status = 'confirmed') DESC LIMIT 1),
          'confirmed_count', (
            -- o parceiro convidado também conta (Ruben, guest_sem_conta, 1 out)
            SELECT COALESCE(SUM(1 + (p.partner_id IS NOT NULL OR p.partner_guest_id IS NOT NULL)::int), 0)
            FROM participants p WHERE p.game_id = g.id AND p.status = 'confirmed'
          )
        ) ORDER BY g.date)
        FROM games g
        WHERE g.organization_id = o.id AND g.status NOT IN ('finished', 'completed', 'cancelled', 'pending', 'draft')
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

-- Grants como hoje em produção (a página do clube abre sem sessão).
REVOKE ALL ON FUNCTION public.get_club_profile(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_club_profile(text) TO anon, authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_functiondef('public.get_club_profile(text)'::regprocedure) LIKE '%''draft''%'
--      AND pg_get_functiondef('public.get_club_profile(text)'::regprocedure) LIKE '%org_visible_member_count%'
--      AND pg_get_functiondef('public.get_club_profile(text)'::regprocedure) LIKE '%my_state%'
--      AND pg_get_functiondef('public.get_club_profile(text)'::regprocedure) LIKE '%partner_guest_id%';  -- true
