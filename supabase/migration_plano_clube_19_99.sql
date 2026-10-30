-- ═════════════════════════════════════════════════════════════════════════
-- Plano Clube a 19,99 €/mês e 199,90 €/ano
-- Cartão #739 (https://trello.com/c/1FlEe4yt)
--
-- PORQUÊ. Planos de clube decididos pelo Francisco a 29 out (#739,
-- PROPOSTA-PM.md e design-handoff/2026-10-29-planos-de-clube/REGRAS-BA.md):
-- o Clube passa de 29,99 / 299,90 para 19,99 / 199,90.
--
-- O QUE FAZ. Só o UPDATE da linha 'club' de plan_prices. A chave 'club'
-- continua a ser o plano Clube; nada muda de nome. request_plan,
-- get_group_plan_status, process_plan_billing e admin_list_plan_renewals já
-- leem o preço desta tabela (nenhuma função tem o preço escrito; lido em
-- produção, 29 out). A migration_planos_pagos_1 insere com ON CONFLICT DO
-- NOTHING, por isso correr outra vez a antiga não desfaz este preço.
-- WHERE por causa do pg_safeupdate.
--
-- ORDEM. Qualquer. Vai no mesmo lote da página do Dev 1 (#739).
--
-- Dev 3, 29 out 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

UPDATE public.plan_prices SET monthly = 19.99, yearly = 199.90 WHERE tier = 'club';

COMMIT;

-- Verificar depois de correr:
--   SELECT tier, monthly, yearly FROM plan_prices ORDER BY monthly;
--     → plus 4.99 / 49.90 · pro 14.99 / 149.90 · club 19.99 / 199.90
