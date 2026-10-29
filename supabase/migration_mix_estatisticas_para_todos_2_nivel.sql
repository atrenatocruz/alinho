-- ═════════════════════════════════════════════════════════════════════════
-- Mix: as linhas preenchidas a 28 out ganham o «±N ranking» que lhes falta
-- (continuação da migration_mix_estatisticas_para_todos.sql)
--
-- PORQUÊ. Bug em produção (Francisco, 28 out, com print do «Mix M4 · Terça»
-- da A2N): o Nuno Nogueira aparece em 8.º com «15 pontos» em vez do «±N
-- ranking» dos outros. As 26 linhas preenchidas hoje ficaram com
-- rating_delta/rating_after NULL e o ecrã ordena por rating_delta (nulls
-- last). O nível destas pessoas já tinha mexido no fecho de cada mix; só
-- faltava o registo.
--
-- COMO SE CHEGOU AOS NÚMEROS (só leitura em produção, 28 out). Nada se
-- volta a aplicar ao nível: os valores saem do que já está gravado.
--   · Para cada pessoa: nível de hoje − nível de partida − tudo o que está
--     registado (mixes, amigos, grupos, torneios) = o que os mixes em falta
--     lhe deram. Os jogos batem certo em todos: rating_games de hoje = jogos
--     registados + jogos destes mixes.
--   · Quem só tem um mix em falta leva essa diferença inteira; o
--     rating_after é o nível logo a seguir a esse mix (o de hoje, ou o «antes»
--     do mix seguinte que está registado).
--   · Quem tem mais de um, divide pelo parceiro da noite (no Elo simples os
--     dois da dupla levam o mesmo quando têm o mesmo K) e a soma bate ao
--     cêntimo com a diferença total.
--   · Conferido pelo parceiro em todos os mixes de duplas fixas (ex.: Nuno
--     +64,86 com K 40 ao lado do Francisco +32,42 com K 20).
--   · Tomás Martins (0ec3c23a, 20 out): o nível NÃO lhe foi aplicado nesse
--     mix (o lugar era de um convidado sem conta quando fechou; ficou com
--     ele depois). Fica +0 e o nível de partida dele (1100). [Proposta, por
--     confirmar com o PO/Francisco.]
--   · Guilherme Ameixa (859400e6, M5 de 28 set): o −17,71 chegou-lhe mais
--     tarde, ao juntar a conta de convidado com que jogou; o rating_after
--     fica no nível que teve de facto com esse delta (994,40, o «antes» do
--     mix de 12 out), não num 882,29 que nunca teve. (QA, 28 out)
--   · Das 26 linhas de hoje, as outras 2 são de um mix amigável
--     (games.ranked = false) e ficam NULL de propósito, como as 20 mais
--     antigas do mesmo tipo: nesses mixes ninguém mexeu no nível.
--
-- O QUE FAZ. Escreve rating_delta e rating_after nas 24 linhas, só onde
-- ainda estão NULL. Pára se não encontrar exatamente as 24 (ou «já estava»
-- se já tiverem estes valores).
--
-- ORDEM. Depois da migration_mix_estatisticas_para_todos.sql.
--
-- COMPATIBILIDADE. Só dados; mesmas colunas.
--
-- Dev 3, 28 out 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TEMP TABLE _nivel ON COMMIT DROP AS
SELECT game_id::uuid, user_id::uuid, delta::numeric, depois::numeric FROM (VALUES
  -- +1 Mix de Segunda-feira, 21 set
  ('fc8a01f1-92c1-47f7-95ff-9018666028cf', '9b54bb15-679f-44a5-8318-cc2d18d68c42',  17.92,  928.29),
  -- +1 Mix de Segunda-feira, 28 set
  ('59a846d6-1879-445c-9802-18ad23e70e8b', '9b54bb15-679f-44a5-8318-cc2d18d68c42',  -0.75,  927.54),
  -- M5, 28 set
  ('109f4d12-0481-4610-8d82-8570e55eeeca', '859400e6-ed6a-42f8-97c3-01af96aad553', -17.71,  994.40),
  ('109f4d12-0481-4610-8d82-8570e55eeeca', 'c4811a7c-e0b2-434f-8713-db31eaf63ec9',   0.00,  900.00),
  ('109f4d12-0481-4610-8d82-8570e55eeeca', '578949c1-364d-4690-ab53-92810385b8c9',  75.42,  975.42),
  ('109f4d12-0481-4610-8d82-8570e55eeeca', '24d9baea-f2da-4f41-889d-9a5c86ded746', -57.71,  842.29),
  -- M4, 29 set
  ('dc664b5b-b627-41cc-9bc2-1b458ae85ba5', '8c513eb4-614b-4247-85f5-56b701b92b54',  11.18,  911.18),
  ('dc664b5b-b627-41cc-9bc2-1b458ae85ba5', '48e9db6c-4a37-4929-89d9-a83415c09133',  11.18,  911.18),
  ('dc664b5b-b627-41cc-9bc2-1b458ae85ba5', '4000c11f-232a-4365-99fb-8b9a8f2146ae', -61.41,  838.59),
  ('dc664b5b-b627-41cc-9bc2-1b458ae85ba5', '7da89eaa-008c-405a-b90a-a178d794c5fe',  16.07,  916.07),
  -- 1 out
  ('dab37153-2994-4a0b-bcf3-873507ec2e3d', '67e04c8a-f4f1-4422-a030-98fd22ad1e3e', -25.32,  874.68),
  -- 6 out, 18h
  ('a0a260f5-2a35-4d7b-b023-66ffb2121e17', '25dc40b4-18aa-4041-9f2d-1412f8b61fc5', -30.90,  869.10),
  -- M4, 6 out
  ('bfbecfa7-33e9-4e4b-aee2-1df43bb12ce3', '48e9db6c-4a37-4929-89d9-a83415c09133', -87.89,  823.29),
  ('bfbecfa7-33e9-4e4b-aee2-1df43bb12ce3', '4000c11f-232a-4365-99fb-8b9a8f2146ae',  28.79,  867.38),
  ('bfbecfa7-33e9-4e4b-aee2-1df43bb12ce3', '5d7b102f-d60f-48c8-bb59-4c94f218b47c',  28.79,  928.79),
  ('bfbecfa7-33e9-4e4b-aee2-1df43bb12ce3', '11c8cd25-b7ef-4726-952e-1488784f62c1',  15.47,  915.47),
  -- M3, 7 out
  ('03d94189-d9a4-48f6-a8e8-d6c5f212d8eb', '91e56872-6e0c-4e05-b432-c5239a3831f5',  47.51,  947.51),
  ('03d94189-d9a4-48f6-a8e8-d6c5f212d8eb', '907cf96b-c9b5-4ecb-ad20-ccd486f6bd53', -64.60,  835.40),
  ('03d94189-d9a4-48f6-a8e8-d6c5f212d8eb', '6855a6aa-e785-44ad-99c2-d713ed1485c0', 102.34, 1002.34),
  ('03d94189-d9a4-48f6-a8e8-d6c5f212d8eb', '3cf764e3-25bf-4b62-af39-b92e89036fad', 102.34, 1002.34),
  -- M5, 12 out
  ('8e8f9c8e-2b5b-419b-8f9a-d902ea4a33c1', '24d9baea-f2da-4f41-889d-9a5c86ded746',  -5.34,  836.95),
  ('8e8f9c8e-2b5b-419b-8f9a-d902ea4a33c1', '48e9db6c-4a37-4929-89d9-a83415c09133',  44.60,  867.89),
  -- M4, 20 out (nível não aplicado: ver o cabeçalho)
  ('0ec3c23a-faa0-44fe-afc2-84c5150e8865', '57d392f2-7eef-4653-9f0b-d5eb78abe0c1',   0.00, 1100.00),
  -- Mix M4 · Terça, 27 out
  ('f7c9d964-ee83-4fc2-817c-1303ec7c3c23', 'afb44563-35c2-416c-b12f-1e04adfc390e',  64.86,  953.78)
) AS v(game_id, user_id, delta, depois);

DO $$
DECLARE
  v_vazias INT;
  v_iguais INT;
  v_n      INT;
BEGIN
  SELECT count(*) FILTER (WHERE s.rating_delta IS NULL AND s.rating_after IS NULL),
         count(*) FILTER (WHERE s.rating_delta = n.delta AND s.rating_after = n.depois)
    INTO v_vazias, v_iguais
    FROM _nivel n JOIN mix_player_stats s ON s.game_id = n.game_id AND s.user_id = n.user_id;
  IF v_iguais = 24 THEN
    RAISE NOTICE 'já estava';
    RETURN;
  END IF;
  IF v_vazias <> 24 THEN
    RAISE EXCEPTION 'Esperava 24 linhas sem nível, encontrei % (e % já com estes valores). Parar.', v_vazias, v_iguais;
  END IF;

  UPDATE mix_player_stats s
     SET rating_delta = n.delta,
         rating_after = n.depois
    FROM _nivel n
   WHERE s.game_id = n.game_id AND s.user_id = n.user_id
     AND s.rating_delta IS NULL AND s.rating_after IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 24 THEN
    RAISE EXCEPTION 'Atualizei % linhas em vez de 24. Parar.', v_n;
  END IF;
END $$;

COMMIT;

-- Verificar depois de correr:
--   -- Só ficam sem nível as linhas de mixes amigáveis (deve dar 0):
--   SELECT count(*) FROM mix_player_stats s JOIN games g ON g.id = s.game_id
--    WHERE g.ranked AND s.rating_delta IS NULL;
--   -- O Nuno no «Mix M4 · Terça»: +64.86 e 953.78
--   SELECT rating_delta, rating_after FROM mix_player_stats
--    WHERE game_id = 'f7c9d964-ee83-4fc2-817c-1303ec7c3c23' AND user_id = 'afb44563-35c2-416c-b12f-1e04adfc390e';
