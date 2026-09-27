-- ═════════════════════════════════════════════════════════════════════════
-- search_players e list_players: só com sessão iniciada
--
-- PORQUÊ. Visto pelo SI (27 set): as duas tinham EXECUTE para anon — dava
-- para listar e pesquisar jogadores sem sessão. Não é de propósito (PO, 27
-- set). Verificado em origin/main: só as chamam ecrãs com sessão (PlayerSearch
-- do jogo privado, convidar no Gerir, inscrições do torneio, jogo entre
-- amigos), e só como recurso quando a search_people_basic falha. Nenhuma
-- página sem sessão (torneio público, convite, página do clube) as usa.
--
-- O QUE FAZ. Em todas as versões vivas das duas: REVOKE de PUBLIC e anon,
-- GRANT a authenticated (a regra do #367). Não muda o corpo de nenhuma.
--
-- Dev 3, 27 set 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  f RECORD;
  v_n INTEGER := 0;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname IN ('search_players', 'list_players') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
    v_n := v_n + 1;
    RAISE NOTICE 'Só com sessão: %', f.sig;
  END LOOP;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'Não encontrei search_players nem list_players. Parar e ler.';
  END IF;
END $$;

COMMIT;

-- Verificar depois de correr (false em todas):
--   SELECT p.oid::regprocedure, has_function_privilege('anon', p.oid, 'EXECUTE')
--     FROM pg_proc p WHERE p.proname IN ('search_players', 'list_players') AND p.pronamespace = 'public'::regnamespace;
