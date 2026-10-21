-- ═════════════════════════════════════════════════════════════════════════
-- Conquistas «da estrada»: Deste Boleia, Primeira Rotunda, Até à Porta
--
-- PORQUÊ. Aprovadas pelo Francisco a 21 out (design-handoff/2026-10-21-
-- conquista-primeira-rotunda/SPEC.md). Regras da BA no mesmo sítio
-- (REGRAS-BA.md, 21 out). Medalhas e textos: Dev 2.
--
-- AS REGRAS
--   · deste_boleia (rara, antiguidade): pelo menos uma pessoa que convidaste
--     já tem um jogo com resultado, de qualquer tipo (mix, jogo em aberto,
--     torneio, jogo de grupo, amigos confirmados). Convidado = os convites
--     que já contam no Boca a Boca (convite de grupo/clube aceite, convite
--     de parceiro reclamado) e quem criou conta com o teu código
--     (account_origins.ref_user_id, quando essa tabela existir). Uma vez por
--     pessoa, nunca o próprio, sem contas de teste. Dá-se também a quem
--     convidou, quando o convidado joga (não espera pelo próximo jogo dele).
--   · primeira_rotunda (épica, jogo): 2 jogos ganhos com o mesmo parceiro
--     (com conta), de qualquer tipo, não precisam de ser seguidos.
--   · ate_a_porta (lendária, jogo): ganhar um mix de dupla fixa
--     (games.winner_team_id; sobe_desce, escalada, todos_contra_todos,
--     grupos_eliminatorias) com um parceiro com quem já tinhas ganho um jogo
--     num dia anterior. Torneios não contam.
--
-- COMO. Só acrescenta (regra de 20 out: a app antiga tem de continuar a
-- funcionar). Três linhas novas no catálogo (achievements) e um bloco novo
-- no check_and_award_achievements_27, antes da gravação, por troca literal
-- no corpo vivo (1 vez, «já estava»). As outras conquistas ficam iguais.
--
-- Dev 3, 21 out 2026 · medalhas e textos: Dev 2 · regras: BA
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. O catálogo ───────────────────────────────────────────────────────
INSERT INTO achievements (key, category, rarity, sort, active) VALUES
  ('deste_boleia',     'antiguidade', 'raro',     1028, TRUE),
  ('primeira_rotunda', 'jogo',        'epico',    1029, TRUE),
  ('ate_a_porta',      'jogo',        'lendario', 1030, TRUE)
ON CONFLICT (key) DO NOTHING;

-- ── 2. Já jogou? (interna) ──────────────────────────────────────────────
-- Um jogo com resultado, de qualquer tipo, como a tabela _a27.
CREATE OR REPLACE FUNCTION public.achievement_has_played(p_uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT EXISTS (SELECT 1 FROM teams tm
                   JOIN games g ON g.id = tm.game_id AND g.status <> 'cancelled'
                   JOIN matches m ON m.game_id = g.id AND tm.id IN (m.team_a_id, m.team_b_id) AND m.winner_team_id IS NOT NULL
                  WHERE p_uid IN (tm.player1_id, tm.player2_id))
      OR EXISTS (SELECT 1 FROM tournament_entries me
                   JOIN tournament_matches tmx ON me.id IN (tmx.entry_a_id, tmx.entry_b_id)
                        AND tmx.status = 'terminado' AND tmx.winner_entry_id IS NOT NULL
                  WHERE p_uid IN (me.player1_id, me.player2_id))
      OR EXISTS (SELECT 1 FROM group_matches gm
                  WHERE gm.winner_team IS NOT NULL
                    AND p_uid IN (gm.team_a_player1_id, gm.team_a_player2_id, gm.team_b_player1_id, gm.team_b_player2_id))
      OR EXISTS (SELECT 1 FROM private_matches pm
                  WHERE pm.status = 'confirmed' AND NOT COALESCE(pm.is_friend_session, FALSE) AND pm.winner_team IS NOT NULL
                    AND p_uid IN (pm.team_a_player1_id, pm.team_a_player2_id, pm.team_b_player1_id, pm.team_b_player2_id));
$function$;
REVOKE ALL ON FUNCTION public.achievement_has_played(UUID) FROM PUBLIC, anon, authenticated;

-- Quem me convidou / quem eu convidei (interna). Os convites do Boca a Boca
-- e, se a tabela já existir, o código de quem convidou na conta nova.
CREATE OR REPLACE FUNCTION public.achievement_invite_pairs(p_uid UUID)
RETURNS TABLE(inviter UUID, invited UUID)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  RETURN QUERY
    SELECT DISTINCT x.inviter, x.invited FROM (
      SELECT oi.invited_by AS inviter, oi.invited_user_id AS invited FROM organization_invites oi
       WHERE oi.status = 'accepted' AND (oi.invited_by = p_uid OR oi.invited_user_id = p_uid)
      UNION
      SELECT pi.invited_by, pi.claimed_by FROM partner_invites pi
       WHERE pi.claimed_by IS NOT NULL AND (pi.invited_by = p_uid OR pi.claimed_by = p_uid)
    ) x
    JOIN profiles a ON a.id = x.inviter AND NOT COALESCE(a.is_test, FALSE)
    JOIN profiles b ON b.id = x.invited AND NOT COALESCE(b.is_test, FALSE)
   WHERE x.inviter IS NOT NULL AND x.invited IS NOT NULL AND x.inviter <> x.invited;
  -- A origem da conta (migration_origem_da_conta.sql) pode ainda não ter corrido.
  IF to_regclass('public.account_origins') IS NOT NULL THEN
    RETURN QUERY EXECUTE
      'SELECT ao.ref_user_id, ao.user_id FROM public.account_origins ao
         JOIN public.profiles a ON a.id = ao.ref_user_id AND NOT COALESCE(a.is_test, FALSE)
         JOIN public.profiles b ON b.id = ao.user_id AND NOT COALESCE(b.is_test, FALSE)
        WHERE ao.ref_user_id IS NOT NULL AND ao.ref_user_id <> ao.user_id
          AND (ao.ref_user_id = $1 OR ao.user_id = $1)'
      USING p_uid;
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.achievement_invite_pairs(UUID) FROM PUBLIC, anon, authenticated;

-- ── 3. O bloco no verificador das 27 ────────────────────────────────────
DO $$
DECLARE
  c_ancora CONSTANT TEXT := E'  INSERT INTO player_achievements (user_id, achievement_key, awarded_at)\n  SELECT p_user_id, k, COALESCE(p_awarded_at, NOW())';
  c_bloco  CONSTANT TEXT :=
       E'  -- ── Da estrada (21 out) ──\n'
    || E'  -- Primeira Rotunda: 2 jogos ganhos com o mesmo parceiro, de qualquer tipo.\n'
    || E'  IF EXISTS (SELECT 1 FROM _a27 WHERE won AND partner IS NOT NULL GROUP BY partner HAVING count(*) >= 2)\n'
    || E'  THEN e := array_append(e, ''primeira_rotunda''); END IF;\n'
    || E'  -- Até à Porta: ganhar um mix de dupla fixa com quem já tinhas ganho um jogo num dia anterior.\n'
    || E'  IF EXISTS (SELECT 1 FROM games g\n'
    || E'               JOIN teams tm ON tm.id = g.winner_team_id AND p_user_id IN (tm.player1_id, tm.player2_id)\n'
    || E'              WHERE g.status = ''finished''\n'
    || E'                AND g.format IN (''sobe_desce'', ''escalada'', ''todos_contra_todos'', ''grupos_eliminatorias'')\n'
    || E'                AND tm.player1_id IS NOT NULL AND tm.player2_id IS NOT NULL\n'
    || E'                AND EXISTS (SELECT 1 FROM _a27 a WHERE a.won\n'
    || E'                              AND a.partner = CASE WHEN tm.player1_id = p_user_id THEN tm.player2_id ELSE tm.player1_id END\n'
    || E'                              AND a.starts::date < (g.date AT TIME ZONE ''Europe/Lisbon'')::date))\n'
    || E'  THEN e := array_append(e, ''ate_a_porta''); END IF;\n'
    || E'  -- Deste Boleia: alguém que convidei já jogou; e, se eu já joguei, quem me convidou também a ganha.\n'
    || E'  IF EXISTS (SELECT 1 FROM achievement_invite_pairs(p_user_id) ip\n'
    || E'              WHERE ip.inviter = p_user_id AND achievement_has_played(ip.invited))\n'
    || E'  THEN e := array_append(e, ''deste_boleia''); END IF;\n'
    || E'  IF achievement_has_played(p_user_id) THEN\n'
    || E'    INSERT INTO player_achievements (user_id, achievement_key, awarded_at)\n'
    || E'    SELECT DISTINCT ip.inviter, ''deste_boleia'', COALESCE(p_awarded_at, NOW())\n'
    || E'      FROM achievement_invite_pairs(p_user_id) ip\n'
    || E'      JOIN achievements a ON a.key = ''deste_boleia'' AND a.active\n'
    || E'     WHERE ip.invited = p_user_id\n'
    || E'    ON CONFLICT (user_id, achievement_key) DO NOTHING;\n'
    || E'  END IF;\n\n';
  v_def TEXT := replace(pg_get_functiondef('public.check_and_award_achievements_27(uuid,timestamp with time zone)'::regprocedure), E'\r', '');
BEGIN
  IF position('── Da estrada (21 out) ──' IN v_def) > 0 THEN
    RAISE NOTICE 'check_and_award_achievements_27: já estava';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, c_ancora, ''))) / length(c_ancora) <> 1 THEN
    RAISE EXCEPTION 'check_and_award_achievements_27: a gravação não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE replace(v_def, c_ancora, c_bloco || c_ancora);
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT count(*) FROM achievements WHERE key IN ('deste_boleia', 'primeira_rotunda', 'ate_a_porta') AND active;   -- 3
--   SELECT pg_get_functiondef('public.check_and_award_achievements_27(uuid,timestamp with time zone)'::regprocedure) LIKE '%Da estrada (21 out)%';  -- true
-- Dar a quem já cumpre (opcional, a correr à parte pelo SI, fora de horas):
--   SELECT check_and_award_achievements(id) FROM profiles WHERE NOT COALESCE(is_test, FALSE);
