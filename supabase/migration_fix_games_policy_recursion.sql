-- ════════════════════════════════════════════════════════════════════════
-- Hotfix: "infinite recursion detected in policy for relation games"
-- (Postgres 42P17) on every INSERT/UPDATE into games for a self-serve
-- group. Root cause: the games INSERT/UPDATE policies (migration_
-- self_serve_groups.sql §5-6) query `games` itself (the active-mix-count
-- subquery) from inside a policy defined ON games — evaluating that
-- inner query re-enters games' own row-security policies while they're
-- already being evaluated for the outer statement, which Postgres
-- detects and refuses as recursion. The final whole-branch review flagged
-- this exact shape as fragile ("cap subqueries run under caller's RLS...
-- a SECURITY DEFINER helper would be sturdier") and it was parked as a
-- minor, non-blocking polish item — it turned out to be outright broken,
-- not just fragile.
--
-- Fix: move the self-serve check and the active-mix count into SECURITY
-- DEFINER functions. A SECURITY DEFINER function's internal queries run
-- under the function owner's privileges, bypassing RLS on the tables it
-- reads — so the inner `games` query no longer re-enters games' own
-- policy evaluation, breaking the cycle. Same technique already used by
-- is_org_admin() elsewhere in this schema.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION is_self_serve_org(p_organization_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE((SELECT self_serve FROM organizations WHERE id = p_organization_id), FALSE);
$$;

REVOKE ALL ON FUNCTION is_self_serve_org(UUID) FROM public;
GRANT EXECUTE ON FUNCTION is_self_serve_org(UUID) TO authenticated;

-- p_exclude_game_id lets the UPDATE policy count every OTHER active mix in
-- the org, excluding the row currently being updated (added back separately
-- by the policy itself based on the row's own NEW status).
CREATE OR REPLACE FUNCTION self_serve_active_mix_count(p_organization_id UUID, p_exclude_game_id UUID DEFAULT NULL)
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COUNT(*)::INTEGER FROM games
  WHERE organization_id = p_organization_id
    AND (p_exclude_game_id IS NULL OR id <> p_exclude_game_id)
    AND COALESCE(status, 'open') NOT IN ('finished', 'cancelled');
$$;

REVOKE ALL ON FUNCTION self_serve_active_mix_count(UUID, UUID) FROM public;
GRANT EXECUTE ON FUNCTION self_serve_active_mix_count(UUID, UUID) TO authenticated;

DROP POLICY IF EXISTS "Org admins can create games" ON games;
CREATE POLICY "Org admins can create games"
  ON games FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM memberships
      WHERE memberships.organization_id = games.organization_id
        AND memberships.user_id = auth.uid() AND memberships.is_admin
    )
    AND (
      NOT is_self_serve_org(games.organization_id)
      OR (
        num_courts <= 4
        AND self_serve_active_mix_count(games.organization_id) < 3
      )
    )
  );

DROP POLICY IF EXISTS "Org admins can update games" ON games;
CREATE POLICY "Org admins can update games"
  ON games FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM memberships
    WHERE memberships.organization_id = games.organization_id
      AND memberships.user_id = auth.uid() AND memberships.is_admin
  ))
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM memberships
      WHERE memberships.organization_id = games.organization_id
        AND memberships.user_id = auth.uid() AND memberships.is_admin
    )
    AND (
      NOT is_self_serve_org(games.organization_id)
      OR (
        num_courts <= 4
        AND (
          self_serve_active_mix_count(games.organization_id, games.id)
          + (CASE WHEN COALESCE(games.status, 'open') NOT IN ('finished', 'cancelled') THEN 1 ELSE 0 END)
        ) <= 3
      )
    )
  );
