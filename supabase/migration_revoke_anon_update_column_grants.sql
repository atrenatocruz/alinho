-- ════════════════════════════════════════════════════════════════════════
-- Fix de segurança (defesa em profundidade): o papel `anon` (visitante sem
-- sessão) deixa de ter UPDATE nas tabelas que só aceitam UPDATE por coluna.
--
-- Achado a 18 set 2026 em produção (information_schema.column_privileges):
-- `anon` tinha UPDATE em TODAS as colunas de organizations — incluindo
-- plan_tier, kind, owner_id, self_serve — enquanto `authenticated` só tem a
-- lista curta. As migrações que fecharam as colunas só fizeram REVOKE/GRANT
-- para authenticated e deixaram o grant por omissão do Supabase ao anon:
--   organizations    — migration_self_serve_groups.sql §7
--   memberships      — schema.sql / migration_fix_membership_level_update.sql
--   teacher_profiles — migration_teacher_profiles.sql
-- (profiles já estava bem: migration_fix_profiles_column_grants.sql revoga
-- aos dois papéis.)
--
-- Hoje NÃO é explorável: todas as policies de UPDATE destas tabelas exigem
-- auth.uid() (org admin / dono da linha), e para o anon auth.uid() é NULL,
-- por isso o UPDATE afeta 0 linhas. Mas a proteção das colunas ficava a
-- depender só do RLS — bastava uma policy futura mais larga (ex. "USING
-- (true)" ou baseada noutra coluna) para o anon poder escrever plan_tier.
-- Isto alinha o anon com o authenticated: sem UPDATE direto nenhum.
--
-- Não afeta:
--   - utilizadores com sessão, incluindo convidados (Supabase anonymous
--     sign-in usa o papel `authenticated`, não `anon`);
--   - RPCs SECURITY DEFINER (correm como dono da tabela);
--   - o bot WhatsApp (service role).
-- REVOKE ao nível da tabela também retira os grants por coluna. É seguro
-- re-correr.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

REVOKE UPDATE ON organizations    FROM anon;
REVOKE UPDATE ON memberships      FROM anon;
REVOKE UPDATE ON teacher_profiles FROM anon;

-- ── Verificação (deve devolver 0 linhas): ─────────────────────────────────
-- SELECT table_name, column_name
-- FROM information_schema.column_privileges
-- WHERE grantee = 'anon' AND privilege_type = 'UPDATE'
--   AND table_schema = 'public'
--   AND table_name IN ('organizations', 'memberships', 'teacher_profiles', 'profiles');
