-- ═════════════════════════════════════════════════════════════════════════
-- #491 (1/2) — Falta e desistência só num jogo com as duas duplas e ainda
-- por acabar (mark_walkover).
--
-- O que se passava (teste do Renato em produção, 24 set): dava para marcar
-- falta num jogo «a definir» (sem as duplas lá, como «1.º do Grupo A») e
-- num jogo já terminado. O ecrã do /marcar já esconde os botões nesses
-- casos, mas a regra tem de estar no servidor: quem chama a função
-- diretamente passava.
--
-- O que faz: dois «não» logo a seguir à verificação de quem pode marcar.
--   · jogo sem as duas duplas → «Este jogo ainda não tem as duas duplas»;
--   · jogo já acabado (terminado, falta, desistência) → «Este jogo já
--     acabou…». Mudar um jogo acabado passa a ser desfazer a falta
--     (undo_walkover, parte 2/2) ou corrigir o resultado.
--
-- Independente da parte 2/2 (que precisa do sim do Renato): esta pode
-- correr já.
--
-- Parte do corpo vivo (a mark_walkover de 6 argumentos; md5 do prosrc em
-- produção a 25 set: 49a9d0a2…, igual ao da migration_tournaments_walkover
-- _rest.sql). Troca só o fragmento, recusa se não o encontrar exatamente
-- uma vez, e diz «já estava» se já tiver as duas regras. Mesma
-- assinatura: as permissões ficam; repõem-se explicitamente na mesma
-- (REVOKE de PUBLIC e anon, GRANT só a authenticated).
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  c_quem_mau CONSTANT TEXT :=
    '(RAISE EXCEPTION ''Não podes marcar resultados nesta categoria''\s+USING ERRCODE = ''insufficient_privilege'';\s+END IF;)';
  c_quem_bom CONSTANT TEXT := '\1

  -- #491: só num jogo com as duas duplas e ainda por acabar. Mudar um jogo
  -- acabado é desfazer a falta (undo_walkover) ou corrigir o resultado.
  IF m.entry_a_id IS NULL OR m.entry_b_id IS NULL THEN
    RAISE EXCEPTION ''Este jogo ainda não tem as duas duplas'';
  END IF;
  IF m.status IN (''terminado'', ''falta'', ''desistencia'') THEN
    RAISE EXCEPTION ''Este jogo já acabou. Para o mudar, desfaz a falta ou corrige o resultado'';
  END IF;';
  v_sig  CONSTANT TEXT := 'public.mark_walkover(uuid, text, text, boolean, integer, integer)';
  v_def  TEXT;
BEGIN
  IF to_regprocedure(v_sig) IS NULL THEN
    RAISE EXCEPTION 'Não existe a mark_walkover de 6 argumentos. Parar e ler.';
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE proname = 'mark_walkover'
         AND pronamespace = 'public'::regnamespace) <> 1 THEN
    RAISE EXCEPTION 'Há mais do que uma mark_walkover (ver #465). Parar e ler.';
  END IF;

  v_def := pg_get_functiondef(v_sig::regprocedure);
  IF position('ainda não tem as duas duplas' IN v_def) > 0 THEN
    RAISE NOTICE 'mark_walkover: as regras do #491 já estavam.';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_quem_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'mark_walkover mudou: o fragmento esperado não aparece exatamente uma vez. Ler o corpo vivo.';
  END IF;

  EXECUTE regexp_replace(v_def, c_quem_mau, c_quem_bom);

  IF position('ainda não tem as duas duplas' IN pg_get_functiondef(v_sig::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'mark_walkover: as regras do #491 não ficaram. Parar e ler.';
  END IF;
  RAISE NOTICE 'mark_walkover: recusa jogos sem as duas duplas e jogos já acabados.';
END $$;

REVOKE ALL ON FUNCTION public.mark_walkover(UUID, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_walkover(UUID, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_walkover(UUID, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER) TO authenticated;
