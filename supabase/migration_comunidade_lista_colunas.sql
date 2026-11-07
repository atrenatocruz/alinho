-- ═════════════════════════════════════════════════════════════════════════
-- Lista da Comunidade: distrito, frase, capa, selo e o que organiza
--
-- PORQUÊ. A Comunidade nova (Dev 1, desenho em
-- design-handoff/2026-10-18-comunidade-clubes-destaque) mostra estas coisas em
-- cada clube e grupo. A quem não é membro, as regras de organizations não deixam
-- ler a linha, por isso têm de vir pelas funções da lista. Plano aprovado pelo
-- Francisco a 7 nov.
--
-- O QUE ACRESCENTA, no fim de list_global_organizations e de search_organizations:
--   · district: o distrito, só se for um nome da lista (is_place_district).
--   · description: a frase do clube ou grupo.
--   · cover_url: a capa (a lista deixa de precisar de get_org_covers).
--   · club_verified: kind = 'club' e verificado (club_verified_at).
--   · organizes: o que organizou nos últimos 60 dias ou tem marcado:
--     'mix' (games), 'tournament' (tournaments), 'open_game' (group_matches, o
--     separador «Jogos em aberto» do Gerir) e 'lesson' (lessons). Rascunhos e
--     cancelados não contam. Os jogos entre amigos não contam.
--   · org_organizes(uuid): a conta de organizes, só para estas funções.
--
-- O QUE A APP ANTIGA VÊ. As colunas de antes ficam com o mesmo nome, tipo e ordem;
-- as novas vêm no fim e são ignoradas. Quem pode chamar fica igual (anon,
-- authenticated, service_role).
--
-- ORDEM. Depois de migration_zona_de_cada_pessoa.sql (is_place_district) e de
-- migration_clube_verificado.sql (club_verified_at). Antes dos ecrãs da
-- Comunidade nova no main.
--
-- Para desfazer: guardar antes o pg_get_functiondef das duas funções (corpos com
-- md5 sem \r ecca6afc… e 504d37a5…, os mesmos em produção e no alinho-dev a 7 nov);
-- depois DROP FUNCTION de cada uma, correr essas definições, repor EXECUTE a anon,
-- authenticated e service_role (REVOKE de PUBLIC) e DROP FUNCTION public.org_organizes(uuid).
--
-- Dev 3, 7 nov 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- Só troca se os corpos de hoje forem os esperados (sem os \r de produção), e se
-- as duas migrações de que depende já tiverem corrido.
DO $$
DECLARE
  r RECORD;
BEGIN
  IF to_regprocedure('public.is_place_district(text)') IS NULL THEN
    RAISE EXCEPTION 'Falta migration_zona_de_cada_pessoa.sql';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'organizations'
                    AND column_name = 'club_verified_at') THEN
    RAISE EXCEPTION 'Falta migration_clube_verificado.sql';
  END IF;

  FOR r IN
    SELECT p.proname, md5(replace(p.prosrc, E'\r', '')) AS m
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname IN ('list_global_organizations', 'search_organizations')
  LOOP
    IF NOT (
         (r.proname = 'list_global_organizations' AND r.m = 'ecca6afc5494c964d9a24924688734b9')
      OR (r.proname = 'search_organizations'      AND r.m = '504d37a5e35fb4f548ad4f434cd13d0e')
    ) THEN
      RAISE EXCEPTION 'Corpo de % diferente do esperado (%): parar e rever', r.proname, r.m;
    END IF;
  END LOOP;
END $$;

-- ─── O que organiza ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.org_organizes(p_org UUID)
RETURNS TEXT[]
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT array_remove(ARRAY[
    CASE WHEN EXISTS (
      SELECT 1 FROM games g
       WHERE g.organization_id = p_org
         AND g.status NOT IN ('draft', 'cancelled')
         AND g.date >= now() - interval '60 days'
    ) THEN 'mix' END,
    CASE WHEN EXISTS (
      SELECT 1 FROM tournaments t
       WHERE t.organization_id = p_org
         AND t.status NOT IN ('rascunho', 'cancelado')
         AND t.cancelled_at IS NULL
         AND t.starts_on >= current_date - 60
    ) THEN 'tournament' END,
    CASE WHEN EXISTS (
      SELECT 1 FROM group_matches gm
       WHERE gm.organization_id = p_org
         AND gm.scheduled_date >= current_date - 60
    ) THEN 'open_game' END,
    CASE WHEN EXISTS (
      SELECT 1 FROM lessons l
       WHERE l.organization_id = p_org
         AND l.cancelled_at IS NULL
         AND l.starts_at >= now() - interval '60 days'
    ) THEN 'lesson' END
  ], NULL);
$function$;

-- Corre dentro das funções da lista, como dono. Ninguém a chama diretamente.
REVOKE ALL ON FUNCTION public.org_organizes(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.org_organizes(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.org_organizes(UUID) FROM authenticated;

-- ─── As duas funções da lista ────────────────────────────────────────────
-- Muda o que devolvem, por isso têm de se apagar primeiro.

DROP FUNCTION IF EXISTS public.list_global_organizations();

CREATE FUNCTION public.list_global_organizations()
RETURNS TABLE(id uuid, name text, slug text, group_logo_url text, kind text,
              parent_organization_id uuid, parent_name text, open_join boolean,
              member_count bigint, my_status text, location text, avg_rating numeric,
              district text, description text, cover_url text, club_verified boolean,
              organizes text[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT
    o.id, o.name, o.slug, o.group_logo_url, o.kind, o.parent_organization_id, parent.name,
    o.open_join,
    CASE WHEN org_stats_visible(o)
      THEN org_visible_member_count(o.id)
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
    ) END,
    CASE WHEN is_place_district(btrim(o.district)) THEN btrim(o.district) END,
    o.description,
    o.cover_url,
    (o.kind = 'club' AND o.club_verified_at IS NOT NULL),
    org_organizes(o.id)
  FROM organizations o
  LEFT JOIN organizations parent ON parent.id = o.parent_organization_id
  WHERE org_is_findable(o)
  ORDER BY o.name;
$function$;

DROP FUNCTION IF EXISTS public.search_organizations(text);

CREATE FUNCTION public.search_organizations(p_query text)
RETURNS TABLE(id uuid, name text, slug text, group_logo_url text, kind text,
              parent_organization_id uuid, parent_name text, open_join boolean,
              member_count bigint, my_status text, location text, avg_rating numeric,
              district text, description text, cover_url text, club_verified boolean,
              organizes text[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT
    o.id, o.name, o.slug, o.group_logo_url, o.kind, o.parent_organization_id, parent.name,
    o.open_join,
    CASE WHEN org_stats_visible(o)
      THEN org_visible_member_count(o.id)
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
    ) END,
    CASE WHEN is_place_district(btrim(o.district)) THEN btrim(o.district) END,
    o.description,
    o.cover_url,
    (o.kind = 'club' AND o.club_verified_at IS NOT NULL),
    org_organizes(o.id)
  FROM organizations o
  LEFT JOIN organizations parent ON parent.id = o.parent_organization_id
  WHERE org_is_findable(o)
    AND sem_acentos(o.name) LIKE '%' || sem_acentos(trim(p_query)) || '%'
  ORDER BY o.name
  LIMIT 20;
$function$;

-- Os mesmos acessos de antes: a lista abre sem sessão.
REVOKE ALL ON FUNCTION public.list_global_organizations() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.search_organizations(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_global_organizations() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_organizations(text) TO anon, authenticated, service_role;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.proname, p.proacl::text AS acl,
           (SELECT array_agg(coalesce(g.rolname, 'PUBLIC') ORDER BY coalesce(g.rolname, 'PUBLIC'))
              FROM aclexplode(p.proacl) a
              LEFT JOIN pg_roles g ON g.oid = a.grantee
             WHERE a.privilege_type = 'EXECUTE') AS quem
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname IN ('list_global_organizations', 'search_organizations')
  LOOP
    IF r.quem IS DISTINCT FROM ARRAY['anon', 'authenticated', 'postgres', 'service_role']::name[] THEN
      RAISE EXCEPTION 'Acessos de % diferentes de antes: %', r.proname, r.acl;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.org_organizes(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.org_organizes(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'org_organizes ficou aberta';
  END IF;
END $$;

COMMIT;

-- Verificação: 17 colunas, as 12 primeiras como antes; quantos têm selo e o que organizam.
-- SELECT count(*) AS total, count(*) FILTER (WHERE club_verified) AS com_selo,
--        count(district) AS com_distrito, count(cover_url) AS com_capa,
--        count(*) FILTER (WHERE cardinality(organizes) > 0) AS organizam
--   FROM list_global_organizations();
