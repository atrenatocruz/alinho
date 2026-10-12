-- ═════════════════════════════════════════════════════════════════════════
-- Criar grupos: um grupo grátis por dono; os pagos não contam
--
-- PORQUÊ. Regra do Francisco, 12 out (via PO): «quando és Squad podes ter
-- mais um Free. Fica o limite: um pago e um Free.» Caso real: o dono de um
-- grupo Squad não conseguia criar um segundo grupo. O create_self_serve_group
-- bloqueava com o 1.º grupo do dono em 'free' OU 'plus' (Squad).
--
-- O QUE FAZ. create_self_serve_group só recusa se o dono já tiver um grupo
-- seu (sem pai) no plano grátis. Os grupos pagos (Squad, Community, Club)
-- não contam. Um grupo novo nasce grátis, por isso o segundo grupo pago só
-- aparece quando o grátis passar a um plano pago. Mensagem nova: «Já tens
-- um grupo grátis (%). Para criares outro, passa esse grupo a um plano
-- pago.», com o código 'already_has_free_group' no hint do erro (para o
-- ecrã). Corpo VIVO, 2 trocas literais («já estava»); as permissões ficam
-- e voltam a fechar-se a PUBLIC e anon.
--
-- Dev 3, 12 out 2026 · ecrã: Dev 1
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  c_regra_mau CONSTANT TEXT := $a$AND COALESCE(o.plan_tier, 'free') IN ('free', 'plus')$a$;
  c_regra_bom CONSTANT TEXT := $a$AND COALESCE(o.plan_tier, 'free') = 'free'$a$;
  c_msg_mau   CONSTANT TEXT := $a$RAISE EXCEPTION 'Já tens um grupo no plano Free ou Squad (%). Para criares outro, esse grupo tem de estar no plano Community ou Club.', v_blocking_name;$a$;
  c_msg_bom   CONSTANT TEXT := $a$RAISE EXCEPTION 'Já tens um grupo grátis (%). Para criares outro, passa esse grupo a um plano pago.', v_blocking_name USING HINT = 'already_has_free_group';$a$;
  v_def TEXT := pg_get_functiondef('public.create_self_serve_group(text,text)'::regprocedure);
BEGIN
  IF position(c_regra_bom IN v_def) > 0 AND position(c_msg_bom IN v_def) > 0 THEN
    RAISE NOTICE 'create_self_serve_group: já estava';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, c_regra_mau, ''))) / length(c_regra_mau) <> 1
     OR (length(v_def) - length(replace(v_def, c_msg_mau, ''))) / length(c_msg_mau) <> 1 THEN
    RAISE EXCEPTION 'create_self_serve_group: um dos pedaços a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  v_def := replace(v_def, c_regra_mau, c_regra_bom);
  v_def := replace(v_def, c_msg_mau, c_msg_bom);
  EXECUTE v_def;
END $$;

REVOKE ALL ON FUNCTION public.create_self_serve_group(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_self_serve_group(TEXT, TEXT) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_functiondef('public.create_self_serve_group(text,text)'::regprocedure) LIKE '%Já tens um grupo grátis%';  -- true
--   SELECT has_function_privilege('anon', 'public.create_self_serve_group(text,text)', 'EXECUTE');  -- false
