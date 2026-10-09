-- ═════════════════════════════════════════════════════════════════════════
-- Amigos: a ronda seguinte nunca impede de guardar esta
--
-- PORQUÊ. QA, 9 out (falha grave; o PO tirou o «A jogar» do main por isto):
-- jogo a rodar com 5 pessoas, só a organizadora com conta e 4 convidados só
-- com nome. «Guardar ronda 1» era recusado com «Em cada jogo tem de jogar
-- pelo menos uma pessoa com conta.» O save_friend_match_round cria a ronda 2
-- com as duplas de p_next_courts; nessa rotação a única pessoa com conta
-- descansa, o friend_match_slots recusa um campo só com convidados, e a
-- gravação da ronda 1 ia abaixo com ele (e a mensagem culpava a ronda
-- errada).
--
-- PORQUE NÃO SE CRIA A RONDA «SEM A TRAVA». Cada ronda guarda-se com uma
-- pessoa com conta no 1.º lugar (team_a_player1_id; não há lugar para um
-- convidado aí). Um campo só com convidados não se pode guardar hoje, nem
-- pela ronda seguinte nem pelo «Juntar ronda». Isso resolve-se na rotação
-- do ecrã (Bugs: cada campo com pelo menos uma pessoa com conta, quando dá)
-- ou mudando a forma de guardar as rondas — decisão do PO.
--
-- O QUE FAZ (corpo VIVO, 3 trocas; «já estava»). A criação da ronda seguinte
-- passa a estar num bloco à parte: se falhar, desfaz-se só ela (nenhum campo
-- da ronda seguinte fica a meio), a ronda que se guardou fica gravada, e a
-- resposta traz next_ids = [] e next_error: 'guest_only_court' (um campo só
-- com convidados) ou, outro motivo, o texto do erro. Sem falha, tudo igual
-- (next_error = null). Para a ronda seguinte nascer, quem organiza junta-a
-- com outras duplas pelo add_friend_match_round («Juntar ronda»), que já
-- existe. CREATE OR REPLACE: assinatura e permissões ficam.
--
-- Ordem: depois da migration_amigos_rondas_com_tipo.sql (e da
-- migration_amigos_quem_aceitou.sql, que troca outro pedaço da mesma função).
-- Dev 3, 9 out 2026 · ecrã: Bugs (mostrar next_error como aviso da ronda
-- seguinte, não como erro da ronda guardada)
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  c_decl CONSTANT TEXT := '(v_court SMALLINT := 0;)';
  c_ini  CONSTANT TEXT := '(-- A ronda seguinte nasce sozinha, igual a esta \(ou com as duplas previstas\)\.)';
  c_fim  CONSTANT TEXT := '(END IF;\s+END IF;)(\s+RETURN jsonb_build_object\(''status'', \(SELECT status FROM private_matches WHERE id = p_match_id\), ''next_ids'', to_jsonb\(v_ids\))\)';
  v_def  TEXT;
BEGIN
  IF to_regprocedure('public.save_friend_match_round(uuid,integer,integer,text,smallint,jsonb,boolean)') IS NULL THEN
    RAISE EXCEPTION 'Correr primeiro a migration_amigos_rondas_com_tipo.sql.';
  END IF;
  v_def := pg_get_functiondef('public.save_friend_match_round(uuid,integer,integer,text,smallint,jsonb,boolean)'::regprocedure);
  IF v_def LIKE '%next_error%' THEN
    RAISE NOTICE 'save_friend_match_round: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_decl, 'g')) <> 1
     OR (SELECT count(*) FROM regexp_matches(v_def, c_ini, 'g')) <> 1
     OR (SELECT count(*) FROM regexp_matches(v_def, c_fim, 'g')) <> 1 THEN
    RAISE EXCEPTION 'save_friend_match_round: o pedaço a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  v_def := regexp_replace(v_def, c_decl, E'\\1\n  v_next_error TEXT;');
  v_def := regexp_replace(v_def, c_ini,
    E'\\1\n  -- Num bloco à parte (QA, 9 out): se a seguinte não se puder criar, esta\n'
    || E'  -- fica guardada e a app recebe o motivo em next_error.\n  BEGIN');
  v_def := regexp_replace(v_def, c_fim,
    E'\\1\n  EXCEPTION WHEN OTHERS THEN\n    v_ids := ''{}'';\n'
    || E'    -- Um código para o ecrã escrever a frase; outro motivo vai como texto.\n'
    || E'    v_next_error := CASE WHEN SQLERRM LIKE ''%pelo menos uma pessoa com conta%'' THEN ''guest_only_court'' ELSE SQLERRM END;\n'
    || E'  END;\\2, ''next_error'', v_next_error)');
  EXECUTE v_def;
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_functiondef('public.save_friend_match_round(uuid,integer,integer,text,smallint,jsonb,boolean)'::regprocedure) LIKE '%next_error%';  -- true
