-- ════════════════════════════════════════════════════════════════════════
-- Migration: fim da regra 7 — a rampa que zerava os ganhos contra duplas
-- muito mais fracas (decisão do Ruben, 21 out 2026).
--
-- PORQUÊ. A regra 7 (migration_elo_simples.sql, 29 set) encolhia o ganho de
-- uma vitória quando a dupla estava 150+ acima da média adversária, até 0
-- aos 250 — mas a derrota custava sempre por inteiro. Para quem joga acima
-- do grupo isso não é só desmotivador («ganho 0, perco 16»), é um VIÉS:
-- ao nível verdadeiro, o valor esperado deixa de ser zero e passa a
-- negativo, e o ranking dessas pessoas é empurrado para baixo do real.
-- Casos reais no grupo: jogadores 250-300 acima que deixaram de querer
-- jogar os mixes.
--
-- O QUE MUDA. A rampa sai por inteiro. O Elo puro já encolhe os ganhos com
-- a diferença — é a própria expectativa a fazê-lo:
--   gap da dupla   ganho (K20)   derrota (igual antes e depois)
--   +150           +5,9          −14,1
--   +200           +4,8          −15,2
--   +250           +3,8          −16,2
--   +300           +3,0          −17,0
--   +400           +1,8          −18,2
-- «Ganhas sempre alguma coisa; quanto mais fraco o adversário, menos.»
--
-- TROCA ASSUMIDA (RANKING.md §7): sem a rampa, alguém MUITO acima do grupo
-- que nunca perca volta a poder subir sem teto (~+3/vitória, porque a média
-- da dupla dilui o nível dele). Aceite a 21 out: o custo das derrotas
-- mantém-se por inteiro (uma apaga ~5 vitórias) e o problema medido hoje é
-- o contrário — gente real a desistir. Se o caso extremo aparecer, trata-se
-- então.
--
-- SÓ DAQUI PARA A FRENTE: nada se recalcula; os jogos já contados ficam.
-- Mesma assinatura e ACLs do elo_jogo_deltas: CREATE OR REPLACE chega, e os
-- callers (apply_elo_pairing → mixes, amigos, ligas, torneios) não mudam.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

-- Igual ao migration_elo_simples.sql, menos o bloco da regra 7.
-- p_r[1..4]     níveis (NULL = lugar sem conta); dupla = média dos não-NULL.
-- p_jogos[1..4] jogos já contados de cada um (decide o K 40 / K 20).
-- p_s_a         resultado da dupla A: 1 ganhou, 0 perdeu, 0.5 empate.
-- p_convidado   ignorado (ficou da versão #440).
CREATE OR REPLACE FUNCTION elo_jogo_deltas(
  p_r NUMERIC[], p_jogos INTEGER[], p_s_a NUMERIC, p_convidado TEXT DEFAULT NULL)
RETURNS NUMERIC[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_out NUMERIC[] := ARRAY[NULL, NULL, NULL, NULL]::NUMERIC[];
  v_ra  NUMERIC;
  v_rb  NUMERIC;
  v_ea  NUMERIC;
  v_k   NUMERIC;
  v_s   NUMERIC;
  v_e   NUMERIC;
  v_d   NUMERIC;
  i     INTEGER;
BEGIN
  -- Um lado sem ninguém com conta, ou sem resultado: não há o que medir.
  IF (p_r[1] IS NULL AND p_r[2] IS NULL) OR (p_r[3] IS NULL AND p_r[4] IS NULL)
     OR p_s_a IS NULL OR p_s_a NOT BETWEEN 0 AND 1 THEN
    RETURN v_out;
  END IF;

  -- Nível da dupla = média de quem tem conta.
  SELECT avg(x) INTO v_ra FROM unnest(p_r[1:2]) x;
  SELECT avg(x) INTO v_rb FROM unnest(p_r[3:4]) x;
  v_ea := 1 / (1 + power(10::NUMERIC, (v_rb - v_ra) / 400));

  FOR i IN 1..4 LOOP
    CONTINUE WHEN p_r[i] IS NULL;
    v_k := CASE WHEN COALESCE(p_jogos[i], 0) < 12 THEN 40 ELSE 20 END;
    v_s := CASE WHEN i <= 2 THEN p_s_a ELSE 1 - p_s_a END;
    v_e := CASE WHEN i <= 2 THEN v_ea ELSE 1 - v_ea END;
    v_d := round(v_k * (v_s - v_e), 2);
    -- (A regra 7 vivia aqui: rampa dos 150 aos 250 de gap, a cortar o ganho
    -- do vencedor até zero. Saiu a 21 out — ver o cabeçalho.)
    -- Chão em 0: nunca se perde mais do que se tem.
    IF v_d < 0 THEN
      v_d := -LEAST(-v_d, GREATEST(p_r[i], 0));
    END IF;
    v_out[i] := v_d;
  END LOOP;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION elo_jogo_deltas(NUMERIC[], INTEGER[], NUMERIC, TEXT) FROM public, anon, authenticated;

-- ── Verificar depois de correr ───────────────────────────────────────────
-- SELECT elo_jogo_deltas(ARRAY[1300,1200,1000,1000], ARRAY[30,30,30,30], 1);
--   antes: {0.00, 0.00, -3.83, -3.83} · depois: {3.83, 3.83, -3.83, -3.83}
-- SELECT elo_jogo_deltas(ARRAY[1300,1100,1000,1000], ARRAY[30,30,30,30], 1);
--   antes: {2.40, 2.40, -4.81, -4.81} · depois: {4.81, 4.81, -4.81, -4.81}
-- SELECT elo_jogo_deltas(ARRAY[1250,950,1000,1000], ARRAY[30,30,30,30], 1);
--   gap 100, sem rampa antes nem depois: {7.20, 7.20, -7.20, -7.20}
