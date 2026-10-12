-- ═════════════════════════════════════════════════════════════════════════
-- Jogos entre amigos: quem recebeu o resultado pode dizer se está certo
--
-- PORQUÊ. Francisco, 12 out (via PO, notas-entre-devs/2026-10-12-amigos-nao-
-- esta-certo/): recebeu «Teste enviou o resultado…», abriu «O que não está
-- certo?», mudou a ronda 2 e a resposta foi «Só quem criou o jogo ou quem
-- disse «Vou» pode marcar». O aviso do resultado vai a quem jogou e está
-- no jogo com «Vou» OU ainda sem responder (friend_match_notify_sent), mas o
-- reject e o confirm só aceitavam quem disse «Vou». Quem o criador pôs no
-- jogo e nunca respondeu ficava com o aviso e sem poder responder.
--
-- O QUE FAZ. reject_friend_match_result e confirm_friend_match_result
-- aceitam também quem está no jogo ainda sem responder ('pending') — os
-- mesmos que recebem o aviso. Continua a ser preciso ter jogado uma ronda
-- (reject). Confirmar não muda o «Vou»: para contar no ranking a pessoa
-- continua a ter de aceitar o jogo. Corpo VIVO, 1 troca literal em cada
-- («já estava»).
--
-- ORDEM. Depois de migration_amigos_o_fim.sql.
--
-- Dev 3, 12 out 2026 · ecrã: Bugs
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  f      RECORD;
  v_def  TEXT;
BEGIN
  FOR f IN SELECT * FROM (VALUES
    ('public.reject_friend_match_result(uuid,text,jsonb)',
     $a$i.user_id = auth.uid() AND i.status = 'accepted')$a$,
     $b$i.user_id = auth.uid() AND i.status IN ('accepted', 'pending'))$b$),
    ('public.confirm_friend_match_result(uuid)',
     $a$WHERE match_id = p_match_id AND user_id = auth.uid() AND status = 'accepted';$a$,
     $b$WHERE match_id = p_match_id AND user_id = auth.uid() AND status IN ('accepted', 'pending');$b$)
  ) AS t(sig, mau, bom) LOOP
    v_def := pg_get_functiondef(f.sig::regprocedure);
    IF position(f.bom IN v_def) > 0 THEN
      RAISE NOTICE '%: já estava', f.sig;
      CONTINUE;
    END IF;
    IF (length(v_def) - length(replace(v_def, f.mau, ''))) / length(f.mau) <> 1 THEN
      RAISE EXCEPTION '%: o pedaço a trocar não aparece 1 vez. Parar e ler.', f.sig;
    END IF;
    EXECUTE replace(v_def, f.mau, f.bom);
  END LOOP;
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_functiondef('public.reject_friend_match_result(uuid,text,jsonb)'::regprocedure) LIKE '%IN (''accepted'', ''pending'')%';  -- true
--   SELECT pg_get_functiondef('public.confirm_friend_match_result(uuid)'::regprocedure) LIKE '%IN (''accepted'', ''pending'')%';  -- true
