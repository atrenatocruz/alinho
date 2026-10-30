-- ═════════════════════════════════════════════════════════════════════════
-- Jogos num grupo ou clube: só quem organiza cria; num grupo, pode criar
-- sem jogar
--
-- PORQUÊ. Francisco, 29 out (pelo PO e pela UX):
--   «Temos de tirar essa possibilidade de alguém criar um jogo sem ser admin
--   desse grupo. […] O utilizador ou cria no perfil dele ou cria um grupo
--   dele.» Depois: «sim, nos clubes também só o admin cria».
--   «Ou vou eu ou vão outros mas o admin pode criar o jogo para eles», e
--   «isto é só para os grupos» (num clube quem cria joga sempre).
-- Os jogos que já existem não mudam. Nenhum dado é mexido.
--
-- O QUE FAZ
--   1. private_matches.creator_plays (BOOLEAN NOT NULL DEFAULT TRUE): só
--      acrescenta; todos os jogos de hoje ficam «quem cria joga». A regra
--      private_matches_seat1_someone (o lugar 1 da equipa A nunca vazio)
--      passa a aceitar o lugar vazio só nesse jogo e só antes das equipas.
--   2. create_friend_match ganha p_creator_plays BOOLEAN DEFAULT TRUE (DROP +
--      CREATE: um 15.º parâmetro com o antigo ao lado deixava as chamadas sem
--      ele ambíguas). A app antiga chama sem ele e fica igual.
--      · Com p_organization_id (grupo ou clube): só is_org_admin (inclui o
--        superadmin com o modo ligado, mesmo escondido). Antes bastava ser
--        membro. Erro: «Só quem organiza pode criar jogos aqui.»,
--        HINT 'not_group_admin'.
--      · p_creator_plays = false: só num grupo (kind 'group' e plano que não
--        é Club). Fora disso: HINT 'creator_must_play'. Quem cria fica fora
--        das equipas e da lista de pessoas; são precisas 4 pessoas; não se
--        pode pôr a si próprio na lista.
--   3. create_group_match (jogo de grupo antigo, 3 lugares): só is_org_admin,
--      a mesma frase e o mesmo HINT; deixa de ter EXECUTE para anon.
--   4. Com um criador que não joga, por emenda de texto (1 vez, ou «já
--      estava»):
--      · remove_friend_match_round: ao tirar a última ronda já não o põe na
--        equipa A.
--      · get_friend_match: quem criou abre sempre o jogo; o 'match' leva
--        'creator_plays'.
--      · friend_match_add_invitee, friend_match_claim_guest e
--        claim_friend_match_invites_by_email: não o fazem entrar como
--        jogador («Quem organiza não joga neste jogo»; pelo email, salta).
--      · list_my_friend_match_invites: vê o jogo que organiza até haver
--        equipas (my_status 'organizer'), como quem disse «Vou».
--      · list_my_friend_sessions e list_live_events: levam 'creator_plays'.
--   Estatísticas, XP, ranking, avisos aos jogadores e confirmar o resultado
--   já vão pelos lugares nas equipas e pelos convidados: quem não joga não
--   conta (lidas as 113 funções dos jogos entre amigos, 29 out).
--
-- As frases são para a app antiga (o describeError mostra a frase de um
-- RAISE). A app nova decide pelo HINT, com chaves suas.
--
-- ORDEM. Qualquer. Corpos vivos iguais em produção e no alinho-dev (29 out).
--
-- Dev 3, 29 out 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. A coluna ──────────────────────────────────────────────────────────
ALTER TABLE public.private_matches ADD COLUMN IF NOT EXISTS creator_plays BOOLEAN NOT NULL DEFAULT TRUE;
-- O lugar 1 da equipa A tinha de ter sempre alguém (era o criador até haver
-- equipas). Passa a poder estar vazio só no jogo de quem organiza sem jogar,
-- enquanto não há equipas. Tudo o que existe já cumpre a regra antiga.
ALTER TABLE public.private_matches DROP CONSTRAINT IF EXISTS private_matches_seat1_someone;
ALTER TABLE public.private_matches ADD CONSTRAINT private_matches_seat1_someone
  CHECK (team_a_player1_id IS NOT NULL OR team_a_player1_guest_name IS NOT NULL
         OR (NOT creator_plays AND teams_set_at IS NULL));

-- ── 2. create_friend_match com p_creator_plays ──────────────────────────
DO $$
DECLARE
  v_old TEXT := 'public.create_friend_match(date,time without time zone,text,double precision,double precision,boolean,text,integer,text,jsonb,text,uuid,smallint,boolean)';
BEGIN
  IF to_regprocedure('public.create_friend_match(date,time without time zone,text,double precision,double precision,boolean,text,integer,text,jsonb,text,uuid,smallint,boolean,boolean)') IS NOT NULL THEN
    RAISE NOTICE 'create_friend_match já estava';
    RETURN;
  END IF;
  IF md5(replace(pg_get_functiondef(v_old::regprocedure), E'\r', '')) <> '9d49bd8fd99d249a73af5c33c48ad2cb' THEN
    RAISE EXCEPTION 'create_friend_match: o corpo não é o esperado. Parar.';
  END IF;
  EXECUTE 'DROP FUNCTION ' || v_old;
END $$;

CREATE OR REPLACE FUNCTION public.create_friend_match(
  p_scheduled_date DATE, p_scheduled_time TIME DEFAULT NULL, p_location TEXT DEFAULT NULL,
  p_location_latitude DOUBLE PRECISION DEFAULT NULL, p_location_longitude DOUBLE PRECISION DEFAULT NULL,
  p_ranked_intent BOOLEAN DEFAULT TRUE, p_scoring_format TEXT DEFAULT 'pontos_simples',
  p_num_sets INTEGER DEFAULT NULL, p_teams_mode TEXT DEFAULT 'manual', p_invitees JSONB DEFAULT '[]'::jsonb,
  p_court TEXT DEFAULT NULL, p_organization_id UUID DEFAULT NULL, p_game_minutes SMALLINT DEFAULT NULL,
  p_show_live BOOLEAN DEFAULT FALSE, p_creator_plays BOOLEAN DEFAULT TRUE)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id    UUID;
  v_item  JSONB;
  v_plays BOOLEAN := COALESCE(p_creator_plays, TRUE);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Precisas de ter sessão iniciada'; END IF;
  IF p_scheduled_date IS NULL THEN RAISE EXCEPTION 'A data do jogo é obrigatória'; END IF;
  IF p_scoring_format NOT IN ('pontos_simples', 'sets') THEN RAISE EXCEPTION 'Formato de pontuação inválido'; END IF;
  IF p_scoring_format = 'sets' AND p_num_sets IS NOT NULL AND p_num_sets NOT BETWEEN 2 AND 9 THEN
    RAISE EXCEPTION 'Escolhe quantos sets (entre 2 e 9)';
  END IF;
  IF p_scoring_format = 'pontos_simples' THEN p_num_sets := NULL; END IF;
  IF p_teams_mode NOT IN ('manual', 'app') THEN RAISE EXCEPTION 'Escolhe quem faz as equipas'; END IF;
  -- Jogo de grupo ou clube: só quem organiza (Francisco, 29 out). is_org_admin
  -- inclui o superadmin com o modo ligado, mesmo sem aparecer no grupo.
  IF p_organization_id IS NOT NULL AND NOT is_org_admin(p_organization_id) THEN
    RAISE EXCEPTION 'Só quem organiza pode criar jogos aqui.' USING HINT = 'not_group_admin';
  END IF;
  -- Criar sem jogar: só num grupo, nunca num clube nem no perfil (29 out).
  IF NOT v_plays AND NOT EXISTS (
       SELECT 1 FROM organizations o
        WHERE o.id = p_organization_id AND COALESCE(o.kind, 'group') = 'group'
          AND COALESCE(o.plan_tier, 'free') <> 'club') THEN
    RAISE EXCEPTION 'Aqui quem cria o jogo também joga.' USING HINT = 'creator_must_play';
  END IF;
  IF jsonb_typeof(p_invitees) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_invitees) < (CASE WHEN v_plays THEN 3 ELSE 4 END) THEN
    IF v_plays THEN RAISE EXCEPTION 'Faltam pessoas: são precisas pelo menos 4, contigo'; END IF;
    RAISE EXCEPTION 'Faltam pessoas: são precisas pelo menos 4';
  END IF;
  IF NOT v_plays AND EXISTS (SELECT 1 FROM jsonb_array_elements(p_invitees) x
                              WHERE NULLIF(x->>'user_id', '')::uuid = auth.uid()) THEN
    RAISE EXCEPTION 'Quem organiza não joga neste jogo';
  END IF;

  INSERT INTO private_matches (
    creator_id, team_a_player1_id, ranked_intent, scheduled_date, scheduled_time,
    location, location_latitude, location_longitude, scoring_format, num_sets,
    team_a_player1_status, is_friend_session, game_number, teams_mode, court, organization_id, game_minutes, show_live,
    creator_plays)
  VALUES (
    auth.uid(), CASE WHEN v_plays THEN auth.uid() END, p_ranked_intent, p_scheduled_date, p_scheduled_time,
    p_location, p_location_latitude, p_location_longitude, p_scoring_format, p_num_sets,
    CASE WHEN NOT v_plays THEN 'pending' WHEN p_ranked_intent THEN 'accepted_all' ELSE 'accepted_no_ranking' END,
    TRUE, 1, p_teams_mode,
    NULLIF(trim(p_court), ''), p_organization_id, p_game_minutes, COALESCE(p_show_live, FALSE),
    v_plays)
  RETURNING id INTO v_id;

  -- O criador também está na lista, já aceite (só se joga).
  IF v_plays THEN
    INSERT INTO private_match_invitees (match_id, user_id, status, invited_by, responded_at)
    VALUES (v_id, auth.uid(), 'accepted', auth.uid(), NOW());
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_invitees) LOOP
    PERFORM friend_match_add_invitee(v_id, v_item);
  END LOOP;
  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_friend_match(DATE, TIME, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, BOOLEAN, TEXT, INTEGER, TEXT, JSONB, TEXT, UUID, SMALLINT, BOOLEAN, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_friend_match(DATE, TIME, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, BOOLEAN, TEXT, INTEGER, TEXT, JSONB, TEXT, UUID, SMALLINT, BOOLEAN, BOOLEAN) TO authenticated;

-- ── 3 e 4. Emendas por texto aos corpos vivos ───────────────────────────
-- Cada função lê-se uma vez e leva todas as suas emendas juntas: ou todas
-- (cada uma 1 vez), ou «já estava» (todas já lá), ou pára.
DO $$
DECLARE
  f     TEXT;
  v_def TEXT;
  v_n   INT;
  v_tem INT;
  v_tot INT;
  r     RECORD;
BEGIN
  CREATE TEMP TABLE _emendas (fn TEXT, ord INT, old_txt TEXT, new_txt TEXT) ON COMMIT DROP;
  INSERT INTO _emendas VALUES
    ('public.create_group_match(uuid,boolean,date,time without time zone,text,double precision,double precision,uuid,uuid,uuid)', 1,
     E'  IF NOT EXISTS (\n    SELECT 1 FROM memberships WHERE organization_id = p_organization_id AND user_id = auth.uid()\n  ) THEN\n    RAISE EXCEPTION ''Não és membro deste grupo'';\n  END IF;',
     E'  -- Só quem organiza cria jogos num grupo ou clube (Francisco, 29 out).\n  IF NOT is_org_admin(p_organization_id) THEN\n    RAISE EXCEPTION ''Só quem organiza pode criar jogos aqui.'' USING HINT = ''not_group_admin'';\n  END IF;'),

    ('public.remove_friend_match_round(uuid,integer)', 1,
     E'team_a_player1_id = creator_id, team_a_player1_guest_name = NULL,\n        team_a_player1_status = CASE WHEN ranked_intent THEN ''accepted_all'' ELSE ''accepted_no_ranking'' END,',
     E'team_a_player1_id = CASE WHEN creator_plays THEN creator_id END, team_a_player1_guest_name = NULL,\n        team_a_player1_status = CASE WHEN NOT creator_plays THEN ''pending'' WHEN ranked_intent THEN ''accepted_all'' ELSE ''accepted_no_ranking'' END,'),

    ('public.get_friend_match(uuid)', 1,
     E'AND NOT friend_match_live_visible(v_root)',
     E'AND NOT friend_match_live_visible(v_root)\n     -- Quem criou abre sempre o seu jogo, mesmo sem jogar (29 out).\n     AND NOT EXISTS (SELECT 1 FROM private_matches c WHERE c.id = v_root AND c.creator_id = auth.uid())'),
    ('public.get_friend_match(uuid)', 2,
     E'''id'', m.id, ''creator_id'', m.creator_id, ''creator_name'', p.name,',
     E'''id'', m.id, ''creator_id'', m.creator_id, ''creator_name'', p.name, ''creator_plays'', m.creator_plays,'),

    ('public.friend_match_add_invitee(uuid,jsonb)', 1,
     E'  SELECT * INTO v_root FROM private_matches WHERE id = p_root;\n',
     E'  SELECT * INTO v_root FROM private_matches WHERE id = p_root;\n  -- Quem organiza sem jogar não entra como pessoa do jogo (29 out).\n  IF v_user IS NOT NULL AND v_user = v_root.creator_id AND NOT v_root.creator_plays THEN\n    RAISE EXCEPTION ''Quem organiza não joga neste jogo'';\n  END IF;\n'),

    ('public.friend_match_claim_guest(uuid)', 1,
     E'    RAISE EXCEPTION ''Já estás neste jogo'';\n  END IF;\n',
     E'    RAISE EXCEPTION ''Já estás neste jogo'';\n  END IF;\n  -- Quem organiza sem jogar não passa a jogador por um convite (29 out).\n  IF EXISTS (SELECT 1 FROM private_matches WHERE id = v_inv.match_id AND creator_id = auth.uid() AND NOT creator_plays) THEN\n    RAISE EXCEPTION ''Quem organiza não joga neste jogo'';\n  END IF;\n'),

    ('public.claim_friend_match_invites_by_email()', 1,
     E'WHERE j.match_id = i.match_id AND j.user_id = auth.uid()) LOOP',
     E'WHERE j.match_id = i.match_id AND j.user_id = auth.uid())\n                 -- quem organiza sem jogar não passa a jogador pelo email (29 out)\n                 AND NOT EXISTS (SELECT 1 FROM private_matches r WHERE r.id = i.match_id\n                                  AND r.creator_id = auth.uid() AND NOT r.creator_plays) LOOP'),

    ('public.list_my_friend_sessions()', 1,
     E'''is_creator'', m.creator_id = auth.uid(),\n           ''creator'', friend_match_person_json',
     E'''is_creator'', m.creator_id = auth.uid(), ''creator_plays'', m.creator_plays,\n           ''creator'', friend_match_person_json'),

    ('public.list_live_events(uuid)', 1,
     E'''kind'', ''friends'', ''id'', r.id, ''title'', NULL, ''creator_name'', r.creator_name,',
     E'''kind'', ''friends'', ''id'', r.id, ''title'', NULL, ''creator_name'', r.creator_name, ''creator_plays'', r.creator_plays,'),

    ('public.list_my_friend_match_invites()', 1,
     E'  SELECT COALESCE(jsonb_agg(jsonb_build_object(\n           ''match_id'', m.id, ''creator_name'', p.name,',
     E'  SELECT COALESCE(jsonb_agg(x.j ORDER BY x.d, x.t), ''[]''::jsonb) FROM (\n  SELECT m.scheduled_date AS d, m.scheduled_time AS t, jsonb_build_object(\n           ''match_id'', m.id, ''creator_name'', p.name,'),
    ('public.list_my_friend_match_invites()', 2,
     E'''is_creator'', m.creator_id = auth.uid(),\n',
     E'''is_creator'', m.creator_id = auth.uid(), ''creator_plays'', m.creator_plays,\n'),
    ('public.list_my_friend_match_invites()', 3,
     E'\n           ORDER BY m.scheduled_date, m.scheduled_time), ''[]''::jsonb)\n    FROM private_match_invitees i',
     E' AS j\n    FROM private_match_invitees i'),
    ('public.list_my_friend_match_invites()', 4,
     E'          AND i.email_declined_by IS DISTINCT FROM auth.uid());',
     E'          AND i.email_declined_by IS DISTINCT FROM auth.uid())\n  UNION ALL\n  -- Quem organiza sem jogar (29 out): vê o seu jogo até haver equipas,\n  -- como quem já disse «Vou».\n  SELECT m.scheduled_date, m.scheduled_time, jsonb_build_object(\n           ''match_id'', m.id, ''creator_name'', p.name, ''scheduled_date'', m.scheduled_date,\n           ''scheduled_time'', m.scheduled_time, ''location'', m.location,\n           ''people'', (SELECT count(*) FROM private_match_invitees x WHERE x.match_id = m.id AND x.status <> ''declined''),\n           ''teams_set'', FALSE, ''my_status'', ''organizer'', ''is_creator'', TRUE, ''creator_plays'', FALSE,\n           ''results_with_me'', 0)\n    FROM private_matches m\n    LEFT JOIN profiles p ON p.id = m.creator_id\n   WHERE m.is_friend_session AND m.creator_id = auth.uid() AND NOT m.creator_plays\n     AND m.teams_set_at IS NULL AND m.finished_at IS NULL\n  ) x;');

  FOR f IN SELECT DISTINCT fn FROM _emendas ORDER BY 1 LOOP
    v_def := replace(pg_get_functiondef(f::regprocedure), E'\r', '');
    SELECT count(*), count(*) FILTER (WHERE position(new_txt IN v_def) > 0) INTO v_tot, v_tem
      FROM _emendas WHERE fn = f;
    IF v_tem = v_tot THEN
      RAISE NOTICE '% já estava', f;
      CONTINUE;
    ELSIF v_tem > 0 THEN
      RAISE EXCEPTION '%: só parte das emendas está lá (% de %). Parar.', f, v_tem, v_tot;
    END IF;
    FOR r IN SELECT * FROM _emendas WHERE fn = f ORDER BY ord LOOP
      v_n := (length(v_def) - length(replace(v_def, r.old_txt, ''))) / length(r.old_txt);
      IF v_n <> 1 THEN
        RAISE EXCEPTION '% (emenda %): esperava 1 vez o texto, encontrei %. Parar.', f, r.ord, v_n;
      END IF;
      v_def := replace(v_def, r.old_txt, r.new_txt);
    END LOOP;
    EXECUTE v_def;
  END LOOP;
END $$;

-- O jogo de grupo antigo deixa de estar aberto a anon (os GRANT ficam a
-- authenticated e service_role).
REVOKE EXECUTE ON FUNCTION public.create_group_match(UUID, BOOLEAN, DATE, TIME, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, UUID, UUID, UUID) FROM PUBLIC, anon;

COMMIT;

-- Verificar depois de correr:
--   SELECT p.oid::regprocedure, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth
--     FROM pg_proc p WHERE proname IN ('create_friend_match', 'create_group_match');
--     → 1 create_friend_match (15 parâmetros, o último boolean) e 1 create_group_match; anon false, auth true nos dois
--   SELECT count(*) FROM pg_proc WHERE prosrc ~ 'creator_plays'
--      AND proname IN ('create_friend_match', 'remove_friend_match_round', 'get_friend_match',
--                      'friend_match_add_invitee', 'friend_match_claim_guest', 'claim_friend_match_invites_by_email',
--                      'list_my_friend_sessions', 'list_live_events', 'list_my_friend_match_invites');   → 9
--   SELECT position('is_org_admin' IN prosrc) > 0 FROM pg_proc WHERE proname = 'create_group_match';  → true
--   SELECT count(*) FROM private_matches WHERE NOT creator_plays;  → 0 (nada mudou nos jogos que existem)
