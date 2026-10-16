-- supabase/tests/liga_4_calendario.sql — alinho-dev, depois da migração 4.
-- Cria tudo como owner num ambiente vazio da liga: usa os mesmos ids da
-- Task 7 (preencher). Verifica que o servidor recusa calendários errados.
BEGIN;
CREATE TEMP TABLE _r (ok boolean, label text);
CREATE TEMP TABLE _ctx (owner UUID, org_owner UUID, org_a UUID, org_b UUID, org_c UUID, admin_a UUID, admin_b UUID, admin_c UUID,
                        league UUID, cat UUID, ta UUID, tb UUID, tc UUID);
INSERT INTO _ctx (owner, org_owner, org_a, org_b, org_c, admin_a, admin_b, admin_c)
VALUES ('<owner>', '<clube do owner>', '<org A>', '<org B>', '<org C>', '<admin A>', '<admin B>', '<admin C>');
GRANT ALL ON _ctx, _r TO authenticated;
CREATE OR REPLACE FUNCTION pg_temp.as_user(p UUID) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true); $$;
SET LOCAL ROLE authenticated;

SELECT pg_temp.as_user(owner) FROM _ctx;
UPDATE _ctx SET league = (create_league('comunitaria', org_owner, 'Liga Teste Calendário', 'local', NULL, NULL, NULL, NULL, NULL)->>'id')::uuid;
UPDATE _ctx SET cat = upsert_league_category(league, NULL, 'masculino', 4, 50, 1, false, 3, 1, 0, -1, 4, 3);
SELECT publish_league(league) FROM _ctx;
SELECT pg_temp.as_user(admin_a) FROM _ctx; UPDATE _ctx SET ta = apply_to_league(cat, org_a);
SELECT pg_temp.as_user(admin_b) FROM _ctx; UPDATE _ctx SET tb = apply_to_league(cat, org_b);
SELECT pg_temp.as_user(admin_c) FROM _ctx; UPDATE _ctx SET tc = apply_to_league(cat, org_c);
SELECT pg_temp.as_user(owner) FROM _ctx;
SELECT decide_application(ta, 'aprovada', NULL), decide_application(tb, 'aprovada', NULL), decide_application(tc, 'aprovada', NULL) FROM _ctx;

-- Errado: A joga duas vezes na mesma jornada.
DO $$ DECLARE c _ctx; BEGIN SELECT * INTO c FROM _ctx;
  PERFORM save_league_schedule(c.cat, jsonb_build_array(jsonb_build_array(
    jsonb_build_object('home', c.ta, 'away', c.tb), jsonb_build_object('home', c.ta, 'away', c.tc))), CURRENT_DATE, 14);
  INSERT INTO _r VALUES (false, 'aceitou equipa duas vezes na jornada');
EXCEPTION WHEN others THEN INSERT INTO _r VALUES (SQLERRM LIKE '%schedule_team_twice%', 'recusa equipa duas vezes na jornada'); END $$;

-- Errado: falta o par B–C.
DO $$ DECLARE c _ctx; BEGIN SELECT * INTO c FROM _ctx;
  PERFORM save_league_schedule(c.cat, jsonb_build_array(
    jsonb_build_array(jsonb_build_object('home', c.ta, 'away', c.tb)),
    jsonb_build_array(jsonb_build_object('home', c.tc, 'away', c.ta))), CURRENT_DATE, 14);
  INSERT INTO _r VALUES (false, 'aceitou calendário incompleto');
EXCEPTION WHEN others THEN INSERT INTO _r VALUES (SQLERRM LIKE '%schedule_pairs%' OR SQLERRM LIKE '%schedule_rounds%', 'recusa calendário incompleto'); END $$;

-- Certo (3 equipas → 3 jornadas, folga em cada).
DO $$ DECLARE c _ctx; n INTEGER; BEGIN SELECT * INTO c FROM _ctx;
  n := save_league_schedule(c.cat, jsonb_build_array(
    jsonb_build_array(jsonb_build_object('home', c.ta, 'away', c.tb)),
    jsonb_build_array(jsonb_build_object('home', c.tc, 'away', c.ta)),
    jsonb_build_array(jsonb_build_object('home', c.tb, 'away', c.tc))), CURRENT_DATE, 14);
  INSERT INTO _r VALUES (n = 3, 'calendário certo gravado: ' || n || ' encontros');
END $$;
INSERT INTO _r SELECT status = 'a_decorrer', 'categoria a decorrer' FROM league_categories WHERE id = (SELECT cat FROM _ctx);

-- Marcação: A (casa) propõe; A não pode aceitar a própria proposta; B aceita.
SELECT pg_temp.as_user(admin_a) FROM _ctx;
SELECT propose_encounter_time(e.id, (CURRENT_DATE + 2)::timestamptz + interval '18 hours', 'Campo 2')
  FROM league_encounters e, _ctx c WHERE e.home_team_id = c.ta AND e.away_team_id = c.tb;
DO $$ BEGIN PERFORM accept_encounter_time((SELECT e.id FROM league_encounters e, _ctx c WHERE e.home_team_id = c.ta AND e.away_team_id = c.tb));
  INSERT INTO _r VALUES (false, 'aceitou a própria proposta');
EXCEPTION WHEN others THEN INSERT INTO _r VALUES (SQLERRM LIKE '%not_your_proposal%', 'não aceita a própria proposta'); END $$;
SELECT pg_temp.as_user(admin_b) FROM _ctx;
SELECT accept_encounter_time(e.id) FROM league_encounters e, _ctx c WHERE e.home_team_id = c.ta AND e.away_team_id = c.tb;
INSERT INTO _r SELECT status = 'marcado', 'encontro marcado' FROM league_encounters e, _ctx c WHERE e.home_team_id = c.ta AND e.away_team_id = c.tb;
-- Fora da janela.
SELECT pg_temp.as_user(admin_a) FROM _ctx;
DO $$ BEGIN PERFORM propose_encounter_time((SELECT e.id FROM league_encounters e, _ctx c WHERE e.home_team_id = c.ta AND e.away_team_id = c.tb),
  (CURRENT_DATE + 60)::timestamptz, NULL);
  INSERT INTO _r VALUES (false, 'aceitou data fora da janela');
EXCEPTION WHEN others THEN INSERT INTO _r VALUES (SQLERRM LIKE '%outside_window%', 'recusa data fora da janela'); END $$;

RESET ROLE;
SELECT CASE WHEN ok THEN 'OK    ' ELSE 'ERRO  ' END || label AS resultado FROM _r;
ROLLBACK;
