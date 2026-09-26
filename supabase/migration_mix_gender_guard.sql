-- ═════════════════════════════════════════════════════════════════════════
-- ⚠️ SUBSTITUÍDO — este ficheiro já não cria a trava do sexo nos mixes.
--
-- A versão de cc4c706 (26 set) criava o trigger participants_gender_guard,
-- que recusava inscrições com o sexo errado para o mix. Nunca correu em
-- produção. Decisão final do Francisco, 26 set, 02h: o sexo NUNCA bloqueia,
-- nem nos mixes nem nos torneios — o admin tira a pessoa se vir que não é
-- para ali, e a app só pergunta «tens a certeza?» (ecrã, Dev 2).
--
-- Agora este ficheiro só garante que a trava não existe (se alguém tiver
-- corrido a versão antiga). A policy de inscrição sem o sexo está em
-- migration_mix_join_policy_sem_sexo.sql.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS participants_gender_guard_trigger ON public.participants;
DROP FUNCTION IF EXISTS public.participants_gender_guard();
