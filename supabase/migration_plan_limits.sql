-- ════════════════════════════════════════════════════════════════════════
-- Migration: limites por plano (Trello #264, épico #263)
--
-- PRÉ-REQUISITOS, por esta ordem:
--   1. migration_delete_self_serve_group.sql
--   2. migration_organization_owner_and_admin_invites.sql
--   3. migration_organization_plan_tier.sql   ← a coluna plan_tier
--   4. este ficheiro
--
-- ⚠️ ANTES DE CORRER (Renato): confirmar que cada organização tem o plano
-- certo. A partir daqui os limites deixam de ser fixos e passam a vir do
-- plano — um clube a sério que tenha ficado em 'free' por engano fica
-- limitado a 1 mix em aberto. Query de revisão no fim de
-- migration_organization_plan_tier.sql.
--
-- Decisão do Francisco, 16 set 2026 — limites:
--   free (Free):      30 membros,  1 mix em aberto, 2 campos por mix
--   plus (Squad):    300 membros,  2 mixes,         4 campos
--   pro (Community): sem limite
--   club (Club):     sem limite
--
-- O que muda em relação a hoje: os caps eram fixos (30 membros / 3 mixes /
-- 4 campos) e só se aplicavam a grupos criados na Comunidade
-- (migration_self_serve_groups.sql + migration_fix_games_policy_recursion.sql).
-- Passam a vir do plano e a valer para qualquer organização — quem está em
-- Community ou Club fica sem limite, como antes tinham os clubes.
--
-- A app mostra a mensagem ("Chegaste ao limite do plano X…"), mas quem
-- recusa é o Postgres: as regras vivem nas policies/RPCs, não no ecrã.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Os limites de cada plano, numa função só. NULL = sem limite.
--       Função e não tabela: os números ainda estão a ser afinados e uma
--       tabela obrigava a migração de dados a cada ajuste. ───────────────
CREATE OR REPLACE FUNCTION plan_limits(p_plan_tier TEXT)
RETURNS TABLE (max_members INTEGER, max_active_mixes INTEGER, max_courts INTEGER)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT t.max_members, t.max_active_mixes, t.max_courts
  FROM (VALUES
    ('free', 30,   1,    2),
    ('plus', 300,  2,    4),
    ('pro',  NULL, NULL, NULL),
    ('club', NULL, NULL, NULL)
  ) AS t(plan_tier, max_members, max_active_mixes, max_courts)
  WHERE t.plan_tier = COALESCE(p_plan_tier, 'free');
$$;

-- ── 2. Helpers por organização. SECURITY DEFINER pela mesma razão que
--       is_self_serve_org (migration_fix_games_policy_recursion.sql): são
--       chamados de dentro das policies de `games` e não podem reentrar na
--       avaliação de RLS. NULL = sem limite. ───────────────────────────────
CREATE OR REPLACE FUNCTION org_plan_tier(p_organization_id UUID)
RETURNS TEXT
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT COALESCE((SELECT plan_tier FROM organizations WHERE id = p_organization_id), 'free');
$$;

CREATE OR REPLACE FUNCTION org_max_courts(p_organization_id UUID)
RETURNS INTEGER
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT max_courts FROM plan_limits(org_plan_tier(p_organization_id));
$$;

CREATE OR REPLACE FUNCTION org_max_active_mixes(p_organization_id UUID)
RETURNS INTEGER
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT max_active_mixes FROM plan_limits(org_plan_tier(p_organization_id));
$$;

CREATE OR REPLACE FUNCTION org_max_members(p_organization_id UUID)
RETURNS INTEGER
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT max_members FROM plan_limits(org_plan_tier(p_organization_id));
$$;

REVOKE ALL ON FUNCTION plan_limits(TEXT) FROM public;
REVOKE ALL ON FUNCTION org_plan_tier(UUID) FROM public;
REVOKE ALL ON FUNCTION org_max_courts(UUID) FROM public;
REVOKE ALL ON FUNCTION org_max_active_mixes(UUID) FROM public;
REVOKE ALL ON FUNCTION org_max_members(UUID) FROM public;
GRANT EXECUTE ON FUNCTION plan_limits(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION org_plan_tier(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION org_max_courts(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION org_max_active_mixes(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION org_max_members(UUID) TO authenticated;

-- ── 3. Mixes: as policies de games deixam de ter 4 campos / 3 mixes
--       escritos à mão e passam a perguntar ao plano. Mantém-se o
--       self_serve_active_mix_count() do hotfix da recursão. ─────────────
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
      org_max_courts(games.organization_id) IS NULL
      OR num_courts <= org_max_courts(games.organization_id)
    )
    AND (
      org_max_active_mixes(games.organization_id) IS NULL
      OR self_serve_active_mix_count(games.organization_id) < org_max_active_mixes(games.organization_id)
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
      org_max_courts(games.organization_id) IS NULL
      OR num_courts <= org_max_courts(games.organization_id)
    )
    AND (
      org_max_active_mixes(games.organization_id) IS NULL
      OR (
        self_serve_active_mix_count(games.organization_id, games.id)
        + (CASE WHEN COALESCE(games.status, 'open') NOT IN ('finished', 'cancelled') THEN 1 ELSE 0 END)
      ) <= org_max_active_mixes(games.organization_id)
    )
  );

-- ── 4. Membros: os três sítios que inserem membros passam a ler o limite
--       do plano em vez do 30 fixo, e deixam de o fazer só para grupos
--       criados na Comunidade. A mensagem mantém a palavra "limite" e
--       "membros" — é por aí que a app a reconhece (src/lib/plans.js). ──
CREATE OR REPLACE FUNCTION approve_membership_request(p_request_id UUID)
RETURNS VOID AS $$
DECLARE
  v_org_id UUID;
  v_user_id UUID;
  v_max INTEGER;
BEGIN
  SELECT organization_id, user_id INTO v_org_id, v_user_id
  FROM membership_requests
  WHERE id = p_request_id AND status = 'pending';

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Pedido não encontrado ou já resolvido';
  END IF;
  IF NOT is_org_admin(v_org_id) THEN
    RAISE EXCEPTION 'Apenas admins podem aprovar pedidos';
  END IF;

  v_max := org_max_members(v_org_id);
  IF v_max IS NOT NULL
     AND (SELECT COUNT(*) FROM memberships WHERE organization_id = v_org_id) >= v_max THEN
    RAISE EXCEPTION 'Grupo já atingiu o limite de % membros do plano', v_max;
  END IF;

  INSERT INTO memberships (user_id, organization_id)
  VALUES (v_user_id, v_org_id)
  ON CONFLICT (user_id, organization_id) DO NOTHING;

  UPDATE membership_requests
  SET status = 'approved', resolved_at = NOW(), resolved_by = auth.uid()
  WHERE id = p_request_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- accept_organization_invite — redefinida a partir da versão de
-- migration_organization_owner_and_admin_invites.sql (convite como admin).
-- Só muda o teste do limite.
CREATE OR REPLACE FUNCTION accept_organization_invite(p_invite_id UUID)
RETURNS VOID AS $$
DECLARE
  v_org_id UUID;
  v_as_admin BOOLEAN;
  v_max INTEGER;
BEGIN
  SELECT organization_id, as_admin INTO v_org_id, v_as_admin
  FROM organization_invites
  WHERE id = p_invite_id AND invited_user_id = auth.uid() AND status = 'pending';

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Convite não encontrado ou já resolvido';
  END IF;

  v_max := org_max_members(v_org_id);
  IF v_max IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM memberships WHERE organization_id = v_org_id AND user_id = auth.uid())
     AND (SELECT COUNT(*) FROM memberships WHERE organization_id = v_org_id) >= v_max THEN
    RAISE EXCEPTION 'Grupo já atingiu o limite de % membros do plano', v_max;
  END IF;

  IF v_as_admin THEN
    INSERT INTO memberships (user_id, organization_id, is_admin)
    VALUES (auth.uid(), v_org_id, TRUE)
    ON CONFLICT (user_id, organization_id) DO UPDATE SET is_admin = TRUE;

    DELETE FROM membership_requests
    WHERE user_id = auth.uid() AND organization_id = v_org_id AND status = 'pending';
  ELSIF EXISTS (SELECT 1 FROM organizations WHERE id = v_org_id AND self_serve) THEN
    INSERT INTO membership_requests (user_id, organization_id)
    VALUES (auth.uid(), v_org_id)
    ON CONFLICT (user_id, organization_id) WHERE (status = 'pending') DO NOTHING;
  ELSE
    INSERT INTO memberships (user_id, organization_id)
    VALUES (auth.uid(), v_org_id)
    ON CONFLICT (user_id, organization_id) DO NOTHING;
  END IF;

  UPDATE organization_invites SET status = 'accepted' WHERE id = p_invite_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- follow_organization: entrar direto num clube público (open_join) também
-- passa a respeitar o limite — era o único caminho que inseria membros sem
-- teste nenhum.
CREATE OR REPLACE FUNCTION follow_organization(p_organization_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_kind TEXT;
  v_parent_id UUID;
  v_is_global BOOLEAN;
  v_open_join BOOLEAN;
  v_self_serve BOOLEAN;
  v_max INTEGER;
BEGIN
  SELECT kind, parent_organization_id, is_global, open_join, self_serve
    INTO v_kind, v_parent_id, v_is_global, v_open_join, v_self_serve
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
  ELSIF v_kind = 'group' AND v_parent_id IS NULL AND v_self_serve THEN
    NULL; -- cai sempre no INSERT em membership_requests abaixo
  ELSE
    IF NOT v_is_global THEN
      RAISE EXCEPTION 'Este clube não é público';
    END IF;
    IF v_open_join THEN
      v_max := org_max_members(p_organization_id);
      IF v_max IS NOT NULL
         AND (SELECT COUNT(*) FROM memberships WHERE organization_id = p_organization_id) >= v_max THEN
        RAISE EXCEPTION 'Grupo já atingiu o limite de % membros do plano', v_max;
      END IF;
      INSERT INTO memberships (user_id, organization_id)
      VALUES (auth.uid(), p_organization_id)
      ON CONFLICT (user_id, organization_id) DO NOTHING;
      RETURN 'joined';
    END IF;
  END IF;

  INSERT INTO membership_requests (user_id, organization_id)
  VALUES (auth.uid(), p_organization_id)
  ON CONFLICT (user_id, organization_id) WHERE (status = 'pending') DO NOTHING;
  RETURN 'pending';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── 5. Revisão (Renato) — quem fica acima do limite do seu plano: ────────
-- SELECT o.name, o.kind, o.plan_tier,
--        (SELECT COUNT(*) FROM memberships m WHERE m.organization_id = o.id) AS membros,
--        org_max_members(o.id) AS max_membros,
--        (SELECT COUNT(*) FROM games g WHERE g.organization_id = o.id
--           AND COALESCE(g.status,'open') NOT IN ('finished','cancelled')) AS mixes_abertos,
--        org_max_active_mixes(o.id) AS max_mixes
-- FROM organizations o
-- ORDER BY o.plan_tier, o.name;
--
-- Quem já está acima não é expulso nem tem nada apagado: fica como está e
-- só não consegue criar mais até descer abaixo do limite (ou subir de plano).
