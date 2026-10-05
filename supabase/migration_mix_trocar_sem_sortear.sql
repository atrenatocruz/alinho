-- ═════════════════════════════════════════════════════════════════════════
-- Mix: trocar uma pessoa com as duplas feitas, sem voltar a sortear
--
-- PORQUÊ. Ponto 17 do pacote do mix (design-handoff/2026-09-30-mix-ver-e-
-- marcar/PACOTE.md), aprovado pelo Francisco a 2 out («é basicamente
-- substituição do elemento mesmo depois de fechadas as equipas»). Até aqui,
-- qualquer entrada ou saída depois do sorteio apagava as duplas
-- (migration_mix_duplas_sorteadas_reset.sql). Ecrã: Dev 2. NÃO enviar antes
-- de o PO dizer que o main de 2 out saiu.
--
-- O QUE FAZ (vale até a Ronda 1 começar: duplas feitas e mix aberto/cheio
-- sem jogos, ou já começado com round_started_at vazio e sem resultados)
--   1. teams aceita um lugar vazio (os dois campos do lugar a null): é o
--      «Falta 1» do ecrã.
--   2. swap_mix_player(p_game_id, p_team_id, p_out_id, p_in_user_id,
--      p_in_guest_name): quem organiza troca quem sai (conta ou convidado;
--      null = o lugar vazio dessa dupla) por quem entra (um suplente
--      sozinho, alguém do clube/grupo ou do clube de cima, ou um convidado
--      só com o nome). Quem entra fica no MESMO lugar; as outras duplas não
--      mudam. Quem sai recebe 'mix_swapped_out' {game_title, game_date}.
--      Erros: not_allowed, round_started, bad_input, not_in_team,
--      already_in_mix, in_pair, not_member.
--   3. As duplas acertam-se sozinhas a cada inscrição que muda
--      (participants_reset_drawn_teams → mix_reconcile_teams):
--        · quem deixou de estar confirmado sai do seu lugar;
--        · quem está confirmado e sem lugar ocupa um lugar vazio (uma dupla
--          precisa de uma dupla vazia; ao lado do parceiro, se der);
--        · sem lugar para alguém: com o mix por começar, as duplas voltam a
--          «por sortear», como antes; já começado, fica como está;
--        · lugar que fica vazio → 'mix_slot_open' {game_title, game_date,
--          team_id} a quem criou o mix (sem criador, aos admins do clube).
--      Quem sai pela app: o promote_waitlist sobe o 1.º suplente, que fica
--      no lugar de quem saiu.
--   4. promote_waitlist sobe o 1.º suplente QUE CAIBA: com 1 lugar livre,
--      uma dupla em espera não passa à frente e sobe o 1.º sozinho. Até
--      aqui subia a dupla e o mix ficava com uma pessoa a mais (vale para
--      todos os mixes, com ou sem duplas).
--   5. Menos campos com as duplas feitas → voltam a «por sortear» (em
--      games_capacity_changed, da migration_mix_suplentes.sql).
--   6. Trava: começar o mix ou uma ronda com uma dupla incompleta dá
--      'team_incomplete' (o ecrã já não deixa; isto é para quem chame
--      direto).
--
-- Ordem: depois da migration_mix_suplentes.sql (recusa correr sem ela).
-- Dev 3, 2 out 2026 · ecrã: Dev 2
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$ BEGIN
  IF to_regprocedure('public.games_capacity_changed()') IS NULL THEN
    RAISE EXCEPTION 'Correr primeiro a migration_mix_suplentes.sql.';
  END IF;
END $$;

-- ── 1. Lugar vazio numa dupla ───────────────────────────────────────────
ALTER TABLE teams DROP CONSTRAINT IF EXISTS teams_p1_one;
ALTER TABLE teams ADD CONSTRAINT teams_p1_one CHECK (player1_id IS NULL OR player1_guest_id IS NULL);
ALTER TABLE teams DROP CONSTRAINT IF EXISTS teams_p2_one;
ALTER TABLE teams ADD CONSTRAINT teams_p2_one CHECK (player2_id IS NULL OR player2_guest_id IS NULL);

-- ── Ainda se pode mexer nas duplas? ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mix_teams_editable(p_game_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM games g
     WHERE g.id = p_game_id
       AND EXISTS (SELECT 1 FROM teams t WHERE t.game_id = g.id)
       AND ((g.status IN ('open', 'closed')
             AND NOT EXISTS (SELECT 1 FROM matches m WHERE m.game_id = g.id))
         OR (g.status = 'in_progress' AND g.round_started_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM matches m WHERE m.game_id = g.id
                              AND (m.score_a IS NOT NULL OR m.score_b IS NOT NULL)))));
$function$;
REVOKE EXECUTE ON FUNCTION public.mix_teams_editable(UUID) FROM PUBLIC, anon, authenticated;

-- ── 3. Acertar as duplas com quem está confirmado ───────────────────────
CREATE OR REPLACE FUNCTION public.mix_reconcile_teams(p_game_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  g         games%ROWTYPE;
  t         RECORD;
  r         RECORD;
  v_cleared UUID[] := '{}';
  v_people  UUID[];
  v_guest   BOOLEAN[];
  v_x       UUID;
  v_is_g    BOOLEAN;
  v_mate    UUID;
  v_team    UUID;
  v_seat    INTEGER;
  i         INTEGER;
BEGIN
  IF NOT mix_teams_editable(p_game_id) THEN RETURN; END IF;
  SELECT * INTO g FROM games WHERE id = p_game_id;

  -- Quem deixou de estar confirmado sai do seu lugar.
  FOR t IN SELECT * FROM teams WHERE game_id = p_game_id ORDER BY created_at, id LOOP
    IF COALESCE(t.player1_id, t.player1_guest_id) IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM participants p
                        WHERE p.game_id = p_game_id AND p.status = 'confirmed'
                          AND COALESCE(t.player1_id, t.player1_guest_id) IN (p.user_id, p.guest_id, p.partner_id, p.partner_guest_id)) THEN
      UPDATE teams SET player1_id = NULL, player1_guest_id = NULL WHERE id = t.id;
      v_cleared := v_cleared || t.id;
    END IF;
    IF COALESCE(t.player2_id, t.player2_guest_id) IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM participants p
                        WHERE p.game_id = p_game_id AND p.status = 'confirmed'
                          AND COALESCE(t.player2_id, t.player2_guest_id) IN (p.user_id, p.guest_id, p.partner_id, p.partner_guest_id)) THEN
      UPDATE teams SET player2_id = NULL, player2_guest_id = NULL WHERE id = t.id;
      v_cleared := v_cleared || t.id;
    END IF;
  END LOOP;

  -- Quem está confirmado e sem lugar ocupa um lugar vazio, por ordem de chegada.
  FOR r IN SELECT * FROM participants WHERE game_id = p_game_id AND status = 'confirmed'
            ORDER BY created_at, id LOOP
    v_people := ARRAY[COALESCE(r.user_id, r.guest_id), COALESCE(r.partner_id, r.partner_guest_id)];
    v_guest  := ARRAY[r.user_id IS NULL, r.partner_id IS NULL];
    -- Uma dupla em que nenhum dos dois tem lugar precisa de uma dupla vazia.
    IF v_people[2] IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM teams WHERE game_id = p_game_id
                        AND (v_people[1] IN (player1_id, player1_guest_id, player2_id, player2_guest_id)
                          OR v_people[2] IN (player1_id, player1_guest_id, player2_id, player2_guest_id))) THEN
      SELECT id INTO v_team FROM teams
       WHERE game_id = p_game_id
         AND player1_id IS NULL AND player1_guest_id IS NULL
         AND player2_id IS NULL AND player2_guest_id IS NULL
       ORDER BY created_at, id LIMIT 1;
      IF v_team IS NULL THEN
        IF g.status IN ('open', 'closed') THEN DELETE FROM teams WHERE game_id = p_game_id; END IF;
        RETURN;
      END IF;
      UPDATE teams SET
        player1_id = CASE WHEN v_guest[1] THEN NULL ELSE v_people[1] END,
        player1_guest_id = CASE WHEN v_guest[1] THEN v_people[1] END,
        player2_id = CASE WHEN v_guest[2] THEN NULL ELSE v_people[2] END,
        player2_guest_id = CASE WHEN v_guest[2] THEN v_people[2] END
       WHERE id = v_team;
      CONTINUE;
    END IF;

    FOR i IN 1..2 LOOP
      v_x := v_people[i];
      v_is_g := v_guest[i];
      CONTINUE WHEN v_x IS NULL;
      CONTINUE WHEN EXISTS (SELECT 1 FROM teams WHERE game_id = p_game_id
                             AND v_x IN (player1_id, player1_guest_id, player2_id, player2_guest_id));
      -- Ao lado do parceiro, se esse lugar estiver vazio; senão, o 1.º lugar vazio.
      v_mate := v_people[3 - i];
      v_team := NULL;
      IF v_mate IS NOT NULL THEN
        SELECT id, CASE WHEN v_mate IN (player1_id, player1_guest_id) THEN 2 ELSE 1 END
          INTO v_team, v_seat
          FROM teams
         WHERE game_id = p_game_id
           AND ((v_mate IN (player1_id, player1_guest_id) AND player2_id IS NULL AND player2_guest_id IS NULL)
             OR (v_mate IN (player2_id, player2_guest_id) AND player1_id IS NULL AND player1_guest_id IS NULL))
         LIMIT 1;
      END IF;
      IF v_team IS NULL THEN
        SELECT id, CASE WHEN player1_id IS NULL AND player1_guest_id IS NULL THEN 1 ELSE 2 END
          INTO v_team, v_seat
          FROM teams
         WHERE game_id = p_game_id
           AND ((player1_id IS NULL AND player1_guest_id IS NULL) OR (player2_id IS NULL AND player2_guest_id IS NULL))
         ORDER BY created_at, id LIMIT 1;
      END IF;
      IF v_team IS NULL THEN
        -- Sem lugar: por começar, volta a «por sortear» (como antes); já começado, fica.
        IF g.status IN ('open', 'closed') THEN DELETE FROM teams WHERE game_id = p_game_id; END IF;
        RETURN;
      END IF;
      IF v_seat = 1 THEN
        UPDATE teams SET player1_id = CASE WHEN v_is_g THEN NULL ELSE v_x END,
                         player1_guest_id = CASE WHEN v_is_g THEN v_x END WHERE id = v_team;
      ELSE
        UPDATE teams SET player2_id = CASE WHEN v_is_g THEN NULL ELSE v_x END,
                         player2_guest_id = CASE WHEN v_is_g THEN v_x END WHERE id = v_team;
      END IF;
    END LOOP;
  END LOOP;

  -- Lugar que ficou vazio agora → aviso a quem organiza (uma vez por dupla).
  INSERT INTO notifications (user_id, kind, game_id, data)
  SELECT who.u, 'mix_slot_open', g.id,
         jsonb_build_object('game_title', g.title, 'game_date', g.date, 'team_id', tm.id)
    FROM teams tm
    CROSS JOIN (
      SELECT g.created_by AS u WHERE g.created_by IS NOT NULL
      UNION
      SELECT m.user_id FROM memberships m
       WHERE g.created_by IS NULL AND m.organization_id = g.organization_id AND m.is_admin
    ) who
   WHERE tm.id IN (SELECT DISTINCT unnest(v_cleared))
     AND ((tm.player1_id IS NULL AND tm.player1_guest_id IS NULL)
       OR (tm.player2_id IS NULL AND tm.player2_guest_id IS NULL))
     AND who.u IS NOT NULL;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.mix_reconcile_teams(UUID) FROM PUBLIC, anon, authenticated;

-- O gatilho de 27 set (apagava as duplas a cada mudança) passa a acertá-las.
-- Corpo VIVO conferido antes de trocar: tem de ser ainda o de 27 set.
DO $$
DECLARE
  v_def TEXT := pg_get_functiondef('public.participants_reset_drawn_teams()'::regprocedure);
BEGIN
  IF v_def LIKE '%mix_reconcile_teams%' THEN
    RAISE NOTICE 'participants_reset_drawn_teams: já estava';
    RETURN;
  END IF;
  IF v_def NOT LIKE '%DELETE FROM teams WHERE game_id = v_game;%' OR (SELECT count(*) FROM regexp_matches(v_def, 'DELETE FROM', 'g')) <> 1 THEN
    RAISE EXCEPTION 'participants_reset_drawn_teams: o corpo vivo não é o de 27 set. Parar e ler.';
  END IF;
  EXECUTE $f$
CREATE OR REPLACE FUNCTION public.participants_reset_drawn_teams()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  -- O swap_mix_player acerta as duplas ele mesmo, no fim.
  IF COALESCE(current_setting('alinho.mix_swap', true), '') = 'on' THEN
    RETURN NULL;
  END IF;
  PERFORM mix_reconcile_teams(COALESCE(NEW.game_id, OLD.game_id));
  RETURN NULL;
END;
$function$;
$f$;
END $$;
REVOKE EXECUTE ON FUNCTION public.participants_reset_drawn_teams() FROM PUBLIC, anon, authenticated;

-- ── 4. Sobe o 1.º suplente que caiba (corpo VIVO, 1 troca; «já estava») ──
DO $$
DECLARE
  c_mau CONSTANT TEXT := '(WHERE game_id = p_game_id AND status = ''waitlisted'')';
  c_bom CONSTANT TEXT := '\1
       AND 1 + CASE WHEN partner_id IS NOT NULL OR partner_guest_id IS NOT NULL THEN 1 ELSE 0 END <= cap - people';
  v_def TEXT := pg_get_functiondef('public.promote_waitlist(uuid)'::regprocedure);
BEGIN
  IF v_def LIKE '%<= cap - people%' THEN
    RAISE NOTICE 'promote_waitlist: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'promote_waitlist: o pedaço a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE regexp_replace(v_def, c_mau, c_bom);
END $$;

-- ── 5. Menos campos com as duplas feitas → por sortear (corpo VIVO) ─────
DO $$
DECLARE
  c_mau CONSTANT TEXT := '(  SELECT COALESCE\(SUM\(1 \+ CASE WHEN partner_id IS NOT NULL OR partner_guest_id IS NOT NULL THEN 1 ELSE 0 END\), 0\)[[:space:]]+INTO v_people)';
  c_bom CONSTANT TEXT := '  -- Ponto 17: com menos campos, as duplas voltam a «por sortear».
  IF NEW.status IN (''open'', ''closed'') AND NOT EXISTS (SELECT 1 FROM matches WHERE game_id = NEW.id) THEN
    DELETE FROM teams WHERE game_id = NEW.id;
  END IF;

\1';
  v_def TEXT := pg_get_functiondef('public.games_capacity_changed()'::regprocedure);
BEGIN
  IF v_def LIKE '%Ponto 17%' THEN
    RAISE NOTICE 'games_capacity_changed: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'games_capacity_changed: o pedaço a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE regexp_replace(v_def, c_mau, c_bom);
END $$;

-- ── 6. Não se começa com uma dupla incompleta ───────────────────────────
CREATE OR REPLACE FUNCTION public.games_teams_complete_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF ((NEW.status = 'in_progress' AND OLD.status IS DISTINCT FROM 'in_progress')
      OR (NEW.round_started_at IS NOT NULL AND OLD.round_started_at IS NULL))
     AND EXISTS (SELECT 1 FROM teams t
                  WHERE t.game_id = NEW.id
                    AND ((t.player1_id IS NULL AND t.player1_guest_id IS NULL)
                      OR (t.player2_id IS NULL AND t.player2_guest_id IS NULL))) THEN
    RAISE EXCEPTION 'team_incomplete' USING ERRCODE = 'P0001',
      DETAIL = 'Falta um jogador numa dupla: troca-o para começar.';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.games_teams_complete_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS games_teams_complete_guard_trigger ON games;
CREATE TRIGGER games_teams_complete_guard_trigger
  BEFORE UPDATE OF status, round_started_at ON games
  FOR EACH ROW EXECUTE FUNCTION games_teams_complete_guard();

-- ── 2. Trocar uma pessoa ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.swap_mix_player(
  p_game_id UUID,
  p_team_id UUID,
  p_out_id UUID DEFAULT NULL,
  p_in_user_id UUID DEFAULT NULL,
  p_in_guest_name TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  g        games%ROWTYPE;
  t        teams%ROWTYPE;
  v_name   TEXT := NULLIF(btrim(p_in_guest_name), '');
  v_seat   INTEGER;
  v_in     UUID;
  v_in_g   BOOLEAN;
  v_in_row participants%ROWTYPE;
  v_out    participants%ROWTYPE;
BEGIN
  SELECT * INTO g FROM games WHERE id = p_game_id FOR UPDATE;
  IF g.id IS NULL OR auth.uid() IS NULL OR NOT is_org_admin(g.organization_id) THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  IF NOT mix_teams_editable(g.id) THEN RAISE EXCEPTION 'round_started'; END IF;
  IF (p_in_user_id IS NULL) = (v_name IS NULL) THEN RAISE EXCEPTION 'bad_input'; END IF;

  SELECT * INTO t FROM teams WHERE id = p_team_id AND game_id = g.id FOR UPDATE;
  IF t.id IS NULL THEN RAISE EXCEPTION 'not_in_team'; END IF;
  IF p_out_id IS NOT NULL THEN
    v_seat := CASE WHEN p_out_id IN (t.player1_id, t.player1_guest_id) THEN 1
                   WHEN p_out_id IN (t.player2_id, t.player2_guest_id) THEN 2 END;
  ELSE
    v_seat := CASE WHEN t.player1_id IS NULL AND t.player1_guest_id IS NULL THEN 1
                   WHEN t.player2_id IS NULL AND t.player2_guest_id IS NULL THEN 2 END;
  END IF;
  IF v_seat IS NULL THEN RAISE EXCEPTION 'not_in_team'; END IF;

  -- Quem entra.
  IF p_in_user_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM participants WHERE game_id = g.id AND status = 'confirmed'
                AND p_in_user_id IN (user_id, partner_id)) THEN
      RAISE EXCEPTION 'already_in_mix';
    END IF;
    SELECT * INTO v_in_row FROM participants
     WHERE game_id = g.id AND p_in_user_id IN (user_id, partner_id) LIMIT 1;
    IF v_in_row.id IS NOT NULL AND (v_in_row.partner_id IS NOT NULL OR v_in_row.partner_guest_id IS NOT NULL) THEN
      RAISE EXCEPTION 'in_pair';
    END IF;
    IF v_in_row.id IS NULL AND NOT EXISTS (
         SELECT 1 FROM memberships m JOIN organizations o ON o.id = g.organization_id
          WHERE m.user_id = p_in_user_id AND m.organization_id IN (o.id, o.parent_organization_id)) THEN
      RAISE EXCEPTION 'not_member';
    END IF;
    v_in := p_in_user_id;
    v_in_g := FALSE;
  ELSE
    INSERT INTO game_guests (game_id, name) VALUES (g.id, v_name) RETURNING id INTO v_in;
    v_in_g := TRUE;
  END IF;

  IF p_out_id IS NOT NULL THEN
    SELECT * INTO v_out FROM participants
     WHERE game_id = g.id AND status = 'confirmed'
       AND p_out_id IN (user_id, guest_id, partner_id, partner_guest_id)
     LIMIT 1;
  END IF;

  -- As duplas acertam-se no fim, de uma vez.
  PERFORM set_config('alinho.mix_swap', 'on', true);

  IF v_seat = 1 THEN
    UPDATE teams SET player1_id = CASE WHEN v_in_g THEN NULL ELSE v_in END,
                     player1_guest_id = CASE WHEN v_in_g THEN v_in END WHERE id = t.id;
  ELSE
    UPDATE teams SET player2_id = CASE WHEN v_in_g THEN NULL ELSE v_in END,
                     player2_guest_id = CASE WHEN v_in_g THEN v_in END WHERE id = t.id;
  END IF;

  IF v_out.id IS NOT NULL AND (v_out.partner_id IS NOT NULL OR v_out.partner_guest_id IS NOT NULL) THEN
    -- Quem sai estava inscrito em dupla: quem entra fica nessa inscrição.
    IF v_in_row.id IS NOT NULL THEN
      DELETE FROM participants WHERE id = v_in_row.id;
      INSERT INTO notifications (user_id, kind, game_id, data)
      VALUES (v_in, 'mix_promoted', g.id, jsonb_build_object('game_title', g.title, 'game_date', g.date));
    END IF;
    IF p_out_id IN (v_out.user_id, v_out.guest_id) THEN
      UPDATE participants SET user_id = CASE WHEN v_in_g THEN NULL ELSE v_in END,
                              guest_id = CASE WHEN v_in_g THEN v_in END
       WHERE id = v_out.id;
    ELSE
      UPDATE participants SET partner_id = CASE WHEN v_in_g THEN NULL ELSE v_in END,
                              partner_guest_id = CASE WHEN v_in_g THEN v_in END
       WHERE id = v_out.id;
    END IF;
  ELSE
    -- Quem entra primeiro (o mix não fica com um lugar livre a meio, e o
    -- promote_waitlist não sobe mais ninguém); depois sai quem sai.
    IF v_in_row.id IS NOT NULL THEN
      UPDATE participants SET status = 'confirmed' WHERE id = v_in_row.id;
    ELSIF v_in_g THEN
      INSERT INTO participants (game_id, guest_id, status) VALUES (g.id, v_in, 'confirmed');
    ELSE
      INSERT INTO participants (game_id, user_id, status) VALUES (g.id, v_in, 'confirmed');
    END IF;
    IF v_out.id IS NOT NULL THEN
      DELETE FROM participants WHERE id = v_out.id;
    END IF;
  END IF;

  IF p_out_id IS NOT NULL AND EXISTS (SELECT 1 FROM profiles WHERE id = p_out_id) THEN
    INSERT INTO notifications (user_id, kind, game_id, actor_id, data)
    VALUES (p_out_id, 'mix_swapped_out', g.id, auth.uid(),
            jsonb_build_object('game_title', g.title, 'game_date', g.date));
  END IF;

  PERFORM set_config('alinho.mix_swap', '', true);
  PERFORM mix_reconcile_teams(g.id);
END;
$function$;
REVOKE ALL ON FUNCTION public.swap_mix_player(UUID, UUID, UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.swap_mix_player(UUID, UUID, UUID, UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.swap_mix_player(UUID, UUID, UUID, UUID, TEXT) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_functiondef('public.participants_reset_drawn_teams()'::regprocedure) LIKE '%mix_reconcile_teams%';  -- true
--   SELECT pg_get_functiondef('public.promote_waitlist(uuid)'::regprocedure) LIKE '%<= cap - people%';             -- true
--   SELECT pg_get_functiondef('public.games_capacity_changed()'::regprocedure) LIKE '%Ponto 17%';                  -- true
--   SELECT has_function_privilege('anon', 'public.swap_mix_player(uuid,uuid,uuid,uuid,text)', 'EXECUTE');         -- false
--   SELECT has_function_privilege('authenticated', 'public.mix_reconcile_teams(uuid)', 'EXECUTE');               -- false
