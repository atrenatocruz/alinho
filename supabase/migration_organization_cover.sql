-- ═════════════════════════════════════════════════════════════════════════
-- Capa do clube/grupo (Gerir › Clube, proposta A — Renato, 16 out)
--
-- PORQUÊ. O topo dos cartões do clube (Gerir, Comunidade, página do clube)
-- era sempre a imagem do Alino, igual para todos. Agora cada clube ou grupo
-- escolhe uma capa: uma das capas do alinho (/topo/*.webp, ficheiros da
-- própria app) ou uma foto carregada pelo admin.
--
-- ONDE FICA A FOTO. No balde que já existe, club-logos (público), na pasta
-- do clube: <org_id>/cover-<n>.jpg. As regras do balde já deixam o admin do
-- clube carregar e apagar dentro da pasta do seu clube. Nada de novo no
-- armazenamento.
--
-- O QUE FAZ
--   1. organizations.cover_url (text, opcional). Só aceita NULL, uma capa do
--      alinho (/topo/<nome>.webp) ou um endereço do nosso balde na pasta do
--      próprio clube — nem imagens de fora nem de outro clube.
--   2. GRANT UPDATE (cover_url): sem isto o «Guardar»/«Usar esta capa» dá
--      42501 (o GRANT de organizations é por colunas — ver
--      migration_self_serve_groups.sql e migration_organization_district_grant.sql).
--   3. get_org_covers(ids): a capa de vários clubes de uma vez, para a
--      Comunidade e a página do clube — o get_club_profile e as listas da
--      Comunidade devolvem colunas fixas e não se mexe neles por causa disto
--      (ver migration_repor_get_club_profile.sql). A capa é pública (o balde
--      também), por isso não há filtro de visibilidade.
--
-- Idempotente. Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS cover_url TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizations_cover_url_allowed') THEN
    ALTER TABLE organizations ADD CONSTRAINT organizations_cover_url_allowed CHECK (
      cover_url IS NULL
      OR cover_url ~ '^/topo/[a-z0-9-]+\.webp$'
      OR cover_url ~ ('^https://[^/]+/storage/v1/object/public/club-logos/' || id::text || '/'));
  END IF;
END $$;

GRANT UPDATE (cover_url) ON organizations TO authenticated;

CREATE OR REPLACE FUNCTION public.get_org_covers(p_ids UUID[])
RETURNS TABLE (id UUID, cover_url TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT o.id, o.cover_url FROM organizations o
  WHERE o.id = ANY (p_ids) AND o.cover_url IS NOT NULL
  LIMIT 500;
$$;

REVOKE ALL ON FUNCTION public.get_org_covers(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_org_covers(UUID[]) TO authenticated;

COMMIT;
