-- ═════════════════════════════════════════════════════════════════════════
-- #518 — Pesquisa de pessoas só com nome e foto (search_people_basic).
--
-- O ecrã dos marcadores do torneio (Dev 1, `searchScorekeeperCandidates` em
-- src/lib/tournamentApi.js) usava a `search_players`, que manda também o
-- nível (rating), o género, o lado preferido e os clubes de cada pessoa
-- para o telemóvel de quem procura — e o ecrã só mostra o nome e a foto.
--
-- Esta função devolve SÓ id, name e avatar_url, com as mesmas regras de
-- quem aparece que a `search_players` de hoje (migration_kind_follows_plan
-- .sql): pelo menos 2 letras, nunca a própria pessoa, e nunca as contas de
-- teste (memberships.is_test). Máximo 10, por nome.
--
-- Não mexe na `search_players` (decisão do PO, 25 set: os outros ecrãs
-- que a usam decidem-se à parte).
--
-- Só para quem tem sessão: REVOKE explícito de PUBLIC e de anon (os
-- privilégios por omissão do Supabase dão EXECUTE a anon a cada função
-- nova — nota do System Integrator, 25 set).
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

-- ── 0. Peças de que depende ─────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'memberships'
                    AND column_name = 'is_test') THEN
    RAISE EXCEPTION 'Falta memberships.is_test. Parar e ler.';
  END IF;
END $$;

-- ── 1. A função ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.search_people_basic(p_query TEXT)
RETURNS TABLE (id UUID, name TEXT, avatar_url TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.name, p.avatar_url
    FROM profiles p
   WHERE length(trim(p_query)) >= 2
     AND p.id <> auth.uid()   -- sem sessão não devolve ninguém
     AND p.name ILIKE '%' || trim(p_query) || '%'
     AND NOT EXISTS (
       SELECT 1 FROM memberships m WHERE m.user_id = p.id AND m.is_test = true
     )
   ORDER BY p.name
   LIMIT 10;
$$;

REVOKE ALL ON FUNCTION public.search_people_basic(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.search_people_basic(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.search_people_basic(TEXT) TO authenticated;

-- ── 2. Confirmação ──────────────────────────────────────────────────────
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.search_people_basic(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon ainda pode chamar search_people_basic. Parar e ler.';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.search_people_basic(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated não pode chamar search_people_basic. Parar e ler.';
  END IF;
  RAISE NOTICE '#518: search_people_basic pronta (só id, name, avatar_url; só com sessão).';
END $$;
