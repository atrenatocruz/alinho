-- ═════════════════════════════════════════════════════════════════════════
-- Séries: as inscrições abrem sempre à mesma hora de Lisboa, com a mudança
-- da hora pelo meio ou não
--
-- PORQUÊ. Bug em produção, 27 out (depois da mudança da hora de 25 out): o
-- «+1 Mix de Segunda-feira» abria às 13:00 e abriu às 12:00. O
-- mix_offset_seconds («6 dias antes, às 13:00») era usado em segundos
-- absolutos: date - make_interval(secs => offset). Quando a abertura e o mix
-- caem em lados diferentes da mudança da hora, isso dá uma hora a mais ou a
-- menos. E o ecrã, ao gravar a série com um mix nessa semana, guardava 153 h
-- em vez de 152 h, que depois davam 12:00 em todas as semanas seguintes.
--
-- O QUE FAZ. O offset passa a contar-se no relógio de Lisboa, como a
-- recurrence_next_date já faz para a data do mix:
--   launch_at = ((date AT TIME ZONE 'Europe/Lisbon') - offset) AT TIME ZONE 'Europe/Lisbon'
-- Emenda por texto a recurrence_insert_pending (onde o cron e o publicar de
-- rascunho criam a data seguinte) e a resume_recurrence (retomar uma série
-- em pausa). O ecrã faz a mesma conta (src/lib/launchDay.js:
-- launchOffsetSeconds e launchAtFromOffset), por isso grava e mostra o mesmo.
--
-- Os dados (as séries que ficaram com 1 h a mais) acertam-se à parte, à mão,
-- com a confirmação do Francisco: este ficheiro só muda a conta.
--
-- ORDEM. Qualquer: só troca uma linha de cada função e mantém o resto do
-- corpo vivo (também o que a migration_mix_aquecimento_e_troca.sql lá pôs).
-- Se alguma migração antiga voltar a criar estas funções por inteiro, correr
-- esta outra vez a seguir.
--
-- COMPATIBILIDADE. As versões antigas da app (lojas) continuam a fazer a
-- conta antiga: só se nota nas duas semanas à volta de cada mudança da hora
-- (a próxima é a 28 mar 2027).
--
-- Dev 3, 27 out 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  v_def TEXT;
  v_n   INT;
  r     RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('public.recurrence_insert_pending(uuid,timestamp with time zone)',
       'p_date - make_interval(secs => rec.mix_offset_seconds)',
       '((p_date AT TIME ZONE ''Europe/Lisbon'') - make_interval(secs => rec.mix_offset_seconds)) AT TIME ZONE ''Europe/Lisbon'''),
      ('public.resume_recurrence(uuid)',
       'launch_at = date - make_interval(secs => gr.mix_offset_seconds),',
       'launch_at = ((date AT TIME ZONE ''Europe/Lisbon'') - make_interval(secs => gr.mix_offset_seconds)) AT TIME ZONE ''Europe/Lisbon'',')
    ) AS x(fn, old_txt, new_txt)
  LOOP
    v_def := replace(pg_get_functiondef(r.fn::regprocedure), E'\r', '');
    IF position(r.new_txt IN v_def) > 0 THEN
      RAISE NOTICE '% já estava', r.fn;
      CONTINUE;
    END IF;
    v_n := (length(v_def) - length(replace(v_def, r.old_txt, ''))) / length(r.old_txt);
    IF v_n <> 1 THEN RAISE EXCEPTION '%: esperava 1 vez «%», encontrei %. Parar.', r.fn, r.old_txt, v_n; END IF;
    EXECUTE replace(v_def, r.old_txt, r.new_txt);
  END LOOP;
END $$;

-- CREATE OR REPLACE mantém os GRANT; por segurança, como nas outras.
REVOKE EXECUTE ON FUNCTION public.recurrence_insert_pending(uuid, timestamptz) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.resume_recurrence(uuid) FROM PUBLIC, anon;

COMMIT;

-- Verificar depois de correr (as duas linhas → true):
--   SELECT proname, position('AT TIME ZONE ''Europe/Lisbon'') - make_interval' IN prosrc) > 0
--     FROM pg_proc WHERE proname IN ('recurrence_insert_pending', 'resume_recurrence');
