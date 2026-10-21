-- ═════════════════════════════════════════════════════════════════════════
-- Superadmins: onde entraram a sério, aparecem como membros normais
--
-- PORQUÊ. Regra do Francisco, 18 out: «grupos onde pediu para entrar ou foi
-- aceite: aparece como membro normal, sem nada que diga superadmin». A
-- invisibilidade de 23 set (Renato) escondia os superadmins de TODAS as
-- listas de membros e contagens, também dos grupos onde jogam (QA, 18 out:
-- no Domingão e no Boavista, «4 membros» com 5 inscrições). Depois de
-- migration_superadmin_escondido.sql, os superadmins só estão inscritos onde
-- entraram a sério, por isso o filtro já não é preciso.
--
-- O QUE FAZ
--   · list_organization_members: deixa de tirar os superadmins da lista.
--   · org_visible_member_count: deixa de os tirar da contagem.
--   Corpos VIVOS, 1 troca em cada («já estava»).
--   Ecrã (à parte): GerirClube.jsx também os tira (linhas ~1136 e ~1173).
--
-- ORDEM. Depois de migration_superadmin_escondido.sql e de
-- migration_superadmin_modo.sql.
--
-- Dev 3, 18 out 2026 · ecrã: GerirClube (dono a definir pelo PO)
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  c_marca CONSTANT TEXT := 'aparece onde é membro a sério (18 out)';
  r RECORD;
  v_def TEXT;
  v_new TEXT;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.list_organization_members(uuid)',
       'AND \(NOT COALESCE\(p\.is_platform_admin, FALSE\)\s+OR (is_platform_admin_me\(\)|EXISTS \(SELECT 1 FROM profiles me WHERE me\.id = auth\.uid\(\) AND me\.is_platform_admin\))\)'),
      ('public.org_visible_member_count(uuid)',
       'AND NOT COALESCE\(p\.is_platform_admin, FALSE\)')
    ) AS t(sig, padrao)
  LOOP
    v_def := replace(pg_get_functiondef(r.sig::regprocedure), E'\r', '');
    IF position(c_marca IN v_def) > 0 THEN
      RAISE NOTICE '%: já estava', r.sig;
      CONTINUE;
    END IF;
    v_new := regexp_replace(v_def, r.padrao, '/* o superadmin ' || c_marca || ' */', 'g');
    IF v_new = v_def THEN
      RAISE EXCEPTION '%: o filtro dos superadmins não apareceu. Parar e ler.', r.sig;
    END IF;
    EXECUTE v_new;
  END LOOP;
END $$;

COMMIT;

-- Verificar depois de correr (2):
--   SELECT count(*) FROM pg_proc WHERE proname IN ('list_organization_members', 'org_visible_member_count')
--      AND pg_get_functiondef(oid) LIKE '%aparece onde é membro a sério (18 out)%';
