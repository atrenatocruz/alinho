-- ═════════════════════════════════════════════════════════════════════════
-- Interruptores da app: também se leem sem sessão (só o nome e o estado)
--
-- PORQUÊ. Dev 1, 18 out: a página «Parceiros» do site é pública e fica
-- atrás do interruptor «parceiros». Hoje feature_flags só se lê com sessão,
-- por isso quem não entrou nunca veria a página ligada.
--
-- O QUE FAZ. anon passa a ler só key e enabled (o updated_by, quem mudou,
-- fica de fora). A app já pede só essas duas colunas
-- (AuthContext, useFeatureFlag).
--
-- Dev 3, 18 out 2026 · ecrã: Dev 1
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

REVOKE SELECT ON public.feature_flags FROM anon;
GRANT SELECT (key, enabled) ON public.feature_flags TO anon;
DROP POLICY IF EXISTS feature_flags_select_anon ON public.feature_flags;
CREATE POLICY feature_flags_select_anon ON public.feature_flags FOR SELECT TO anon USING (true);

COMMIT;

-- Verificar depois de correr:
--   SELECT has_column_privilege('anon', 'public.feature_flags', 'enabled', 'SELECT');     -- true
--   SELECT has_column_privilege('anon', 'public.feature_flags', 'updated_by', 'SELECT');  -- false
