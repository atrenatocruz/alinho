-- ════════════════════════════════════════════════════════════════════════
-- Fix de segurança: UPDATE de profiles passa a grants por coluna.
--
-- A policy "Users can update own profile" (schema.sql) limita a LINHA mas
-- não as COLUNAS: qualquer utilizador autenticado podia fazer UPDATE a
-- QUALQUER coluna da própria linha — incluindo is_platform_admin
-- (escalada para admin de plataforma) e, a partir do Elo v1, rating.
-- Mesmo padrão de migration_fix_membership_level_update.sql.
--
-- Standalone de propósito: pode (e deve) correr JÁ, independente do
-- rollout do Elo. Colunas adicionadas no futuro ficam automaticamente
-- protegidas — só as listadas no GRANT são editáveis pelo cliente.
-- É seguro re-correr. O service role (bot WhatsApp) não é afetado.
--
-- Correr este ficheiro inteiro no Supabase → SQL Editor.
-- ════════════════════════════════════════════════════════════════════════

REVOKE UPDATE ON profiles FROM authenticated, anon;

-- Exatamente as colunas que a app edita hoje (updateProfile em
-- AuthContext.jsx: Profile.jsx, Login.jsx, Layout.jsx).
GRANT UPDATE (name, birthday, gender, phone_hash, avatar_url, preferred_side,
              activity_visibility, results_visibility, clubs_visibility)
  ON profiles TO authenticated;
