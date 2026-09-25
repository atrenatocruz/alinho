-- ═════════════════════════════════════════════════════════════════════════
-- #502 — Horas dos jogos: cada categoria joga-se no seu dia e a partir da
-- sua hora (tournament_slot_problem).
--
-- O que se passava (QA, 25 set, torneio de TESTE, F4 e F5): o servidor
-- deixava gravar uma categoria de domingo numa sexta, e a qualquer hora do
-- dia — só via se o jogo cabia num dos dias do torneio. A categoria tem o
-- seu dia (`day_date`) e a sua hora de início (`start_time`): «sábado, a
-- partir das 12h».
--
-- O que faz: acrescenta à `tournament_slot_problem` (a regra única que o
-- save_match_schedule e a grelha perguntam) um passo 1b, logo a seguir a
-- «o jogo tem de caber num dos dias do torneio»:
--   · se a categoria tem dia, o jogo tem de ser nesse dia (hora de Portugal);
--   · se tem hora de início, o jogo não começa antes dela.
-- Sem dia nem hora na categoria, nada muda.
--
-- A outra metade do #502 (a proposta ordenava mal as rondas do quadro) é
-- só da app: src/lib/tournamentSchedule.js e src/lib/scorePage.js.
--
-- Parte do corpo vivo: troca só o fragmento, e recusa se não o encontrar
-- exatamente uma vez. Se já tiver o passo 1b, diz «já estava» e não mexe.
-- CREATE OR REPLACE com a mesma assinatura: as permissões ficam; mesmo
-- assim repõem-se explicitamente (REVOKE de PUBLIC e anon, GRANT só a
-- authenticated — nota do System Integrator, 25 set).
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  c_decl_mau CONSTANT TEXT := '(v_dia\s+BOOLEAN;)';
  c_decl_bom CONSTANT TEXT := '\1
  v_janela     TEXT;';
  c_dia_mau  CONSTANT TEXT := '(RETURN ''Esse jogo não cabe nas horas desse dia do torneio'';\s*END IF;)';
  c_dia_bom  CONSTANT TEXT := '\1

  -- 1b. Cada categoria joga-se no seu dia e a partir da sua hora
  --     («sábado, a partir das 12h»). Hora de Portugal, como no passo 1
  --     (Trello #502).
  SELECT CASE
           WHEN c.day_date IS NOT NULL
                AND (p_when AT TIME ZONE ''Europe/Lisbon'')::date <> c.day_date
             THEN ''Esta categoria joga-se a '' || to_char(c.day_date, ''DD/MM'')
                  || COALESCE('', a partir das '' || to_char(c.start_time, ''HH24:MI''), '''')
           WHEN c.start_time IS NOT NULL
                AND (p_when AT TIME ZONE ''Europe/Lisbon'')::time < c.start_time
             THEN ''Esta categoria só começa às '' || to_char(c.start_time, ''HH24:MI'')
         END
    INTO v_janela
    FROM tournament_categories c WHERE c.id = m.category_id;
  IF v_janela IS NOT NULL THEN
    RETURN v_janela;
  END IF;';
  v_def  TEXT;
BEGIN
  v_def := pg_get_functiondef('public.tournament_slot_problem(uuid, timestamptz, uuid, integer)'::regprocedure);

  IF position('v_janela' IN v_def) > 0 THEN
    RAISE NOTICE 'tournament_slot_problem: o passo 1b (dia e hora da categoria) já estava.';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_decl_mau, 'g')) <> 1
     OR (SELECT count(*) FROM regexp_matches(v_def, c_dia_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'tournament_slot_problem mudou: os fragmentos esperados não aparecem exatamente uma vez. Ler o corpo vivo antes de correr.';
  END IF;

  v_def := regexp_replace(v_def, c_decl_mau, c_decl_bom);
  v_def := regexp_replace(v_def, c_dia_mau, c_dia_bom);
  EXECUTE v_def;

  IF position('v_janela' IN pg_get_functiondef('public.tournament_slot_problem(uuid, timestamptz, uuid, integer)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'tournament_slot_problem: o passo 1b não ficou. Parar e ler.';
  END IF;
  RAISE NOTICE 'tournament_slot_problem: passa a respeitar o dia e a hora de cada categoria.';
END $$;

REVOKE ALL ON FUNCTION public.tournament_slot_problem(UUID, TIMESTAMPTZ, UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tournament_slot_problem(UUID, TIMESTAMPTZ, UUID, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.tournament_slot_problem(UUID, TIMESTAMPTZ, UUID, INTEGER) TO authenticated;
