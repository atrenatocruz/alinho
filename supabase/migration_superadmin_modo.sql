-- ═════════════════════════════════════════════════════════════════════════
-- Superadmins: o botão «modo normal / modo superadmin»
--
-- PORQUÊ. Francisco, 18 out: «falta aquele botão para me meter em modo
-- normal ou super admin». Avança sem esperar pela aprovação do Renato
-- (decisão do Francisco, 18 out); o Renato fica informado no #dev-updates.
-- Ecrã: Bugs (o botão no topo do Gerir, e a app a ler o modo).
--
-- ANTES DESTA: migration_superadmin_escondido.sql (18 out), que já pôs o
-- superadmin a entrar nos grupos por ser superadmin (is_platform_admin_me),
-- sem precisar de inscrição.
--
-- O QUE FAZ
--   1. platform_admins (user_id, mode_on): o modo de cada superadmin.
--      LIGADO por omissão: ninguém perde o acesso enquanto o botão não
--      chega ao main. Só se lê e muda pelas funções.
--   2. is_platform_admin_me() passa a ser verdadeiro só com o modo ligado.
--      Como tudo o que dá acesso ao superadmin (as regras «Superadmin» das
--      tabelas, is_org_admin, as funções do Gerir) passa por ela, em modo
--      normal o superadmin é um jogador como os outros.
--   3. get_my_platform_admin() → {is_platform_admin, mode_on}, para a app;
--      set_platform_admin_mode(p_on) para o botão.
--   4. As funções que ainda liam profiles.is_platform_admin de quem chama
--      (criar clube, torneios, planos, conquistas, professores, apagar
--      conta…) passam a usar is_platform_admin_me(), e respeitam o modo.
--
-- Dev 3, 18 out 2026 · ecrã: Bugs (A: AuthContext; B: o botão no Gerir)
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.memberships_superadmin_acesso') IS NULL THEN
    RAISE EXCEPTION 'Falta migration_superadmin_escondido.sql. Parar.';
  END IF;
END $$;

-- ── 1. O modo ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_admins (
  user_id    UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  mode_on    BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;  -- sem regras: só pelas funções
REVOKE ALL ON platform_admins FROM PUBLIC, anon, authenticated;

INSERT INTO platform_admins (user_id)
SELECT id FROM profiles WHERE is_platform_admin
ON CONFLICT (user_id) DO NOTHING;

-- ── 2. Superadmin só com o modo ligado ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_platform_admin_me()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  -- Superadmin E com o modo superadmin ligado (Francisco, 18 out).
  SELECT COALESCE((SELECT p.is_platform_admin AND COALESCE(pa.mode_on, TRUE)
                     FROM profiles p LEFT JOIN platform_admins pa ON pa.user_id = p.id
                    WHERE p.id = auth.uid()), FALSE);
$function$;

-- ── 3. Para a app e para o botão ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_platform_admin()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT jsonb_build_object(
    'is_platform_admin', COALESCE(p.is_platform_admin, FALSE),
    'mode_on', COALESCE(p.is_platform_admin, FALSE) AND COALESCE(pa.mode_on, TRUE))
    FROM profiles p LEFT JOIN platform_admins pa ON pa.user_id = p.id
   WHERE p.id = auth.uid();
$function$;
REVOKE ALL ON FUNCTION public.get_my_platform_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_platform_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.set_platform_admin_mode(p_on BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NOT COALESCE((SELECT is_platform_admin FROM profiles WHERE id = auth.uid()), FALSE) THEN
    RAISE EXCEPTION 'not_platform_admin';
  END IF;
  INSERT INTO platform_admins (user_id, mode_on, updated_at) VALUES (auth.uid(), COALESCE(p_on, TRUE), NOW())
  ON CONFLICT (user_id) DO UPDATE SET mode_on = EXCLUDED.mode_on, updated_at = NOW();
  RETURN get_my_platform_admin();
END;
$function$;
REVOKE ALL ON FUNCTION public.set_platform_admin_mode(BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_platform_admin_mode(BOOLEAN) TO authenticated;

-- ── 4. Quem lia a marca de quem chama passa a respeitar o modo ─────────
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
       AND pg_get_functiondef(p.oid) ~ 'is_platform_admin'
  LOOP
    v_def := replace(pg_get_functiondef(r.sig::regprocedure), E'\r', '');
    v_new := v_def;
    -- EXISTS (SELECT 1 FROM profiles [x] WHERE [x.]id = auth.uid() AND [x.]is_platform_admin)
    v_new := regexp_replace(v_new,
      'EXISTS\s*\(\s*SELECT 1 FROM profiles(\s+[a-z]+)?\s+WHERE\s+([a-z]+\.)?id\s*=\s*auth\.uid\(\)\s+AND\s+([a-z]+\.)?is_platform_admin\s*\)',
      'is_platform_admin_me()', 'g');
    -- EXISTS (\n SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_platform_admin \n)
    v_new := regexp_replace(v_new,
      'SELECT 1 FROM profiles\s+([a-z]+)\s+WHERE\s+\1\.id\s*=\s*auth\.uid\(\)\s+AND\s+\1\.is_platform_admin',
      'SELECT 1 WHERE is_platform_admin_me()', 'g');
    -- COALESCE((SELECT is_platform_admin FROM profiles WHERE id = auth.uid()), FALSE)
    v_new := regexp_replace(v_new,
      'COALESCE\(\(SELECT is_platform_admin FROM profiles WHERE id = auth\.uid\(\)\), FALSE\)',
      'is_platform_admin_me()', 'g');
    -- SELECT COALESCE(is_platform_admin, FALSE) INTO v FROM profiles WHERE id = auth.uid();
    v_new := regexp_replace(v_new,
      'SELECT COALESCE\(is_platform_admin, FALSE\) INTO ([a-z_]+) FROM profiles WHERE id = auth\.uid\(\);',
      '\1 := is_platform_admin_me();', 'g');
    IF v_new <> v_def THEN
      EXECUTE v_new;
      RAISE NOTICE '%: respeita o modo', r.sig;
    END IF;
  END LOOP;
END $$;

COMMIT;

-- Verificar depois de correr (tudo true):
--   SELECT to_regclass('public.platform_admins') IS NOT NULL
--      AND (SELECT count(*) FROM platform_admins) = (SELECT count(*) FROM profiles WHERE is_platform_admin)
--      AND NOT EXISTS (SELECT 1 FROM platform_admins WHERE NOT mode_on)
--      AND pg_get_functiondef('public.is_platform_admin_me()'::regprocedure) LIKE '%mode_on%';
