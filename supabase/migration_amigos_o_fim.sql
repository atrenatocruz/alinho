-- ═════════════════════════════════════════════════════════════════════════
-- Amigos: «O fim» — enviar, contar uma vez por par de duplas, rejeitar e
-- corrigir
--
-- PORQUÊ. Plano aprovado pelo Francisco a 9 out (com as rondas só com
-- convidados); regras em design-handoff/2026-10-07-amigos-a-jogar/RANKING-
-- PROPOSTA.md (Francisco e Ruben, 8 out; rejeição: Francisco, 10 out) e
-- design-handoff/2026-10-09-amigos-o-fim/SPEC.md (substitui o «Terminar e
-- enviar» de 30 set). Ecrãs: Bugs. Nomes combinados com ele.
--
-- A REGRA
--   · Até ao «Terminar e enviar» nada conta, e as rondas mudam-se à vontade.
--   · Ao enviar, cada PAR de duplas diferente (A+B contra C+D, venham as
--     rondas por que ordem vierem) conta UMA vez, como um jogo:
--       ganha quem ganhou mais rondas; com rondas empatadas, quem fez mais
--       jogos nas rondas de set; se o par não teve rondas de set, quem fez
--       mais pontos; com tudo igual, fica amigável (sem pontos).
--   · Só conta se os quatro desse par têm conta, aceitaram o convite com o
--     nome e o jogo é para o ranking. Se o último aceitar depois do envio,
--     conta nesse momento. Um par com convidados, «só amigável» ou empate
--     não conta (dá na mesma a XP de jogar a quem tem conta).
--   · «Está certo» só fica registado (sem resposta, conta).
--   · «Não está certo»: o jogo sai do ranking — os pontos desses jogos
--     voltam atrás (só os desse jogo, sem recalcular os seguintes) — e
--     fica guardado o que a pessoa propôs e a nota. Quem enviou corrige e
--     volta a enviar: conta de novo e todos recebem outra vez o aviso.
--   · Depois de enviado, as rondas não mudam (só pelo «Corrigir»).
--
-- COMO SE GUARDA. Cada par que conta (ou que é amigável com alguém com
-- conta) fica como um jogo entre amigos «clássico» em private_matches, com
-- friend_pair_of = o jogo e pair_key = o par, o resultado em rondas (3-1) e
-- o vencedor do par. Assim o nível (apply_elo_pairing, a conta do Ruben),
-- os pontos do grupo (private_match_group_stats), a XP, as conquistas, o
-- histórico e os confrontos diretos continuam a funcionar como hoje, mas
-- uma vez por par e não por ronda. As rondas deixam de contar uma a uma
-- (sai o gatilho friend_match_apply_game_trigger).
--
-- O QUE FAZ
--   1. Colunas: private_matches.friend_pair_of / pair_key (o par) e, na
--      raiz, result_sent_by / result_sent_at / result_rejected_by /
--      result_rejected_at / result_rejected_note / result_rejected_rounds;
--      private_match_invitees.result_ok_at.
--   2. friend_match_pair_rows / friend_match_reconcile / friend_match_uncount
--      (internas): os pares, contar e descontar.
--   3. finish_friend_match, confirm_friend_match_result,
--      reject_friend_match_result, correct_friend_match_result.
--   4. Avisos 'friend_match_result_sent' {match_id, sender_name,
--      scheduled_date, pairs_count, my_rounds, their_rounds, outcome} e
--      'friend_match_result_rejected' {match_id, name, note}.
--   5. Gatilhos: depois de enviado, as rondas não mudam (salvo pelo
--      «Corrigir» e por quem fica com um lugar de convidado); aceitar o
--      convite ou ficar com o lugar depois do envio volta a contar; apagar
--      o jogo desconta antes.
--   6. Leituras: get_friend_match (ranking_state, sent_by, rejected_by,
--      pairs, games_counted, waiting_for), list_my_friend_sessions (todos os
--      meus jogos, por enviar e histórico), list_played_events (os pontos
--      dos amigos contam pelo par), get_my_private_matches (não mostra os
--      pares como jogos à parte).
--
-- Em produção: 0 jogos entre amigos (lido a 8 out), nada a refazer.
-- No alinho-dev há rondas antigas que já contaram ronda a ronda (o gatilho
-- que sai): ficam como estão, e um envio novo dessas sessões contaria por
-- cima. Para testar, usar sessões novas (Dev 2, revisão de 12 out).
-- Descontar repõe o nível tirando o delta (como a correção dos mixes): quem
-- não tinha nível (NULL) antes do 1.º jogo fica com 900 e não volta a NULL.
-- Um par rejeitado e corrigido mais tarde volta a contar com o nível e o
-- número de jogos de HOJE, e não com os da altura (ex.: quem entretanto
-- passou os 10 jogos já não tem o K a dobrar). É de propósito: a regra é
-- «volta só o desse jogo, sem recalcular os outros» (ensaio do Dev 2).
-- Ordem: depois da migration_amigos_so_convidados.sql.
-- Dev 3, 12 out 2026 · ecrãs: Bugs
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'private_matches' AND column_name = 'team_a_player1_guest_name') THEN
    RAISE EXCEPTION 'Correr primeiro a migration_amigos_so_convidados.sql.';
  END IF;
END $$;

-- ── 1. Colunas ──────────────────────────────────────────────────────────
ALTER TABLE private_matches ADD COLUMN IF NOT EXISTS friend_pair_of UUID REFERENCES private_matches(id) ON DELETE CASCADE;
ALTER TABLE private_matches ADD COLUMN IF NOT EXISTS pair_key TEXT;
ALTER TABLE private_matches ADD COLUMN IF NOT EXISTS result_sent_by UUID REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE private_matches ADD COLUMN IF NOT EXISTS result_sent_at TIMESTAMPTZ;
ALTER TABLE private_matches ADD COLUMN IF NOT EXISTS result_rejected_by UUID REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE private_matches ADD COLUMN IF NOT EXISTS result_rejected_at TIMESTAMPTZ;
ALTER TABLE private_matches ADD COLUMN IF NOT EXISTS result_rejected_note TEXT;
ALTER TABLE private_matches ADD COLUMN IF NOT EXISTS result_rejected_rounds JSONB;
ALTER TABLE private_match_invitees ADD COLUMN IF NOT EXISTS result_ok_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS private_matches_friend_pair_uniq ON private_matches (friend_pair_of, pair_key) WHERE friend_pair_of IS NOT NULL;

-- As rondas deixam de contar uma a uma: passa a contar o par, ao enviar.
DROP TRIGGER IF EXISTS friend_match_apply_game_trigger ON private_matches;

-- ── 2a. Os pares de um jogo ─────────────────────────────────────────────
-- Uma linha por par de duplas, com o resultado na orientação do par (a
-- dupla «A» é a de chave menor).
CREATE OR REPLACE FUNCTION public.friend_match_pair_rows(p_root UUID)
RETURNS TABLE(pair_key TEXT, first_round UUID,
              a1 UUID, a1g TEXT, a2 UUID, a2g TEXT, b1 UUID, b1g TEXT, b2 UUID, b2g TEXT,
              rounds_a INTEGER, rounds_b INTEGER, games_a INTEGER, games_b INTEGER, winner TEXT,
              all_accounts BOOLEAN, all_accepted BOOLEAN, pending_people UUID[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH r AS (
    SELECT m.id, m.round_number, m.court_number, m.created_at, m.round_kind, m.score_a, m.score_b,
           ARRAY[COALESCE(m.team_a_player1_id::text, 'g:' || lower(btrim(m.team_a_player1_guest_name))),
                 COALESCE(m.team_a_player2_id::text, 'g:' || lower(btrim(m.team_a_player2_guest_name)))] AS ka,
           ARRAY[COALESCE(m.team_b_player1_id::text, 'g:' || lower(btrim(m.team_b_player1_guest_name))),
                 COALESCE(m.team_b_player2_id::text, 'g:' || lower(btrim(m.team_b_player2_guest_name)))] AS kb,
           m.team_a_player1_id, m.team_a_player1_guest_name, m.team_a_player2_id, m.team_a_player2_guest_name,
           m.team_b_player1_id, m.team_b_player1_guest_name, m.team_b_player2_id, m.team_b_player2_guest_name
      FROM private_matches m
     WHERE (m.id = p_root OR m.session_id = p_root)
       AND m.score_a IS NOT NULL AND m.score_b IS NOT NULL AND m.winner_team IS NOT NULL
  ), t AS (
    SELECT r.*,
           least(ka[1], ka[2]) || '+' || greatest(ka[1], ka[2]) AS team_a_key,
           least(kb[1], kb[2]) || '+' || greatest(kb[1], kb[2]) AS team_b_key
      FROM r
  ), o AS (
    -- Orientado: «A» é a dupla de chave menor; se não estava do lado A, troca.
    SELECT t.*,
           (t.team_a_key <= t.team_b_key) AS a_left,
           least(t.team_a_key, t.team_b_key) || ' x ' || greatest(t.team_a_key, t.team_b_key) AS pkey
      FROM t
  ), s AS (
    SELECT o.pkey, o.id, o.round_number, o.court_number, o.created_at, o.round_kind,
           CASE WHEN o.a_left THEN o.score_a ELSE o.score_b END AS sa,
           CASE WHEN o.a_left THEN o.score_b ELSE o.score_a END AS sb,
           CASE WHEN o.a_left THEN o.team_a_player1_id ELSE o.team_b_player1_id END AS a1,
           CASE WHEN o.a_left THEN o.team_a_player1_guest_name ELSE o.team_b_player1_guest_name END AS a1g,
           CASE WHEN o.a_left THEN o.team_a_player2_id ELSE o.team_b_player2_id END AS a2,
           CASE WHEN o.a_left THEN o.team_a_player2_guest_name ELSE o.team_b_player2_guest_name END AS a2g,
           CASE WHEN o.a_left THEN o.team_b_player1_id ELSE o.team_a_player1_id END AS b1,
           CASE WHEN o.a_left THEN o.team_b_player1_guest_name ELSE o.team_a_player1_guest_name END AS b1g,
           CASE WHEN o.a_left THEN o.team_b_player2_id ELSE o.team_a_player2_id END AS b2,
           CASE WHEN o.a_left THEN o.team_b_player2_guest_name ELSE o.team_a_player2_guest_name END AS b2g
      FROM o
  ), g AS (
    SELECT s.pkey,
           (array_agg(s.id ORDER BY s.round_number, s.court_number, s.created_at))[1] AS first_round,
           (array_agg(s.a1 ORDER BY s.round_number, s.court_number))[1] AS a1,
           (array_agg(s.a1g ORDER BY s.round_number, s.court_number))[1] AS a1g,
           (array_agg(s.a2 ORDER BY s.round_number, s.court_number))[1] AS a2,
           (array_agg(s.a2g ORDER BY s.round_number, s.court_number))[1] AS a2g,
           (array_agg(s.b1 ORDER BY s.round_number, s.court_number))[1] AS b1,
           (array_agg(s.b1g ORDER BY s.round_number, s.court_number))[1] AS b1g,
           (array_agg(s.b2 ORDER BY s.round_number, s.court_number))[1] AS b2,
           (array_agg(s.b2g ORDER BY s.round_number, s.court_number))[1] AS b2g,
           count(*) FILTER (WHERE s.sa > s.sb)::int AS rounds_a,
           count(*) FILTER (WHERE s.sb > s.sa)::int AS rounds_b,
           bool_or(s.round_kind = 'set') AS has_sets,
           COALESCE(sum(s.sa) FILTER (WHERE s.round_kind = 'set'), 0)::int AS set_a,
           COALESCE(sum(s.sb) FILTER (WHERE s.round_kind = 'set'), 0)::int AS set_b,
           COALESCE(sum(s.sa), 0)::int AS all_a,
           COALESCE(sum(s.sb), 0)::int AS all_b
      FROM s GROUP BY s.pkey
  ), root AS (
    SELECT ranked_intent FROM private_matches WHERE id = p_root
  )
  SELECT g.pkey, g.first_round, g.a1, g.a1g, g.a2, g.a2g, g.b1, g.b1g, g.b2, g.b2g,
         g.rounds_a, g.rounds_b,
         CASE WHEN g.has_sets THEN g.set_a ELSE g.all_a END,
         CASE WHEN g.has_sets THEN g.set_b ELSE g.all_b END,
         CASE WHEN g.rounds_a > g.rounds_b THEN 'a' WHEN g.rounds_b > g.rounds_a THEN 'b'
              WHEN (CASE WHEN g.has_sets THEN g.set_a ELSE g.all_a END) > (CASE WHEN g.has_sets THEN g.set_b ELSE g.all_b END) THEN 'a'
              WHEN (CASE WHEN g.has_sets THEN g.set_b ELSE g.all_b END) > (CASE WHEN g.has_sets THEN g.set_a ELSE g.all_a END) THEN 'b'
              ELSE 'draw' END,
         (g.a1 IS NOT NULL AND g.a2 IS NOT NULL AND g.b1 IS NOT NULL AND g.b2 IS NOT NULL),
         (g.a1 IS NOT NULL AND g.a2 IS NOT NULL AND g.b1 IS NOT NULL AND g.b2 IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY[g.a1, g.a2, g.b1, g.b2]) u(id)
                           WHERE NOT EXISTS (SELECT 1 FROM private_match_invitees i
                                              WHERE i.match_id = p_root AND i.user_id = u.id
                                                AND i.status = 'accepted' AND NOT COALESCE(i.is_anonymous, FALSE)))),
         ARRAY(SELECT u.id FROM unnest(ARRAY[g.a1, g.a2, g.b1, g.b2]) u(id)
                WHERE u.id IS NOT NULL
                  AND EXISTS (SELECT 1 FROM private_match_invitees i
                               WHERE i.match_id = p_root AND i.user_id = u.id AND i.status = 'pending'))
    FROM g;
$function$;
REVOKE ALL ON FUNCTION public.friend_match_pair_rows(UUID) FROM PUBLIC, anon, authenticated;

-- ── 2b. Descontar um par (ou todos) ─────────────────────────────────────
-- Volta atrás o que o par deu: nível (só o deste jogo, sem recalcular os
-- seguintes — Francisco, 10 out), pontos do grupo e XP. As conquistas
-- ficam (como nos mixes).
CREATE OR REPLACE FUNCTION public.friend_match_uncount(p_root UUID, p_pair_key TEXT DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  p      private_matches%ROWTYPE;
  v_rules JSONB;
  s      RECORD;
  v_n    INTEGER := 0;
BEGIN
  FOR p IN SELECT * FROM private_matches
            WHERE friend_pair_of = p_root AND (p_pair_key IS NULL OR pair_key = p_pair_key) FOR UPDATE LOOP
    -- Nível.
    UPDATE profiles pr
       SET rating = GREATEST(0, COALESCE(pr.rating, 900) - st.rating_delta),
           rating_games = GREATEST(0, COALESCE(pr.rating_games, 0) - 1)
      FROM private_match_stats st
     WHERE st.private_match_id = p.id AND st.user_id = pr.id AND st.rating_delta IS NOT NULL;
    -- Pontos do grupo (a mesma conta do private_match_group_stats).
    IF p.group_stats_applied_at IS NOT NULL AND p.organization_id IS NOT NULL THEN
      SELECT points_rules INTO v_rules FROM organizations WHERE id = p.organization_id;
      v_rules := COALESCE(v_rules, '{"point_per_match_played": 1, "point_per_match_win": 3}'::jsonb);
      FOR s IN SELECT * FROM (VALUES ('a', p.team_a_player1_id), ('a', p.team_a_player2_id),
                                     ('b', p.team_b_player1_id), ('b', p.team_b_player2_id)) AS t(team, pid)
                WHERE t.pid IS NOT NULL LOOP
        UPDATE player_stats ps SET
          game_wins    = GREATEST(0, ps.game_wins - CASE WHEN p.winner_team = s.team THEN 1 ELSE 0 END),
          game_losses  = GREATEST(0, ps.game_losses - CASE WHEN p.winner_team NOT IN (s.team, 'draw') THEN 1 ELSE 0 END),
          total_points = ps.total_points - (COALESCE((v_rules->>'point_per_match_played')::int, 1)
                           + CASE WHEN p.winner_team = s.team THEN COALESCE((v_rules->>'point_per_match_win')::int, 3) ELSE 0 END),
          updated_at   = NOW()
         WHERE ps.user_id = s.pid AND ps.organization_id = p.organization_id;
      END LOOP;
    END IF;
    -- XP.
    WITH x AS (DELETE FROM xp_events WHERE source_private_match_id = p.id RETURNING user_id, amount)
    UPDATE profiles pr SET xp = GREATEST(0, pr.xp - t.total)
      FROM (SELECT user_id, SUM(amount) AS total FROM x GROUP BY user_id) t
     WHERE pr.id = t.user_id;
    DELETE FROM private_matches WHERE id = p.id;   -- as stats vão com ele
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public.friend_match_uncount(UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- ── 2c. Contar o que falta (e acertar o que mudou) ──────────────────────
-- Idempotente: cada par fica com o seu jogo «clássico» quando pode contar
-- (ou é amigável com alguém com conta); um par à espera de um «Vou» fica
-- sem nada até lá. Um par que mudou (ex.: o convidado criou conta) é
-- descontado e contado de novo.
CREATE OR REPLACE FUNCTION public.friend_match_reconcile(p_root UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_root  private_matches%ROWTYPE;
  q       RECORD;
  v_old   private_matches%ROWTYPE;
  v_rank  BOOLEAN;
  v_st    TEXT;
  v_id    UUID;
  pl      RECORD;
  v_n     INTEGER := 0;
BEGIN
  SELECT * INTO v_root FROM private_matches WHERE id = p_root AND is_friend_session FOR UPDATE;
  IF v_root.id IS NULL OR v_root.finished_at IS NULL OR v_root.result_rejected_at IS NOT NULL THEN
    RETURN 0;
  END IF;

  -- Pares que já não existem (ex.: chave mudou): sai o que deram.
  PERFORM friend_match_uncount(p_root, p.pair_key)
     FROM private_matches p
    WHERE p.friend_pair_of = p_root
      AND p.pair_key NOT IN (SELECT r.pair_key FROM friend_match_pair_rows(p_root) r);

  FOR q IN SELECT * FROM friend_match_pair_rows(p_root) LOOP
    -- À espera de um «Vou» de alguém deste par: ainda não conta nada.
    CONTINUE WHEN cardinality(q.pending_people) > 0;
    -- Sem ninguém com conta, não há nada a guardar.
    CONTINUE WHEN q.a1 IS NULL AND q.a2 IS NULL AND q.b1 IS NULL AND q.b2 IS NULL;

    v_rank := v_root.ranked_intent AND q.all_accepted AND q.winner <> 'draw';
    SELECT * INTO v_old FROM private_matches WHERE friend_pair_of = p_root AND pair_key = q.pair_key;
    IF v_old.id IS NOT NULL THEN
      -- Igual ao que já está: nada a fazer.
      CONTINUE WHEN v_old.ranked_intent = v_rank AND v_old.winner_team = q.winner
                AND v_old.score_a = q.rounds_a AND v_old.score_b = q.rounds_b
                AND v_old.team_a_player1_id IS NOT DISTINCT FROM q.a1 AND v_old.team_a_player2_id IS NOT DISTINCT FROM q.a2
                AND v_old.team_b_player1_id IS NOT DISTINCT FROM q.b1 AND v_old.team_b_player2_id IS NOT DISTINCT FROM q.b2;
      PERFORM friend_match_uncount(p_root, q.pair_key);
    END IF;

    v_st := CASE WHEN v_rank THEN 'accepted_all' ELSE 'accepted_no_ranking' END;
    INSERT INTO private_matches (
      creator_id, ranked_intent, scheduled_date, scheduled_time, location, location_latitude, location_longitude,
      court, organization_id, scoring_format, num_sets, status, played_at, teams_set_at,
      friend_pair_of, pair_key, score_a, score_b, winner_team, score_submitted_by,
      team_a_player1_id, team_a_player1_guest_name, team_a_player1_status,
      team_a_player2_id, team_a_player2_guest_name, team_a_player2_status,
      team_b_player1_id, team_b_player1_guest_name, team_b_player1_status,
      team_b_player2_id, team_b_player2_guest_name, team_b_player2_status)
    VALUES (
      v_root.creator_id, v_rank, v_root.scheduled_date, v_root.scheduled_time, v_root.location,
      v_root.location_latitude, v_root.location_longitude, v_root.court, v_root.organization_id,
      v_root.scoring_format, v_root.num_sets, 'pending',
      COALESCE((v_root.scheduled_date + COALESCE(v_root.scheduled_time, time '12:00')) AT TIME ZONE 'Europe/Lisbon', NOW()),
      NOW(), p_root, q.pair_key, q.rounds_a, q.rounds_b, q.winner, v_root.result_sent_by,
      q.a1, CASE WHEN q.a1 IS NULL THEN q.a1g END, CASE WHEN q.a1 IS NULL THEN 'guest' ELSE v_st END,
      q.a2, CASE WHEN q.a2 IS NULL THEN q.a2g END, CASE WHEN q.a2 IS NULL THEN 'guest' ELSE v_st END,
      q.b1, CASE WHEN q.b1 IS NULL THEN q.b1g END, CASE WHEN q.b1 IS NULL THEN 'guest' ELSE v_st END,
      q.b2, CASE WHEN q.b2 IS NULL THEN q.b2g END, CASE WHEN q.b2 IS NULL THEN 'guest' ELSE v_st END)
    RETURNING id INTO v_id;

    IF v_rank THEN
      -- A conta de sempre (apply_elo_pairing → elo_jogo_deltas), uma vez por par.
      INSERT INTO private_match_stats (private_match_id, user_id, points_earned, won)
      VALUES (v_id, q.a1, 1 + CASE WHEN q.winner = 'a' THEN 3 ELSE 0 END, q.winner = 'a'),
             (v_id, q.a2, 1 + CASE WHEN q.winner = 'a' THEN 3 ELSE 0 END, q.winner = 'a'),
             (v_id, q.b1, 1 + CASE WHEN q.winner = 'b' THEN 3 ELSE 0 END, q.winner = 'b'),
             (v_id, q.b2, 1 + CASE WHEN q.winner = 'b' THEN 3 ELSE 0 END, q.winner = 'b');
      FOR pl IN SELECT * FROM apply_elo_pairing(q.a1, q.a2, q.b1, q.b2, CASE WHEN q.winner = 'a' THEN 1 ELSE 0 END) LOOP
        UPDATE private_match_stats
           SET rating_delta = ROUND(pl.delta, 2),
               rating_after = ROUND((SELECT COALESCE(pr.rating, 900) FROM profiles pr WHERE pr.id = pl.pid), 2)
         WHERE private_match_id = v_id AND user_id = pl.pid;
      END LOOP;
    END IF;

    -- XP: jogar (todos os que têm conta) e ganhar (o vencedor do par).
    WITH players AS (
      SELECT t.pid, t.won FROM (VALUES (q.a1, q.winner = 'a'), (q.a2, q.winner = 'a'),
                                      (q.b1, q.winner = 'b'), (q.b2, q.winner = 'b')) AS t(pid, won)
       WHERE t.pid IS NOT NULL
    ), rows_ AS (
      SELECT pid, 'friendly_match'::text AS kind, 10 AS amount FROM players
      UNION ALL SELECT pid, 'friendly_win', 5 FROM players WHERE won
    ), ins AS (
      INSERT INTO xp_events (user_id, kind, source_private_match_id, amount)
      SELECT pid, kind, v_id, amount FROM rows_
      ON CONFLICT (user_id, kind, source_private_match_id) WHERE source_private_match_id IS NOT NULL DO NOTHING
      RETURNING user_id, amount
    )
    UPDATE profiles pr SET xp = pr.xp + t.total, last_played_at = GREATEST(COALESCE(pr.last_played_at, NOW()), NOW())
      FROM (SELECT user_id, SUM(amount) AS total FROM ins GROUP BY user_id) t
     WHERE pr.id = t.user_id;

    -- Confirmado: dispara os pontos do grupo (private_match_group_stats),
    -- que só contam com os quatro membros a aceitar o ranking.
    UPDATE private_matches SET status = 'confirmed', confirmed_at = TIMEZONE('utc', NOW()) WHERE id = v_id;

    PERFORM check_and_award_achievements(t.pid)
       FROM (VALUES (q.a1), (q.a2), (q.b1), (q.b2)) AS t(pid) WHERE t.pid IS NOT NULL;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public.friend_match_reconcile(UUID) FROM PUBLIC, anon, authenticated;

-- ── 2d. Estado e pares para os ecrãs ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.friend_match_pairs_json(p_root UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'pair_key', q.pair_key,
           'team_a', jsonb_build_array(
              jsonb_build_object('user_id', q.a1, 'name', COALESCE((SELECT name FROM profiles WHERE id = q.a1), q.a1g)),
              jsonb_build_object('user_id', q.a2, 'name', COALESCE((SELECT name FROM profiles WHERE id = q.a2), q.a2g))),
           'team_b', jsonb_build_array(
              jsonb_build_object('user_id', q.b1, 'name', COALESCE((SELECT name FROM profiles WHERE id = q.b1), q.b1g)),
              jsonb_build_object('user_id', q.b2, 'name', COALESCE((SELECT name FROM profiles WHERE id = q.b2), q.b2g))),
           'rounds_a', q.rounds_a, 'rounds_b', q.rounds_b, 'games_a', q.games_a, 'games_b', q.games_b,
           'winner', q.winner,
           'counts', EXISTS (SELECT 1 FROM private_matches p JOIN private_match_stats st ON st.private_match_id = p.id
                              WHERE p.friend_pair_of = p_root AND p.pair_key = q.pair_key),
           'waiting', cardinality(q.pending_people) > 0)
         ORDER BY q.first_round), '[]'::jsonb)
    FROM friend_match_pair_rows(p_root) q;
$function$;
REVOKE ALL ON FUNCTION public.friend_match_pairs_json(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.friend_match_ranking_state(p_root UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT CASE
    WHEN r.finished_at IS NULL THEN NULL
    WHEN r.result_rejected_at IS NOT NULL THEN 'rejected'
    WHEN EXISTS (SELECT 1 FROM friend_match_pair_rows(r.id) q
                  WHERE cardinality(q.pending_people) > 0 AND r.ranked_intent AND q.all_accounts AND q.winner <> 'draw') THEN 'waiting'
    WHEN EXISTS (SELECT 1 FROM private_matches p JOIN private_match_stats st ON st.private_match_id = p.id
                  WHERE p.friend_pair_of = r.id) THEN 'counted'
    ELSE 'not_ranked' END
    FROM private_matches r WHERE r.id = p_root;
$function$;
REVOKE ALL ON FUNCTION public.friend_match_ranking_state(UUID) FROM PUBLIC, anon, authenticated;

-- Quem falta dizer «Vou» nos pares que podiam contar.
CREATE OR REPLACE FUNCTION public.friend_match_waiting_for(p_root UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object('invitee_id', i.id, 'name', pr.name)), '[]'::jsonb)
    FROM friend_match_pair_rows(p_root) q
    JOIN private_match_invitees i ON i.match_id = p_root AND i.user_id = ANY (q.pending_people) AND i.status = 'pending'
    JOIN profiles pr ON pr.id = i.user_id;
$function$;
REVOKE ALL ON FUNCTION public.friend_match_waiting_for(UUID) FROM PUBLIC, anon, authenticated;

-- ── 3a. Terminar e enviar ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finish_friend_match(p_match_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_root  private_matches%ROWTYPE;
  v_empty UUID[];
BEGIN
  SELECT * INTO v_root FROM private_matches WHERE id = p_match_id AND is_friend_session FOR UPDATE;
  IF v_root.id IS NULL OR auth.uid() IS NULL OR NOT friend_match_is_organizer(v_root.id) THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  IF v_root.finished_at IS NOT NULL THEN RAISE EXCEPTION 'already_sent'; END IF;
  PERFORM 1 FROM private_matches WHERE session_id = v_root.id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM private_matches g
                  WHERE (g.id = v_root.id OR g.session_id = v_root.id) AND g.winner_team IS NOT NULL) THEN
    RAISE EXCEPTION 'nothing_played';
  END IF;

  -- As rondas sem resultado saem (a raiz fica: é o jogo).
  SELECT COALESCE(array_agg(g.id), '{}') INTO v_empty
    FROM private_matches g WHERE g.session_id = v_root.id AND g.winner_team IS NULL;
  UPDATE notifications SET read_at = NOW() WHERE read_at IS NULL AND data->>'match_id' = ANY (v_empty::text[]);
  DELETE FROM private_matches WHERE id = ANY (v_empty);

  UPDATE private_matches
     SET finished_at = NOW(), result_sent_by = auth.uid(), result_sent_at = NOW(),
         result_rejected_by = NULL, result_rejected_at = NULL, result_rejected_note = NULL, result_rejected_rounds = NULL
   WHERE id = v_root.id;
  UPDATE private_match_invitees SET result_ok_at = NULL WHERE match_id = v_root.id;

  PERFORM friend_match_reconcile(v_root.id);
  PERFORM friend_match_notify_sent(v_root.id);
  RETURN friend_match_send_result(v_root.id);
END;
$function$;
REVOKE ALL ON FUNCTION public.finish_friend_match(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finish_friend_match(UUID) TO authenticated;

-- O que o «Terminar e enviar» e o «Corrigir» devolvem.
CREATE OR REPLACE FUNCTION public.friend_match_send_result(p_root UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT jsonb_build_object(
    'status', 'sent',
    'ranking_state', friend_match_ranking_state(p_root),
    'counted', friend_match_ranking_state(p_root) = 'counted',
    'waiting_for', friend_match_waiting_for(p_root),
    'games_counted', (SELECT count(DISTINCT p.id) FROM private_matches p JOIN private_match_stats st ON st.private_match_id = p.id
                       WHERE p.friend_pair_of = p_root));
$function$;
REVOKE ALL ON FUNCTION public.friend_match_send_result(UUID) FROM PUBLIC, anon, authenticated;

-- O aviso aos outros: as rondas de cada um, somadas nos pares em que jogou.
CREATE OR REPLACE FUNCTION public.friend_match_notify_sent(p_root UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_root   private_matches%ROWTYPE;
  v_pairs  INTEGER;
  v_n      INTEGER;
BEGIN
  SELECT * INTO v_root FROM private_matches WHERE id = p_root;
  SELECT count(*) INTO v_pairs FROM friend_match_pair_rows(p_root);
  -- Um aviso por pessoa e por envio: o anterior por ler sai.
  DELETE FROM notifications WHERE kind = 'friend_match_result_sent' AND read_at IS NULL AND data->>'match_id' = p_root::text;
  INSERT INTO notifications (user_id, kind, actor_id, data)
  SELECT w.uid, 'friend_match_result_sent', v_root.result_sent_by,
         jsonb_build_object('match_id', p_root,
                            'sender_name', (SELECT name FROM profiles WHERE id = v_root.result_sent_by),
                            'scheduled_date', v_root.scheduled_date,
                            'pairs_count', v_pairs,
                            'my_rounds', w.mine, 'their_rounds', w.theirs,
                            'outcome', CASE WHEN w.mine > w.theirs THEN 'won' WHEN w.mine < w.theirs THEN 'lost' ELSE 'draw' END)
    FROM (
      SELECT x.uid, sum(x.mine)::int AS mine, sum(x.theirs)::int AS theirs
        FROM friend_match_pair_rows(p_root) q,
             LATERAL (VALUES (q.a1, q.rounds_a, q.rounds_b), (q.a2, q.rounds_a, q.rounds_b),
                             (q.b1, q.rounds_b, q.rounds_a), (q.b2, q.rounds_b, q.rounds_a)) AS x(uid, mine, theirs)
       WHERE x.uid IS NOT NULL
       GROUP BY x.uid
    ) w
   WHERE w.uid IS DISTINCT FROM v_root.result_sent_by
     AND EXISTS (SELECT 1 FROM private_match_invitees i
                  WHERE i.match_id = p_root AND i.user_id = w.uid AND i.status IN ('accepted', 'pending'));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public.friend_match_notify_sent(UUID) FROM PUBLIC, anon, authenticated;

-- ── 3b. «Está certo» ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.confirm_friend_match_result(p_match_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_allowed'; END IF;
  UPDATE private_match_invitees SET result_ok_at = NOW()
   WHERE match_id = p_match_id AND user_id = auth.uid() AND status = 'accepted';
  IF NOT FOUND THEN RAISE EXCEPTION 'not_allowed'; END IF;
  UPDATE notifications SET read_at = NOW()
   WHERE user_id = auth.uid() AND kind = 'friend_match_result_sent' AND read_at IS NULL
     AND data->>'match_id' = p_match_id::text;
  RETURN 'ok';
END;
$function$;
REVOKE ALL ON FUNCTION public.confirm_friend_match_result(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_friend_match_result(UUID) TO authenticated;

-- ── 3c. «Não está certo» ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reject_friend_match_result(p_match_id UUID, p_note TEXT DEFAULT NULL, p_rounds JSONB DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_root private_matches%ROWTYPE;
BEGIN
  SELECT * INTO v_root FROM private_matches WHERE id = p_match_id AND is_friend_session FOR UPDATE;
  IF v_root.id IS NULL OR auth.uid() IS NULL THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF v_root.finished_at IS NULL THEN RAISE EXCEPTION 'not_sent'; END IF;
  -- Só quem jogou alguma ronda, com conta e com o «Vou».
  IF NOT EXISTS (SELECT 1 FROM private_match_invitees i WHERE i.match_id = p_match_id AND i.user_id = auth.uid() AND i.status = 'accepted')
     OR NOT EXISTS (SELECT 1 FROM private_matches m WHERE (m.id = p_match_id OR m.session_id = p_match_id)
                     AND auth.uid() IN (m.team_a_player1_id, m.team_a_player2_id, m.team_b_player1_id, m.team_b_player2_id)) THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  IF p_rounds IS NOT NULL AND jsonb_typeof(p_rounds) <> 'array' THEN RAISE EXCEPTION 'bad_input'; END IF;

  -- Sai do ranking até ser corrigido: volta atrás o que os pares deram.
  PERFORM friend_match_uncount(p_match_id);
  UPDATE private_matches
     SET result_rejected_by = auth.uid(), result_rejected_at = NOW(),
         result_rejected_note = NULLIF(btrim(p_note), ''), result_rejected_rounds = p_rounds
   WHERE id = p_match_id;

  UPDATE notifications SET read_at = NOW()
   WHERE user_id = auth.uid() AND kind = 'friend_match_result_sent' AND read_at IS NULL AND data->>'match_id' = p_match_id::text;
  IF v_root.result_sent_by IS NOT NULL AND v_root.result_sent_by <> auth.uid() THEN
    INSERT INTO notifications (user_id, kind, actor_id, data)
    VALUES (v_root.result_sent_by, 'friend_match_result_rejected', auth.uid(),
            jsonb_build_object('match_id', p_match_id, 'name', (SELECT name FROM profiles WHERE id = auth.uid()),
                               'note', NULLIF(btrim(p_note), ''), 'scheduled_date', v_root.scheduled_date));
  END IF;
  RETURN 'rejected';
END;
$function$;
REVOKE ALL ON FUNCTION public.reject_friend_match_result(UUID, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_friend_match_result(UUID, TEXT, JSONB) TO authenticated;

-- ── 3d. «Corrigir o resultado» (quem enviou) ────────────────────────────
-- p_rounds = [{game_id, score_a, score_b}]: acerta essas rondas e volta a
-- enviar de uma vez (nunca há um momento meio mudado e já contado).
CREATE OR REPLACE FUNCTION public.correct_friend_match_result(p_match_id UUID, p_rounds JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_root private_matches%ROWTYPE;
  x      JSONB;
  v_m    private_matches%ROWTYPE;
  v_a    INTEGER;
  v_b    INTEGER;
BEGIN
  SELECT * INTO v_root FROM private_matches WHERE id = p_match_id AND is_friend_session FOR UPDATE;
  IF v_root.id IS NULL OR auth.uid() IS NULL THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF v_root.finished_at IS NULL THEN RAISE EXCEPTION 'not_sent'; END IF;
  IF v_root.result_sent_by IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF p_rounds IS NULL OR jsonb_typeof(p_rounds) <> 'array' THEN RAISE EXCEPTION 'bad_input'; END IF;

  PERFORM friend_match_uncount(p_match_id);
  PERFORM set_config('alinho.friend_result_edit', 'on', TRUE);
  FOR x IN SELECT * FROM jsonb_array_elements(p_rounds) LOOP
    SELECT * INTO v_m FROM private_matches
     WHERE id = (x->>'game_id')::uuid AND (id = p_match_id OR session_id = p_match_id) FOR UPDATE;
    IF v_m.id IS NULL THEN RAISE EXCEPTION 'bad_input'; END IF;
    v_a := (x->>'score_a')::int;
    v_b := (x->>'score_b')::int;
    IF NOT friend_match_round_score_ok(COALESCE(v_m.round_kind, 'pontos'), v_a, v_b) THEN RAISE EXCEPTION 'bad_score'; END IF;
    UPDATE private_matches
       SET score_a = v_a, score_b = v_b,
           winner_team = CASE WHEN v_a > v_b THEN 'a' WHEN v_b > v_a THEN 'b' ELSE 'draw' END,
           score_submitted_by = auth.uid()
     WHERE id = v_m.id;
  END LOOP;
  PERFORM set_config('alinho.friend_result_edit', 'off', TRUE);

  UPDATE private_matches
     SET result_sent_at = NOW(), result_rejected_by = NULL, result_rejected_at = NULL,
         result_rejected_note = NULL, result_rejected_rounds = NULL
   WHERE id = p_match_id;
  UPDATE private_match_invitees SET result_ok_at = NULL WHERE match_id = p_match_id;

  PERFORM friend_match_reconcile(p_match_id);
  PERFORM friend_match_notify_sent(p_match_id);
  RETURN friend_match_send_result(p_match_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.correct_friend_match_result(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.correct_friend_match_result(UUID, JSONB) TO authenticated;

-- ── 5a. Depois de enviado, as rondas não mudam ──────────────────────────
-- Só o «Corrigir» (alinho.friend_result_edit) e quem fica com um lugar de
-- convidado (o nome passa a conta) passam.
CREATE OR REPLACE FUNCTION public.friend_match_sent_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_root UUID := CASE WHEN TG_OP = 'DELETE' THEN COALESCE(OLD.session_id, OLD.id) ELSE COALESCE(NEW.session_id, NEW.id) END;
BEGIN
  IF current_setting('alinho.friend_result_edit', TRUE) = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM private_matches r WHERE r.id = v_root AND r.is_friend_session AND r.finished_at IS NOT NULL) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'INSERT' THEN RAISE EXCEPTION 'finished'; END IF;
  IF TG_OP = 'DELETE' THEN
    -- Apagar o jogo inteiro (a raiz, ou as rondas com ele) passa.
    IF OLD.session_id IS NULL OR NOT EXISTS (SELECT 1 FROM private_matches r WHERE r.id = OLD.session_id) THEN RETURN OLD; END IF;
    IF current_setting('alinho.friend_deleting', TRUE) = OLD.session_id::text THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'finished';
  END IF;
  -- UPDATE: o resultado e o tipo da ronda não mudam.
  IF NEW.score_a IS DISTINCT FROM OLD.score_a OR NEW.score_b IS DISTINCT FROM OLD.score_b
     OR NEW.winner_team IS DISTINCT FROM OLD.winner_team OR NEW.round_kind IS DISTINCT FROM OLD.round_kind THEN
    RAISE EXCEPTION 'finished';
  END IF;
  -- As duplas também não, salvo um nome de convidado que passa a conta
  -- (a mesma pessoa) ou o contrário (quem sai fica «sem nome»).
  IF (NEW.team_a_player1_id IS DISTINCT FROM OLD.team_a_player1_id AND OLD.team_a_player1_id IS NOT NULL AND NEW.team_a_player1_id IS NOT NULL)
     OR (NEW.team_a_player2_id IS DISTINCT FROM OLD.team_a_player2_id AND OLD.team_a_player2_id IS NOT NULL AND NEW.team_a_player2_id IS NOT NULL)
     OR (NEW.team_b_player1_id IS DISTINCT FROM OLD.team_b_player1_id AND OLD.team_b_player1_id IS NOT NULL AND NEW.team_b_player1_id IS NOT NULL)
     OR (NEW.team_b_player2_id IS DISTINCT FROM OLD.team_b_player2_id AND OLD.team_b_player2_id IS NOT NULL AND NEW.team_b_player2_id IS NOT NULL) THEN
    RAISE EXCEPTION 'finished';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.friend_match_sent_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS friend_match_sent_guard_trigger ON private_matches;
CREATE TRIGGER friend_match_sent_guard_trigger
  BEFORE INSERT OR UPDATE OF score_a, score_b, winner_team, round_kind,
                             team_a_player1_id, team_a_player2_id, team_b_player1_id, team_b_player2_id
                  OR DELETE ON private_matches
  FOR EACH ROW
  WHEN (pg_trigger_depth() < 2)
  EXECUTE FUNCTION friend_match_sent_guard();

-- ── 5b. Aceitar o convite ou ficar com o lugar depois do envio conta ────
CREATE OR REPLACE FUNCTION public.friend_match_invitee_changed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM private_matches r WHERE r.id = NEW.match_id AND r.is_friend_session
                AND r.finished_at IS NOT NULL AND r.result_rejected_at IS NULL) THEN
    PERFORM friend_match_reconcile(NEW.match_id);
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.friend_match_invitee_changed() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS friend_match_invitee_changed_trigger ON private_match_invitees;
CREATE TRIGGER friend_match_invitee_changed_trigger
  AFTER UPDATE OF status, user_id, is_anonymous ON private_match_invitees
  FOR EACH ROW EXECUTE FUNCTION friend_match_invitee_changed();

-- ── 5c. Apagar o jogo desconta antes ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.friend_match_before_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF OLD.is_friend_session THEN
    PERFORM set_config('alinho.friend_deleting', OLD.id::text, TRUE);
    PERFORM friend_match_uncount(OLD.id);
  END IF;
  RETURN OLD;
END;
$function$;
REVOKE ALL ON FUNCTION public.friend_match_before_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS friend_match_before_delete_trigger ON private_matches;
CREATE TRIGGER friend_match_before_delete_trigger
  BEFORE DELETE ON private_matches
  FOR EACH ROW WHEN (OLD.is_friend_session)
  EXECUTE FUNCTION friend_match_before_delete();

-- ── 6. Leituras (corpo VIVO, trocas literais; «já estava») ──────────────
DO $$
DECLARE
  f     RECORD;
  v_def TEXT;
  v_n   INTEGER;
BEGIN
  FOR f IN SELECT * FROM (VALUES
    (1, 'public.get_friend_match(uuid)', $a$'finished_at', m.finished_at,$a$,
        $b$'finished_at', m.finished_at, 'ranking_state', friend_match_ranking_state(m.id), 'sent_by', (SELECT jsonb_build_object('user_id', sp.id, 'name', sp.name) FROM profiles sp WHERE sp.id = m.result_sent_by), 'rejected_by', CASE WHEN m.result_rejected_at IS NOT NULL THEN jsonb_build_object('user_id', m.result_rejected_by, 'name', (SELECT rp.name FROM profiles rp WHERE rp.id = m.result_rejected_by), 'note', m.result_rejected_note, 'rounds', m.result_rejected_rounds) END, 'pairs', friend_match_pairs_json(m.id), 'waiting_for', friend_match_waiting_for(m.id), 'games_counted', (SELECT count(DISTINCT gp.id) FROM private_matches gp JOIN private_match_stats gs ON gs.private_match_id = gp.id WHERE gp.friend_pair_of = m.id),$b$, 1),
    (2, 'public.list_played_events(uuid, timestamp with time zone, integer)',
        'WHERE (x.id = r.id OR x.session_id = r.id) AND s.user_id = v_me)',
        'WHERE (x.id = r.id OR x.session_id = r.id OR x.friend_pair_of = r.id) AND s.user_id = v_me)', 1),
    (3, 'public.get_my_private_matches()', '  WHERE auth.uid() = ANY (', '  WHERE pm.friend_pair_of IS NULL AND auth.uid() = ANY (', 1)
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

-- A lista «Jogos entre amigos»: todos os meus (por enviar e histórico).
CREATE OR REPLACE FUNCTION public.list_my_friend_sessions()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'match_id', m.id, 'scheduled_date', m.scheduled_date, 'scheduled_time', m.scheduled_time,
           'location', m.location, 'court', m.court, 'is_creator', m.creator_id = auth.uid(),
           'org_name', (SELECT o.name FROM organizations o WHERE o.id = m.organization_id),
           'pairing_mode', m.pairing_mode,
           'people', (SELECT count(*) FROM private_match_invitees x WHERE x.match_id = m.id AND x.status <> 'declined'),
           'accepted', (SELECT count(*) FROM private_match_invitees x WHERE x.match_id = m.id AND x.status IN ('accepted', 'guest')),
           'pending', (SELECT count(*) FROM private_match_invitees x WHERE x.match_id = m.id AND x.status = 'pending'),
           'finished_at', m.finished_at,
           'ranking_state', friend_match_ranking_state(m.id),
           'waiting_for', friend_match_waiting_for(m.id),
           'pairs', friend_match_pairs_json(m.id),
           'games_counted', (SELECT count(DISTINCT gp.id) FROM private_matches gp JOIN private_match_stats gs ON gs.private_match_id = gp.id
                              WHERE gp.friend_pair_of = m.id),
           'live', EXISTS (SELECT 1 FROM private_matches g WHERE (g.id = m.id OR g.session_id = m.id)
                             AND g.started_at IS NOT NULL AND g.winner_team IS NULL))
           ORDER BY m.scheduled_date DESC, m.scheduled_time DESC NULLS LAST), '[]'::jsonb)
    FROM private_matches m
   WHERE m.is_friend_session
     AND (m.creator_id = auth.uid()
          OR EXISTS (SELECT 1 FROM private_match_invitees i
                      WHERE i.match_id = m.id AND i.user_id = auth.uid() AND i.status = 'accepted'));
$function$;
REVOKE ALL ON FUNCTION public.list_my_friend_sessions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_friend_sessions() TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT count(*) FROM pg_trigger WHERE tgname = 'friend_match_apply_game_trigger';                       -- 0
--   SELECT count(*) FROM pg_trigger WHERE tgname IN ('friend_match_sent_guard_trigger', 'friend_match_invitee_changed_trigger', 'friend_match_before_delete_trigger');  -- 3
--   SELECT has_function_privilege('anon', 'public.finish_friend_match(uuid)', 'EXECUTE');                   -- false
