-- supabase/tests/escolher_raquete.sql — alinho-dev, depois de migration_escolher_raquete.sql.
-- Preencher: dois jogadores quaisquer A e B (profiles.id), diferentes.
-- Tudo acaba em ROLLBACK: nada fica gravado.
-- Antes de correr a migração, isto falha logo com
--   relation "racket_picks" does not exist
BEGIN;
CREATE TEMP TABLE _r (ok boolean, label text);
CREATE TEMP TABLE _ctx (a UUID, b UUID);
INSERT INTO _ctx VALUES ('<jogador A>', '<jogador B>');
GRANT ALL ON _ctx, _r TO authenticated;

CREATE OR REPLACE FUNCTION pg_temp.as_user(p UUID) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true); $$;

-- Dados de teste (como superuser).
INSERT INTO rackets (store_id, name, handle, url, price, available)
VALUES ('_teste_', 'Raquete de teste', 'teste', 'https://www.streetpadel.com/products/teste', 99, true);
INSERT INTO racket_picks (user_id, answers, lang, best_id, picks)
SELECT a, '{"budget":"80_150"}', 'pt', '_teste_', '[]' FROM _ctx;

SET LOCAL ROLE authenticated;

-- A vê a sua recomendação; B não a vê.
SELECT pg_temp.as_user(a) FROM _ctx;
INSERT INTO _r SELECT count(*) = 1, 'A lê a sua linha de racket_picks' FROM racket_picks WHERE user_id = (SELECT a FROM _ctx);
SELECT pg_temp.as_user(b) FROM _ctx;
INSERT INTO _r SELECT count(*) = 0, 'B não vê a recomendação de A' FROM racket_picks WHERE user_id = (SELECT a FROM _ctx);

-- A lê o catálogo.
SELECT pg_temp.as_user(a) FROM _ctx;
INSERT INTO _r SELECT count(*) = 1, 'A lê rackets' FROM rackets WHERE store_id = '_teste_';

-- A não escreve em lado nenhum.
DO $$ BEGIN
  INSERT INTO racket_picks (user_id, answers, lang, best_id, picks) SELECT a, '{}', 'pt', 'x', '[]' FROM _ctx ON CONFLICT DO NOTHING;
  INSERT INTO _r VALUES (false, 'authenticated escreveu em racket_picks');
EXCEPTION WHEN insufficient_privilege THEN INSERT INTO _r VALUES (true, 'authenticated não escreve em racket_picks'); END $$;
DO $$ BEGIN
  UPDATE racket_picks SET best_id = 'x';
  INSERT INTO _r VALUES (false, 'authenticated mudou racket_picks');
EXCEPTION WHEN insufficient_privilege THEN INSERT INTO _r VALUES (true, 'authenticated não muda racket_picks'); END $$;
DO $$ BEGIN
  UPDATE rackets SET price = 1 WHERE store_id = '_teste_';
  INSERT INTO _r VALUES (false, 'authenticated mudou rackets');
EXCEPTION WHEN insufficient_privilege THEN INSERT INTO _r VALUES (true, 'authenticated não muda rackets'); END $$;
DO $$ BEGIN
  PERFORM take_racket_run(a) FROM _ctx;
  INSERT INTO _r VALUES (false, 'authenticated correu take_racket_run');
EXCEPTION WHEN insufficient_privilege THEN INSERT INTO _r VALUES (true, 'authenticated não corre take_racket_run'); END $$;

RESET ROLE;

-- O limite: 3 por dia, a 4.ª dá false (como superuser, a contar de zero).
DELETE FROM racket_pick_runs WHERE user_id = (SELECT b FROM _ctx);
-- Uma chamada por instrução: a ordem de um AND não é garantida.
DO $$ DECLARE v_b UUID := (SELECT b FROM _ctx); r1 BOOLEAN; r2 BOOLEAN; r3 BOOLEAN; r4 BOOLEAN;
BEGIN
  r1 := take_racket_run(v_b); r2 := take_racket_run(v_b); r3 := take_racket_run(v_b); r4 := take_racket_run(v_b);
  INSERT INTO _r VALUES (r1 AND r2 AND r3 AND NOT r4, 'take_racket_run: true, true, true, false');
END $$;
INSERT INTO _r VALUES (NOT has_function_privilege('anon', 'public.take_racket_run(uuid)', 'EXECUTE'), 'anon não corre take_racket_run');

-- Uma tentativa falhada devolve-se: depois de 3 e de um refund, há outra.
DO $$ DECLARE v_b UUID := (SELECT b FROM _ctx); r BOOLEAN;
BEGIN
  PERFORM refund_racket_run(v_b);
  r := take_racket_run(v_b);
  INSERT INTO _r VALUES (r, 'refund_racket_run devolve uma tentativa');
END $$;
INSERT INTO _r VALUES (NOT has_function_privilege('authenticated', 'public.refund_racket_run(uuid)', 'EXECUTE'), 'authenticated não corre refund_racket_run');

-- Mais regras: ninguém de fora lê nada, e authenticated não apaga nem lê o contador.
INSERT INTO _r VALUES
  (NOT has_table_privilege('anon', 'public.rackets', 'SELECT') AND NOT has_table_privilege('anon', 'public.racket_picks', 'SELECT'), 'anon não lê rackets nem racket_picks'),
  (NOT has_table_privilege('authenticated', 'public.racket_picks', 'DELETE'), 'authenticated não apaga racket_picks'),
  (NOT has_table_privilege('authenticated', 'public.racket_pick_runs', 'SELECT'), 'authenticated não lê racket_pick_runs');

-- Apagar a conta (anonymize_account, migration_account_deletion.sql) apaga as
-- respostas — o perfil fica, por isso o ON DELETE CASCADE não chega.
SELECT anonymize_account(a) FROM _ctx;
INSERT INTO _r SELECT count(*) = 0, 'apagar a conta apaga racket_picks' FROM racket_picks WHERE user_id = (SELECT a FROM _ctx);
INSERT INTO _r SELECT count(*) = 0, 'apagar a conta apaga racket_pick_runs' FROM racket_pick_runs WHERE user_id = (SELECT a FROM _ctx);

SELECT CASE WHEN ok THEN 'OK    ' ELSE 'ERRO  ' END || label AS resultado FROM _r;
ROLLBACK;
