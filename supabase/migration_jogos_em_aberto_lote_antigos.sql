-- ═════════════════════════════════════════════════════════════════════════
-- Jogos em aberto antigos: cada um passa a ter o seu lote
--
-- PORQUÊ. Revisão do #586 pelo Dev 1 (AUDITORIA-12-OUT-dev1.md, jogo em
-- aberto 1): os jogos em aberto anteriores aos lotes (open_batch_id) só
-- tinham «Cancelar», sem «Editar». Proposta aprovada pelo PO a 12 out.
-- Em produção não há nenhum (a 13 out o único jogo em aberto já tem lote);
-- o caso existe nos dados de teste.
--
-- O QUE FAZ. Cada jogo em aberto sem lote fica com um lote só dele
-- (open_batch_id = id). O Editar de hoje passa a servir também para esses,
-- como um lote de um jogo. Pode correr-se de novo sem mudar nada.
--
-- Dev 3, 13 out 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

UPDATE games SET open_batch_id = id
 WHERE origin = 'open_slot' AND open_batch_id IS NULL;

COMMIT;

-- Verificar depois de correr:
--   SELECT count(*) FROM games WHERE origin = 'open_slot' AND open_batch_id IS NULL;  -- 0
