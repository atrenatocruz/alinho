-- ════════════════════════════════════════════════════════════════════════
-- Migration: interruptor de «Quem vende os planos» (feature flag 'vendedor_planos')
-- Run this whole file in Supabase → SQL Editor → New query → Run.
--
-- Os Termos ganham «Quem vende os planos» e a Privacidade «Pagamentos e
-- faturas» (texto das Finanças e do Copywriter, 29 out 2026;
-- design-handoff/2026-10-29-vendedor-dos-planos). Ficam escondidas até o
-- Renato confirmar por escrito a atividade aberta. A app já as esconde SEM
-- esta linha (sem linha = desligado); a linha deixa o interruptor à vista,
-- desligado, como o da raquete. A leitura pública da tabela já existe
-- (migration_feature_flags_leitura_publica.sql).
--
-- Se a linha já existir, não lhe mexe (não desliga um interruptor já ligado).
-- Para ligar (SI, anunciado no #dev-updates, com o sim escrito do Renato):
--   UPDATE feature_flags SET enabled = true WHERE key = 'vendedor_planos';
-- No mesmo main tem de ir o commit que sobe o POLICY_VERSION e o PRIVACY_UPDATED (src/lib/contacts.js)
-- para o dia em que se liga: é isso que volta a pedir o aceite a toda a gente.
-- Só acrescenta uma linha; não muda mais nada.
-- ════════════════════════════════════════════════════════════════════════

INSERT INTO feature_flags (key, enabled) VALUES ('vendedor_planos', false)
ON CONFLICT (key) DO NOTHING;
