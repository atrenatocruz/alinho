-- ═════════════════════════════════════════════════════════════════════════
-- #549 — Contas de teste e torneio de teste (o QA testa sem mexer em nada real)
--
-- PORQUÊ. O Francisco criou 4 contas em produção («Teste 1» a «Teste 4»,
-- aliases do email dele) para o QA testar o torneio com contas reais. Hoje
-- essas contas aparecem no ranking e nas pesquisas, e fechar um torneio mexe
-- no nível de quem joga. Plano aprovado pelo Francisco a 27 set.
--
-- O QUE FAZ:
--   1. profiles.is_test — a conta é de teste. Aproveita a marca que a app já
--      usa (memberships.is_test, #… «contas de teste» dos clubes):
--        · marcar a conta marca também todos os clubes dela, e os clubes
--          novos dela nascem marcados (triggers);
--        · as pesquisas e os rankings que hoje escondem quem tem um clube
--          marcado passam a esconder também a conta marcada, mesmo sem
--          clube: search_players, list_players, search_people_basic,
--          search_any_player, get_public_rankings, get_public_xp_rankings
--          (corpo VIVO, cada versão; «já estava»).
--   2. tournaments.is_test — torneio de teste: o apply_tournament_elo (o
--      único sítio onde o torneio mexe no nível e dá os pontos do torneio)
--      não faz nada. Troca só a entrada do corpo vivo.
--   3. Quem marca: o System Integrator, à mão, depois de correr:
--        UPDATE profiles SET is_test = true WHERE id IN (<os 4 ids>);
--        UPDATE tournaments SET is_test = true WHERE id = '<torneio do QA>';
--
-- FICA DE FORA (aprovado assim): a lista de membros do clube onde jogarem e
-- o número de membros desse clube ainda contam as 4 contas.
--
-- Dev 3, 27 set 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. A marca na conta ─────────────────────────────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT FALSE;

-- Marcar a conta marca os clubes dela (desmarcar não mexe nos clubes).
CREATE OR REPLACE FUNCTION public.profiles_is_test_to_memberships()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  UPDATE memberships SET is_test = TRUE WHERE user_id = NEW.id AND is_test IS DISTINCT FROM TRUE;
  RETURN NULL;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.profiles_is_test_to_memberships() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS profiles_is_test_to_memberships_trigger ON profiles;
CREATE TRIGGER profiles_is_test_to_memberships_trigger
  AFTER UPDATE OF is_test ON profiles
  FOR EACH ROW WHEN (NEW.is_test AND OLD.is_test IS DISTINCT FROM TRUE)
  EXECUTE FUNCTION profiles_is_test_to_memberships();

-- Um clube novo de uma conta de teste nasce marcado.
CREATE OR REPLACE FUNCTION public.memberships_is_test_from_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM profiles WHERE id = NEW.user_id AND is_test) THEN
    NEW.is_test := TRUE;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.memberships_is_test_from_profile() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS memberships_is_test_from_profile_trigger ON memberships;
CREATE TRIGGER memberships_is_test_from_profile_trigger
  BEFORE INSERT ON memberships
  FOR EACH ROW EXECUTE FUNCTION memberships_is_test_from_profile();

-- ── 2. Pesquisas e rankings: também a conta marcada, mesmo sem clube ────
-- Onde a função diz «não há um clube marcado desta pessoa», passa a dizer
-- «nem um clube marcado, nem a conta marcada».
DO $$
DECLARE
  c_mau CONSTANT TEXT := 'SELECT 1 FROM memberships m WHERE m\.user_id = (\w+)\.(\w+) AND m\.is_test( = true)?';
  c_bom CONSTANT TEXT := 'SELECT 1 FROM memberships m WHERE m.user_id = \1.\2 AND m.is_test UNION ALL SELECT 1 FROM profiles tp WHERE tp.id = \1.\2 AND tp.is_test';
  f      RECORD;
  v_n    INTEGER;
  v_vistas INTEGER := 0;
BEGIN
  FOR f IN SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.prosrc
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
              AND p.proname IN ('search_players', 'list_players', 'search_people_basic',
                                'search_any_player', 'get_public_rankings', 'get_public_xp_rankings') LOOP
    v_vistas := v_vistas + 1;
    IF position('tp.is_test' IN f.prosrc) > 0 THEN
      RAISE NOTICE '%(%): já estava', f.proname, f.args;
      CONTINUE;
    END IF;
    SELECT count(*) INTO v_n FROM regexp_matches(f.prosrc, c_mau, 'g');
    IF v_n = 0 THEN
      RAISE EXCEPTION '%(%): não encontrei o filtro das contas de teste. Ler o corpo vivo.', f.proname, f.args;
    END IF;
    EXECUTE regexp_replace(pg_get_functiondef(f.oid), c_mau, c_bom, 'g');
    RAISE NOTICE '%(%): % filtro(s) acertado(s)', f.proname, f.args, v_n;
  END LOOP;
  IF v_vistas = 0 THEN
    RAISE EXCEPTION 'Não encontrei nenhuma das funções de pesquisa/ranking. Parar e ler.';
  END IF;
  -- As que não existirem vivas ficam escritas, para o SI ver.
  RAISE NOTICE 'Funções que não existem vivas (nada a fazer nelas): %',
    (SELECT string_agg(x, ', ') FROM unnest(ARRAY['search_players', 'list_players', 'search_people_basic',
                                                  'search_any_player', 'get_public_rankings', 'get_public_xp_rankings']) x
      WHERE NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.proname = x AND p.pronamespace = 'public'::regnamespace));
END $$;

-- ── 3. Torneio de teste ─────────────────────────────────────────────────
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT FALSE;

-- apply_tournament_elo: logo à entrada, um torneio de teste não faz nada.
DO $$
DECLARE
  -- \r? porque a função viva pode estar gravada com quebras CRLF (visto pelo
  -- SI a 27 set: só com \n, a âncora não aparecia e o ficheiro parava).
  c_mau CONSTANT TEXT := '(\r?\nBEGIN\r?\n)';
  c_bom CONSTANT TEXT := '\1  -- Torneio de teste (#549): não mexe no nível nem dá pontos a ninguém.
  IF EXISTS (SELECT 1 FROM tournament_categories tc JOIN tournaments tt ON tt.id = tc.tournament_id
              WHERE tc.id = p_category_id AND tt.is_test) THEN
    RETURN;
  END IF;
';
  f     RECORD;
  v_def TEXT;
  v_vistas INTEGER := 0;
BEGIN
  FOR f IN SELECT p.oid, pg_get_function_identity_arguments(p.oid) AS args, p.prosrc
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'apply_tournament_elo' LOOP
    v_vistas := v_vistas + 1;
    IF position('tt.is_test' IN f.prosrc) > 0 THEN
      RAISE NOTICE 'apply_tournament_elo(%): já estava', f.args;
      CONTINUE;
    END IF;
    v_def := pg_get_functiondef(f.oid);
    -- O primeiro BEGIN sozinho numa linha é o do corpo (antes só há o DECLARE).
    IF regexp_instr(v_def, c_mau) = 0
       OR regexp_instr(v_def, c_mau) < position('AS $function$' IN v_def) THEN
      RAISE EXCEPTION 'apply_tournament_elo(%): não encontrei o início do corpo. Ler o corpo vivo.', f.args;
    END IF;
    EXECUTE regexp_replace(v_def, c_mau, c_bom);
  END LOOP;
  IF v_vistas = 0 THEN
    RAISE EXCEPTION 'Não existe apply_tournament_elo. Parar e ler.';
  END IF;
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT proname, bool_and(prosrc LIKE '%tp.is_test%') FROM pg_proc
--    WHERE proname IN ('search_players','list_players','search_people_basic','search_any_player',
--                      'get_public_rankings','get_public_xp_rankings') GROUP BY proname;          -- todas true
--   SELECT bool_and(prosrc LIKE '%tt.is_test%') FROM pg_proc WHERE proname = 'apply_tournament_elo';  -- true
