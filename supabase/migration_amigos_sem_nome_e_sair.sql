-- ═════════════════════════════════════════════════════════════════════════
-- Jogo entre amigos: «Vou, mas sem o meu nome» e «Não vou»
--
-- PORQUÊ. Aprovado pelo Francisco a 27 set («Sim»), fim de
-- design-handoff/2026-09-27-amigos-sem-bloquear/SPEC.md («Quem recusa, e
-- jogar sem nome»). Caso dele: «pode acontecer a pessoa rejeitar… porque não
-- quer ficar registada, mas é essa pessoa que vai na mesma». Ecrã: Dev 2.
--
-- PRIVACIDADE (PO, 27 set): depois de sair ou de ficar sem nome, NADA liga a
-- conta da pessoa ao jogo — nem a lista, nem os jogos, nem o sino, nem as
-- funções de leitura. A linha dela passa a um lugar sem conta.
--
-- O QUE FAZ.
--   1. private_match_invitees ganha is_anonymous e left_name (o nome de
--      quem saiu, só para quem criou ler «A <Nome> saiu»).
--   2. NOVA play_friend_match_without_name(p_match_id) → 'guest': o lugar
--      fica «Jogador sem nome» (…«2», «3» se houver mais), joga; nos jogos
--      da sessão o lugar passa a convidado com esse nome — esses jogos
--      nunca contam para o ranking (soma zero, #440).
--   3. respond_friend_match_invite(p_match_id, false) — o «Não vou» — passa
--      a sair assim: o lugar fica sem conta e 'declined' (fora de «Quem
--      joga»); os jogos seguintes sem resultado com ela apagam-se; no jogo 1
--      e nos jogos com resultado o lugar fica «Jogador sem nome», sem contar.
--      Quem criou recebe no sino 'friend_match_declined' (sem actor_id).
--      O «Vou» não muda. Troca no corpo VIVO (1 vez; «já estava»).
--   4. NOVA keep_friend_match_seat(p_invitee_id): «Manter o lugar sem
--      nome» — só quem criou; um lugar 'declined' sem nome passa a 'guest'.
--   5. Nos dois casos, os avisos do sino da pessoa sobre este jogo apagam-se.
--   6. get_friend_match: 'is_anonymous' e 'left_name' (este só para quem
--      criou) em cada pessoa.
--   7. Quem recusou ANTES desta regra (linhas 'declined' ainda com a conta)
--      passa também a lugar sem nome (PO, 27 set), com arquivo:
--      arquivo_amigos_sem_nome.linhas + arquivo_amigos_sem_nome.desfazer().
--      Uma linha que não dê (ex. 'only_account_in_game') fica por ver à mão
--      (NOTICE), sem parar o resto.
--   O ✕ e o ＋ de quem criou usam remove/add_friend_match_invitee(s) de hoje.
--
-- Por dentro: o 1.º lugar da equipa A tem de ser uma conta (a tabela não tem
-- nome de convidado aí). Se quem sai estiver lá, troca com o parceiro; se o
-- parceiro também não tiver conta, trocam as equipas (com o resultado e os
-- sets virados). Sem nenhuma conta no jogo: 'only_account_in_game'.
--
-- Dev 3, 27 set 2026 · depois de migration_amigos_editar_e_sets.sql
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 0. Peças de que depende ─────────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.update_friend_match(uuid, date, time, text, double precision, double precision, text, smallint, text, smallint)') IS NULL
     OR pg_get_functiondef('public.respond_friend_match_invite(uuid, boolean)'::regprocedure) NOT LIKE '%friend_match_settle_slots%' THEN
    RAISE EXCEPTION 'Faltam migration_amigos_sem_bloquear.sql / migration_amigos_editar_e_sets.sql. Parar e ler.';
  END IF;
END $$;

-- ── 1. O lugar sem nome ─────────────────────────────────────────────────
ALTER TABLE private_match_invitees ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE private_match_invitees ADD COLUMN IF NOT EXISTS left_name TEXT;

-- Tira uma pessoa de um lugar de um jogo, pondo lá o convidado p_new.
-- p_user (conta) ou p_old_guest (nome de convidado) diz qual é o lugar.
CREATE OR REPLACE FUNCTION public.friend_match_anonymize_slot(p_game UUID, p_user UUID, p_old_guest TEXT, p_new TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g private_matches%ROWTYPE;
  v_a1 UUID; v_a1s TEXT;
  v_a2 UUID; v_a2s TEXT; v_a2g TEXT;
  v_b1 UUID; v_b1s TEXT; v_b1g TEXT;
  v_b2 UUID; v_b2s TEXT; v_b2g TEXT;
  v_swap BOOLEAN := FALSE;
  v_k INTEGER;
BEGIN
  SELECT * INTO g FROM private_matches WHERE id = p_game FOR UPDATE;
  v_a1 := g.team_a_player1_id; v_a1s := g.team_a_player1_status;
  v_a2 := g.team_a_player2_id; v_a2s := g.team_a_player2_status; v_a2g := g.team_a_player2_guest_name;
  v_b1 := g.team_b_player1_id; v_b1s := g.team_b_player1_status; v_b1g := g.team_b_player1_guest_name;
  v_b2 := g.team_b_player2_id; v_b2s := g.team_b_player2_status; v_b2g := g.team_b_player2_guest_name;

  v_k := CASE
    WHEN p_user IS NOT NULL AND v_a1 = p_user THEN 1
    WHEN p_user IS NOT NULL AND v_a2 = p_user THEN 2
    WHEN p_user IS NOT NULL AND v_b1 = p_user THEN 3
    WHEN p_user IS NOT NULL AND v_b2 = p_user THEN 4
    WHEN p_user IS NULL AND lower(v_a2g) = lower(p_old_guest) THEN 2
    WHEN p_user IS NULL AND lower(v_b1g) = lower(p_old_guest) THEN 3
    WHEN p_user IS NULL AND lower(v_b2g) = lower(p_old_guest) THEN 4
  END;
  IF v_k IS NULL THEN RETURN; END IF;

  IF v_k = 2 THEN v_a2 := NULL; v_a2g := p_new; v_a2s := 'guest';
  ELSIF v_k = 3 THEN v_b1 := NULL; v_b1g := p_new; v_b1s := 'guest';
  ELSIF v_k = 4 THEN v_b2 := NULL; v_b2g := p_new; v_b2s := 'guest';
  ELSIF v_a2 IS NOT NULL THEN
    -- 1.º lugar: o parceiro (com conta) passa para lá.
    v_a1 := v_a2; v_a1s := v_a2s;
    v_a2 := NULL; v_a2g := p_new; v_a2s := 'guest';
  ELSIF v_b1 IS NOT NULL OR v_b2 IS NOT NULL THEN
    -- Trocam as equipas: a conta da equipa B vai para o 1.º lugar.
    v_swap := TRUE;
    DECLARE
      o_a2 UUID := v_a2; o_a2s TEXT := v_a2s; o_a2g TEXT := v_a2g;
    BEGIN
      IF v_b1 IS NOT NULL THEN
        v_a1 := v_b1; v_a1s := v_b1s; v_a2 := v_b2; v_a2s := v_b2s; v_a2g := v_b2g;
      ELSE
        v_a1 := v_b2; v_a1s := v_b2s; v_a2 := v_b1; v_a2s := v_b1s; v_a2g := v_b1g;
      END IF;
      v_b1 := NULL; v_b1g := p_new; v_b1s := 'guest';
      v_b2 := o_a2; v_b2s := o_a2s; v_b2g := o_a2g;
    END;
  ELSE
    RAISE EXCEPTION 'only_account_in_game';
  END IF;

  UPDATE private_matches SET
    team_a_player1_id = v_a1, team_a_player1_status = v_a1s,
    team_a_player2_id = v_a2, team_a_player2_status = v_a2s, team_a_player2_guest_name = v_a2g,
    team_b_player1_id = v_b1, team_b_player1_status = v_b1s, team_b_player1_guest_name = v_b1g,
    team_b_player2_id = v_b2, team_b_player2_status = v_b2s, team_b_player2_guest_name = v_b2g,
    score_a = CASE WHEN v_swap THEN g.score_b ELSE g.score_a END,
    score_b = CASE WHEN v_swap THEN g.score_a ELSE g.score_b END,
    winner_team = CASE WHEN v_swap AND g.winner_team = 'a' THEN 'b'
                       WHEN v_swap AND g.winner_team = 'b' THEN 'a' ELSE g.winner_team END
  WHERE id = p_game;
  IF v_swap THEN
    UPDATE private_match_sets SET score_a = score_b, score_b = score_a WHERE private_match_id = p_game;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.friend_match_anonymize_slot(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- Sair ou ficar sem nome. p_play: TRUE = «Vou, mas sem o meu nome»;
-- FALSE = «Não vou». Quem chama é a pessoa convidada (pela conta ou pelo
-- email da conta).
CREATE OR REPLACE FUNCTION public.friend_match_leave(p_match_id UUID, p_play BOOLEAN)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_root private_matches%ROWTYPE;
  v_inv  private_match_invitees%ROWTYPE;
  v_old  TEXT;
  v_new  TEXT;
  v_i    INTEGER := 1;
  g      RECORD;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Precisas de ter sessão iniciada'; END IF;
  SELECT * INTO v_root FROM private_matches WHERE id = p_match_id AND is_friend_session FOR UPDATE;
  IF v_root.id IS NULL THEN RAISE EXCEPTION 'Jogo não encontrado'; END IF;

  SELECT * INTO v_inv FROM private_match_invitees WHERE match_id = p_match_id AND user_id = auth.uid() FOR UPDATE;
  IF v_inv.id IS NOT NULL THEN
    IF v_inv.user_id = v_root.creator_id THEN RAISE EXCEPTION 'Quem criou o jogo não sai da lista'; END IF;
    IF v_inv.status NOT IN ('pending', 'accepted')
       OR (v_root.teams_set_at IS NOT NULL AND v_inv.status <> 'pending') THEN
      RAISE EXCEPTION 'Já respondeste a este convite';
    END IF;
    SELECT name INTO v_old FROM profiles WHERE id = auth.uid();
  ELSE
    -- Convidado pelo email desta conta (o criador escreveu um nome).
    SELECT i.* INTO v_inv FROM private_match_invitees i
     WHERE i.match_id = p_match_id AND i.user_id IS NULL AND NOT i.is_anonymous
       AND i.guest_email = (SELECT lower(u.email) FROM auth.users u WHERE u.id = auth.uid())
     ORDER BY i.created_at LIMIT 1
     FOR UPDATE;
    IF v_inv.id IS NULL THEN RAISE EXCEPTION 'Não tens convite para este jogo'; END IF;
    v_old := v_inv.guest_name;
  END IF;

  -- O nome do lugar: «Jogador sem nome», «Jogador sem nome 2», …
  v_new := 'Jogador sem nome';
  WHILE EXISTS (SELECT 1 FROM private_match_invitees
                 WHERE match_id = p_match_id AND user_id IS NULL AND lower(guest_name) = lower(v_new)) LOOP
    v_i := v_i + 1;
    v_new := 'Jogador sem nome ' || v_i;
  END LOOP;

  -- Os jogos da sessão em que está.
  FOR g IN SELECT m.id, m.session_id, m.winner_team FROM private_matches m
            WHERE (m.id = p_match_id OR m.session_id = p_match_id)
              AND ((v_inv.user_id IS NOT NULL
                    AND v_inv.user_id IN (m.team_a_player1_id, m.team_a_player2_id, m.team_b_player1_id, m.team_b_player2_id))
                OR (v_inv.user_id IS NULL
                    AND lower(v_old) IN (lower(m.team_a_player2_guest_name), lower(m.team_b_player1_guest_name),
                                         lower(m.team_b_player2_guest_name))))
            ORDER BY m.game_number LOOP
    IF NOT p_play AND g.session_id IS NOT NULL AND g.winner_team IS NULL THEN
      DELETE FROM private_matches WHERE id = g.id AND winner_team IS NULL;   -- jogo seguinte por jogar
    ELSE
      PERFORM friend_match_anonymize_slot(g.id, v_inv.user_id, v_old, v_new);
    END IF;
  END LOOP;

  UPDATE private_match_invitees
     SET user_id = NULL, guest_name = v_new, guest_email = NULL, invite_token = NULL,
         email_status = 'none', email_declined_by = NULL, is_anonymous = TRUE,
         status = CASE WHEN p_play THEN 'guest' ELSE 'declined' END,
         left_name = CASE WHEN p_play THEN NULL ELSE v_old END,
         responded_at = NOW()
   WHERE id = v_inv.id;

  -- O sino da pessoa deixa de falar deste jogo.
  DELETE FROM notifications WHERE user_id = auth.uid() AND data->>'match_id' = p_match_id::text;

  IF NOT p_play THEN
    INSERT INTO notifications (user_id, kind, actor_id, data)
    VALUES (v_root.creator_id, 'friend_match_declined', NULL, jsonb_build_object(
      'match_id', p_match_id, 'name', v_old,
      'scheduled_date', v_root.scheduled_date, 'scheduled_time', v_root.scheduled_time));
  END IF;
  RETURN CASE WHEN p_play THEN 'guest' ELSE 'declined' END;
END;
$$;
REVOKE ALL ON FUNCTION public.friend_match_leave(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;

-- ── 2. «Vou, mas sem o meu nome» ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.play_friend_match_without_name(p_match_id UUID)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT friend_match_leave(p_match_id, TRUE);
$$;
REVOKE ALL ON FUNCTION public.play_friend_match_without_name(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.play_friend_match_without_name(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.play_friend_match_without_name(UUID) TO authenticated;

-- ── 3. «Não vou» ────────────────────────────────────────────────────────
DO $$
DECLARE
  c_mau CONSTANT TEXT := '(IF v_root\.id IS NULL THEN RAISE EXCEPTION ''Jogo não encontrado''; END IF;)';
  c_bom CONSTANT TEXT := '\1
  -- «Não vou»: sai sem deixar a conta ligada ao jogo (27 set).
  IF NOT p_accept THEN
    RETURN friend_match_leave(p_match_id, FALSE);
  END IF;';
  v_def TEXT := pg_get_functiondef('public.respond_friend_match_invite(uuid, boolean)'::regprocedure);
BEGIN
  IF v_def LIKE '%friend_match_leave%' THEN
    RAISE NOTICE 'respond_friend_match_invite: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'respond_friend_match_invite: a verificação do jogo não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE regexp_replace(v_def, c_mau, c_bom);
END $$;

-- ── 4. «Manter o lugar sem nome» ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.keep_friend_match_seat(p_invitee_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv private_match_invitees%ROWTYPE;
BEGIN
  SELECT * INTO v_inv FROM private_match_invitees WHERE id = p_invitee_id FOR UPDATE;
  IF v_inv.id IS NULL OR auth.uid() IS NULL
     OR NOT EXISTS (SELECT 1 FROM private_matches WHERE id = v_inv.match_id AND creator_id = auth.uid())
     OR NOT v_inv.is_anonymous OR v_inv.status <> 'declined' THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  UPDATE private_match_invitees SET status = 'guest', left_name = NULL WHERE id = p_invitee_id;
END;
$$;
REVOKE ALL ON FUNCTION public.keep_friend_match_seat(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.keep_friend_match_seat(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.keep_friend_match_seat(UUID) TO authenticated;

-- ── 5. get_friend_match: o lugar sem nome ───────────────────────────────
DO $$
DECLARE
  c_mau CONSTANT TEXT := '(''guest_email_sent'', i\.email_status IN \(''queued'', ''sent''\))';
  c_bom CONSTANT TEXT := '\1,
                  ''is_anonymous'', i.is_anonymous,
                  ''left_name'', CASE WHEN m.creator_id = auth.uid() THEN i.left_name END';
  v_def TEXT := pg_get_functiondef('public.get_friend_match(uuid)'::regprocedure);
BEGIN
  IF v_def LIKE '%''is_anonymous''%' THEN
    RAISE NOTICE 'get_friend_match: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'get_friend_match: o pedaço a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE regexp_replace(v_def, c_mau, c_bom);
END $$;

-- ── 6. Quem recusou ANTES desta regra fica também sem ligação ───────────
-- (PO, 27 set: «anonimiza os que recusaram antes… com o arquivo para
-- desfazer».) Linhas 'declined' que ainda têm a conta: passam a lugar sem
-- nome, 'declined', com left_name; nos jogos o lugar passa a «Jogador sem
-- nome» (convidado). Não se apagam jogos nem se manda aviso. Antes de mexer,
-- a linha inteira fica em arquivo_amigos_sem_nome; desfaz-se com
--   SELECT arquivo_amigos_sem_nome.desfazer();
CREATE SCHEMA IF NOT EXISTS arquivo_amigos_sem_nome;
REVOKE ALL ON SCHEMA arquivo_amigos_sem_nome FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS arquivo_amigos_sem_nome.linhas (
  id         BIGSERIAL PRIMARY KEY,
  tabela     TEXT NOT NULL,          -- private_match_invitees | private_matches | private_match_sets | notifications
  chave      UUID NOT NULL,
  antes      JSONB NOT NULL,
  guardado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  desfeito_em TIMESTAMPTZ
);

DO $$
DECLARE
  v RECORD;
  v_new TEXT;
  v_i   INTEGER;
  g     RECORD;
  v_ok  INTEGER := 0;
  v_mal INTEGER := 0;
BEGIN
  FOR v IN SELECT i.*, p.name AS nome
             FROM private_match_invitees i
             JOIN private_matches r ON r.id = i.match_id AND r.is_friend_session
             LEFT JOIN profiles p ON p.id = i.user_id
            WHERE i.status = 'declined' AND i.user_id IS NOT NULL
            ORDER BY i.created_at LOOP
    BEGIN
      v_i := 1; v_new := 'Jogador sem nome';
      WHILE EXISTS (SELECT 1 FROM private_match_invitees
                     WHERE match_id = v.match_id AND user_id IS NULL AND lower(guest_name) = lower(v_new)) LOOP
        v_i := v_i + 1; v_new := 'Jogador sem nome ' || v_i;
      END LOOP;

      INSERT INTO arquivo_amigos_sem_nome.linhas (tabela, chave, antes)
      SELECT 'private_match_invitees', x.id, to_jsonb(x) FROM private_match_invitees x WHERE x.id = v.id;
      FOR g IN SELECT m.id FROM private_matches m
                WHERE (m.id = v.match_id OR m.session_id = v.match_id)
                  AND v.user_id IN (m.team_a_player1_id, m.team_a_player2_id, m.team_b_player1_id, m.team_b_player2_id) LOOP
        INSERT INTO arquivo_amigos_sem_nome.linhas (tabela, chave, antes)
        SELECT 'private_matches', x.id, to_jsonb(x) FROM private_matches x WHERE x.id = g.id;
        INSERT INTO arquivo_amigos_sem_nome.linhas (tabela, chave, antes)
        SELECT 'private_match_sets', x.id, to_jsonb(x) FROM private_match_sets x WHERE x.private_match_id = g.id;
        PERFORM friend_match_anonymize_slot(g.id, v.user_id, NULL, v_new);
      END LOOP;
      INSERT INTO arquivo_amigos_sem_nome.linhas (tabela, chave, antes)
      SELECT 'notifications', x.id, to_jsonb(x) FROM notifications x
       WHERE x.user_id = v.user_id AND x.data->>'match_id' = v.match_id::text;
      DELETE FROM notifications WHERE user_id = v.user_id AND data->>'match_id' = v.match_id::text;

      UPDATE private_match_invitees
         SET user_id = NULL, guest_name = v_new, guest_email = NULL, invite_token = NULL,
             email_status = 'none', email_declined_by = NULL, is_anonymous = TRUE, left_name = v.nome
       WHERE id = v.id;
      v_ok := v_ok + 1;
    EXCEPTION WHEN OTHERS THEN
      v_mal := v_mal + 1;
      RAISE NOTICE 'Não anonimizei a linha % (jogo %): % — ver à mão.', v.id, v.match_id, SQLERRM;
    END;
  END LOOP;
  RAISE NOTICE 'Quem recusou antes: % anonimizados, % por ver à mão.', v_ok, v_mal;
END $$;

-- Desfazer: repõe as linhas guardadas (as que ainda não foram desfeitas).
CREATE OR REPLACE FUNCTION arquivo_amigos_sem_nome.desfazer()
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  a RECORD;
  v_n INTEGER := 0;
BEGIN
  FOR a IN SELECT * FROM arquivo_amigos_sem_nome.linhas WHERE desfeito_em IS NULL ORDER BY id DESC LOOP
    IF a.tabela = 'private_match_invitees' THEN
      UPDATE private_match_invitees t SET
        user_id = (a.antes->>'user_id')::uuid, guest_name = a.antes->>'guest_name',
        guest_email = a.antes->>'guest_email', invite_token = a.antes->>'invite_token',
        email_status = a.antes->>'email_status', email_declined_by = (a.antes->>'email_declined_by')::uuid,
        is_anonymous = FALSE, left_name = NULL
       WHERE t.id = a.chave;
    ELSIF a.tabela = 'private_matches' THEN
      UPDATE private_matches t SET
        team_a_player1_id = (a.antes->>'team_a_player1_id')::uuid, team_a_player1_status = a.antes->>'team_a_player1_status',
        team_a_player2_id = (a.antes->>'team_a_player2_id')::uuid, team_a_player2_status = a.antes->>'team_a_player2_status',
        team_a_player2_guest_name = a.antes->>'team_a_player2_guest_name',
        team_b_player1_id = (a.antes->>'team_b_player1_id')::uuid, team_b_player1_status = a.antes->>'team_b_player1_status',
        team_b_player1_guest_name = a.antes->>'team_b_player1_guest_name',
        team_b_player2_id = (a.antes->>'team_b_player2_id')::uuid, team_b_player2_status = a.antes->>'team_b_player2_status',
        team_b_player2_guest_name = a.antes->>'team_b_player2_guest_name',
        score_a = (a.antes->>'score_a')::integer, score_b = (a.antes->>'score_b')::integer,
        winner_team = a.antes->>'winner_team'
       WHERE t.id = a.chave;
    ELSIF a.tabela = 'private_match_sets' THEN
      UPDATE private_match_sets t SET score_a = (a.antes->>'score_a')::integer, score_b = (a.antes->>'score_b')::integer
       WHERE t.id = a.chave;
    ELSIF a.tabela = 'notifications' THEN
      INSERT INTO notifications SELECT * FROM jsonb_populate_record(NULL::notifications, a.antes)
      ON CONFLICT (id) DO NOTHING;
    END IF;
    UPDATE arquivo_amigos_sem_nome.linhas SET desfeito_em = NOW() WHERE id = a.id;
    v_n := v_n + 1;
  END LOOP;
  RETURN format('Repostas %s linhas.', v_n);
END;
$$;
REVOKE ALL ON FUNCTION arquivo_amigos_sem_nome.desfazer() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.respond_friend_match_invite(uuid, boolean)', 'public.get_friend_match(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_functiondef('public.respond_friend_match_invite(uuid, boolean)'::regprocedure) LIKE '%friend_match_leave%';  -- true
--   SELECT has_function_privilege('anon', 'public.play_friend_match_without_name(uuid)', 'EXECUTE');  -- false
--   SELECT has_function_privilege('authenticated', 'public.friend_match_leave(uuid, boolean)', 'EXECUTE');  -- false
