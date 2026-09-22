-- ════════════════════════════════════════════════════════════════════════
-- Parceiro sem conta nos mixes de duplas fixas (Trello #339)
--
-- NÃO CORRER sem o sim do Renato — mexe em auth/profiles e cria tabela nova.
--
-- PORQUÊ ASSIM. Um jogador quer inscrever-se com um amigo que não está na
-- app. As duplas (teams.player1_id/player2_id) e os resultados só aceitam
-- contas (profiles.id -> auth.users), por isso um nome em texto não pode
-- entrar numa dupla nem num campo. Caminho escolhido pelo Francisco
-- (21 set 2026): a app cria a conta do parceiro **por reclamar**
-- (claim_pending), ele joga como toda a gente, e quando abrir o convite
-- fica com o lugar — o histórico não se perde.
--
-- TRAVÕES (a diferença para as "contas fantasma" da importação em massa):
--   1. a conta nasce marcada claim_pending = TRUE e não conta para o limite
--      de membros do plano (ver nota no fim — é função do Renato);
--   2. email verdadeiro ou nenhum: nunca um email inventado;
--   3. quem reclama fica com a SUA conta e o lugar é transferido para ela;
--      a conta por reclamar desaparece;
--   4. o convite expira (30 dias) e pode ser cancelado por quem convidou.
--
-- A CRIAÇÃO da conta não é feita aqui: precisa da service-role key, por
-- isso vive na edge function `join-with-named-partner`. Este ficheiro faz
-- a parte que a base de dados tem de garantir: a marca, o convite, e a
-- transferência do lugar (reclamar).
--
-- Dev 2, 21 set 2026 · cartão #339 · a seguir a migration_kudos_voter_names.sql
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. A marca "conta por reclamar" ─────────────────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS claim_pending BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN profiles.claim_pending IS
  'Conta criada por outra pessoa (parceiro sem conta num mix, Trello #339), à espera de dono. Não conta para o limite de membros do plano e não deve aparecer em pesquisas de pessoas.';

-- ── 2. O convite ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS partner_invites (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_id        UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  participant_id UUID REFERENCES participants(id) ON DELETE CASCADE,
  -- A conta por reclamar que está a jogar no lugar dele.
  placeholder_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  invited_by     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  -- Opcional: só existe se quem convidou o escreveu. É por aqui que o
  -- envio de emails (a ser feito pelo Renato, 21 set) manda o convite.
  email          TEXT,
  token          TEXT NOT NULL UNIQUE,
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'claimed', 'cancelled', 'expired')),
  -- 'none'   — sem email, o convite vai por link colado no WhatsApp
  -- 'queued' — há email e está à espera do envio
  -- 'sent'   — o envio já saiu
  email_status   TEXT NOT NULL DEFAULT 'none'
                 CHECK (email_status IN ('none', 'queued', 'sent', 'failed')),
  expires_at     TIMESTAMPTZ NOT NULL DEFAULT (TIMEZONE('utc', NOW()) + INTERVAL '30 days'),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  claimed_by     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  claimed_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS partner_invites_game_idx ON partner_invites(game_id);
CREATE INDEX IF NOT EXISTS partner_invites_placeholder_idx ON partner_invites(placeholder_id);
-- Para o envio de emails ir buscar o que falta mandar.
CREATE INDEX IF NOT EXISTS partner_invites_to_send_idx
  ON partner_invites(email_status) WHERE email_status = 'queued';

ALTER TABLE partner_invites ENABLE ROW LEVEL SECURITY;

-- Quem convidou vê e cancela o seu convite. Mais ninguém lê a tabela: quem
-- recebe o convite chega por token, pela RPC de baixo, sem SELECT nenhum.
DROP POLICY IF EXISTS partner_invites_owner_select ON partner_invites;
CREATE POLICY partner_invites_owner_select ON partner_invites
  FOR SELECT USING (invited_by = auth.uid());

-- Sem política de UPDATE de propósito: um UPDATE de cliente sobre esta
-- tabela (mesmo restrito a invited_by = auth.uid()) deixa o placeholder_id
-- aberto a ser reapontado para a conta de outra pessoa, e as RPCs de baixo
-- (SECURITY DEFINER) confiam nesse valor. Cancelar/reclamar passam sempre
-- pelas RPCs, nunca por um UPDATE direto do cliente.
DROP POLICY IF EXISTS partner_invites_owner_cancel ON partner_invites;

-- Sem política de INSERT de propósito: só a edge function (service-role)
-- cria convites, porque só ela pode criar a conta por reclamar.

-- ── 3. Reclamar o lugar ─────────────────────────────────────────────────
-- Quem recebeu o convite regista-se normalmente (conta dele, email dele) e
-- chama isto com o token. O lugar passa da conta por reclamar para a dele.
CREATE OR REPLACE FUNCTION claim_partner_invite(p_token TEXT)
RETURNS UUID   -- o game_id, para a app saltar para o mix
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite partner_invites%ROWTYPE;
  v_me UUID := auth.uid();
  v_org UUID;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not_signed_in';
  END IF;

  SELECT * INTO v_invite FROM partner_invites
   WHERE token = p_token AND status = 'pending'
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite_not_found';
  END IF;

  IF v_invite.expires_at < TIMEZONE('utc', NOW()) THEN
    UPDATE partner_invites SET status = 'expired' WHERE id = v_invite.id;
    RAISE EXCEPTION 'invite_expired';
  END IF;

  IF v_me = v_invite.placeholder_id THEN
    RAISE EXCEPTION 'invite_is_your_own_placeholder';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = v_invite.placeholder_id AND claim_pending
  ) THEN
    RAISE EXCEPTION 'invite_placeholder_invalid';
  END IF;

  SELECT organization_id INTO v_org FROM games WHERE id = v_invite.game_id;

  -- Quem reclama tem de ser membro do grupo para jogar lá.
  INSERT INTO memberships (user_id, organization_id, is_guest)
  VALUES (v_me, v_org, TRUE)
  ON CONFLICT (user_id, organization_id) DO NOTHING;

  -- O lugar: inscrição, duplas e histórico passam para a conta dele.
  UPDATE participants SET partner_id = v_me
   WHERE partner_id = v_invite.placeholder_id AND game_id = v_invite.game_id;
  UPDATE participants SET user_id = v_me
   WHERE user_id = v_invite.placeholder_id AND game_id = v_invite.game_id;
  UPDATE teams SET player1_id = v_me
   WHERE player1_id = v_invite.placeholder_id AND game_id = v_invite.game_id;
  UPDATE teams SET player2_id = v_me
   WHERE player2_id = v_invite.placeholder_id AND game_id = v_invite.game_id;

  UPDATE partner_invites
     SET status = 'claimed', claimed_by = v_me, claimed_at = TIMEZONE('utc', NOW())
   WHERE id = v_invite.id;

  -- A conta por reclamar deixa de ter uso. Fica só marcada: apagar a
  -- linha de auth.users precisa da service-role, e é feito pela limpeza
  -- (ver nota 2 no fim).
  DELETE FROM memberships WHERE user_id = v_invite.placeholder_id;
  UPDATE profiles SET name = 'Jogador removido', claim_pending = FALSE
   WHERE id = v_invite.placeholder_id;

  RETURN v_invite.game_id;
END;
$$;

REVOKE ALL ON FUNCTION claim_partner_invite(TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION claim_partner_invite(TEXT) TO authenticated;

-- ── 4. Cancelar / trocar de parceiro ────────────────────────────────────
-- Quem convidou pode desfazer enquanto o mix não começar. A inscrição da
-- dupla é desfeita pelo caminho normal (sair do mix / tirar o parceiro);
-- isto só fecha o convite e a conta por reclamar.
CREATE OR REPLACE FUNCTION cancel_partner_invite(p_invite_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite partner_invites%ROWTYPE;
BEGIN
  SELECT * INTO v_invite FROM partner_invites
   WHERE id = p_invite_id AND invited_by = auth.uid() AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite_not_found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = v_invite.placeholder_id AND claim_pending
  ) THEN
    RAISE EXCEPTION 'invite_placeholder_invalid';
  END IF;

  UPDATE partner_invites SET status = 'cancelled' WHERE id = v_invite.id;
  DELETE FROM participants
   WHERE game_id = v_invite.game_id AND partner_id = v_invite.placeholder_id;
  DELETE FROM memberships WHERE user_id = v_invite.placeholder_id;
END;
$$;

REVOKE ALL ON FUNCTION cancel_partner_invite(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION cancel_partner_invite(UUID) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- NOTAS PARA O RENATO (por fazer, fora deste ficheiro)
--
-- 1. LIMITE DE MEMBROS DO PLANO: as contas por reclamar não podem contar.
--    A contagem vive na tua função dos planos — não lhe toquei para não
--    chocar com o que os outros agentes andam a mexer. Falta acrescentar
--    `AND NOT p.claim_pending` onde os membros são contados.
--
-- 2. LIMPEZA: depois de reclamado (ou 30 dias depois de expirado), a linha
--    em auth.users da conta por reclamar pode ser apagada — precisa da
--    service-role, por isso é um job ou uma edge function, não SQL daqui.
--
-- 3. ENVIO DO EMAIL: os convites com email ficam em
--    partner_invites.email_status = 'queued'. O que estás a construir só
--    precisa de ler essas linhas, mandar o email com
--    <app>/convite/<token>, e pôr 'sent' (ou 'failed'). Se preferires
--    outro encaixe, diz e eu mudo — não há nada do meu lado agarrado a
--    este formato.
--
-- 4. PESQUISAS DE PESSOAS: convém esconder claim_pending = TRUE de
--    search_any_player e afins, para ninguém convidar uma conta que ainda
--    não tem dono.
-- ════════════════════════════════════════════════════════════════════════
