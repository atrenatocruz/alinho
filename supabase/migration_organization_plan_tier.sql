-- ════════════════════════════════════════════════════════════════════════
-- Migration: plano de cada clube/grupo — organizations.plan_tier
-- (Trello #177, peça "guardar o plano e mostrar no Gerir").
--
-- PRÉ-REQUISITO: correr primeiro
--   1. migration_delete_self_serve_group.sql
--   2. migration_organization_owner_and_admin_invites.sql (owner_id — usado
--      na query de revisão no fim deste ficheiro)
--
-- O que faz — e o que NÃO faz:
-- • Guarda o plano: free / plus / pro / club (nomes visíveis Free / Squad /
--   Community / Club, fechados a 15 set 2026). As chaves são as mesmas do
--   rascunho antigo migration_self_serve_groups_and_plans.sql, que fica
--   substituído por este ficheiro nesta parte.
-- • NÃO aplica limites. Mudar o plano só muda a etiqueta no Gerir. Os
--   limites dos grupos da Comunidade continuam os que já estão hardcoded
--   (30 membros, 3 mixes ativos, 4 campos — migration_self_serve_groups.sql)
--   e não batem com o Free (1 mix, 2 campos). Isso é a peça seguinte, com o
--   Renato.
-- • NÃO cria subscrições nem pagamentos. Até existirem, só o admin da
--   plataforma muda o plano (admin_set_organization_plan).
-- • O plano é independente do tipo (kind): um grupo pode subscrever o Club
--   (Francisco, 15 set 2026) e continua a ser um grupo.
--
-- PROPOSTA, A VALIDAR PELO RENATO — planos iniciais:
-- • Todos começam em Free.
-- • "+1 Grupo de Padel" (o único grupo real hoje) → Community (pro).
-- • Smash Padel, se já existir → Club.
-- • Grupos de teste dos fundadores ficam Free; grupos criados por outros
--   utilizadores ficam Free e não são mexidos.
-- • Grupos dentro de um clube têm o plano do clube.
-- Ver a query de revisão no fim, antes e depois de correr.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Coluna. Fica FORA do GRANT UPDATE por colunas de organizations
--       (migration_self_serve_groups.sql §7): um admin de grupo não consegue
--       subir o próprio plano com um UPDATE direto. Só o RPC abaixo escreve. ──
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS plan_tier TEXT NOT NULL DEFAULT 'free'
    CHECK (plan_tier IN ('free', 'plus', 'pro', 'club')),
  ADD COLUMN IF NOT EXISTS plan_updated_at TIMESTAMPTZ;

-- ── 2. Planos iniciais (proposta acima). ───────────────────────────────────
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE organizations SET plan_tier = 'pro', plan_updated_at = NOW()
  WHERE TRIM(name) = '+1 Grupo de Padel';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
    RAISE WARNING '"+1 Grupo de Padel": % linhas atualizadas (esperado 1) — confirmar o nome e acertar à mão', v_count;
  END IF;

  UPDATE organizations SET plan_tier = 'club', plan_updated_at = NOW()
  WHERE kind = 'club' AND parent_organization_id IS NULL AND name ILIKE '%smash padel%';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Smash Padel: % linha(s) em Club', v_count;

  -- Grupos dentro de um clube herdam o plano do clube.
  UPDATE organizations child SET plan_tier = parent.plan_tier
  FROM organizations parent
  WHERE child.parent_organization_id = parent.id
    AND child.plan_tier IS DISTINCT FROM parent.plan_tier;
END $$;

-- ── 3. Um grupo criado dentro de um clube nasce com o plano do clube. ─────
CREATE OR REPLACE FUNCTION inherit_parent_plan_tier()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.parent_organization_id IS NOT NULL THEN
    SELECT plan_tier INTO NEW.plan_tier
    FROM organizations WHERE id = NEW.parent_organization_id;
    NEW.plan_tier := COALESCE(NEW.plan_tier, 'free');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_inherit_parent_plan_tier ON organizations;
CREATE TRIGGER trg_inherit_parent_plan_tier
BEFORE INSERT ON organizations
FOR EACH ROW EXECUTE FUNCTION inherit_parent_plan_tier();

-- ── 4. admin_set_organization_plan — só admin da plataforma, enquanto não
--       há subscrições. Muda o clube/grupo e os grupos lá dentro. Mais tarde
--       o fluxo de subscrição (site) passa a ser o outro escritor. ─────────
CREATE OR REPLACE FUNCTION admin_set_organization_plan(p_organization_id UUID, p_plan_tier TEXT)
RETURNS TEXT AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_platform_admin) THEN
    RAISE EXCEPTION 'Só um admin da plataforma pode mudar o plano';
  END IF;
  IF p_plan_tier IS NULL OR p_plan_tier NOT IN ('free', 'plus', 'pro', 'club') THEN
    RAISE EXCEPTION 'Plano inválido';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = p_organization_id) THEN
    RAISE EXCEPTION 'Clube ou grupo não encontrado';
  END IF;

  UPDATE organizations
  SET plan_tier = p_plan_tier, plan_updated_at = NOW()
  WHERE id = p_organization_id OR parent_organization_id = p_organization_id;

  RETURN p_plan_tier;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION admin_set_organization_plan(UUID, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION admin_set_organization_plan(UUID, TEXT) TO authenticated;

-- ── Revisão (Renato) — correr depois e confirmar a lista: ──────────────────
-- SELECT o.name, o.kind, o.self_serve, o.plan_tier, p.name AS dono, o.created_at
-- FROM organizations o
-- LEFT JOIN profiles p ON p.id = o.owner_id
-- ORDER BY o.plan_tier DESC, o.created_at;
--
-- Acertar um à mão (como admin da plataforma na app, ou aqui):
-- UPDATE organizations SET plan_tier = 'pro', plan_updated_at = NOW() WHERE slug = '...';
