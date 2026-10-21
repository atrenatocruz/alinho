-- ════════════════════════════════════════════════════════════════════════
-- CLUBE E CONTA DE DEMONSTRAÇÃO PARA A REVISÃO DAS LOJAS (App Store / Play)
-- (native-apps, 21 out 2026)
--
-- PORQUÊ. A Apple (e a Google) só aprovam a app se o revisor conseguir
-- entrar e vê-la a funcionar. Sem clube, a app de uma conta nova está
-- vazia. Isto cria:
--   · a conta do revisor (email + palavra-passe, sem código por email),
--     já com o nível, o género e a política aceites — entra direto;
--   · o clube «alinho Demo», onde o revisor é admin, ESCONDIDO: não aparece
--     na pesquisa (searchable = false) e os mixes não se mostram a quem não
--     é membro (is_global = false);
--   · 11 jogadores de demonstração (não entram na app: palavra-passe
--     aleatória que ninguém sabe);
--   · um mix fechado há 3 dias, com resultados, fechado pela função a
--     sério (finalize_mix) — dá o ranking do clube, o histórico e o nível;
--   · dois mixes futuros: um onde o revisor já está, outro onde pode entrar.
--
-- FORA DO RANKING PÚBLICO. Todas as contas são @ensaio.alinho.test — o
-- ranking público e o de XP já excluem esse domínio
-- (migration_rankings_visiveis.sql). No ranking do clube Demo aparecem.
--
-- ESTE FICHEIRO NÃO É UMA MIGRAÇÃO. Corre-se uma vez, em produção, no
-- SQL Editor. Recusa correr duas vezes (se o clube já existir).
--
-- ANTES DE CORRER: trocar a palavra-passe em v_senha (é a que vai para o
-- App Store Connect → Informação para a revisão). Não fica no git.
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

DO $demo$
DECLARE
  v_senha   TEXT := 'TROCAR_PELA_PALAVRA_PASSE';     -- <- muda isto
  v_email   TEXT := 'appreview@ensaio.alinho.test';

  v_org     UUID;
  v_rev     UUID := gen_random_uuid();
  v_ids     UUID[] := ARRAY[]::UUID[];
  v_id      UUID;
  v_i       INT;

  v_passado UUID;
  v_quinta  UUID;
  v_sabado  UUID;
  t1 UUID; t2 UUID; t3 UUID; t4 UUID;

  -- Os jogadores de demonstração: nome, género, nível (Elo), jogos.
  v_gente   TEXT[][] := ARRAY[
    ['Tiago Martins',    'masculino', '1320', '24'],
    ['João Ferreira',    'masculino', '1285', '18'],
    ['Inês Costa',       'feminino',  '1240', '15'],
    ['Miguel Rocha',     'masculino', '1350', '30'],
    ['Sofia Lopes',      'feminino',  '1195', '11'],
    ['Pedro Almeida',    'masculino', '1230', '20'],
    ['Marta Silva',      'feminino',  '1210', '9'],
    ['Rui Carvalho',     'masculino', '1400', '27'],
    ['Ana Ribeiro',      'feminino',  '1265', '14'],
    ['Diogo Pinto',      'masculino', '1175', '8'],
    ['Carolina Gomes',   'feminino',  '1300', '22']
  ];
BEGIN
  IF v_senha = 'TROCAR_PELA_PALAVRA_PASSE' THEN
    RAISE EXCEPTION 'Muda a palavra-passe em v_senha antes de correr.';
  END IF;
  IF EXISTS (SELECT 1 FROM organizations WHERE slug = 'alinho-demo')
     OR EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
    RAISE EXCEPTION 'O clube alinho-demo (ou a conta %) já existe — não corre duas vezes.', v_email;
  END IF;

  -- ── 1. Contas (auth) — o trigger on_auth_user_created cria o perfil ──
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES ('00000000-0000-0000-0000-000000000000', v_rev, 'authenticated', 'authenticated', v_email,
          extensions.crypt(v_senha, extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb,
          jsonb_build_object('name', 'Rita Sousa'), now() - interval '20 days', now());

  FOR v_i IN 1 .. array_length(v_gente, 1) LOOP
    v_id := gen_random_uuid();
    v_ids := v_ids || v_id;
    INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    VALUES ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
            format('demo-%s@ensaio.alinho.test', lpad(v_i::text, 2, '0')),
            extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}'::jsonb,
            jsonb_build_object('name', v_gente[v_i][1]), now() - interval '60 days', now());
  END LOOP;

  -- O Auth do Supabase lê estes campos como texto: a NULL, o login (e o
  -- link mágico) falham com «Database error finding user».
  UPDATE auth.users SET
    confirmation_token = '', recovery_token = '', email_change = '',
    email_change_token_new = '', email_change_token_current = '',
    phone_change = '', phone_change_token = '', reauthentication_token = ''
  WHERE id = ANY (v_ids || v_rev);

  INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
  SELECT u.id::text, u.id,
         jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
         'email', now(), now()
    FROM auth.users u
   WHERE u.id = ANY (v_ids || v_rev);

  -- ── 2. Perfis completos (sem ecrãs de nível/género; sem email de boas-vindas)
  UPDATE profiles SET
    name = 'Rita Sousa', gender = 'feminino', birthday = DATE '1991-04-12',
    preferred_side = 'right', rating = 1260, rating_anchor = 1260, rating_games = 12,
    rating_onboarded_at = now() - interval '20 days',
    welcome_emailed_at = now(), results_visibility = 'public'
  WHERE id = v_rev;

  FOR v_i IN 1 .. array_length(v_gente, 1) LOOP
    UPDATE profiles SET
      name = v_gente[v_i][1], gender = v_gente[v_i][2],
      birthday = DATE '1985-01-01' + (v_i * 397),
      preferred_side = (ARRAY['left','right','both'])[1 + (v_i % 3)],
      rating = v_gente[v_i][3]::numeric, rating_anchor = v_gente[v_i][3]::int,
      rating_games = v_gente[v_i][4]::int,
      rating_onboarded_at = now() - interval '60 days',
      welcome_emailed_at = now(),
      consent_accepted_at = now(), consent_policy_version = '2026-10-16'
    WHERE id = v_ids[v_i];
  END LOOP;

  -- A partir daqui, «quem está a fazer» é o revisor (auth.uid()), como na app.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_rev::text, 'role', 'authenticated')::text, true);
  PERFORM complete_privacy_consent('2026-10-16');

  -- ── 3. O clube (escondido) e quem é membro ──────────────────────────
  INSERT INTO organizations (name, slug, kind, description, location, district,
                             is_global, searchable, open_join, owner_id)
  VALUES ('alinho Demo', 'alinho-demo', 'club',
          'Clube de demonstração para a revisão da app. Os jogadores e os jogos não são reais.',
          'Lisboa', 'Lisboa', false, false, false, v_rev)
  RETURNING id INTO v_org;

  INSERT INTO memberships (user_id, organization_id, is_admin, is_favorite)
  VALUES (v_rev, v_org, true, true);
  INSERT INTO memberships (user_id, organization_id)
  SELECT unnest(v_ids), v_org;

  -- ── 4. O mix de há 3 dias: criado aberto, inscrições, depois jogado ──
  INSERT INTO games (organization_id, title, date, location, max_players, num_courts,
                     court_time_minutes, game_time_minutes, format, created_by, price_per_player)
  VALUES (v_org, 'Mix de sexta à noite', now() + interval '1 day', 'alinho Demo · Lisboa',
          8, 2, 90, 25, 'todos_contra_todos', v_rev, 8)
  RETURNING id INTO v_passado;

  -- Cada pessoa inscreve-se a si própria (auth.uid() = ela), como na app.
  FOREACH v_id IN ARRAY (ARRAY[v_rev] || v_ids[1:7]) LOOP
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_id::text, 'role', 'authenticated')::text, true);
    INSERT INTO participants (game_id, user_id, status, joined_alone)
    VALUES (v_passado, v_id, 'confirmed', true);
  END LOOP;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_rev::text, 'role', 'authenticated')::text, true);

  -- Duplas fixas (todos contra todos): Rita+Tiago, João+Inês, Miguel+Sofia, Pedro+Marta.
  INSERT INTO teams (game_id, player1_id, player2_id, seed_ranking) VALUES (v_passado, v_rev,     v_ids[1], 2580) RETURNING id INTO t1;
  INSERT INTO teams (game_id, player1_id, player2_id, seed_ranking) VALUES (v_passado, v_ids[2], v_ids[3], 2525) RETURNING id INTO t2;
  INSERT INTO teams (game_id, player1_id, player2_id, seed_ranking) VALUES (v_passado, v_ids[4], v_ids[5], 2545) RETURNING id INTO t3;
  INSERT INTO teams (game_id, player1_id, player2_id, seed_ranking) VALUES (v_passado, v_ids[6], v_ids[7], 2440) RETURNING id INTO t4;

  UPDATE games SET status = 'in_progress',
                   date = date_trunc('day', now() - interval '3 days') + interval '19 hours 30 minutes',
                   round_duration_minutes = 25
   WHERE id = v_passado;

  -- 3 rondas × 2 campos. Vence o mix a dupla João+Inês (3 vitórias).
  INSERT INTO matches (game_id, round_number, court_number, team_a_id, team_b_id, score_a, score_b,
                       winner_team_id, scored_by, scored_at, phase)
  VALUES
    (v_passado, 1, 1, t1, t2, 4, 6, t2, v_rev, now() - interval '3 days', 'group'),
    (v_passado, 1, 2, t3, t4, 6, 3, t3, v_rev, now() - interval '3 days', 'group'),
    (v_passado, 2, 1, t1, t3, 6, 2, t1, v_rev, now() - interval '3 days', 'group'),
    (v_passado, 2, 2, t2, t4, 6, 4, t2, v_rev, now() - interval '3 days', 'group'),
    (v_passado, 3, 1, t1, t4, 6, 4, t1, v_rev, now() - interval '3 days', 'group'),
    (v_passado, 3, 2, t2, t3, 6, 3, t2, v_rev, now() - interval '3 days', 'group');

  -- Fecha como o botão «Terminar mix»: ranking do clube, XP, nível (Elo), troféus.
  PERFORM finalize_mix(v_passado, t2);

  -- ── 5. Dois mixes futuros ───────────────────────────────────────────
  -- Daqui a 6 dias: 6 inscritos, o revisor pode entrar (há 2 lugares).
  INSERT INTO games (organization_id, title, date, location, max_players, num_courts,
                     court_time_minutes, game_time_minutes, format, created_by, price_per_player)
  VALUES (v_org, 'Mix de quinta à noite',
          date_trunc('day', now() + interval '6 days') + interval '19 hours 30 minutes',
          'alinho Demo · Lisboa', 8, 2, 90, 20, 'sobe_desce', v_rev, 8)
  RETURNING id INTO v_quinta;

  FOREACH v_id IN ARRAY (v_ids[8:11] || v_ids[1:2]) LOOP
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_id::text, 'role', 'authenticated')::text, true);
    INSERT INTO participants (game_id, user_id, status, joined_alone)
    VALUES (v_quinta, v_id, 'confirmed', true);
  END LOOP;

  -- Daqui a 9 dias: o revisor já está inscrito, com mais 3.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_rev::text, 'role', 'authenticated')::text, true);
  INSERT INTO games (organization_id, title, date, location, max_players, num_courts,
                     court_time_minutes, game_time_minutes, format, created_by, price_per_player)
  VALUES (v_org, 'Mix de domingo de manhã',
          date_trunc('day', now() + interval '9 days') + interval '10 hours',
          'alinho Demo · Lisboa', 8, 2, 90, 20, 'todos_contra_todos', v_rev, 7)
  RETURNING id INTO v_sabado;

  FOREACH v_id IN ARRAY (ARRAY[v_rev] || v_ids[3:5]) LOOP
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_id::text, 'role', 'authenticated')::text, true);
    INSERT INTO participants (game_id, user_id, status, joined_alone)
    VALUES (v_sabado, v_id, 'confirmed', true);
  END LOOP;

  PERFORM set_config('request.jwt.claims', '', true);
  RAISE NOTICE 'Pronto. Clube %, revisor % (%).', v_org, v_email, v_rev;
END
$demo$;

COMMIT;

-- ── Verificar (correr a seguir) ─────────────────────────────────────────
-- Esperado: 12 membros · 3 mixes (1 finished, 2 open) · 8 no ranking com jogos
--   SELECT
--     (SELECT count(*) FROM memberships m JOIN organizations o ON o.id = m.organization_id WHERE o.slug = 'alinho-demo') AS membros,
--     (SELECT string_agg(g.title || ' = ' || g.status, ' | ' ORDER BY g.date) FROM games g JOIN organizations o ON o.id = g.organization_id WHERE o.slug = 'alinho-demo') AS mixes,
--     (SELECT count(*) FROM player_stats ps JOIN organizations o ON o.id = ps.organization_id WHERE o.slug = 'alinho-demo') AS no_ranking;

-- ── Se a revisão demorar e os mixes futuros ficarem no passado ──────────
--   UPDATE games g SET date = g.date + interval '7 days'
--     FROM organizations o
--    WHERE o.id = g.organization_id AND o.slug = 'alinho-demo' AND g.status <> 'finished';

-- ── Apagar tudo, quando a app já estiver aprovada e não for precisa ─────
-- (os pontos destas contas só mexem nelas; nenhuma pessoa real jogou aqui)
--   BEGIN;
--   DELETE FROM games         WHERE organization_id = (SELECT id FROM organizations WHERE slug = 'alinho-demo');
--   DELETE FROM organizations WHERE slug = 'alinho-demo';
--   DELETE FROM auth.users    WHERE email LIKE '%@ensaio.alinho.test' AND (email LIKE 'demo-%' OR email = 'appreview@ensaio.alinho.test');
--   COMMIT;
