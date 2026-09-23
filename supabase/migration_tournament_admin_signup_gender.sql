-- ═════════════════════════════════════════════════════════════════════════
-- TORNEIOS: INSCREVER À MÃO TAMBÉM EXIGE GÉNERO — E O ADMIN ESCOLHE-O
-- (23 set 2026) — cartão #433, o caminho que o Smash Cup vai usar.
--
-- CORRER DEPOIS de migration_tournament_signup.sql. Pode-se correr outra vez
-- sem estragar.
--
-- tournament_admin_signup ganha p_player1_gender / p_partner_gender. Se o
-- Jogador 1 (ou o parceiro com conta) ainda não tem género, o admin escolhe-o
-- no ecrã e fica gravado no perfil dessa pessoa (opção a, Renato, 23 set).
-- Sem género e sem escolha → 'player1_gender_required' / 'partner_gender_required'.
-- Convidados sem conta não têm perfil: não se lhes pede nada.
--
-- Muda a assinatura, por isso apaga-se a antiga — senão ficavam duas versões
-- e as chamadas davam «ambígua» (foi o que aconteceu ao mark_walkover).
-- ═════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS tournament_admin_signup(UUID, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN);

CREATE OR REPLACE FUNCTION tournament_admin_signup(
  p_category_id UUID,
  p_player1_id  UUID,
  p_partner_id  UUID DEFAULT NULL,
  p_guest_name  TEXT DEFAULT NULL,
  p_guest_email TEXT DEFAULT NULL,
  p_team_name   TEXT DEFAULT NULL,
  p_paid        BOOLEAN DEFAULT FALSE,
  p_player1_gender TEXT DEFAULT NULL,
  p_partner_gender TEXT DEFAULT NULL
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

  -- Género (#433): quem tem conta e ainda não o definiu não entra sem ele.
  -- Aqui é o admin a inscrever outra pessoa, por isso é o admin que o escolhe
  -- (decisão do Renato, 23 set) — e fica gravado no perfil dessa pessoa.
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_player1_id AND COALESCE(gender, '') <> '') THEN
    IF p_player1_gender IN ('masculino', 'feminino') THEN
      UPDATE profiles SET gender = p_player1_gender WHERE id = p_player1_id;
    ELSE
      RAISE EXCEPTION 'player1_gender_required';
    END IF;
  END IF;
  IF p_partner_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_partner_id AND COALESCE(gender, '') <> '') THEN
    IF p_partner_gender IN ('masculino', 'feminino') THEN
      UPDATE profiles SET gender = p_partner_gender WHERE id = p_partner_id;
    ELSE
      RAISE EXCEPTION 'partner_gender_required';
    END IF;
  END IF;

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

REVOKE ALL ON FUNCTION tournament_admin_signup(UUID, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION tournament_admin_signup(UUID, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT) TO authenticated;
