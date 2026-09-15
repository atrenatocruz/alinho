-- Eliminar um grupo criado na Comunidade (Trello #241).
--
-- Até aqui, um grupo criado pela via self-serve não tinha como ser desfeito.
-- Esta migration acrescenta duas funções, e nenhuma política RLS nova: não há
-- DELETE direto na tabela organizations para o `authenticated`, e continua a
-- não haver — a única porta é delete_self_serve_group(), que valida tudo aqui
-- dentro, porque é SECURITY DEFINER e por isso passa por cima do RLS.
--
-- ── O que o DELETE leva em cadeia, e porque é que isso decide as regras ─────
-- Levantado das FKs em schema.sql + migration_*.sql (15 set 2026):
--
--   CASCADE   memberships (inclui favoritos), membership_requests,
--             organization_invites, whatsapp_groups, teacher_profiles,
--             group_matches, organizations filhas (parent_organization_id)
--   SET NULL  xp_events — o XP fica com o jogador
--   BLOQUEIA  games, game_recurrences, player_stats, mix_player_stats, vouchers
--             (FK sem ON DELETE → NO ACTION)
--
-- group_matches é o caso que obrigou a uma regra explícita: são jogos entre
-- amigos DENTRO do grupo, com resultados de outras pessoas, e iam em cascata
-- sem ninguém dar por isso. Tudo o que seja atividade de jogo — de quem quer
-- que seja — bloqueia a eliminação. Quem carrega no botão é o admin, mas quem
-- perderia o histórico seriam os outros jogadores, que nunca viram o aviso.
--
-- As tabelas "BLOQUEIA" já recusariam o DELETE sozinhas (erro de FK). A
-- verificação aqui existe para devolver um motivo legível à app em vez desse
-- erro, e para cobrir group_matches, que a FK não protege.
--
-- ── Âmbito ────────────────────────────────────────────────────────────────
-- Só grupos com self_serve = TRUE (criados na Comunidade). Clubes e grupos
-- criados por um platform admin não se apagam por aqui — um clube a sério
-- não deve desaparecer com um botão de quem o gere.
--
-- ⚠️ Esta migration tem de ser corrida no SQL Editor do Supabase. Enquanto não
-- for, a app mostra o botão mas a chamada falha.

-- ── 1. Motivo pelo qual o grupo NÃO pode ser eliminado por quem pergunta ────
-- NULL = pode. Códigos estáveis — a app traduz, não mostra estes textos.
CREATE OR REPLACE FUNCTION get_organization_delete_blocker(p_org_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_org organizations%ROWTYPE;
  v_is_platform_admin BOOLEAN;
BEGIN
  IF auth.uid() IS NULL
     OR COALESCE((auth.jwt()->>'is_anonymous')::boolean, FALSE) THEN
    RETURN 'not_authenticated';
  END IF;

  SELECT * INTO v_org FROM organizations WHERE id = p_org_id;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  SELECT COALESCE(is_platform_admin, FALSE) INTO v_is_platform_admin
  FROM profiles WHERE id = auth.uid();

  IF NOT (is_org_admin(p_org_id) OR COALESCE(v_is_platform_admin, FALSE)) THEN
    RETURN 'not_admin';
  END IF;

  IF NOT v_org.self_serve THEN
    RETURN 'not_self_serve';
  END IF;

  IF EXISTS (SELECT 1 FROM organizations WHERE parent_organization_id = p_org_id) THEN
    RETURN 'has_subgroups';
  END IF;

  IF EXISTS (SELECT 1 FROM games            WHERE organization_id = p_org_id)
  OR EXISTS (SELECT 1 FROM game_recurrences WHERE organization_id = p_org_id)
  OR EXISTS (SELECT 1 FROM group_matches    WHERE organization_id = p_org_id)
  OR EXISTS (SELECT 1 FROM player_stats     WHERE organization_id = p_org_id)
  OR EXISTS (SELECT 1 FROM mix_player_stats WHERE organization_id = p_org_id)
  OR EXISTS (SELECT 1 FROM vouchers         WHERE organization_id = p_org_id) THEN
    RETURN 'has_activity';
  END IF;

  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_organization_delete_blocker(UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION get_organization_delete_blocker(UUID) TO authenticated;

-- ── 2. Eliminar ────────────────────────────────────────────────────────────
-- Tranca a linha antes de verificar, para um mix criado ao mesmo tempo noutra
-- sessão não escapar entre a verificação e o DELETE. Mesmo que escapasse, a FK
-- de games recusaria o DELETE e a transação inteira voltava atrás.
CREATE OR REPLACE FUNCTION delete_self_serve_group(p_org_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_blocker TEXT;
BEGIN
  PERFORM 1 FROM organizations WHERE id = p_org_id FOR UPDATE;

  v_blocker := get_organization_delete_blocker(p_org_id);
  IF v_blocker IS NOT NULL THEN
    RAISE EXCEPTION USING MESSAGE = v_blocker, ERRCODE = 'P0001';
  END IF;

  DELETE FROM organizations WHERE id = p_org_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION delete_self_serve_group(UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION delete_self_serve_group(UUID) TO authenticated;
