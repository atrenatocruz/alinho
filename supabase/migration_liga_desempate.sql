-- ═════════════════════════════════════════════════════════════════════════
-- Liga: desempate sem sorteio, com o ranking da equipa no início da liga
--
-- PORQUÊ. Aprovado pelo Francisco a 23 out («sim claro»):
-- design-handoff/2026-10-23-desempate-grupos/LIGA-BA.md. A ordem das contas
-- está no src/lib/leagueStandings.js (sai o sorteio). Aqui fica o que a base
-- guarda.
--
-- O QUE FAZ
--   · league_teams.start_rating: o ranking da equipa quando a categoria
--     começa (a média do plantel; quem não tem ranking conta com o mais
--     baixo da categoria, como nos torneios). Grava-se sozinho quando a
--     categoria passa a 'a_decorrer'; as que já estão a decorrer ficam com o
--     de hoje. Quem não tiver valor (plantel vazio nesse dia) é calculado na
--     hora, com os mesmos números do plantel.
--   · league_tiebreaks: a escolha do organizador quando ficam iguais em tudo.
--       record_league_tiebreak(p_category_id, p_team_ids, p_ranking)
--       clear_league_tiebreak(p_id)
--     Só enquanto a categoria não terminar.
--   · get_league_page: cada equipa traz start_rating, e há 'tiebreaks'
--     (remendo por texto, com contagem exata; «já estava» se correr outra
--     vez).
--
-- COMPATIBILIDADE. Só acrescenta.
--
-- Dev 3, 23 out 2026 · ecrãs: Dev 1
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. O ranking da equipa ──────────────────────────────────────────────
ALTER TABLE public.league_teams ADD COLUMN IF NOT EXISTS start_rating NUMERIC(7,1);

-- A média do plantel de agora (com o ranking com que cada um entrou). Sem
-- ranking, conta o mais baixo do plantel da categoria. Plantel vazio: NULL.
CREATE OR REPLACE FUNCTION public.league_team_rating_now(p_team_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH me AS (SELECT id, category_id FROM league_teams WHERE id = p_team_id),
       floor AS (
         SELECT min(COALESCE(r.rating_at_entry, p.rating)) AS v
           FROM league_roster r
           JOIN league_teams t ON t.id = r.team_id
           LEFT JOIN profiles p ON p.id = r.user_id
          WHERE t.category_id = (SELECT category_id FROM me) AND r.removed_at IS NULL)
  SELECT round(avg(COALESCE(r.rating_at_entry, p.rating, (SELECT v FROM floor)))::numeric, 1)
    FROM league_roster r
    LEFT JOIN profiles p ON p.id = r.user_id
   WHERE r.team_id = p_team_id AND r.removed_at IS NULL;
$function$;
REVOKE ALL ON FUNCTION public.league_team_rating_now(UUID) FROM PUBLIC, anon, authenticated;

-- Quando a categoria começa, fica guardado.
CREATE OR REPLACE FUNCTION public.league_categories_store_start_rating()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.status = 'a_decorrer' AND OLD.status IS DISTINCT FROM 'a_decorrer' THEN
    UPDATE league_teams SET start_rating = league_team_rating_now(id)
     WHERE category_id = NEW.id AND start_rating IS NULL;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.league_categories_store_start_rating() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS league_categories_store_start_rating ON public.league_categories;
CREATE TRIGGER league_categories_store_start_rating
  AFTER UPDATE OF status ON public.league_categories
  FOR EACH ROW EXECUTE FUNCTION public.league_categories_store_start_rating();

-- As categorias que já estão a decorrer: o ranking de hoje.
UPDATE public.league_teams t SET start_rating = public.league_team_rating_now(t.id)
  FROM public.league_categories c
 WHERE c.id = t.category_id AND c.status = 'a_decorrer' AND t.start_rating IS NULL;

-- ── 2. A escolha do organizador ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.league_tiebreaks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES public.league_categories(id) ON DELETE CASCADE,
  team_key    TEXT NOT NULL,
  team_ids    UUID[] NOT NULL,
  ranking     UUID[] NOT NULL,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (category_id, team_key)
);
ALTER TABLE public.league_tiebreaks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.league_tiebreaks FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_league_tiebreak(p_category_id UUID, p_team_ids UUID[], p_ranking UUID[])
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_c   league_categories;
  v_n   INT;
  v_key TEXT;
  v_id  UUID;
BEGIN
  SELECT * INTO v_c FROM league_categories WHERE id = p_category_id;
  IF v_c.id IS NULL THEN RAISE EXCEPTION 'category_not_found'; END IF;
  IF NOT can_manage_league(v_c.league_id) THEN RAISE EXCEPTION 'not_league_manager'; END IF;
  IF v_c.status <> 'a_decorrer' THEN RAISE EXCEPTION 'category_not_running'; END IF;
  v_n := COALESCE(array_length(p_team_ids, 1), 0);
  IF v_n < 2 OR (SELECT count(DISTINCT x) FROM unnest(p_team_ids) x) <> v_n
     OR EXISTS (SELECT 1 FROM unnest(p_team_ids) x
                 WHERE NOT EXISTS (SELECT 1 FROM league_teams t WHERE t.id = x AND t.category_id = p_category_id AND t.status = 'aprovada')) THEN
    RAISE EXCEPTION 'bad_teams';
  END IF;
  IF COALESCE(array_length(p_ranking, 1), 0) <> v_n
     OR (SELECT count(DISTINCT x) FROM unnest(p_ranking) x WHERE x = ANY (p_team_ids)) <> v_n THEN
    RAISE EXCEPTION 'bad_ranking';
  END IF;
  SELECT string_agg(x::text, ',' ORDER BY x::text) INTO v_key FROM unnest(p_team_ids) x;
  INSERT INTO league_tiebreaks (category_id, team_key, team_ids, ranking, created_by)
  VALUES (p_category_id, v_key, p_team_ids, p_ranking, auth.uid())
  ON CONFLICT (category_id, team_key) DO UPDATE
    SET team_ids = EXCLUDED.team_ids, ranking = EXCLUDED.ranking, created_by = EXCLUDED.created_by, created_at = NOW()
  RETURNING id INTO v_id;
  PERFORM league_log(v_c.league_id, NULL, 'tiebreak_chosen', jsonb_build_object('category_id', p_category_id, 'ranking', to_jsonb(p_ranking)));
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.record_league_tiebreak(UUID, UUID[], UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_league_tiebreak(UUID, UUID[], UUID[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.clear_league_tiebreak(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_c league_categories;
BEGIN
  SELECT c.* INTO v_c FROM league_tiebreaks tb JOIN league_categories c ON c.id = tb.category_id WHERE tb.id = p_id;
  IF v_c.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT can_manage_league(v_c.league_id) THEN RAISE EXCEPTION 'not_league_manager'; END IF;
  IF v_c.status <> 'a_decorrer' THEN RAISE EXCEPTION 'category_not_running'; END IF;
  DELETE FROM league_tiebreaks WHERE id = p_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.clear_league_tiebreak(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clear_league_tiebreak(UUID) TO authenticated;

-- ── 3. A página da liga devolve-os ──────────────────────────────────────
DO $$
DECLARE
  v_fn  TEXT := 'public.get_league_page(text)';
  v_def TEXT;
  v_n   INT;
  r     RECORD;
BEGIN
  v_def := replace(pg_get_functiondef(v_fn::regprocedure), E'\r', '');
  IF position('start_rating' IN v_def) > 0 THEN
    RAISE NOTICE '% já estava', v_fn;
    RETURN;
  END IF;
  FOR r IN
    SELECT * FROM (VALUES
      ('''club_slug'', o.slug, ''logo'', o.group_logo_url, ''status'', t.status)',
       '''club_slug'', o.slug, ''logo'', o.group_logo_url, ''status'', t.status,' || E'\n'
         || '                                   ''start_rating'', COALESCE(t.start_rating, league_team_rating_now(t.id)))'),
      ('    ''rounds'', (SELECT COALESCE(jsonb_agg(jsonb_build_object(''id'', r.id,',
       '    ''tiebreaks'', (SELECT COALESCE(jsonb_agg(jsonb_build_object(''id'', tb.id, ''category_id'', tb.category_id,' || E'\n'
         || '                                                              ''team_ids'', tb.team_ids, ''ranking'', tb.ranking)), ''[]''::jsonb)' || E'\n'
         || '                    FROM league_tiebreaks tb JOIN league_categories lc ON lc.id = tb.category_id WHERE lc.league_id = v_l.id),' || E'\n'
         || '    ''rounds'', (SELECT COALESCE(jsonb_agg(jsonb_build_object(''id'', r.id,')
    ) AS x(old_txt, new_txt)
  LOOP
    v_n := (length(v_def) - length(replace(v_def, r.old_txt, ''))) / length(r.old_txt);
    IF v_n <> 1 THEN RAISE EXCEPTION '%: esperava 1 vez «%», encontrei %. Parar.', v_fn, left(r.old_txt, 60), v_n; END IF;
    v_def := replace(v_def, r.old_txt, r.new_txt);
  END LOOP;
  EXECUTE v_def;
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT position('start_rating' IN prosrc) > 0, position('tiebreaks' IN prosrc) > 0 FROM pg_proc WHERE proname = 'get_league_page';   → true, true
--   SELECT count(*) FROM pg_trigger WHERE tgname = 'league_categories_store_start_rating';   → 1
--   SELECT has_table_privilege('anon', 'public.league_tiebreaks', 'SELECT');   → false
--   SELECT has_function_privilege('anon', 'public.record_league_tiebreak(uuid,uuid[],uuid[])', 'EXECUTE');   → false
