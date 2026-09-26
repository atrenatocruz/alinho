-- ═════════════════════════════════════════════════════════════════════════
-- Jogo entre amigos: convidar primeiro (mais de 4), formar as equipas
-- depois. Desenho aprovado pelo Francisco a 26 set
-- (design-handoff/2026-09-26-criar-mix-passos/SPEC-jogo-entre-amigos.md);
-- plano aprovado por ele no mesmo dia. Ecrã: Dev 2. Só o jogo entre amigos
-- (Perfil); o jogo de grupo fica para depois (regras diferentes, Renato).
--
-- A IDEIA: aproveita o private_matches. Os resultados e o nível continuam
-- a ler os 4 lugares (team_a/b_player1/2), jogo a jogo, com o submit e o
-- confirm de hoje. O que é novo fica À VOLTA:
--   · private_match_invitees — a lista de quem joga (o criador incluído),
--     sem limite: com conta (aceita ou recusa) ou só pelo nome («Convidado»,
--     conta logo como aceite). Um nome com email recebe um link
--     (invite_token) e um email; o email em si é da send-email (Renato) —
--     aqui fica marcado email_status = 'queued' (proposta a ele à parte).
--     Um email que já tem conta não fica como convidado: vira convite na
--     app para essa pessoa.
--   · A 1.ª linha do private_matches é a sessão (is_friend_session): guarda
--     o dia, a hora, o sítio, as regras, e é o JOGO 1. Os jogos seguintes
--     são linhas novas com session_id = a 1.ª e game_number 2, 3…
--   · As equipas formam-se depois de todos responderem
--     (set_friend_match_teams, jogo 1) e em cada jogo seguinte
--     (add_friend_match_game) — quem não está nas duas equipas descansa. O
--     ecrã calcula a rotação; aqui valida-se e grava-se.
--   · O lugar team_a_player1 tem de ser alguém com conta (a tabela não tem
--     nome de convidado nesse lugar): a função arruma as equipas para isso,
--     e recusa um jogo em que só jogam convidados.
--
-- Funções (nomes combinados com o Dev 2; todas SECURITY DEFINER, só para
-- quem tem sessão; REVOKE explícito de PUBLIC e anon):
--   create_friend_match · add_friend_match_invitees ·
--   remove_friend_match_invitee · respond_friend_match_invite ·
--   set_friend_match_teams · add_friend_match_game · get_friend_match ·
--   list_my_friend_match_invites · claim_friend_match_invite ·
--   claim_friend_match_invites_by_email
-- Aviso no sino: notifications kind 'friend_match_invite'.
--
-- Não mexe nas funções que já existem (create_private_match, submit,
-- confirm, claim_private_match_slot…): os jogos antigos continuam iguais.
-- A única que muda é get_my_private_matches (a agenda): deixa de mostrar a
-- sessão enquanto as equipas não estão feitas (troca só o fim do WHERE da
-- função viva; diz «já estava» se já tiver corrido).
--
-- O email ao convidado sem conta: proposta ao Renato em
-- design-handoff/2026-09-26-criar-mix-passos/NOTA-PARA-RENATO-email-convite-amigos.md
-- (a send-email é dele). Até lá, os convites ficam com email_status 'queued'.
--
-- Testado no alinho-dev (26 set) numa transação desfeita no fim, com o
-- private_matches posto primeiro na forma de produção (o dev está atrás).
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 0. Peças de que depende ─────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.private_matches') IS NULL OR to_regclass('public.notifications') IS NULL THEN
    RAISE EXCEPTION 'Faltam private_matches ou notifications. Parar e ler.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'private_matches'
                    AND column_name = 'team_b_player2_guest_name') THEN
    RAISE EXCEPTION 'Falta a migration_private_match_ranked_consent.sql. Parar e ler.';
  END IF;
END $$;

-- ── 1. A sessão e os jogos seguintes ────────────────────────────────────
ALTER TABLE private_matches ADD COLUMN IF NOT EXISTS is_friend_session BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE private_matches ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES private_matches(id) ON DELETE CASCADE;
ALTER TABLE private_matches ADD COLUMN IF NOT EXISTS game_number INTEGER;
ALTER TABLE private_matches ADD COLUMN IF NOT EXISTS teams_mode TEXT;
ALTER TABLE private_matches ADD COLUMN IF NOT EXISTS pairing_mode TEXT;
ALTER TABLE private_matches ADD COLUMN IF NOT EXISTS teams_set_at TIMESTAMPTZ;
ALTER TABLE private_matches DROP CONSTRAINT IF EXISTS private_matches_friend_modes_check;
ALTER TABLE private_matches ADD CONSTRAINT private_matches_friend_modes_check CHECK (
  (teams_mode IS NULL OR teams_mode IN ('manual', 'app'))
  AND (pairing_mode IS NULL OR pairing_mode IN ('fixed', 'rotating')));
CREATE INDEX IF NOT EXISTS private_matches_session_idx ON private_matches (session_id) WHERE session_id IS NOT NULL;

-- ── 2. Quem joga ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS private_match_invitees (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id     UUID NOT NULL REFERENCES private_matches(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES profiles(id) ON DELETE CASCADE,
  guest_name   TEXT,
  guest_email  TEXT,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'accepted', 'declined', 'guest')),
  invite_token TEXT UNIQUE,
  email_status TEXT NOT NULL DEFAULT 'none' CHECK (email_status IN ('none', 'queued', 'sent', 'failed')),
  invited_by   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  -- clock_timestamp e não NOW(): a lista inteira entra na mesma transação,
  -- e é por esta hora que a lista sai pela ordem em que foi escrita.
  created_at   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  responded_at TIMESTAMPTZ,
  CHECK (user_id IS NOT NULL OR guest_name IS NOT NULL),
  CHECK (user_id IS NULL OR guest_name IS NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS private_match_invitees_user_uniq
  ON private_match_invitees (match_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS private_match_invitees_guest_uniq
  ON private_match_invitees (match_id, lower(guest_name)) WHERE user_id IS NULL;
CREATE INDEX IF NOT EXISTS private_match_invitees_user_idx ON private_match_invitees (user_id);
ALTER TABLE private_match_invitees ENABLE ROW LEVEL SECURITY;
-- Ninguém lê nem escreve direto: tudo pelas funções abaixo.
REVOKE ALL ON private_match_invitees FROM anon, authenticated;

-- ── 3. Peças internas (só as funções as chamam) ─────────────────────────
-- Junta uma pessoa à lista. item = {user_id} | {guest_name, guest_email?}.
CREATE OR REPLACE FUNCTION public.friend_match_add_invitee(p_root UUID, p_item JSONB)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_root    private_matches;
  v_user    UUID := NULLIF(p_item->>'user_id', '')::uuid;
  v_name    TEXT := NULLIF(trim(p_item->>'guest_name'), '');
  v_email   TEXT := NULLIF(lower(trim(p_item->>'guest_email')), '');
  v_id      UUID;
BEGIN
  SELECT * INTO v_root FROM private_matches WHERE id = p_root;
  -- Um email que já tem conta: é essa pessoa, com convite na app.
  IF v_user IS NULL AND v_email IS NOT NULL THEN
    SELECT u.id INTO v_user FROM auth.users u
     WHERE lower(u.email) = v_email AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = u.id)
     LIMIT 1;
    IF v_user IS NOT NULL THEN v_name := NULL; v_email := NULL; END IF;
  END IF;
  IF v_user IS NULL AND v_name IS NULL THEN
    RAISE EXCEPTION 'Cada pessoa tem de ter conta ou um nome';
  END IF;
  IF v_user IS NOT NULL AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_user) THEN
    RAISE EXCEPTION 'Jogador não encontrado';
  END IF;
  IF v_user IS NOT NULL AND EXISTS (SELECT 1 FROM private_match_invitees
                                     WHERE match_id = p_root AND user_id = v_user) THEN
    RAISE EXCEPTION 'Essa pessoa já está no jogo';
  END IF;
  IF v_user IS NULL AND EXISTS (SELECT 1 FROM private_match_invitees
                                 WHERE match_id = p_root AND user_id IS NULL AND lower(guest_name) = lower(v_name)) THEN
    RAISE EXCEPTION 'Já há um convidado com o nome %', v_name;
  END IF;

  INSERT INTO private_match_invitees (match_id, user_id, guest_name, guest_email, status,
                                      invite_token, email_status, invited_by)
  VALUES (p_root, v_user, v_name, CASE WHEN v_user IS NULL THEN v_email END,
          CASE WHEN v_user IS NULL THEN 'guest' ELSE 'pending' END,
          CASE WHEN v_user IS NULL AND v_email IS NOT NULL THEN md5(gen_random_uuid()::text || gen_random_uuid()::text) END,
          CASE WHEN v_user IS NULL AND v_email IS NOT NULL THEN 'queued' ELSE 'none' END,
          auth.uid())
  RETURNING id INTO v_id;

  -- Convite na app: aviso no sino.
  IF v_user IS NOT NULL THEN
    INSERT INTO notifications (user_id, kind, actor_id, data)
    VALUES (v_user, 'friend_match_invite', auth.uid(), jsonb_build_object(
      'match_id', p_root,
      'creator_name', (SELECT name FROM profiles WHERE id = v_root.creator_id),
      'scheduled_date', v_root.scheduled_date, 'scheduled_time', v_root.scheduled_time,
      'location', v_root.location));
  END IF;
  RETURN v_id;
END;
$$;

-- Os 4 lugares de um jogo a partir de dois pares de convidados (invitee
-- ids). O lugar team_a_player1 tem de ter conta: arruma as equipas para
-- isso. Devolve um JSON com as colunas a gravar.
CREATE OR REPLACE FUNCTION public.friend_match_slots(p_root UUID, p_team_a UUID[], p_team_b UUID[])
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_root   private_matches;
  v_a      UUID[] := p_team_a;
  v_b      UUID[] := p_team_b;
  v_tmp    UUID[];
  v_all    UUID[];
  r        RECORD;
  v_out    JSONB := '{}'::jsonb;
  v_slot   TEXT;
  i        INTEGER;
BEGIN
  SELECT * INTO v_root FROM private_matches WHERE id = p_root;
  IF cardinality(v_a) IS DISTINCT FROM 2 OR cardinality(v_b) IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'Cada equipa tem 2 pessoas';
  END IF;
  v_all := v_a || v_b;
  IF (SELECT count(DISTINCT x) FROM unnest(v_all) x) <> 4 THEN
    RAISE EXCEPTION 'A mesma pessoa não pode estar em dois lugares';
  END IF;
  FOR i IN 1..4 LOOP
    IF NOT EXISTS (SELECT 1 FROM private_match_invitees
                    WHERE id = v_all[i] AND match_id = p_root AND status IN ('accepted', 'guest')) THEN
      RAISE EXCEPTION 'Só joga quem aceitou o convite';
    END IF;
  END LOOP;

  -- O 1.º lugar da equipa A tem de ter conta.
  IF (SELECT user_id IS NULL FROM private_match_invitees WHERE id = v_a[1]) THEN
    IF (SELECT user_id IS NOT NULL FROM private_match_invitees WHERE id = v_a[2]) THEN
      v_a := ARRAY[v_a[2], v_a[1]];
    ELSE
      v_tmp := v_a; v_a := v_b; v_b := v_tmp;
      IF (SELECT user_id IS NULL FROM private_match_invitees WHERE id = v_a[1]) THEN
        IF (SELECT user_id IS NOT NULL FROM private_match_invitees WHERE id = v_a[2]) THEN
          v_a := ARRAY[v_a[2], v_a[1]];
        ELSE
          RAISE EXCEPTION 'Em cada jogo tem de jogar pelo menos uma pessoa com conta';
        END IF;
      END IF;
    END IF;
  END IF;

  FOR i IN 1..4 LOOP
    v_slot := (ARRAY['team_a_player1', 'team_a_player2', 'team_b_player1', 'team_b_player2'])[i];
    SELECT * INTO r FROM private_match_invitees WHERE id = (v_a || v_b)[i];
    v_out := v_out
      || jsonb_build_object(v_slot || '_id', r.user_id)
      || jsonb_build_object(v_slot || '_status',
           CASE WHEN r.user_id IS NULL THEN 'guest'
                WHEN v_root.ranked_intent THEN 'accepted_all' ELSE 'accepted_no_ranking' END);
    IF i > 1 THEN
      v_out := v_out || jsonb_build_object(v_slot || '_guest_name', r.guest_name);
    END IF;
  END LOOP;
  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.friend_match_add_invitee(UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.friend_match_slots(UUID, UUID[], UUID[]) FROM PUBLIC, anon, authenticated;

-- ── 4. Criar ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_friend_match(
  p_scheduled_date     DATE,
  p_scheduled_time     TIME DEFAULT NULL,
  p_location           TEXT DEFAULT NULL,
  p_location_latitude  DOUBLE PRECISION DEFAULT NULL,
  p_location_longitude DOUBLE PRECISION DEFAULT NULL,
  p_ranked_intent      BOOLEAN DEFAULT TRUE,
  p_scoring_format     TEXT DEFAULT 'pontos_simples',
  p_num_sets           INTEGER DEFAULT NULL,
  p_teams_mode         TEXT DEFAULT 'manual',
  p_invitees           JSONB DEFAULT '[]'::jsonb)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id   UUID;
  v_item JSONB;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Precisas de ter sessão iniciada'; END IF;
  IF p_scheduled_date IS NULL THEN RAISE EXCEPTION 'A data do jogo é obrigatória'; END IF;
  IF p_scoring_format NOT IN ('pontos_simples', 'sets') THEN RAISE EXCEPTION 'Formato de pontuação inválido'; END IF;
  IF p_scoring_format = 'sets' AND (p_num_sets IS NULL OR p_num_sets NOT BETWEEN 2 AND 9) THEN
    RAISE EXCEPTION 'Escolhe quantos sets (entre 2 e 9)';
  END IF;
  IF p_scoring_format = 'pontos_simples' THEN p_num_sets := NULL; END IF;
  IF p_teams_mode NOT IN ('manual', 'app') THEN RAISE EXCEPTION 'Escolhe quem faz as equipas'; END IF;
  IF jsonb_typeof(p_invitees) IS DISTINCT FROM 'array' OR jsonb_array_length(p_invitees) < 3 THEN
    RAISE EXCEPTION 'Faltam pessoas: são precisas pelo menos 4, contigo';
  END IF;

  INSERT INTO private_matches (
    creator_id, team_a_player1_id, ranked_intent, scheduled_date, scheduled_time,
    location, location_latitude, location_longitude, scoring_format, num_sets,
    team_a_player1_status, is_friend_session, game_number, teams_mode)
  VALUES (
    auth.uid(), auth.uid(), p_ranked_intent, p_scheduled_date, p_scheduled_time,
    p_location, p_location_latitude, p_location_longitude, p_scoring_format, p_num_sets,
    CASE WHEN p_ranked_intent THEN 'accepted_all' ELSE 'accepted_no_ranking' END, TRUE, 1, p_teams_mode)
  RETURNING id INTO v_id;

  -- O criador também está na lista, já aceite.
  INSERT INTO private_match_invitees (match_id, user_id, status, invited_by, responded_at)
  VALUES (v_id, auth.uid(), 'accepted', auth.uid(), NOW());

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_invitees) LOOP
    PERFORM friend_match_add_invitee(v_id, v_item);
  END LOOP;
  RETURN v_id;
END;
$$;

-- ── 5. Mexer na lista (só o criador, antes das equipas) ─────────────────
CREATE OR REPLACE FUNCTION public.add_friend_match_invitees(p_match_id UUID, p_invitees JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_root private_matches;
  v_item JSONB;
  v_n    INTEGER := 0;
BEGIN
  SELECT * INTO v_root FROM private_matches WHERE id = p_match_id AND is_friend_session FOR UPDATE;
  IF v_root.id IS NULL THEN RAISE EXCEPTION 'Jogo não encontrado'; END IF;
  IF v_root.creator_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Só quem criou o jogo muda a lista'; END IF;
  IF v_root.teams_set_at IS NOT NULL THEN RAISE EXCEPTION 'As equipas já foram formadas'; END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_invitees, '[]'::jsonb)) LOOP
    PERFORM friend_match_add_invitee(p_match_id, v_item);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_friend_match_invitee(p_invitee_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv  private_match_invitees;
  v_root private_matches;
BEGIN
  SELECT * INTO v_inv FROM private_match_invitees WHERE id = p_invitee_id;
  IF v_inv.id IS NULL THEN RAISE EXCEPTION 'Convite não encontrado'; END IF;
  SELECT * INTO v_root FROM private_matches WHERE id = v_inv.match_id FOR UPDATE;
  IF v_root.creator_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Só quem criou o jogo muda a lista'; END IF;
  IF v_root.teams_set_at IS NOT NULL THEN RAISE EXCEPTION 'As equipas já foram formadas'; END IF;
  IF v_inv.user_id IS NOT DISTINCT FROM v_root.creator_id THEN RAISE EXCEPTION 'Quem criou o jogo não sai da lista'; END IF;
  DELETE FROM private_match_invitees WHERE id = p_invitee_id;
  IF v_inv.user_id IS NOT NULL THEN
    UPDATE notifications SET read_at = NOW()
     WHERE user_id = v_inv.user_id AND kind = 'friend_match_invite' AND read_at IS NULL
       AND data->>'match_id' = v_root.id::text;
  END IF;
END;
$$;

-- ── 6. Responder ao convite ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.respond_friend_match_invite(p_match_id UUID, p_accept BOOLEAN)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_root private_matches;
  v_status TEXT := CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END;
BEGIN
  SELECT * INTO v_root FROM private_matches WHERE id = p_match_id AND is_friend_session;
  IF v_root.id IS NULL THEN RAISE EXCEPTION 'Jogo não encontrado'; END IF;
  IF v_root.teams_set_at IS NOT NULL THEN RAISE EXCEPTION 'As equipas já foram formadas'; END IF;
  UPDATE private_match_invitees SET status = v_status, responded_at = NOW()
   WHERE match_id = p_match_id AND user_id = auth.uid() AND user_id IS DISTINCT FROM v_root.creator_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Não tens convite para este jogo'; END IF;
  UPDATE notifications SET read_at = NOW()
   WHERE user_id = auth.uid() AND kind = 'friend_match_invite' AND read_at IS NULL
     AND data->>'match_id' = p_match_id::text;
  RETURN v_status;
END;
$$;

-- ── 7. Formar as equipas (jogo 1) e os jogos seguintes ──────────────────
CREATE OR REPLACE FUNCTION public.set_friend_match_teams(
  p_match_id UUID, p_pairing_mode TEXT, p_team_a UUID[], p_team_b UUID[])
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_root private_matches;
  s      JSONB;
BEGIN
  SELECT * INTO v_root FROM private_matches WHERE id = p_match_id AND is_friend_session FOR UPDATE;
  IF v_root.id IS NULL THEN RAISE EXCEPTION 'Jogo não encontrado'; END IF;
  IF v_root.creator_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Só quem criou o jogo forma as equipas'; END IF;
  IF p_pairing_mode NOT IN ('fixed', 'rotating') THEN RAISE EXCEPTION 'Escolhe duplas fixas ou a rodar'; END IF;
  IF v_root.score_a IS NOT NULL OR v_root.status <> 'pending' THEN
    RAISE EXCEPTION 'O primeiro jogo já tem resultado: as equipas já não mudam';
  END IF;
  IF EXISTS (SELECT 1 FROM private_match_invitees WHERE match_id = p_match_id AND status = 'pending') THEN
    RAISE EXCEPTION 'Ainda há convites por responder';
  END IF;
  IF (SELECT count(*) FROM private_match_invitees
       WHERE match_id = p_match_id AND status IN ('accepted', 'guest')) < 4 THEN
    RAISE EXCEPTION 'São precisas pelo menos 4 pessoas para haver jogo';
  END IF;

  s := friend_match_slots(p_match_id, p_team_a, p_team_b);
  UPDATE private_matches SET
    team_a_player1_id = (s->>'team_a_player1_id')::uuid, team_a_player1_status = s->>'team_a_player1_status',
    team_a_player2_id = (s->>'team_a_player2_id')::uuid, team_a_player2_status = s->>'team_a_player2_status',
    team_a_player2_guest_name = s->>'team_a_player2_guest_name',
    team_b_player1_id = (s->>'team_b_player1_id')::uuid, team_b_player1_status = s->>'team_b_player1_status',
    team_b_player1_guest_name = s->>'team_b_player1_guest_name',
    team_b_player2_id = (s->>'team_b_player2_id')::uuid, team_b_player2_status = s->>'team_b_player2_status',
    team_b_player2_guest_name = s->>'team_b_player2_guest_name',
    pairing_mode = p_pairing_mode, teams_set_at = NOW()
  WHERE id = p_match_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_friend_match_game(p_match_id UUID, p_team_a UUID[], p_team_b UUID[])
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_root private_matches;
  s      JSONB;
  v_id   UUID;
BEGIN
  SELECT * INTO v_root FROM private_matches WHERE id = p_match_id AND is_friend_session FOR UPDATE;
  IF v_root.id IS NULL THEN RAISE EXCEPTION 'Jogo não encontrado'; END IF;
  IF v_root.creator_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Só quem criou o jogo junta jogos'; END IF;
  IF v_root.teams_set_at IS NULL THEN RAISE EXCEPTION 'Forma primeiro as equipas do primeiro jogo'; END IF;

  s := friend_match_slots(p_match_id, p_team_a, p_team_b);
  INSERT INTO private_matches (
    creator_id, ranked_intent, scheduled_date, scheduled_time, location, location_latitude, location_longitude,
    scoring_format, num_sets, session_id, game_number, pairing_mode, teams_set_at,
    team_a_player1_id, team_a_player1_status,
    team_a_player2_id, team_a_player2_status, team_a_player2_guest_name,
    team_b_player1_id, team_b_player1_status, team_b_player1_guest_name,
    team_b_player2_id, team_b_player2_status, team_b_player2_guest_name)
  VALUES (
    v_root.creator_id, v_root.ranked_intent, v_root.scheduled_date, v_root.scheduled_time,
    v_root.location, v_root.location_latitude, v_root.location_longitude,
    v_root.scoring_format, v_root.num_sets, p_match_id,
    (SELECT COALESCE(max(game_number), 1) + 1 FROM private_matches WHERE session_id = p_match_id),
    v_root.pairing_mode, NOW(),
    (s->>'team_a_player1_id')::uuid, s->>'team_a_player1_status',
    (s->>'team_a_player2_id')::uuid, s->>'team_a_player2_status', s->>'team_a_player2_guest_name',
    (s->>'team_b_player1_id')::uuid, s->>'team_b_player1_status', s->>'team_b_player1_guest_name',
    (s->>'team_b_player2_id')::uuid, s->>'team_b_player2_status', s->>'team_b_player2_guest_name')
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ── 8. Ler ──────────────────────────────────────────────────────────────
-- Para o criador e para quem está na lista (com conta).
CREATE OR REPLACE FUNCTION public.get_friend_match(p_match_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_root UUID;
  v_out  JSONB;
BEGIN
  SELECT COALESCE(session_id, id) INTO v_root FROM private_matches WHERE id = p_match_id;
  IF v_root IS NULL OR NOT EXISTS (SELECT 1 FROM private_matches WHERE id = v_root AND is_friend_session) THEN
    RAISE EXCEPTION 'Jogo não encontrado';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM private_match_invitees WHERE match_id = v_root AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Não estás neste jogo' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT jsonb_build_object(
    'match', (SELECT jsonb_build_object(
                'id', m.id, 'creator_id', m.creator_id, 'creator_name', p.name,
                'scheduled_date', m.scheduled_date, 'scheduled_time', m.scheduled_time,
                'location', m.location, 'location_latitude', m.location_latitude, 'location_longitude', m.location_longitude,
                'ranked_intent', m.ranked_intent, 'scoring_format', m.scoring_format, 'num_sets', m.num_sets,
                'teams_mode', m.teams_mode, 'pairing_mode', m.pairing_mode, 'teams_set_at', m.teams_set_at)
                FROM private_matches m LEFT JOIN profiles p ON p.id = m.creator_id WHERE m.id = v_root),
    'invitees', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                  'invitee_id', i.id, 'user_id', i.user_id, 'name', COALESCE(p.name, i.guest_name),
                  'avatar_url', p.avatar_url, 'rating', p.rating, 'gender', p.gender,
                  'status', i.status, 'is_guest', i.user_id IS NULL,
                  'is_creator', i.user_id IS NOT DISTINCT FROM m.creator_id,
                  'guest_email_sent', i.email_status IN ('queued', 'sent'))
                  ORDER BY (i.user_id IS NOT DISTINCT FROM m.creator_id) DESC, i.created_at)
                  FROM private_match_invitees i
                  JOIN private_matches m ON m.id = i.match_id
                  LEFT JOIN profiles p ON p.id = i.user_id
                 WHERE i.match_id = v_root), '[]'::jsonb),
    -- Cada jogo: as duas equipas e quem descansa, por invitee_id (o que o
    -- ecrã usa) e com o nome.
    'games', COALESCE((SELECT jsonb_agg(g ORDER BY (g->>'n')::int) FROM (
                  SELECT jsonb_build_object(
                    'id', m.id, 'n', COALESCE(m.game_number, 1),
                    'team_a', (SELECT jsonb_agg(e - 'k' ORDER BY (e->>'k')::int)
                                 FROM jsonb_array_elements(s.sl) e WHERE (e->>'k')::int <= 2),
                    'team_b', (SELECT jsonb_agg(e - 'k' ORDER BY (e->>'k')::int)
                                 FROM jsonb_array_elements(s.sl) e WHERE (e->>'k')::int > 2),
                    'resting', COALESCE((SELECT jsonb_agg(ri.id ORDER BY ri.created_at)
                                 FROM private_match_invitees ri
                                WHERE ri.match_id = v_root AND ri.status IN ('accepted', 'guest')
                                  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(s.sl) e
                                                   WHERE e->>'invitee_id' = ri.id::text)), '[]'::jsonb),
                    'score_a', m.score_a, 'score_b', m.score_b, 'winner_team', m.winner_team, 'status', m.status) AS g
                  FROM private_matches m
                  CROSS JOIN LATERAL (
                    SELECT jsonb_agg(jsonb_build_object(
                             'k', sl.k, 'user_id', sl.uid, 'name', COALESCE(pp.name, sl.gname),
                             'invitee_id', (SELECT ii.id FROM private_match_invitees ii
                                             WHERE ii.match_id = v_root
                                               AND ((sl.uid IS NOT NULL AND ii.user_id = sl.uid)
                                                 OR (sl.uid IS NULL AND ii.user_id IS NULL
                                                     AND lower(ii.guest_name) = lower(sl.gname)))))) AS sl
                      FROM (VALUES (1, m.team_a_player1_id, NULL::text),
                                   (2, m.team_a_player2_id, m.team_a_player2_guest_name),
                                   (3, m.team_b_player1_id, m.team_b_player1_guest_name),
                                   (4, m.team_b_player2_id, m.team_b_player2_guest_name)) AS sl(k, uid, gname)
                      LEFT JOIN profiles pp ON pp.id = sl.uid
                  ) AS s
                 WHERE (m.id = v_root AND m.teams_set_at IS NOT NULL) OR m.session_id = v_root) x), '[]'::jsonb))
    INTO v_out;
  RETURN v_out;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_my_friend_match_invites()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'match_id', m.id, 'creator_name', p.name, 'scheduled_date', m.scheduled_date,
           'scheduled_time', m.scheduled_time, 'location', m.location,
           'people', (SELECT count(*) FROM private_match_invitees x WHERE x.match_id = m.id AND x.status <> 'declined'))
           ORDER BY m.scheduled_date, m.scheduled_time), '[]'::jsonb)
    FROM private_match_invitees i
    JOIN private_matches m ON m.id = i.match_id AND m.is_friend_session AND m.teams_set_at IS NULL
    LEFT JOIN profiles p ON p.id = m.creator_id
   WHERE i.user_id = auth.uid() AND i.status = 'pending';
$$;

-- ── 9. Quem entrou pelo nome e depois criou conta ───────────────────────
-- Passa o lugar de convidado para a conta: na lista e nos jogos da sessão
-- (os resultados passam a aparecer no histórico dela). O nível dos jogos já
-- confirmados não se refaz — um jogo com convidados nunca contou.
CREATE OR REPLACE FUNCTION public.friend_match_claim_guest(p_invitee_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv private_match_invitees;
BEGIN
  SELECT * INTO v_inv FROM private_match_invitees WHERE id = p_invitee_id FOR UPDATE;
  IF v_inv.id IS NULL OR v_inv.user_id IS NOT NULL THEN RAISE EXCEPTION 'Convite não encontrado ou já usado'; END IF;
  IF EXISTS (SELECT 1 FROM private_match_invitees WHERE match_id = v_inv.match_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Já estás neste jogo';
  END IF;
  UPDATE private_matches SET team_a_player2_id = auth.uid(), team_a_player2_guest_name = NULL,
         team_a_player2_status = CASE WHEN ranked_intent THEN 'accepted_all' ELSE 'accepted_no_ranking' END
   WHERE (id = v_inv.match_id OR session_id = v_inv.match_id) AND team_a_player2_guest_name = v_inv.guest_name;
  UPDATE private_matches SET team_b_player1_id = auth.uid(), team_b_player1_guest_name = NULL,
         team_b_player1_status = CASE WHEN ranked_intent THEN 'accepted_all' ELSE 'accepted_no_ranking' END
   WHERE (id = v_inv.match_id OR session_id = v_inv.match_id) AND team_b_player1_guest_name = v_inv.guest_name;
  UPDATE private_matches SET team_b_player2_id = auth.uid(), team_b_player2_guest_name = NULL,
         team_b_player2_status = CASE WHEN ranked_intent THEN 'accepted_all' ELSE 'accepted_no_ranking' END
   WHERE (id = v_inv.match_id OR session_id = v_inv.match_id) AND team_b_player2_guest_name = v_inv.guest_name;
  UPDATE private_match_invitees
     SET user_id = auth.uid(), guest_name = NULL, guest_email = NULL, invite_token = NULL,
         status = 'accepted', responded_at = NOW()
   WHERE id = p_invitee_id;
  RETURN v_inv.match_id;
END;
$$;
REVOKE ALL ON FUNCTION public.friend_match_claim_guest(UUID) FROM PUBLIC, anon, authenticated;

-- Pelo link do email.
CREATE OR REPLACE FUNCTION public.claim_friend_match_invite(p_token TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Precisas de ter sessão iniciada'; END IF;
  SELECT id INTO v_id FROM private_match_invitees WHERE invite_token = p_token AND user_id IS NULL;
  IF v_id IS NULL THEN RAISE EXCEPTION 'Convite não encontrado ou já usado'; END IF;
  RETURN friend_match_claim_guest(v_id);
END;
$$;

-- Depois do login: os convites guardados com o email desta conta.
CREATE OR REPLACE FUNCTION public.claim_friend_match_invites_by_email()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
  v_id    UUID;
  v_n     INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL THEN RETURN 0; END IF;
  SELECT lower(email) INTO v_email FROM auth.users WHERE id = auth.uid();
  IF v_email IS NULL THEN RETURN 0; END IF;
  FOR v_id IN SELECT i.id FROM private_match_invitees i
               WHERE i.user_id IS NULL AND i.guest_email = v_email
                 AND NOT EXISTS (SELECT 1 FROM private_match_invitees j
                                  WHERE j.match_id = i.match_id AND j.user_id = auth.uid()) LOOP
    PERFORM friend_match_claim_guest(v_id);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

-- ── 10. A lista «os meus jogos» não mostra a sessão antes das equipas ───
-- Antes das equipas, a 1.ª linha só tem o criador num lugar e os outros
-- vazios: na agenda dele apareceria como um jogo com 3 lugares por
-- preencher. Troca só o fim do WHERE da função viva.
DO $$
DECLARE
  c_mau CONSTANT TEXT := '\)\s*ORDER BY pm\.played_at DESC;';
  c_bom CONSTANT TEXT := ')
    AND NOT (pm.is_friend_session AND pm.teams_set_at IS NULL)
  ORDER BY pm.played_at DESC;';
  v_def TEXT := pg_get_functiondef('public.get_my_private_matches()'::regprocedure);
  v_n   INTEGER;
BEGIN
  IF v_def LIKE '%pm.is_friend_session AND pm.teams_set_at IS NULL%' THEN
    RAISE NOTICE 'get_my_private_matches: já estava';
    RETURN;
  END IF;
  SELECT count(*) INTO v_n FROM regexp_matches(v_def, c_mau, 'g');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'get_my_private_matches: esperava o fim do WHERE 1 vez, encontrei %. Parar e ler.', v_n;
  END IF;
  EXECUTE regexp_replace(v_def, c_mau, c_bom);
END $$;

-- ── 11. Permissões ──────────────────────────────────────────────────────
DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.create_friend_match(date, time, text, double precision, double precision, boolean, text, integer, text, jsonb)',
    'public.add_friend_match_invitees(uuid, jsonb)',
    'public.remove_friend_match_invitee(uuid)',
    'public.respond_friend_match_invite(uuid, boolean)',
    'public.set_friend_match_teams(uuid, text, uuid[], uuid[])',
    'public.add_friend_match_game(uuid, uuid[], uuid[])',
    'public.get_friend_match(uuid)',
    'public.list_my_friend_match_invites()',
    'public.claim_friend_match_invite(text)',
    'public.claim_friend_match_invites_by_email()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

COMMIT;
