-- supabase/tests/liga_2_ciclo.sql — alinho-dev, depois da migração 2.
-- Usa dois utilizadores reais da dev: um admin de clube (não platform admin)
-- e um platform admin. Troca os e-mails pelos da dev antes de correr.
BEGIN;
CREATE TEMP TABLE _r (ok boolean, label text);
CREATE TEMP TABLE _ctx AS
SELECT
  (SELECT p.id FROM profiles p JOIN memberships m ON m.user_id = p.id AND m.is_admin
     JOIN organizations o ON o.id = m.organization_id AND o.kind = 'club'
    WHERE NOT COALESCE(p.is_platform_admin, false) LIMIT 1) AS club_admin,
  (SELECT p.id FROM profiles p WHERE p.is_platform_admin LIMIT 1) AS platform_admin,
  (SELECT p.id FROM profiles p WHERE NOT COALESCE(p.is_platform_admin, false)
     AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = p.id AND m.is_admin) LIMIT 1) AS player;
ALTER TABLE _ctx ADD COLUMN org UUID;
UPDATE _ctx SET org = (SELECT m.organization_id FROM memberships m JOIN organizations o ON o.id = m.organization_id
                        WHERE m.user_id = _ctx.club_admin AND m.is_admin AND o.kind = 'club' LIMIT 1);
GRANT SELECT ON _ctx TO authenticated; GRANT ALL ON _r TO authenticated;

CREATE OR REPLACE FUNCTION pg_temp.as_user(p UUID) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;

SET LOCAL ROLE authenticated;

-- 1) admin de clube não cria Liga Alinho
SELECT pg_temp.as_user(club_admin) FROM _ctx;
DO $$ BEGIN
  PERFORM create_league('alinho', NULL, 'Liga Teste Alinho', 'regional', 'Porto', NULL, NULL, NULL, 8);
  INSERT INTO _r VALUES (false, 'admin de clube criou Liga Alinho');
EXCEPTION WHEN others THEN INSERT INTO _r VALUES (SQLERRM LIKE '%not_platform_admin%', 'admin de clube não cria Liga Alinho: ' || SQLERRM);
END $$;

-- 2) admin de clube cria comunitária do seu clube
DO $$ DECLARE r jsonb; BEGIN
  r := create_league('comunitaria', (SELECT org FROM _ctx), 'Liga Teste Comunitária', 'local', 'Porto', 'Outono', NULL, NULL, 8);
  INSERT INTO _r VALUES (r ? 'slug', 'comunitária criada: ' || (r->>'slug'));
  PERFORM set_config('t.league', r->>'id', true);
END $$;

-- 3) categoria inválida recusada no servidor
DO $$ BEGIN
  PERFORM upsert_league_category(current_setting('t.league')::uuid, NULL, 'masculino', 4, 50, 4, false, 3, 1, 0, -1, 12, 3);
  INSERT INTO _r VALUES (false, '4 partidas por encontro aceite');
EXCEPTION WHEN others THEN INSERT INTO _r VALUES (SQLERRM LIKE '%matches_invalid%', 'categoria inválida recusada');
END $$;
SELECT upsert_league_category(current_setting('t.league')::uuid, NULL, 'masculino', 4, 50, 3, true, 3, 1, 0, -1, 12, 3);
INSERT INTO _r SELECT count(*) = 1, 'categoria M4 criada' FROM league_categories WHERE league_id = current_setting('t.league')::uuid;

-- 4) jogador qualquer não mexe na liga
SELECT pg_temp.as_user(player) FROM _ctx;
DO $$ BEGIN
  PERFORM update_league(current_setting('t.league')::uuid, 'Roubada', 'local', NULL, NULL, NULL, NULL, NULL);
  INSERT INTO _r VALUES (false, 'jogador editou a liga');
EXCEPTION WHEN others THEN INSERT INTO _r VALUES (SQLERRM LIKE '%not_league_manager%', 'jogador não edita a liga');
END $$;

-- 5) co-organizador não se promove nem nomeia outros
SELECT pg_temp.as_user(club_admin) FROM _ctx;
SELECT add_league_organizer(current_setting('t.league')::uuid, (SELECT player FROM _ctx));
SELECT pg_temp.as_user(player) FROM _ctx;
INSERT INTO _r SELECT can_manage_league(current_setting('t.league')::uuid), 'co-organizador gere a liga';
DO $$ BEGIN
  PERFORM add_league_organizer(current_setting('t.league')::uuid, (SELECT platform_admin FROM _ctx));
  INSERT INTO _r VALUES (false, 'co-organizador nomeou outro');
EXCEPTION WHEN others THEN INSERT INTO _r VALUES (SQLERRM LIKE '%not_league_owner%', 'co-organizador não nomeia outros');
END $$;
DO $$ BEGIN
  PERFORM delete_league(current_setting('t.league')::uuid);
  INSERT INTO _r VALUES (false, 'co-organizador apagou a liga');
EXCEPTION WHEN others THEN INSERT INTO _r VALUES (SQLERRM LIKE '%not_league_owner%', 'co-organizador não apaga a liga');
END $$;

-- 6) publicar
SELECT pg_temp.as_user(club_admin) FROM _ctx;
SELECT publish_league(current_setting('t.league')::uuid);
INSERT INTO _r SELECT status = 'inscricoes', 'liga publicada' FROM leagues WHERE id = current_setting('t.league')::uuid;

-- 7) platform admin cria Liga Alinho
SELECT pg_temp.as_user(platform_admin) FROM _ctx;
DO $$ DECLARE r jsonb; BEGIN
  r := create_league('alinho', NULL, 'Liga Alinho Teste', 'regional', 'Lisboa', NULL, NULL, NULL, 8);
  INSERT INTO _r VALUES (r ? 'id', 'platform admin cria Liga Alinho');
END $$;

RESET ROLE;
SELECT CASE WHEN ok THEN 'OK    ' ELSE 'ERRO  ' END || label AS resultado FROM _r;
ROLLBACK;
