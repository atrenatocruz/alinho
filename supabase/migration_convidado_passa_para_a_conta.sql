-- ═════════════════════════════════════════════════════════════════════════
-- Convidado do WhatsApp que confirma o número: os mixes dele passam para a
-- conta, também os já sorteados e os dos últimos 2 dias
--
-- PORQUÊ. Casos reais de 19 out (via PO): no +1, «Eu até me inscrevia, mas
-- já apareço lá como convidado»; no M5, contas que o robô não reconheceu
-- (número por confirmar). Plano aprovado pelo Francisco a 19 out. Proposta
-- ao Ruben no #dev-updates (mexe na regra dos convidados).
--
-- O QUE JÁ HAVIA. apply_phone_confirmation (corre quando a conta confirma o
-- número): as inscrições de convidado com esse número passavam para a conta,
-- mas só em mixes abertos ou fechados, e sem tocar nas duplas sorteadas
-- (teams), que ficavam com o convidado.
--
-- O QUE MUDA
--   · Também os mixes acabados há menos de 2 dias (depois disso o número do
--     convidado já foi apagado por limpar_convidados_de_jogos_acabados).
--   · As duplas sorteadas (teams.player1/2_guest_id) passam para a conta,
--     nos jogos onde a inscrição passou.
--   · Os pontos dos jogos já feitos como convidado NÃO passam (os convidados
--     não mexem no nível). Num mix a decorrer, passa a contar como conta a
--     partir daí.
--   Corpo VIVO, trocas literais com contagem exata («já estava»).
--
-- Dev 3, 19 out 2026 · ecrã («Confirma o teu número»): Dev 4
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  c_estado_mau CONSTANT TEXT := 'AND g.status IN (''open'', ''closed'')';
  c_estado_bom CONSTANT TEXT := 'AND (g.status IN (''open'', ''closed'') OR (g.status = ''finished'' AND g.date >= now() - interval ''2 days''))';
  c_ancora     CONSTANT TEXT := E'    DELETE FROM game_guests gg\n     WHERE gg.phone_hash = p_phone_hash';
  c_duplas     CONSTANT TEXT :=
       E'    -- As duplas sorteadas também passam para a conta (19 out).\n'
    || E'    UPDATE teams t SET player1_id = p_user_id, player1_guest_id = NULL\n'
    || E'      FROM game_guests gg\n'
    || E'     WHERE gg.id = t.player1_guest_id AND gg.phone_hash = p_phone_hash\n'
    || E'       AND t.player2_id IS DISTINCT FROM p_user_id\n'
    || E'       AND EXISTS (SELECT 1 FROM participants q WHERE q.game_id = t.game_id\n'
    || E'                     AND (q.user_id = p_user_id OR q.partner_id = p_user_id));\n'
    || E'    UPDATE teams t SET player2_id = p_user_id, player2_guest_id = NULL\n'
    || E'      FROM game_guests gg\n'
    || E'     WHERE gg.id = t.player2_guest_id AND gg.phone_hash = p_phone_hash\n'
    || E'       AND t.player1_id IS DISTINCT FROM p_user_id\n'
    || E'       AND EXISTS (SELECT 1 FROM participants q WHERE q.game_id = t.game_id\n'
    || E'                     AND (q.user_id = p_user_id OR q.partner_id = p_user_id));\n\n';
  v_def TEXT := replace(pg_get_functiondef('public.apply_phone_confirmation(uuid,text)'::regprocedure), E'\r', '');
BEGIN
  IF position('As duplas sorteadas também passam para a conta (19 out)' IN v_def) > 0 THEN
    RAISE NOTICE 'apply_phone_confirmation: já estava';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, c_estado_mau, ''))) / length(c_estado_mau) <> 2 THEN
    RAISE EXCEPTION 'apply_phone_confirmation: o filtro dos estados não aparece 2 vezes. Parar e ler.';
  END IF;
  IF (length(v_def) - length(replace(v_def, c_ancora, ''))) / length(c_ancora) <> 1 THEN
    RAISE EXCEPTION 'apply_phone_confirmation: o DELETE dos convidados não aparece 1 vez. Parar e ler.';
  END IF;
  v_def := replace(v_def, c_estado_mau, c_estado_bom);
  v_def := replace(v_def, c_ancora, c_duplas || c_ancora);
  EXECUTE v_def;
END $$;

COMMIT;

-- Verificar depois de correr (true):
--   SELECT pg_get_functiondef('public.apply_phone_confirmation(uuid,text)'::regprocedure) LIKE '%As duplas sorteadas também passam para a conta (19 out)%';
