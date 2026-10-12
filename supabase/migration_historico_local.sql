-- ═════════════════════════════════════════════════════════════════════════
-- Perfil › Jogos: o sítio escrito nos jogos entre amigos
--
-- PORQUÊ. UX via Dev 4, 12 out: nos jogos entre amigos sem clube a linha de
-- baixo mostra o sítio escrito no jogo («Serra Azul Padel»).
--
-- O QUE FAZ. get_my_played_history ganha 'location' em cada linha:
-- private_matches.location nos jogos entre amigos, NULL nos outros. Corpo
-- VIVO, 1 troca literal («já estava»); devolve jsonb na mesma.
--
-- ORDEM. Depois de migration_lugares_e_historico.sql.
--
-- Dev 3, 12 out 2026 · ecrã: Dev 4
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  c_frag CONSTANT TEXT := $a$'rounds_won', p.rounds_won,$a$;
  v_def  TEXT := pg_get_functiondef('public.get_my_played_history(uuid,timestamptz,integer)'::regprocedure);
BEGIN
  IF v_def LIKE '%''location''%' THEN
    RAISE NOTICE 'get_my_played_history: já estava';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, c_frag, ''))) / length(c_frag) <> 1 THEN
    RAISE EXCEPTION 'get_my_played_history: o pedaço a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE replace(v_def, c_frag,
    $b$'location', CASE WHEN p.src IN ('friends', 'classic') THEN (SELECT x.location FROM private_matches x WHERE x.id = p.ref) END, $b$ || c_frag);
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_functiondef('public.get_my_played_history(uuid,timestamptz,integer)'::regprocedure) LIKE '%''location''%';  -- true
