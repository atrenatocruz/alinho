-- supabase/tests/liga_1_base.sql
-- Correr no SQL Editor da alinho-dev DEPOIS de migration_liga_1_base.sql.
-- Tudo dentro de BEGIN … ROLLBACK: não deixa nada escrito.
-- Imprime uma linha OK/ERRO por caso.
BEGIN;
CREATE TEMP TABLE _r (ok boolean, label text);
GRANT ALL ON _r TO authenticated, anon;

-- Sem RPC não se escreve nada: authenticated não tem INSERT em nenhuma tabela.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
DO $$ BEGIN
  INSERT INTO leagues (slug, name, kind, created_by) VALUES ('x', 'Liga X', 'alinho', auth.uid());
  INSERT INTO _r VALUES (false, 'insert direto em leagues devia falhar');
EXCEPTION WHEN insufficient_privilege OR others THEN INSERT INTO _r VALUES (true, 'insert direto em leagues recusado');
END $$;
RESET ROLE;

-- O check do tipo: comunitária precisa de clube dono, Liga Alinho não pode ter.
DO $$ BEGIN
  INSERT INTO leagues (slug, name, kind, owner_org_id, created_by)
  VALUES ('y', 'Liga Y', 'alinho', (SELECT id FROM organizations LIMIT 1), (SELECT id FROM profiles LIMIT 1));
  INSERT INTO _r VALUES (false, 'Liga Alinho com clube dono devia falhar');
EXCEPTION WHEN check_violation THEN INSERT INTO _r VALUES (true, 'Liga Alinho sem clube dono');
END $$;

-- Bandas.
INSERT INTO _r SELECT league_band(1450) = 3 AND league_band(1399) = 4 AND league_band(650) = 7, 'league_band';

-- anon não lê tabelas.
SET LOCAL ROLE anon;
DO $$ BEGIN
  PERFORM 1 FROM leagues LIMIT 1;
  INSERT INTO _r VALUES (false, 'anon a ler leagues devia falhar');
EXCEPTION WHEN insufficient_privilege THEN INSERT INTO _r VALUES (true, 'anon sem acesso a leagues');
END $$;
RESET ROLE;

SELECT CASE WHEN ok THEN 'OK    ' ELSE 'ERRO  ' END || label AS resultado FROM _r;
ROLLBACK;
