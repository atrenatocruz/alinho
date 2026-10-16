-- ═════════════════════════════════════════════════════════════════════════
-- Jogos entre amigos: a lista diz quem criou e quem enviou
--
-- PORQUÊ. Pedido do Francisco para a lista nova («Criado por ti» /
-- «Criado por <nome>»), via Bugs, 12 out.
--
-- O QUE FAZ. list_my_friend_sessions ganha, por jogo:
--   · creator {user_id, name, avatar_url};
--   · sent_by {user_id, name} depois de enviado (NULL antes), como no
--     get_friend_match.
-- Corpo VIVO, 1 troca literal («já estava»); devolve jsonb na mesma.
--
-- ORDEM. Depois de migration_amigos_lista_com_vida.sql.
--
-- Dev 3, 12 out 2026 · ecrã: Bugs
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  c_frag CONSTANT TEXT := $a$'location', m.location, 'court', m.court, 'is_creator', m.creator_id = auth.uid(),$a$;
  v_def  TEXT := pg_get_functiondef('public.list_my_friend_sessions()'::regprocedure);
BEGIN
  IF v_def LIKE '%''sent_by''%' THEN
    RAISE NOTICE 'list_my_friend_sessions: já estava';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, c_frag, ''))) / length(c_frag) <> 1 THEN
    RAISE EXCEPTION 'list_my_friend_sessions: o pedaço a trocar não aparece 1 vez (correu o migration_amigos_lista_com_vida.sql?). Parar e ler.';
  END IF;
  EXECUTE replace(v_def, c_frag, c_frag
    || E'\n           ''creator'', friend_match_person_json(m.creator_id, NULL),'
    || E'\n           ''sent_by'', (SELECT jsonb_build_object(''user_id'', sp.id, ''name'', sp.name) FROM profiles sp WHERE sp.id = m.result_sent_by),');
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_functiondef('public.list_my_friend_sessions()'::regprocedure) LIKE '%''sent_by''%';  -- true
