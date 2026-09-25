-- ═══════════════════════════════════════════════════════════════════════
-- Professores — decisão B: quem aprova um pedido de professor
-- (Dev 4, 26 set 2026; decisão do Francisco a 25 set; plano aprovado por ele.)
--
-- A regra:
--   · COM clube: decide só o clube (resolve_teacher_club, admin do clube).
--     Aceitar aprova o professor e põe-no como membro; recusar recusa-o.
--   · SEM clube: decide só a equipa Alinho (approve_/reject_teacher_profile).
--     A prova (diploma ou estágio, #320) vem numa migração à parte, depois do
--     sim do Renato ao bucket privado.
--   · Acaba a «aprovação única, por quem aceitar primeiro» do #550: deixa de
--     haver corrida entre o clube e a equipa Alinho.
--
-- ESCRITA A PARTIR DO CORPO VIVO de produção, lido pelo PO a 25 set ~22h
-- (Alinho/Infraestrutura/2026-09-25-corpos-vivos-professores.sql). O passo 0
-- pára se algum corpo tiver mudado desde então. Em relação ao corpo vivo:
--   approve_teacher_profile — pára se o pedido tiver clube; sai o bloco que
--       aceitava também no clube e metia como membro.
--   reject_teacher_profile  — pára se o pedido tiver clube; sai o bloco que
--       recusava também no clube.
--   resolve_teacher_club    — sai o atalho da equipa Alinho (is_platform_admin):
--       só o admin do clube decide. O resto fica igual: a decisão do clube
--       vale para o status, e aceitar chama teacher_join_club(p_id, p_make_admin).
--       A assinatura (3 argumentos) não muda.
--   teacher_join_club       — não muda.
--
-- ⚠️ ANTES DE CORRER (System Integrator), ver os pedidos que mudam de dono.
-- Pedidos COM clube ainda à espera: a partir daqui só o clube os decide.
--   SELECT tp.id, p.name, o.name AS clube, tp.status, tp.club_status, tp.created_at
--     FROM teacher_profiles tp JOIN profiles p ON p.id = tp.user_id
--     JOIN organizations o ON o.id = tp.organization_id
--    WHERE tp.club_status = 'pending' ORDER BY tp.created_at;
--
-- Depende de: migration_teacher_any_club.sql (#550), já corrida.
-- Quem corre: o System Integrator, com o «corre» do Francisco, anunciado no
-- #dev-updates. Nenhum dev corre isto.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 0. O corpo vivo tem de ser o que foi lido a 25 set ─────────────────
DO $$
DECLARE
  v_expected CONSTANT jsonb := jsonb_build_object(
    'approve_teacher_profile', '6dad47f26c8d5babb47e1896b778913c',
    'reject_teacher_profile',  '01ed2a234f34172502e40f5cf6ed03a2',
    'resolve_teacher_club',    'faf6c01bfb42e342269efd2d321fabec');
  r record;
BEGIN
  FOR r IN
    SELECT p.proname, md5(p.prosrc) AS h
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('approve_teacher_profile', 'reject_teacher_profile', 'resolve_teacher_club')
  LOOP
    IF r.h <> v_expected->>r.proname THEN
      RAISE EXCEPTION 'O corpo vivo de % mudou desde 25 set (md5 %). Não correr: avisar o Dev 4.', r.proname, r.h;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname IN ('approve_teacher_profile', 'reject_teacher_profile', 'resolve_teacher_club')) <> 3 THEN
    RAISE EXCEPTION 'Esperava uma só versão de cada função. Não correr: avisar o Dev 4.';
  END IF;
END $$;

-- ── 1. Equipa Alinho: só pedidos SEM clube ──────────────────────────────
CREATE OR REPLACE FUNCTION public.approve_teacher_profile(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM teacher_profiles WHERE id = p_id AND status = 'pending') THEN
    RAISE EXCEPTION 'Pedido não encontrado ou já resolvido';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_platform_admin) THEN
    RAISE EXCEPTION 'Só a equipa Alinho pode aprovar pedidos de professor';
  END IF;
  -- Decisão B (Francisco, 25 set): com clube, decide o clube.
  IF EXISTS (SELECT 1 FROM teacher_profiles WHERE id = p_id AND organization_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Este pedido tem clube: quem decide é o clube';
  END IF;

  UPDATE teacher_profiles
  SET status = 'approved', resolved_at = NOW(), resolved_by = auth.uid()
  WHERE id = p_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reject_teacher_profile(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM teacher_profiles WHERE id = p_id AND status = 'pending') THEN
    RAISE EXCEPTION 'Pedido não encontrado ou já resolvido';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_platform_admin) THEN
    RAISE EXCEPTION 'Só a equipa Alinho pode recusar pedidos de professor';
  END IF;
  -- Decisão B (Francisco, 25 set): com clube, decide o clube.
  IF EXISTS (SELECT 1 FROM teacher_profiles WHERE id = p_id AND organization_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Este pedido tem clube: quem decide é o clube';
  END IF;

  UPDATE teacher_profiles
  SET status = 'rejected', resolved_at = NOW(), resolved_by = auth.uid()
  WHERE id = p_id;
END;
$function$;

-- ── 2. Clube: só pedidos COM clube, e só o admin do clube ──────────────
CREATE OR REPLACE FUNCTION public.resolve_teacher_club(p_id uuid, p_accept boolean, p_make_admin boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT organization_id INTO v_org_id
  FROM teacher_profiles WHERE id = p_id AND club_status = 'pending';
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Pedido não encontrado ou já resolvido';
  END IF;
  -- Decisão B (Francisco, 25 set): com clube, decide só o clube.
  IF NOT is_org_admin(v_org_id) THEN
    RAISE EXCEPTION 'Só os admins do clube podem aceitar professores';
  END IF;

  UPDATE teacher_profiles
  SET club_status = CASE WHEN p_accept THEN 'accepted' ELSE 'rejected' END
  WHERE id = p_id;

  -- A decisão do clube vale também para o status. Aceite, passa a membro
  -- (e a admin, se o admin do clube o pedir).
  UPDATE teacher_profiles
     SET status = CASE WHEN p_accept THEN 'approved' ELSE 'rejected' END,
         resolved_at = NOW(), resolved_by = auth.uid()
   WHERE id = p_id AND status = 'pending';
  IF p_accept THEN
    PERFORM teacher_join_club(p_id, COALESCE(p_make_admin, FALSE));
  END IF;
END;
$function$;

-- ── 3. Permissões: explícitas (o Supabase dá EXECUTE a anon por omissão) ─
REVOKE EXECUTE ON FUNCTION public.approve_teacher_profile(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reject_teacher_profile(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.resolve_teacher_club(uuid, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_teacher_profile(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_teacher_profile(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_teacher_club(uuid, boolean, boolean) TO authenticated;

COMMIT;

-- ── Verificação (depois de correr) ──────────────────────────────────────
-- 1) Uma só versão de cada, e anon sem EXECUTE:
--   SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
--          has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND p.proname IN ('approve_teacher_profile', 'reject_teacher_profile', 'resolve_teacher_club');
--   → 3 linhas, anon_exec = false.
-- 2) A regra está no corpo:
--   SELECT proname, position('decide o clube' in prosrc) > 0 OR position('decide só o clube' in prosrc) > 0 AS regra_b
--     FROM pg_proc WHERE proname IN ('approve_teacher_profile', 'reject_teacher_profile', 'resolve_teacher_club');
--   → as 3 com regra_b = true.
