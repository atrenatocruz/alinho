-- ═════════════════════════════════════════════════════════════════════════
-- Partilha do torneio nas redes: que duplas têm alguém que esconde os
-- resultados (hides_results), sem expor a escolha de cada pessoa
--
-- PORQUÊ. A partilha do torneio do Dev 1 (db790ff, no dev) mostra o
-- resultado e o pódio com os nomes das duplas. Quem pôs os resultados em
-- «amigos» ou «só eu» (profiles.results_visibility) não pode aparecer com o
-- nome num cartão que se publica nas redes: o ecrã mostra «Dupla M4». Falta
-- o ecrã saber QUAIS duplas — sem receber o valor de cada pessoa. Pedido do
-- PO (27 set), urgente: o próximo main espera por isto.
--
-- O QUE FAZ. tournament_entries_hiding_results(p_tournament_id,
-- p_category_id) → uuid[]: as inscrições (entry_id) em que o jogador 1 ou o
-- 2 tem results_visibility 'friends' ou 'private'. Dá para o torneio todo
-- (pódio: champion/runner_up/third trazem entry_id) ou só uma categoria
-- (cartão do resultado). Só devolve o que a pessoa já pode ver do quadro
-- (tournament_board_visible, a mesma regra das vistas públicas); para o
-- resto, vazio. Um booleano por dupla, nunca o valor de cada pessoa.
-- Para anon e authenticated (a página do torneio abre sem sessão).
--
-- Dev 3, 27 set 2026 · ecrã: Dev 1 (lido também no getCategoryBoard de
-- src/lib/tournamentDraw.js, mudado no mesmo commit)
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.tournament_board_visible(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'Falta tournament_board_visible (migration_tournament_privado_organizador_ve.sql). Parar e ler.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.tournament_entries_hiding_results(
  p_tournament_id UUID DEFAULT NULL, p_category_id UUID DEFAULT NULL)
RETURNS UUID[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(e.id ORDER BY e.id), '{}')
    FROM tournament_entries e
    JOIN tournament_categories c ON c.id = e.category_id
   WHERE (p_tournament_id IS NOT NULL OR p_category_id IS NOT NULL)
     AND (p_tournament_id IS NULL OR c.tournament_id = p_tournament_id)
     AND (p_category_id IS NULL OR c.id = p_category_id)
     AND tournament_board_visible(c.tournament_id, c.id)
     AND EXISTS (SELECT 1 FROM profiles p
                  WHERE p.id IN (e.player1_id, e.player2_id)
                    AND p.results_visibility IN ('friends', 'private'));
$$;

REVOKE ALL ON FUNCTION public.tournament_entries_hiding_results(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tournament_entries_hiding_results(UUID, UUID) TO anon, authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT has_function_privilege('anon', 'public.tournament_entries_hiding_results(uuid, uuid)', 'EXECUTE');  -- true
--   SELECT tournament_entries_hiding_results('<id do torneio>');                                                 -- as duplas que escondem
