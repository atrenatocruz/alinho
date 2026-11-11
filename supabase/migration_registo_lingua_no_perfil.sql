-- ═════════════════════════════════════════════════════════════════════════
-- Registo: a língua escolhida no ecrã fica no perfil desde o primeiro minuto
--
-- PORQUÊ. Os emails do login (Supabase Auth) só leem os metadados da conta,
-- e o Dev 4 vai mandar a língua lá (data.lang) no registo e mantê-la igual à
-- do perfil (perfil → metadados). Mas o perfil nascia sempre em 'pt' (o
-- handle_new_user não a lia): quem se registava em espanhol ficava com o
-- perfil em português, a app acertava os metadados pelo perfil e os emails
-- voltavam a sair em português. Agora o perfil nasce com a língua do registo,
-- e é ele que manda.
--
-- O QUE FAZ. handle_new_user grava profiles.language a partir de
-- raw_user_meta_data->>'lang': 'pt', 'en' ou 'es' (sem distinguir maiúsculas
-- nem espaços); vazio ou qualquer outra coisa fica 'pt', como hoje. O resto
-- do registo fica igual. Os metadados são escritos pela própria pessoa: só
-- servem para a língua, nunca para permissões.
--
-- A APP ANTIGA não manda lang: fica 'pt', como hoje.
--
-- ORDEM. Não depende de outras. Pode correr antes ou depois do código do
-- Dev 4 (sem ela, quem se regista em espanhol fica como hoje).
--
-- Para desfazer: voltar a pôr o corpo anterior (md5 sem \r 1c31ee23…, igual
-- ao de migration_pais_onde_vives.sql).
--
-- Dev 3, 11 nov 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  v_md5 TEXT := (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc
                  WHERE oid = 'public.handle_new_user()'::regprocedure);
BEGIN
  -- Corre por cima do corpo de 11 nov (md5 1c31ee23…) ou de si mesmo. Outro
  -- corpo quer dizer que alguém o mudou entretanto: parar e ler.
  IF v_md5 <> '1c31ee2386bf40b22c0950a3ce1c0d37'
     AND position('língua do registo (Dev 3, 11 nov)' IN
                  (SELECT prosrc FROM pg_proc WHERE oid = 'public.handle_new_user()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'handle_new_user mudou (md5 %). Parar e ler antes de correr.', v_md5;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, name, email, birthday, gender, country, language)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', 'Novo Utilizador'),
    COALESCE(NEW.email, ''),
    COALESCE((NEW.raw_user_meta_data->>'birthday')::date, NULL),
    COALESCE(NEW.raw_user_meta_data->>'gender', NULL),
    COALESCE(NULLIF(upper(btrim(NEW.raw_user_meta_data->>'country')), ''), 'PT'),
    -- A língua do registo (Dev 3, 11 nov): só pt, en ou es; o resto fica pt.
    CASE WHEN lower(btrim(COALESCE(NEW.raw_user_meta_data->>'lang', ''))) IN ('pt', 'en', 'es')
         THEN lower(btrim(NEW.raw_user_meta_data->>'lang'))
         ELSE 'pt' END
  );
  RETURN NEW;
END;
$function$;

-- Função de gatilho: ninguém a chama pela app. O gatilho continua a correr
-- (o acesso só se verifica ao criar o gatilho).
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF position('língua do registo (Dev 3, 11 nov)' IN
              (SELECT prosrc FROM pg_proc WHERE oid = 'public.handle_new_user()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'handle_new_user sem a língua';
  END IF;
  IF has_function_privilege('anon', 'public.handle_new_user()', 'EXECUTE') THEN
    RAISE EXCEPTION 'handle_new_user aberta a anon';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created'
                  AND tgrelid = 'auth.users'::regclass AND NOT tgenabled = 'D') THEN
    RAISE EXCEPTION 'O gatilho on_auth_user_created não está ligado';
  END IF;
END $$;

COMMIT;
