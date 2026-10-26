-- ═════════════════════════════════════════════════════════════════════════
-- «País onde vives»: o país de cada conta e a idade mínima por país
--
-- PORQUÊ. Aprovado pelo Francisco a 23 out (desenho, «sim aprovo») e o
-- plano a 26 out («ok, avança com o plano do país»):
-- design-handoff/2026-10-23-pais-onde-vives/SPEC.md e
-- design-handoff/2026-10-18-linguas/ES-LEGAL-BA.md (1a a 1c). Tem de estar
-- pronto antes de o espanhol abrir ao público. Ecrãs: Dev 4.
--
-- O QUE FAZ
--   · profiles.country: o país onde a pessoa vive (código de 2 letras, como
--     a nacionalidade). As contas de hoje ficam com Portugal ('PT').
--   · country_min_age: a idade mínima por país (PT 13, ES 14).
--     country_min_age_for(código) dá 16 para os países que não estão lá.
--   · A verificação no servidor (até aqui os 13 anos só existiam no ecrã):
--     ao criar a conta e sempre que mudam a data de nascimento ou o país, se
--     a pessoa não tiver a idade mínima desse país, dá 'too_young_for_country'
--     (HINT = a idade mínima) e nada muda. A conta não é apagada.
--   · handle_new_user guarda também o país que vem no registo
--     (raw_user_meta_data->>'country'); sem país, Portugal.
--
-- COMPATIBILIDADE. Só acrescenta. A app antiga não manda o país: fica com
-- Portugal e os 13 anos de sempre. O handle_new_user é remendado por texto,
-- com contagem exata («já estava» se correr outra vez).
--
-- Dev 3, 26 out 2026 · ecrãs: Dev 4
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. O país de cada conta ─────────────────────────────────────────────
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT 'PT';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_country_check') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_country_check CHECK (country ~ '^[A-Z]{2}$');
  END IF;
END $$;
-- O profiles dá UPDATE coluna a coluna: sem isto, mudar o país no Perfil
-- dava 42501 (SI, 26 out). A idade trava-a o gatilho abaixo.
GRANT UPDATE (country) ON public.profiles TO authenticated;

-- ── 2. A idade mínima por país ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.country_min_age (
  country TEXT PRIMARY KEY CHECK (country ~ '^[A-Z]{2}$'),
  min_age SMALLINT NOT NULL CHECK (min_age BETWEEN 0 AND 21)
);
INSERT INTO public.country_min_age (country, min_age) VALUES ('PT', 13), ('ES', 14)
ON CONFLICT (country) DO NOTHING;
ALTER TABLE public.country_min_age ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.country_min_age FROM PUBLIC, anon, authenticated;
-- Ler é público (o ecrã mostra a frase da idade antes de haver conta).
GRANT SELECT ON public.country_min_age TO anon, authenticated;
DROP POLICY IF EXISTS country_min_age_read ON public.country_min_age;
CREATE POLICY country_min_age_read ON public.country_min_age FOR SELECT TO anon, authenticated USING (TRUE);

CREATE OR REPLACE FUNCTION public.country_min_age_for(p_country TEXT)
RETURNS SMALLINT
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT COALESCE((SELECT min_age FROM country_min_age WHERE country = upper(btrim(p_country))), 16)::smallint;
$function$;
REVOKE ALL ON FUNCTION public.country_min_age_for(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.country_min_age_for(TEXT) TO anon, authenticated;

-- ── 3. A verificação ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.profiles_country_age_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_min SMALLINT;
BEGIN
  NEW.country := upper(btrim(COALESCE(NEW.country, 'PT')));
  -- Só quando a data ou o país mudam: as contas que já existem não são
  -- revistas por guardarem outra coisa no perfil.
  IF TG_OP = 'UPDATE' AND NEW.birthday IS NOT DISTINCT FROM OLD.birthday AND NEW.country IS NOT DISTINCT FROM OLD.country THEN
    RETURN NEW;
  END IF;
  IF NEW.birthday IS NULL THEN RETURN NEW; END IF;
  v_min := country_min_age_for(NEW.country);
  IF date_part('year', age(CURRENT_DATE, NEW.birthday)) < v_min THEN
    RAISE EXCEPTION 'too_young_for_country' USING ERRCODE = 'check_violation', HINT = v_min::text;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.profiles_country_age_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS profiles_country_age_guard ON public.profiles;
CREATE TRIGGER profiles_country_age_guard
  BEFORE INSERT OR UPDATE OF birthday, country ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_country_age_guard();

-- ── 4. O registo guarda o país ──────────────────────────────────────────
DO $$
DECLARE
  v_fn  TEXT := 'public.handle_new_user()';
  v_def TEXT;
  v_n   INT;
  r     RECORD;
BEGIN
  v_def := replace(pg_get_functiondef(v_fn::regprocedure), E'\r', '');
  IF position('country' IN v_def) > 0 THEN
    RAISE NOTICE '% já estava', v_fn;
    RETURN;
  END IF;
  FOR r IN
    SELECT * FROM (VALUES
      ('INSERT INTO public.profiles (id, name, email, birthday, gender)',
       'INSERT INTO public.profiles (id, name, email, birthday, gender, country)'),
      ('    COALESCE(NEW.raw_user_meta_data->>''gender'', NULL)' || E'\n' || '  );',
       '    COALESCE(NEW.raw_user_meta_data->>''gender'', NULL),' || E'\n'
         || '    COALESCE(NULLIF(upper(btrim(NEW.raw_user_meta_data->>''country'')), ''''), ''PT'')' || E'\n' || '  );')
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
--   SELECT count(*) FILTER (WHERE country = 'PT'), count(*) FROM profiles;   → iguais
--   SELECT country_min_age_for('PT'), country_min_age_for('ES'), country_min_age_for('FR');   → 13, 14, 16
--   SELECT position('country' IN prosrc) > 0 FROM pg_proc WHERE proname = 'handle_new_user';   → true
--   SELECT count(*) FROM pg_trigger WHERE tgname = 'profiles_country_age_guard';   → 1
--   SELECT has_column_privilege('authenticated', 'public.profiles', 'country', 'UPDATE');   → true
