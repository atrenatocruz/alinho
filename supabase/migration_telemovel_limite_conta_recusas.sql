-- ═════════════════════════════════════════════════════════════════════════
-- Telemóvel: cada pedido recusado também conta para o limite de 5 por hora
--
-- O QUE FAZ, no start_phone_verification_for_user (corpo vivo, 2 trocas):
--   · um número já confirmado noutra conta passa a deixar uma linha em
--     phone_verifications, que conta para o limite;
--   · a linha nasce já expirada e com um código que não é de 6 algarismos,
--     por isso nunca serve para confirmar nada, e o código que a pessoa
--     tenha em aberto continua a valer;
--   · os pedidos da mesma conta passam um de cada vez, para o limite valer
--     também com pedidos em simultâneo.
--
-- PORQUE DEIXA DE DAR ERRO. Um erro desfaz tudo o que a função escreveu,
-- incluindo a linha. Por isso a recusa volta como uma linha sem código, e a
-- send-otp traduz isso para a mesma resposta de sempre (409, phone_taken).
--
-- A APP ANTIGA. Só fala com a send-otp e continua a receber a mesma resposta.
-- Nada a mudar, e o texto no ecrã é o mesmo.
--
-- ORDEM. PRIMEIRO publicar a send-otp nova, DEPOIS correr este ficheiro. Com
-- a send-otp antiga, quem pedisse um número de outra conta via um erro geral
-- em vez da mensagem certa (nunca recebe SMS).
--
-- Para desfazer (só em emergência): voltar a pôr o corpo anterior
-- (md5 sem \r 0ae57d04…, antes das trocas). A send-otp nova funciona com os
-- dois corpos.
--
-- Dev 3, 10 nov 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  v_marca CONSTANT TEXT := 'a recusa conta para o limite (10 nov)';
  v_def   TEXT := replace(pg_get_functiondef('public.start_phone_verification_for_user(uuid,text,text)'::regprocedure), E'\r', '');
  v_n     INT;
  r       RECORD;
BEGIN
  IF position(v_marca IN v_def) > 0 THEN
    RAISE NOTICE 'start_phone_verification_for_user: já estava';
    RETURN;
  END IF;
  FOR r IN
    SELECT * FROM (VALUES
      ('  -- Nada de pedir códigos sem fim: 5 por hora chegam (regra do #537).',
       E'  -- Um pedido de cada vez por conta, para a contagem abaixo ser certa.\n'
       || E'  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));\n'
       || '  -- Nada de pedir códigos sem fim: 5 por hora chegam (regra do #537).'),
      ('    RAISE EXCEPTION ''phone_taken'';',
       '    -- ' || v_marca || E': linha já expirada, sem código que sirva.\n'
       || E'    INSERT INTO phone_verifications (user_id, phone_hash, code, expires_at, channel, result)\n'
       || E'    VALUES (p_user_id, p_hash, ''recusado'', now(), p_channel, jsonb_build_object(''refused'', ''phone_taken''));\n'
       || E'    RETURN QUERY SELECT NULL::text, NULL::timestamptz;\n'
       || '    RETURN;')
    ) AS x(old_txt, new_txt)
  LOOP
    v_n := (length(v_def) - length(replace(v_def, r.old_txt, ''))) / length(r.old_txt);
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'start_phone_verification_for_user: esperava 1 vez «%», encontrei %. Parar e ler.', r.old_txt, v_n;
    END IF;
    v_def := replace(v_def, r.old_txt, r.new_txt);
  END LOOP;
  EXECUTE v_def;
END $$;

REVOKE ALL ON FUNCTION public.start_phone_verification_for_user(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.start_phone_verification_for_user(uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.start_phone_verification_for_user(uuid, text, text) FROM authenticated;

DO $$
BEGIN
  IF has_function_privilege('authenticated', 'public.start_phone_verification_for_user(uuid,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.start_phone_verification_for_user(uuid,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.start_phone_verification_for_user(uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Acessos de start_phone_verification_for_user errados';
  END IF;
  IF position('a recusa conta para o limite (10 nov)' IN pg_get_functiondef('public.start_phone_verification_for_user(uuid,text,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'start_phone_verification_for_user sem a troca';
  END IF;
END $$;

COMMIT;
