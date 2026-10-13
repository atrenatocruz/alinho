-- ═════════════════════════════════════════════════════════════════════════
-- «A decorrer agora»: os campos da ronda, com as caras e o resultado
--
-- PORQUÊ. R2 do redesign (topo da Home, aprovado pelo Francisco; design-
-- handoff/2026-10-13-redesign/R2-topo-estados.png): a folha «A decorrer
-- agora» mostra, por jogo, um placar escuro com «CAMPO 1 · RONDA 3 DE 4»,
-- as duas duplas com as caras e o resultado, e os outros campos em
-- pastilhas. Pedido do Dev 2, 13 out. O list_live_events trazia a ronda, o
-- total e quem vai à frente, mas não os campos.
--
-- O QUE FAZ. list_live_events ganha courts_now:
--   · no mix: os jogos da ronda mais recente (a em curso), campo 1 primeiro;
--   · nos amigos: só o jogo em curso (ou, sem nenhum, o último com
--     resultado);
--   · cada jogo: {court, a: [{name, avatar_url}], b: [...], a_hidden,
--     b_hidden, score_a, score_b}. Uma dupla com alguém que esconde os
--     resultados (live_hides_results) vem com hidden = true e sem nomes nem
--     fotos, como o leader. Os convidados vêm pelo nome, sem foto.
--   Duas funções internas (live_mix_courts, live_friend_court) e 2 trocas
--   literais no corpo VIVO do list_live_events («já estava»).
--
-- ORDEM. Depois de migration_a_decorrer_so_depois_de_comecar.sql.
--
-- Dev 3, 13 out 2026 · ecrã: Dev 2
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Os campos da ronda em curso de um mix ───────────────────────────────
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
           'score_a', a.score_a, 'score_b', a.score_b)
         ORDER BY a.court_number), '[]'::jsonb)
    FROM jogo a JOIN jogo b ON b.id = a.id AND b.lado = 'b'
   WHERE a.lado = 'a';
$function$;
REVOKE ALL ON FUNCTION public.live_mix_courts(UUID) FROM PUBLIC, anon, authenticated;

-- ── O jogo em curso de uma sessão entre amigos ──────────────────────────
CREATE OR REPLACE FUNCTION public.live_friend_court(p_root UUID)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH g AS (
    SELECT x.* FROM private_matches x
     WHERE (x.id = p_root OR x.session_id = p_root)
       AND (x.started_at IS NOT NULL OR x.winner_team IS NOT NULL)
     -- O em curso primeiro; senão, o último com resultado.
     ORDER BY (x.started_at IS NOT NULL AND x.winner_team IS NULL) DESC,
              x.result_at DESC NULLS LAST, COALESCE(x.round_number, x.game_number, 1) DESC, COALESCE(x.court_number, 1)
     LIMIT 1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'court', COALESCE(g.court_number, 1),
           'a', jsonb_build_array(
                  jsonb_build_object('name', COALESCE((SELECT name FROM profiles WHERE id = g.team_a_player1_id), g.team_a_player1_guest_name),
                                     'avatar_url', (SELECT avatar_url FROM profiles WHERE id = g.team_a_player1_id)),
                  jsonb_build_object('name', COALESCE((SELECT name FROM profiles WHERE id = g.team_a_player2_id), g.team_a_player2_guest_name),
                                     'avatar_url', (SELECT avatar_url FROM profiles WHERE id = g.team_a_player2_id))),
           'b', jsonb_build_array(
                  jsonb_build_object('name', COALESCE((SELECT name FROM profiles WHERE id = g.team_b_player1_id), g.team_b_player1_guest_name),
                                     'avatar_url', (SELECT avatar_url FROM profiles WHERE id = g.team_b_player1_id)),
                  jsonb_build_object('name', COALESCE((SELECT name FROM profiles WHERE id = g.team_b_player2_id), g.team_b_player2_guest_name),
                                     'avatar_url', (SELECT avatar_url FROM profiles WHERE id = g.team_b_player2_id))),
           'a_hidden', FALSE, 'b_hidden', FALSE,
           'score_a', g.score_a, 'score_b', g.score_b)), '[]'::jsonb)
    FROM g;
$function$;
REVOKE ALL ON FUNCTION public.live_friend_court(UUID) FROM PUBLIC, anon, authenticated;

-- ── O list_live_events manda-os ─────────────────────────────────────────
DO $$
DECLARE
  c_mix    CONSTANT TEXT := $a$'courts', g.num_courts,$a$;
  c_amigos CONSTANT TEXT := E'      ''leader'', v_lead));\n  END LOOP;\n\n  RETURN v_out;';
  v_def TEXT := pg_get_functiondef('public.list_live_events(uuid)'::regprocedure);
BEGIN
  IF v_def LIKE '%courts_now%' THEN
    RAISE NOTICE 'list_live_events: já estava';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, c_mix, ''))) / length(c_mix) <> 1
     OR (length(v_def) - length(replace(v_def, c_amigos, ''))) / length(c_amigos) <> 1 THEN
    RAISE EXCEPTION 'list_live_events: um dos pedaços a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  v_def := replace(v_def, c_mix, c_mix || $b$ 'courts_now', live_mix_courts(g.id),$b$);
  v_def := replace(v_def, c_amigos,
    E'      ''courts_now'', live_friend_court(r.id),\n' || c_amigos);
  EXECUTE v_def;
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_functiondef('public.list_live_events(uuid)'::regprocedure) LIKE '%courts_now%';  -- true
--   SELECT has_function_privilege('authenticated', 'public.live_mix_courts(uuid)', 'EXECUTE');  -- false
