-- ═════════════════════════════════════════════════════════════════════════
-- Torneio: um dia pode acabar de madrugada, depois da meia-noite (Trello #797)
--
-- O QUE FAZ.
--   · tournament_days aceita um fim antes do início quando o fim é até às
--     06:00: sábado das 09:00 à 01:00 acaba à 01:00 de domingo. Fora disso
--     (21:00 a 20:00) continua a ser recusado.
--   · tournament_slot_problem (corpo vivo, 4 trocas): o jogo tem de caber
--     entre a abertura do dia e o fecho, contado no dia seguinte quando o
--     dia acaba de madrugada; o jogo das 00:30 de domingo pertence a sábado,
--     e a regra da categoria («sábado, a partir das 21h») usa esse dia.
--     Num dia normal dá exatamente o mesmo resultado que hoje.
--
-- A APP ANTIGA. Os ecrãs antigos não deixam escrever um fim antes do início,
-- por isso continuam a ver e a gravar o mesmo. Só alarga o que é aceite.
--
-- ORDEM. Não depende de outras. Tem de estar em produção antes de o torneio
-- com sábado até à 01:00 ter os dias gravados assim. Os ecrãs do Dev 1
-- (etiqueta «até à 01:00 de domingo») vêm depois.
--
-- Para desfazer (só em emergência, e só sem dias de madrugada gravados):
--   ALTER TABLE tournament_days DROP CONSTRAINT tournament_days_check,
--     ADD CONSTRAINT tournament_days_check CHECK (ends_at > starts_at);
--   e voltar a pôr o corpo anterior de tournament_slot_problem
--   (md5 sem \r 6a773b77…).
--
-- Dev 3, 11 nov 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.tournament_days
  DROP CONSTRAINT IF EXISTS tournament_days_check,
  ADD CONSTRAINT tournament_days_check
    CHECK (ends_at > starts_at OR (ends_at < starts_at AND ends_at <= TIME '06:00'));

DO $patch$
DECLARE
  v_marca CONSTANT TEXT := 'dia que acaba de madrugada (#797)';
  v_def   TEXT := replace(pg_get_functiondef('public.tournament_slot_problem(uuid,timestamptz,uuid,integer)'::regprocedure), E'\r', '');
  v_old   TEXT;
  v_new   TEXT;
  v_n     INT;
  r       RECORD;
BEGIN
  IF position(v_marca IN v_def) > 0 THEN
    RAISE NOTICE 'tournament_slot_problem: já estava';
    RETURN;
  END IF;
  FOR r IN
    SELECT * FROM (VALUES
      (1,
$a$  v_janela     TEXT;
$a$,
$a$  v_janela     TEXT;
  v_dia_data   DATE;
$a$),
      (2,
$a$  SELECT EXISTS (
    SELECT 1 FROM tournament_days d
     WHERE d.tournament_id = v_tournament
       AND (p_when AT TIME ZONE 'Europe/Lisbon')::date = d.date
       AND (p_when AT TIME ZONE 'Europe/Lisbon')::time >= d.starts_at
       -- O jogo tem de CABER no dia, nao so comecar nele: um jogo de 60
       -- min as 21:30 num dia que fecha as 22:00 nao se joga todo.
       AND (v_ends AT TIME ZONE 'Europe/Lisbon')::time <= d.ends_at
       AND (v_ends AT TIME ZONE 'Europe/Lisbon')::date = d.date
  ) INTO v_dia;
$a$,
$a$  --    O jogo tem de CABER no dia, nao so comecar nele: um jogo de 60
  --    min as 21:30 num dia que fecha as 22:00 nao se joga todo.
  --    Num dia que acaba de madrugada, o fecho conta-se no dia seguinte
  --    (dia que acaba de madrugada (#797)): o jogo das 00:30 de domingo
  --    pertence a sabado. v_dia_data guarda o dia do torneio do jogo.
  SELECT d.date INTO v_dia_data
    FROM tournament_days d
   WHERE d.tournament_id = v_tournament
     AND (p_when AT TIME ZONE 'Europe/Lisbon') >= d.date + d.starts_at
     AND (v_ends AT TIME ZONE 'Europe/Lisbon')
         <= d.date + d.ends_at
            + CASE WHEN d.ends_at < d.starts_at THEN INTERVAL '1 day' ELSE INTERVAL '0' END
   ORDER BY d.date
   LIMIT 1;
  v_dia := v_dia_data IS NOT NULL;
$a$),
      (3,
$a$                AND (p_when AT TIME ZONE 'Europe/Lisbon')::date <> c.day_date
$a$,
$a$                AND v_dia_data <> c.day_date
$a$),
      (4,
$a$                AND (p_when AT TIME ZONE 'Europe/Lisbon')::time < c.start_time
$a$,
$a$                AND (p_when AT TIME ZONE 'Europe/Lisbon') < v_dia_data + c.start_time
$a$)
    ) AS x(n, old_txt, new_txt)
    ORDER BY n
  LOOP
    v_old := replace(r.old_txt, E'\r', '');
    v_new := replace(r.new_txt, E'\r', '');
    v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'tournament_slot_problem: troca %, esperava 1 vez, encontrei %. Parar e ler.', r.n, v_n;
    END IF;
    v_def := replace(v_def, v_old, v_new);
  END LOOP;
  EXECUTE v_def;
END $patch$;

REVOKE ALL ON FUNCTION public.tournament_slot_problem(uuid, timestamptz, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tournament_slot_problem(uuid, timestamptz, uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.tournament_slot_problem(uuid, timestamptz, uuid, integer) TO authenticated, service_role;

DO $$
DECLARE
  v_fn regprocedure := 'public.tournament_slot_problem(uuid,timestamptz,uuid,integer)'::regprocedure;
BEGIN
  IF has_function_privilege('anon', v_fn, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'Acessos de tournament_slot_problem errados';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_fn) THEN
    RAISE EXCEPTION 'tournament_slot_problem deixou de ser SECURITY DEFINER';
  END IF;
  IF position('dia que acaba de madrugada (#797)' IN pg_get_functiondef(v_fn)) = 0 THEN
    RAISE EXCEPTION 'tournament_slot_problem sem a troca';
  END IF;
  IF pg_get_constraintdef((SELECT oid FROM pg_constraint
        WHERE conrelid = 'public.tournament_days'::regclass AND conname = 'tournament_days_check'))
     NOT LIKE '%06:00%' THEN
    RAISE EXCEPTION 'tournament_days_check sem a madrugada';
  END IF;
END $$;

COMMIT;
