-- ═════════════════════════════════════════════════════════════════════════
-- Jogo entre amigos: cancelar ou apagar a partir da lista
--
-- PORQUÊ. Francisco, 28 set («Sim, com aviso aos inscritos» · «para os
-- dois»), design-handoff/2026-09-28-amigos-apagar-da-lista/SPEC.md: «não
-- consigo eliminar este jogo, só aqui» / «e não consigo eliminar do
-- histórico». O cancel_friend_match recusa qualquer jogo 'confirmed', e um
-- jogo amigável fechado (ex.: 1-0 com «Jogador sem nome») fica para
-- sempre no Histórico. Ecrã: Bugs (nomes do PO, 28 set).
--
-- O QUE FAZ. delete_friend_match(p_match_id) → 'cancelled' | 'deleted'.
--   · p_match_id: a raiz de uma sessão (is_friend_session), ou um jogo
--     avulso antigo (sem sessão). Só quem o criou; senão 'not_allowed'.
--   · Único cadeado: um jogo que já contou para o ranking (tem
--     private_match_stats) → 'has_counted'. Tudo o resto apaga-se, também
--     os amigáveis já fechados.
--   · Desfaz o XP que os jogos deram e, num empate de grupo que somou
--     pontos na classificação do grupo (private_match_group_stats), tira-os.
--   · Avisa quem estava no jogo (com conta, menos quem apagou):
--       sem resultados → 'friend_match_cancelled' {match_id, name,
--         scheduled_date, scheduled_time};
--       com resultados → 'friend_match_deleted' {match_id, name,
--         scheduled_date, teams}; teams = «Rita F. / Tiago L. vs Ana M. /
--         Rui C.», ou null se as duplas rodaram.
--     Os avisos por ler destes jogos (convites, pedidos de confirmação…)
--     ficam lidos; os novos de cancelado/apagado ficam por ler.
--   · Os jogos da sessão, os sets e os convidados saem em cascata.
--   · cancel_friend_match (o cancelar de dentro do jogo) passa a marcar
--     como lidos todos os avisos da sessão, não só os convites.
--   · Limpeza única: avisos friend_match_* por ler de jogos que já não
--     existem ficam lidos.
-- Apagar a pedido do dono não é o «nunca apagar» dos dados da equipa.
--
-- Dev 3, 28 set 2026 · ecrã: Bugs
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.live_short_name(text)') IS NULL THEN
    RAISE EXCEPTION 'Falta live_short_name(text). Parar e ler.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.delete_friend_match(p_match_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_root   private_matches%ROWTYPE;
  v_games  UUID[];
  v_played BOOLEAN;
  v_kind   TEXT;
  v_teams  TEXT;
  v_data   JSONB;
  v_rules  JSONB;
  v_won    BOOLEAN;
  v_pts    INTEGER;
  g        RECORD;
  s        RECORD;
BEGIN
  SELECT * INTO v_root FROM private_matches WHERE id = p_match_id FOR UPDATE;
  IF v_root.id IS NULL OR v_root.session_id IS NOT NULL
     OR auth.uid() IS NULL OR v_root.creator_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;

  SELECT array_agg(id) INTO v_games FROM (
    SELECT id FROM private_matches WHERE id = v_root.id OR session_id = v_root.id FOR UPDATE) x;

  -- O único cadeado: já contou para o ranking (os pontos foram dados).
  IF EXISTS (SELECT 1 FROM private_match_stats WHERE private_match_id = ANY (v_games)) THEN
    RAISE EXCEPTION 'has_counted';
  END IF;

  v_played := EXISTS (SELECT 1 FROM private_matches
                       WHERE id = ANY (v_games) AND (winner_team IS NOT NULL OR score_a IS NOT NULL));

  -- As duplas, se foram sempre as mesmas (numa sessão a rodar, null).
  IF v_played AND v_root.pairing_mode IS DISTINCT FROM 'rotating' THEN
    SELECT CASE WHEN count(DISTINCT sig) = 1 THEN min(txt) END INTO v_teams FROM (
      SELECT
        least(least(ka1, ka2) || '+' || greatest(ka1, ka2), least(kb1, kb2) || '+' || greatest(kb1, kb2)) || '|' ||
        greatest(least(ka1, ka2) || '+' || greatest(ka1, ka2), least(kb1, kb2) || '+' || greatest(kb1, kb2)) AS sig,
        concat_ws(' / ', na1, na2) || ' vs ' || concat_ws(' / ', nb1, nb2) AS txt
      FROM (
        SELECT m.team_a_player1_id::text AS ka1,
               COALESCE(m.team_a_player2_id::text, 'g:' || m.team_a_player2_guest_name) AS ka2,
               COALESCE(m.team_b_player1_id::text, 'g:' || m.team_b_player1_guest_name) AS kb1,
               COALESCE(m.team_b_player2_id::text, 'g:' || m.team_b_player2_guest_name) AS kb2,
               live_short_name((SELECT name FROM profiles WHERE id = m.team_a_player1_id)) AS na1,
               COALESCE(live_short_name((SELECT name FROM profiles WHERE id = m.team_a_player2_id)), btrim(m.team_a_player2_guest_name)) AS na2,
               COALESCE(live_short_name((SELECT name FROM profiles WHERE id = m.team_b_player1_id)), btrim(m.team_b_player1_guest_name)) AS nb1,
               COALESCE(live_short_name((SELECT name FROM profiles WHERE id = m.team_b_player2_id)), btrim(m.team_b_player2_guest_name)) AS nb2
          FROM private_matches m
         WHERE m.id = ANY (v_games) AND (m.winner_team IS NOT NULL OR m.score_a IS NOT NULL)
      ) k
    ) t;
  END IF;

  -- Um empate de grupo não dá ranking, mas soma na classificação do grupo
  -- (private_match_group_stats): tira-se o que se somou.
  FOR g IN SELECT * FROM private_matches
            WHERE id = ANY (v_games) AND group_stats_applied_at IS NOT NULL AND organization_id IS NOT NULL LOOP
    SELECT points_rules INTO v_rules FROM organizations WHERE id = g.organization_id;
    v_rules := COALESCE(v_rules, '{"point_per_match_played": 1, "point_per_match_win": 3}'::jsonb);
    FOR s IN SELECT * FROM (VALUES
        ('a', g.team_a_player1_id), ('a', g.team_a_player2_id),
        ('b', g.team_b_player1_id), ('b', g.team_b_player2_id)) AS t(team, pid)
      WHERE t.pid IS NOT NULL LOOP
      v_won := g.winner_team = s.team;
      v_pts := COALESCE((v_rules->>'point_per_match_played')::int, 1)
             + CASE WHEN v_won THEN COALESCE((v_rules->>'point_per_match_win')::int, 3) ELSE 0 END;
      UPDATE player_stats
         SET game_wins    = GREATEST(0, game_wins - CASE WHEN v_won THEN 1 ELSE 0 END),
             game_losses  = GREATEST(0, game_losses - CASE WHEN g.winner_team NOT IN (s.team, 'draw') THEN 1 ELSE 0 END),
             total_points = GREATEST(0, total_points - v_pts),
             updated_at   = NOW()
       WHERE user_id = s.pid AND organization_id = g.organization_id;
    END LOOP;
  END LOOP;

  -- O XP que os jogos deram.
  WITH x AS (
    DELETE FROM xp_events WHERE source_private_match_id = ANY (v_games) RETURNING user_id, amount
  )
  UPDATE profiles p SET xp = GREATEST(0, p.xp - s2.total)
    FROM (SELECT user_id, SUM(amount) AS total FROM x GROUP BY user_id) s2
   WHERE p.id = s2.user_id;

  -- Os avisos por ler que apontam para estes jogos ficam lidos, para
  -- ninguém abrir um jogo que já não existe (PO, 28 set). Os avisos novos,
  -- a seguir, ficam por ler.
  UPDATE notifications SET read_at = NOW()
   WHERE read_at IS NULL
     AND (data->>'match_id' = ANY (v_games::text[]) OR data->>'private_match_id' = ANY (v_games::text[]));

  -- Avisar quem estava no jogo.
  v_kind := CASE WHEN v_played THEN 'friend_match_deleted' ELSE 'friend_match_cancelled' END;
  v_data := CASE WHEN v_played
    THEN jsonb_build_object('match_id', v_root.id,
                            'name', (SELECT name FROM profiles WHERE id = v_root.creator_id),
                            'scheduled_date', v_root.scheduled_date, 'teams', v_teams)
    ELSE jsonb_build_object('match_id', v_root.id,
                            'name', (SELECT name FROM profiles WHERE id = v_root.creator_id),
                            'scheduled_date', v_root.scheduled_date, 'scheduled_time', v_root.scheduled_time)
  END;
  INSERT INTO notifications (user_id, kind, actor_id, data)
  SELECT DISTINCT r.uid, v_kind, auth.uid(), v_data
    FROM (
      SELECT i.user_id AS uid FROM private_match_invitees i
       WHERE i.match_id = ANY (v_games) AND i.user_id IS NOT NULL AND i.status IN ('pending', 'accepted')
      UNION
      SELECT t.pid FROM private_matches m,
             LATERAL (VALUES (m.team_a_player1_id, m.team_a_player1_status),
                             (m.team_a_player2_id, m.team_a_player2_status),
                             (m.team_b_player1_id, m.team_b_player1_status),
                             (m.team_b_player2_id, m.team_b_player2_status)) AS t(pid, st)
       WHERE m.id = ANY (v_games) AND t.pid IS NOT NULL AND t.st IS DISTINCT FROM 'rejected'
    ) r
   WHERE r.uid <> auth.uid();

  -- Os jogos da sessão, os sets e os convidados saem em cascata.
  DELETE FROM private_matches WHERE id = v_root.id;
  RETURN CASE WHEN v_played THEN 'deleted' ELSE 'cancelled' END;
END;
$function$;
REVOKE ALL ON FUNCTION public.delete_friend_match(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_friend_match(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_friend_match(UUID) TO authenticated;

-- ── O cancelar de dentro do jogo: o mesmo com os avisos ─────────────────
-- (Bugs, 28 set: o Francisco tinha um «… não vai ao jogo» de um jogo que já
-- tinha cancelado, e o aviso levava a «Jogo não encontrado».)
DO $$
DECLARE
  c_mau CONSTANT TEXT := 'UPDATE notifications SET read_at = NOW\(\)\s+WHERE kind = ''friend_match_invite'' AND read_at IS NULL AND data->>''match_id'' = v_root\.id::text;';
  c_bom CONSTANT TEXT := 'UPDATE notifications SET read_at = NOW()
   WHERE read_at IS NULL
     AND data->>''match_id'' IN (SELECT id::text FROM private_matches WHERE id = v_root.id OR session_id = v_root.id);';
  v_def TEXT := pg_get_functiondef('public.cancel_friend_match(uuid)'::regprocedure);
BEGIN
  IF v_def LIKE '%session_id = v_root.id);%' THEN
    RAISE NOTICE 'cancel_friend_match: já estava';
  ELSIF (SELECT count(*) FROM regexp_matches(v_def, c_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'cancel_friend_match: os avisos não aparecem 1 vez. Parar e ler.';
  ELSE
    EXECUTE regexp_replace(v_def, c_mau, c_bom);
  END IF;
END $$;

-- ── Limpeza, uma vez: avisos por ler de jogos que já não existem ────────
-- (Os novos de cancelado/apagado apontam de propósito para um jogo que já
-- não existe, e ficam.)
UPDATE notifications n SET read_at = NOW()
 WHERE n.read_at IS NULL
   AND n.kind LIKE 'friend_match_%'
   AND n.kind NOT IN ('friend_match_cancelled', 'friend_match_deleted')
   AND n.data ? 'match_id'
   AND NOT EXISTS (SELECT 1 FROM private_matches pm WHERE pm.id::text = n.data->>'match_id');

COMMIT;

-- Verificar depois de correr:
--   SELECT count(*) FROM notifications n WHERE read_at IS NULL AND kind LIKE 'friend_match_%'
--      AND kind NOT IN ('friend_match_cancelled', 'friend_match_deleted')
--      AND NOT EXISTS (SELECT 1 FROM private_matches pm WHERE pm.id::text = n.data->>'match_id');  -- 0
--   SELECT has_function_privilege('anon', 'public.delete_friend_match(uuid)', 'EXECUTE');           -- false
--   SELECT has_function_privilege('authenticated', 'public.delete_friend_match(uuid)', 'EXECUTE');  -- true
