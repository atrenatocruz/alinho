-- ═════════════════════════════════════════════════════════════════════════
-- Colunas de profiles que a app lê diretamente (#772, passo B)
--
-- NÃO CORRER AINDA. Proposta, por acordar com o Renato: a versão da app das lojas tem
-- de sair antes com o passo A. Produção só com o «corre» do Francisco dado ao SI.
--
-- ORDEM: depois de migration_770_fecho_perfis_sem_sessao.sql e de
-- migration_772_o_meu_perfil.sql, e com o código do passo A já no main e na loja.
--
-- O QUE MUDA. Lidas diretamente, ficam estas colunas: id, name, avatar_url, gender,
-- preferred_side, rating, rating_games, xp, last_played_at. O resto de cada perfil vem
-- de get_my_profile (o próprio) e das funções que já existem. As linhas são as mesmas:
-- ninguém desaparece de nenhuma lista.
--
-- A APP ANTIGA. Quem ainda pedir o próprio perfil à tabela deixa de conseguir entrar
-- até atualizar: no site basta recarregar a página, na loja é preciso a versão nova.
-- É a exceção à regra de 20 out («só acrescentar»), por acordar com o Renato.
--
-- organizations: a regra lia profiles.is_platform_admin, que está sempre a falso desde
-- 18 out (gatilho profiles_platform_admin_hidden). Quem é superadmin vê as organizações
-- pela regra «Superadmin (ler)». Tirar a leitura não muda o que ninguém vê.
--
-- Para desfazer:
--   GRANT SELECT ON public.profiles TO anon, authenticated;
--   ALTER POLICY "Members can view their organizations, platform admins view all"
--     ON public.organizations USING (
--       EXISTS (SELECT 1 FROM memberships WHERE memberships.organization_id = organizations.id
--                 AND memberships.user_id = auth.uid())
--       OR EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_platform_admin)
--     );
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  v_roles text[];
BEGIN
  IF to_regprocedure('public.get_my_profile()') IS NULL THEN
    RAISE EXCEPTION 'Falta o passo A: migration_772_o_meu_perfil.sql';
  END IF;

  SELECT roles::text[] INTO v_roles FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'profiles'
     AND policyname = 'See own profile, org-mates, or global-org members';
  IF v_roles IS DISTINCT FROM ARRAY['authenticated'] THEN
    RAISE EXCEPTION 'Falta migration_770_fecho_perfis_sem_sessao.sql: %', v_roles;
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE is_platform_admin) THEN
    RAISE EXCEPTION 'Há perfis com is_platform_admin a verdadeiro: parar e rever';
  END IF;
END $$;

ALTER POLICY "Members can view their organizations, platform admins view all"
  ON public.organizations
  USING (
    EXISTS (
      SELECT 1 FROM public.memberships
       WHERE memberships.organization_id = organizations.id
         AND memberships.user_id = auth.uid()
    )
  );

REVOKE SELECT ON public.profiles FROM PUBLIC;
REVOKE SELECT ON public.profiles FROM anon;
REVOKE SELECT ON public.profiles FROM authenticated;

-- Também a anon: as regras não lhe mostram nenhuma linha, e assim quem pede um nome
-- junto com outra tabela, sem sessão, recebe vazio em vez de um erro.
GRANT SELECT (id, name, avatar_url, gender, preferred_side, rating, rating_games, xp, last_played_at)
  ON public.profiles TO anon;
GRANT SELECT (id, name, avatar_url, gender, preferred_side, rating, rating_games, xp, last_played_at)
  ON public.profiles TO authenticated;

DO $$
DECLARE
  v_col record;
  v_ok text[] := ARRAY['id','name','avatar_url','gender','preferred_side','rating','rating_games','xp','last_played_at'];
BEGIN
  FOR v_col IN
    SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'profiles'
  LOOP
    IF has_column_privilege('authenticated', 'public.profiles', v_col.column_name, 'SELECT')
       IS DISTINCT FROM (v_col.column_name = ANY (v_ok))
       OR has_column_privilege('anon', 'public.profiles', v_col.column_name, 'SELECT')
       IS DISTINCT FROM (v_col.column_name = ANY (v_ok)) THEN
      RAISE EXCEPTION 'Coluna % ficou com a permissão errada', v_col.column_name;
    END IF;
  END LOOP;
END $$;

COMMIT;
