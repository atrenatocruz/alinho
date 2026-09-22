-- ════════════════════════════════════════════════════════════════════════
-- Torneio 2/6 — inscrição da dupla, suplentes e validação do pagamento
-- (Trello #362)
--
-- NÃO CORRER sem o sim do Renato. Corre DEPOIS de
-- migration_tournaments_base.sql (é essa que cria tournament_entries).
--
-- A base do Dev 3 já tem as tabelas, as vistas públicas e a política de
-- leitura. Falta o que escreve: inscrever, aceitar, recusar, desistir,
-- suplentes, validar o pagamento e inscrever à mão. Como não há políticas
-- de INSERT/UPDATE em tournament_entries — de propósito —, tudo passa por
-- estas funções SECURITY DEFINER, que fazem as verificações à mão.
--
-- Regras do desenho (design-handoff/2026-09-19-torneios):
--   • no torneio o parceiro TEM DE ACEITAR (no mix entra logo): são dias e
--     há inscrição paga — Francisco, 21 set;
--   • o parceiro sem conta entra só pelo nome, com um link que lhe passa o
--     lugar quando se registar; não pontua até lá;
--   • cheia a categoria, o seguinte fica suplente por ordem de chegada, e
--     sobe se alguém sair — só até ao sorteio;
--   • o pagamento é fora da app: o admin valida num toque.
--
-- Dev 2, 21 set 2026 · revisto pelo Dev 3 a 22 set (8 correções, todas
-- aqui dentro: ver os comentários "revisão do Dev 3")
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. O que faltava guardar ────────────────────────────────────────────
-- A tabela já tinha guest_name e guest_phone_hash. O Francisco pediu
-- também o email (é por aí que o convite chega quando o envio existir) e o
-- código do convite, igual ao dos mixes.
ALTER TABLE tournament_entries
  ADD COLUMN IF NOT EXISTS guest_email   TEXT,
  ADD COLUMN IF NOT EXISTS invite_token  TEXT,
  ADD COLUMN IF NOT EXISTS invite_email_status TEXT NOT NULL DEFAULT 'none'
      CHECK (invite_email_status IN ('none','queued','sent','failed')),
  -- Prazo para o parceiro com conta responder ("Responde até 3 out").
  ADD COLUMN IF NOT EXISTS respond_by    TIMESTAMPTZ,
  -- Quando o parceiro aceitou. Enquanto for NULL e houver player2_id, há
  -- um convite por responder — mesmo que a inscrição esteja em suplente,
  -- onde não se pergunta nada a ninguém até ela subir.
  ADD COLUMN IF NOT EXISTS partner_accepted_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS tournament_entries_invite_token_key
  ON tournament_entries(invite_token) WHERE invite_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS tournament_entries_invite_to_send_idx
  ON tournament_entries(invite_email_status) WHERE invite_email_status = 'queued';

COMMENT ON COLUMN tournament_entries.guest_email IS
  'Email do parceiro sem conta, se quem o inscreveu o deu. É para lá que vai o link do convite quando o envio de emails existir. Trello #362.';

-- ── 2. Ajudantes ────────────────────────────────────────────────────────
-- gen_random_bytes vive no esquema `extensions` (pgcrypto), e estas
-- funções correm com SET search_path = public: não resolvia, e rebentava
-- toda a inscrição com parceiro sem conta (apanhado pelo Dev 3 na
-- revisão, 22 set, reproduzido no alinho-dev). gen_random_uuid() é do
-- próprio Postgres desde a 13 e não precisa de extensão nenhuma.
CREATE OR REPLACE FUNCTION tournament_new_invite_token()
RETURNS TEXT LANGUAGE sql VOLATILE AS $$
  SELECT md5(gen_random_uuid()::text || gen_random_uuid()::text);
$$;

-- Quantos lugares estão tomados numa categoria. Suplentes e desistências
-- não ocupam lugar; tudo o resto sim (mesmo por validar — quem chega
-- primeiro fica com o lugar enquanto o clube espera pelo pagamento).
CREATE OR REPLACE FUNCTION tournament_taken_slots(p_category_id UUID)
RETURNS INTEGER LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COUNT(*)::int FROM tournament_entries
   WHERE category_id = p_category_id
     AND status IN ('convite','sem_parceiro','por_validar','validada','selecionada');
$$;

-- Alguém saiu: o primeiro suplente sobe. Só faz sentido enquanto a
-- categoria ainda não foi sorteada (regra do desenho).
CREATE OR REPLACE FUNCTION tournament_promote_waitlist(p_category_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_slots INTEGER;
  v_next tournament_entries%ROWTYPE;
  v_status TEXT;
BEGIN
  SELECT slots, status INTO v_slots, v_status
    FROM tournament_categories WHERE id = p_category_id;
  IF v_status <> 'inscricoes' THEN RETURN NULL; END IF;
  IF v_slots IS NULL OR tournament_taken_slots(p_category_id) < v_slots THEN
    SELECT * INTO v_next FROM tournament_entries
     WHERE category_id = p_category_id AND status = 'suplente'
     ORDER BY waitlist_order NULLS LAST, created_at LIMIT 1;
    IF FOUND THEN
      -- Se o parceiro nunca chegou a aceitar (a inscrição entrou logo em
      -- suplente), ao subir é agora que se lhe pergunta — nunca fica
      -- ninguém numa dupla sem ter dito que sim (regra do Francisco,
      -- 21 set; revisão do Dev 3, 22 set).
      UPDATE tournament_entries
         SET status = CASE
               WHEN player2_id IS NOT NULL AND partner_accepted_at IS NULL THEN 'convite'
               WHEN player2_id IS NULL AND guest_name IS NULL THEN 'sem_parceiro'
               ELSE 'por_validar' END,
             respond_by = CASE
               WHEN player2_id IS NOT NULL AND partner_accepted_at IS NULL
               THEN NOW() + INTERVAL '3 days' END,
             waitlist_order = NULL
       WHERE id = v_next.id;
      RETURN v_next.id;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

-- Já está nesta categoria, em qualquer inscrição que não tenha desistido?
-- Usa-se ao inscrever, ao aceitar um convite e ao reclamar um lugar: é
-- quando se aceita que o lugar se torna real (revisão do Dev 3, 22 set).
CREATE OR REPLACE FUNCTION tournament_person_in_category(p_category_id UUID, p_user UUID, p_except UUID DEFAULT NULL)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM tournament_entries
     WHERE category_id = p_category_id AND status <> 'desistiu'
       AND (p_except IS NULL OR id <> p_except)
       AND (player1_id = p_user OR player2_id = p_user)
  );
$$;

-- Quantas categorias deste torneio já tem esta pessoa, e qual é o máximo.
CREATE OR REPLACE FUNCTION tournament_categories_left(p_tournament_id UUID, p_user UUID)
RETURNS INTEGER LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT GREATEST(
    COALESCE((SELECT (rules->>'max_categories_per_person')::int FROM tournaments WHERE id = p_tournament_id), 2)
    - (SELECT COUNT(*) FROM tournament_entries e
         JOIN tournament_categories c ON c.id = e.category_id
        WHERE c.tournament_id = p_tournament_id AND e.status <> 'desistiu'
          AND (e.player1_id = p_user OR e.player2_id = p_user))::int,
    0);
$$;

-- ── 3. Inscrever ────────────────────────────────────────────────────────
-- Três caminhos num só sítio: com parceiro da app (ele aceita), com
-- alguém sem conta (entra pelo nome), ou sozinho.
CREATE OR REPLACE FUNCTION tournament_signup(
  p_category_id UUID,
  p_partner_id  UUID  DEFAULT NULL,
  p_guest_name  TEXT  DEFAULT NULL,
  p_guest_email TEXT  DEFAULT NULL,
  p_team_name   TEXT  DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me UUID := auth.uid();
  v_cat tournament_categories%ROWTYPE;
  v_tournament tournaments%ROWTYPE;
  v_status TEXT;
  v_token TEXT;
  v_order INTEGER;
  v_id UUID;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;

  SELECT * INTO v_cat FROM tournament_categories WHERE id = p_category_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'category_not_found'; END IF;
  SELECT * INTO v_tournament FROM tournaments WHERE id = v_cat.tournament_id;

  IF v_cat.status <> 'inscricoes' OR v_tournament.status <> 'inscricoes' THEN
    RAISE EXCEPTION 'entries_closed';
  END IF;
  IF v_tournament.entries_deadline IS NOT NULL AND v_tournament.entries_deadline < NOW() THEN
    RAISE EXCEPTION 'entries_closed';
  END IF;

  -- Máximo de categorias por pessoa (2 por defeito, o admin muda ao criar).
  IF tournament_categories_left(v_cat.tournament_id, v_me) <= 0 THEN
    RAISE EXCEPTION 'max_categories_reached';
  END IF;
  IF tournament_person_in_category(p_category_id, v_me) THEN
    RAISE EXCEPTION 'already_in_category';
  END IF;

  -- O parceiro não pode já estar nesta categoria.
  IF p_partner_id IS NOT NULL THEN
    IF p_partner_id = v_me THEN RAISE EXCEPTION 'partner_is_you'; END IF;
    IF tournament_person_in_category(p_category_id, p_partner_id) THEN
      RAISE EXCEPTION 'partner_already_in_category';
    END IF;
  END IF;

  -- Quem chega depois de cheia fica suplente, por ordem de chegada.
  IF v_cat.slots IS NOT NULL AND tournament_taken_slots(p_category_id) >= v_cat.slots THEN
    v_status := 'suplente';
    SELECT COALESCE(MAX(waitlist_order), 0) + 1 INTO v_order
      FROM tournament_entries WHERE category_id = p_category_id AND status = 'suplente';
  ELSIF p_partner_id IS NOT NULL THEN
    v_status := 'convite';        -- à espera do sim dele
  ELSIF p_guest_name IS NOT NULL THEN
    v_status := 'por_validar';    -- sem conta: não há onde aceitar
  ELSE
    v_status := 'sem_parceiro';   -- sozinho, a organização junta depois
  END IF;

  IF p_guest_name IS NOT NULL THEN
    v_token := tournament_new_invite_token();
  END IF;

  INSERT INTO tournament_entries (
    category_id, player1_id, player2_id, guest_name, guest_email, team_name,
    status, waitlist_order, invite_token, invite_email_status, respond_by
  ) VALUES (
    p_category_id, v_me, p_partner_id, NULLIF(TRIM(p_guest_name), ''),
    NULLIF(TRIM(LOWER(p_guest_email)), ''), NULLIF(TRIM(p_team_name), ''),
    v_status, v_order, v_token,
    CASE WHEN NULLIF(TRIM(p_guest_email), '') IS NULL THEN 'none' ELSE 'queued' END,
    -- Em suplente não se pergunta nada a ninguém: o prazo só começa
    -- quando a inscrição subir (ver tournament_promote_waitlist).
    CASE WHEN p_partner_id IS NULL OR v_status = 'suplente' THEN NULL
         ELSE LEAST(COALESCE(v_tournament.entries_deadline, NOW() + INTERVAL '3 days'),
                    NOW() + INTERVAL '3 days') END
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('entry_id', v_id, 'status', v_status, 'invite_token', v_token);
END;
$$;

-- ── 4. O parceiro responde ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION tournament_respond_invite(p_entry_id UUID, p_accept BOOLEAN)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me UUID := auth.uid();
  v_entry tournament_entries%ROWTYPE;
  v_tournament UUID;
  v_cat_status TEXT;
BEGIN
  SELECT * INTO v_entry FROM tournament_entries
   WHERE id = p_entry_id AND player2_id = v_me AND status = 'convite' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invite_not_found'; END IF;
  IF v_entry.respond_by IS NOT NULL AND v_entry.respond_by < NOW() THEN
    RAISE EXCEPTION 'invite_expired';
  END IF;

  SELECT c.tournament_id, c.status INTO v_tournament, v_cat_status
    FROM tournament_categories c WHERE c.id = v_entry.category_id;

  IF p_accept THEN
    -- É ao aceitar que o lugar se torna real: as verificações que se fazem
    -- na inscrição têm de se repetir aqui, senão a mesma pessoa acabava em
    -- duas duplas da mesma categoria (revisão do Dev 3, 22 set).
    IF v_cat_status <> 'inscricoes' THEN RAISE EXCEPTION 'entries_closed'; END IF;
    IF tournament_person_in_category(v_entry.category_id, v_me, v_entry.id) THEN
      RAISE EXCEPTION 'already_in_category';
    END IF;
    IF tournament_categories_left(v_tournament, v_me) <= 0 THEN
      RAISE EXCEPTION 'max_categories_reached';
    END IF;

    -- Aceite: fica à espera de o clube confirmar o pagamento.
    UPDATE tournament_entries
       SET status = 'por_validar', respond_by = NULL, partner_accepted_at = NOW()
     WHERE id = p_entry_id;
    RETURN 'por_validar';
  END IF;

  -- Recusa: a inscrição não morre — quem convidou pode convidar outro.
  UPDATE tournament_entries
     SET status = 'sem_parceiro', player2_id = NULL, respond_by = NULL,
         partner_accepted_at = NULL
   WHERE id = p_entry_id;
  RETURN 'sem_parceiro';
END;
$$;

-- Convites à minha espera (para o sino e para o cartão do torneio).
CREATE OR REPLACE FUNCTION list_my_tournament_invites()
RETURNS TABLE (
  entry_id UUID, category_id UUID, category_code TEXT, category_name TEXT,
  tournament_id UUID, tournament_name TEXT, tournament_slug TEXT,
  starts_on DATE, ends_on DATE, entry_fee_cents INTEGER,
  inviter_id UUID, inviter_name TEXT, respond_by TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.id, c.id, c.code, c.name, t.id, t.name, t.slug,
         t.starts_on, t.ends_on, COALESCE(c.price_cents, t.entry_fee_cents),
         p.id, p.name, e.respond_by
    FROM tournament_entries e
    JOIN tournament_categories c ON c.id = e.category_id
    JOIN tournaments t ON t.id = c.tournament_id
    JOIN profiles p ON p.id = e.player1_id
   WHERE e.player2_id = auth.uid() AND e.status = 'convite'
     AND (e.respond_by IS NULL OR e.respond_by >= NOW())
   ORDER BY e.created_at;
$$;

-- ── 5. Trocar de parceiro, e desistir ───────────────────────────────────
CREATE OR REPLACE FUNCTION tournament_change_partner(
  p_entry_id UUID, p_partner_id UUID DEFAULT NULL,
  p_guest_name TEXT DEFAULT NULL, p_guest_email TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me UUID := auth.uid();
  v_entry tournament_entries%ROWTYPE;
  v_cat_status TEXT;
  v_token TEXT;
BEGIN
  SELECT * INTO v_entry FROM tournament_entries
   WHERE id = p_entry_id AND player1_id = v_me FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'entry_not_found'; END IF;

  SELECT status INTO v_cat_status FROM tournament_categories WHERE id = v_entry.category_id;
  IF v_cat_status <> 'inscricoes' THEN RAISE EXCEPTION 'entries_closed'; END IF;
  IF v_entry.status = 'validada' THEN RAISE EXCEPTION 'entry_already_validated'; END IF;

  IF p_partner_id = v_me THEN RAISE EXCEPTION 'partner_is_you'; END IF;
  IF p_partner_id IS NOT NULL
     AND tournament_person_in_category(v_entry.category_id, p_partner_id, p_entry_id) THEN
    RAISE EXCEPTION 'partner_already_in_category';
  END IF;

  IF p_guest_name IS NOT NULL THEN v_token := tournament_new_invite_token(); END IF;

  UPDATE tournament_entries
     SET player2_id = p_partner_id,
         guest_name = NULLIF(TRIM(p_guest_name), ''),
         guest_email = NULLIF(TRIM(LOWER(p_guest_email)), ''),
         invite_token = v_token,
         invite_email_status = CASE WHEN NULLIF(TRIM(p_guest_email), '') IS NULL THEN 'none' ELSE 'queued' END,
         partner_accepted_at = NULL,
         status = CASE WHEN v_entry.status = 'suplente' THEN 'suplente'
                       WHEN p_partner_id IS NOT NULL THEN 'convite'
                       WHEN p_guest_name IS NOT NULL THEN 'por_validar'
                       ELSE 'sem_parceiro' END,
         respond_by = CASE WHEN p_partner_id IS NULL THEN NULL ELSE NOW() + INTERVAL '3 days' END
   WHERE id = p_entry_id;

  RETURN jsonb_build_object('entry_id', p_entry_id, 'invite_token', v_token);
END;
$$;

-- Desistir: só quem inscreveu, e só enquanto as inscrições estão abertas.
-- Depois disso fala-se com a organização (regra do desenho).
CREATE OR REPLACE FUNCTION tournament_withdraw_entry(p_entry_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me UUID := auth.uid();
  v_entry tournament_entries%ROWTYPE;
  v_cat_status TEXT;
BEGIN
  SELECT * INTO v_entry FROM tournament_entries
   WHERE id = p_entry_id AND (player1_id = v_me OR player2_id = v_me) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'entry_not_found'; END IF;

  SELECT status INTO v_cat_status FROM tournament_categories WHERE id = v_entry.category_id;
  IF v_cat_status <> 'inscricoes' THEN RAISE EXCEPTION 'entries_closed'; END IF;

  -- Quem inscreveu desiste da dupla toda. O parceiro sai só de si próprio
  -- e a inscrição do outro fica de pé, à procura de parceiro — antes
  -- bastava o parceiro sair para apagar a inscrição de quem o convidou
  -- (revisão do Dev 3, 22 set).
  IF v_entry.player1_id = v_me THEN
    UPDATE tournament_entries SET status = 'desistiu' WHERE id = p_entry_id;
    PERFORM tournament_promote_waitlist(v_entry.category_id);
  ELSE
    UPDATE tournament_entries
       SET player2_id = NULL, partner_accepted_at = NULL, respond_by = NULL,
           status = CASE WHEN status = 'suplente' THEN 'suplente' ELSE 'sem_parceiro' END
     WHERE id = p_entry_id;
  END IF;
END;
$$;

-- ── 6. O parceiro sem conta fica com o lugar ────────────────────────────
CREATE OR REPLACE FUNCTION tournament_claim_entry(p_token TEXT)
RETURNS UUID   -- o tournament_id, para a app saltar para lá
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me UUID := auth.uid();
  v_entry tournament_entries%ROWTYPE;
  v_tournament UUID;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;

  SELECT * INTO v_entry FROM tournament_entries
   WHERE invite_token = p_token AND status <> 'desistiu' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invite_not_found'; END IF;
  IF v_entry.player2_id IS NOT NULL THEN RAISE EXCEPTION 'invite_already_claimed'; END IF;
  IF v_entry.player1_id = v_me THEN RAISE EXCEPTION 'invite_is_your_own'; END IF;

  SELECT c.tournament_id INTO v_tournament
    FROM tournament_categories c WHERE c.id = v_entry.category_id;

  -- Ficar com o lugar é entrar mesmo: valem as regras da inscrição
  -- (revisão do Dev 3, 22 set).
  IF tournament_person_in_category(v_entry.category_id, v_me, v_entry.id) THEN
    RAISE EXCEPTION 'already_in_category';
  END IF;
  IF tournament_categories_left(v_tournament, v_me) <= 0 THEN
    RAISE EXCEPTION 'max_categories_reached';
  END IF;

  UPDATE tournament_entries
     SET player2_id = v_me, guest_name = NULL, guest_email = NULL,
         guest_phone_hash = NULL, invite_token = NULL, invite_email_status = 'none',
         partner_accepted_at = NOW()
   WHERE id = v_entry.id;

  RETURN v_tournament;
END;
$$;

-- ── 7. Do lado do organizador ───────────────────────────────────────────
-- Validar = recebi o pagamento (é fora da app). Um toque.
CREATE OR REPLACE FUNCTION tournament_validate_entry(p_entry_id UUID, p_paid BOOLEAN DEFAULT TRUE)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_entry tournament_entries%ROWTYPE;
  v_tournament UUID;
BEGIN
  SELECT * INTO v_entry FROM tournament_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'entry_not_found'; END IF;
  SELECT tournament_id INTO v_tournament FROM tournament_categories WHERE id = v_entry.category_id;
  IF NOT is_tournament_admin(v_tournament) THEN RAISE EXCEPTION 'not_admin'; END IF;

  -- Validar um suplente punha-o dentro à frente de quem estava na fila, e
  -- podia passar a lotação da categoria. Primeiro sobe (alguém tem de
  -- sair), depois valida-se (revisão do Dev 3, 22 set).
  IF v_entry.status = 'suplente' THEN RAISE EXCEPTION 'entry_on_waitlist'; END IF;
  -- Uma dupla por responder também não se valida: ainda não se sabe quem
  -- ela é.
  IF p_paid AND v_entry.status IN ('convite', 'sem_parceiro') THEN
    RAISE EXCEPTION 'entry_not_complete';
  END IF;

  IF p_paid THEN
    UPDATE tournament_entries
       SET status = 'validada', validated_at = NOW(), validated_by = auth.uid()
     WHERE id = p_entry_id;
    RETURN 'validada';
  END IF;

  UPDATE tournament_entries
     SET status = 'por_validar', validated_at = NULL, validated_by = NULL
   WHERE id = p_entry_id;
  RETURN 'por_validar';
END;
$$;

-- Tirar uma inscrição (recusada, ou pedido da própria pessoa por fora).
CREATE OR REPLACE FUNCTION tournament_remove_entry(p_entry_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_entry tournament_entries%ROWTYPE;
  v_tournament UUID;
BEGIN
  SELECT * INTO v_entry FROM tournament_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'entry_not_found'; END IF;
  SELECT tournament_id INTO v_tournament FROM tournament_categories WHERE id = v_entry.category_id;
  IF NOT is_tournament_admin(v_tournament) THEN RAISE EXCEPTION 'not_admin'; END IF;

  UPDATE tournament_entries SET status = 'desistiu' WHERE id = p_entry_id;
  PERFORM tournament_promote_waitlist(v_entry.category_id);
END;
$$;

-- Inscrever à mão: as inscrições do Smash Cup ainda entram pelo formulário
-- do clube, e alguém tem de as passar para cá (ATUALIZACOES-21-SET, ponto 6).
CREATE OR REPLACE FUNCTION tournament_admin_signup(
  p_category_id UUID,
  p_player1_id  UUID,
  p_partner_id  UUID DEFAULT NULL,
  p_guest_name  TEXT DEFAULT NULL,
  p_guest_email TEXT DEFAULT NULL,
  p_team_name   TEXT DEFAULT NULL,
  p_paid        BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cat tournament_categories%ROWTYPE;
  v_status TEXT;
  v_order INTEGER;
  v_token TEXT;
  v_id UUID;
BEGIN
  SELECT * INTO v_cat FROM tournament_categories WHERE id = p_category_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'category_not_found'; END IF;
  IF NOT is_tournament_admin(v_cat.tournament_id) THEN RAISE EXCEPTION 'not_admin'; END IF;
  IF v_cat.status <> 'inscricoes' THEN RAISE EXCEPTION 'entries_closed'; END IF;

  IF EXISTS (SELECT 1 FROM tournament_entries
              WHERE category_id = p_category_id AND status <> 'desistiu'
                AND (player1_id = p_player1_id OR player2_id = p_player1_id
                     OR (p_partner_id IS NOT NULL
                         AND (player1_id = p_partner_id OR player2_id = p_partner_id)))) THEN
    RAISE EXCEPTION 'already_in_category';
  END IF;

  IF v_cat.slots IS NOT NULL AND tournament_taken_slots(p_category_id) >= v_cat.slots THEN
    v_status := 'suplente';
    SELECT COALESCE(MAX(waitlist_order), 0) + 1 INTO v_order
      FROM tournament_entries WHERE category_id = p_category_id AND status = 'suplente';
  ELSE
    -- Quem o admin inscreve não precisa de aceitar: a dupla veio já feita
    -- do formulário do clube.
    v_status := CASE WHEN p_paid THEN 'validada' ELSE 'por_validar' END;
  END IF;

  IF p_guest_name IS NOT NULL THEN v_token := tournament_new_invite_token(); END IF;

  INSERT INTO tournament_entries (
    category_id, player1_id, player2_id, guest_name, guest_email, team_name,
    status, waitlist_order, invite_token, invite_email_status,
    partner_accepted_at, validated_at, validated_by
  ) VALUES (
    p_category_id, p_player1_id, p_partner_id, NULLIF(TRIM(p_guest_name), ''),
    NULLIF(TRIM(LOWER(p_guest_email)), ''), NULLIF(TRIM(p_team_name), ''),
    v_status, v_order, v_token,
    CASE WHEN NULLIF(TRIM(p_guest_email), '') IS NULL THEN 'none' ELSE 'queued' END,
    -- Inscrita pelo organizador: a dupla veio já feita do formulário do
    -- clube, não há convite por responder.
    CASE WHEN p_partner_id IS NOT NULL THEN NOW() END,
    CASE WHEN v_status = 'validada' THEN NOW() END,
    CASE WHEN v_status = 'validada' THEN auth.uid() END
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('entry_id', v_id, 'status', v_status, 'invite_token', v_token);
END;
$$;

-- A lista do organizador, por categoria: quem se inscreveu, em que estado,
-- e quem veio sozinho. O email do convidado só aqui — nunca na vista
-- pública (a regra dos nomes de 19 set).
-- O DROP é preciso para quem já correu a versão de 21 set: esta devolvia
-- `invite_token` e agora devolve `has_invite`, e o Postgres não deixa um
-- CREATE OR REPLACE mudar o tipo de retorno (42P13). Sem isto, voltar a
-- correr o ficheiro parava aqui.
DROP FUNCTION IF EXISTS list_tournament_entries(UUID);
CREATE OR REPLACE FUNCTION list_tournament_entries(p_category_id UUID)
RETURNS TABLE (
  entry_id UUID, status TEXT, team_name TEXT, waitlist_order INTEGER,
  created_at TIMESTAMPTZ, validated_at TIMESTAMPTZ,
  player1_id UUID, player1_name TEXT, player1_avatar TEXT,
  player2_id UUID, player2_name TEXT, player2_avatar TEXT,
  guest_name TEXT, guest_email TEXT, has_invite BOOLEAN, respond_by TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tournament UUID;
BEGIN
  SELECT tournament_id INTO v_tournament FROM tournament_categories WHERE id = p_category_id;
  IF v_tournament IS NULL THEN RAISE EXCEPTION 'category_not_found'; END IF;
  IF NOT is_tournament_admin(v_tournament) THEN RAISE EXCEPTION 'not_admin'; END IF;

  RETURN QUERY
    SELECT e.id, e.status, e.team_name, e.waitlist_order, e.created_at, e.validated_at,
           e.player1_id, p1.name, p1.avatar_url,
           e.player2_id, p2.name, p2.avatar_url,
           -- O código do convite não vai para o ecrã: com ele qualquer
           -- admin ficava com o lugar do parceiro. Quem o quiser mandar
           -- outra vez pede-o à função de baixo (revisão do Dev 3).
           e.guest_name, e.guest_email, (e.invite_token IS NOT NULL), e.respond_by
      FROM tournament_entries e
      LEFT JOIN profiles p1 ON p1.id = e.player1_id
      LEFT JOIN profiles p2 ON p2.id = e.player2_id
     WHERE e.category_id = p_category_id
     ORDER BY (e.status = 'suplente'), e.waitlist_order NULLS FIRST, e.created_at;
END;
$$;

-- O código do convite, um de cada vez e só a pedido: para quem convidou
-- ou para o organizador reenviarem o link.
CREATE OR REPLACE FUNCTION tournament_invite_token(p_entry_id UUID)
RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_entry tournament_entries%ROWTYPE;
  v_tournament UUID;
BEGIN
  SELECT * INTO v_entry FROM tournament_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'entry_not_found'; END IF;
  SELECT tournament_id INTO v_tournament FROM tournament_categories WHERE id = v_entry.category_id;
  IF v_entry.player1_id <> auth.uid() AND NOT is_tournament_admin(v_tournament) THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  RETURN v_entry.invite_token;
END;
$$;

-- ── 8. Quem pode chamar o quê ───────────────────────────────────────────
DO $$
DECLARE fn TEXT;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'tournament_signup(uuid,uuid,text,text,text)',
    'tournament_respond_invite(uuid,boolean)',
    'list_my_tournament_invites()',
    'tournament_change_partner(uuid,uuid,text,text)',
    'tournament_withdraw_entry(uuid)',
    'tournament_claim_entry(text)',
    'tournament_validate_entry(uuid,boolean)',
    'tournament_remove_entry(uuid)',
    'tournament_admin_signup(uuid,uuid,uuid,text,text,text,boolean)',
    'list_tournament_entries(uuid)',
    'tournament_invite_token(uuid)',
    'tournament_person_in_category(uuid,uuid,uuid)',
    'tournament_categories_left(uuid,uuid)',
    'tournament_promote_waitlist(uuid)',
    'tournament_taken_slots(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM public, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
  END LOOP;
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- NOTAS PARA O RENATO
-- 1. Não há políticas de INSERT/UPDATE em tournament_entries, de propósito:
--    tudo passa por estas funções, que verificam admin/dono à mão.
-- 2. Convites por email: tournament_entries.invite_email_status = 'queued'
--    espera pelo teu envio, com o link <app>/convite-torneio/<invite_token>.
--    Mesmo formato do dos mixes (partner_invites).
-- 3. O parceiro sem conta ainda NÃO tem conta criada (ao contrário do mix):
--    aqui é só nome, porque no torneio ele só entra em campo depois do
--    sorteio. Se o Francisco quiser o mesmo caminho dos mixes, falamos.
--
-- Conferir depois de correr:
--   SELECT proname FROM pg_proc WHERE proname LIKE 'tournament\_%' ORDER BY 1;
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='tournament_entries' ORDER BY 1;
-- ════════════════════════════════════════════════════════════════════════
