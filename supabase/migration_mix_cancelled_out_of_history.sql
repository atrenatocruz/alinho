-- ════════════════════════════════════════════════════════════════════════
-- Migration: os jogos de um mix CANCELADO saem do histórico e do frente a
-- frente (Trello #464 — «Não há forma de anular um mix que correu mal»).
-- Decisão do Francisco, 25 set 2026: «Faz o que recomendas» — o mix não
-- conta, por isso os jogos dele não aparecem a ninguém como se tivessem
-- contado; ficam GUARDADOS na base de dados (nada se apaga).
--
-- Independente das outras migrações por correr. Corre-o o System Integrator
-- (regra de 25 set). Não mexe em pontos nem em XP: um mix cancelado nunca os
-- deu (só o finalize_mix os dá), e o nível é do Ruben.
--
-- O que faz: nas quatro funções que listam jogos de mix com resultado, a
-- condição `WHERE m.winner_team_id IS NOT NULL` passa a ser
-- `WHERE m.winner_team_id IS NOT NULL AND g.status IS DISTINCT FROM 'cancelled'`
-- (o `g` é o `JOIN games g ON g.id = m.game_id` que cada uma já tem):
--   get_player_match_history  — histórico no perfil
--   get_head_to_head_matches  — frente a frente
--   mix_head_to_head          — frente a frente por clube/grupo
--   mix_head_to_head_matches  — os jogos desse frente a frente
-- Troca só o fragmento do corpo VIVO (regra de 24 set) e pára se o corpo
-- mudou: cada fragmento tem de aparecer exatamente uma vez, depois do join.
-- CREATE OR REPLACE mantém as permissões de cada função.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  f        TEXT;
  v_def    TEXT;
  v_join   CONSTANT TEXT := 'JOIN games g ON g.id = m.game_id';
  v_old    CONSTANT TEXT := 'WHERE m.winner_team_id IS NOT NULL';
  v_new    CONSTANT TEXT := 'WHERE m.winner_team_id IS NOT NULL AND g.status IS DISTINCT FROM ''cancelled''';
  v_count  INTEGER;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.get_player_match_history(uuid)',
    'public.get_head_to_head_matches(uuid)',
    'public.mix_head_to_head(uuid, uuid)',
    'public.mix_head_to_head_matches(uuid, uuid, uuid)'
  ] LOOP
    v_def := pg_get_functiondef(f::regprocedure);
    IF position(v_new IN v_def) > 0 THEN
      RAISE NOTICE '% já deixa os mixes cancelados de fora', f;
      CONTINUE;
    END IF;
    v_count := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
    IF v_count <> 1 OR position(v_join IN v_def) = 0 OR position(v_join IN v_def) > position(v_old IN v_def) THEN
      RAISE EXCEPTION '% mudou desde 25 set: esperava o join e o filtro uma vez cada (filtro: %)', f, v_count;
    END IF;
    EXECUTE replace(v_def, v_old, v_new);
  END LOOP;
END $$;

COMMIT;
