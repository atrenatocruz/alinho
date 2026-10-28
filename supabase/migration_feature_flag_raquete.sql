-- ════════════════════════════════════════════════════════════════════════
-- Migration: interruptor do «Escolhe a tua raquete» (feature flag 'raquete')
-- Run this whole file in Supabase → SQL Editor → New query → Run.
--
-- A raquete fica escondida até o Francisco a ligar (28 out 2026): sem o
-- interruptor ligado não aparece o cartão no Perfil e /perfil/raquete volta
-- ao Perfil. A app já a esconde SEM esta linha (sem linha = desligado); a
-- linha deixa o interruptor à vista, desligado, como o dos parceiros. A
-- leitura pública da tabela já existe
-- (migration_feature_flags_leitura_publica.sql).
--
-- Se a linha já existir, não lhe mexe (não desliga uma raquete já ligada).
-- Para ligar (SI, anunciado no #dev-updates):
--   UPDATE feature_flags SET enabled = true WHERE key = 'raquete';
-- Só acrescenta uma linha; não muda mais nada.
-- ════════════════════════════════════════════════════════════════════════

INSERT INTO feature_flags (key, enabled) VALUES ('raquete', false)
ON CONFLICT (key) DO NOTHING;
