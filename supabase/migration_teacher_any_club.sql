-- ═════════════════════════════════════════════════════════════════════════
-- PROFESSOR PEDE QUALQUER CLUBE; AO SER ACEITE PASSA A MEMBRO
-- (Dev 3, 25 set 2026) — cartão «#550», P0 (Francisco: «Tenho professores a
-- querer entrar»). Ecrãs: Bugs.
--
-- Pode-se correr outra vez sem estragar.
--
-- O pedido em si já aceitava qualquer CLUBE sem a pessoa ser membro (a
-- regra de inserção de `teacher_profiles`, migration_teacher_profiles_open.sql,
-- 16 set). O que faltava:
--
-- 1. `search_clubs_for_teacher(p_query)` — o ecrã só listava os clubes de
--    que a pessoa já é membro. Esta procura TODOS os clubes (kind = 'club',
--    que desde 18 set é o plano Club), pelo nome, sem ligar a acentos nem a
--    maiúsculas («almada» encontra «Smash Padel Almada», «joao» encontra
--    «João»). Devolve só o que o campo precisa: id, nome, slug, zona e logo.
--    A `search_organizations` não serve: só mostra os clubes que se deixam
--    encontrar na Comunidade, e distingue acentos.
--
-- 2. `resolve_teacher_club(p_id, p_accept, p_make_admin DEFAULT FALSE)` —
--    ao ACEITAR, o professor passa a membro do clube, se ainda não for
--    (conta para o limite de membros do plano, como os outros caminhos de
--    entrada). Com `p_make_admin`, fica também admin. Só um admin DAQUELE
--    clube pode dar admin (`is_org_admin`); aceitar continua como estava
--    (admin do clube ou equipa Alinho). Um professor nunca se torna membro
--    sem ser aceite: isto só corre no «aceitar».
--    Recusar não mexe em membros.
--
-- 3. APROVAÇÃO ÚNICA (decisão do Francisco, 25 set, pelo PO; valores
--    combinados com o Bugs, que faz os ecrãs): quem decidir primeiro — o
--    admin do clube ou a equipa Alinho — decide pelos dois lados. Aceitar:
--    status 'approved' E (com clube) club_status 'accepted' E membro.
--    Recusar: status 'rejected' E (com clube) club_status 'rejected'. Mexe
--    também em `approve_teacher_profile` e `reject_teacher_profile` (corpo
--    vivo, só o bocado novo). Ver a secção 3 em baixo.
--
--    Muda a assinatura (mais um argumento), por isso a versão antiga de dois
--    argumentos é APAGADA aqui — deixá-la criava duas funções com o mesmo
--    nome e a app deixava de conseguir chamar qualquer uma (PGRST203, foi o
--    que partiu a `mark_walkover` a 23 set, #465). O corpo novo sai do corpo
--    VIVO, com o bocado novo acrescentado, e as permissões são repostas.
-- ═════════════════════════════════════════════════════════════════════════

-- ── 1. Procurar clubes ────────────────────────────────────────────────────
-- Sem depender da extensão unaccent (pode não estar ligada): troca-se à mão
-- os acentos do português.
CREATE OR REPLACE FUNCTION search_clubs_for_teacher(p_query TEXT)
RETURNS TABLE (id UUID, name TEXT, slug TEXT, location TEXT, group_logo_url TEXT)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH q AS (
    SELECT translate(lower(trim(COALESCE(p_query, ''))),
                     'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn') AS t
  )
  SELECT o.id, o.name, o.slug, o.location, o.group_logo_url
    FROM organizations o, q
   WHERE o.kind = 'club'
     AND auth.uid() IS NOT NULL
     AND translate(lower(o.name), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn')
         LIKE '%' || q.t || '%'
   ORDER BY o.name
   LIMIT 20;
$$;

REVOKE ALL ON FUNCTION search_clubs_for_teacher(TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION search_clubs_for_teacher(TEXT) TO authenticated;

-- ── 2. Pôr o professor como membro (peça comum às duas aprovações) ──────
-- Interna: só as funções de aprovação a chamam. Passa a membro do clube que
-- o professor escolheu, se ainda não for (conta para o limite de membros do
-- plano, como os outros caminhos de entrada); com p_make_admin, fica admin.
-- Quem já era membro (até convidado) deixa de ser convidado.
CREATE OR REPLACE FUNCTION teacher_join_club(p_teacher_profile_id UUID, p_make_admin BOOLEAN DEFAULT FALSE)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org  UUID;
  v_user UUID;
  v_max  INTEGER;
BEGIN
  SELECT organization_id, user_id INTO v_org, v_user
    FROM teacher_profiles WHERE id = p_teacher_profile_id;
  IF v_org IS NULL THEN
    RETURN;   -- sem clube, não há onde entrar
  END IF;
  IF NOT EXISTS (SELECT 1 FROM memberships WHERE organization_id = v_org AND user_id = v_user) THEN
    v_max := org_max_members(v_org);
    IF v_max IS NOT NULL
       AND (SELECT COUNT(*) FROM memberships WHERE organization_id = v_org) >= v_max THEN
      RAISE EXCEPTION 'O clube já atingiu o limite de % membros do plano', v_max;
    END IF;
    INSERT INTO memberships (user_id, organization_id, is_admin)
    VALUES (v_user, v_org, COALESCE(p_make_admin, FALSE));
  ELSE
    UPDATE memberships
       SET is_guest = FALSE,
           is_admin = is_admin OR COALESCE(p_make_admin, FALSE)
     WHERE organization_id = v_org AND user_id = v_user;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION teacher_join_club(UUID, BOOLEAN) FROM public, anon, authenticated;

-- ── 3. Aprovação única (Francisco, 25 set) ───────────────────────────────
-- Quem decidir primeiro — o admin do clube escolhido ou a equipa Alinho —
-- decide pelos dois lados:
--   · aceitar → status 'approved' E (com clube) club_status 'accepted' E
--     membro do clube; dar admin é só do admin do clube;
--   · recusar → status 'rejected' E (com clube) club_status 'rejected'.
-- Sem clube, só a equipa Alinho decide, como hoje. Depois de decidido de um
-- lado, o outro já não o vê como pendente (as funções recusam «já
-- resolvido»). `teacher_profile_active` não muda: aprovado E (sem clube OU
-- aceite no clube) — as duas coisas passam a acontecer juntas, e a página
-- do professor abre logo.
DO $$
DECLARE
  -- resolve_teacher_club (admin do clube)
  c_head_mau CONSTANT TEXT := 'resolve_teacher_club\(p_id uuid, p_accept boolean\)';
  c_head_bom CONSTANT TEXT := 'resolve_teacher_club(p_id uuid, p_accept boolean, p_make_admin boolean DEFAULT false)';
  c_res_mau  CONSTANT TEXT :=
    '(UPDATE\s+teacher_profiles\s+SET\s+club_status\s*=\s*CASE\s+WHEN\s+p_accept\s+THEN\s+''accepted''\s+ELSE\s+''rejected''\s+END\s+WHERE\s+id\s*=\s*p_id;)';
  c_res_bom  CONSTANT TEXT := '\1

  -- #550: a decisão do clube é a decisão única — vale também para o
  -- status. Aceite, passa a membro (e a admin, se o admin do clube o pedir).
  IF COALESCE(p_make_admin, FALSE) AND p_accept AND NOT is_org_admin(v_org_id) THEN
    RAISE EXCEPTION ''Só um admin do clube pode dar o papel de admin'';
  END IF;
  UPDATE teacher_profiles
     SET status = CASE WHEN p_accept THEN ''approved'' ELSE ''rejected'' END,
         resolved_at = NOW(), resolved_by = auth.uid()
   WHERE id = p_id AND status = ''pending'';
  IF p_accept THEN
    PERFORM teacher_join_club(p_id, COALESCE(p_make_admin, FALSE));
  END IF;';
  -- approve_teacher_profile (equipa Alinho)
  c_apr_mau  CONSTANT TEXT :=
    '(UPDATE\s+teacher_profiles\s+SET\s+status\s*=\s*''approved'',\s*resolved_at\s*=\s*NOW\(\),\s*resolved_by\s*=\s*auth\.uid\(\)\s+WHERE\s+id\s*=\s*p_id;)';
  c_apr_bom  CONSTANT TEXT := '\1

  -- #550: aprovação única — com clube escolhido e ainda por decidir, fica
  -- também aceite nesse clube e passa a membro (sem admin).
  UPDATE teacher_profiles SET club_status = ''accepted''
   WHERE id = p_id AND organization_id IS NOT NULL AND club_status = ''pending'';
  IF FOUND THEN
    PERFORM teacher_join_club(p_id, FALSE);
  END IF;';
  -- reject_teacher_profile (equipa Alinho)
  c_rej_mau  CONSTANT TEXT :=
    '(UPDATE\s+teacher_profiles\s+SET\s+status\s*=\s*''rejected'',\s*resolved_at\s*=\s*NOW\(\),\s*resolved_by\s*=\s*auth\.uid\(\)\s+WHERE\s+id\s*=\s*p_id;)';
  c_rej_bom  CONSTANT TEXT := '\1

  -- #550: decisão única — recusado pela equipa Alinho, recusado no clube.
  UPDATE teacher_profiles SET club_status = ''rejected''
   WHERE id = p_id AND club_status = ''pending'';';
  v_oid   OID;
  v_def   TEXT;
  v_novo  TEXT;
  v_acl   ACLITEM[];
  v_owner OID;
  a       RECORD;
  f       RECORD;
BEGIN
  IF to_regprocedure('org_max_members(uuid)') IS NULL OR to_regprocedure('is_org_admin(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Faltam org_max_members ou is_org_admin. Parar e ler.';
  END IF;

  -- ── approve / reject: mesmo nome e argumentos, troca-se só o corpo ─────
  FOR f IN SELECT * FROM (VALUES
             ('approve_teacher_profile(uuid)', c_apr_mau, c_apr_bom),
             ('reject_teacher_profile(uuid)',  c_rej_mau, c_rej_bom)) AS x(fn, mau, bom) LOOP
    v_oid := to_regprocedure(f.fn);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'Não existe %. Parar e ler.', f.fn;
    END IF;
    v_def := pg_get_functiondef(v_oid);
    IF position('#550' IN v_def) > 0 THEN
      RAISE NOTICE '%: já tinha a aprovação única.', f.fn;
      CONTINUE;
    END IF;
    IF (SELECT count(*) FROM regexp_matches(v_def, f.mau, 'g')) <> 1 THEN
      RAISE EXCEPTION '% não tem a forma esperada — alguém a mudou. Ler o corpo vivo antes de correr isto.', f.fn;
    END IF;
    EXECUTE regexp_replace(v_def, f.mau, f.bom);
    RAISE NOTICE 'Corrigida: %', f.fn;
  END LOOP;

  -- ── resolve_teacher_club: ganha p_make_admin (muda a assinatura) ───────
  IF to_regprocedure('resolve_teacher_club(uuid, boolean, boolean)') IS NOT NULL THEN
    IF to_regprocedure('resolve_teacher_club(uuid, boolean)') IS NOT NULL THEN
      RAISE EXCEPTION 'Há duas resolve_teacher_club (de 2 e de 3 argumentos). Parar e ler.';
    END IF;
    RAISE NOTICE 'resolve_teacher_club: já tinha o p_make_admin.';
    RETURN;
  END IF;

  SELECT p.oid, p.proacl, p.proowner INTO v_oid, v_acl, v_owner
    FROM pg_proc p WHERE p.oid = to_regprocedure('resolve_teacher_club(uuid, boolean)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Não existe resolve_teacher_club(uuid, boolean). Parar e ler.';
  END IF;

  v_def := pg_get_functiondef(v_oid);
  IF (SELECT count(*) FROM regexp_matches(v_def, c_res_mau, 'g')) <> 1 OR v_def !~ c_head_mau THEN
    RAISE EXCEPTION 'resolve_teacher_club não tem a forma esperada — alguém a mudou. Ler o corpo vivo antes de correr isto.';
  END IF;
  v_novo := regexp_replace(v_def,  c_head_mau, c_head_bom);
  v_novo := regexp_replace(v_novo, c_res_mau,  c_res_bom);

  -- Mais um argumento = outra função: apaga-se a antiga na mesma transação,
  -- senão ficavam duas e a app deixava de conseguir chamá-las (PGRST203, #465).
  EXECUTE 'DROP FUNCTION public.resolve_teacher_club(uuid, boolean)';
  EXECUTE v_novo;

  -- Permissões: as mesmas que a antiga tinha.
  EXECUTE 'REVOKE ALL ON FUNCTION public.resolve_teacher_club(uuid, boolean, boolean) FROM PUBLIC';
  FOR a IN SELECT * FROM aclexplode(COALESCE(v_acl, acldefault('f', v_owner)))
            WHERE privilege_type = 'EXECUTE' LOOP
    IF a.grantee = 0 THEN
      EXECUTE 'GRANT EXECUTE ON FUNCTION public.resolve_teacher_club(uuid, boolean, boolean) TO PUBLIC';
    ELSE
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.resolve_teacher_club(uuid, boolean, boolean) TO %I',
                     (SELECT rolname FROM pg_roles WHERE oid = a.grantee));
    END IF;
  END LOOP;

  -- Confirmar: uma só versão, com o bocado novo.
  IF to_regprocedure('resolve_teacher_club(uuid, boolean)') IS NOT NULL
     OR position('#550' IN (SELECT prosrc FROM pg_proc
                              WHERE oid = to_regprocedure('resolve_teacher_club(uuid, boolean, boolean)'))) = 0 THEN
    RAISE EXCEPTION 'resolve_teacher_club não ficou como devia. Nada foi gravado.';
  END IF;
  RAISE NOTICE 'Corrigida: resolve_teacher_club (+ p_make_admin, aprovação única)';
END $$;

-- ═════════════════════════════════════════════════════════════════════════
-- ANTES DE CORRER, EM PRODUÇÃO (só leitura)
-- ═════════════════════════════════════════════════════════════════════════
--   SELECT p.oid::regprocedure, p.proacl
--     FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
--      AND p.proname IN ('resolve_teacher_club', 'approve_teacher_profile',
--                        'reject_teacher_profile', 'org_max_members', 'is_org_admin',
--                        'search_clubs_for_teacher', 'teacher_join_club');
-- Esperado: resolve_teacher_club(uuid,boolean), approve e reject uma só vez
-- cada; org_max_members e is_org_admin existem; as duas novas ainda não.
