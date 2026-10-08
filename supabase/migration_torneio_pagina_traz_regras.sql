-- ═════════════════════════════════════════════════════════════════════════
-- Torneio: a página traz as regras (a folha de marcar pedia sempre pro set)
-- e o «Máximo de categorias por pessoa» que o organizador escolhe vale
--
-- PORQUÊ. QA, 8 out (Alinho/notas-entre-devs/2026-10-08-qa-ensaio/marcar-2-
-- sets-pede-pro-set-9.jpg): num torneio com «2 sets + super tie-break» ou
-- «Melhor de 3 sets», a folha de marcar pedia um pro set a 9 e não deixava
-- escrever sets. O MyGamesPanel e o /marcar leem tournament.rules da página
-- (scoring, tiebreak_8_8, duration_max), e o horário e as inscrições leem
-- duration_max, max_consecutive e max_categories_per_person. Mas o
-- tournament_page_json nunca devolveu rules, por isso a app assumia sempre
-- pro set a 9 com tie-break a 7. Bug grave do PO, para a versão de sexta.
--
-- O QUE FAZ
--   1. tournament.rules passa a vir na página, inteiro e como está
-- gravado. Não tem nada de privado: são as regras do torneio que a própria
-- página mostra. Corpo VIVO, 1 troca («já estava»). Devolve jsonb na mesma:
-- CREATE OR REPLACE, sem DROP; as permissões ficam (só service_role, porque
-- a função é chamada por dentro do get_tournament_page).
-- Não choca com a migration_torneio_t_shirts.sql, que troca outro pedaço
-- desta função: corre antes ou depois dela.
--   2. Máximo de categorias (Dev 1, 8 out): o Criar e o Editar gravam a
--      escolha em rules.max_categories, mas a tournament_categories_left (a
--      trava da inscrição, do aceitar e do ficar com o lugar) só lia
--      rules.max_categories_per_person, que fica sempre no 2 por omissão da
--      tabela. Passa a ler max_categories, depois max_categories_per_person,
--      e 2 por omissão (a mesma ordem do categoriesLeft do ecrã). Corpo
--      VIVO, 1 troca («já estava»); CREATE OR REPLACE, as permissões ficam.
--      Os 3 torneios de produção têm os dois a 2: ninguém foi afetado.
--
-- Testado no alinho-dev (8 out): num torneio «melhor_2_sets» a página traz
-- o formato; o 9-5 que o ecrã mandava é recusado pela trava; 2-1 e 0-2 com
-- os sets gravam, com o vencedor certo. Com 1 escolhido, a 2.ª inscrição dá
-- max_categories_reached; com 3, entram as três.
--
-- Dev 3, 8 out 2026 · ecrãs: Dev 1 (já leem tournament.rules)
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. A página traz as regras ──────────────────────────────────────────

DO $$
DECLARE
  c_mau CONSTANT TEXT := 't\.entries_deadline, t\.draw_on, t\.entry_fee_cents,';
  v_def TEXT := pg_get_functiondef('public.tournament_page_json(uuid,boolean)'::regprocedure);
BEGIN
  IF v_def LIKE '%t.entry_fee_cents, t.rules,%' THEN
    RAISE NOTICE 'tournament_page_json: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'tournament_page_json: o pedaço a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE regexp_replace(v_def, c_mau, 't.entries_deadline, t.draw_on, t.entry_fee_cents, t.rules,');
END $$;

-- ── 2. O máximo de categorias escolhido vale ────────────────────────────
DO $$
DECLARE
  c_mau CONSTANT TEXT := '\(rules->>''max_categories_per_person''\)::int';
  v_def TEXT := pg_get_functiondef('public.tournament_categories_left(uuid,uuid)'::regprocedure);
BEGIN
  IF v_def LIKE '%rules->>''max_categories'')::int%' THEN
    RAISE NOTICE 'tournament_categories_left: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'tournament_categories_left: o pedaço a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE regexp_replace(v_def, c_mau,
    'COALESCE((rules->>''max_categories'')::int, (rules->>''max_categories_per_person'')::int)');
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_functiondef('public.tournament_page_json(uuid,boolean)'::regprocedure) LIKE '%t.entry_fee_cents, t.rules,%';  -- true
--   SELECT get_tournament_page('<slug de um torneio público>')->'tournament'->'rules'->>'scoring';  -- o formato gravado
--   SELECT pg_get_functiondef('public.tournament_categories_left(uuid,uuid)'::regprocedure) LIKE '%rules->>''max_categories'')::int%';  -- true
