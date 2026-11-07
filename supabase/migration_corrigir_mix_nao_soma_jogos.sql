-- ═════════════════════════════════════════════════════════════════════════
-- Corrigir um resultado de um mix já terminado não soma jogos de nível
--
-- PORQUÊ. Dev 2, 15 out (confirmado pelo Dev 3 no corpo vivo):
-- correct_finished_mix_match devolve o nível (rating - rating_delta) mas não
-- desconta os jogos de nível (rating_games) antes de voltar a chamar o
-- apply_mix_elo, que soma +1 por jogo. Cada correção dava a cada jogador do
-- mix mais tantos jogos quantos jogou. O rating_games decide o peso do Elo
-- (K 40 até aos 12 jogos, 20 depois) e o «NOVO»/«~» do nível. O mesmo erro
-- que se corrigiu no torneio a 14 out (rated_games).
--
-- O QUE FAZ. No passo 5 (Elo), ao desfazer o nível de cada um, desconta
-- também os jogos que o apply_mix_elo lhe tinha somado
-- (mix_player_stats.matches_played: o apply_mix_elo conta +1 por jogo a cada
-- jogador com conta, e aqui só se reaplica quando todos têm linha). Corpo
-- VIVO, 1 troca de uma linha («já estava»).
--
-- Os jogos a mais que já existem (produção, 16 out: 17 jogadores, 85 jogos)
-- acertam-se à parte: migration_acerto_jogos_de_nivel.sql (proposta, à
-- espera do Ruben).
--
-- #780 (bug em produção). Revisto a 7 nov: corpo igual em produção e no alinho-dev
-- (md5 sem \r ff7f2e0b), pedaço a trocar 1 vez; matches_played bate com os jogos
-- somados em 426 de 426 linhas de produção. Ensaio sem rasto no alinho-dev (mix do
-- QA, 4 jogadores): sem isto +16 jogos por correção, com isto 0. Acessos ficam iguais.
-- ORDEM: qualquer; vai sozinho.
--
-- Dev 3, 16 out 2026 · ecrãs: nenhum muda
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  c_mau CONSTANT TEXT := 'UPDATE profiles pr SET rating = GREATEST(0, COALESCE(pr.rating, 900) - mps.rating_delta)';
  c_bom CONSTANT TEXT := 'UPDATE profiles pr SET rating = GREATEST(0, COALESCE(pr.rating, 900) - mps.rating_delta),'
                      || ' rating_games = GREATEST(0, COALESCE(pr.rating_games, 0) - mps.matches_played)  -- sem somar jogos a cada correção (16 out)';
  v_def TEXT := replace(pg_get_functiondef('public.correct_finished_mix_match(uuid,integer,integer,uuid,jsonb)'::regprocedure), E'\r', '');
BEGIN
  IF position('sem somar jogos a cada correção' IN v_def) > 0 THEN
    RAISE NOTICE 'correct_finished_mix_match: já estava';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, c_mau, ''))) / length(c_mau) <> 1 THEN
    RAISE EXCEPTION 'correct_finished_mix_match: o pedaço a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE replace(v_def, c_mau, c_bom);
END $$;

COMMIT;

-- Verificar depois de correr (true):
--   SELECT pg_get_functiondef('public.correct_finished_mix_match(uuid,integer,integer,uuid,jsonb)'::regprocedure)
--          LIKE '%sem somar jogos a cada correção%';
