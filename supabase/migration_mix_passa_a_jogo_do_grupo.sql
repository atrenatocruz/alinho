-- ═════════════════════════════════════════════════════════════════════════
-- Mix que não encheu: «Passar a Jogo do grupo» (ou «a Jogo do clube»)
-- Cartão #740 (https://trello.com/c/vihnPaZM)
--
-- PORQUÊ. Desenho aprovado pelo Francisco a 29 out, com o Renato e o Ruben
-- de acordo (design-handoff/2026-10-29-mix-passa-a-jogo-do-grupo/SPEC.md,
-- ponto 5). Plano da base aprovado pelo Francisco a 29 out («sim, podes
-- avançar»). Quem organiza um mix que não encheu passa-o a um jogo de 1
-- campo sem voltar a escrever tudo; cada inscrito responde se vai.
--
-- O QUE FAZ (só acrescenta; a app das lojas vê o mix só como cancelado)
--   1. games.passed_to_match_id: para que jogo passou o mix (o «Ver o jogo ›»
--      e a marca para o robô não anunciar este cancelamento).
--      private_matches.from_game_id: de que mix veio o jogo.
--   2. convert_mix_to_friend_match(p_game_id, …os parâmetros do
--      create_friend_match…): numa só operação, cria o jogo (pelo
--      create_friend_match, no grupo ou clube do mix) e cancela o mix. Ou as
--      duas, ou nenhuma.
--      · Só quem organiza (is_org_admin, superadmin com o modo ligado
--        incluído): HINT 'not_group_admin'.
--      · Só um mix (origin 'admin') publicado com as inscrições abertas
--        (status 'open') e antes da hora: HINT 'mix_not_open'.
--      · No máximo 7 pessoas: o trigger da migration_jogo_ate_7_pessoas.
--      · Inscritos que não são membros do grupo entram na mesma, só neste
--        caminho e só se estavam inscritos no mix (com lugar, como titular
--        ou como parceiro).
--      · Convidados sem conta com o mesmo nome: o segundo fica «Nome (2)».
--      · O convite de cada um leva 'from_game_id' e 'from_game_title'.
--   3. notify_mix_cancelled (emenda de texto): quem foi convidado para o
--      jogo não recebe o aviso de mix cancelado. Quem não foi (suplentes, ou
--      quem quem organiza tirou da lista) recebe-o como hoje.
--   4. friend_match_add_invitee (emenda de texto): a exceção dos não-membros
--      do ponto 2, por friend_match_from_mix_allows.
--   5. get_friend_match (emenda de texto): o 'match' leva 'from_game_id' e
--      'from_game_title'.
--   O mix cancelado assim não mexe em XP, ranking nem estatísticas (nenhuma
--   função conta mixes cancelados por pessoa; lido em produção, 29 out).
--
-- FICA PARA O RENATO (robô). Um mix com passed_to_match_id preenchido não se
-- anuncia como cancelado no grupo do WhatsApp. O PO combina com ele.
--
-- ORDEM. Depois da migration_jogo_so_o_admin_cria.sql (usa o
-- create_friend_match de 15 parâmetros e a emenda dela ao get_friend_match)
-- e da migration_jogo_ate_7_pessoas.sql.
--
-- Dev 3, 29 out 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Colunas ────────────────────────────────────────────────────────────
ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS passed_to_match_id UUID REFERENCES public.private_matches(id) ON DELETE SET NULL;
ALTER TABLE public.private_matches
  ADD COLUMN IF NOT EXISTS from_game_id UUID REFERENCES public.games(id) ON DELETE SET NULL;

-- ── 2a. Quem pode entrar num Jogo do grupo sem ser membro ────────────────
-- Só durante convert_mix_to_friend_match (marca local à transação) e só
-- quem estava inscrito com lugar nesse mix, do mesmo grupo ou clube.
CREATE OR REPLACE FUNCTION public.friend_match_from_mix_allows(p_org UUID, p_user UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_game UUID;
BEGIN
  BEGIN
    v_game := NULLIF(current_setting('alinho.from_mix_game', true), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN FALSE;
  END;
  IF v_game IS NULL OR p_user IS NULL THEN
    RETURN FALSE;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM games g JOIN participants p ON p.game_id = g.id
     WHERE g.id = v_game AND g.organization_id = p_org
       AND p.status = 'confirmed' AND p_user IN (p.user_id, p.partner_id));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.friend_match_from_mix_allows(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- ── 2b. Passar o mix a jogo ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.convert_mix_to_friend_match(
  p_game_id UUID,
  p_scheduled_date DATE, p_scheduled_time TIME DEFAULT NULL, p_location TEXT DEFAULT NULL,
  p_location_latitude DOUBLE PRECISION DEFAULT NULL, p_location_longitude DOUBLE PRECISION DEFAULT NULL,
  p_ranked_intent BOOLEAN DEFAULT TRUE, p_scoring_format TEXT DEFAULT 'pontos_simples',
  p_num_sets INTEGER DEFAULT NULL, p_teams_mode TEXT DEFAULT 'manual', p_invitees JSONB DEFAULT '[]'::jsonb,
  p_court TEXT DEFAULT NULL, p_game_minutes SMALLINT DEFAULT NULL,
  p_show_live BOOLEAN DEFAULT FALSE, p_creator_plays BOOLEAN DEFAULT TRUE)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_game     games;
  v_id       UUID;
  v_invitees JSONB := '[]'::jsonb;
  v_item     JSONB;
  v_name     TEXT;
  v_seen     TEXT[] := '{}';
  v_n        INT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Precisas de ter sessão iniciada'; END IF;

  SELECT * INTO v_game FROM games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND OR v_game.organization_id IS NULL THEN
    RAISE EXCEPTION 'Mix não encontrado';
  END IF;
  IF NOT is_org_admin(v_game.organization_id) THEN
    RAISE EXCEPTION 'Só quem organiza pode passar este mix a jogo.' USING HINT = 'not_group_admin';
  END IF;
  IF v_game.origin IS DISTINCT FROM 'admin' OR v_game.status IS DISTINCT FROM 'open' OR v_game.date <= NOW() THEN
    RAISE EXCEPTION 'Este mix já não pode passar a jogo.' USING HINT = 'mix_not_open';
  END IF;

  -- Convidados sem conta com o mesmo nome: «Nome (2)», «Nome (3)»…
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_invitees, '[]'::jsonb)) LOOP
    v_name := NULLIF(trim(v_item->>'guest_name'), '');
    IF NULLIF(v_item->>'user_id', '') IS NULL AND v_name IS NOT NULL THEN
      IF lower(v_name) = ANY (v_seen) THEN
        v_n := 2;
        WHILE lower(v_name || ' (' || v_n || ')') = ANY (v_seen) LOOP v_n := v_n + 1; END LOOP;
        v_name := v_name || ' (' || v_n || ')';
      END IF;
      v_seen := v_seen || lower(v_name);
      v_item := v_item || jsonb_build_object('guest_name', v_name);
    END IF;
    v_invitees := v_invitees || jsonb_build_array(v_item);
  END LOOP;

  PERFORM set_config('alinho.from_mix_game', p_game_id::text, true);
  v_id := create_friend_match(
    p_scheduled_date => p_scheduled_date, p_scheduled_time => p_scheduled_time, p_location => p_location,
    p_location_latitude => p_location_latitude, p_location_longitude => p_location_longitude,
    p_ranked_intent => p_ranked_intent, p_scoring_format => p_scoring_format, p_num_sets => p_num_sets,
    p_teams_mode => p_teams_mode, p_invitees => v_invitees, p_court => p_court,
    p_organization_id => v_game.organization_id, p_game_minutes => p_game_minutes,
    p_show_live => p_show_live, p_creator_plays => p_creator_plays);
  PERFORM set_config('alinho.from_mix_game', '', true);

  UPDATE private_matches SET from_game_id = p_game_id WHERE id = v_id;

  UPDATE notifications
     SET data = data || jsonb_build_object('from_game_id', p_game_id, 'from_game_title', v_game.title)
   WHERE kind = 'friend_match_invite' AND data->>'match_id' = v_id::text;

  -- O passed_to_match_id vai no mesmo UPDATE: o notify_mix_cancelled já o vê.
  UPDATE games SET status = 'cancelled', passed_to_match_id = v_id WHERE id = p_game_id;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.convert_mix_to_friend_match(UUID, DATE, TIME, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, BOOLEAN, TEXT, INTEGER, TEXT, JSONB, TEXT, SMALLINT, BOOLEAN, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.convert_mix_to_friend_match(UUID, DATE, TIME, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, BOOLEAN, TEXT, INTEGER, TEXT, JSONB, TEXT, SMALLINT, BOOLEAN, BOOLEAN) TO authenticated;

-- ── 3 a 5. Emendas por texto aos corpos vivos ────────────────────────────
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
  DROP TABLE IF EXISTS pg_temp._emendas;
  CREATE TEMP TABLE _emendas (fn TEXT, ord INT, old_txt TEXT, new_txt TEXT) ON COMMIT DROP;
  INSERT INTO _emendas VALUES
    ('public.notify_mix_cancelled()', 1,
     E'     AND who.user_id <> auth.uid();',
     E'     AND who.user_id <> auth.uid()\n     -- Passou a Jogo do grupo (#740): quem foi convidado recebe só o convite.\n     AND NOT EXISTS (SELECT 1 FROM private_match_invitees i\n                      WHERE NEW.passed_to_match_id IS NOT NULL\n                        AND i.match_id = NEW.passed_to_match_id AND i.user_id = who.user_id);'),

    ('public.friend_match_add_invitee(uuid,jsonb)', 1,
     E'       SELECT 1 FROM memberships WHERE organization_id = v_root.organization_id AND user_id = v_user) THEN\n    RAISE EXCEPTION ''not_a_member'';',
     E'       SELECT 1 FROM memberships WHERE organization_id = v_root.organization_id AND user_id = v_user)\n     -- Inscrito no mix que passou a este jogo (#740): entra sem ser membro.\n     AND NOT friend_match_from_mix_allows(v_root.organization_id, v_user) THEN\n    RAISE EXCEPTION ''not_a_member'';'),

    ('public.get_friend_match(uuid)', 1,
     E'''id'', m.id, ''creator_id'', m.creator_id, ''creator_name'', p.name, ''creator_plays'', m.creator_plays,',
     E'''id'', m.id, ''creator_id'', m.creator_id, ''creator_name'', p.name, ''creator_plays'', m.creator_plays,\n           ''from_game_id'', m.from_game_id, ''from_game_title'', (SELECT g.title FROM games g WHERE g.id = m.from_game_id),');

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

COMMIT;

-- Verificar depois de correr:
--   SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth
--     FROM pg_proc p WHERE proname = 'convert_mix_to_friend_match';                → false, true
--   SELECT has_function_privilege('authenticated', 'public.friend_match_from_mix_allows(uuid,uuid)', 'EXECUTE');  → false
--   SELECT proname FROM pg_proc WHERE proname IN ('notify_mix_cancelled', 'friend_match_add_invitee', 'get_friend_match')
--      AND prosrc ~ '(passed_to_match_id|friend_match_from_mix_allows|from_game_id)';  → as 3
--   SELECT count(*) FROM games WHERE passed_to_match_id IS NOT NULL;             → 0
