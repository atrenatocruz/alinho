-- ═════════════════════════════════════════════════════════════════════════
-- Níveis dos mixes: M, F e MX (misto) — sem N (Trello #577)
--
-- PORQUÊ. Decisão do Francisco (26 set): nos níveis dos mixes ficam só M
-- (masculino), F (feminino) e MX (misto), de 1 a 6; o N (sem sexo) já não
-- existe. O robô do Renato já percebe «In mx4» (aa2471a, no main), mas a
-- base de dados só aceitava M1–M6 e F1–F6: um grupo de WhatsApp com
-- níveis MX, ou um mix com nível MX, não se conseguia gravar.
--
-- O QUE MUDA. A regra dos valores válidos, igual nos três sítios:
--   · whatsapp_groups.levels   (os níveis que cada grupo vê)
--   · games.level              (o nível do mix)
--   · game_recurrences.level   (o nível do mix que se repete)
-- passa a M1–M6, F1–F6 e MX1–MX6. Os valores que já lá estão continuam
-- válidos (só se acrescenta MX); se aparecer algum fora da lista, o ADD
-- CONSTRAINT falha e nada muda — é para parar e ler.
--
-- As regras antigas foram criadas sem nome (migration_whatsapp_groups.sql);
-- apagam-se as CHECK dessas colunas que mencionam 'M1' e cria-se uma com
-- nome. Diz «já estava» se já correu.
--
-- Dev 3, 26 set 2026 · depois de migration_whatsapp_groups.sql
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  c_niveis CONSTANT TEXT :=
    'ARRAY[''M1'',''M2'',''M3'',''M4'',''M5'',''M6'',''F1'',''F2'',''F3'',''F4'',''F5'',''F6'',''MX1'',''MX2'',''MX3'',''MX4'',''MX5'',''MX6'']::text[]';
  r RECORD;
  t RECORD;
BEGIN
  FOR t IN SELECT * FROM (VALUES
      ('whatsapp_groups',  'levels', 'whatsapp_groups_levels_mx_check',
       'levels IS NULL OR levels <@ ' || c_niveis),
      ('games',            'level',  'games_level_mx_check',
       'level IS NULL OR level = ANY (' || c_niveis || ')'),
      ('game_recurrences', 'level',  'game_recurrences_level_mx_check',
       'level IS NULL OR level = ANY (' || c_niveis || ')')
    ) AS v(tbl, col, nome, regra)
  LOOP
    IF EXISTS (SELECT 1 FROM pg_constraint
                WHERE conrelid = format('public.%I', t.tbl)::regclass AND conname = t.nome) THEN
      RAISE NOTICE '%: já estava', t.nome;
      CONTINUE;
    END IF;
    -- As CHECK antigas desta coluna (sem nome): as que falam da coluna e de 'M1'.
    FOR r IN SELECT c.conname FROM pg_constraint c
              WHERE c.conrelid = format('public.%I', t.tbl)::regclass AND c.contype = 'c'
                AND pg_get_constraintdef(c.oid) ~ ('\m' || t.col || '\M')
                AND pg_get_constraintdef(c.oid) LIKE '%''M1''%'
    LOOP
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', t.tbl, r.conname);
      RAISE NOTICE '%: saiu a regra antiga %', t.tbl, r.conname;
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (%s)', t.tbl, t.nome, t.regra);
  END LOOP;
END $$;

COMMIT;

-- Verificar depois de correr (3 linhas, todas com MX1):
--   SELECT conrelid::regclass, conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname IN ('whatsapp_groups_levels_mx_check','games_level_mx_check','game_recurrences_level_mx_check');
