-- ═════════════════════════════════════════════════════════════════════════
-- LISTA DE TORNEIOS ABERTOS: AS VAGAS CONTADAS COMO O SERVIDOR
-- (Dev 3, 24 set 2026) — cartão «#488», o bocado que faltava.
--
-- Pode-se correr outra vez sem estragar.
--
-- O Renato corrigiu o #488 em `migration_tournaments_integridade.sql`
-- (b417e61): a página do torneio passa a mandar `taken_count`, com a conta
-- da `tournament_taken_slots` — a mesma que o `tournament_signup` usa para
-- decidir entre «dentro» e «suplente».
--
-- Faltava um terceiro sítio com uma conta própria: a lista de torneios
-- abertos (`list_open_tournaments`, Home e página do clube) usa
-- `tournament_category_spots` (#462, Dev 3), que contava validada +
-- selecionada + por_validar e deixava de fora `convite` e `sem_parceiro`.
-- A Home dizia «3 vagas» numa categoria onde o servidor já punha a pessoa em
-- suplente. Passa a devolver a `tournament_taken_slots`.
-- ═════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_src TEXT;
BEGIN
  IF to_regprocedure('tournament_taken_slots(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Falta a tournament_taken_slots. Parar e ler.';
  END IF;
  SELECT prosrc INTO v_src FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace AND proname = 'tournament_category_spots';
  IF v_src IS NULL THEN
    RAISE NOTICE 'Não há tournament_category_spots (a migração #462 não correu): nada a fazer.';
    RETURN;
  END IF;
  IF position('tournament_taken_slots' IN v_src) > 0 THEN
    RAISE NOTICE 'tournament_category_spots: já usava tournament_taken_slots.';
    RETURN;
  END IF;
  -- Só se substitui a versão que o Dev 3 escreveu no #462.
  IF v_src !~ 'status\s+IN\s*\(''validada'',\s*''selecionada'',\s*''por_validar''\)' THEN
    RAISE EXCEPTION 'tournament_category_spots não tem a forma esperada — alguém a mudou. Ler o corpo vivo.';
  END IF;
  EXECUTE $f$
    CREATE OR REPLACE FUNCTION tournament_category_spots(p_category_id UUID)
    RETURNS INTEGER
    LANGUAGE sql
    STABLE SECURITY DEFINER
    SET search_path = public
    AS $b$
      -- A mesma conta do tournament_signup, que decide se se entra ou se
      -- fica suplente (#488).
      SELECT tournament_taken_slots(p_category_id);
    $b$
  $f$;
  RAISE NOTICE 'Corrigida: tournament_category_spots';
END $$;
