-- ═════════════════════════════════════════════════════════════════════════
-- Distrito dos grupos que já existem
--
-- PORQUÊ. A RM Terapias (parceiro de Setúbal) liga-se a 1 nov. O pódio do
-- mês por zona, o cartão do parceiro e os prémios (award_month_podium,
-- get_month_ranking_zone, list_my_partner_cards,
-- get_my_month_prize_offers) olham para organizations.district, e em
-- produção 15 dos 16 grupos tinham-no a NULL (28 out). Sem isto ninguém vê
-- o cartão da RM, o pódio de Setúbal fica vazio e em dezembro não sai prémio.
--
-- DE ONDE VEM CADA DISTRITO. Dos campos e coordenadas dos jogos dos últimos
-- 60 dias (SELECT em produção, 28 out). Lista confirmada pelo Francisco:
--   Setúbal: A2N Padel Academy (Corroios), + 1 Grupo de Padel (Smash Padel
--            Almada), Smash Padel Almada, Alinho Grupo Padel (8 de 9 jogos
--            em Corroios/Almada/Caparica), Padel dos Fortes (Rackets Pro
--            Nova, Caparica).
--   Lisboa:  Aquele Padel Maroto (Indoor Padel Center, Carnaxide), Jota
--            Padeleiros (Rackets Pro Saldanha), ZEKRETAS (Capital Padel
--            Academy, Alcabideche), e, por indicação do Francisco (28 out),
--            Friday Mixada (Amadora) e Padel EUL (Rackets Pro EUL).
-- Ficam de fora os grupos sem jogos: o grupo pode escolher depois.
-- O texto é o de src/lib/leagueDistricts.js (o mesmo do partners.district).
--
-- O QUE FAZ. UPDATE por id, só onde o distrito ainda está NULL: nunca
-- passa por cima de um distrito que alguém já tenha escolhido. Diz quantos
-- mudou e quantos já tinham distrito.
--
-- ORDEM. Qualquer. Antes de 1 nov.
--
-- Dev 3, 28 out 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  v_mudou   INT;
  v_tinham  INT;
  v_faltam  INT;
BEGIN
  CREATE TEMP TABLE _distrito ON COMMIT DROP AS
  SELECT id::uuid, distrito FROM (VALUES
    ('71ee4483-8fc6-4919-a6e2-c56143da8ad9', 'Setúbal'),  -- A2N Padel Academy
    ('2a5f7ef2-ba1c-4d9d-97ca-57ea00c76164', 'Setúbal'),  -- + 1 Grupo de Padel
    ('2a025553-528b-49e3-a2e9-f1d1fccf9c20', 'Setúbal'),  -- Smash Padel Almada
    ('42372f75-192e-4af6-b7cb-5bd28f3ba096', 'Setúbal'),  -- Alinho Grupo Padel
    ('d22052cc-2f26-455a-8ffb-98869ddfc387', 'Setúbal'),  -- Padel dos Fortes
    ('fb3735d7-4214-4fc7-80ac-1777a6f64da5', 'Lisboa'),   -- Aquele Padel Maroto
    ('b4c44f75-2635-48a0-88cf-ca36472b3dce', 'Lisboa'),   -- Jota Padeleiros
    ('3f10a06a-6c39-4658-acf1-b278cb96dc75', 'Lisboa'),   -- ZEKRETAS
    ('9d23f01a-1fd3-4f9f-a862-c802257d3749', 'Lisboa'),   -- Friday Mixada
    ('25a2674b-88ba-4ce0-80c5-ad8b3ca82d73', 'Lisboa')    -- Padel EUL
  ) AS v(id, distrito);

  SELECT count(*) FILTER (WHERE o.district IS NOT NULL), count(*) FILTER (WHERE o.id IS NULL)
    INTO v_tinham, v_faltam
    FROM _distrito d LEFT JOIN organizations o ON o.id = d.id;
  IF v_faltam > 0 THEN
    RAISE EXCEPTION '% grupo(s) da lista não existem. Parar.', v_faltam;
  END IF;

  UPDATE organizations o
     SET district = d.distrito
    FROM _distrito d
   WHERE o.id = d.id AND o.district IS NULL;
  GET DIAGNOSTICS v_mudou = ROW_COUNT;

  RAISE NOTICE 'Distrito posto em % grupo(s); % já tinham distrito e ficaram como estavam.', v_mudou, v_tinham;
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT name, district FROM organizations ORDER BY district NULLS LAST, name;
--   → 5 em Setúbal, 6 em Lisboa (com o alinho Demo), o resto NULL.
