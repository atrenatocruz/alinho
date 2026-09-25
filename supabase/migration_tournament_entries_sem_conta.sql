-- ═════════════════════════════════════════════════════════════════════════
-- TORNEIO: INSCREVER À MÃO QUEM NÃO TEM CONTA, E QUEM VEM SOZINHO
-- (Dev 3, 25 set 2026) — cartão «#515» (a parte (b) do «#457»). P1, até 3
-- out. Plano aprovado pelo Francisco a 25 set («sim, avança»). Ecrã: Dev 2
-- (nomes combinados com ele).
--
-- Pode-se correr outra vez sem estragar.
--
-- ─────────────────────────────────────────────────────────────────────────
-- O QUE PASSA A SER POSSÍVEL
-- ─────────────────────────────────────────────────────────────────────────
--  1. O organizador inscreve uma dupla em que NENHUM tem conta: o jogador 1
--     entra só pelo nome, como o jogador 2 já entrava (`player1_id` deixa
--     de ser obrigatório; colunas novas `guest1_name`, `guest1_email`).
--  2. O organizador inscreve uma pessoa SOZINHA: fica `sem_parceiro` (ou
--     `suplente`, se a categoria estiver cheia), à espera de parceiro.
--  3. O jogador 1 sem conta recebe um link para ficar com o lugar quando se
--     registar (`invite_token_player1`), como o jogador 2 já recebia.
--  4. O organizador junta o parceiro depois: `tournament_admin_set_partner`.
--
-- Quem não tem conta não entra no ranking: é o «convidado» (regra do Ruben,
-- #440). Com um nome escrito, a app não sabe se a pessoa já está noutra
-- dupla — só o consegue verificar para quem tem conta.
--
-- ─────────────────────────────────────────────────────────────────────────
-- COMO: SEMPRE A PARTIR DO CORPO VIVO
-- ─────────────────────────────────────────────────────────────────────────
-- Cada função que já existe é lida viva, troca-se só o bocado preciso, e o
-- ficheiro recusa se não o encontrar exatamente o número de vezes esperado.
--   · tournament_admin_signup — ganha p_player1_guest_name e
--     p_player1_guest_email (muda a assinatura: a antiga é apagada na mesma
--     transação, para não ficarem duas — PGRST203, #465 — e as permissões
--     são repostas).
--   · tournament_claim_entry — aceita também o link do jogador 1.
--   · tournament_invite_token — «o jogador 1 não sou eu» passa a
--     `IS DISTINCT FROM`: com o jogador 1 vazio, o `<>` dava NULL e deixava
--     QUALQUER pessoa receber o código do convite.
--   · tournament_public_entries (vista), list_tournament_entries,
--     list_category_seeding, tournament_team_json — o nome do jogador 1 é
--     o da conta ou, sem conta, o escrito. Todas já liam a conta com
--     LEFT JOIN, por isso as duplas sem conta já apareciam; só sem nome.
-- ═════════════════════════════════════════════════════════════════════════

-- ── 0. Peças de que depende ──────────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('is_tournament_admin(uuid)') IS NULL
     OR to_regprocedure('tournament_new_invite_token()') IS NULL
     OR to_regprocedure('tournament_person_in_category(uuid, uuid, uuid)') IS NULL
     OR to_regprocedure('tournament_categories_left(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'Faltam funções de que esta migração depende. Parar e ler.';
  END IF;
END $$;

-- ── 1. Colunas e regras da tabela ────────────────────────────────────────
ALTER TABLE tournament_entries ALTER COLUMN player1_id DROP NOT NULL;
ALTER TABLE tournament_entries ADD COLUMN IF NOT EXISTS guest1_name  TEXT;
ALTER TABLE tournament_entries ADD COLUMN IF NOT EXISTS guest1_email TEXT;
ALTER TABLE tournament_entries ADD COLUMN IF NOT EXISTS invite_token_player1 TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS tournament_entries_invite_token_player1_key
  ON tournament_entries (invite_token_player1) WHERE invite_token_player1 IS NOT NULL;

DO $$
DECLARE
  c RECORD;
BEGIN
  -- Uma dupla tem sempre um jogador 1: com conta ou pelo nome.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tournament_entries_player1_or_name') THEN
    ALTER TABLE tournament_entries ADD CONSTRAINT tournament_entries_player1_or_name
      CHECK (player1_id IS NOT NULL OR guest1_name IS NOT NULL);
  END IF;

  -- Sem parceiro só em `sem_parceiro` ou `desistiu` — passa a valer também
  -- `suplente`: quem é inscrito sozinho numa categoria cheia fica na fila, e
  -- ao subir passa a `sem_parceiro` (tournament_promote_waitlist já o faz).
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.tournament_entries'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) ~ 'guest_name IS NOT NULL'
              AND pg_get_constraintdef(oid) ~ 'sem_parceiro'
              AND pg_get_constraintdef(oid) !~ 'suplente' LOOP
    EXECUTE format('ALTER TABLE tournament_entries DROP CONSTRAINT %I', c.conname);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tournament_entries_partner_or_waiting') THEN
    ALTER TABLE tournament_entries ADD CONSTRAINT tournament_entries_partner_or_waiting
      CHECK (player2_id IS NOT NULL OR guest_name IS NOT NULL
             OR status IN ('sem_parceiro', 'suplente', 'desistiu'));
  END IF;
END $$;

-- As colunas novas NÃO se abrem ao browser: o SELECT de tournament_entries
-- a `authenticated` é por coluna (#483), e estas não entram nessa lista.
-- (O link do jogador 1 é tão secreto como o do jogador 2.)

-- ── 2. Remendos às funções que já existem ────────────────────────────────
DO $$
DECLARE
  -- ── tournament_admin_signup ──
  c_head_mau  CONSTANT TEXT := '(p_partner_gender text DEFAULT NULL::text)\)';
  c_head_bom  CONSTANT TEXT := '\1, p_player1_guest_name text DEFAULT NULL::text, p_player1_guest_email text DEFAULT NULL::text)';
  c_decl_mau  CONSTANT TEXT := '(v_token TEXT;)';
  c_decl_bom  CONSTANT TEXT := '\1
  v_token1 TEXT;';
  c_fecho_mau CONSTANT TEXT := '(IF v_cat\.status <> ''inscricoes'' THEN RAISE EXCEPTION ''entries_closed''; END IF;)';
  c_fecho_bom CONSTANT TEXT := '\1

  -- #515: o jogador 1 vem com conta ou só pelo nome — um dos dois.
  IF p_player1_id IS NULL AND NULLIF(TRIM(p_player1_guest_name), '''') IS NULL THEN
    RAISE EXCEPTION ''player1_required'';
  END IF;';
  c_gen_mau   CONSTANT TEXT := 'IF NOT EXISTS \(SELECT 1 FROM profiles WHERE id = p_player1_id';
  c_gen_bom   CONSTANT TEXT := 'IF p_player1_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_player1_id';
  c_est_mau   CONSTANT TEXT := 'v_status := CASE WHEN p_paid THEN ''validada'' ELSE ''por_validar'' END;';
  c_est_bom   CONSTANT TEXT := 'v_status := CASE
      -- #515: sozinho, fica à espera de parceiro.
      WHEN p_partner_id IS NULL AND NULLIF(TRIM(p_guest_name), '''') IS NULL THEN ''sem_parceiro''
      WHEN p_paid THEN ''validada'' ELSE ''por_validar'' END;';
  c_tok_mau   CONSTANT TEXT := '(IF p_guest_name IS NOT NULL THEN v_token := tournament_new_invite_token\(\); END IF;)';
  c_tok_bom   CONSTANT TEXT := '\1
  -- #515: o jogador 1 sem conta também recebe o link para ficar com o lugar.
  IF p_player1_id IS NULL THEN v_token1 := tournament_new_invite_token(); END IF;';
  c_col_mau   CONSTANT TEXT := '(validated_by)(\s*\)\s*VALUES)';
  c_col_bom   CONSTANT TEXT := '\1, guest1_name, guest1_email, invite_token_player1\2';
  c_val_mau   CONSTANT TEXT := '(CASE WHEN v_status = ''validada'' THEN auth\.uid\(\) END)(\s*\)\s*RETURNING id INTO v_id;)';
  c_val_bom   CONSTANT TEXT := '\1,
    CASE WHEN p_player1_id IS NULL THEN NULLIF(TRIM(p_player1_guest_name), '''') END,
    CASE WHEN p_player1_id IS NULL THEN NULLIF(TRIM(LOWER(p_player1_guest_email)), '''') END,
    v_token1\2';
  c_ret_mau   CONSTANT TEXT := '(''invite_token'', v_token)\)';
  c_ret_bom   CONSTANT TEXT := '\1, ''invite_token_player1'', v_token1)';
  -- ── tournament_claim_entry ──
  c_cla_mau   CONSTANT TEXT := '(IF v_me IS NULL THEN RAISE EXCEPTION ''not_signed_in''; END IF;)';
  c_cla_bom   CONSTANT TEXT := '\1

  -- #515: o link do jogador 1 que o organizador inscreveu sem conta.
  SELECT * INTO v_entry FROM tournament_entries
   WHERE invite_token_player1 = p_token AND status <> ''desistiu'' FOR UPDATE;
  IF FOUND THEN
    IF v_entry.player1_id IS NOT NULL THEN RAISE EXCEPTION ''invite_already_claimed''; END IF;
    IF v_entry.player2_id = v_me THEN RAISE EXCEPTION ''invite_is_your_own''; END IF;
    SELECT c.tournament_id, c.status INTO v_tournament, v_cat_status
      FROM tournament_categories c WHERE c.id = v_entry.category_id;
    IF v_cat_status <> ''inscricoes'' THEN RAISE EXCEPTION ''entries_closed''; END IF;
    IF tournament_person_in_category(v_entry.category_id, v_me, v_entry.id) THEN
      RAISE EXCEPTION ''already_in_category'';
    END IF;
    IF tournament_categories_left(v_tournament, v_me) <= 0 THEN
      RAISE EXCEPTION ''max_categories_reached'';
    END IF;
    UPDATE tournament_entries
       SET player1_id = v_me, guest1_name = NULL, guest1_email = NULL,
           invite_token_player1 = NULL
     WHERE id = v_entry.id;
    RETURN v_tournament;
  END IF;';
  -- ── tournament_invite_token ──
  c_inv_mau   CONSTANT TEXT := 'v_entry\.player1_id <> auth\.uid\(\)';
  c_inv_bom   CONSTANT TEXT := 'v_entry.player1_id IS DISTINCT FROM auth.uid()';
  -- ── nomes ──
  c_lte_mau   CONSTANT TEXT := 'e\.player1_id, p1\.name, p1\.avatar_url,';
  c_lte_bom   CONSTANT TEXT := 'e.player1_id, COALESCE(p1.name, e.guest1_name), p1.avatar_url,';
  c_lti_mau   CONSTANT TEXT := '\(e\.invite_token IS NOT NULL\)';
  c_lti_bom   CONSTANT TEXT := '(e.invite_token IS NOT NULL OR e.invite_token_player1 IS NOT NULL)';
  c_p1n_mau   CONSTANT TEXT := '\mp1\.name\M(?!\s*,\s*e\.guest1_name)';
  c_p1n_bom   CONSTANT TEXT := 'COALESCE(p1.name, e.guest1_name)';

  v_oid   OID;
  v_def   TEXT;
  v_novo  TEXT;
  v_acl   ACLITEM[];
  v_owner OID;
  a       RECORD;
  v_n     INTEGER;
BEGIN
  -- ── tournament_admin_signup ─────────────────────────────────────────
  IF to_regprocedure('tournament_admin_signup(uuid, uuid, uuid, text, text, text, boolean, text, text, text, text)') IS NOT NULL THEN
    RAISE NOTICE 'tournament_admin_signup: já tinha o jogador 1 sem conta.';
  ELSE
    SELECT p.oid, p.proacl, p.proowner INTO v_oid, v_acl, v_owner FROM pg_proc p
     WHERE p.oid = to_regprocedure('tournament_admin_signup(uuid, uuid, uuid, text, text, text, boolean, text, text)');
    IF v_oid IS NULL OR (SELECT count(*) FROM pg_proc WHERE proname = 'tournament_admin_signup'
                           AND pronamespace = 'public'::regnamespace) <> 1 THEN
      RAISE EXCEPTION 'tournament_admin_signup não é a de 9 argumentos (com género, #433), ou há mais de uma. Parar e ler.';
    END IF;
    v_def := pg_get_functiondef(v_oid);
    IF (SELECT count(*) FROM regexp_matches(v_def, c_head_mau,  'g')) <> 1
       OR (SELECT count(*) FROM regexp_matches(v_def, c_decl_mau,  'g')) <> 1
       OR (SELECT count(*) FROM regexp_matches(v_def, c_fecho_mau, 'g')) <> 1
       OR (SELECT count(*) FROM regexp_matches(v_def, c_gen_mau,   'g')) <> 1
       OR (SELECT count(*) FROM regexp_matches(v_def, c_est_mau,   'g')) <> 1
       OR (SELECT count(*) FROM regexp_matches(v_def, c_tok_mau,   'g')) <> 1
       OR (SELECT count(*) FROM regexp_matches(v_def, c_col_mau,   'g')) <> 1
       OR (SELECT count(*) FROM regexp_matches(v_def, c_val_mau,   'g')) <> 1
       OR (SELECT count(*) FROM regexp_matches(v_def, c_ret_mau,   'g')) <> 1 THEN
      RAISE EXCEPTION 'tournament_admin_signup não tem a forma esperada — alguém a mudou. Ler o corpo vivo antes de correr isto.';
    END IF;
    v_novo := regexp_replace(v_def,  c_head_mau,  c_head_bom);
    v_novo := regexp_replace(v_novo, c_decl_mau,  c_decl_bom);
    v_novo := regexp_replace(v_novo, c_fecho_mau, c_fecho_bom);
    v_novo := regexp_replace(v_novo, c_gen_mau,   c_gen_bom);
    v_novo := regexp_replace(v_novo, c_est_mau,   c_est_bom);
    v_novo := regexp_replace(v_novo, c_tok_mau,   c_tok_bom);
    v_novo := regexp_replace(v_novo, c_col_mau,   c_col_bom);
    v_novo := regexp_replace(v_novo, c_val_mau,   c_val_bom);
    v_novo := regexp_replace(v_novo, c_ret_mau,   c_ret_bom);

    EXECUTE 'DROP FUNCTION public.tournament_admin_signup(uuid, uuid, uuid, text, text, text, boolean, text, text)';
    EXECUTE v_novo;
    EXECUTE 'REVOKE ALL ON FUNCTION public.tournament_admin_signup(uuid, uuid, uuid, text, text, text, boolean, text, text, text, text) FROM PUBLIC';
    FOR a IN SELECT * FROM aclexplode(COALESCE(v_acl, acldefault('f', v_owner)))
              WHERE privilege_type = 'EXECUTE' LOOP
      IF a.grantee = 0 THEN
        EXECUTE 'GRANT EXECUTE ON FUNCTION public.tournament_admin_signup(uuid, uuid, uuid, text, text, text, boolean, text, text, text, text) TO PUBLIC';
      ELSE
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.tournament_admin_signup(uuid, uuid, uuid, text, text, text, boolean, text, text, text, text) TO %I',
                       (SELECT rolname FROM pg_roles WHERE oid = a.grantee));
      END IF;
    END LOOP;
    RAISE NOTICE 'Corrigida: tournament_admin_signup (+ jogador 1 sem conta, sozinho)';
  END IF;

  -- ── tournament_claim_entry ──────────────────────────────────────────
  v_oid := to_regprocedure('tournament_claim_entry(text)');
  v_def := pg_get_functiondef(v_oid);
  IF position('invite_token_player1' IN v_def) > 0 THEN
    RAISE NOTICE 'tournament_claim_entry: já aceitava o link do jogador 1.';
  ELSIF (SELECT count(*) FROM regexp_matches(v_def, c_cla_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'tournament_claim_entry não tem a forma esperada. Ler o corpo vivo.';
  ELSE
    EXECUTE regexp_replace(v_def, c_cla_mau, c_cla_bom);
    RAISE NOTICE 'Corrigida: tournament_claim_entry';
  END IF;

  -- ── tournament_invite_token ─────────────────────────────────────────
  v_oid := to_regprocedure('tournament_invite_token(uuid)');
  v_def := pg_get_functiondef(v_oid);
  IF position('IS DISTINCT FROM auth.uid()' IN v_def) > 0 THEN
    RAISE NOTICE 'tournament_invite_token: já estava corrigida.';
  ELSIF (SELECT count(*) FROM regexp_matches(v_def, c_inv_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'tournament_invite_token não tem a forma esperada. Ler o corpo vivo.';
  ELSE
    EXECUTE regexp_replace(v_def, c_inv_mau, c_inv_bom);
    RAISE NOTICE 'Corrigida: tournament_invite_token';
  END IF;

  -- ── list_tournament_entries ─────────────────────────────────────────
  v_oid := to_regprocedure('list_tournament_entries(uuid)');
  v_def := pg_get_functiondef(v_oid);
  IF position('e.guest1_name' IN v_def) > 0 THEN
    RAISE NOTICE 'list_tournament_entries: já tinha o nome escrito.';
  ELSIF (SELECT count(*) FROM regexp_matches(v_def, c_lte_mau, 'g')) <> 1
        OR (SELECT count(*) FROM regexp_matches(v_def, c_lti_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'list_tournament_entries não tem a forma esperada. Ler o corpo vivo.';
  ELSE
    EXECUTE regexp_replace(regexp_replace(v_def, c_lte_mau, c_lte_bom), c_lti_mau, c_lti_bom);
    RAISE NOTICE 'Corrigida: list_tournament_entries';
  END IF;

  -- ── list_category_seeding e tournament_team_json: p1.name 2× cada ───
  FOR v_oid IN SELECT unnest(ARRAY[to_regprocedure('list_category_seeding(uuid)'),
                                   to_regprocedure('tournament_team_json(uuid)')]) LOOP
    v_def := pg_get_functiondef(v_oid);
    IF position('e.guest1_name' IN v_def) > 0 THEN
      RAISE NOTICE '%: já tinha o nome escrito.', v_oid::regprocedure;
      CONTINUE;
    END IF;
    v_n := (SELECT count(*) FROM regexp_matches(v_def, c_p1n_mau, 'g'));
    IF v_n <> 2 THEN
      RAISE EXCEPTION '% tem o nome do jogador 1 % vezes (esperadas 2). Ler o corpo vivo.', v_oid::regprocedure, v_n;
    END IF;
    EXECUTE regexp_replace(v_def, c_p1n_mau, c_p1n_bom, 'g');
    RAISE NOTICE 'Corrigida: %', v_oid::regprocedure;
  END LOOP;

  -- ── tournament_public_entries (vista) ───────────────────────────────
  v_def := pg_get_viewdef('public.tournament_public_entries'::regclass);
  IF position('guest1_name' IN v_def) > 0 THEN
    RAISE NOTICE 'tournament_public_entries: já tinha o nome escrito.';
  ELSIF (SELECT count(*) FROM regexp_matches(v_def, 'p1\.name AS player1_name', 'g')) <> 1 THEN
    RAISE EXCEPTION 'tournament_public_entries não tem a forma esperada. Ler a vista viva.';
  ELSE
    v_novo := regexp_replace(v_def, 'p1\.name AS player1_name', 'COALESCE(p1.name, e.guest1_name) AS player1_name');
    EXECUTE format('CREATE OR REPLACE VIEW public.tournament_public_entries %s AS %s',
      COALESCE((SELECT 'WITH (' || array_to_string(reloptions, ', ') || ')'
                  FROM pg_class WHERE oid = 'public.tournament_public_entries'::regclass
                   AND reloptions IS NOT NULL), ''),
      v_novo);
    RAISE NOTICE 'Corrigida: tournament_public_entries';
  END IF;
END $$;

-- ── 3. Juntar o parceiro depois, do lado do organizador ──────────────────
-- Para quem foi inscrito sozinho (ou para trocar o parceiro de uma dupla
-- inscrita à mão). Só o admin do torneio, e só com as inscrições abertas.
-- Parceiro com conta: entra já aceite (é o organizador a inscrever, como no
-- tournament_admin_signup); sem conta: pelo nome, com o link dele.
CREATE OR REPLACE FUNCTION tournament_admin_set_partner(
  p_entry_id       UUID,
  p_partner_id     UUID DEFAULT NULL,
  p_guest_name     TEXT DEFAULT NULL,
  p_guest_email    TEXT DEFAULT NULL,
  p_partner_gender TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry tournament_entries%ROWTYPE;
  v_cat   tournament_categories%ROWTYPE;
  v_token TEXT;
  v_status TEXT;
BEGIN
  SELECT * INTO v_entry FROM tournament_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND OR v_entry.status = 'desistiu' THEN RAISE EXCEPTION 'entry_not_found'; END IF;
  SELECT * INTO v_cat FROM tournament_categories WHERE id = v_entry.category_id;
  IF NOT is_tournament_admin(v_cat.tournament_id) THEN RAISE EXCEPTION 'not_admin'; END IF;
  IF v_cat.status <> 'inscricoes' THEN RAISE EXCEPTION 'entries_closed'; END IF;

  IF p_partner_id IS NULL AND NULLIF(TRIM(p_guest_name), '') IS NULL THEN
    RAISE EXCEPTION 'partner_required';
  END IF;
  IF p_partner_id IS NOT NULL AND p_partner_id IS NOT DISTINCT FROM v_entry.player1_id THEN
    RAISE EXCEPTION 'partner_is_player1';
  END IF;
  IF p_partner_id IS NOT NULL
     AND tournament_person_in_category(v_entry.category_id, p_partner_id, p_entry_id) THEN
    RAISE EXCEPTION 'partner_already_in_category';
  END IF;
  -- Género, como no tournament_admin_signup (#433): quem não o tem, o
  -- organizador escolhe-o, e fica no perfil.
  IF p_partner_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_partner_id AND COALESCE(gender, '') <> '') THEN
    IF p_partner_gender IN ('masculino', 'feminino') THEN
      UPDATE profiles SET gender = p_partner_gender WHERE id = p_partner_id;
    ELSE
      RAISE EXCEPTION 'partner_gender_required';
    END IF;
  END IF;

  IF p_partner_id IS NULL THEN v_token := tournament_new_invite_token(); END IF;

  UPDATE tournament_entries
     SET player2_id = p_partner_id,
         guest_name = CASE WHEN p_partner_id IS NULL THEN NULLIF(TRIM(p_guest_name), '') END,
         guest_email = CASE WHEN p_partner_id IS NULL THEN NULLIF(TRIM(LOWER(p_guest_email)), '') END,
         guest_phone_hash = NULL,
         invite_token = v_token,
         invite_email_status = CASE WHEN p_partner_id IS NULL AND NULLIF(TRIM(p_guest_email), '') IS NOT NULL
                                    THEN 'queued' ELSE 'none' END,
         partner_accepted_at = CASE WHEN p_partner_id IS NOT NULL THEN NOW() END,
         respond_by = NULL,
         -- Quem estava à espera de parceiro fica completo; o resto mantém
         -- o estado que tinha (suplente continua suplente, etc.).
         status = CASE WHEN status IN ('sem_parceiro', 'convite')
                       THEN CASE WHEN validated_at IS NOT NULL THEN 'validada' ELSE 'por_validar' END
                       ELSE status END
   WHERE id = p_entry_id
  RETURNING status INTO v_status;

  RETURN jsonb_build_object('entry_id', p_entry_id, 'status', v_status, 'invite_token', v_token);
END;
$$;
REVOKE ALL ON FUNCTION tournament_admin_set_partner(UUID, UUID, TEXT, TEXT, TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION tournament_admin_set_partner(UUID, UUID, TEXT, TEXT, TEXT) TO authenticated;

-- ── 4. O link do jogador 1, para reenviar ────────────────────────────────
-- Como o `tournament_invite_token`, um de cada vez e só a pedido — mas só o
-- organizador: o jogador 1 sem conta não tem sessão para o pedir.
CREATE OR REPLACE FUNCTION tournament_invite_token_player1(p_entry_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry tournament_entries%ROWTYPE;
BEGIN
  SELECT * INTO v_entry FROM tournament_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'entry_not_found'; END IF;
  IF NOT is_tournament_admin((SELECT tournament_id FROM tournament_categories WHERE id = v_entry.category_id)) THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  RETURN v_entry.invite_token_player1;
END;
$$;
REVOKE ALL ON FUNCTION tournament_invite_token_player1(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION tournament_invite_token_player1(UUID) TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- ANTES DE CORRER, EM PRODUÇÃO (só leitura)
-- ═════════════════════════════════════════════════════════════════════════
--   SELECT p.oid::regprocedure FROM pg_proc p
--    WHERE p.pronamespace = 'public'::regnamespace
--      AND p.proname IN ('tournament_admin_signup', 'tournament_claim_entry',
--        'tournament_invite_token', 'list_tournament_entries', 'list_category_seeding',
--        'tournament_team_json', 'tournament_admin_set_partner', 'tournament_invite_token_player1');
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid = 'public.tournament_entries'::regclass AND contype = 'c';
-- Esperado: tournament_admin_signup com 9 argumentos, uma só; as duas novas
-- ainda não existem; o CHECK do parceiro com sem_parceiro/desistiu.
