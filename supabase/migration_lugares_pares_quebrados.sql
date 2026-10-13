-- ═════════════════════════════════════════════════════════════════════════
-- Lugares no Perfil: pares quebrados (parceiros a rodar) por pessoa
--
-- PORQUÊ. Dev 2 (urgente, PO, para o mix real de 19 out): o pódio do fim do
-- mix com pares quebrados é por pessoa, com o lugar partilhado da
-- Classificação (escolha A do Francisco). Com 8 pessoas e 2 campos:
-- 1.º, 1.º, 3.º, 3.º, 5.º, 5.º, 7.º, 7.º. A UX exige que o Perfil › Jogos dê
-- o mesmo lugar. O mix_final_places tratava o sobe e desce com
-- rotate_partners como duplas fixas (1.º, 2.º, 3.º, 4.º de 4).
--
-- O QUE FAZ. mix_final_places, quando o mix tem rotate_partners: o lugar de
-- cada pessoa é 2 × (lugar da dupla na última ronda) − 1 — os dois do mesmo
-- campo com o mesmo resultado partilham o lugar — e o total são as pessoas.
-- As duplas fixas e o americano ficam como estavam. É a conta do
-- rotatingPlacar do Dev 2. Corpo VIVO, 2 trocas literais («já estava»).
--
-- ORDEM. Depois de migration_lugares_e_historico.sql.
--
-- Dev 3, 13 out 2026 · ecrã: Dev 2 (pódio) e Dev 4 (Perfil)
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  c_g_mau   CONSTANT TEXT := 'SELECT id, format, winner_team_id FROM games WHERE id = p_game_id';
  c_g_bom   CONSTANT TEXT := 'SELECT id, format, winner_team_id, COALESCE(rotate_partners, FALSE) AS rodar FROM games WHERE id = p_game_id';
  c_fim_mau CONSTANT TEXT := $a$SELECT t.who, t.uid, t.place, t.total FROM team_out t WHERE (SELECT format FROM g) IS DISTINCT FROM 'americano';$a$;
  c_fim_bom CONSTANT TEXT := $a$-- Pares quebrados: por pessoa, os dois do mesmo campo e do mesmo resultado
  -- partilham o lugar (1.º, 1.º, 3.º, 3.º…), de todas as pessoas (Dev 2, 13 out).
  SELECT t.who, t.uid,
         CASE WHEN (SELECT rodar FROM g) THEN 2 * t.place - 1 ELSE t.place END,
         CASE WHEN (SELECT rodar FROM g) THEN (SELECT count(DISTINCT x.who) FROM team_pp x WHERE x.who IS NOT NULL)::int ELSE t.total END
    FROM team_out t WHERE (SELECT format FROM g) IS DISTINCT FROM 'americano';$a$;
  v_def TEXT := pg_get_functiondef('public.mix_final_places(uuid)'::regprocedure);
BEGIN
  IF v_def LIKE '%AS rodar%' THEN
    RAISE NOTICE 'mix_final_places: já estava';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, c_g_mau, ''))) / length(c_g_mau) <> 1
     OR (length(v_def) - length(replace(v_def, c_fim_mau, ''))) / length(c_fim_mau) <> 1 THEN
    RAISE EXCEPTION 'mix_final_places: um dos pedaços a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE replace(replace(v_def, c_g_mau, c_g_bom), c_fim_mau, c_fim_bom);
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_functiondef('public.mix_final_places(uuid)'::regprocedure) LIKE '%AS rodar%';  -- true
