-- ═════════════════════════════════════════════════════════════════════════
-- Torneio: dizer se quem organiza é um clube ou um grupo (club_kind)
--
-- PORQUÊ. Combinado com o Dev 1 (2 out, «depois do main de sexta»): os
-- cartões e a página do torneio mostram de quem é o torneio de maneira
-- diferente para um clube e para um grupo. O ecrã já lê club_kind
-- (agenda.js, ScoreTodayCard.jsx), mas a base de dados ainda não o
-- mandava, e o ecrã tinha de adivinhar (kindOf).
--
-- O QUE FAZ. Junta club_kind = organizations.kind ('club' ou 'group') ao
-- lado do club_name, sem mudar mais nada (corpo VIVO, 1 troca em cada;
-- «já estava»):
--   · vista tournament_public (coluna nova no fim);
--   · list_open_tournaments (devolve jsonb: mais uma chave);
--   · tournament_page_json (a página do torneio: mais uma chave).
--
-- Dev 3, 6 out 2026 · ecrã: Dev 1
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Vista: a coluna nova vai no fim (é o que o CREATE OR REPLACE deixa) ──
DO $$
DECLARE
  v_def TEXT := pg_get_viewdef('public.tournament_public'::regclass, true);
BEGIN
  IF v_def LIKE '%club_kind%' THEN
    RAISE NOTICE 'tournament_public: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, '\) AS match_count', 'g')) <> 1
     OR (SELECT count(*) FROM regexp_matches(v_def, 'JOIN organizations o ON o\.id = t\.organization_id', 'g')) <> 1 THEN
    RAISE EXCEPTION 'tournament_public: a vista viva não é a esperada. Parar e ler.';
  END IF;
  EXECUTE 'CREATE OR REPLACE VIEW public.tournament_public AS '
       || regexp_replace(rtrim(v_def, '; '), '(\) AS match_count)', '\1,
    o.kind AS club_kind');
END $$;

-- ── Funções: mais uma chave ao lado do club_name ────────────────────────
DO $$
DECLARE
  f     RECORD;
  v_def TEXT;
BEGIN
  FOR f IN SELECT * FROM (VALUES
      ('public.list_open_tournaments(integer, uuid, boolean)',
       '(a\.organization_id, a\.club_name, a\.club_logo_url,)',
       '\1 a.club_kind,'),
      ('public.tournament_page_json(uuid, boolean)',
       '(o\.name AS club_name, o\.group_logo_url AS club_logo_url,)',
       '\1 o.kind AS club_kind,')
    ) AS t(sig, mau, bom) LOOP
    v_def := pg_get_functiondef(f.sig::regprocedure);
    IF v_def LIKE '%club_kind%' THEN
      RAISE NOTICE '%: já estava', f.sig;
      CONTINUE;
    END IF;
    IF (SELECT count(*) FROM regexp_matches(v_def, f.mau, 'g')) <> 1 THEN
      RAISE EXCEPTION '%: o pedaço a trocar não aparece 1 vez. Parar e ler.', f.sig;
    END IF;
    EXECUTE regexp_replace(v_def, f.mau, f.bom);
  END LOOP;
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT club_kind FROM tournament_public LIMIT 1;  -- 'club' ou 'group'
--   SELECT list_open_tournaments(5, NULL, true)->0 ? 'club_kind';  -- true (se houver algum aberto)
