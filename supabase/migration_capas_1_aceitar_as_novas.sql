-- ═════════════════════════════════════════════════════════════════════════
-- Capas próprias para clubes e grupos — PASSO 1 de 2: aceitar também as novas
--
-- PORQUÊ. Desenho aprovado pelo Francisco a 17 out
-- (design-handoff/2026-10-17-capas-clube-grupo/SPEC.md). Ordem decidida pelo
-- PO a 18 out, para não haver um momento em que o Gerir dá erro ao guardar:
--   1) ESTE ficheiro: o CHECK aceita as capas de tipo (/topo/…) E as novas
--      (/capas/…);
--   2) o código do Dev 1 vai ao main (as 9 imagens em public/capas/);
--   3) migration_capas_2_trocar_e_fechar.sql: troca as capas de tipo pelas
--      novas e o CHECK passa a aceitar só as novas.
-- Mexe no trabalho do Renato (migration_organization_cover.sql, 16 out).
--
-- O QUE FAZ. organizations_cover_url_allowed passa a aceitar: nenhuma capa,
-- /topo/<nome>.webp, /capas/<nome>.webp, ou uma foto do próprio clube no
-- armazenamento. Não mexe em dados.
--
-- Dev 3, 18 out 2026 · ecrã: Dev 1
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_cover_url_allowed;
ALTER TABLE organizations ADD CONSTRAINT organizations_cover_url_allowed CHECK (
  cover_url IS NULL
  OR cover_url ~ '^/topo/[a-z0-9-]+\.webp$'
  OR cover_url ~ '^/capas/[a-z0-9-]+\.webp$'
  OR cover_url ~ ('^https://[^/]+/storage/v1/object/public/club-logos/' || id::text || '/'));

COMMIT;

-- Verificar depois de correr (true):
--   SELECT pg_get_constraintdef(oid) LIKE '%/capas/%' AND pg_get_constraintdef(oid) LIKE '%/topo/%'
--     FROM pg_constraint WHERE conname = 'organizations_cover_url_allowed';
