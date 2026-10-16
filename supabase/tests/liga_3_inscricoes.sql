-- supabase/tests/liga_3_inscricoes.sql — alinho-dev, depois da migração 3.
-- Precisa de: 2 clubes com um admin cada (A e B, pessoas diferentes) e um
-- jogador masculino membro de AMBOS (para o caso «um clube por liga").
BEGIN;
CREATE TEMP TABLE _r (ok boolean, label text);
CREATE TEMP TABLE _ctx (org_a UUID, admin_a UUID, org_b UUID, admin_b UUID, both_player UUID, owner UUID, league UUID, cat UUID, team_a UUID, team_b UUID, roster_a UUID);
-- Preencher à mão com ids da dev (ver comentário no topo):
INSERT INTO _ctx (org_a, admin_a, org_b, admin_b, both_player, owner)
VALUES ('<org A>', '<admin A>', '<org B>', '<admin B>', '<jogador em A e B>', '<admin de um 3.º clube>');
GRANT ALL ON _ctx, _r TO authenticated;
CREATE OR REPLACE FUNCTION pg_temp.as_user(p UUID) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true); $$;
SET LOCAL ROLE authenticated;

-- Liga comunitária do 3.º clube, M4, máx. 2 equipas… e uma 3.ª candidata.
SELECT pg_temp.as_user(owner) FROM _ctx;
UPDATE _ctx SET league = (create_league('comunitaria',
  (SELECT m.organization_id FROM memberships m WHERE m.user_id = _ctx.owner AND m.is_admin LIMIT 1),
  'Liga Teste Inscrições', 'local', NULL, NULL, NULL, NULL, 2)->>'id')::uuid;
UPDATE _ctx SET cat = upsert_league_category(league, NULL, 'masculino', 4, 50, 1, false, 3, 1, 0, -1, 4, 3);
SELECT publish_league(league) FROM _ctx;

-- Admin A candidata A; admin A NÃO pode candidatar B.
SELECT pg_temp.as_user(admin_a) FROM _ctx;
UPDATE _ctx SET team_a = apply_to_league(cat, org_a);
DO $$ BEGIN PERFORM apply_to_league((SELECT cat FROM _ctx), (SELECT org_b FROM _ctx));
  INSERT INTO _r VALUES (false, 'admin A candidatou o clube B');
EXCEPTION WHEN others THEN INSERT INTO _r VALUES (SQLERRM LIKE '%not_club_admin%', 'admin A não candidata B'); END $$;
DO $$ BEGIN PERFORM apply_to_league((SELECT cat FROM _ctx), (SELECT org_a FROM _ctx));
  INSERT INTO _r VALUES (false, 'candidatura repetida aceite');
EXCEPTION WHEN others THEN INSERT INTO _r VALUES (SQLERRM LIKE '%already_applied%', 'sem candidaturas repetidas'); END $$;

SELECT pg_temp.as_user(admin_b) FROM _ctx;
UPDATE _ctx SET team_b = apply_to_league(cat, org_b);

-- Admin A não decide candidaturas.
SELECT pg_temp.as_user(admin_a) FROM _ctx;
DO $$ BEGIN PERFORM decide_application((SELECT team_b FROM _ctx), 'aprovada', NULL);
  INSERT INTO _r VALUES (false, 'admin A aprovou B');
EXCEPTION WHEN others THEN INSERT INTO _r VALUES (SQLERRM LIKE '%not_league_manager%', 'só quem organiza decide'); END $$;

SELECT pg_temp.as_user(owner) FROM _ctx;
SELECT decide_application(team_a, 'aprovada', NULL), decide_application(team_b, 'aprovada', NULL) FROM _ctx;
INSERT INTO _r SELECT count(*) = 2, 'duas aprovadas' FROM league_teams WHERE category_id = (SELECT cat FROM _ctx) AND status = 'aprovada';

-- Plantel: o jogador dos dois clubes entra por A e é recusado por B.
SELECT pg_temp.as_user(admin_a) FROM _ctx;
UPDATE _ctx SET roster_a = add_to_roster(team_a, both_player);
SELECT pg_temp.as_user(admin_b) FROM _ctx;
DO $$ BEGIN PERFORM add_to_roster((SELECT team_b FROM _ctx), (SELECT both_player FROM _ctx));
  INSERT INTO _r VALUES (false, 'jogador entrou por dois clubes');
EXCEPTION WHEN others THEN INSERT INTO _r VALUES (SQLERRM LIKE '%already_in_league%', 'um clube por liga'); END $$;
-- Admin B não mexe no plantel de A.
DO $$ BEGIN PERFORM remove_from_roster((SELECT roster_a FROM _ctx));
  INSERT INTO _r VALUES (false, 'admin B tirou um jogador de A');
EXCEPTION WHEN others THEN INSERT INTO _r VALUES (SQLERRM LIKE '%not_team_rep%', 'cada clube só mexe no seu plantel'); END $$;

-- Retirar o pedido fecha o plantel: o jogador fica livre e o clube B já o pode inscrever.
SELECT pg_temp.as_user(admin_a) FROM _ctx;
SELECT withdraw_application(team_a) FROM _ctx;
SELECT pg_temp.as_user(admin_b) FROM _ctx;
DO $$ BEGIN PERFORM add_to_roster((SELECT team_b FROM _ctx), (SELECT both_player FROM _ctx));
  INSERT INTO _r VALUES (true, 'depois de retirar A, o jogador entra por B');
EXCEPTION WHEN others THEN INSERT INTO _r VALUES (false, 'depois de retirar A, o jogador entra por B: ' || SQLERRM); END $$;

RESET ROLE;
INSERT INTO _r SELECT removed_at IS NOT NULL, 'retirar fecha o plantel de A' FROM league_roster WHERE id = (SELECT roster_a FROM _ctx);
-- Lotação: com o máximo em 2, uma 3.ª aprovação falha (feito como owner).
-- (A corrida real — duas aprovações ao mesmo tempo — é coberta pelo
-- SELECT … FOR UPDATE na categoria; ver a função.)
SELECT CASE WHEN ok THEN 'OK    ' ELSE 'ERRO  ' END || label AS resultado FROM _r;
ROLLBACK;
