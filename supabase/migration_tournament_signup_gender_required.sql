-- ═════════════════════════════════════════════════════════════════════════
-- TORNEIOS: INSCREVER-SE EXIGE GÉNERO DEFINIDO
-- (23 set 2026) — cartão #433. Ligado a #369 (género obrigatório).
--
-- CORRER DEPOIS de migration_tournament_signup.sql. Pode-se correr outra vez
-- sem estragar. Redefine tournament_signup a partir da versão de lá, só com
-- a verificação nova (gender_required) logo a seguir ao login.
-- A inscrição à mão pelo admin (tournament_admin_signup) não muda.
-- ═════════════════════════════════════════════════════════════════════════

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
  -- Sem género definido não há inscrição: as categorias são masculinas ou
  -- femininas, pagas e com vagas (Francisco, 23 set — #433). O ecrã abre
  -- logo a escolha do género; isto é a guarda que conta.
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_me AND gender IS NOT NULL AND gender <> '') THEN
    RAISE EXCEPTION 'gender_required';
  END IF;

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
