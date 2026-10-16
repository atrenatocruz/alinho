-- ═════════════════════════════════════════════════════════════════════════
-- Perfil de outra pessoa: os MEUS confrontos diretos com ela veem-se sempre
--
-- PORQUÊ. Francisco, 10 out (via PO): «se joguei contra ele deveria ver
-- pelo menos esses, mesmo que não mostre os outros jogos dele. Os meus
-- deveria poder ver: contra quem joguei e quanto ficou.» Até aqui, o
-- get_head_to_head_summary e o get_head_to_head_matches devolviam 0/vazio
-- quando a atividade da outra pessoa não era visível para mim
-- (can_view_section(…, activity_visibility)); 187 de 190 perfis estão em
-- 'friends', e o ecrã dizia «Sem confrontos registados», o que engana.
--
-- O QUE FAZ (corpo VIVO, 1 troca em cada; «já estava»). Sai a trava do
-- activity_visibility. As duas já só olham para jogos com auth.uid() de um
-- lado e a outra pessoa do outro, por isso não mostram nada da atividade
-- dela com outros. Tudo o resto do perfil continua escondido como hoje.
-- CREATE OR REPLACE; e as duas deixam de poder ser chamadas por anon (sem
-- sessão não há «os meus» jogos). E o resumo deixa de contar mixes
-- cancelados, como a lista já fazia (PO, 10 out): os números batem sempre.
--
-- Ecrã: o PlayerDetails.jsx também esconde a secção com activityHidden —
-- tem de deixar de o fazer (Dev 4, pelo PO).
-- Dev 3, 10 out 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  c_lista  CONSTANT TEXT := 'WHERE can_view_section\(p_opponent_id, \(SELECT p\.activity_visibility FROM profiles p WHERE p\.id = p_opponent_id\)\)';
  c_resumo CONSTANT TEXT := 'SELECT can_view_section\(p_opponent_id, p\.activity_visibility\) AS ok';
  c_cancel CONSTANT TEXT := 'WHERE m\.winner_team_id IS NOT NULL(\s+AND pa\.is_a <> pb\.is_a)';
  v_def    TEXT;
BEGIN
  v_def := pg_get_functiondef('public.get_head_to_head_matches(uuid)'::regprocedure);
  IF v_def NOT LIKE '%can_view_section%' THEN
    RAISE NOTICE 'get_head_to_head_matches: já estava';
  ELSE
    IF (SELECT count(*) FROM regexp_matches(v_def, c_lista, 'g')) <> 1 THEN
      RAISE EXCEPTION 'get_head_to_head_matches: o pedaço a trocar não aparece 1 vez. Parar e ler.';
    END IF;
    EXECUTE regexp_replace(v_def, c_lista,
      '-- Os meus jogos contra esta pessoa veem-se sempre (Francisco, 10 out).');
  END IF;

  v_def := pg_get_functiondef('public.get_head_to_head_summary(uuid)'::regprocedure);
  IF v_def NOT LIKE '%can_view_section%' THEN
    RAISE NOTICE 'get_head_to_head_summary (trava): já estava';
  ELSE
    IF (SELECT count(*) FROM regexp_matches(v_def, c_resumo, 'g')) <> 1 THEN
      RAISE EXCEPTION 'get_head_to_head_summary: o pedaço a trocar não aparece 1 vez. Parar e ler.';
    END IF;
    v_def := regexp_replace(v_def, c_resumo,
      'SELECT TRUE AS ok  -- os meus confrontos veem-se sempre (Francisco, 10 out)');
  END IF;
  -- O resumo também deixa de contar mixes cancelados, como a lista (PO, 10 out):
  -- assim os números batem sempre.
  IF v_def LIKE '%IS DISTINCT FROM ''cancelled''%' THEN
    RAISE NOTICE 'get_head_to_head_summary (cancelados): já estava';
  ELSE
    IF (SELECT count(*) FROM regexp_matches(v_def, c_cancel, 'g')) <> 1 THEN
      RAISE EXCEPTION 'get_head_to_head_summary: o pedaço dos cancelados não aparece 1 vez. Parar e ler.';
    END IF;
    v_def := regexp_replace(v_def, c_cancel,
      E'WHERE m.winner_team_id IS NOT NULL\n      AND (SELECT g.status FROM games g WHERE g.id = m.game_id) IS DISTINCT FROM ''cancelled''\\1');
  END IF;
  IF v_def IS DISTINCT FROM pg_get_functiondef('public.get_head_to_head_summary(uuid)'::regprocedure) THEN
    EXECUTE v_def;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.get_head_to_head_matches(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_head_to_head_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_head_to_head_matches(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_head_to_head_summary(uuid) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT count(*) FROM pg_proc WHERE proname IN ('get_head_to_head_matches', 'get_head_to_head_summary')
--      AND pg_get_functiondef(oid) LIKE '%can_view_section%';                                    -- 0
--   SELECT has_function_privilege('anon', 'public.get_head_to_head_summary(uuid)', 'EXECUTE');   -- false
