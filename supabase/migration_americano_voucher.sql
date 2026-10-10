-- ═════════════════════════════════════════════════════════════════════════
-- Americano: o voucher vai para o 1.º classificado, e o 1.º é o mesmo em
-- todo o lado (voucher, «ganhou o mix», ecrã) — #608
--
-- PORQUÊ. Decisão do Francisco, 8 out (design-handoff/2026-10-08-americano-
-- voucher/DECISAO.md, via BA): «no americano deveria ir só para uma pessoa».
-- Até aqui a finalize_americano_mix não dava voucher a ninguém, e a correção
-- pós-fecho saltava os vouchers no Americano (ponto 8). E o «ganhou o mix»
-- (pontos de clube e XP de vitória) ia para todos os que tinham o máximo de
-- pontos, contado só entre os membros do clube. BA, 8 out: o 1.º lugar tem
-- de ser o mesmo em todo o lado. O ecrã (americanoStandings, Dev 2) passa a
-- desempatar da mesma forma. Em produção não há nenhum Americano (8 out),
-- por isso não há nada a acertar para trás.
--
-- A REGRA DO 1.º
--   · Quem somou mais pontos: a soma do que a sua dupla fez em cada jogo
--     com vencedor (a mesma conta do finalize e do ecrã).
--   · Empate: melhor diferença de pontos (marcados menos sofridos, nos mesmos
--     jogos). Se continuar igual, são 1.º todos os empatados.
--   · Contam todos os que jogaram, com ou sem conta. Se o 1.º for um
--     convidado sem conta, ninguém «ganha o mix» e ninguém recebe o voucher:
--     não passa ao 2.º.
--   · Voucher: só quem tem conta (voucher_eligible, regra de 30 set), e só
--     se o mix tiver has_voucher.
--
-- ⚠ MUDANÇA DE COMPORTAMENTO (para o SI e o QA; BA, 8 out). Até aqui:
--   · com empate nos pontos, «ganhavam o mix» todos os empatados; agora
--     desempata a diferença, e só com empate total ganham todos;
--   · o «ganhou o mix» contava-se só entre os membros do clube: um convidado
--     em 1.º passava a vitória ao melhor membro. Agora, um convidado sem
--     conta em 1.º deixa o mix sem vencedor com conta e nada passa ao 2.º
--     (como na regra de 30 set: quem não tem conta não recebe, e o prémio
--     não passa a outro).
--
-- O QUE FAZ
--   1. americano_first_place(p_game_id) → as contas em 1.º lugar (interna:
--      sem EXECUTE para anon nem authenticated).
--   2. finalize_americano_mix (corpo VIVO, 2 trocas; «já estava»): o «ganhou
--      o mix» passa a ser estar em americano_first_place; no fim, dá o
--      voucher. Idempotente pelo UNIQUE(game_id, user_id).
--   3. correct_finished_mix_match (corpo VIVO, 2 trocas; «já estava»): no
--      Americano, o «ganhou o mix» recalculado usa a mesma conta; e, depois
--      de corrigir, os vouchers acertam-se como nos outros formatos — quem
--      deixou de ser 1.º perde o voucher por usar; um já usado fica e
--      devolve voucher_not_reverted; quem passou a ser 1.º recebe.
--   CREATE OR REPLACE nas duas: as assinaturas e as permissões ficam.
--
-- Dev 3, 8 out 2026 · ecrã: Dev 2
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Quem fica em 1.º ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.americano_first_place(p_game_id UUID)
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  -- Cada lugar conta quem lá esteve, com ou sem conta: um convidado sem
  -- conta também pode ser o 1.º (e aí ninguém é devolvido).
  WITH mt AS (
    SELECT m.score_a, m.score_b,
           COALESCE(ta.player1_id, ta.player1_guest_id) AS a1, ta.player1_id AS a1_user,
           COALESCE(ta.player2_id, ta.player2_guest_id) AS a2, ta.player2_id AS a2_user,
           COALESCE(tb.player1_id, tb.player1_guest_id) AS b1, tb.player1_id AS b1_user,
           COALESCE(tb.player2_id, tb.player2_guest_id) AS b2, tb.player2_id AS b2_user
      FROM matches m
      JOIN teams ta ON ta.id = m.team_a_id
      JOIN teams tb ON tb.id = m.team_b_id
     WHERE m.game_id = p_game_id AND m.winner_team_id IS NOT NULL
  ), pp AS (
    SELECT a1 AS who, a1_user AS user_id, score_a AS f, score_b AS c FROM mt
    UNION ALL SELECT a2, a2_user, score_a, score_b FROM mt
    UNION ALL SELECT b1, b1_user, score_b, score_a FROM mt
    UNION ALL SELECT b2, b2_user, score_b, score_a FROM mt
  ), agg AS (
    SELECT who, max(user_id::text)::uuid AS user_id,
           COALESCE(sum(f), 0) AS pontos, COALESCE(sum(f), 0) - COALESCE(sum(c), 0) AS diferenca
      FROM pp WHERE who IS NOT NULL GROUP BY who
  ), primeiro AS (
    SELECT * FROM agg WHERE pontos = (SELECT max(pontos) FROM agg)
  )
  SELECT p.user_id FROM primeiro p
   WHERE p.diferenca = (SELECT max(diferenca) FROM primeiro)
     AND p.user_id IS NOT NULL;
$function$;
REVOKE ALL ON FUNCTION public.americano_first_place(UUID) FROM PUBLIC, anon, authenticated;

-- ── 2. Fechar o Americano: o 1.º ganha o mix e o voucher ────────────────
DO $$
DECLARE
  c_venc CONSTANT TEXT := '\(total_scored = MAX\(total_scored\) OVER \(\)\) AS won_mix';
  c_fim  CONSTANT TEXT := '(PERFORM check_and_award_[a-z]+\(mps\.user_id\)\s+FROM mix_player_stats mps WHERE mps\.game_id = p_game_id;)';
  v_def TEXT := pg_get_functiondef('public.finalize_americano_mix(uuid)'::regprocedure);
BEGIN
  IF v_def LIKE '%americano_first_place%' THEN
    RAISE NOTICE 'finalize_americano_mix: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_venc, 'g')) <> 1
     OR (SELECT count(*) FROM regexp_matches(v_def, c_fim, 'g')) <> 1 THEN
    RAISE EXCEPTION 'finalize_americano_mix: o pedaço a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  v_def := regexp_replace(v_def, c_venc, '(pid IN (SELECT americano_first_place(p_game_id))) AS won_mix');
  EXECUTE regexp_replace(v_def, c_fim, E'\\1\n\n'
    || E'  -- Voucher (Francisco, 8 out): só o 1.º classificado, só com conta;\n'
    || E'  -- empate desempata pela diferença de pontos (americano_first_place).\n'
    || E'  IF (SELECT has_voucher FROM games WHERE id = p_game_id) THEN\n'
    || E'    INSERT INTO vouchers (game_id, user_id, organization_id)\n'
    || E'    SELECT p_game_id, w.pid, v_org_id\n'
    || E'      FROM americano_first_place(p_game_id) AS w(pid)\n'
    || E'     WHERE voucher_eligible(w.pid)\n'
    || E'    ON CONFLICT (game_id, user_id) DO NOTHING;\n'
    || E'  END IF;');
END $$;

-- ── 3. Corrigir depois de fechado acerta o 1.º e o voucher ──────────────
DO $$
DECLARE
  c_venc CONSTANT TEXT := 'THEN \(t\.total_scored = MAX\(t\.total_scored\) OVER \(\)\)';
  c_vou  CONSTANT TEXT := '(IF v_game\.has_voucher AND v_winner_changed AND NOT v_is_americano THEN)';
  v_def TEXT := pg_get_functiondef('public.correct_finished_mix_match(uuid,integer,integer,uuid,jsonb)'::regprocedure);
BEGIN
  IF v_def LIKE '%americano_first_place%' THEN
    RAISE NOTICE 'correct_finished_mix_match: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_venc, 'g')) <> 1
     OR (SELECT count(*) FROM regexp_matches(v_def, c_vou, 'g')) <> 1 THEN
    RAISE EXCEPTION 'correct_finished_mix_match: o pedaço a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  v_def := regexp_replace(v_def, c_venc, 'THEN (t.pid IN (SELECT americano_first_place(v_game.id)))');
  EXECUTE regexp_replace(v_def, c_vou,
       E'-- Americano (Francisco, 8 out): o voucher é do 1.º classificado. Acerta-se\n'
    || E'  -- sempre, porque o desempate pela diferença pode mudar sem mudar\n'
    || E'  -- v_winner_changed.\n'
    || E'  IF v_game.has_voucher AND v_is_americano THEN\n'
    || E'    FOR v_pid IN SELECT v.user_id FROM vouchers v\n'
    || E'                  WHERE v.game_id = v_game.id AND v.status <> ''anulado''\n'
    || E'                    AND v.user_id NOT IN (SELECT w FROM americano_first_place(v_game.id) AS w) LOOP\n'
    || E'      SELECT status INTO v_voucher_status FROM vouchers WHERE game_id = v_game.id AND user_id = v_pid;\n'
    || E'      IF v_voucher_status = ''por_usar'' THEN\n'
    || E'        DELETE FROM vouchers WHERE game_id = v_game.id AND user_id = v_pid;\n'
    || E'      ELSIF v_voucher_status = ''usado'' THEN\n'
    || E'        v_voucher_not_reverted := TRUE;\n'
    || E'      END IF;\n'
    || E'    END LOOP;\n'
    || E'    INSERT INTO vouchers (game_id, user_id, organization_id)\n'
    || E'    SELECT v_game.id, w.pid, v_game.organization_id\n'
    || E'      FROM americano_first_place(v_game.id) AS w(pid)\n'
    || E'     WHERE voucher_eligible(w.pid)\n'
    || E'    ON CONFLICT (game_id, user_id) DO NOTHING;\n'
    || E'  END IF;\n\n'
    || E'  \\1');
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT count(*) FROM pg_proc WHERE proname IN ('finalize_americano_mix', 'correct_finished_mix_match')
--      AND pg_get_functiondef(oid) LIKE '%americano_first_place%';                               -- 2
--   SELECT has_function_privilege('anon', 'public.americano_first_place(uuid)', 'EXECUTE');      -- false
