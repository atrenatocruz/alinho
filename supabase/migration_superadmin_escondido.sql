-- ═════════════════════════════════════════════════════════════════════════
-- Superadmins escondidos nos grupos onde só entraram pelo acesso de
-- superadmin (P0, main de 18 out)
--
-- PORQUÊ. Francisco, 18 out, por privacidade: «Há pessoas que criaram
-- grupos e repararam que estão lá duas pessoas que não aceitaram nem
-- convidaram. Não podem ver que nós existimos lá.» Regra exata:
--   1) onde o superadmin nunca pediu acesso (entrou só pelo acesso de
--      superadmin): escondido de toda a gente;
--   2) onde pediu para entrar ou foi aceite: membro normal;
--   3) «admin» só se for mesmo admin desse grupo, nunca porque o acesso o
--      fez admin;
--   4) a marca de superadmin nunca à vista de outros.
-- Só esconder, sem apagar nada. Decisão do Francisco; o Renato fica
-- avisado (mexe no acesso de superadmin que ele fez a 23 set) e, se
-- discordar, desfaz-se (ver DESFAZER).
--
-- O CAMINHO. Há ~100 funções que leem os membros de um grupo; esconder em
-- cada uma não era seguro para hoje. Em vez disso, as inscrições que só
-- vieram do acesso saem de memberships para uma tabela à parte
-- (memberships_superadmin_acesso), com tudo o que tinham — não se apagam —,
-- e o superadmin passa a entrar nos grupos por ser superadmin, sem precisar
-- de inscrição. Assim, todas as listas, contagens, rankings, seletores,
-- perfis e avisos deixam de o ver nesses grupos de uma só vez.
--
-- O QUE FAZ
--   1. Acesso do superadmin sem inscrição (o que hoje lhe dava a inscrição
--      de admin): uma regra a mais por tabela que o Gerir usa, is_org_admin,
--      e as funções que verificavam «é admin do grupo» à mão.
--   2. As inscrições de superadmin nos grupos onde nunca jogou um mix,
--      nunca criou um mix, não está em nenhum torneio e não é dono passam
--      para memberships_superadmin_acesso (produção, 18 out: 12 de 22).
--   3. Nos grupos onde fica como membro, deixa de ser «admin» onde não é
--      dono e nunca criou um mix (o admin veio do acesso): produção, 2.
--      Continua a poder gerir esses grupos por ser superadmin.
--   4. Abrir um grupo no Gerir deixa de inscrever: só regista o acesso na
--      tabela à parte.
--   5. O nome do superadmin não vai no aviso «o mix mudou» nem no
--      «corrigido por» dos torneios (o ecrã mostra «Quem organiza»).
--   Fica para depois (precisa de ecrã): esconder a marca is_platform_admin
--   no perfil dos 10 grupos onde ele é membro a sério.
--
-- DESFAZER
--   INSERT INTO memberships (id, user_id, organization_id, is_admin, is_guest, level, created_at, is_test, is_favorite)
--   SELECT a.id, a.user_id, a.organization_id, a.is_admin, a.is_guest, a.level, a.created_at, a.is_test, a.is_favorite
--     FROM memberships_superadmin_acesso a
--    WHERE a.moved_at IS NOT NULL  -- só as que saíram de memberships (as do Gerir novas não têm)
--      AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.id = a.id OR (m.user_id = a.user_id AND m.organization_id = a.organization_id));
--   UPDATE memberships m SET is_admin = a.is_admin FROM arquivo_superadmin_admin a WHERE a.id = m.id;
--
-- Dev 3, 18 out 2026 · ecrã: nenhum muda (o «Quem organiza» onde o nome não
-- vem é dos devs de ecrã)
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. O superadmin entra nos grupos por ser superadmin ────────────────
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['games', 'participants', 'teams', 'matches', 'match_sets', 'game_guests',
                           'game_scorekeepers', 'game_recurrences', 'memberships', 'membership_requests',
                           'organization_invites', 'participant_events', 'group_matches'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Superadmin" ON %I', t);
    EXECUTE format('CREATE POLICY "Superadmin" ON %I FOR ALL TO authenticated
                      USING (is_platform_admin_me()) WITH CHECK (is_platform_admin_me())', t);
  END LOOP;
END $$;
DROP POLICY IF EXISTS "Superadmin (ler)" ON organizations;
CREATE POLICY "Superadmin (ler)" ON organizations FOR SELECT TO authenticated USING (is_platform_admin_me());
DROP POLICY IF EXISTS "Superadmin (mudar)" ON organizations;
CREATE POLICY "Superadmin (mudar)" ON organizations FOR UPDATE TO authenticated
  USING (is_platform_admin_me()) WITH CHECK (is_platform_admin_me());
DROP POLICY IF EXISTS "Superadmin (ler)" ON profiles;
CREATE POLICY "Superadmin (ler)" ON profiles FOR SELECT TO authenticated USING (is_platform_admin_me());

DO $$
DECLARE
  c_mau CONSTANT TEXT := 'WHERE child.id = p_organization_id AND m.user_id = auth.uid() AND m.is_admin';
  c_bom CONSTANT TEXT := 'WHERE child.id = p_organization_id AND m.user_id = auth.uid() AND m.is_admin'
                      || E'\n  )\n  -- O superadmin, sem estar inscrito (18 out).\n  OR is_platform_admin_me(';
  v_def TEXT := replace(pg_get_functiondef('public.is_org_admin(uuid)'::regprocedure), E'\r', '');
BEGIN
  IF position('sem estar inscrito (18 out)' IN v_def) > 0 THEN
    RAISE NOTICE 'is_org_admin: já estava';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, c_mau, ''))) / length(c_mau) <> 1 THEN
    RAISE EXCEPTION 'is_org_admin: o pedaço a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE replace(v_def, c_mau, c_bom);
END $$;

DO $$
DECLARE
  r RECORD;
  v_def TEXT;
  v_new TEXT;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.admin_redeem_voucher(uuid)'),
      ('public.admin_remove_member(uuid,uuid)'),
      ('public.admin_set_membership_admin(uuid,uuid,boolean)'),
      ('public.correct_finished_mix_match(uuid,integer,integer,uuid,jsonb)'),
      ('public.finalize_americano_mix(uuid)'),
      ('public.finalize_mix(uuid,uuid)'),
      ('public.save_mix_match_result(uuid,integer,integer,jsonb)'),
      ('public.set_event_whatsapp_post_times(text,uuid,text[])'),
      ('public.list_club_vouchers(uuid)'),
      ('public.list_club_groups(uuid)'),
      ('public.get_league_page(text)')) AS t(sig)
  LOOP
    v_def := replace(pg_get_functiondef(r.sig::regprocedure), E'\r', '');
    IF position('is_platform_admin_me() OR (' IN v_def) > 0 THEN
      RAISE NOTICE '%: já estava', r.sig;
      CONTINUE;
    END IF;
    -- «user_id = auth.uid() AND is_admin», com ou sem «m.» à frente.
    v_new := regexp_replace(v_def, '\m([a-z]+\.)?user_id = auth\.uid\(\) AND ([a-z]+\.)?is_admin\M',
                            '(is_platform_admin_me() OR (\1user_id = auth.uid() AND \2is_admin))', 'g');
    IF v_new = v_def THEN
      RAISE EXCEPTION '%: a verificação de admin não apareceu. Parar e ler.', r.sig;
    END IF;
    EXECUTE v_new;
  END LOOP;
END $$;

-- ── 2. As inscrições que só vieram do acesso saem para uma tabela à parte ─
CREATE TABLE IF NOT EXISTS memberships_superadmin_acesso (LIKE memberships INCLUDING DEFAULTS);
ALTER TABLE memberships_superadmin_acesso ADD COLUMN IF NOT EXISTS moved_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE memberships_superadmin_acesso ENABLE ROW LEVEL SECURITY;  -- sem regras: ninguém lê pela app
REVOKE ALL ON memberships_superadmin_acesso FROM PUBLIC, anon, authenticated;
CREATE UNIQUE INDEX IF NOT EXISTS memberships_superadmin_acesso_um ON memberships_superadmin_acesso (user_id, organization_id);

DO $$
DECLARE
  v_n INTEGER;
BEGIN
  CREATE TEMP TABLE _so_acesso ON COMMIT DROP AS
  SELECT m.id
    FROM memberships m
    JOIN profiles p ON p.id = m.user_id AND p.is_platform_admin
    JOIN organizations o ON o.id = m.organization_id
   WHERE o.owner_id IS DISTINCT FROM m.user_id
     AND NOT EXISTS (SELECT 1 FROM games g WHERE g.organization_id = o.id
                       AND (g.created_by = m.user_id
                            OR EXISTS (SELECT 1 FROM participants pa WHERE pa.game_id = g.id AND m.user_id IN (pa.user_id, pa.partner_id))))
     AND NOT EXISTS (SELECT 1 FROM tournament_entries e JOIN tournament_categories c ON c.id = e.category_id
                       JOIN tournaments t ON t.id = c.tournament_id
                      WHERE t.organization_id = o.id AND m.user_id IN (e.player1_id, e.player2_id));
  SELECT count(*) INTO v_n FROM _so_acesso;
  RAISE NOTICE 'Inscrições só de acesso: %', v_n;
  INSERT INTO memberships_superadmin_acesso (id, user_id, organization_id, is_admin, is_guest, level, created_at, is_test, is_favorite)
  SELECT m.id, m.user_id, m.organization_id, m.is_admin, m.is_guest, m.level, m.created_at, m.is_test, m.is_favorite
    FROM memberships m WHERE m.id IN (SELECT id FROM _so_acesso)
  ON CONFLICT (user_id, organization_id) DO NOTHING;
  DELETE FROM memberships WHERE id IN (SELECT id FROM _so_acesso);
END $$;

-- ── 3. «Admin» só onde é mesmo admin ────────────────────────────────────
CREATE TABLE IF NOT EXISTS arquivo_superadmin_admin AS
SELECT m.id, m.user_id, m.organization_id, m.is_admin, NOW() AS guardado_em
  FROM memberships m JOIN profiles p ON p.id = m.user_id AND p.is_platform_admin;
ALTER TABLE arquivo_superadmin_admin ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON arquivo_superadmin_admin FROM PUBLIC, anon, authenticated;

UPDATE memberships m SET is_admin = FALSE
  FROM profiles p, organizations o
 WHERE p.id = m.user_id AND p.is_platform_admin AND o.id = m.organization_id
   AND m.is_admin
   AND o.owner_id IS DISTINCT FROM m.user_id
   AND NOT EXISTS (SELECT 1 FROM games g WHERE g.organization_id = o.id AND g.created_by = m.user_id);

-- ── 4. Abrir um grupo no Gerir já não inscreve ─────────────────────────
CREATE OR REPLACE FUNCTION public.platform_admin_ensure_org_access(p_organization_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NOT is_platform_admin_me() THEN
    RAISE EXCEPTION 'Apenas super admins podem aceder a qualquer clube';
  END IF;
  -- Já não inscreve o superadmin no grupo (Francisco, 18 out): só regista o
  -- acesso à parte. O acesso vem de ser superadmin (is_platform_admin_me).
  IF NOT EXISTS (SELECT 1 FROM memberships WHERE organization_id = p_organization_id AND user_id = auth.uid()) THEN
    INSERT INTO memberships_superadmin_acesso (id, user_id, organization_id, is_admin, moved_at)
    VALUES (gen_random_uuid(), auth.uid(), p_organization_id, TRUE, NULL)
    ON CONFLICT (user_id, organization_id) DO NOTHING;
  END IF;
END;
$function$;

-- ── 5. O nome dele não vai nos avisos nem no «corrigido por» ───────────
DO $$
DECLARE
  c_marca CONSTANT TEXT := 'superadmin não dá o nome (18 out)';
  r RECORD;
  v_def TEXT;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.notify_mix_changes(uuid,jsonb)',
       'SELECT name INTO v_actor_name FROM profiles WHERE id = auth.uid();',
       'SELECT CASE WHEN is_platform_admin THEN NULL ELSE name END INTO v_actor_name FROM profiles WHERE id = auth.uid();  -- ' || c_marca),
      ('public.list_tournament_matches_to_score(uuid,date)',
       'cp.name AS corrected_by_name,',
       'CASE WHEN cp.is_platform_admin THEN NULL ELSE cp.name END AS corrected_by_name,  -- ' || c_marca || E'\n')
    ) AS t(sig, mau, bom)
  LOOP
    v_def := replace(pg_get_functiondef(r.sig::regprocedure), E'\r', '');
    IF position(c_marca IN v_def) > 0 THEN
      RAISE NOTICE '%: já estava', r.sig;
      CONTINUE;
    END IF;
    IF (length(v_def) - length(replace(v_def, r.mau, ''))) / length(r.mau) <> 1 THEN
      RAISE EXCEPTION '%: o pedaço a trocar não aparece 1 vez. Parar e ler.', r.sig;
    END IF;
    EXECUTE replace(v_def, r.mau, r.bom);
  END LOOP;
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT count(*) FROM memberships m JOIN profiles p ON p.id = m.user_id WHERE p.is_platform_admin;   -- produção: 10
--   SELECT count(*) FROM memberships_superadmin_acesso;                                                -- produção: 12
--   SELECT count(*) FROM memberships m JOIN profiles p ON p.id = m.user_id WHERE p.is_platform_admin AND m.is_admin;  -- produção: 8
--   SELECT pg_get_functiondef('public.platform_admin_ensure_org_access(uuid)'::regprocedure) NOT LIKE '%INSERT INTO memberships (%';  -- true
