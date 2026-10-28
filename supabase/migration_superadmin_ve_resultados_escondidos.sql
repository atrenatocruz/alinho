-- ═════════════════════════════════════════════════════════════════════════
-- Superadmin com o modo ligado vê também os resultados escondidos
-- (ao vivo, «Já jogados» e quadros de torneio)
--
-- PORQUÊ. Francisco, 28 out (pelo PO), a seguir à
-- migration_superadmin_ve_perfis.sql: «com o modo superadmin ligado, também
-- vê os resultados ao vivo de quem os tem escondidos (live_hides_results) e
-- as inscrições de torneio que escondem resultados». Com o modo desligado,
-- como toda a gente.
--
-- O QUE FAZ (emendas por texto ao corpo vivo; 1 vez cada, ou «já estava»)
--   1. live_hides_results(p_user): passa a falso para o superadmin com o modo
--      ligado. Serve o ao vivo (list_live_events, live_mix_courts), o «Já
--      jogados» (list_played_events) e os jogos entre amigos
--      (friend_match_*, get_friend_match_readonly): tudo leituras de quem
--      está a ver.
--   2. notify_mix_finished: o aviso «o mix terminou» vai para TODOS os
--      jogadores e é escrito por quem fecha o mix. Se fosse o superadmin a
--      fechar, o 1. punha os nomes à vista de todos. Por isso aqui a regra
--      passa a ser a do perfil, sem olhar para quem fecha (igual a antes).
--   3. tournament_entries_hiding_results: devolve a lista vazia ao
--      superadmin com o modo ligado (os nomes aparecem nos quadros).
-- is_platform_admin_me já exige platform_admins.mode_on. Os GRANT ficam.
--
-- ORDEM. Qualquer.
--
-- Dev 3, 28 out 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  v_def TEXT;
  v_n   INT;
  r     RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- 2. primeiro: o aviso deixa de depender de quem fecha o mix.
      ('public.notify_mix_finished()',
       E'WHERE live_hides_results(w)) THEN',
       E'WHERE EXISTS (SELECT 1 FROM profiles pr WHERE pr.id = w AND pr.results_visibility IN (''friends'', ''private''))) THEN',
       E'pr.results_visibility IN (''friends'', ''private''))) THEN'),
      ('public.live_hides_results(uuid)',
       E'  SELECT COALESCE((SELECT results_visibility IN (''friends'', ''private'') FROM profiles WHERE id = p_user), FALSE);',
       E'  SELECT COALESCE((SELECT results_visibility IN (''friends'', ''private'') FROM profiles WHERE id = p_user), FALSE)\n     -- O superadmin com o modo ligado vê tudo (Francisco, 28 out).\n     AND NOT COALESCE(is_platform_admin_me(), FALSE);',
       'is_platform_admin_me'),
      ('public.tournament_entries_hiding_results(uuid,uuid)',
       E'                    AND p.results_visibility IN (''friends'', ''private''));',
       E'                    AND p.results_visibility IN (''friends'', ''private''))\n     -- O superadmin com o modo ligado vê tudo (Francisco, 28 out).\n     AND NOT COALESCE(is_platform_admin_me(), FALSE);',
       'is_platform_admin_me')
    ) AS x(fn, old_txt, new_txt, marca)
  LOOP
    v_def := replace(pg_get_functiondef(r.fn::regprocedure), E'\r', '');
    IF position(r.marca IN v_def) > 0 THEN
      RAISE NOTICE '% já estava', r.fn;
      CONTINUE;
    END IF;
    v_n := (length(v_def) - length(replace(v_def, r.old_txt, ''))) / length(r.old_txt);
    IF v_n <> 1 THEN
      RAISE EXCEPTION '%: esperava 1 vez a regra, encontrei %. Parar.', r.fn, v_n;
    END IF;
    EXECUTE replace(v_def, r.old_txt, r.new_txt);
  END LOOP;
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT proname, position('is_platform_admin_me' IN prosrc) > 0, proacl FROM pg_proc
--    WHERE proname IN ('live_hides_results', 'tournament_entries_hiding_results');   → 2× true
--   SELECT position('live_hides_results' IN prosrc) = 0 FROM pg_proc WHERE proname = 'notify_mix_finished';  → true
