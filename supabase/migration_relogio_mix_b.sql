-- ═════════════════════════════════════════════════════════════════════════
-- Relógio no mix, Fase B: os pontos do relógio ao vivo na app
--
-- PORQUÊ. Spec docs/superpowers/specs/2026-11-11-relogio-mix-pontos-ao-
-- vivo-design.md. Na Fase A o relógio só fala com o Supabase no «Começar» e
-- no fim; durante o jogo a app não vê nada. Agora o relógio manda o placar
-- a cada ponto e a app mostra-o («4-3 · 30-15») sem recarregar.
--
-- O QUE FAZ
--   1. mix_live_scores.game_id (preenchido por gatilho a partir do jogo, e
--      backfill): é o filtro do Realtime na página do mix.
--      mix_live_scores.seq passa a BIGINT (o relógio manda milissegundos,
--      para o seq continuar a subir depois de a app reiniciar).
--   2. Leitura: quem pode ler o jogo em `matches` pode ler o placar ao vivo
--      dele. A política consulta `matches`, que aplica as regras de leitura
--      que já tem (nada de copiar outro EXISTS de memberships). Escrita
--      continua só pelas RPCs.
--   3. push_mix_live_score(p_match_id, p_seq, p_state) → {"ok": true}: só
--      quem tem o jogo e ainda é um dos 4, com o mix in_progress e o jogo sem
--      resultado; state é um objeto com 2 KB no máximo. Só aplica se o seq
--      for maior (envios atrasados dão OK e não mudam nada). Erros:
--      'not_scorer', 'not_live', 'has_result', 'bad_state'.
--   4. mix_live_scores na publicação supabase_realtime.
--   5. live_mix_courts: cada campo ganha `live` (o state, se fresco: menos de
--      3 min e sem resultado; num campo escondido, null).
--
-- ORDEM. Depois de migration_relogio_mix_a.sql e migration_a_decorrer_campos.sql.
-- Seguro de correr mais do que uma vez.
--
-- Relógio no mix, Fase B · 11 nov 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- Não está viva até alguém a correr à mão: primeiro no dev, depois em
-- produção, antes de qualquer push para main.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.mix_live_scores') IS NULL THEN
    RAISE EXCEPTION 'Falta mix_live_scores: correr primeiro migration_relogio_mix_a.sql.';
  END IF;
  IF to_regprocedure('public.live_mix_courts(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Falta live_mix_courts: correr primeiro migration_a_decorrer_campos.sql.';
  END IF;
END $$;

-- ── 1. game_id e seq ─────────────────────────────────────────────────────
ALTER TABLE public.mix_live_scores
  ADD COLUMN IF NOT EXISTS game_id UUID REFERENCES games(id) ON DELETE CASCADE;
ALTER TABLE public.mix_live_scores ALTER COLUMN seq TYPE BIGINT;

UPDATE public.mix_live_scores ls
   SET game_id = m.game_id
  FROM matches m
 WHERE m.id = ls.match_id AND ls.game_id IS DISTINCT FROM m.game_id;

CREATE INDEX IF NOT EXISTS mix_live_scores_game_idx ON public.mix_live_scores (game_id);

-- O claim_mix_match não muda: o gatilho põe o game_id.
CREATE OR REPLACE FUNCTION public.mix_live_scores_set_game()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  NEW.game_id := (SELECT game_id FROM matches WHERE id = NEW.match_id);
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.mix_live_scores_set_game() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS mix_live_scores_set_game_trigger ON public.mix_live_scores;
CREATE TRIGGER mix_live_scores_set_game_trigger
  BEFORE INSERT OR UPDATE OF match_id ON public.mix_live_scores
  FOR EACH ROW EXECUTE FUNCTION public.mix_live_scores_set_game();

-- ── 2. Leitura ───────────────────────────────────────────────────────────
-- O EXISTS a `matches` corre com a RLS de quem lê: as regras de leitura do
-- jogo (membro do clube, superadmin) valem também para o placar ao vivo.
GRANT SELECT ON public.mix_live_scores TO authenticated;
DROP POLICY IF EXISTS "Quem vê o jogo vê o placar ao vivo" ON public.mix_live_scores;
CREATE POLICY "Quem vê o jogo vê o placar ao vivo"
  ON public.mix_live_scores FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM matches m WHERE m.id = mix_live_scores.match_id));

-- ── 3. O relógio manda o placar ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.push_mix_live_score(p_match_id UUID, p_seq BIGINT, p_state JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_me     UUID := auth.uid();
  v_m      matches%ROWTYPE;
  v_owner  UUID;
  v_status TEXT;
  v_four   UUID[];
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not_scorer'; END IF;
  IF p_state IS NULL OR jsonb_typeof(p_state) <> 'object' OR octet_length(p_state::text) > 2048 THEN
    RAISE EXCEPTION 'bad_state';
  END IF;

  SELECT * INTO v_m FROM matches WHERE id = p_match_id;
  IF v_m.id IS NULL THEN RAISE EXCEPTION 'not_scorer'; END IF;

  SELECT scorer_id INTO v_owner FROM mix_live_scores WHERE match_id = p_match_id;
  SELECT ARRAY[ta.player1_id, ta.player2_id, tb.player1_id, tb.player2_id]
    INTO v_four
    FROM teams ta, teams tb
   WHERE ta.id = v_m.team_a_id AND tb.id = v_m.team_b_id;
  IF v_owner IS DISTINCT FROM v_me OR NOT (v_me = ANY (COALESCE(v_four, '{}'))) THEN
    RAISE EXCEPTION 'not_scorer';
  END IF;

  SELECT status INTO v_status FROM games WHERE id = v_m.game_id;
  IF v_status IS DISTINCT FROM 'in_progress' THEN RAISE EXCEPTION 'not_live'; END IF;
  IF v_m.score_a IS NOT NULL OR v_m.score_b IS NOT NULL THEN RAISE EXCEPTION 'has_result'; END IF;

  -- Um envio atrasado (seq menor ou igual) não muda nada, e não é erro.
  UPDATE mix_live_scores
     SET state = p_state, seq = p_seq, updated_at = NOW()
   WHERE match_id = p_match_id AND scorer_id = v_me AND seq < p_seq;

  RETURN jsonb_build_object('ok', true);
END;
$function$;
REVOKE ALL ON FUNCTION public.push_mix_live_score(UUID, BIGINT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.push_mix_live_score(UUID, BIGINT, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.push_mix_live_score(UUID, BIGINT, JSONB) TO authenticated;

-- ── 4. Tempo real ────────────────────────────────────────────────────────
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.mix_live_scores;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ── 5. «A decorrer agora»: o placar ao vivo de cada campo ────────────────
-- O corpo é o de migration_a_decorrer_campos.sql (igual em dev e prod a 11
-- nov), com `live` a mais.
CREATE OR REPLACE FUNCTION public.live_mix_courts(p_game_id UUID)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH r AS (
    SELECT max(round_number) AS n FROM matches WHERE game_id = p_game_id
  ), lados AS (
    SELECT m.id, m.court_number, m.score_a, m.score_b, s.lado, s.uid, s.gid
      FROM matches m
      JOIN teams ta ON ta.id = m.team_a_id
      JOIN teams tb ON tb.id = m.team_b_id
      CROSS JOIN LATERAL (VALUES ('a', ta.player1_id, ta.player1_guest_id), ('a', ta.player2_id, ta.player2_guest_id),
                                 ('b', tb.player1_id, tb.player1_guest_id), ('b', tb.player2_id, tb.player2_guest_id)) AS s(lado, uid, gid)
     WHERE m.game_id = p_game_id AND m.round_number = (SELECT n FROM r)
       AND (s.uid IS NOT NULL OR s.gid IS NOT NULL)
  ), jogo AS (
    SELECT l.id, l.court_number, l.score_a, l.score_b, l.lado,
           bool_or(l.uid IS NOT NULL AND live_hides_results(l.uid)) AS hidden,
           jsonb_agg(jsonb_build_object('name', COALESCE(p.name, gg.name), 'avatar_url', p.avatar_url)) AS pessoas
      FROM lados l
      LEFT JOIN profiles p ON p.id = l.uid
      LEFT JOIN game_guests gg ON gg.id = l.gid
     GROUP BY l.id, l.court_number, l.score_a, l.score_b, l.lado
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'court', a.court_number,
           'a', CASE WHEN a.hidden THEN '[]'::jsonb ELSE a.pessoas END,
           'b', CASE WHEN b.hidden THEN '[]'::jsonb ELSE b.pessoas END,
           'a_hidden', a.hidden, 'b_hidden', b.hidden,
           'score_a', a.score_a, 'score_b', a.score_b,
           'live', CASE WHEN a.hidden OR b.hidden OR a.score_a IS NOT NULL OR a.score_b IS NOT NULL THEN NULL
                        ELSE (SELECT ls.state FROM mix_live_scores ls
                               WHERE ls.match_id = a.id AND ls.updated_at > NOW() - INTERVAL '3 minutes') END)
         ORDER BY a.court_number), '[]'::jsonb)
    FROM jogo a JOIN jogo b ON b.id = a.id AND b.lado = 'b'
   WHERE a.lado = 'a';
$function$;
REVOKE ALL ON FUNCTION public.live_mix_courts(UUID) FROM PUBLIC, anon, authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT has_function_privilege('anon', 'public.push_mix_live_score(uuid, bigint, jsonb)', 'EXECUTE');           -- false
--   SELECT has_function_privilege('authenticated', 'public.push_mix_live_score(uuid, bigint, jsonb)', 'EXECUTE');  -- true
--   SELECT has_table_privilege('authenticated', 'public.mix_live_scores', 'INSERT');                              -- false
--   SELECT count(*) FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'mix_live_scores';  -- 1
--   SELECT count(*) FROM mix_live_scores WHERE game_id IS NULL;                                                    -- 0
