-- ═════════════════════════════════════════════════════════════════════════
-- Jogo de grupo no desenho novo: a mesma máquina do jogo entre amigos,
-- ligada ao grupo e ao ranking do grupo (Trello #342)
--
-- PORQUÊ. O SPEC aprovado diz «Jogo de grupo = o mesmo desenho; no passo 1
-- a pesquisa procura entre os membros do grupo»: mais de 4 pessoas, convite
-- primeiro, equipas depois e a rodar. Em vez de uma segunda máquina, o Dev 2
-- propôs reaproveitar a do jogo entre amigos (migration_friend_match_
-- invitees.sql, viva desde 26 set). O Francisco aprovou (27 set):
--   · continua a contar para o ranking do grupo (player_stats do grupo);
--   · pode entrar quem não tem conta, mas então esse jogo NÃO conta para o
--     ranking do grupo — só conta com os 4 membros do grupo, com conta, e
--     todos a aceitar o ranking (como o nível no jogo entre amigos);
--   · sair e corrigir resultados seguem as regras do jogo entre amigos.
-- PROPOSTA, POR ACORDAR COM O RENATO: muda as regras do jogo de grupo do
-- #239 (só membros, sair até haver resultado, correção por acordo dos 4).
-- O group_matches e as funções dele NÃO são tocados: os jogos de grupo
-- antigos continuam como estão.
--
-- O QUE MUDA (sempre a partir do corpo VIVO, com a troca a ter de aparecer
-- exatamente uma vez; diz «já estava» se já correu):
--   1. private_matches.organization_id — o grupo do jogo (NULL = amigos).
--   2. create_friend_match ganha p_organization_id UUID DEFAULT NULL (no
--      fim). Com grupo: quem cria tem de ser membro, e cada convidado com
--      conta também ('not_a_member'). Muda a assinatura: sai a antiga.
--   3. friend_match_add_invitee: com grupo, recusa quem não é membro.
--   4. add_friend_match_game: os jogos seguintes herdam o grupo.
--   5. Ranking do grupo: ao ficar 'confirmed' (pelo confirm_private_match de
--      sempre, que não é tocado), um jogo com grupo soma no player_stats
--      desse grupo, com os pontos do grupo (organizations.points_rules),
--      como o apply_group_match_ranking — mas só o player_stats: o nível
--      global já é o confirm_private_match que o aplica. Empate: só os
--      pontos de ter jogado. Fica marcado (group_stats_applied_at) para
--      nunca somar duas vezes.
--
-- Dev 3, 27 set 2026 · depois de migration_friend_match_invitees.sql
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 0. Peças de que depende ─────────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.create_friend_match(date, time, text, double precision, double precision, boolean, text, integer, text, jsonb, text)') IS NULL
     AND to_regprocedure('public.create_friend_match(date, time, text, double precision, double precision, boolean, text, integer, text, jsonb, text, uuid)') IS NULL THEN
    RAISE EXCEPTION 'Falta a migration_friend_match_invitees.sql (v2). Parar e ler.';
  END IF;
  IF to_regclass('public.player_stats') IS NULL THEN
    RAISE EXCEPTION 'Falta player_stats. Parar e ler.';
  END IF;
END $$;

-- ── 1. O grupo do jogo ──────────────────────────────────────────────────
ALTER TABLE private_matches ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE private_matches ADD COLUMN IF NOT EXISTS group_stats_applied_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS private_matches_org_idx ON private_matches (organization_id) WHERE organization_id IS NOT NULL;

-- ── 2. create_friend_match: p_organization_id ───────────────────────────
DO $$
DECLARE
  c_old_sig CONSTANT TEXT := 'public.create_friend_match(date, time, text, double precision, double precision, boolean, text, integer, text, jsonb, text)';
  c_new_sig CONSTANT TEXT := 'public.create_friend_match(date, time, text, double precision, double precision, boolean, text, integer, text, jsonb, text, uuid)';
  c_par_mau CONSTANT TEXT := '(p_court text DEFAULT NULL::text)\)';
  c_par_bom CONSTANT TEXT := '\1, p_organization_id uuid DEFAULT NULL::uuid)';
  c_chk_mau CONSTANT TEXT := '(IF p_teams_mode NOT IN \(''manual'', ''app''\) THEN RAISE EXCEPTION ''Escolhe quem faz as equipas''; END IF;)';
  c_chk_bom CONSTANT TEXT := '\1
  -- Jogo de grupo (27 set): quem cria tem de ser membro do grupo.
  IF p_organization_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM memberships WHERE organization_id = p_organization_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION ''not_a_member'';
  END IF;';
  c_col_mau CONSTANT TEXT := 'teams_mode, court\)';
  c_col_bom CONSTANT TEXT := 'teams_mode, court, organization_id)';
  c_val_mau CONSTANT TEXT := '(NULLIF\(trim\(p_court\), ''''\))\)';
  c_val_bom CONSTANT TEXT := '\1, p_organization_id)';
  v_def TEXT;
  v_n   INTEGER;
BEGIN
  IF to_regprocedure(c_new_sig) IS NOT NULL THEN
    RAISE NOTICE 'create_friend_match: já estava';
    RETURN;
  END IF;
  v_def := pg_get_functiondef(c_old_sig::regprocedure);
  FOR v_n IN SELECT unnest(ARRAY[
      (SELECT count(*) FROM regexp_matches(v_def, c_par_mau, 'g')),
      (SELECT count(*) FROM regexp_matches(v_def, c_chk_mau, 'g')),
      (SELECT count(*) FROM regexp_matches(v_def, c_col_mau, 'g')),
      (SELECT count(*) FROM regexp_matches(v_def, c_val_mau, 'g'))]) LOOP
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'create_friend_match: um dos pedaços a trocar não aparece 1 vez (%). Parar e ler.', v_n;
    END IF;
  END LOOP;
  v_def := regexp_replace(v_def, c_par_mau, c_par_bom);
  v_def := regexp_replace(v_def, c_chk_mau, c_chk_bom);
  v_def := regexp_replace(v_def, c_col_mau, c_col_bom);
  v_def := regexp_replace(v_def, c_val_mau, c_val_bom);
  EXECUTE 'DROP FUNCTION ' || c_old_sig;
  EXECUTE v_def;
END $$;

REVOKE ALL ON FUNCTION public.create_friend_match(date, time, text, double precision, double precision, boolean, text, integer, text, jsonb, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_friend_match(date, time, text, double precision, double precision, boolean, text, integer, text, jsonb, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_friend_match(date, time, text, double precision, double precision, boolean, text, integer, text, jsonb, text, uuid) TO authenticated;

-- ── 3. friend_match_add_invitee: só membros do grupo ────────────────────
DO $$
DECLARE
  c_mau CONSTANT TEXT := '(SELECT \* INTO v_root FROM private_matches WHERE id = p_root;)';
  c_bom CONSTANT TEXT := '\1
  -- Jogo de grupo (27 set): cada convidado com conta tem de ser membro.
  IF v_root.organization_id IS NOT NULL AND v_user IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM memberships WHERE organization_id = v_root.organization_id AND user_id = v_user) THEN
    RAISE EXCEPTION ''not_a_member'';
  END IF;';
  v_def TEXT := pg_get_functiondef('public.friend_match_add_invitee(uuid, jsonb)'::regprocedure);
  v_n   INTEGER;
BEGIN
  IF v_def LIKE '%v_root.organization_id IS NOT NULL AND v_user IS NOT NULL%' THEN
    RAISE NOTICE 'friend_match_add_invitee: já estava';
    RETURN;
  END IF;
  SELECT count(*) INTO v_n FROM regexp_matches(v_def, c_mau, 'g');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'friend_match_add_invitee: esperava a leitura do jogo 1 vez, encontrei %. Parar e ler.', v_n;
  END IF;
  EXECUTE regexp_replace(v_def, c_mau, c_bom);
END $$;

-- ── 4. add_friend_match_game: os jogos seguintes herdam o grupo ─────────
DO $$
DECLARE
  c_col_mau CONSTANT TEXT := 'court, scoring_format, num_sets, session_id,';
  c_col_bom CONSTANT TEXT := 'court, organization_id, scoring_format, num_sets, session_id,';
  c_val_mau CONSTANT TEXT := 'v_root\.court, v_root\.scoring_format,';
  c_val_bom CONSTANT TEXT := 'v_root.court, v_root.organization_id, v_root.scoring_format,';
  v_def TEXT := pg_get_functiondef('public.add_friend_match_game(uuid, uuid[], uuid[])'::regprocedure);
BEGIN
  IF v_def LIKE '%v_root.organization_id%' THEN
    RAISE NOTICE 'add_friend_match_game: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_col_mau, 'g')) <> 1
     OR (SELECT count(*) FROM regexp_matches(v_def, c_val_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'add_friend_match_game: as colunas do INSERT não aparecem 1 vez. Parar e ler.';
  END IF;
  EXECUTE regexp_replace(regexp_replace(v_def, c_col_mau, c_col_bom), c_val_mau, c_val_bom);
END $$;

-- ── 5. Ranking do grupo ao confirmar ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.private_match_group_stats()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_rules JSONB;
  v_won   BOOLEAN;
  v_pts   INTEGER;
  s       RECORD;
BEGIN
  IF NEW.group_stats_applied_at IS NOT NULL OR NOT NEW.ranked_intent OR NEW.winner_team IS NULL THEN
    RETURN NULL;
  END IF;
  -- Só conta com os 4 lugares com conta, todos membros do grupo e todos a
  -- aceitar o ranking (quem entrou só pelo nome faz o jogo não contar).
  IF NEW.team_a_player2_id IS NULL OR NEW.team_b_player1_id IS NULL OR NEW.team_b_player2_id IS NULL
     OR 'accepted_all' <> ALL (ARRAY[NEW.team_a_player1_status, NEW.team_a_player2_status,
                                     NEW.team_b_player1_status, NEW.team_b_player2_status])
     OR (SELECT count(DISTINCT m.user_id) FROM memberships m
          WHERE m.organization_id = NEW.organization_id
            AND m.user_id IN (NEW.team_a_player1_id, NEW.team_a_player2_id,
                              NEW.team_b_player1_id, NEW.team_b_player2_id)) <> 4 THEN
    RETURN NULL;
  END IF;

  SELECT points_rules INTO v_rules FROM organizations WHERE id = NEW.organization_id;
  IF v_rules IS NULL THEN
    v_rules := '{"point_per_match_played": 1, "point_per_match_win": 3}'::jsonb;
  END IF;

  FOR s IN SELECT * FROM (VALUES
      ('a', NEW.team_a_player1_id), ('a', NEW.team_a_player2_id),
      ('b', NEW.team_b_player1_id), ('b', NEW.team_b_player2_id)) AS t(team, pid)
  LOOP
    v_won := NEW.winner_team = s.team;
    v_pts := COALESCE((v_rules->>'point_per_match_played')::int, 1)
           + CASE WHEN v_won THEN COALESCE((v_rules->>'point_per_match_win')::int, 3) ELSE 0 END;
    INSERT INTO player_stats (user_id, organization_id, game_wins, game_losses, mix_wins, mixes_played, total_points)
    VALUES (s.pid, NEW.organization_id,
            CASE WHEN v_won THEN 1 ELSE 0 END,
            CASE WHEN NEW.winner_team NOT IN (s.team, 'draw') THEN 1 ELSE 0 END,
            0, 0, v_pts)
    ON CONFLICT (user_id, organization_id) DO UPDATE
    SET game_wins    = player_stats.game_wins    + EXCLUDED.game_wins,
        game_losses  = player_stats.game_losses  + EXCLUDED.game_losses,
        total_points = player_stats.total_points + EXCLUDED.total_points,
        updated_at   = NOW();
  END LOOP;

  UPDATE private_matches SET group_stats_applied_at = NOW() WHERE id = NEW.id;
  RETURN NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.private_match_group_stats() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS private_match_group_stats_trigger ON private_matches;
CREATE TRIGGER private_match_group_stats_trigger
  AFTER UPDATE OF status ON private_matches
  FOR EACH ROW
  WHEN (NEW.status = 'confirmed' AND OLD.status IS DISTINCT FROM 'confirmed' AND NEW.organization_id IS NOT NULL)
  EXECUTE FUNCTION private_match_group_stats();

-- ── 6. A página «Jogos» do grupo ────────────────────────────────────────
-- A get_group_matches só vê a tabela group_matches; os jogos novos são
-- private_matches com grupo. Só para membros do grupo; só jogos já com
-- equipas (as sessões por formar vê-as cada pessoa em
-- list_my_friend_sessions). Do dia mais recente para o mais antigo.
-- Nome e forma do Dev 2 (ecrã: GroupMatches.jsx).
CREATE OR REPLACE FUNCTION public.list_group_friend_matches(p_organization_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', m.id, 'root_id', COALESCE(m.session_id, m.id), 'n', COALESCE(m.game_number, 1),
           'scheduled_date', m.scheduled_date, 'scheduled_time', m.scheduled_time,
           'location', m.location, 'court', m.court, 'status', m.status, 'ranked_intent', m.ranked_intent,
           'score_a', m.score_a, 'score_b', m.score_b,
           'team_a', jsonb_build_array(
              jsonb_build_object('user_id', m.team_a_player1_id, 'name', pa1.name),
              jsonb_build_object('user_id', m.team_a_player2_id, 'name', COALESCE(pa2.name, m.team_a_player2_guest_name))),
           'team_b', jsonb_build_array(
              jsonb_build_object('user_id', m.team_b_player1_id, 'name', COALESCE(pb1.name, m.team_b_player1_guest_name)),
              jsonb_build_object('user_id', m.team_b_player2_id, 'name', COALESCE(pb2.name, m.team_b_player2_guest_name))))
           ORDER BY m.scheduled_date DESC, m.scheduled_time DESC NULLS LAST, COALESCE(m.game_number, 1) DESC), '[]'::jsonb)
    FROM private_matches m
    LEFT JOIN profiles pa1 ON pa1.id = m.team_a_player1_id
    LEFT JOIN profiles pa2 ON pa2.id = m.team_a_player2_id
    LEFT JOIN profiles pb1 ON pb1.id = m.team_b_player1_id
    LEFT JOIN profiles pb2 ON pb2.id = m.team_b_player2_id
   WHERE m.organization_id = p_organization_id
     AND (m.session_id IS NOT NULL OR (m.is_friend_session AND m.teams_set_at IS NOT NULL))
     AND EXISTS (SELECT 1 FROM memberships me
                  WHERE me.organization_id = p_organization_id AND me.user_id = auth.uid());
$$;

REVOKE ALL ON FUNCTION public.list_group_friend_matches(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_group_friend_matches(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_group_friend_matches(UUID) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT to_regprocedure('public.create_friend_match(date, time, text, double precision, double precision, boolean, text, integer, text, jsonb, text, uuid)') IS NOT NULL;  -- true
--   SELECT to_regprocedure('public.create_friend_match(date, time, text, double precision, double precision, boolean, text, integer, text, jsonb, text)') IS NULL;         -- true (saiu a antiga)
--   SELECT has_function_privilege('anon', 'public.create_friend_match(date, time, text, double precision, double precision, boolean, text, integer, text, jsonb, text, uuid)', 'EXECUTE');  -- false
