-- ═════════════════════════════════════════════════════════════════════════
-- Jogo entre amigos: «Terminar o jogo»
--
-- PORQUÊ. Francisco, 28 set («Sim aprovo», confirmado pela UX a 29 set),
-- design-handoff/2026-09-28-amigos-terminar/SPEC.md: «deveria haver forma de
-- salvar: para fechar e ir para os jogos entre amigos.» Ecrã: Bugs (nomes
-- dele).
--
-- O QUE FAZ
--   1. private_matches.finished_at (na raiz da sessão).
--   2. finish_friend_session(p_match_id) → jsonb {removed, notified}. Só
--      quem criou ('not_allowed'). Tira os jogos sem resultado (sem vencedor
--      e sem sets) — a raiz nunca sai, porque é ela que guarda a sessão. Sem
--      nenhum jogo com resultado → 'nothing_played' (aí é cancelar). Marca a
--      sessão como terminada e avisa quem ainda tem de confirmar um jogo com
--      resultado ('friend_match_finished' {match_id, name, scheduled_date}).
--      Terminar outra vez não faz nada ({removed: 0, notified: 0}).
--   3. add_friend_match_round e add_friend_match_game recusam 'finished'.
--      Corrigir um resultado que ainda não contou continua a poder.
--   4. get_friend_match: 'finished_at' no objeto match.
--   5. get_my_private_matches: coluna nova session_finished_at (o
--      finished_at da raiz). Muda o que devolve → DROP + CREATE a partir do
--      corpo vivo.
-- Trocas no corpo VIVO, cada uma 1 vez; «já estava».
--
-- Dev 3, 29 set 2026 · ecrã: Bugs
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE private_matches ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;

-- ── 2. Terminar ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finish_friend_session(p_match_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_root     private_matches%ROWTYPE;
  v_empty    UUID[];
  v_notified INTEGER;
BEGIN
  SELECT * INTO v_root FROM private_matches WHERE id = p_match_id AND is_friend_session FOR UPDATE;
  IF v_root.id IS NULL OR auth.uid() IS NULL OR v_root.creator_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  IF v_root.finished_at IS NOT NULL THEN
    RETURN jsonb_build_object('removed', 0, 'notified', 0);
  END IF;
  PERFORM 1 FROM private_matches WHERE session_id = v_root.id FOR UPDATE;

  IF NOT EXISTS (SELECT 1 FROM private_matches g
                  WHERE (g.id = v_root.id OR g.session_id = v_root.id)
                    AND (g.winner_team IS NOT NULL
                         OR EXISTS (SELECT 1 FROM private_match_sets s WHERE s.private_match_id = g.id))) THEN
    RAISE EXCEPTION 'nothing_played';
  END IF;

  -- Os jogos sem resultado saem (a raiz fica: é a sessão).
  SELECT COALESCE(array_agg(g.id), '{}') INTO v_empty
    FROM private_matches g
   WHERE g.session_id = v_root.id AND g.winner_team IS NULL
     AND NOT EXISTS (SELECT 1 FROM private_match_sets s WHERE s.private_match_id = g.id);
  UPDATE notifications SET read_at = NOW()
   WHERE read_at IS NULL AND data->>'match_id' = ANY (v_empty::text[]);
  DELETE FROM private_matches WHERE id = ANY (v_empty);

  UPDATE private_matches SET finished_at = NOW() WHERE id = v_root.id;

  -- Avisar quem ainda tem de confirmar um jogo com resultado.
  UPDATE notifications SET read_at = NOW()
   WHERE kind = 'friend_match_finished' AND read_at IS NULL AND data->>'match_id' = v_root.id::text;
  INSERT INTO notifications (user_id, kind, actor_id, data)
  SELECT DISTINCT t.pid, 'friend_match_finished', auth.uid(),
         jsonb_build_object('match_id', v_root.id,
                            'name', (SELECT name FROM profiles WHERE id = v_root.creator_id),
                            'scheduled_date', v_root.scheduled_date)
    FROM private_matches g,
         LATERAL (VALUES (g.team_a_player1_id, g.team_a_player1_status),
                         (g.team_a_player2_id, g.team_a_player2_status),
                         (g.team_b_player1_id, g.team_b_player1_status),
                         (g.team_b_player2_id, g.team_b_player2_status)) AS t(pid, st)
   WHERE (g.id = v_root.id OR g.session_id = v_root.id)
     AND g.winner_team IS NOT NULL
     AND t.pid IS NOT NULL AND t.st = 'pending' AND t.pid <> auth.uid();
  GET DIAGNOSTICS v_notified = ROW_COUNT;

  RETURN jsonb_build_object('removed', COALESCE(array_length(v_empty, 1), 0), 'notified', v_notified);
END;
$function$;
REVOKE ALL ON FUNCTION public.finish_friend_session(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finish_friend_session(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.finish_friend_session(UUID) TO authenticated;

-- ── 3, 4 e 5. Trocas no corpo vivo ──────────────────────────────────────
DO $$
DECLARE
  f     RECORD;
  v_def TEXT;
BEGIN
  -- 3. Depois de terminada, não se juntam rondas nem jogos.
  FOR f IN SELECT * FROM (VALUES
      ('public.add_friend_match_round(uuid, jsonb, smallint)'),
      ('public.add_friend_match_game(uuid, uuid[], uuid[])')) AS t(sig) LOOP
    v_def := pg_get_functiondef(f.sig::regprocedure);
    IF v_def LIKE '%''finished''%' THEN
      RAISE NOTICE '%: já estava', f.sig;
      CONTINUE;
    END IF;
    IF (SELECT count(*) FROM regexp_matches(v_def,
          '(IF v_root\.teams_set_at IS NULL THEN RAISE EXCEPTION ''Forma primeiro as equipas do primeiro jogo''; END IF;)', 'g')) <> 1 THEN
      RAISE EXCEPTION '%: o sítio da trava não aparece 1 vez. Parar e ler.', f.sig;
    END IF;
    EXECUTE regexp_replace(v_def,
      '(IF v_root\.teams_set_at IS NULL THEN RAISE EXCEPTION ''Forma primeiro as equipas do primeiro jogo''; END IF;)',
      '\1
  -- Jogo terminado: não se juntam mais (Terminar o jogo, 28 set).
  IF v_root.finished_at IS NOT NULL THEN RAISE EXCEPTION ''finished''; END IF;');
  END LOOP;

  -- 4. get_friend_match: finished_at no match.
  v_def := pg_get_functiondef('public.get_friend_match(uuid)'::regprocedure);
  IF v_def LIKE '%''finished_at''%' THEN
    RAISE NOTICE 'get_friend_match: já estava';
  ELSIF (SELECT count(*) FROM regexp_matches(v_def, '(''game_minutes'', m\.game_minutes)', 'g')) <> 1 THEN
    RAISE EXCEPTION 'get_friend_match: o game_minutes não aparece 1 vez. Parar e ler.';
  ELSE
    EXECUTE regexp_replace(v_def, '(''game_minutes'', m\.game_minutes)', '''finished_at'', m.finished_at, \1');
  END IF;

  -- 5. get_my_private_matches: session_finished_at (muda o que devolve).
  v_def := pg_get_functiondef('public.get_my_private_matches()'::regprocedure);
  IF v_def LIKE '%session_finished_at%' THEN
    RAISE NOTICE 'get_my_private_matches: já estava';
  ELSIF (SELECT count(*) FROM regexp_matches(v_def, '(pairing_mode text)\)', 'g')) <> 1
     OR (SELECT count(*) FROM regexp_matches(v_def, '(pm\.pairing_mode)(\s+FROM private_matches pm)', 'g')) <> 1 THEN
    RAISE EXCEPTION 'get_my_private_matches: os pedaços a trocar não aparecem 1 vez. Parar e ler.';
  ELSE
    v_def := regexp_replace(v_def, '(pairing_mode text)\)', '\1, session_finished_at timestamp with time zone)');
    v_def := regexp_replace(v_def, '(pm\.pairing_mode)(\s+FROM private_matches pm)',
      '\1,
    (SELECT r.finished_at FROM private_matches r WHERE r.id = COALESCE(pm.session_id, pm.id))\2');
    DROP FUNCTION public.get_my_private_matches();
    EXECUTE v_def;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.get_my_private_matches() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_private_matches() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_private_matches() TO authenticated;
REVOKE ALL ON FUNCTION public.get_friend_match(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_friend_match(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_friend_match(uuid) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT count(*) FROM pg_proc WHERE proname IN ('add_friend_match_round', 'add_friend_match_game')
--      AND pg_get_functiondef(oid) LIKE '%''finished''%';  -- 2
--   SELECT pg_get_functiondef('public.get_my_private_matches()'::regprocedure) LIKE '%session_finished_at%';  -- true
--   SELECT has_function_privilege('anon', 'public.get_my_private_matches()', 'EXECUTE');  -- false
--   SELECT has_function_privilege('anon', 'public.finish_friend_session(uuid)', 'EXECUTE');  -- false
