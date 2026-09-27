-- ═════════════════════════════════════════════════════════════════════════
-- Torneio: um nome por caso para «de onde vem» cada dupla no quadro
--
-- PORQUÊ. O calendário do torneio mostrava «Vencedor das meias 1» e
-- «Perdedor da 1.ª meia-final». Decisão do designer (27 set, pelo PO): um
-- nome por caso, em todo o lado — «Vencedor O1» (oitavos), «Vencedor Q1»
-- (quartos), «Vencedor meia 1» e, no 3.º lugar, «Perdedor meia 1». Para
-- antes de 9 out (Smash Cup).
--
-- O texto do quadro nasce no ecrã do sorteio (src/lib/tournamentDraw.js,
-- mudado no mesmo commit) e o do 3.º lugar no draw_category. Este ficheiro:
--   1. draw_category (corpo VIVO, cada versão): «Perdedor da 1.ª/2.ª
--      meia-final» passa a «Perdedor meia 1/2». Troca 1x; «já estava».
--   2. Os torneios já sorteados: os textos antigos passam aos novos, só
--      quando batem exatamente com os de antes (oitavos, quartos, meias e 3.º
--      lugar). É só o texto que se mostra: nada o lê para avançar duplas (o
--      quadro enche-se por ronda e lugar, e os «1.º do Grupo A» não mudam).
--      Os valores de antes ficam em arquivo_nomes_do_quadro, para desfazer.
--   Os 16 avos não entraram na decisão: ficam como estavam.
--
-- Dev 3, 27 set 2026 · ecrã: Dev 1
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. O 3.º lugar no sorteio ───────────────────────────────────────────
DO $$
DECLARE
  c_mau CONSTANT TEXT := '''Perdedor da 1\.ª meia-final'', ''Perdedor da 2\.ª meia-final''';
  c_bom CONSTANT TEXT := '''Perdedor meia 1'', ''Perdedor meia 2''';
  f     RECORD;
  v_n   INTEGER;
  v_vistas INTEGER := 0;
BEGIN
  FOR f IN SELECT p.oid, pg_get_function_identity_arguments(p.oid) AS args, p.prosrc
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'draw_category' LOOP
    v_vistas := v_vistas + 1;
    IF position('Perdedor meia 1' IN f.prosrc) > 0 THEN
      RAISE NOTICE 'draw_category(%): já estava', f.args;
      CONTINUE;
    END IF;
    SELECT count(*) INTO v_n FROM regexp_matches(f.prosrc, c_mau, 'g');
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'draw_category(%): esperava o texto do 3.º lugar 1 vez, encontrei %. Ler o corpo vivo.', f.args, v_n;
    END IF;
    EXECUTE regexp_replace(pg_get_functiondef(f.oid), c_mau, c_bom);
  END LOOP;
  IF v_vistas = 0 THEN
    RAISE EXCEPTION 'Não existe draw_category. Parar e ler.';
  END IF;
END $$;

-- ── 2. Os torneios já sorteados ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS arquivo_nomes_do_quadro (
  match_id  UUID PRIMARY KEY,
  source_a  TEXT,
  source_b  TEXT,
  feito_em  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE arquivo_nomes_do_quadro ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON arquivo_nomes_do_quadro FROM anon, authenticated;

CREATE OR REPLACE FUNCTION pg_temp.nome_novo(p TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p ~ '^Vencedor dos oitavos [0-9]+$' THEN regexp_replace(p, '^Vencedor dos oitavos ([0-9]+)$', 'Vencedor O\1')
    WHEN p ~ '^Vencedor dos quartos [0-9]+$' THEN regexp_replace(p, '^Vencedor dos quartos ([0-9]+)$', 'Vencedor Q\1')
    WHEN p ~ '^Vencedor das meias [0-9]+$'   THEN regexp_replace(p, '^Vencedor das meias ([0-9]+)$', 'Vencedor meia \1')
    WHEN p = 'Perdedor da 1.ª meia-final'    THEN 'Perdedor meia 1'
    WHEN p = 'Perdedor da 2.ª meia-final'    THEN 'Perdedor meia 2'
    ELSE p END;
$$;

INSERT INTO arquivo_nomes_do_quadro (match_id, source_a, source_b)
SELECT m.id, m.source_a, m.source_b FROM tournament_matches m
 WHERE (pg_temp.nome_novo(m.source_a) IS DISTINCT FROM m.source_a
        OR pg_temp.nome_novo(m.source_b) IS DISTINCT FROM m.source_b)
ON CONFLICT (match_id) DO NOTHING;

UPDATE tournament_matches m
   SET source_a = pg_temp.nome_novo(m.source_a),
       source_b = pg_temp.nome_novo(m.source_b)
 WHERE pg_temp.nome_novo(m.source_a) IS DISTINCT FROM m.source_a
    OR pg_temp.nome_novo(m.source_b) IS DISTINCT FROM m.source_b;

COMMIT;

-- Verificar depois de correr:
--   SELECT count(*) FROM tournament_matches
--    WHERE source_a ~ '^(Vencedor dos (oitavos|quartos)|Vencedor das meias|Perdedor da)'
--       OR source_b ~ '^(Vencedor dos (oitavos|quartos)|Vencedor das meias|Perdedor da)';   -- 0
--   SELECT count(*) FROM arquivo_nomes_do_quadro;                                            -- quantos mudaram
-- Desfazer (se for preciso):
--   UPDATE tournament_matches m SET source_a = a.source_a, source_b = a.source_b
--     FROM arquivo_nomes_do_quadro a WHERE a.match_id = m.id;
