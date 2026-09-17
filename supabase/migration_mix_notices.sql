-- ════════════════════════════════════════════════════════════════════════
-- Migration: avisos a jogadores quando o admin mexe num mix já começado
-- (Trello #292 — «Mix à última da hora», plano aprovado pelo Francisco a
-- 17 set 2026). PROPOSTA, POR ACORDAR COM O RENATO.
--
-- Independente das outras migrações por correr (só precisa de games,
-- profiles, participants, teams e is_org_admin, que já existem).
--
-- O que faz:
-- • Tabela `notifications`: um aviso por jogador. Genérica de propósito —
--   por agora só há três tipos (mix_joined, mix_removed,
--   mix_partner_changed), mas o sino da Home nova (seguir eventos) pode usar
--   a mesma tabela mais tarde, sem nova tabela.
-- • Cada pessoa só lê os seus avisos. Ninguém escreve direto na tabela:
--   só pelas duas funções abaixo (e o bot, com a service-role key).
-- • notify_mix_changes(game, changes): a app chama-a depois de adicionar,
--   tirar ou refazer duplas. Só o admin do clube/grupo do mix, e só com o
--   mix a decorrer. O parceiro e o nome/hora do mix são lidos aqui, na base
--   de dados, e guardados no aviso (a app só diz quem e o quê).
-- • Junta avisos ainda por ler e por enviar do mesmo jogador no mesmo mix,
--   para 3 mudanças seguidas não darem 3 avisos: entrou + mudou de parceiro
--   = entrou (com o parceiro novo); entrou + saiu = nada.
-- • mark_notifications_read(ids): marcar como lidos os próprios avisos.
-- • O bot (whatsapp-bot/src/mixNotices.js) procura avisos com
--   bot_processed_at vazio, espera 2 minutos depois da última mudança do mix,
--   manda mensagem privada a quem tem WhatsApp ligado e a lista nova de
--   duplas aos grupos do clube, e marca bot_processed_at.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Tabela ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  game_id UUID REFERENCES games(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  -- Fotografia do que se mostra (título e data do mix, parceiro) no momento
  -- do aviso — o sino e o bot não precisam de voltar a ler outras tabelas.
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ,
  bot_processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS notifications_bot_pending_idx
  ON notifications (game_id, created_at) WHERE bot_processed_at IS NULL;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read their own notifications" ON notifications;
CREATE POLICY "Users read their own notifications"
  ON notifications FOR SELECT
  USING (user_id = auth.uid());

REVOKE INSERT, UPDATE, DELETE ON notifications FROM anon, authenticated;

-- ── 2. A app regista o que mudou num mix ────────────────────────────────
-- p_changes: [{ "user_id": "...", "kind": "mix_joined" | "mix_removed" | "mix_partner_changed" }]
CREATE OR REPLACE FUNCTION notify_mix_changes(p_game_id UUID, p_changes JSONB)
RETURNS INTEGER AS $$
DECLARE
  v_game games%ROWTYPE;
  v_change JSONB;
  v_user UUID;
  v_kind TEXT;
  v_in_mix BOOLEAN;
  v_partner UUID;
  v_partner_name TEXT;
  v_data JSONB;
  v_pending notifications%ROWTYPE;
  v_count INTEGER := 0;
BEGIN
  SELECT * INTO v_game FROM games WHERE id = p_game_id;
  IF v_game.id IS NULL THEN
    RAISE EXCEPTION 'Mix não encontrado';
  END IF;
  IF NOT is_org_admin(v_game.organization_id) THEN
    RAISE EXCEPTION 'Só o admin do clube ou grupo pode avisar os jogadores';
  END IF;
  IF v_game.status <> 'in_progress' THEN
    RAISE EXCEPTION 'Só se avisa em mixes a decorrer';
  END IF;

  FOR v_change IN SELECT * FROM jsonb_array_elements(COALESCE(p_changes, '[]'::jsonb)) LOOP
    v_user := NULLIF(v_change->>'user_id', '')::uuid;
    v_kind := v_change->>'kind';
    CONTINUE WHEN v_user IS NULL OR v_kind NOT IN ('mix_joined', 'mix_removed', 'mix_partner_changed');

    -- Confere com o estado real: não se avisa "entraste" a quem não está
    -- nem "saíste" a quem continua.
    v_in_mix := EXISTS (
      SELECT 1 FROM participants
      WHERE game_id = p_game_id AND status = 'confirmed' AND (user_id = v_user OR partner_id = v_user)
    );
    CONTINUE WHEN (v_kind = 'mix_removed') = v_in_mix;

    v_partner := NULL;
    v_partner_name := NULL;
    IF v_kind <> 'mix_removed' THEN
      SELECT CASE WHEN player1_id = v_user THEN player2_id ELSE player1_id END
        INTO v_partner
        FROM teams
       WHERE game_id = p_game_id AND (player1_id = v_user OR player2_id = v_user)
       LIMIT 1;
      IF v_partner IS NOT NULL THEN
        SELECT name INTO v_partner_name FROM profiles WHERE id = v_partner;
      END IF;
    END IF;

    v_data := jsonb_build_object(
      'game_title', v_game.title,
      'game_date', v_game.date,
      'partner_id', v_partner,
      'partner_name', v_partner_name
    );

    -- Aviso anterior do mesmo jogador neste mix que ainda ninguém viu.
    SELECT * INTO v_pending
      FROM notifications
     WHERE user_id = v_user AND game_id = p_game_id
       AND kind IN ('mix_joined', 'mix_removed', 'mix_partner_changed')
       AND read_at IS NULL AND bot_processed_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1;

    IF v_pending.id IS NOT NULL THEN
      DELETE FROM notifications WHERE id = v_pending.id;
      IF v_pending.kind = 'mix_joined' AND v_kind = 'mix_removed' THEN
        CONTINUE; -- entrou e saiu: não há nada a dizer
      ELSIF v_pending.kind = 'mix_joined' THEN
        v_kind := 'mix_joined'; -- entrou e depois mudou de parceiro: continua "entraste"
      ELSIF v_pending.kind = 'mix_removed' AND v_kind = 'mix_joined' THEN
        v_kind := 'mix_partner_changed'; -- saiu e voltou: para ele só mudou a dupla
      END IF;
    END IF;

    INSERT INTO notifications (user_id, kind, game_id, actor_id, data)
    VALUES (v_user, v_kind, p_game_id, auth.uid(), v_data);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION notify_mix_changes(UUID, JSONB) FROM public;
GRANT EXECUTE ON FUNCTION notify_mix_changes(UUID, JSONB) TO authenticated;

-- ── 3. Marcar como lido ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION mark_notifications_read(p_ids UUID[])
RETURNS VOID AS $$
  UPDATE notifications
     SET read_at = NOW()
   WHERE id = ANY(p_ids) AND user_id = auth.uid() AND read_at IS NULL;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION mark_notifications_read(UUID[]) FROM public;
GRANT EXECUTE ON FUNCTION mark_notifications_read(UUID[]) TO authenticated;

-- ── Revisão (Renato) ──────────────────────────────────────────────────────
-- SELECT n.created_at, p.name, n.kind, n.data, n.read_at, n.bot_processed_at
-- FROM notifications n JOIN profiles p ON p.id = n.user_id
-- ORDER BY n.created_at DESC LIMIT 50;
