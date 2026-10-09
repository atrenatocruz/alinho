-- ═════════════════════════════════════════════════════════════════════════
-- Mensagens novas do robô: o interruptor não gravava («Não foi possível
-- mudar. Tenta outra vez.»)
--
-- PORQUÊ. A organizations tem UPDATE por coluna desde a
-- migration_self_serve_groups.sql (REVOKE UPDATE ... FROM authenticated +
-- GRANT UPDATE (lista) ...). A migration_robo_mensagens_novas.sql criou a
-- coluna whatsapp_new_messages mas não a juntou à lista, por isso o
-- .update({ whatsapp_new_messages }) do RobotMessagesSwitch dava
-- «permission denied for table organizations» (42501). Visto em produção
-- a 3 out 2026, logo a seguir ao dev → main.
--
-- O QUE FAZ. Só o GRANT da coluna. Quem a pode mudar continua a ser
-- decidido pela trava organizations_whatsapp_new_messages_guard (só super
-- admin) e pela policy de UPDATE da organizations (admin do clube) — o
-- GRANT não alarga nada disso.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run
-- (produção e alinho-dev).
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

GRANT UPDATE (whatsapp_new_messages) ON organizations TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT has_column_privilege('authenticated', 'public.organizations', 'whatsapp_new_messages', 'UPDATE');  -- true
--   SELECT has_column_privilege('anon', 'public.organizations', 'whatsapp_new_messages', 'UPDATE');           -- false
