-- ═════════════════════════════════════════════════════════════════════════
-- Categorias que chocam: o convidado só conta depois de aceitar
--
-- PORQUÊ. QA, 13 out (via PO, para o main de sexta, porque o aviso de
-- choques — migration_torneio_categorias_chocam.sql, 3o — vai nele): a
-- tournament_clash_rows contava os dois jogadores de uma inscrição em
-- 'convite'. Pela regra do #630 (convites por aceitar não contam), numa
-- inscrição em 'convite' só conta quem a fez. O Dev 1 já fez o mesmo no
-- ecrã do jogador (36b22dfb). Caso: «Ensaio categorias max 3» › Duplas
-- dizia 3 jogadores em vez de 2.
--
-- O QUE FAZ. tournament_clash_rows: numa inscrição em 'convite', o 2.º
-- jogador não entra na conta. Como a lista do organizador
-- (tournament_player_clashes), a minha (my_category_clashes), a trava de
-- fechar e sortear e o aviso de jogos sobrepostos leem todos daqui, quem
-- não aceitou deixa de aparecer em todos — e o «Tirar do M3» nunca lhe
-- aparece. Corpo VIVO, 1 troca literal («já estava»).
--
-- ORDEM. Depois de migration_torneio_categorias_chocam.sql.
--
-- Dev 3, 13 out 2026 · ecrã: Dev 1
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  c_mau CONSTANT TEXT := 'CROSS JOIN LATERAL (VALUES (e.player1_id), (e.player2_id)) AS x(uid)';
  c_bom CONSTANT TEXT := $a$CROSS JOIN LATERAL (VALUES (e.player1_id), (CASE WHEN e.status <> 'convite' THEN e.player2_id END)) AS x(uid)$a$;
  v_def TEXT := pg_get_functiondef('public.tournament_clash_rows(uuid)'::regprocedure);
BEGIN
  IF position(c_bom IN v_def) > 0 THEN
    RAISE NOTICE 'tournament_clash_rows: já estava';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, c_mau, ''))) / length(c_mau) <> 1 THEN
    RAISE EXCEPTION 'tournament_clash_rows: o pedaço a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE replace(v_def, c_mau, c_bom);
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_functiondef('public.tournament_clash_rows(uuid)'::regprocedure) LIKE '%e.status <> ''convite'' THEN e.player2_id%';  -- true
