-- ═════════════════════════════════════════════════════════════════════════
-- Superadmins: a marca «é superadmin» deixa de se poder ler por outros
--
-- PORQUÊ. Opção A da BA (design-handoff/2026-10-16-superadmins-invisiveis,
-- ponto 1), aprovada pelo Francisco a 18 out: profiles.is_platform_admin
-- podia ser lido diretamente da base por quem partilha um grupo com o
-- superadmin.
--
-- O QUE FAZ
--   1. Quem é superadmin passa a ficar só em platform_admins (criada em
--      migration_superadmin_modo.sql; sem regras de leitura: só pelas funções). Para dar ou tirar
--      o superadmin: INSERT/DELETE em platform_admins (Renato ou SI).
--   2. Todas as funções que liam profiles.is_platform_admin passam a ler
--      platform_admins (as do próprio já usam is_platform_admin_me()).
--   3. As regras de leitura dos professores (teacher_profiles,
--      teacher_availability) usam is_platform_admin_me().
--   4. profiles.is_platform_admin fica FALSE para toda a gente, e um gatilho
--      não deixa voltar a pôr TRUE. A coluna fica, para a app de hoje não
--      partir, mas já não diz nada.
--
-- ORDEM. Depois de migration_superadmin_escondido.sql, de
-- migration_superadmin_modo.sql e de migration_superadmin_membro_normal.sql
-- (esta muda os filtros que aquela procura; ao contrário, a membro_normal
-- pára sem fazer nada), e SÓ DEPOIS de a app ler o superadmin pelo
-- get_my_platform_admin() (AuthContext, Bugs) no main: antes disso, os
-- superadmins deixam de ver as opções de superadmin na app.
--
-- Dev 3, 18 out 2026 · app: AuthContext (dono a definir pelo PO)
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.platform_admins') IS NULL THEN
    RAISE EXCEPTION 'Falta migration_superadmin_modo.sql. Parar.';
  END IF;
END $$;

-- Quem já é superadmin fica em platform_admins (antes de apagar a marca).
INSERT INTO platform_admins (user_id) SELECT id FROM profiles WHERE is_platform_admin
ON CONFLICT (user_id) DO NOTHING;

-- ── 1. As funções do próprio ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_platform_admin_me()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  -- Superadmin (em platform_admins) E com o modo superadmin ligado.
  SELECT COALESCE((SELECT pa.mode_on FROM platform_admins pa WHERE pa.user_id = auth.uid()), FALSE);
$function$;

CREATE OR REPLACE FUNCTION public.get_my_platform_admin()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT jsonb_build_object(
    'is_platform_admin', EXISTS (SELECT 1 FROM platform_admins pa WHERE pa.user_id = auth.uid()),
    'mode_on', COALESCE((SELECT pa.mode_on FROM platform_admins pa WHERE pa.user_id = auth.uid()), FALSE));
$function$;

CREATE OR REPLACE FUNCTION public.set_platform_admin_mode(p_on BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  UPDATE platform_admins SET mode_on = COALESCE(p_on, TRUE), updated_at = NOW() WHERE user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'not_platform_admin'; END IF;
  RETURN get_my_platform_admin();
END;
$function$;

-- O nome escondido nas ações (migration_superadmin_acoes_sem_nome.sql): só
-- platform_admins (SI, 19 out: nenhum padrão abaixo apanha «pr.is_platform_admin»).
CREATE OR REPLACE FUNCTION public.actor_is_hidden_organizer(p_actor UUID, p_game_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT p_actor IS NOT NULL AND p_game_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM platform_admins pa WHERE pa.user_id = p_actor)
     AND NOT EXISTS (SELECT 1 FROM games g JOIN memberships m ON m.organization_id = g.organization_id
                      WHERE g.id = p_game_id AND m.user_id = p_actor);
$function$;
REVOKE ALL ON FUNCTION public.actor_is_hidden_organizer(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- ── 2. As funções que olham para os outros ──────────────────────────────
DO $$
DECLARE
  r RECORD;
  v_def TEXT;
  v_new TEXT;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
     WHERE p.prokind = 'f'
       AND p.proname NOT IN ('is_platform_admin_me', 'get_my_platform_admin', 'set_platform_admin_mode')
       AND pg_get_functiondef(p.oid) ~ 'is_platform_admin([^_]|$)'
  LOOP
    v_def := replace(pg_get_functiondef(r.sig::regprocedure), E'\r', '');
    v_new := v_def;
    -- COALESCE(x.is_platform_admin, FALSE)  →  EXISTS em platform_admins
    v_new := regexp_replace(v_new, 'COALESCE\(([a-z]+)\.is_platform_admin, FALSE\)',
                            '(EXISTS (SELECT 1 FROM platform_admins pa_ WHERE pa_.user_id = \1.id))', 'g');
    -- JOIN profiles p ON p.is_platform_admin
    v_new := regexp_replace(v_new, 'JOIN profiles ([a-z]+) ON \1\.is_platform_admin\M',
                            'JOIN profiles \1 ON EXISTS (SELECT 1 FROM platform_admins pa_ WHERE pa_.user_id = \1.id)', 'g');
    -- EXISTS (SELECT 1 FROM profiles WHERE id = <x> AND is_platform_admin)
    v_new := regexp_replace(v_new, 'EXISTS \(SELECT 1 FROM profiles WHERE id = ([a-z_]+) AND is_platform_admin\)',
                            'EXISTS (SELECT 1 FROM platform_admins WHERE user_id = \1)', 'g');
    -- CASE WHEN x.is_platform_admin THEN … (o «corrigido por», migration_superadmin_escondido)
    v_new := regexp_replace(v_new, 'CASE WHEN ([a-z]+)\.is_platform_admin THEN',
                            'CASE WHEN EXISTS (SELECT 1 FROM platform_admins pa_ WHERE pa_.user_id = \1.id) THEN', 'g');
    -- CASE WHEN is_platform_admin THEN NULL ELSE name END INTO v_actor_name FROM profiles WHERE id = auth.uid()
    v_new := regexp_replace(v_new, 'CASE WHEN is_platform_admin THEN NULL ELSE name END INTO ([a-z_]+) FROM profiles WHERE id = auth\.uid\(\)',
                            'CASE WHEN EXISTS (SELECT 1 FROM platform_admins pa_ WHERE pa_.user_id = auth.uid()) THEN NULL ELSE name END INTO \1 FROM profiles WHERE id = auth.uid()', 'g');
    -- (SELECT is_platform_admin FROM profiles WHERE id = auth.uid())  (set_platform_admin_mode antiga, se sobrar)
    v_new := regexp_replace(v_new, 'COALESCE\(\(SELECT is_platform_admin FROM profiles WHERE id = auth\.uid\(\)\), FALSE\)',
                            'EXISTS (SELECT 1 FROM platform_admins WHERE user_id = auth.uid())', 'g');
    IF v_new <> v_def THEN
      EXECUTE v_new;
      RAISE NOTICE '%: lê platform_admins', r.sig;
    END IF;
  END LOOP;

  -- Não pode sobrar nenhuma função a ler a marca do perfil.
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
              WHERE p.prokind = 'f' AND p.proname NOT IN ('is_platform_admin_me', 'get_my_platform_admin', 'set_platform_admin_mode')
                AND pg_get_functiondef(p.oid) ~ '\.is_platform_admin\M|[^_.]is_platform_admin[^_]') THEN
    RAISE EXCEPTION 'Ainda há funções a ler profiles.is_platform_admin: %. Parar e ler.',
      (SELECT string_agg(p.proname, ', ') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
        WHERE p.prokind = 'f' AND p.proname NOT IN ('is_platform_admin_me', 'get_my_platform_admin', 'set_platform_admin_mode')
          AND pg_get_functiondef(p.oid) ~ '\.is_platform_admin\M|[^_.]is_platform_admin[^_]');
  END IF;
END $$;

-- ── 3. As regras dos professores ────────────────────────────────────────
ALTER POLICY "View teacher profiles" ON teacher_profiles
  USING ((status = 'approved') OR (user_id = auth.uid())
         OR ((organization_id IS NOT NULL) AND is_org_admin(organization_id))
         OR is_platform_admin_me());
ALTER POLICY "View availability with parent profile" ON teacher_availability
  USING (EXISTS (SELECT 1 FROM teacher_profiles tp
                  WHERE tp.id = teacher_availability.teacher_profile_id
                    AND ((tp.status = 'approved') OR (tp.user_id = auth.uid())
                         OR ((tp.organization_id IS NOT NULL) AND is_org_admin(tp.organization_id))
                         OR is_platform_admin_me())));

-- ── 4. A marca no perfil deixa de dizer alguma coisa ────────────────────
UPDATE profiles SET is_platform_admin = FALSE WHERE is_platform_admin;

CREATE OR REPLACE FUNCTION public.profiles_platform_admin_hidden()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  -- Quem é superadmin fica só em platform_admins (18 out).
  NEW.is_platform_admin := FALSE;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS profiles_platform_admin_hidden ON profiles;
CREATE TRIGGER profiles_platform_admin_hidden
  BEFORE INSERT OR UPDATE OF is_platform_admin ON profiles
  FOR EACH ROW WHEN (NEW.is_platform_admin)
  EXECUTE FUNCTION public.profiles_platform_admin_hidden();

COMMIT;

-- Verificar depois de correr (0, e o número de superadmins):
--   SELECT count(*) FROM profiles WHERE is_platform_admin;
--   SELECT count(*) FROM platform_admins;
