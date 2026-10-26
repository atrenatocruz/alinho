-- ═════════════════════════════════════════════════════════════════════════
-- «Set sem fim» e «Pontos corridos»: os valores novos na base
--
-- PORQUÊ. Aprovado pelo Francisco a 26 out:
-- design-handoff/2026-10-26-set-sem-fim-e-pontos-corridos/SPEC.md. Ecrãs:
-- Dev 2 (valores combinados com ele a 26 out).
--
-- O QUE FAZ
--   · Mix: games.scoring_format aceita 'pontos_corridos'. O 'pontos_simples'
--     fica como está e passa a ler-se «Set sem fim». O Americano aceita
--     'pontos_corridos', 'set_sem_fim' (só no Americano) ou 'pontos_simples'
--     (os Americanos que já existem não mudam; a app lê-os como «Pontos
--     corridos»). O «Aos 40-40» (deuce_mode) aceita-se com qualquer
--     pontuação: a base não o prende ao formato. Nos resultados conta
--     igual ao 'pontos_simples': dois números, sem as regras do pro set (os
--     guardas mix_matches_score_guard e mix_match_sets_guard já tratam
--     qualquer outro valor assim; a repetição semanal copia o valor).
--   · Amigos: round_kind aceita 'set_sem_fim' (conta-se em jogos, o set não
--     acaba; até 99, como os tie-breaks). Muda o CHECK e três funções vivas
--     (friend_match_round_score_ok, set_friend_match_round_kind e
--     save_friend_match_round), remendadas por texto com contagem exata;
--     correr duas vezes não faz mal («já estava»).
--
-- COMPATIBILIDADE. Só alarga o que se aceita; nada que existe muda. A app
-- antiga, com 'pontos_corridos', cai no ramo genérico (dois números) e
-- funciona; só fica sem nome na pontuação.
--
-- Dev 3, 26 out 2026 · ecrãs: Dev 2
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Mix ──────────────────────────────────────────────────────────────
ALTER TABLE public.games DROP CONSTRAINT IF EXISTS games_scoring_format_check;
ALTER TABLE public.games ADD CONSTRAINT games_scoring_format_check
  CHECK (scoring_format = ANY (ARRAY['pontos_simples', 'pontos_corridos', 'set_sem_fim', 'pro_set_9', 'melhor_2_sets', 'melhor_3_sets']));

-- No Americano: «Pontos corridos» (por omissão) ou «Set sem fim». Os
-- Americanos antigos ficam com 'pontos_simples' (lê-se «Pontos corridos»), e
-- 'set_sem_fim' só existe no Americano (nos outros formatos o «Set sem fim»
-- é o 'pontos_simples' de sempre). Combinado com o Dev 2, 26 out (opção b).
ALTER TABLE public.games DROP CONSTRAINT IF EXISTS games_americano_scoring_check;
ALTER TABLE public.games ADD CONSTRAINT games_americano_scoring_check
  CHECK ((format <> 'americano' OR scoring_format IN ('pontos_corridos', 'pontos_simples', 'set_sem_fim'))
         AND (scoring_format <> 'set_sem_fim' OR format = 'americano'));

-- ── 2. Amigos ───────────────────────────────────────────────────────────
ALTER TABLE public.private_matches DROP CONSTRAINT IF EXISTS private_matches_round_kind_check;
ALTER TABLE public.private_matches ADD CONSTRAINT private_matches_round_kind_check
  CHECK ((round_kind IS NULL OR round_kind IN ('set', 'set_sem_fim', 'tiebreak', 'super_tiebreak', 'pontos'))
         AND (round_points_to IS NULL OR (round_kind = 'pontos' AND round_points_to > 0)));

DO $$
DECLARE
  v_def TEXT;
  v_n   INT;
  r     RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('public.friend_match_round_score_ok(text,integer,integer)',
       '    WHEN ''pontos'' THEN greatest(p_a, p_b) <= 999',
       '    -- Set sem fim (26 out): conta-se em jogos e o set não acaba.' || E'\n'
         || '    WHEN ''set_sem_fim'' THEN greatest(p_a, p_b) <= 99' || E'\n'
         || '    WHEN ''pontos'' THEN greatest(p_a, p_b) <= 999'),
      ('public.set_friend_match_round_kind(uuid,text,smallint)',
       'IF p_kind NOT IN (''set'', ''tiebreak'', ''super_tiebreak'', ''pontos'')',
       'IF p_kind NOT IN (''set'', ''set_sem_fim'', ''tiebreak'', ''super_tiebreak'', ''pontos'')'),
      ('public.save_friend_match_round(uuid,integer,integer,text,smallint,jsonb,boolean)',
       'IF v_kind NOT IN (''set'', ''tiebreak'', ''super_tiebreak'', ''pontos'')',
       'IF v_kind NOT IN (''set'', ''set_sem_fim'', ''tiebreak'', ''super_tiebreak'', ''pontos'')')
    ) AS x(fn, old_txt, new_txt)
  LOOP
    v_def := replace(pg_get_functiondef(r.fn::regprocedure), E'\r', '');
    IF position('set_sem_fim' IN v_def) > 0 THEN
      RAISE NOTICE '% já estava', r.fn;
      CONTINUE;
    END IF;
    v_n := (length(v_def) - length(replace(v_def, r.old_txt, ''))) / length(r.old_txt);
    IF v_n <> 1 THEN
      RAISE EXCEPTION '%: esperava 1 vez «%», encontrei %. Parar.', r.fn, r.old_txt, v_n;
    END IF;
    EXECUTE replace(v_def, r.old_txt, r.new_txt);
  END LOOP;
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname IN ('games_scoring_format_check', 'games_americano_scoring_check', 'private_matches_round_kind_check');
--     → as três com 'pontos_corridos' / 'set_sem_fim'
--   SELECT proname, position('set_sem_fim' IN prosrc) > 0 FROM pg_proc
--    WHERE proname IN ('friend_match_round_score_ok', 'set_friend_match_round_kind', 'save_friend_match_round');   → três true
