-- ═════════════════════════════════════════════════════════════════════════
-- Jogo entre amigos a rodar: tempo de cada jogo e cronómetro
--
-- PORQUÊ. Aprovado pelo Francisco (design-handoff/2026-09-27-alarmes-das-
-- rondas/SPEC.md, no fim, e amigos-tempo.png): no jogo entre amigos a rodar,
-- escolhe-se quanto dura cada jogo (15, 20 ou 30 min, ou sem tempo) e quem
-- criou começa o cronómetro de cada jogo e acerta-o ±1 min. Nomes do Dev 2
-- (ecrã).
--
-- O QUE FAZ (sempre a partir do corpo VIVO, trocas 1x, «já estava»):
--   1. private_matches.game_minutes (NULL, 15, 20 ou 30; NULL = sem tempo),
--      started_at e ends_at.
--   2. create_friend_match ganha p_game_minutes SMALLINT DEFAULT NULL no fim
--      (sai a assinatura antiga, de 12 argumentos). Fica na sessão (jogo 1).
--   3. add_friend_match_game: os jogos seguintes herdam o game_minutes.
--   4. get_friend_match: devolve match.game_minutes e, em cada jogo,
--      started_at e ends_at — é o que os outros telemóveis leem (o
--      private_matches não está no realtime, e quem descansa não vê a linha
--      pela RLS; o ecrã pergunta de 10 em 10 s enquanto está aberto).
--   5. start_friend_match_game(p_match_id) → ends_at: só quem criou a
--      sessão, só com tempo e só se o jogo ainda não começou.
--      adjust_friend_match_timer(p_match_id, p_delta_minutes) → ends_at: o
--      ±1 min, só quem criou, só depois de começar, e o fim nunca antes do
--      início. Erros: not_allowed, no_duration, already_started, not_started.
--
-- Dev 3, 28 set 2026 · depois de migration_jogo_de_grupo_como_amigos.sql
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.create_friend_match(date, time, text, double precision, double precision, boolean, text, integer, text, jsonb, text, uuid)') IS NULL
     AND to_regprocedure('public.create_friend_match(date, time, text, double precision, double precision, boolean, text, integer, text, jsonb, text, uuid, smallint)') IS NULL THEN
    RAISE EXCEPTION 'Falta a migration_jogo_de_grupo_como_amigos.sql (create_friend_match com grupo). Parar e ler.';
  END IF;
END $$;

-- ── 1. Colunas ──────────────────────────────────────────────────────────
ALTER TABLE private_matches ADD COLUMN IF NOT EXISTS game_minutes SMALLINT;
ALTER TABLE private_matches ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE private_matches ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ;
ALTER TABLE private_matches DROP CONSTRAINT IF EXISTS private_matches_game_minutes_check;
ALTER TABLE private_matches ADD CONSTRAINT private_matches_game_minutes_check
  CHECK (game_minutes IS NULL OR game_minutes IN (15, 20, 30));

-- ── 2. create_friend_match: p_game_minutes ──────────────────────────────
DO $$
DECLARE
  c_old_sig CONSTANT TEXT := 'public.create_friend_match(date, time, text, double precision, double precision, boolean, text, integer, text, jsonb, text, uuid)';
  c_new_sig CONSTANT TEXT := 'public.create_friend_match(date, time, text, double precision, double precision, boolean, text, integer, text, jsonb, text, uuid, smallint)';
  c_par_mau CONSTANT TEXT := '(p_organization_id uuid DEFAULT NULL::uuid)\)';
  c_par_bom CONSTANT TEXT := '\1, p_game_minutes smallint DEFAULT NULL::smallint)';
  c_col_mau CONSTANT TEXT := 'teams_mode, court, organization_id\)';
  c_col_bom CONSTANT TEXT := 'teams_mode, court, organization_id, game_minutes)';
  c_val_mau CONSTANT TEXT := '(NULLIF\(trim\(p_court\), ''''\), p_organization_id)\)';
  c_val_bom CONSTANT TEXT := '\1, p_game_minutes)';
  v_def TEXT;
BEGIN
  IF to_regprocedure(c_new_sig) IS NOT NULL THEN
    RAISE NOTICE 'create_friend_match: já estava';
    RETURN;
  END IF;
  v_def := pg_get_functiondef(c_old_sig::regprocedure);
  IF (SELECT count(*) FROM regexp_matches(v_def, c_par_mau, 'g')) <> 1
     OR (SELECT count(*) FROM regexp_matches(v_def, c_col_mau, 'g')) <> 1
     OR (SELECT count(*) FROM regexp_matches(v_def, c_val_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'create_friend_match: um dos pedaços a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  v_def := regexp_replace(v_def, c_par_mau, c_par_bom);
  v_def := regexp_replace(v_def, c_col_mau, c_col_bom);
  v_def := regexp_replace(v_def, c_val_mau, c_val_bom);
  EXECUTE 'DROP FUNCTION ' || c_old_sig;
  EXECUTE v_def;
END $$;

REVOKE ALL ON FUNCTION public.create_friend_match(date, time, text, double precision, double precision, boolean, text, integer, text, jsonb, text, uuid, smallint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_friend_match(date, time, text, double precision, double precision, boolean, text, integer, text, jsonb, text, uuid, smallint) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_friend_match(date, time, text, double precision, double precision, boolean, text, integer, text, jsonb, text, uuid, smallint) TO authenticated;

-- ── 3. add_friend_match_game: herda o tempo ─────────────────────────────
DO $$
DECLARE
  c_col_mau CONSTANT TEXT := 'court, organization_id, scoring_format,';
  c_col_bom CONSTANT TEXT := 'court, organization_id, game_minutes, scoring_format,';
  c_val_mau CONSTANT TEXT := 'v_root\.court, v_root\.organization_id, v_root\.scoring_format,';
  c_val_bom CONSTANT TEXT := 'v_root.court, v_root.organization_id, v_root.game_minutes, v_root.scoring_format,';
  v_def TEXT := pg_get_functiondef('public.add_friend_match_game(uuid, uuid[], uuid[])'::regprocedure);
BEGIN
  IF v_def LIKE '%v_root.game_minutes%' THEN
    RAISE NOTICE 'add_friend_match_game: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_col_mau, 'g')) <> 1
     OR (SELECT count(*) FROM regexp_matches(v_def, c_val_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'add_friend_match_game: as colunas do INSERT não aparecem 1 vez. Parar e ler.';
  END IF;
  EXECUTE regexp_replace(regexp_replace(v_def, c_col_mau, c_col_bom), c_val_mau, c_val_bom);
END $$;

-- ── 4. get_friend_match: o tempo e o cronómetro ─────────────────────────
DO $$
DECLARE
  c_mat_mau CONSTANT TEXT := '(''teams_set_at'', m\.teams_set_at)\)';
  c_mat_bom CONSTANT TEXT := '\1, ''game_minutes'', m.game_minutes)';
  c_jog_mau CONSTANT TEXT := '(''status'', m\.status)\) AS g';
  c_jog_bom CONSTANT TEXT := '\1, ''started_at'', m.started_at, ''ends_at'', m.ends_at) AS g';
  v_def TEXT := pg_get_functiondef('public.get_friend_match(uuid)'::regprocedure);
BEGIN
  IF v_def LIKE '%''ends_at'', m.ends_at%' THEN
    RAISE NOTICE 'get_friend_match: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_mat_mau, 'g')) <> 1
     OR (SELECT count(*) FROM regexp_matches(v_def, c_jog_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'get_friend_match: os pedaços a trocar não aparecem 1 vez. Parar e ler.';
  END IF;
  EXECUTE regexp_replace(regexp_replace(v_def, c_mat_mau, c_mat_bom), c_jog_mau, c_jog_bom);
END $$;

-- ── 5. O cronómetro ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.start_friend_match_game(p_match_id UUID)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_m     private_matches%ROWTYPE;
  v_owner UUID;
  v_ends  TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_m FROM private_matches WHERE id = p_match_id FOR UPDATE;
  SELECT creator_id INTO v_owner FROM private_matches WHERE id = COALESCE(v_m.session_id, v_m.id);
  IF v_m.id IS NULL OR auth.uid() IS NULL OR v_owner IS DISTINCT FROM auth.uid()
     OR NOT (v_m.is_friend_session OR v_m.session_id IS NOT NULL) THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  IF v_m.game_minutes IS NULL THEN RAISE EXCEPTION 'no_duration'; END IF;
  IF v_m.started_at IS NOT NULL THEN RAISE EXCEPTION 'already_started'; END IF;
  v_ends := NOW() + make_interval(mins => v_m.game_minutes);
  UPDATE private_matches SET started_at = NOW(), ends_at = v_ends WHERE id = p_match_id;
  RETURN v_ends;
END;
$$;

CREATE OR REPLACE FUNCTION public.adjust_friend_match_timer(p_match_id UUID, p_delta_minutes INTEGER)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_m     private_matches%ROWTYPE;
  v_owner UUID;
  v_ends  TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_m FROM private_matches WHERE id = p_match_id FOR UPDATE;
  SELECT creator_id INTO v_owner FROM private_matches WHERE id = COALESCE(v_m.session_id, v_m.id);
  IF v_m.id IS NULL OR auth.uid() IS NULL OR v_owner IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  IF v_m.ends_at IS NULL THEN RAISE EXCEPTION 'not_started'; END IF;
  -- O fim nunca fica antes do início.
  v_ends := GREATEST(v_m.started_at, v_m.ends_at + make_interval(mins => COALESCE(p_delta_minutes, 0)));
  UPDATE private_matches SET ends_at = v_ends WHERE id = p_match_id;
  RETURN v_ends;
END;
$$;

REVOKE ALL ON FUNCTION public.start_friend_match_game(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.adjust_friend_match_timer(UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_friend_match_game(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_friend_match_timer(UUID, INTEGER) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT to_regprocedure('public.create_friend_match(date, time, text, double precision, double precision, boolean, text, integer, text, jsonb, text, uuid, smallint)') IS NOT NULL;  -- true
--   SELECT to_regprocedure('public.create_friend_match(date, time, text, double precision, double precision, boolean, text, integer, text, jsonb, text, uuid)') IS NULL;            -- true
--   SELECT has_function_privilege('anon', 'public.start_friend_match_game(uuid)', 'EXECUTE');                                                                                 -- false
