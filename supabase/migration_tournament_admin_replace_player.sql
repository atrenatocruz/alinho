-- ═════════════════════════════════════════════════════════════════════════
-- #434 (ponto 2) — O organizador troca um jogador de uma dupla, a qualquer
-- momento, mesmo com jogos a decorrer. Plano aprovado pelo Francisco a
-- 26 set; o ecrã é do Dev 2 (EntriesPanel), com este nome e estes
-- argumentos.
--
-- ⚖️ PROPOSTA AO RENATO, por acordar: muda o desenho de 19 set, em que a
-- dupla só mudava com as inscrições abertas (tournament_change_partner, do
-- próprio jogador) — aqui é o organizador, e em qualquer altura.
--
-- tournament_admin_replace_player(p_entry_id, p_slot 1|2, p_player_id,
--   p_guest_name, p_guest_email, p_player_gender)
--   → { entry_id, status, invite_token }
--
--   · Quem entra: alguém com conta (p_player_id) ou só pelo nome. Pelo nome
--     recebe o link para ficar com o lugar: no lugar 1 é o do jogador 1
--     (#515), no lugar 2 o convite de sempre. `invite_token` devolve-o.
--   · Os jogos já jogados ficam com quem os jogou (#442: o registo de quem
--     esteve em campo congela no primeiro resultado, e os pontos saem
--     dele). Os seguintes leem a dupla, e mostram já a pessoa nova.
--   · Recusa (códigos que o ecrã traduz):
--       not_admin · entry_not_found (não existe ou desistiu) ·
--       slot_invalid · player_required (nem conta nem nome) ·
--       same_player (é quem já lá está, ou o parceiro dele) ·
--       player_already_in_category · max_categories_reached
--       (o sexo nunca bloqueia — Francisco, 26 set; ver
--       migration_tournament_sexo_nao_bloqueia.sql).
--   · O estado da inscrição mantém-se; só uma dupla que estava à espera de
--     parceiro (sem_parceiro/convite) e recebe o jogador 2 passa a
--     validada (se já estava paga) ou por_validar, como na
--     tournament_admin_set_partner.
--
-- Função nova: REVOKE explícito de PUBLIC e anon, GRANT só a authenticated.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

-- ── 0. Peças de que depende ─────────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.is_tournament_admin(uuid)') IS NULL
     OR to_regprocedure('public.tournament_new_invite_token()') IS NULL
     OR to_regprocedure('public.tournament_person_in_category(uuid, uuid, uuid)') IS NULL
     OR to_regprocedure('public.tournament_categories_left(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'Faltam funções de inscrição dos torneios. Parar e ler.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'tournament_entries'
                    AND column_name = 'invite_token_player1') THEN
    RAISE EXCEPTION 'Falta a coluna invite_token_player1 (#515). Parar e ler.';
  END IF;
END $$;

-- ── 1. A função ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tournament_admin_replace_player(
  p_entry_id      UUID,
  p_slot          INTEGER,
  p_player_id     UUID DEFAULT NULL,
  p_guest_name    TEXT DEFAULT NULL,
  p_guest_email   TEXT DEFAULT NULL,
  p_player_gender TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry   tournament_entries%ROWTYPE;
  v_cat     tournament_categories%ROWTYPE;
  v_name    TEXT := NULLIF(TRIM(p_guest_name), '');
  v_email   TEXT := NULLIF(TRIM(LOWER(p_guest_email)), '');
  v_current UUID;
  v_other   UUID;
  v_token   TEXT;
  v_status  TEXT;
BEGIN
  SELECT * INTO v_entry FROM tournament_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND OR v_entry.status = 'desistiu' THEN RAISE EXCEPTION 'entry_not_found'; END IF;
  SELECT * INTO v_cat FROM tournament_categories WHERE id = v_entry.category_id;
  IF NOT is_tournament_admin(v_cat.tournament_id) THEN RAISE EXCEPTION 'not_admin'; END IF;

  IF p_slot IS NULL OR p_slot NOT IN (1, 2) THEN RAISE EXCEPTION 'slot_invalid'; END IF;
  IF p_player_id IS NULL AND v_name IS NULL THEN RAISE EXCEPTION 'player_required'; END IF;

  v_current := CASE WHEN p_slot = 1 THEN v_entry.player1_id ELSE v_entry.player2_id END;
  v_other   := CASE WHEN p_slot = 1 THEN v_entry.player2_id ELSE v_entry.player1_id END;

  IF p_player_id IS NOT NULL THEN
    IF p_player_id IS NOT DISTINCT FROM v_current OR p_player_id IS NOT DISTINCT FROM v_other THEN
      RAISE EXCEPTION 'same_player';
    END IF;
    IF tournament_person_in_category(v_entry.category_id, p_player_id, p_entry_id) THEN
      RAISE EXCEPTION 'player_already_in_category';
    END IF;
    IF tournament_categories_left(v_cat.tournament_id, p_player_id) <= 0 THEN
      RAISE EXCEPTION 'max_categories_reached';
    END IF;
    -- Género: quem não o tem, o organizador pode escolhê-lo, e fica no perfil
    -- (regra de hoje; #495 à espera do Renato). Se não vier, entra na mesma:
    -- o sexo nunca bloqueia (Francisco, 26 set).
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_player_id AND COALESCE(gender, '') <> '')
       AND p_player_gender IN ('masculino', 'feminino') THEN
      UPDATE profiles SET gender = p_player_gender WHERE id = p_player_id;
    END IF;
  ELSE
    v_token := tournament_new_invite_token();
  END IF;

  IF p_slot = 1 THEN
    UPDATE tournament_entries
       SET player1_id = p_player_id,
           guest1_name = CASE WHEN p_player_id IS NULL THEN v_name END,
           guest1_email = CASE WHEN p_player_id IS NULL THEN v_email END,
           invite_token_player1 = v_token
     WHERE id = p_entry_id
    RETURNING status INTO v_status;
  ELSE
    UPDATE tournament_entries
       SET player2_id = p_player_id,
           guest_name = CASE WHEN p_player_id IS NULL THEN v_name END,
           guest_email = CASE WHEN p_player_id IS NULL THEN v_email END,
           guest_phone_hash = NULL,
           invite_token = v_token,
           invite_email_status = CASE WHEN p_player_id IS NULL AND v_email IS NOT NULL
                                      THEN 'queued' ELSE 'none' END,
           -- Foi o organizador a fazer a dupla: não há convite por responder.
           partner_accepted_at = CASE WHEN p_player_id IS NOT NULL THEN NOW() END,
           respond_by = NULL,
           status = CASE WHEN status IN ('sem_parceiro', 'convite')
                         THEN CASE WHEN validated_at IS NOT NULL THEN 'validada' ELSE 'por_validar' END
                         ELSE status END
     WHERE id = p_entry_id
    RETURNING status INTO v_status;
  END IF;

  RETURN jsonb_build_object('entry_id', p_entry_id, 'status', v_status, 'invite_token', v_token);
END;
$$;

REVOKE ALL ON FUNCTION public.tournament_admin_replace_player(UUID, INTEGER, UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tournament_admin_replace_player(UUID, INTEGER, UUID, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.tournament_admin_replace_player(UUID, INTEGER, UUID, TEXT, TEXT, TEXT) TO authenticated;

-- ── 2. Confirmação ──────────────────────────────────────────────────────
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.tournament_admin_replace_player(uuid, integer, uuid, text, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon ainda pode chamar tournament_admin_replace_player. Parar e ler.';
  END IF;
  RAISE NOTICE '#434: tournament_admin_replace_player pronta.';
END $$;
