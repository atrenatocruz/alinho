-- ═════════════════════════════════════════════════════════════════════════
-- Amigos: uma ronda (ou um campo) só com convidados também se grava
--
-- PORQUÊ. Francisco, 9 out (via PO): «grava sempre o jogo. A pessoa é que
-- depois não consegue recuperar esse jogo, porque já não guardamos guest.
-- Claro que nesse jogo não há pontos.» Até aqui cada ronda tinha de ter uma
-- pessoa com conta no 1.º lugar (private_matches.team_a_player1_id NOT
-- NULL), e um campo só com convidados não se podia guardar (falha do QA de
-- 9 out, 5 pessoas e uma só conta). Plano aprovado a 9 out (com o ranking e
-- o «O fim»). Ecrãs: Bugs.
--
-- O QUE FAZ
--   1. O 1.º lugar passa a poder ser um convidado como os outros:
--      team_a_player1_id deixa de ser obrigatório, nasce
--      team_a_player1_guest_name, e a regra «um ou o outro» passa a valer
--      também para ele (e cada lugar 1 tem sempre alguém).
--   2. friend_match_slots deixa de recusar um campo só com convidados (se
--      houver uma conta, continua a ficar no 1.º lugar).
--   3. Corpo VIVO, trocas de 1 linha («já estava»), para o nome do 1.º lugar
--      ser copiado, mostrado e reconhecido como os outros: add_friend_match
--      _game, add_friend_match_round, save_friend_match_round,
--      set_friend_match_teams, set_friend_match_round_teams,
--      remove_friend_match_round, friend_match_anonymize_slot,
--      friend_match_apply_game, friend_match_game_invitees,
--      friend_match_leave, friend_match_release_invitee,
--      list_my_friend_match_invites, get_friend_match,
--      list_group_friend_matches, list_live_events, delete_friend_match,
--      friend_match_claim_guest.
--   Uma ronda só com convidados nunca conta para o ranking nem dá pontos
--   (o lugar 'guest' já impede, e a contagem nova do «O fim» também).
--   Mudança: friend_match_anonymize_slot deixa de dar 'only_account_in_game'
--   — a última conta de uma ronda pode sair e a ronda fica só com
--   convidados.
--
-- Ordem: depois das migration_amigos_rondas_com_tipo.sql,
-- migration_amigos_quem_aceitou.sql e
-- migration_amigos_ronda_seguinte_nao_bloqueia.sql.
-- Dev 3, 12 out 2026 · ecrãs: Bugs
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$ BEGIN
  IF to_regprocedure('public.save_friend_match_round(uuid,integer,integer,text,smallint,jsonb,boolean)') IS NULL THEN
    RAISE EXCEPTION 'Correr primeiro as migrações dos amigos (rondas_com_tipo, quem_aceitou, ronda_seguinte_nao_bloqueia).';
  END IF;
END $$;

-- ── 1. O 1.º lugar pode ser um convidado ────────────────────────────────
ALTER TABLE private_matches ADD COLUMN IF NOT EXISTS team_a_player1_guest_name TEXT;
ALTER TABLE private_matches ALTER COLUMN team_a_player1_id DROP NOT NULL;
ALTER TABLE private_matches DROP CONSTRAINT IF EXISTS private_matches_guest_xor_id_check;
ALTER TABLE private_matches ADD CONSTRAINT private_matches_guest_xor_id_check CHECK (
      (team_a_player1_id IS NULL OR team_a_player1_guest_name IS NULL)
  AND (team_a_player2_id IS NULL OR team_a_player2_guest_name IS NULL)
  AND (team_b_player1_id IS NULL OR team_b_player1_guest_name IS NULL)
  AND (team_b_player2_id IS NULL OR team_b_player2_guest_name IS NULL));
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'private_matches_seat1_someone') THEN
    ALTER TABLE private_matches ADD CONSTRAINT private_matches_seat1_someone
      CHECK (team_a_player1_id IS NOT NULL OR team_a_player1_guest_name IS NOT NULL);
  END IF;
END $$;

-- ── 2 e 3. As trocas, cada uma no corpo vivo ────────────────────────────
-- Troca literal (sem expressões regulares): o pedaço tem de aparecer o
-- número de vezes esperado; se a troca já lá estiver, «já estava».
DO $$
DECLARE
  f      RECORD;
  v_def  TEXT;
  v_n    INTEGER;
  v_feito TEXT[] := '{}';
BEGIN
  FOR f IN SELECT * FROM (VALUES
    -- friend_match_slots: só convidados fica como veio; o 1.º lugar dá o nome.
    (1, 'public.friend_match_slots(uuid,uuid[],uuid[])',
        $a$RAISE EXCEPTION 'Em cada jogo tem de jogar pelo menos uma pessoa com conta';$a$,
        $b$v_a := p_team_a; v_b := p_team_b;  -- só convidados (9 out): fica como veio, o 1.º lugar é um convidado$b$, 1),
    (2, 'public.friend_match_slots(uuid,uuid[],uuid[])', 'IF i > 1 THEN', 'IF i > 1 OR r.user_id IS NULL THEN', 1),
    (3, 'public.friend_match_slots(uuid,uuid[],uuid[])', '-- O 1.º lugar da equipa A tem de ter conta.',
        '-- O 1.º lugar da equipa A fica com uma conta, se houver (9 out: senão, um convidado).', 1),
    -- Copiar o nome do 1.º lugar ao criar rondas e jogos.
    (4, 'public.add_friend_match_game(uuid,uuid[],uuid[])', 'team_a_player1_id, team_a_player1_status,',
        'team_a_player1_id, team_a_player1_status, team_a_player1_guest_name,', 1),
    (5, 'public.add_friend_match_game(uuid,uuid[],uuid[])', $a$(s->>'team_a_player1_id')::uuid, s->>'team_a_player1_status',$a$,
        $b$(s->>'team_a_player1_id')::uuid, s->>'team_a_player1_status', s->>'team_a_player1_guest_name',$b$, 1),
    (6, 'public.add_friend_match_round(uuid,jsonb,smallint)', 'team_a_player1_id, team_a_player1_status,',
        'team_a_player1_id, team_a_player1_status, team_a_player1_guest_name,', 1),
    (7, 'public.add_friend_match_round(uuid,jsonb,smallint)', $a$(s->>'team_a_player1_id')::uuid, s->>'team_a_player1_status',$a$,
        $b$(s->>'team_a_player1_id')::uuid, s->>'team_a_player1_status', s->>'team_a_player1_guest_name',$b$, 1),
    (8, 'public.save_friend_match_round(uuid,integer,integer,text,smallint,jsonb,boolean)', 'team_a_player1_id, team_a_player1_status,',
        'team_a_player1_id, team_a_player1_status, team_a_player1_guest_name,', 2),
    (9, 'public.save_friend_match_round(uuid,integer,integer,text,smallint,jsonb,boolean)', $a$(s->>'team_a_player1_id')::uuid, s->>'team_a_player1_status',$a$,
        $b$(s->>'team_a_player1_id')::uuid, s->>'team_a_player1_status', s->>'team_a_player1_guest_name',$b$, 1),
    (10, 'public.save_friend_match_round(uuid,integer,integer,text,smallint,jsonb,boolean)', 'c.team_a_player1_id, c.team_a_player1_status,',
        'c.team_a_player1_id, c.team_a_player1_status, c.team_a_player1_guest_name,', 1),
    -- Trocar duplas.
    (11, 'public.set_friend_match_teams(uuid,text,uuid[],uuid[])', $a$team_a_player2_guest_name = s->>'team_a_player2_guest_name',$a$,
        $b$team_a_player1_guest_name = s->>'team_a_player1_guest_name', team_a_player2_guest_name = s->>'team_a_player2_guest_name',$b$, 1),
    (12, 'public.set_friend_match_round_teams(uuid,smallint,jsonb)', $a$team_a_player2_guest_name = s->>'team_a_player2_guest_name',$a$,
        $b$team_a_player1_guest_name = s->>'team_a_player1_guest_name', team_a_player2_guest_name = s->>'team_a_player2_guest_name',$b$, 1),
    -- Apagar uma ronda: repor e copiar também o nome do 1.º lugar.
    (13, 'public.remove_friend_match_round(uuid,integer)', 'team_a_player1_id = creator_id,',
        'team_a_player1_id = creator_id, team_a_player1_guest_name = NULL,', 1),
    (14, 'public.remove_friend_match_round(uuid,integer)', 'team_a_player1_id = o.team_a_player1_id, team_a_player1_status = o.team_a_player1_status,',
        'team_a_player1_id = o.team_a_player1_id, team_a_player1_status = o.team_a_player1_status, team_a_player1_guest_name = o.team_a_player1_guest_name,', 1),
    -- Sair / tirar uma pessoa: o 1.º lugar também pode ficar convidado.
    (15, 'public.friend_match_anonymize_slot(uuid,uuid,text,text)', 'v_a1 UUID; v_a1s TEXT;', 'v_a1 UUID; v_a1s TEXT; v_a1g TEXT;', 1),
    (16, 'public.friend_match_anonymize_slot(uuid,uuid,text,text)', 'v_a1 := g.team_a_player1_id; v_a1s := g.team_a_player1_status;',
        'v_a1 := g.team_a_player1_id; v_a1s := g.team_a_player1_status; v_a1g := g.team_a_player1_guest_name;', 1),
    (17, 'public.friend_match_anonymize_slot(uuid,uuid,text,text)', 'WHEN p_user IS NULL AND lower(v_a2g) = lower(p_old_guest) THEN 2',
        E'WHEN p_user IS NULL AND lower(v_a1g) = lower(p_old_guest) THEN 1\n           WHEN p_user IS NULL AND lower(v_a2g) = lower(p_old_guest) THEN 2', 1),
    (18, 'public.friend_match_anonymize_slot(uuid,uuid,text,text)', 'v_a1 := v_a2; v_a1s := v_a2s;', 'v_a1 := v_a2; v_a1s := v_a2s; v_a1g := NULL;', 1),
    (19, 'public.friend_match_anonymize_slot(uuid,uuid,text,text)', 'v_a1 := v_b1; v_a1s := v_b1s;', 'v_a1 := v_b1; v_a1s := v_b1s; v_a1g := NULL;', 1),
    (20, 'public.friend_match_anonymize_slot(uuid,uuid,text,text)', 'v_a1 := v_b2; v_a1s := v_b2s;', 'v_a1 := v_b2; v_a1s := v_b2s; v_a1g := NULL;', 1),
    (21, 'public.friend_match_anonymize_slot(uuid,uuid,text,text)', $a$RAISE EXCEPTION 'only_account_in_game';$a$,
        $b$v_a1 := NULL; v_a1g := p_new; v_a1s := 'guest';  -- 9 out: a ronda fica só com convidados$b$, 1),
    (22, 'public.friend_match_anonymize_slot(uuid,uuid,text,text)', 'team_a_player1_id = v_a1, team_a_player1_status = v_a1s,',
        'team_a_player1_id = v_a1, team_a_player1_status = v_a1s, team_a_player1_guest_name = v_a1g,', 1),
    -- Um 1.º lugar convidado não é um lugar vazio; e nunca conta.
    (23, 'public.friend_match_apply_game()', 'IF v_m.team_a_player1_id IS NULL',
        'IF (v_m.team_a_player1_id IS NULL AND v_m.team_a_player1_guest_name IS NULL)', 1),
    (24, 'public.friend_match_apply_game()', 'v_all_ranked := v_m.ranked_intent',
        'v_all_ranked := v_m.ranked_intent AND v_m.team_a_player1_guest_name IS NULL', 1),
    -- Reconhecer um convidado pelo nome também no 1.º lugar.
    (25, 'public.friend_match_game_invitees(uuid)', 'IN (lower(g.team_a_player2_guest_name),',
        'IN (lower(g.team_a_player1_guest_name), lower(g.team_a_player2_guest_name),', 1),
    (26, 'public.friend_match_leave(uuid,boolean)', 'IN (lower(m.team_a_player2_guest_name),',
        'IN (lower(m.team_a_player1_guest_name), lower(m.team_a_player2_guest_name),', 1),
    (27, 'public.friend_match_release_invitee(uuid)', 'IN (lower(g.team_a_player2_guest_name),',
        'IN (lower(g.team_a_player1_guest_name), lower(g.team_a_player2_guest_name),', 1),
    (28, 'public.list_my_friend_match_invites()', 'IN (lower(g.team_a_player2_guest_name),',
        'IN (lower(g.team_a_player1_guest_name), lower(g.team_a_player2_guest_name),', 1),
    -- Mostrar o nome do 1.º lugar.
    (29, 'public.get_friend_match(uuid)', 'IN (lower(hr.team_a_player2_guest_name),',
        'IN (lower(hr.team_a_player1_guest_name), lower(hr.team_a_player2_guest_name),', 1),
    (30, 'public.get_friend_match(uuid)', '(1, m.team_a_player1_id, NULL::text, m.team_a_player1_status)',
        '(1, m.team_a_player1_id, m.team_a_player1_guest_name, m.team_a_player1_status)', 1),
    (31, 'public.list_group_friend_matches(uuid)', $a$jsonb_build_object('user_id', m.team_a_player1_id, 'name', pa1.name)$a$,
        $b$jsonb_build_object('user_id', m.team_a_player1_id, 'name', COALESCE(pa1.name, m.team_a_player1_guest_name))$b$, 1),
    (32, 'public.list_live_events(uuid)', $a$COALESCE(x.team_a_player1_id::text, '')$a$,
        $b$COALESCE(x.team_a_player1_id::text, 'g:' || lower(x.team_a_player1_guest_name))$b$, 1),
    (33, 'public.list_live_events(uuid)', 'ARRAY[pa1.name,', 'ARRAY[COALESCE(pa1.name, x.team_a_player1_guest_name),', 1),
    (34, 'public.delete_friend_match(uuid)', 'SELECT m.team_a_player1_id::text AS ka1,',
        $b$SELECT COALESCE(m.team_a_player1_id::text, 'g:' || m.team_a_player1_guest_name) AS ka1,$b$, 1),
    (35, 'public.delete_friend_match(uuid)', 'live_short_name((SELECT name FROM profiles WHERE id = m.team_a_player1_id)) AS na1,',
        'COALESCE(live_short_name((SELECT name FROM profiles WHERE id = m.team_a_player1_id)), btrim(m.team_a_player1_guest_name)) AS na1,', 1)
  ) AS t(n, sig, mau, bom, vezes) ORDER BY n LOOP
    v_def := pg_get_functiondef(f.sig::regprocedure);
    IF position(f.bom IN v_def) > 0 THEN
      RAISE NOTICE '% (troca %): já estava', f.sig, f.n;
      CONTINUE;
    END IF;
    v_n := (length(v_def) - length(replace(v_def, f.mau, ''))) / length(f.mau);
    IF v_n <> f.vezes THEN
      RAISE EXCEPTION '% (troca %): o pedaço aparece % vez(es), esperava %. Parar e ler.', f.sig, f.n, v_n, f.vezes;
    END IF;
    EXECUTE replace(v_def, f.mau, f.bom);
  END LOOP;
END $$;

-- friend_match_claim_guest: quem fica com o lugar de convidado também o
-- apanha no 1.º lugar. Junta-se um UPDATE igual ao do 2.º lugar, antes dele.
DO $$
DECLARE
  v_def  TEXT := pg_get_functiondef('public.friend_match_claim_guest(uuid)'::regprocedure);
  v_ini  INTEGER;
  v_fim  INTEGER;
  v_bloco TEXT;
  c_mau  CONSTANT TEXT := 'UPDATE private_matches SET team_a_player2_id = auth.uid(), team_a_player2_guest_name = NULL,';
BEGIN
  IF position('team_a_player1_guest_name' IN v_def) > 0 THEN
    RAISE NOTICE 'friend_match_claim_guest: já estava';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, c_mau, ''))) / length(c_mau) <> 1 THEN
    RAISE EXCEPTION 'friend_match_claim_guest: o pedaço a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  -- O bloco do 2.º lugar vai do UPDATE até ao primeiro «;» a seguir.
  v_ini := position(c_mau IN v_def);
  v_fim := v_ini + position(';' IN substr(v_def, v_ini)) - 1;
  v_bloco := substr(v_def, v_ini, v_fim - v_ini + 1);
  EXECUTE overlay(v_def PLACING
      replace(v_bloco, 'team_a_player2', 'team_a_player1') || E'\n  ' || v_bloco
    FROM v_ini FOR v_fim - v_ini + 1);
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT is_nullable FROM information_schema.columns WHERE table_name = 'private_matches' AND column_name = 'team_a_player1_id';  -- YES
--   SELECT count(*) FROM pg_proc WHERE pg_get_functiondef(oid) LIKE '%team_a_player1_guest_name%';  -- 18 ou mais
