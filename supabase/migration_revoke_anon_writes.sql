-- ════════════════════════════════════════════════════════════════════════
-- Fix de segurança (defesa em profundidade): o papel `anon` (visitante sem
-- sessão) deixa de poder escrever em qualquer tabela de public — INSERT,
-- UPDATE, DELETE e TRUNCATE. Generaliza
-- migration_revoke_anon_update_column_grants.sql (só UPDATE em 3 tabelas).
-- PROPOSTA, a validar pelo Renato antes de correr.
--
-- Verificado em produção a 18 set 2026 (só leituras):
--   - anon tem INSERT/UPDATE/DELETE/TRUNCATE em 28 das 30 tabelas de public
--     (grant por omissão do Supabase; exceções: notifications e o UPDATE de
--     profiles, já revogados por migrações anteriores);
--   - RLS ligado nas 30; as 27 policies de escrita que se aplicam a anon
--     exigem todas auth.uid() (direto ou via is_org_admin) → hoje nada
--     passa pela API;
--   - TRUNCATE não é controlado por RLS. Não há caminho para o anon o usar
--     (PostgREST não expõe TRUNCATE, o anon não faz login direto na BD),
--     mas é o único privilégio de escrita que não depende das policies.
--     O mesmo vale para `authenticated` (TRUNCATE nas 30), revogado também;
--   - os privilégios por omissão (pg_default_acl, dono postgres) dão
--     arwdDxtm ao anon em cada tabela nova → sem o §2 o problema voltava a
--     cada migração que crie uma tabela.
--
-- Não afeta:
--   - SELECT do anon (Landing, páginas públicas continuam a ler);
--   - utilizadores com sessão, incluindo convidados (anonymous sign-in usa
--     `authenticated`) — continuam com INSERT/UPDATE/DELETE como hoje;
--   - RPCs SECURITY DEFINER (correm como dono da tabela), incluindo as que
--     o anon pode chamar;
--   - bot WhatsApp e edge functions (service role).
-- Confirmado no código (src/): todas as escritas diretas em tabelas
-- (.insert/.update/.upsert/.delete) estão em ecrãs que exigem sessão;
-- as páginas públicas (Landing, Login, esqueci/redefinir password,
-- instruções, privacidade, termos, mix offline) não escrevem em tabelas.
--
-- É seguro re-correr.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Tabelas que já existem ────────────────────────────────────────────
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM authenticated;

-- ── 2. Tabelas criadas no futuro (pelo papel postgres, que é o dono de
--       todas as tabelas de public e o papel do SQL Editor) ──────────────
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE ON TABLES FROM authenticated;

-- ── Verificação (deve devolver 0 linhas): ─────────────────────────────────
-- SELECT c.relname,
--   has_table_privilege('anon', c.oid, 'INSERT')   AS anon_insert,
--   has_table_privilege('anon', c.oid, 'UPDATE')   AS anon_update,
--   has_table_privilege('anon', c.oid, 'DELETE')   AS anon_delete,
--   has_table_privilege('anon', c.oid, 'TRUNCATE') AS anon_truncate,
--   has_table_privilege('authenticated', c.oid, 'TRUNCATE') AS auth_truncate
-- FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
--   AND (has_table_privilege('anon', c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE')
--        OR has_table_privilege('authenticated', c.oid, 'TRUNCATE'));
