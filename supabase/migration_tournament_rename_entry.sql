-- ═════════════════════════════════════════════════════════════════════════
-- Torneio: mudar o nome da dupla até as inscrições fecharem
--
-- PORQUÊ. Desenho aprovado pelo Francisco a 27 set («Top sim aprovo»,
-- design-handoff/2026-09-27-nome-da-dupla/SPEC.md): hoje o team_name só se
-- escreve na inscrição e não há forma de o mudar depois. Tem de estar antes
-- do Smash Cup (9 out).
--
-- O QUE FAZ. rename_tournament_entry(p_entry_id, p_team_name) → o nome
-- gravado (trim; vazio passa a NULL = aparecem os dois nomes). Nome e forma
-- do Dev 1 (ecrãs).
--   · Quem pode: o jogador 1 ou 2 da inscrição, ou um admin do clube
--     (is_tournament_admin). Senão: 'not_allowed'.
--   · Quando: enquanto as inscrições estão abertas — torneio e categoria em
--     'inscricoes' e o prazo (entries_deadline) por passar, as mesmas
--     regras de se inscrever. Senão: 'entries_closed'.
--   · Uma inscrição de quem desistiu não muda ('not_allowed').
--   · Quantas vezes quiser.
--
-- Dev 3, 27 set 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.rename_tournament_entry(p_entry_id UUID, p_team_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry tournament_entries%ROWTYPE;
  v_cat   tournament_categories%ROWTYPE;
  v_tour  tournaments%ROWTYPE;
  v_name  TEXT := NULLIF(trim(COALESCE(p_team_name, '')), '');
BEGIN
  SELECT * INTO v_entry FROM tournament_entries WHERE id = p_entry_id FOR UPDATE;
  IF v_entry.id IS NULL OR v_entry.status = 'desistiu' THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  SELECT * INTO v_cat  FROM tournament_categories WHERE id = v_entry.category_id;
  SELECT * INTO v_tour FROM tournaments WHERE id = v_cat.tournament_id;

  IF auth.uid() IS NULL
     OR NOT (auth.uid() IN (v_entry.player1_id, v_entry.player2_id) OR is_tournament_admin(v_tour.id)) THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;

  IF v_tour.status <> 'inscricoes' OR v_cat.status <> 'inscricoes'
     OR (v_tour.entries_deadline IS NOT NULL AND v_tour.entries_deadline < NOW()) THEN
    RAISE EXCEPTION 'entries_closed';
  END IF;

  UPDATE tournament_entries SET team_name = v_name WHERE id = p_entry_id;
  RETURN v_name;
END;
$$;

REVOKE ALL ON FUNCTION public.rename_tournament_entry(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rename_tournament_entry(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.rename_tournament_entry(UUID, TEXT) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT has_function_privilege('anon', 'public.rename_tournament_entry(uuid, text)', 'EXECUTE');           -- false
--   SELECT has_function_privilege('authenticated', 'public.rename_tournament_entry(uuid, text)', 'EXECUTE');  -- true
