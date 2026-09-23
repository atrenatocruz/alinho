-- ═════════════════════════════════════════════════════════════════════════
-- PLANO FREE: 30 → 40 MEMBROS (23 set 2026) — cartão #424.
-- Decidido pelo Francisco a 22 set, aprovado pelo Renato a 23 set.
--
-- Porquê: aparece cerca de um quarto do grupo em cada mix, e um grupo
-- precisa de ~30 pessoas só para encher dois campos com regularidade — batia
-- no limite exatamente quando começava a funcionar.
--
-- Só refaz plan_limits(); migration_plan_limits.sql fica intocada. Os
-- caminhos que travam por membros (approve_membership_request,
-- accept_organization_invite, follow_organization, join_organization) vão
-- todos buscar o número a org_max_members() → plan_limits(), por isso passam
-- a 40 de uma vez. Espelho no ecrã: src/lib/plans.js (PLAN_LIMITS).
--
-- CORRER DEPOIS de migration_plan_limits.sql. Pode-se correr outra vez.
-- ═════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION plan_limits(p_plan_tier TEXT)
RETURNS TABLE (max_members INTEGER, max_active_mixes INTEGER, max_courts INTEGER)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT t.max_members, t.max_active_mixes, t.max_courts
  FROM (VALUES
    ('free', 40,   1,    2),
    ('plus', 300,  2,    4),
    ('pro',  NULL, NULL, NULL),
    ('club', NULL, NULL, NULL)
  ) AS t(plan_tier, max_members, max_active_mixes, max_courts)
  WHERE t.plan_tier = COALESCE(p_plan_tier, 'free');
$$;
