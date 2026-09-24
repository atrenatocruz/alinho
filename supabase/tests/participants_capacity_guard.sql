-- Correr num Postgres local descartável:
--   psql -d <bd_vazia> -f supabase/tests/participants_capacity_guard.sql
-- Cria tabelas mínimas, corre a migração e imprime OK/ERRO por caso.
\set VERBOSITY terse
DO $$BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END$$;
DO $$BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END$$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('t.uid', true), '')::uuid $$;
CREATE FUNCTION is_org_admin(p uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT current_setting('t.admin', true) = 'on' $$;
CREATE TABLE games (id uuid PRIMARY KEY, organization_id uuid, status text, max_players int, num_courts int);
CREATE TABLE participants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), game_id uuid, user_id uuid, partner_id uuid,
  status text, created_at timestamptz DEFAULT now());
\i supabase/migration_mix_capacity_guard.sql

-- As funções REAIS da promoção de suplentes (a versão mais recente do
-- repositório) e o trigger que as chama ao sair — é aí que o guarda corre
-- dentro de outro trigger (revisão final, problema 1).
\i supabase/tests/_promote_waitlist_real.sql
CREATE TRIGGER game_promote_trigger AFTER DELETE ON participants
  FOR EACH ROW EXECUTE FUNCTION check_game_promote();

CREATE FUNCTION t_(label text, stmt text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN EXECUTE stmt; RETURN 'OK    ' || label; EXCEPTION WHEN OTHERS THEN RETURN 'ERRO  ' || label || ' -> ' || SQLERRM; END $f$;

-- mix de 4 vagas, aberto
INSERT INTO games VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000aa', 'open', 4, 1);
SELECT set_config('t.uid', '00000000-0000-0000-0000-0000000000b1', false), set_config('t.admin', 'off', false);
SELECT t_('dupla (2/4)', $q$INSERT INTO participants(game_id,user_id,partner_id,status) VALUES ('00000000-0000-0000-0000-000000000001', gen_random_uuid(), gen_random_uuid(), 'confirmed')$q$);
SELECT t_('sozinho (3/4)', $q$INSERT INTO participants(id,game_id,user_id,status) VALUES ('00000000-0000-0000-0000-0000000000c3','00000000-0000-0000-0000-000000000001', gen_random_uuid(), 'confirmed')$q$);
SELECT t_('dupla quando só há 1 vaga [deve recusar]', $q$INSERT INTO participants(game_id,user_id,partner_id,status) VALUES ('00000000-0000-0000-0000-000000000001', gen_random_uuid(), gen_random_uuid(), 'confirmed')$q$);
SELECT t_('sozinho (4/4)', $q$INSERT INTO participants(game_id,user_id,status) VALUES ('00000000-0000-0000-0000-000000000001', gen_random_uuid(), 'confirmed')$q$);
SELECT t_('5.º sozinho [deve recusar]', $q$INSERT INTO participants(game_id,user_id,status) VALUES ('00000000-0000-0000-0000-000000000001', gen_random_uuid(), 'confirmed')$q$);
SELECT t_('suplente com o mix cheio', $q$INSERT INTO participants(id,game_id,user_id,status) VALUES ('00000000-0000-0000-0000-0000000000c9','00000000-0000-0000-0000-000000000001', gen_random_uuid(), 'waitlisted')$q$);
SELECT t_('promover suplente sem vaga [deve recusar]', $q$UPDATE participants SET status='confirmed' WHERE id='00000000-0000-0000-0000-0000000000c9'$q$);
SELECT t_('sair (o 3.º)', $q$DELETE FROM participants WHERE id='00000000-0000-0000-0000-0000000000c3'$q$);
SELECT t_('promover suplente depois de alguém sair (Review Focus 1)', $q$UPDATE participants SET status='confirmed' WHERE id='00000000-0000-0000-0000-0000000000c9'$q$);
SELECT t_('juntar parceiro com o mix cheio [deve recusar]', $q$UPDATE participants SET partner_id=gen_random_uuid() WHERE id='00000000-0000-0000-0000-0000000000c9'$q$);
SELECT set_config('t.admin', 'on', false);
SELECT t_('admin inscreve acima das vagas (Review Focus 2)', $q$INSERT INTO participants(game_id,user_id,status) VALUES ('00000000-0000-0000-0000-000000000001', gen_random_uuid(), 'confirmed')$q$);
SELECT set_config('t.admin', 'off', false), set_config('t.uid', '', false);
SELECT t_('bot (sem sessão) acima das vagas [deve recusar]', $q$INSERT INTO participants(game_id,user_id,status) VALUES ('00000000-0000-0000-0000-000000000001', gen_random_uuid(), 'confirmed')$q$);
UPDATE games SET max_players = 8, num_courts = 2 WHERE id = '00000000-0000-0000-0000-000000000001';
SELECT t_('mais um campo: cabe (Review Focus 3)', $q$INSERT INTO participants(game_id,user_id,status) VALUES ('00000000-0000-0000-0000-000000000001', gen_random_uuid(), 'confirmed')$q$);
UPDATE games SET status = 'in_progress' WHERE id = '00000000-0000-0000-0000-000000000001';
SELECT t_('mix a decorrer: o trigger não se mete', $q$INSERT INTO participants(game_id,user_id,partner_id,status) VALUES ('00000000-0000-0000-0000-000000000001', gen_random_uuid(), gen_random_uuid(), 'confirmed')$q$);

-- ── Revisão final ─────────────────────────────────────────────────────────
-- Problema 1: mix cheio e o 1.º suplente é uma DUPLA. Quem está sozinho tem
-- de conseguir sair (a promoção passa das vagas, como sempre passou).
INSERT INTO games VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000aa', 'open', 4, 1);
SELECT set_config('t.uid', '00000000-0000-0000-0000-0000000000b1', false), set_config('t.admin', 'off', false);
INSERT INTO participants(id,game_id,user_id,status) VALUES
  ('00000000-0000-0000-0000-0000000002a1','00000000-0000-0000-0000-000000000002', gen_random_uuid(), 'confirmed'),
  ('00000000-0000-0000-0000-0000000002a2','00000000-0000-0000-0000-000000000002', gen_random_uuid(), 'confirmed'),
  ('00000000-0000-0000-0000-0000000002a3','00000000-0000-0000-0000-000000000002', gen_random_uuid(), 'confirmed'),
  ('00000000-0000-0000-0000-0000000002a4','00000000-0000-0000-0000-000000000002', gen_random_uuid(), 'confirmed');
INSERT INTO participants(id,game_id,user_id,partner_id,status) VALUES
  ('00000000-0000-0000-0000-0000000002b1','00000000-0000-0000-0000-000000000002', gen_random_uuid(), gen_random_uuid(), 'waitlisted');
SELECT t_('sair de um mix cheio com uma dupla à cabeça dos suplentes (revisão, 1)', $q$DELETE FROM participants WHERE id='00000000-0000-0000-0000-0000000002a1'$q$);
-- Problema 2: mix acima das vagas (inscrito pelo admin) — tirar o parceiro
-- de uma dupla confirmada (encolher; é o que o apagar-conta faz) passa sempre.
INSERT INTO games VALUES ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000aa', 'open', 4, 1);
SELECT set_config('t.admin', 'on', false);
INSERT INTO participants(id,game_id,user_id,partner_id,status) VALUES
  ('00000000-0000-0000-0000-0000000003c1','00000000-0000-0000-0000-000000000003', gen_random_uuid(), gen_random_uuid(), 'confirmed'),
  ('00000000-0000-0000-0000-0000000003c2','00000000-0000-0000-0000-000000000003', gen_random_uuid(), gen_random_uuid(), 'confirmed'),
  ('00000000-0000-0000-0000-0000000003c3','00000000-0000-0000-0000-000000000003', gen_random_uuid(), gen_random_uuid(), 'confirmed');
SELECT set_config('t.admin', 'off', false);
SELECT t_('encolher (dupla → sozinho) num mix acima das vagas (revisão, 2)', $q$UPDATE participants SET partner_id = NULL WHERE id='00000000-0000-0000-0000-0000000003c1'$q$);
