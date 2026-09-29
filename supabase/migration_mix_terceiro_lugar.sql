-- ═════════════════════════════════════════════════════════════════════════
-- Mix: jogo do 3.º lugar na ronda da final (Renato, 29 set 2026).
--
-- «Na última ronda, pôr o 3.º contra o 4.º no Campo 2, a jogar o 3.º
-- lugar, para ninguém ficar parado.» Nos mixs com fase eliminatória
-- (todos contra todos, grupos + eliminatórias), a ronda da final passa a
-- ter, no campo 2, o jogo do 3.º lugar:
--   · final logo a seguir aos grupos → o 3.º contra o 4.º da classificação;
--   · final depois das meias → os dois que perderam as meias.
-- Só com 2 ou mais campos e 4 ou mais duplas (src/lib/mixLogic.js,
-- thirdPlaceMatch; quem grava é GameDetails.jsx, handleAdvance).
--
-- O jogo vai com phase = 'third'. A tabela só aceitava group / quarter /
-- semi / final, por isso é preciso alargar o CHECK. Mais nada muda no
-- servidor: nenhuma função lista as fases uma a uma — a classificação usa
-- só 'group', o vencedor do mix e a conquista de campeão usam só 'final'.
-- O jogo do 3.º lugar conta para o ranking como qualquer outro jogo.
--
-- Sem isto corrido, o botão «Terminar ronda» antes da final dá erro
-- (violação do CHECK) num mix com 2+ campos e 4+ duplas.
--
-- Seguro de correr mais do que uma vez.
-- ═════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  c RECORD;
BEGIN
  -- O CHECK foi criado sem nome (schema.sql / migration_mixes.sql), por
  -- isso procura-se pelo que ele diz em vez de pelo nome.
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
  CHECK (phase IN ('group', 'quarter', 'semi', 'final', 'third'));
