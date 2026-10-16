-- supabase/tests/liga_6_leitura.sql — alinho-dev, depois da migração 6.
-- Reaproveita uma liga publicada da dev com uma candidatura pendente
-- (preencher o slug). Verifica o que vê quem não tem sessão.
BEGIN;
CREATE TEMP TABLE _r (ok boolean, label text);
GRANT ALL ON _r TO anon;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
DO $$ DECLARE p jsonb; s text; e jsonb; BEGIN
  p := get_league_page('<slug de uma liga publicada>');
  s := p::text;
  INSERT INTO _r VALUES (p IS NOT NULL, 'anon lê a página da liga');
  INSERT INTO _r VALUES (s NOT LIKE '%@%', 'sem e-mails');
  INSERT INTO _r VALUES (s NOT LIKE '%"rating"%' AND s NOT LIKE '%phone%', 'sem ranking exato nem telefone');
  INSERT INTO _r VALUES (NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p->'teams') t WHERE t->>'status' <> 'aprovada'),
                         'anon só vê equipas aprovadas');
  INSERT INTO _r VALUES (NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p->'teams') t WHERE t ? 'organization_id'),
                         'anon não vê ids de clubes');
  INSERT INTO _r VALUES ((p->'viewer'->>'can_manage')::boolean IS FALSE, 'anon não gere');
  e := get_league_encounter((p->'encounters'->0->>'id')::uuid);
  INSERT INTO _r VALUES (e IS NOT NULL AND (e->'encounter'->>'resolution_note') IS NULL, 'anon não vê a nota da decisão');
END $$;
DO $$ BEGIN
  INSERT INTO _r VALUES (get_league_page('<slug de uma liga em rascunho>') IS NULL, 'rascunho invisível a anon');
END $$;
RESET ROLE;
SELECT CASE WHEN ok THEN 'OK    ' ELSE 'ERRO  ' END || label AS resultado FROM _r;
ROLLBACK;
