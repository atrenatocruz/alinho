-- ═════════════════════════════════════════════════════════════════════════
-- Torneio: a página traz o endereço do clube (para o nome abrir a página dele)
--
-- PORQUÊ. QA e Francisco, 19 out (via Dev 1): no topo do torneio,
-- «Boavista FC · Grupo» deve abrir a página do clube, como no mix. A página
-- do torneio é pública e quem não é membro não lê organizations.
--
-- O QUE FAZ. tournament_page_json (usada pelo get_tournament_page) passa a
-- devolver também club_slug (organizations.slug), ao lado do club_name.
-- Corpo VIVO, 1 troca literal («já estava»).
--
-- Dev 3, 19 out 2026 · ecrã: Dev 1 (TournamentPage já lê tour.club_slug)
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  c_mau CONSTANT TEXT := 'o.name AS club_name, o.group_logo_url AS club_logo_url, o.kind AS club_kind,';
  c_bom CONSTANT TEXT := 'o.name AS club_name, o.slug AS club_slug, o.group_logo_url AS club_logo_url, o.kind AS club_kind,';
  v_def TEXT := replace(pg_get_functiondef('public.tournament_page_json(uuid,boolean)'::regprocedure), E'\r', '');
BEGIN
  IF position('o.slug AS club_slug' IN v_def) > 0 THEN
    RAISE NOTICE 'tournament_page_json: já estava';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, c_mau, ''))) / length(c_mau) <> 1 THEN
    RAISE EXCEPTION 'tournament_page_json: o pedaço a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE replace(v_def, c_mau, c_bom);
END $$;

COMMIT;

-- Verificar depois de correr (true):
--   SELECT get_tournament_page((SELECT id::text FROM tournaments WHERE is_public AND status <> 'rascunho' LIMIT 1))->'tournament' ? 'club_slug';
