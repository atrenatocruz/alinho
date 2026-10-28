-- ═════════════════════════════════════════════════════════════════════════
-- Mix: quem joga ganha estatísticas, pontos e XP, seja membro, convidado do
-- clube ou parceiro de outro grupo
--
-- PORQUÊ. Bug em produção (Francisco, 27 out, «Mix M4 · Terça» da A2N): o
-- parceiro dele jogou os 4 jogos e não aparece nas Estatísticas do mix, nem
-- ganhou XP nem conquistas. O nível mexeu-lhe na mesma (apply_mix_elo lê as
-- duplas), mas o rating_delta não ficou guardado. Desde 21 set faltam 26
-- linhas destas em 12 mixes (21 pessoas): 21 de convidados do clube
-- (memberships.is_guest), 1 de um parceiro que não é membro e 4 de membros
-- cuja inscrição no clube foi criada ou mudada depois do mix.
-- Francisco, 28 out: «Mas deveria ganhar pontos na mesma. Corrige por
-- favor» (também dentro do clube: ranking do mês, Por Clube e XP).
--
-- CAUSA. «JOIN memberships mb ON … AND NOT mb.is_guest» no finalize_mix, no
-- finalize_americano_mix e no correct_finished_mix_match. Vem do
-- multi_tenant (jul), quando só servia para os pontos do clube; o
-- mix_player_stats, o XP e as conquistas foram pendurados depois no mesmo
-- CTE e herdaram o filtro.
--
-- O QUE FAZ
--   1. Tira esse JOIN das três funções (emenda por texto ao corpo vivo; 1 vez
--      cada, ou «já estava»). Daqui em diante toda a gente COM CONTA que joga
--      ganha mix_player_stats, player_stats (se o mix contar para o
--      ranking), XP, conquistas e rating_delta. Os convidados sem conta
--      (player NULL nas duplas) continuam de fora, como sempre.
--   2. Preenche as linhas em falta dos mixes terminados, com as mesmas contas
--      do fecho: mix_player_stats, player_stats (mixes com ranking), XP
--      (participação, jogos, vitória), profiles.xp e last_played_at, e no fim
--      as conquistas dessas pessoas.
--      O rating_delta fica NULL: o nível já lhes foi aplicado no fecho e não
--      há registo do nível de cada noite para o refazer (voltar a correr o
--      apply_mix_elo aplicava-o outra vez). Por isso estas linhas antigas
--      não entram no ranking do mês nem no histórico do nível.
--
-- CONSEQUÊNCIA (avisada ao PO, 28 out). Com o rating_delta gravado,
-- convidados e parceiros de fora passam a contar no ranking do mês do clube
-- e da zona, e portanto no pódio do mês e nos prémios dos parceiros (a
-- partir de novembro).
--
-- ORDEM. Qualquer: troca uma linha de cada função e mantém o resto do corpo
-- vivo. Se alguma migração antiga voltar a criar estas funções por inteiro,
-- correr esta outra vez a seguir (o preenchimento só acrescenta o que falta).
--
-- COMPATIBILIDADE. Mesmas assinaturas e colunas; só aparecem mais linhas.
--
-- Dev 3, 28 out 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. O fecho do mix deixa de filtrar por membro ──────────────────────────
DO $$
DECLARE
  v_def TEXT;
  v_n   INT;
  r     RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('public.finalize_mix(uuid,uuid)',
       E'    FROM agg a\n    JOIN memberships mb ON mb.user_id = a.pid AND mb.organization_id = v_org_id AND NOT mb.is_guest\n',
       E'    FROM agg a\n'),
      ('public.finalize_americano_mix(uuid)',
       E'    FROM agg a\n    JOIN memberships mb ON mb.user_id = a.pid AND mb.organization_id = v_org_id AND NOT mb.is_guest\n',
       E'    FROM agg a\n'),
      ('public.correct_finished_mix_match(uuid,integer,integer,uuid,jsonb)',
       E'    SELECT a.* FROM agg a\n    JOIN memberships mb ON mb.user_id = a.pid\n      AND mb.organization_id = v_game.organization_id AND NOT mb.is_guest\n',
       E'    SELECT a.* FROM agg a\n')
    ) AS x(fn, old_txt, new_txt)
  LOOP
    v_def := replace(pg_get_functiondef(r.fn::regprocedure), E'\r', '');
    IF position('NOT mb.is_guest' IN v_def) = 0 THEN
      RAISE NOTICE '% já estava', r.fn;
      CONTINUE;
    END IF;
    v_n := (length(v_def) - length(replace(v_def, r.old_txt, ''))) / length(r.old_txt);
    IF v_n <> 1 THEN RAISE EXCEPTION '%: esperava 1 vez o JOIN memberships, encontrei %. Parar.', r.fn, v_n; END IF;
    EXECUTE replace(v_def, r.old_txt, r.new_txt);
  END LOOP;
END $$;

-- CREATE OR REPLACE mantém os GRANT; por segurança, como nas outras.
REVOKE EXECUTE ON FUNCTION public.finalize_mix(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.finalize_americano_mix(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.correct_finished_mix_match(uuid, integer, integer, uuid, jsonb) FROM PUBLIC, anon;

-- ── 2. As linhas que ficaram por escrever ──────────────────────────────────
-- Mesmas contas do finalize_mix / finalize_americano_mix, só para quem jogou
-- (com conta) e não tem linha em mix_player_stats nesse mix.
CREATE TEMP TABLE _mix_falta ON COMMIT DROP AS
WITH mt AS (
  SELECT g.id AS gid, m.winner_team_id AS win_id, t.id AS team_id, t.player1_id, t.player2_id
    FROM games g
    JOIN matches m ON m.game_id = g.id AND m.winner_team_id IS NOT NULL
    JOIN teams t ON t.id = m.team_a_id OR t.id = m.team_b_id
   WHERE g.status = 'finished'
), pp AS (
  SELECT gid, unnest(ARRAY[player1_id, player2_id]) AS pid, (team_id = win_id) AS won FROM mt
), agg AS (
  SELECT gid, pid, COUNT(*) AS played,
         COUNT(*) FILTER (WHERE won) AS wins,
         COUNT(*) FILTER (WHERE NOT won) AS losses
    FROM pp WHERE pid IS NOT NULL
   GROUP BY gid, pid
), quem AS (
  SELECT a.*, g.organization_id AS org, g.date AS gdate, g.ranked,
         COALESCE(o.points_rules, '{"point_per_match_played": 1, "point_per_match_win": 3, "point_per_mix_participation": 2, "point_per_mix_win": 10}'::jsonb) AS rules,
         CASE WHEN g.format = 'americano'
           THEN (a.pid IN (SELECT americano_first_place(g.id)))
           ELSE EXISTS (SELECT 1 FROM teams wt
                         WHERE wt.id = g.winner_team_id AND a.pid IN (wt.player1_id, wt.player2_id))
         END AS won_mix
    FROM agg a
    JOIN games g ON g.id = a.gid
    JOIN organizations o ON o.id = g.organization_id
   WHERE EXISTS (SELECT 1 FROM profiles p WHERE p.id = a.pid)
     AND NOT EXISTS (SELECT 1 FROM mix_player_stats s WHERE s.game_id = a.gid AND s.user_id = a.pid)
)
SELECT gid, pid, org, gdate, ranked, played, wins, losses, won_mix,
       (played * COALESCE((rules->>'point_per_match_played')::int, 0)
        + wins * COALESCE((rules->>'point_per_match_win')::int, 0)
        + COALESCE((rules->>'point_per_mix_participation')::int, 0)
        + CASE WHEN won_mix THEN COALESCE((rules->>'point_per_mix_win')::int, 0) ELSE 0 END)::int AS pts
  FROM quem;

INSERT INTO mix_player_stats (game_id, user_id, organization_id, matches_played, matches_won, points_earned, mix_won)
SELECT gid, pid, org, played, wins, pts, won_mix FROM _mix_falta
ON CONFLICT (game_id, user_id) DO NOTHING;

-- Uma pessoa pode ter mais de um mix em falta no mesmo clube: soma primeiro.
INSERT INTO player_stats (user_id, organization_id, game_wins, game_losses, mix_wins, mixes_played, total_points)
SELECT pid, org, SUM(wins), SUM(losses), COUNT(*) FILTER (WHERE won_mix), COUNT(*), SUM(pts)
  FROM _mix_falta WHERE ranked
 GROUP BY pid, org
ON CONFLICT (user_id, organization_id) DO UPDATE
SET game_wins    = player_stats.game_wins    + EXCLUDED.game_wins,
    game_losses  = player_stats.game_losses  + EXCLUDED.game_losses,
    mix_wins     = player_stats.mix_wins     + EXCLUDED.mix_wins,
    mixes_played = player_stats.mixes_played + EXCLUDED.mixes_played,
    total_points = player_stats.total_points + EXCLUDED.total_points,
    updated_at   = NOW();

WITH xp_rows AS (
  SELECT pid, org, gid, gdate, 'mix_participation'::text AS kind, 20 AS amount FROM _mix_falta
  UNION ALL
  SELECT pid, org, gid, gdate, 'mix_games', played * 5 FROM _mix_falta WHERE played > 0
  UNION ALL
  SELECT pid, org, gid, gdate, 'mix_win', 30 FROM _mix_falta WHERE won_mix
), ins_xp AS (
  INSERT INTO xp_events (user_id, organization_id, kind, source_game_id, amount, occurred_at)
  SELECT pid, org, kind, gid, amount, gdate FROM xp_rows
  ON CONFLICT (user_id, kind, source_game_id) WHERE source_game_id IS NOT NULL DO NOTHING
  RETURNING user_id, amount
)
UPDATE profiles p
   SET xp = p.xp + s.total
  FROM (SELECT user_id, SUM(amount) AS total FROM ins_xp GROUP BY user_id) s
 WHERE p.id = s.user_id;

UPDATE profiles p
   SET last_played_at = GREATEST(COALESCE(p.last_played_at, f.ultimo), f.ultimo)
  FROM (SELECT pid, MAX(gdate) AS ultimo FROM _mix_falta GROUP BY pid) f
 WHERE p.id = f.pid;

SELECT check_and_award_trophies(pid) FROM (SELECT DISTINCT pid FROM _mix_falta) q;

COMMIT;

-- Verificar depois de correr:
--   SELECT proname, position('NOT mb.is_guest' IN prosrc) = 0 FROM pg_proc
--    WHERE proname IN ('finalize_mix', 'finalize_americano_mix', 'correct_finished_mix_match');  → 3× true
--   -- Quem jogou e não tem linha (deve dar 0):
--   SELECT count(*) FROM games g
--     JOIN matches m ON m.game_id = g.id AND m.winner_team_id IS NOT NULL
--     JOIN teams t ON t.id IN (m.team_a_id, m.team_b_id)
--     CROSS JOIN LATERAL unnest(ARRAY[t.player1_id, t.player2_id]) AS u(pid)
--    WHERE g.status = 'finished' AND u.pid IS NOT NULL
--      AND NOT EXISTS (SELECT 1 FROM mix_player_stats s WHERE s.game_id = g.id AND s.user_id = u.pid);
