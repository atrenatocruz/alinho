-- supabase/tests/liga_5_resultados.sql — alinho-dev, depois da migração 5.
-- Parte de uma categoria com 2 equipas aprovadas (A e B), 1 partida por
-- encontro, e 2 jogadores masculinos no plantel de cada (preencher ids).
BEGIN;
CREATE TEMP TABLE _r (ok boolean, label text);
CREATE TEMP TABLE _ctx (owner UUID, org_owner UUID, org_a UUID, org_b UUID, admin_a UUID, admin_b UUID,
  a1 UUID, a2 UUID, b1 UUID, b2 UUID, league UUID, cat UUID, ta UUID, tb UUID, enc UUID, rating_before NUMERIC, xp_before INTEGER, xp_mid INTEGER);
INSERT INTO _ctx (owner, org_owner, org_a, org_b, admin_a, admin_b, a1, a2, b1, b2)
VALUES ('<owner>', '<clube do owner>', '<org A>', '<org B>', '<admin A>', '<admin B>', '<jog A1>', '<jog A2>', '<jog B1>', '<jog B2>');
GRANT ALL ON _ctx, _r TO authenticated;
CREATE OR REPLACE FUNCTION pg_temp.as_user(p UUID) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true); $$;
SET LOCAL ROLE authenticated;

SELECT pg_temp.as_user(owner) FROM _ctx;
UPDATE _ctx SET league = (create_league('comunitaria', org_owner, 'Liga Teste Resultados', 'local', NULL, NULL, NULL, NULL, NULL)->>'id')::uuid;
UPDATE _ctx SET cat = upsert_league_category(league, NULL, 'masculino', 1, 50, 1, false, 3, 1, 0, -1, 4, 3);
SELECT publish_league(league) FROM _ctx;
SELECT pg_temp.as_user(admin_a) FROM _ctx; UPDATE _ctx SET ta = apply_to_league(cat, org_a);
SELECT pg_temp.as_user(admin_b) FROM _ctx; UPDATE _ctx SET tb = apply_to_league(cat, org_b);
SELECT pg_temp.as_user(owner) FROM _ctx;
SELECT decide_application(ta, 'aprovada', NULL), decide_application(tb, 'aprovada', NULL) FROM _ctx;
SELECT pg_temp.as_user(admin_a) FROM _ctx; SELECT add_to_roster(ta, a1), add_to_roster(ta, a2) FROM _ctx;
SELECT pg_temp.as_user(admin_b) FROM _ctx; SELECT add_to_roster(tb, b1), add_to_roster(tb, b2) FROM _ctx;
SELECT pg_temp.as_user(owner) FROM _ctx;
SELECT save_league_schedule(cat, jsonb_build_array(jsonb_build_array(jsonb_build_object('home', ta, 'away', tb))), CURRENT_DATE, 14) FROM _ctx;
UPDATE _ctx SET enc = (SELECT id FROM league_encounters WHERE category_id = _ctx.cat);
RESET ROLE;
UPDATE _ctx SET rating_before = (SELECT rating FROM profiles WHERE id = _ctx.a1), xp_before = (SELECT xp FROM profiles WHERE id = _ctx.a1);
SET LOCAL ROLE authenticated;

-- A submete (A ganha 6–4 6–3).
SELECT pg_temp.as_user(admin_a) FROM _ctx;
SELECT submit_encounter_result(enc, jsonb_build_array(jsonb_build_object('slot', 1,
  'home', jsonb_build_array(a1, a2), 'away', jsonb_build_array(b1, b2), 'sets', '[[6,4],[6,3]]'::jsonb))) FROM _ctx;
-- A não confirma o próprio resultado.
DO $$ BEGIN PERFORM confirm_encounter_result((SELECT enc FROM _ctx));
  INSERT INTO _r VALUES (false, 'A confirmou o próprio resultado');
EXCEPTION WHEN others THEN INSERT INTO _r VALUES (SQLERRM LIKE '%cannot_confirm_own%', 'ninguém confirma o próprio resultado'); END $$;
-- Set impossível recusado.
DO $$ BEGIN PERFORM submit_encounter_result((SELECT enc FROM _ctx), (SELECT jsonb_build_array(jsonb_build_object('slot', 1,
  'home', jsonb_build_array(a1, a2), 'away', jsonb_build_array(b1, b2), 'sets', '[[6,5],[6,3]]'::jsonb)) FROM _ctx));
  INSERT INTO _r VALUES (false, 'aceitou 6–5');
EXCEPTION WHEN others THEN INSERT INTO _r VALUES (SQLERRM LIKE '%set_invalid%', 'recusa set impossível'); END $$;

-- B contesta, o owner resolve como B 2–0 → oficial; depois corrige para A.
SELECT pg_temp.as_user(admin_b) FROM _ctx;
SELECT contest_encounter_result(enc, 'O segundo set foi 3–6.') FROM _ctx;
INSERT INTO _r SELECT status = 'contestado', 'contestado' FROM league_encounters WHERE id = (SELECT enc FROM _ctx);
SELECT pg_temp.as_user(owner) FROM _ctx;
SELECT resolve_encounter(enc, jsonb_build_array(jsonb_build_object('slot', 1,
  'home', jsonb_build_array(a1, a2), 'away', jsonb_build_array(b1, b2), 'sets', '[[6,4],[3,6],[8,10]]'::jsonb)), NULL, 'Visto o boletim.') FROM _ctx;
INSERT INTO _r SELECT status = 'oficial' AND ranked_applied, 'resolvido e aplicado ao ranking' FROM league_encounters WHERE id = (SELECT enc FROM _ctx);
-- Primeira resolução (A1 perdeu): profiles.xp subiu só os 10 da partida, igual à soma dos eventos.
RESET ROLE;
INSERT INTO _r SELECT p.xp = c.xp_before + 10
  AND p.xp - c.xp_before = (SELECT COALESCE(sum(amount), 0) FROM xp_events WHERE user_id = c.a1 AND kind LIKE 'league_%'),
  'profiles.xp = soma do XP da liga (10)' FROM _ctx c JOIN profiles p ON p.id = c.a1;
UPDATE _ctx SET xp_mid = (SELECT xp FROM profiles WHERE id = _ctx.a1);
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(owner) FROM _ctx;
SELECT resolve_encounter(enc, jsonb_build_array(jsonb_build_object('slot', 1,
  'home', jsonb_build_array(a1, a2), 'away', jsonb_build_array(b1, b2), 'sets', '[[6,4],[6,3]]'::jsonb)), NULL, 'Correção.') FROM _ctx;
RESET ROLE;
-- Na correção A1 passa a ganhar: só os +5 novos entram; profiles.xp continua igual à soma dos eventos.
INSERT INTO _r SELECT p.xp = c.xp_mid + 5 AND p.xp - c.xp_before = (SELECT sum(amount) FROM xp_events WHERE user_id = c.a1 AND kind LIKE 'league_%')
  AND p.last_played_at IS NOT NULL, 'profiles.xp +5 na correção, last_played_at preenchido' FROM _ctx c JOIN profiles p ON p.id = c.a1;
-- Depois de reverter e reaplicar, o rating de A1 = antes + o delta guardado agora (aplicado uma vez só).
INSERT INTO _r SELECT abs(p.rating - (c.rating_before + (e.applied_snapshot->0->'deltas'->>c.a1::text)::numeric)) < 0.001,
  'correção reverte e reaplica uma vez'
  FROM _ctx c JOIN profiles p ON p.id = c.a1 JOIN league_encounters e ON e.id = c.enc;
INSERT INTO _r SELECT count(*) = 1, 'XP de partida sem duplicar'
  FROM xp_events WHERE user_id = (SELECT a1 FROM _ctx) AND kind = 'league_match';
-- Quem organiza e também é admin de A não resolve o próprio encontro.
INSERT INTO league_organizers (league_id, user_id) SELECT league, admin_a FROM _ctx;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(admin_a) FROM _ctx;
DO $$ BEGIN PERFORM resolve_encounter((SELECT enc FROM _ctx), NULL, (SELECT ta FROM _ctx), 'Tentativa em causa própria.');
  INSERT INTO _r VALUES (false, 'organizador de A resolveu o próprio encontro');
EXCEPTION WHEN others THEN INSERT INTO _r VALUES (SQLERRM LIKE '%conflict_of_interest%', 'organizador que joga não resolve'); END $$;
RESET ROLE;
-- Conflito de interesses: quem é admin dos dois clubes não submete.
-- (Correr à parte se a dev tiver essa pessoa; senão fica a nota.)
SELECT CASE WHEN ok THEN 'OK    ' ELSE 'ERRO  ' END || label AS resultado FROM _r;
ROLLBACK;
