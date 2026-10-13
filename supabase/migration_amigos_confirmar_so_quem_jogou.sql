-- ═════════════════════════════════════════════════════════════════════════
-- Jogos entre amigos: só quem jogou confirma o resultado
--
-- PORQUÊ. QA, 13 out, sobre o migration_amigos_rejeitar_sem_vou.sql: um
-- convidado que não jogou nenhuma ronda era recusado no «Não está certo»,
-- mas o «Está certo» passava. A regra do PO é a mesma para os dois botões:
-- só quem jogou alguma ronda responde ao resultado.
--
-- O QUE FAZ. confirm_friend_match_result recusa com 'not_allowed' quem não
-- jogou nenhuma ronda da sessão (a mesma verificação do reject). Corpo
-- VIVO, 1 troca literal («já estava»).
--
-- ORDEM. Depois de migration_amigos_rejeitar_sem_vou.sql.
--
-- Dev 3, 13 out 2026 · ecrã: Bugs
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  c_frag CONSTANT TEXT := '  UPDATE private_match_invitees SET result_ok_at = NOW()';
  v_def  TEXT := pg_get_functiondef('public.confirm_friend_match_result(uuid)'::regprocedure);
BEGIN
  IF v_def LIKE '%Só quem jogou responde%' THEN
    RAISE NOTICE 'confirm_friend_match_result: já estava';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, c_frag, ''))) / length(c_frag) <> 1 THEN
    RAISE EXCEPTION 'confirm_friend_match_result: o pedaço a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE replace(v_def, c_frag,
       E'  -- Só quem jogou responde ao resultado (QA, 13 out), como no reject.\n'
    || E'  IF NOT EXISTS (SELECT 1 FROM private_matches m WHERE (m.id = p_match_id OR m.session_id = p_match_id)\n'
    || E'                  AND auth.uid() IN (m.team_a_player1_id, m.team_a_player2_id, m.team_b_player1_id, m.team_b_player2_id)) THEN\n'
    || E'    RAISE EXCEPTION ''not_allowed'';\n'
    || E'  END IF;\n'
    || c_frag);
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_functiondef('public.confirm_friend_match_result(uuid)'::regprocedure) LIKE '%Só quem jogou responde%';  -- true
