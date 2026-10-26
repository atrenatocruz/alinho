-- ═════════════════════════════════════════════════════════════════════════
-- Relógio no mix, Fase A: listar os meus jogos do mix, ficar com um, e
-- quem tem o jogo grava o resultado
--
-- PORQUÊ. Spec docs/superpowers/specs/2026-10-26-relogio-mix-a-decorrer-
-- design.md, plano docs/superpowers/plans/2026-10-26-relogio-mix-fase-a.md.
-- No relógio, um dos 4 jogadores de um jogo de um mix a decorrer fica com
-- esse jogo (os outros três veem-no bloqueado), conta-o, e no fim o
-- resultado vai pelo mesmo save_mix_match_result de sempre (as mesmas
-- travas do #588). Renato, 26 out (ponto 1): esses 4 passam a poder gravar
-- o resultado DO SEU jogo, só com o mix in_progress e só depois de ficarem
-- com o jogo.
--
-- O QUE FAZ
--   1. mix_live_scores: uma linha por jogo do mix contado no relógio
--      (quem o tem). RLS ligada e sem regras: ninguém lê nem escreve pela
--      app; só pelas RPCs abaixo. seq, state e finished_at ficam vazios na
--      Fase A (a Fase B usa-os).
--   2. list_my_watch_mix_matches() → jsonb: os jogos de mixes in_progress
--      em que sou um dos 4 e que ainda não têm resultado (ou que são meus),
--      com nomes, lado, formato do mix, quem os tem e has_result. Um dono
--      que já não é um dos 4 (trocaram-no no jogo) conta como sem dono.
--   3. claim_mix_match(p_match_id) → jsonb {match_id, my_side}: fico com o
--      jogo. Erros: 'not_player', 'not_live', 'has_result' (mesmo que o
--      jogo seja meu: um novo «Começar» não reescreve um resultado
--      gravado), 'taken'. Se já for meu e sem resultado, dá OK (pode
--      repetir-se). Se o dono já não for um dos 4, o jogo passa para mim.
--   4. save_mix_match_result: quem tem o jogo em mix_live_scores E ainda é
--      um dos 4 jogadores também grava, só com o mix in_progress (troca no
--      corpo VIVO, 1 vez; «já estava» se correr duas vezes; se tiver a
--      forma antiga desta troca, sem a junção às equipas, passa à nova).
--
-- Relógio no mix, Fase A · 26 out 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- Não está viva até alguém a correr à mão: primeiro no dev, depois em
-- produção, antes de qualquer push para main.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.save_mix_match_result(uuid, integer, integer, jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Falta o save_mix_match_result: correr primeiro migration_mix_gravar_resultado.sql.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'games' AND column_name = 'scoring_format') THEN
    RAISE EXCEPTION 'Falta games.scoring_format: correr primeiro migration_set_scoring.sql.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'games' AND column_name = 'deuce_mode') THEN
    RAISE EXCEPTION 'Falta games.deuce_mode: correr primeiro migration_aos_40_40.sql.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'games' AND column_name = 'tiebreak_8_8') THEN
    RAISE EXCEPTION 'Falta games.tiebreak_8_8: correr primeiro migration_580_mix_tiebreak_e_series_contagem.sql.';
  END IF;
END $$;

-- ── 1. Quem tem o jogo ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mix_live_scores (
  match_id    UUID PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
  scorer_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  seq         INTEGER NOT NULL DEFAULT 0,
  state       JSONB,
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS mix_live_scores_scorer_idx ON public.mix_live_scores (scorer_id);
ALTER TABLE public.mix_live_scores ENABLE ROW LEVEL SECURITY;  -- sem regras: só pelas RPCs
REVOKE ALL ON public.mix_live_scores FROM PUBLIC, anon, authenticated;

-- ── 2. Os meus jogos do mix a decorrer ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_my_watch_mix_matches()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_me  UUID := auth.uid();
  v_out JSONB;
BEGIN
  IF v_me IS NULL THEN RETURN '[]'::jsonb; END IF;

  SELECT COALESCE(jsonb_agg(x.o ORDER BY x.round_number, x.court_number), '[]'::jsonb)
    INTO v_out
    FROM (
      SELECT m.round_number, m.court_number,
             jsonb_build_object(
               'match_id',       m.id,
               'game_id',        g.id,
               'game_name',      g.title,
               'round_number',   m.round_number,
               'court_number',   m.court_number,
               'my_side',        CASE WHEN v_me IN (ta.player1_id, ta.player2_id) THEN 'a' ELSE 'b' END,
               'partner_name',   CASE WHEN v_me IN (ta.player1_id, ta.player2_id)
                                      THEN CASE WHEN v_me = ta.player1_id THEN pa2.name ELSE pa1.name END
                                      ELSE CASE WHEN v_me = tb.player1_id THEN pb2.name ELSE pb1.name END
                                 END,
               'opponent_names', CASE WHEN v_me IN (ta.player1_id, ta.player2_id)
                                      THEN jsonb_build_array(pb1.name, pb2.name)
                                      ELSE jsonb_build_array(pa1.name, pa2.name)
                                 END,
               'format',         g.format,
               'scoring_format', g.scoring_format,
               'deuce_mode',     g.deuce_mode,
               'tiebreak_8_8',   g.tiebreak_8_8,
               'scorer_id',      ls.scorer_id,
               'scorer_name',    ps.name,
               'has_result',     (m.score_a IS NOT NULL OR m.score_b IS NOT NULL)
             ) AS o
        FROM matches m
        JOIN games g    ON g.id = m.game_id AND g.status = 'in_progress'
        JOIN teams ta   ON ta.id = m.team_a_id
        JOIN teams tb   ON tb.id = m.team_b_id
        JOIN profiles pa1 ON pa1.id = ta.player1_id
        JOIN profiles pa2 ON pa2.id = ta.player2_id
        JOIN profiles pb1 ON pb1.id = tb.player1_id
        JOIN profiles pb2 ON pb2.id = tb.player2_id
        -- Um dono que já não é um dos 4 não conta (o claim passa o jogo a quem o pedir).
        LEFT JOIN mix_live_scores ls ON ls.match_id = m.id
              AND ls.scorer_id IN (ta.player1_id, ta.player2_id, tb.player1_id, tb.player2_id)
        LEFT JOIN profiles ps ON ps.id = ls.scorer_id
       WHERE v_me IN (ta.player1_id, ta.player2_id, tb.player1_id, tb.player2_id)
         AND (m.score_a IS NULL OR ls.scorer_id = v_me)
    ) x;

  RETURN v_out;
END;
$function$;
REVOKE ALL ON FUNCTION public.list_my_watch_mix_matches() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_my_watch_mix_matches() FROM anon;
GRANT EXECUTE ON FUNCTION public.list_my_watch_mix_matches() TO authenticated;

-- ── 3. Ficar com um jogo ─────────────────────────────────────────────────
-- Atómico: o FOR UPDATE no jogo põe em fila dois «Começar» ao mesmo tempo
-- (e também um save_mix_match_result, que bloqueia a mesma linha); o
-- ON CONFLICT é a segunda rede.
CREATE OR REPLACE FUNCTION public.claim_mix_match(p_match_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_me     UUID := auth.uid();
  v_m      matches%ROWTYPE;
  v_status TEXT;
  v_side   TEXT;
  v_owner  UUID;
  v_four   UUID[];
  v_n      INTEGER;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not_player'; END IF;

  SELECT * INTO v_m FROM matches WHERE id = p_match_id FOR UPDATE;
  IF v_m.id IS NULL THEN RAISE EXCEPTION 'not_player'; END IF;

  SELECT CASE WHEN v_me IN (ta.player1_id, ta.player2_id) THEN 'a'
              WHEN v_me IN (tb.player1_id, tb.player2_id) THEN 'b' END,
         ARRAY[ta.player1_id, ta.player2_id, tb.player1_id, tb.player2_id]
    INTO v_side, v_four
    FROM teams ta, teams tb
   WHERE ta.id = v_m.team_a_id AND tb.id = v_m.team_b_id;
  IF v_side IS NULL THEN RAISE EXCEPTION 'not_player'; END IF;

  SELECT status INTO v_status FROM games WHERE id = v_m.game_id;
  IF v_status IS DISTINCT FROM 'in_progress' THEN RAISE EXCEPTION 'not_live'; END IF;

  -- Já com resultado: ninguém volta a ficar com o jogo, nem o dono (um novo
  -- «Começar» reescrevia o resultado gravado). Depois de «Desfazer», o
  -- relógio volta a gravar sem passar por aqui.
  IF v_m.score_a IS NOT NULL OR v_m.score_b IS NOT NULL THEN RAISE EXCEPTION 'has_result'; END IF;

  SELECT scorer_id INTO v_owner FROM mix_live_scores WHERE match_id = p_match_id;
  IF v_owner IS NOT NULL THEN
    IF v_owner = v_me THEN
      RETURN jsonb_build_object('match_id', p_match_id, 'my_side', v_side);
    END IF;
    IF v_owner = ANY (v_four) THEN RAISE EXCEPTION 'taken'; END IF;
    -- O dono já não é um dos 4 (trocaram-no no jogo): o jogo está livre.
    UPDATE mix_live_scores
       SET scorer_id = v_me, started_at = NOW(), updated_at = NOW(),
           seq = 0, state = NULL, finished_at = NULL
     WHERE match_id = p_match_id;
    RETURN jsonb_build_object('match_id', p_match_id, 'my_side', v_side);
  END IF;

  INSERT INTO mix_live_scores (match_id, scorer_id)
  VALUES (p_match_id, v_me)
  ON CONFLICT (match_id) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    SELECT scorer_id INTO v_owner FROM mix_live_scores WHERE match_id = p_match_id;
    IF v_owner IS DISTINCT FROM v_me THEN RAISE EXCEPTION 'taken'; END IF;
  END IF;

  RETURN jsonb_build_object('match_id', p_match_id, 'my_side', v_side);
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_mix_match(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_mix_match(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_mix_match(UUID) TO authenticated;

-- ── 4. Quem tem o jogo grava o resultado ────────────────────────────────
-- Troca, no corpo vivo, o EXISTS dos marcadores (de migration_mix_gravar_
-- resultado.sql; nem o migration_mix_marcadores.sql nem o
-- migration_superadmin_escondido.sql lhe mexeram) por «marcador OU tem o
-- jogo E ainda é um dos 4 jogadores». Continua dentro do
-- «v_g.status = 'in_progress' AND …». A procura aceita espaços e mudanças
-- de linha diferentes, mas tem de dar 1 vez:
--   · já tem a forma nova (a junção às equipas) → «já estava»;
--   · tem a forma antiga desta troca (mix_live_scores sem as equipas) →
--     troca só esse EXISTS pela forma nova;
--   · senão → troca o EXISTS dos marcadores.
DO $$
DECLARE
  c_mau  CONSTANT TEXT := 'EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+game_scorekeepers\s+WHERE\s+game_id\s*=\s*v_g\.id\s+AND\s+user_id\s*=\s*auth\.uid\(\)\s*\)';
  c_v1   CONSTANT TEXT := 'EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+mix_live_scores\s+WHERE\s+match_id\s*=\s*v_m\.id\s+AND\s+scorer_id\s*=\s*auth\.uid\(\)\s*\)';
  c_v2re CONSTANT TEXT := 'FROM\s+mix_live_scores\s+ls\s+JOIN\s+matches\s+lm\s+ON\s+lm\.id\s*=\s*ls\.match_id\s+JOIN\s+teams\s+lta\s+ON';
  c_v2   CONSTANT TEXT := 'EXISTS (SELECT 1 FROM mix_live_scores ls
                                 JOIN matches lm ON lm.id = ls.match_id
                                 JOIN teams lta ON lta.id = lm.team_a_id
                                 JOIN teams ltb ON ltb.id = lm.team_b_id
                                WHERE ls.match_id = v_m.id AND ls.scorer_id = auth.uid()
                                  AND auth.uid() IN (lta.player1_id, lta.player2_id, ltb.player1_id, ltb.player2_id))';
  v_def TEXT := replace(pg_get_functiondef('public.save_mix_match_result(uuid, integer, integer, jsonb)'::regprocedure), E'\r', '');
BEGIN
  IF (SELECT count(*) FROM regexp_matches(v_def, c_v2re, 'g')) = 1 THEN
    RAISE NOTICE 'save_mix_match_result: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_v1, 'g')) = 1 THEN
    RAISE NOTICE 'save_mix_match_result: tinha a forma antiga, passa à nova';
    EXECUTE regexp_replace(v_def, c_v1, c_v2);
    RETURN;
  END IF;
  IF position('mix_live_scores' IN v_def) > 0 THEN
    RAISE EXCEPTION 'save_mix_match_result: mix_live_scores numa forma que não conheço. Parar e ler.';
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'save_mix_match_result: o EXISTS dos marcadores não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE regexp_replace(v_def, c_mau, '(\&
                   OR ' || c_v2 || ')');
END $$;

REVOKE ALL ON FUNCTION public.save_mix_match_result(UUID, INTEGER, INTEGER, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_mix_match_result(UUID, INTEGER, INTEGER, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_mix_match_result(UUID, INTEGER, INTEGER, JSONB) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT has_function_privilege('anon', 'public.list_my_watch_mix_matches()', 'EXECUTE');                   -- false
--   SELECT has_function_privilege('anon', 'public.claim_mix_match(uuid)', 'EXECUTE');                         -- false
--   SELECT has_function_privilege('anon', 'public.save_mix_match_result(uuid, integer, integer, jsonb)', 'EXECUTE');  -- false
--   SELECT has_function_privilege('authenticated', 'public.claim_mix_match(uuid)', 'EXECUTE');                -- true
--   SELECT has_table_privilege('authenticated', 'public.mix_live_scores', 'SELECT');                          -- false
--   SELECT has_table_privilege('anon', 'public.mix_live_scores', 'SELECT');                                   -- false
--   SELECT relrowsecurity FROM pg_class WHERE oid = 'public.mix_live_scores'::regclass;                       -- true
--   SELECT pg_get_functiondef('public.save_mix_match_result(uuid,integer,integer,jsonb)'::regprocedure)
--          LIKE '%game_scorekeepers%mix_live_scores ls%JOIN teams lta%';                                     -- true
-- E depois correr supabase/tests/relogio_mix_a.sql (todas as linhas OK).
