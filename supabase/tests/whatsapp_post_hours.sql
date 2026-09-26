-- Correr num Postgres local descartável:
--   psql -d <bd_vazia> -f supabase/tests/whatsapp_post_hours.sql
\set VERBOSITY terse
DO $$BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END$$;
DO $$BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END$$;
CREATE FUNCTION is_org_admin(p uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT current_setting('t.admin', true) = 'on' $$;
CREATE TABLE organizations (id uuid PRIMARY KEY, name text);
INSERT INTO organizations VALUES ('00000000-0000-0000-0000-000000000001', 'A2N');
\i supabase/migration_whatsapp_post_hours.sql
\i supabase/migration_whatsapp_post_hours.sql

CREATE FUNCTION t_(label text, stmt text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE r text;
BEGIN EXECUTE stmt INTO r; RETURN 'OK    ' || label || COALESCE(' = ' || r, ''); EXCEPTION WHEN OTHERS THEN RETURN 'ERRO  ' || label || ' -> ' || SQLERRM; END $f$;

SELECT t_('por omissão fica {10}', $q$SELECT whatsapp_post_hours::text FROM organizations$q$);
SELECT set_config('t.admin', 'off', false);
SELECT t_('quem não é admin [deve recusar]', $q$SELECT set_whatsapp_post_hours('00000000-0000-0000-0000-000000000001', '{10,19}')::text$q$);
SELECT set_config('t.admin', 'on', false);
SELECT t_('admin: 19, 10, 14, 10 → ordenadas e sem repetidas', $q$SELECT set_whatsapp_post_hours('00000000-0000-0000-0000-000000000001', '{19,10,14,10}')::text$q$);
SELECT t_('4 horas [deve recusar]', $q$SELECT set_whatsapp_post_hours('00000000-0000-0000-0000-000000000001', '{9,10,11,12}')::text$q$);
SELECT t_('7h [deve recusar]', $q$SELECT set_whatsapp_post_hours('00000000-0000-0000-0000-000000000001', '{7}')::text$q$);
SELECT t_('23h [deve recusar]', $q$SELECT set_whatsapp_post_hours('00000000-0000-0000-0000-000000000001', '{23}')::text$q$);
SELECT t_('vazio = não publica a horas certas', $q$SELECT set_whatsapp_post_hours('00000000-0000-0000-0000-000000000001', '{}')::text$q$);
