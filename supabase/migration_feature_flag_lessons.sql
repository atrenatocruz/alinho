-- ════════════════════════════════════════════════════════════════════════
-- Migration: interruptor das aulas (feature flag 'lessons')
-- Run this whole file in Supabase → SQL Editor → New query → Run.
--
-- As aulas ficam escondidas até depois do Smash Cup (Francisco, 24 set
-- 2026): clubes e jogadores não as veem; a equipa Alinho (is_platform_admin)
-- continua a vê-las. A app já as esconde SEM esta linha (sem linha =
-- desligado). Esta migração só existe para o interruptor do painel da app
-- (Gerir → Funcionalidades da app) funcionar: o admin_set_feature_flag só
-- muda linhas que já existem.
--
-- Se a linha já existir, fica desligada — é isso que se quer agora.
-- Para voltar a mostrar as aulas: o interruptor no painel, ou
--   UPDATE feature_flags SET enabled = true WHERE key = 'lessons';
-- Não apaga nem muda nada das aulas.
-- ════════════════════════════════════════════════════════════════════════

INSERT INTO feature_flags (key, enabled) VALUES ('lessons', false)
ON CONFLICT (key) DO UPDATE SET enabled = false, updated_at = now();
