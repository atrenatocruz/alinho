-- ═════════════════════════════════════════════════════════════════════════
-- Jogo do grupo: mudar o «Vais jogar?» no Editar
-- Cartão #736 (https://trello.com/c/UqoyE5Nv)
--
-- PORQUÊ. O SPEC da UX (design-handoff/2026-10-29-jogo-de-grupo-sem-jogar/
-- SPEC.md, §5) põe o «Vais jogar?» também no Editar, com cadeado quando já há
-- resultados (regra «Editar tem tudo do Criar»). A migration_jogo_so_o_admin_
-- cria.sql só o deixa escolher ao criar. Pedido do Dev 2, 30 out.
--
-- O QUE FAZ. update_friend_match ganha p_creator_plays BOOLEAN DEFAULT NULL
-- (DROP da versão de 13 argumentos + CREATE com 14; NULL = não mexe, por isso
-- a app das lojas, que não o manda, continua igual). O resto do corpo é o de
-- produção de 30 out, sem mudanças (md5 9551fa18…, igual no alinho-dev).
--   · Muda só se for diferente do que está.
--   · Cadeado: com algum resultado, e também com equipas feitas ou rondas
--     criadas (o lugar 1 da equipa A já está ocupado nas equipas; mudar aí
--     obrigava a refazê-las) → 'creator_plays_locked' (como o format_locked
--     e o teams_locked).
--   · Passar a false: só num grupo (kind 'group' e plano que não é Club),
--     como ao criar; fora disso HINT 'creator_must_play'. Tira a linha de
--     quem organiza da lista e esvazia o lugar 1 da equipa A.
--   · Passar a true: quem organiza volta à lista como 'accepted' e ao lugar 1
--     da equipa A. Se o jogo já tiver 7, o trigger da migration_jogo_ate_7
--     recusa com HINT 'friend_match_full'.
-- REVOKE de PUBLIC e anon (o DROP + CREATE dava EXECUTE a anon).
--
-- ORDEM. Depois da migration_jogo_so_o_admin_cria.sql (usa creator_plays) e
-- da migration_jogo_ate_7_pessoas.sql (o trigger das 7).
--
-- Dev 3, 30 out 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- Só troca se o corpo de hoje for o esperado, ou se já estiver trocado.
DO $$
DECLARE
  v_old REGPROCEDURE := to_regprocedure('public.update_friend_match(uuid,date,time without time zone,text,double precision,double precision,text,smallint,text,smallint,boolean,boolean,text)');
  v_new REGPROCEDURE := to_regprocedure('public.update_friend_match(uuid,date,time without time zone,text,double precision,double precision,text,smallint,text,smallint,boolean,boolean,text,boolean)');
BEGIN
  IF v_new IS NOT NULL AND v_old IS NULL THEN
    RAISE NOTICE 'update_friend_match já estava';
  ELSIF v_old IS NULL THEN
    RAISE EXCEPTION 'update_friend_match: não encontrei a versão de 13 argumentos. Parar.';
  ELSIF md5(replace((SELECT prosrc FROM pg_proc WHERE oid = v_old), E'\r', '')) <> '9551fa18157cd01f51d4284d5425f4f1' THEN
    RAISE EXCEPTION 'update_friend_match: o corpo não é o esperado (md5 %). Parar.',
      md5(replace((SELECT prosrc FROM pg_proc WHERE oid = v_old), E'\r', ''));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'private_matches' AND column_name = 'creator_plays') THEN
    RAISE EXCEPTION 'Falta a migration_jogo_so_o_admin_cria.sql (coluna creator_plays). Parar.';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.update_friend_match(UUID, DATE, TIME, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, SMALLINT, TEXT, SMALLINT, BOOLEAN, BOOLEAN, TEXT);

CREATE OR REPLACE FUNCTION public.update_friend_match(
  p_match_id UUID, p_scheduled_date DATE, p_scheduled_time TIME, p_location TEXT,
  p_location_latitude DOUBLE PRECISION, p_location_longitude DOUBLE PRECISION,
  p_court TEXT, p_game_minutes SMALLINT, p_scoring_format TEXT, p_num_sets SMALLINT,
  p_show_live BOOLEAN DEFAULT NULL, p_ranked_intent BOOLEAN DEFAULT NULL,
  p_teams_mode TEXT DEFAULT NULL, p_creator_plays BOOLEAN DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_root private_matches%ROWTYPE;
BEGIN
  SELECT * INTO v_root FROM private_matches WHERE id = p_match_id AND is_friend_session FOR UPDATE;
  IF v_root.id IS NULL OR auth.uid() IS NULL OR NOT friend_match_is_organizer(v_root.id) THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  IF p_scheduled_date IS NULL THEN RAISE EXCEPTION 'A data do jogo é obrigatória'; END IF;
  IF p_game_minutes IS NOT NULL AND p_game_minutes NOT IN (15, 20, 30) THEN
    RAISE EXCEPTION 'bad_duration';
  END IF;
  IF p_scoring_format NOT IN ('pontos_simples', 'sets')
     OR (p_scoring_format = 'sets' AND p_num_sets IS NOT NULL AND p_num_sets NOT BETWEEN 2 AND 9) THEN
    RAISE EXCEPTION 'bad_format';
  END IF;
  IF p_scoring_format = 'pontos_simples' THEN p_num_sets := NULL; END IF;
  -- Com algum resultado marcado, a forma de contar já não muda.
  IF (p_scoring_format, p_num_sets::INTEGER) IS DISTINCT FROM (v_root.scoring_format, v_root.num_sets)
     AND EXISTS (SELECT 1 FROM private_matches
                  WHERE (id = v_root.id OR session_id = v_root.id) AND winner_team IS NOT NULL) THEN
    RAISE EXCEPTION 'format_locked';
  END IF;

  -- «Vais jogar?» (30 out): só antes de haver equipas, rondas ou resultados.
  IF p_creator_plays IS NOT NULL AND p_creator_plays IS DISTINCT FROM v_root.creator_plays THEN
    IF v_root.teams_set_at IS NOT NULL
       OR EXISTS (SELECT 1 FROM private_matches
                   WHERE session_id = v_root.id OR (id = v_root.id AND winner_team IS NOT NULL)) THEN
      RAISE EXCEPTION 'creator_plays_locked';
    END IF;
    IF NOT p_creator_plays THEN
      -- Organizar sem jogar: só num grupo, nunca num clube nem no perfil.
      IF NOT EXISTS (
           SELECT 1 FROM organizations o
            WHERE o.id = v_root.organization_id AND COALESCE(o.kind, 'group') = 'group'
              AND COALESCE(o.plan_tier, 'free') <> 'club') THEN
        RAISE EXCEPTION 'Aqui quem cria o jogo também joga.' USING HINT = 'creator_must_play';
      END IF;
      DELETE FROM private_match_invitees WHERE match_id = v_root.id AND user_id = v_root.creator_id;
      UPDATE private_matches
         SET creator_plays = FALSE, team_a_player1_id = NULL, team_a_player1_guest_name = NULL,
             team_a_player1_status = 'pending'
       WHERE id = v_root.id;
    ELSE
      UPDATE private_matches
         SET creator_plays = TRUE, team_a_player1_id = creator_id, team_a_player1_guest_name = NULL,
             team_a_player1_status = CASE WHEN ranked_intent THEN 'accepted_all' ELSE 'accepted_no_ranking' END
       WHERE id = v_root.id;
      -- A linha passa pelo trigger das 7 pessoas.
      INSERT INTO private_match_invitees (match_id, user_id, status, invited_by, responded_at)
      VALUES (v_root.id, v_root.creator_id, 'accepted', v_root.creator_id, NOW());
    END IF;
  END IF;

  -- Uma sessão só: a data, o sítio e a forma de contar valem para todos os jogos.
  UPDATE private_matches
     SET scheduled_date = p_scheduled_date, scheduled_time = p_scheduled_time,
         location = NULLIF(trim(p_location), ''), location_latitude = p_location_latitude,
         location_longitude = p_location_longitude, court = NULLIF(trim(p_court), ''),
         scoring_format = p_scoring_format, num_sets = p_num_sets
   WHERE id = v_root.id OR session_id = v_root.id;
  -- A duração: a da sessão, e a dos jogos que faltam (os já jogados ficam).
  -- Quem faz as equipas: só enquanto não houver resultados.
  IF p_teams_mode IS NOT NULL AND p_teams_mode IS DISTINCT FROM v_root.teams_mode THEN
    IF p_teams_mode NOT IN ('manual', 'app') THEN RAISE EXCEPTION 'bad_format'; END IF;
    IF EXISTS (SELECT 1 FROM private_matches
                WHERE (id = v_root.id OR session_id = v_root.id) AND winner_team IS NOT NULL) THEN
      RAISE EXCEPTION 'teams_locked';
    END IF;
    UPDATE private_matches SET teams_mode = p_teams_mode WHERE id = v_root.id;
  END IF;
  -- Conta para o ranking?: só enquanto nenhum jogo contou.
  IF p_ranked_intent IS NOT NULL AND p_ranked_intent IS DISTINCT FROM v_root.ranked_intent THEN
    PERFORM friend_match_set_ranked(v_root.id, p_ranked_intent);
  END IF;
  UPDATE private_matches SET show_live = COALESCE(p_show_live, show_live) WHERE id = v_root.id;
  UPDATE private_matches SET game_minutes = p_game_minutes
   WHERE id = v_root.id
      OR (session_id = v_root.id AND started_at IS NULL AND winner_team IS NULL);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_friend_match(UUID, DATE, TIME, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, SMALLINT, TEXT, SMALLINT, BOOLEAN, BOOLEAN, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_friend_match(UUID, DATE, TIME, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, SMALLINT, TEXT, SMALLINT, BOOLEAN, BOOLEAN, TEXT, BOOLEAN) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT p.oid::regprocedure, has_function_privilege('anon', p.oid, 'EXECUTE'),
--          has_function_privilege('authenticated', p.oid, 'EXECUTE')
--     FROM pg_proc p WHERE proname = 'update_friend_match';
--     → 1 linha, com 14 argumentos (o último boolean), false, true
--   SELECT position('creator_plays_locked' IN prosrc) > 0 FROM pg_proc WHERE proname = 'update_friend_match';  → true
