-- ════════════════════════════════════════════════════════════════════════
-- Apagar conta (Trello #306/#358 — RGPD). Põe a funcionar o que já está no
-- site desde 19 set: «Apagar a minha conta» (Perfil) e o painel do super
-- admin chamam request_account_deletion, cancel_account_deletion e
-- admin_delete_account, que NÃO existem em produção — hoje dão erro.
--
-- Regras decididas pelo Francisco (18 set 2026), confirmadas a 21 set:
--   - a própria pessoa pede: tem 30 dias para mudar de ideias, voltando a
--     entrar; ao fim do prazo os dados pessoais são apagados de vez;
--   - o super admin (profiles.is_platform_admin) anonimiza de imediato;
--   - anonimizar, não apagar às cegas: os resultados dos jogos ficam, sem
--     nome, para não alterar os pontos de quem jogou com a pessoa.
--
-- PORQUE É ANONIMIZAR E NÃO APAGAR A LINHA: teams, participants,
-- mix_player_stats, player_stats, private_matches e group_matches apontam
-- para profiles com ON DELETE NO ACTION — apagar a linha do perfil é
-- recusado pela base de dados, e forçá-lo (cascata) levaria os resultados
-- atrás. A linha fica, esvaziada, com o nome «Jogador removido».
--
-- O LOGIN: a linha em auth.users também fica (profiles.id aponta para ela
-- com ON DELETE CASCADE — apagá-la apagaria o perfil e caía no problema de
-- cima). Fica bloqueada: email trocado por um endereço inválido, password
-- limpa e banned_until no infinito. A pessoa não volta a entrar.
--
-- Ordem: correr depois de migration_multi_tenant.sql e das tabelas de
-- aulas. É seguro re-correr. Precisa da extensão pg_cron, já usada por
-- migration_cancel_stale_mixes.sql.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. A marca do pedido ─────────────────────────────────────────────────
-- Sem GRANT UPDATE para authenticated: só as funções abaixo lhe tocam.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ;

-- ── 2. Anonimizar (interno — nenhum cliente lhe chama) ───────────────────
CREATE OR REPLACE FUNCTION anonymize_account(p_user_id UUID)
RETURNS void AS $$
BEGIN
  -- Deixa de pertencer a clubes/grupos e perde tudo o que é só dele.
  DELETE FROM memberships          WHERE user_id = p_user_id;
  DELETE FROM membership_requests  WHERE user_id = p_user_id;
  DELETE FROM follows              WHERE follower_id = p_user_id OR followed_id = p_user_id;
  DELETE FROM notifications        WHERE user_id = p_user_id;
  DELETE FROM organization_invites WHERE invited_user_id = p_user_id OR invited_by = p_user_id;
  DELETE FROM mix_kudos            WHERE voter_id = p_user_id OR recipient_id = p_user_id;
  DELETE FROM player_achievements  WHERE user_id = p_user_id;
  DELETE FROM xp_events            WHERE user_id = p_user_id;
  DELETE FROM vouchers             WHERE user_id = p_user_id;
  DELETE FROM teacher_profiles     WHERE user_id = p_user_id;

  -- Inscrições em jogos que ainda não aconteceram: sai deles. Os jogos já
  -- jogados ficam (é o que sustenta os pontos dos outros).
  DELETE FROM participants p
   USING games g
   WHERE p.game_id = g.id AND p.user_id = p_user_id AND g.status IN ('open', 'closed');
  UPDATE participants SET partner_id = NULL
   WHERE partner_id = p_user_id
     AND game_id IN (SELECT id FROM games WHERE status IN ('open', 'closed'));

  -- O perfil fica, vazio de identidade.
  UPDATE profiles SET
    name = 'Jogador removido',
    email = 'removido-' || p_user_id || '@alinho.invalid',
    birthday = NULL,
    gender = NULL,
    phone_hash = NULL,
    avatar_url = NULL,
    whatsapp_jid = NULL,
    nationality = NULL,
    dominant_hand = NULL,
    -- preferred_side, as visibilidades e o idioma são obrigatórios: voltam
    -- ao valor por omissão em vez de ficarem vazios (apanhado no ensaio de
    -- 21 set, que rebentou com "null value in column preferred_side").
    preferred_side = 'both',
    activity_visibility = 'private',
    results_visibility = 'private',
    clubs_visibility = 'private',
    language = 'pt',
    is_private = TRUE,
    deletion_requested_at = NULL
  WHERE id = p_user_id;

  -- E a conta deixa de dar para entrar.
  UPDATE auth.users SET
    email = 'removido-' || p_user_id || '@alinho.invalid',
    phone = NULL,
    encrypted_password = NULL,
    raw_user_meta_data = '{}'::jsonb,
    banned_until = 'infinity'
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION anonymize_account(UUID) FROM public, anon, authenticated;

-- ── 3. A própria pessoa pede ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION request_account_deletion()
RETURNS TIMESTAMPTZ AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_org TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Precisas de ter sessão iniciada';
  END IF;

  -- Dono de um grupo/clube com mais gente lá dentro: passa a posse
  -- primeiro (transfer_organization_ownership), senão o grupo ficava sem
  -- dono e com membros pendurados.
  SELECT o.name INTO v_org
  FROM organizations o
  WHERE o.owner_id = auth.uid()
    AND EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = o.id AND m.user_id <> auth.uid())
  LIMIT 1;
  IF v_org IS NOT NULL THEN
    RAISE EXCEPTION 'Ainda és o dono de "%". Passa a posse a outra pessoa antes de apagares a conta.', v_org;
  END IF;

  UPDATE profiles SET deletion_requested_at = v_now
  WHERE id = auth.uid() AND deletion_requested_at IS NULL;

  RETURN (SELECT deletion_requested_at FROM profiles WHERE id = auth.uid());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION request_account_deletion() FROM public, anon;
GRANT EXECUTE ON FUNCTION request_account_deletion() TO authenticated;

-- ── 4. Mudar de ideias, dentro dos 30 dias ───────────────────────────────
CREATE OR REPLACE FUNCTION cancel_account_deletion()
RETURNS void AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Precisas de ter sessão iniciada';
  END IF;

  UPDATE profiles SET deletion_requested_at = NULL
  WHERE id = auth.uid()
    AND deletion_requested_at IS NOT NULL
    AND deletion_requested_at > NOW() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION cancel_account_deletion() FROM public, anon;
GRANT EXECUTE ON FUNCTION cancel_account_deletion() TO authenticated;

-- ── 5. Super admin apaga já ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_delete_account(p_user_id UUID)
RETURNS void AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_platform_admin) THEN
    RAISE EXCEPTION 'Apenas administradores da plataforma podem apagar contas';
  END IF;
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Não podes apagar a tua própria conta por aqui';
  END IF;
  IF EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id AND is_platform_admin) THEN
    RAISE EXCEPTION 'Não podes apagar outro administrador da plataforma';
  END IF;

  PERFORM anonymize_account(p_user_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION admin_delete_account(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION admin_delete_account(UUID) TO authenticated;

-- ── 6. Ao fim dos 30 dias, todos os dias ─────────────────────────────────
CREATE OR REPLACE FUNCTION purge_due_account_deletions()
RETURNS INTEGER AS $$
DECLARE
  v_id UUID;
  v_n INTEGER := 0;
BEGIN
  FOR v_id IN
    SELECT id FROM profiles
    WHERE deletion_requested_at IS NOT NULL
      AND deletion_requested_at <= NOW() - INTERVAL '30 days'
  LOOP
    PERFORM anonymize_account(v_id);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION purge_due_account_deletions() FROM public, anon, authenticated;

-- cron.schedule substitui o trabalho se já existir, por isso é seguro
-- re-correr. Às 4h, fora das horas de jogo.
SELECT cron.schedule(
  'purge-due-account-deletions',
  '0 4 * * *',
  $$SELECT purge_due_account_deletions()$$
);

-- ── Verificação ──────────────────────────────────────────────────────────
-- SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public'
--   AND proname IN ('request_account_deletion','cancel_account_deletion',
--                   'admin_delete_account','anonymize_account',
--                   'purge_due_account_deletions');
-- SELECT jobname, schedule FROM cron.job WHERE jobname = 'purge-due-account-deletions';
-- SELECT count(*) AS pedidos_pendentes FROM profiles WHERE deletion_requested_at IS NOT NULL;
