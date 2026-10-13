-- ═════════════════════════════════════════════════════════════════════════
-- Jogos entre amigos: «Não está certo» fecha a pergunta para todos
--
-- PORQUÊ. QA (jogo de 12 out), via Bugs, 13 out: quando alguém diz «Não
-- está certo», o sino dos outros jogadores continuava a perguntar «Está
-- certo?» por um resultado que já saiu do ranking. A página do jogo já não
-- pergunta (olha para o rejected_by); o aviso no sino ficava por ler.
--
-- O QUE FAZ. reject_friend_match_result marca como lidos os avisos
-- 'friend_match_result_sent' desse jogo de todos (antes, só o de quem
-- rejeita). Quando quem enviou corrige (correct_friend_match_result), todos
-- voltam a receber o aviso, por isso ninguém perde a pergunta. Corpo VIVO,
-- 1 troca literal («já estava»).
--
-- ORDEM. Depois de migration_amigos_rejeitar_sem_vou.sql.
--
-- Dev 3, 13 out 2026 · ecrã: Bugs (não muda)
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  c_mau CONSTANT TEXT := E'   WHERE user_id = auth.uid() AND kind = ''friend_match_result_sent'' AND read_at IS NULL AND data->>''match_id'' = p_match_id::text;';
  c_bom CONSTANT TEXT := E'   -- De todos: o resultado saiu do ranking até ser corrigido (QA, 13 out).\n'
                      || E'   WHERE kind = ''friend_match_result_sent'' AND read_at IS NULL AND data->>''match_id'' = p_match_id::text;';
  v_def TEXT := pg_get_functiondef('public.reject_friend_match_result(uuid,text,jsonb)'::regprocedure);
BEGIN
  IF position('o resultado saiu do ranking até ser corrigido' IN v_def) > 0 THEN
    RAISE NOTICE 'reject_friend_match_result: já estava';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, c_mau, ''))) / length(c_mau) <> 1 THEN
    RAISE EXCEPTION 'reject_friend_match_result: o pedaço a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE replace(v_def, c_mau, c_bom);
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_functiondef('public.reject_friend_match_result(uuid,text,jsonb)'::regprocedure) LIKE '%saiu do ranking até ser corrigido%';  -- true
