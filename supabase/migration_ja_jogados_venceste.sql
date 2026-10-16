-- ═════════════════════════════════════════════════════════════════════════
-- «Já jogados»: dizer se eu ganhei (🏆 Venceste)
--
-- PORQUÊ. Home, montada-3/5a (UX), pedido do Dev 4 (ecrã ff2e8394, já no
-- dev); o PO pô-lo antes dos amigos, para o main de sexta 16 out. Quem
-- ganhou vê «🏆 Venceste» no canto do cartão, no lugar de «Terminado». O
-- list_played_events dizia i_played e my_points, mas não se ganhei.
--
-- O QUE FAZ (corpo VIVO, 3 trocas; «já estava»). Cada linha ganha i_won,
-- sempre para quem vê (auth.uid()):
--   · mix: mix_player_stats.mix_won (no Americano já é o 1.º com desempate,
--     igual ao voucher); null se não joguei;
--   · torneio: true se a minha inscrição foi campeã de alguma categoria,
--     false se não; null se o torneio não tem campeão registado;
--   · amigos: null por agora (fica para o «O fim»).
-- Devolve jsonb na mesma: CREATE OR REPLACE; as permissões ficam.
--
-- Dev 3, 11 out 2026 · ecrã: Dev 4
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  c_mix    CONSTANT TEXT := '(''my_points'', \(SELECT s\.rating_delta FROM mix_player_stats s WHERE s\.game_id = g\.id AND s\.user_id = v_me\),)';
  c_torneio CONSTANT TEXT := '(''players_count'', NULL,)';
  c_amigos CONSTANT TEXT := '''winner'', NULL\)';
  v_def    TEXT := pg_get_functiondef('public.list_played_events(uuid, timestamp with time zone, integer)'::regprocedure);
BEGIN
  IF v_def LIKE '%''i_won''%' THEN
    RAISE NOTICE 'list_played_events: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_mix, 'g')) <> 1
     OR (SELECT count(*) FROM regexp_matches(v_def, c_torneio, 'g')) <> 1
     OR (SELECT count(*) FROM regexp_matches(v_def, c_amigos, 'g')) <> 1 THEN
    RAISE EXCEPTION 'list_played_events: o pedaço a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  v_def := regexp_replace(v_def, c_mix, E'\\1\n             ''i_won'', (SELECT s.mix_won FROM mix_player_stats s WHERE s.game_id = g.id AND s.user_id = v_me),');
  v_def := regexp_replace(v_def, c_torneio, E'\\1\n'
    || E'             ''i_won'', CASE WHEN NOT EXISTS (SELECT 1 FROM tournament_categories c WHERE c.tournament_id = t.id AND c.champion_entry_id IS NOT NULL) THEN NULL\n'
    || E'                           ELSE EXISTS (SELECT 1 FROM tournament_categories c JOIN tournament_entries e ON e.id = c.champion_entry_id\n'
    || E'                                         WHERE c.tournament_id = t.id AND v_me IN (e.player1_id, e.player2_id)) END,');
  v_def := regexp_replace(v_def, c_amigos, E'''i_won'', NULL,\n             ''winner'', NULL)');
  EXECUTE v_def;
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_functiondef('public.list_played_events(uuid, timestamp with time zone, integer)'::regprocedure) LIKE '%''i_won''%';  -- true
