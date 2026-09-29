-- ═════════════════════════════════════════════════════════════════════════
-- Mix: jogos de classificação nos campos 3, 4… da ronda da final
-- (Renato, 29 set 2026).
--
-- A seguir ao 3.º lugar no campo 2 (migration_mix_terceiro_lugar.sql):
-- «se tivermos 3 campos, o 5.º e o 6.º; se 4 campos, o 7.º e o 8.º».
-- As duplas que não estão na final nem no 3.º lugar jogam, pela
-- classificação dos grupos, duas a duas: campo 3 = 5.º lugar, campo 4 =
-- 7.º lugar, … (src/lib/mixLogic.js, lowerPlacementMatches; quem grava é
-- GameDetails.jsx, handleAdvance).
--
-- O jogo vai com phase = 'placement' (o lugar sai do campo: 2 × campo − 1).
-- Como no 3.º lugar, nada mais muda no servidor: a classificação usa só
-- 'group', e o vencedor do mix e a conquista de campeão só 'final'. Conta
-- para o ranking como qualquer outro jogo.
--
-- Sem isto corrido, a app grava a ronda da final sem estes jogos (como
-- antes) — nada se parte.
--
-- Inclui o 'third' da migration_mix_terceiro_lugar.sql: pode correr-se esta
-- sozinha. Seguro de correr mais do que uma vez.
-- ═════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.matches'::regclass
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%phase%'
  LOOP
    EXECUTE format('ALTER TABLE public.matches DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.matches
  ADD CONSTRAINT matches_phase_check
  CHECK (phase IN ('group', 'quarter', 'semi', 'final', 'third', 'placement'));
