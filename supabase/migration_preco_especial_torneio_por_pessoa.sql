-- ═════════════════════════════════════════════════════════════════════════
-- Preço especial no torneio: tudo por pessoa
--
-- PORQUÊ. Dev 1, 10 out. No torneio, o preço da categoria é da DUPLA
-- (tournament_categories.price_cents, ex. 25 €), mas o preço especial é de
-- cada pessoa (event_price_roster dá uma linha por jogador), e a SPEC do
-- preço especial (2026-10-07) fala sempre em preço por jogador («15 € /
-- jogador · Grátis para membros»). Com o normal por dupla e o especial por
-- pessoa, as contas não batiam: «Grátis para ti · 25 € para os outros»
-- quando os outros pagam 12,50 € cada.
--
-- O QUE FAZ. Na categoria do torneio, o preço normal que o preço especial
-- usa passa a ser por pessoa: price_cents / 2 (25 € a dupla → 12,50 €). Só
-- muda o que as funções do preço especial devolvem (prices_for_me,
-- event_price_roster, get_event_special_price); o preço da categoria em si
-- fica como está. O preço especial que o organizador escreve no torneio é
-- também por pessoa. Corpo VIVO do esp_event, 1 troca; «já estava».
--
-- Ordem: depois da migration_preco_especial.sql.
-- Dev 3, 10 out 2026 · ecrã: Dev 1
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  c_mau CONSTANT TEXT := 'round\(c\.price_cents / 100\.0, 2\)';
  v_def TEXT;
BEGIN
  IF to_regprocedure('public.esp_event(text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Correr primeiro a migration_preco_especial.sql.';
  END IF;
  v_def := pg_get_functiondef('public.esp_event(text,uuid)'::regprocedure);
  IF v_def LIKE '%price_cents / 200.0%' THEN
    RAISE NOTICE 'esp_event: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'esp_event: o pedaço a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  -- O preço da categoria é da dupla; o preço especial conta por pessoa.
  EXECUTE regexp_replace(v_def, c_mau, 'round(c.price_cents / 200.0, 2)');
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_functiondef('public.esp_event(text,uuid)'::regprocedure) LIKE '%price_cents / 200.0%';  -- true
