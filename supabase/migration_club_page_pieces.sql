-- ═════════════════════════════════════════════════════════════════════════
-- PÁGINA DO CLUBE/GRUPO: AS TRÊS PEÇAS QUE O ECRÃ PRECISA
-- (Dev 3, 24 set 2026) — cartão «#419», pedido do Dev 1 pelo PO.
-- Desenho aprovado: Alinho/design-handoff/2026-09-23-pagina-do-grupo/SPEC.md
--
-- Pode-se correr outra vez sem estragar: o que já estiver feito fica.
--
-- 1. `get_club_profile(slug).open_games` — cada evento ganha:
--      origin        TEXT  — mix ou jogo em aberto (etiqueta e cor da Home)
--      recurrence_id UUID  — para «Mix · Semanal»
--      my_state      TEXT  — 'in' (inscrito), 'waitlist' (lista de espera)
--                            ou null; conta também quem entrou como parceiro.
--
-- 2. Grupo fechado, quem não é membro: em vez de `[]`, os eventos com SÓ
--      id, title, date, origin e locked = true
--    para o ecrã os mostrar apagados e sem abrir, com «Só os membros se
--    inscrevem». Nada de local, de nomes nem de inscritos (decisão do
--    desenho, confirmada pelo PO a 24 set).
--
-- 3. `list_organization_members` ganha:
--      is_admin BOOLEAN — «Quem organiza» e a etiqueta «Organiza»
--      rating   NUMERIC — o nível; o ecrã faz a banda com `ratingBand` como
--                         no resto da app. NULL quando a pessoa esconde os
--                         resultados (`results_visibility`) a quem está a ver.
--      gender   TEXT    — a banda depende dele (M/F); tal como o rating, NULL
--                         quando a pessoa esconde os resultados.
--
-- ⚠️ QUANDO CORRER (System Integrator, 24 set): o ecrã de hoje da página do
-- clube não conhece o `locked`, e para quem não é membro de um grupo fechado
-- mostraria os eventos com a linha «N/M jogadores» partida. Correr junto com
-- a ida do ecrã novo do Dev 1 para o site, não antes.
--    Mudar as colunas que uma função devolve obriga a apagá-la e criá-la
--    de novo: as permissões que ela tinha são repostas tal e qual.
--
-- NÃO TRAZ OS CORPOS ESCRITOS: lê as funções vivas, troca só os fragmentos
-- e recusa se não os encontrar.
-- ═════════════════════════════════════════════════════════════════════════

-- ── 1 e 2. get_club_profile ──────────────────────────────────────────────
DO $$
DECLARE
  -- 1. Os campos novos, a seguir ao 'max_players' (que só existe na lista
  --    dos membros).
  c_campos_mau CONSTANT TEXT :=
    '(''max_players'',\s*COALESCE\(g\.max_players,\s*g\.num_courts\s*\*\s*4\),)';
  c_campos_bom CONSTANT TEXT :=
    '\1 ''origin'', g.origin, ''recurrence_id'', g.recurrence_id, '
    || '''my_state'', (SELECT CASE mp.status WHEN ''confirmed'' THEN ''in'' WHEN ''waitlisted'' THEN ''waitlist'' END '
    || 'FROM participants mp WHERE mp.game_id = g.id AND (mp.user_id = auth.uid() OR mp.partner_id = auth.uid()) '
    || 'ORDER BY (mp.status = ''confirmed'') DESC LIMIT 1),';
  -- 2. Quem não é membro de um grupo fechado: a lista curta, em vez de [].
  --    Aceita as duas formas que a condição já teve: a de 16 set
  --    («(o.kind = 'group' OR NOT o.is_global)») e a de 23 set, do Renato
  --    (migration_platform_admins_invisible.sql: «NOT o.is_global»).
  c_fechado_mau CONSTANT TEXT :=
    '(AND\s+(?:\(o\.kind\s*=\s*''group''\s+OR\s+NOT\s+o\.is_global\)|NOT\s+o\.is_global)\s+THEN\s+)''\[\]''::jsonb';
  c_fechado_bom CONSTANT TEXT :=
    '\1COALESCE((SELECT json_agg(json_build_object(''id'', g.id, ''title'', g.title, ''date'', g.date, '
    || '''origin'', g.origin, ''locked'', true) ORDER BY g.date) FROM games g '
    || 'WHERE g.organization_id = o.id AND g.status NOT IN (''finished'', ''completed'', ''cancelled'', ''pending'')), '
    || '''[]''::json)::jsonb';
  f      RECORD;
  v_def  TEXT;
  v_novo TEXT;
  v_n    INTEGER := 0;
BEGIN
  FOR f IN SELECT p.oid, pg_get_function_identity_arguments(p.oid) AS args, p.prosrc
             FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname = 'get_club_profile' LOOP
    v_n := v_n + 1;
    IF position('''my_state''' IN f.prosrc) > 0 AND position('''locked''' IN f.prosrc) > 0 THEN
      RAISE NOTICE 'get_club_profile(%): já tinha as duas peças.', f.args;
      CONTINUE;
    END IF;
    IF NOT (f.prosrc ~ c_campos_mau AND f.prosrc ~ c_fechado_mau) THEN
      RAISE EXCEPTION 'get_club_profile(%) não tem a forma esperada — alguém a mudou. Ler o corpo vivo antes de correr isto.', f.args;
    END IF;
    IF (SELECT count(*) FROM regexp_matches(f.prosrc, c_campos_mau, 'g')) <> 1
       OR (SELECT count(*) FROM regexp_matches(f.prosrc, c_fechado_mau, 'g')) <> 1 THEN
      RAISE EXCEPTION 'get_club_profile(%): o fragmento dos eventos aparece mais de uma vez. Ler o corpo vivo.', f.args;
    END IF;
    v_def  := pg_get_functiondef(f.oid);
    v_novo := regexp_replace(v_def,  c_campos_mau,  c_campos_bom);
    v_novo := regexp_replace(v_novo, c_fechado_mau, c_fechado_bom);
    IF position('''my_state''' IN v_novo) = 0 OR position('''locked''' IN v_novo) = 0 THEN
      RAISE EXCEPTION 'get_club_profile(%): não consegui acrescentar as peças. Ler o corpo vivo.', f.args;
    END IF;
    EXECUTE v_novo;
    RAISE NOTICE 'Corrigida: get_club_profile(%)', f.args;
  END LOOP;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'Não existe get_club_profile. Parar e ler.';
  END IF;
END $$;

-- ── 3. list_organization_members ─────────────────────────────────────────
DO $$
DECLARE
  c_tipo_mau  CONSTANT TEXT := 'RETURNS TABLE\(id uuid, name text, avatar_url text\)';
  c_tipo_bom  CONSTANT TEXT := 'RETURNS TABLE(id uuid, name text, avatar_url text, is_admin boolean, rating numeric, gender text)';
  c_sel_mau   CONSTANT TEXT := '(SELECT\s+p\.id,\s*p\.name,\s*p\.avatar_url)(\s+FROM)';
  -- O género só serve para a letra da banda (M/F) — por isso só vem quando o
  -- nível também vem (revisão do System Integrator, 24 set).
  c_sel_bom   CONSTANT TEXT := '\1, m.is_admin, '
    || 'CASE WHEN can_view_section(p.id, p.results_visibility) THEN p.rating END, '
    || 'CASE WHEN can_view_section(p.id, p.results_visibility) THEN p.gender END\2';
  v_oid   OID;
  v_def   TEXT;
  v_novo  TEXT;
  v_acl   ACLITEM[];
  v_owner OID;
  a       RECORD;
BEGIN
  SELECT p.oid, p.proacl, p.proowner INTO v_oid, v_acl, v_owner
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname = 'list_organization_members'
     AND pg_get_function_identity_arguments(p.oid) = 'p_organization_id uuid';
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Não existe list_organization_members(uuid). Parar e ler.';
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
         AND proname = 'list_organization_members') <> 1 THEN
    RAISE EXCEPTION 'Há mais de uma list_organization_members. Parar e ler.';
  END IF;

  v_def := pg_get_functiondef(v_oid);
  IF position('is_admin boolean' IN v_def) > 0 THEN
    RAISE NOTICE 'list_organization_members: já tinha as colunas novas.';
    RETURN;
  END IF;
  IF NOT (v_def ~ c_tipo_mau AND v_def ~ c_sel_mau) THEN
    RAISE EXCEPTION 'list_organization_members não tem a forma esperada — alguém a mudou. Ler o corpo vivo antes de correr isto.';
  END IF;
  v_novo := regexp_replace(v_def,  c_tipo_mau, c_tipo_bom);
  v_novo := regexp_replace(v_novo, c_sel_mau,  c_sel_bom);

  -- Apagar e criar de novo (mudam as colunas devolvidas), e repor as
  -- permissões que tinha, tal e qual.
  EXECUTE 'DROP FUNCTION public.list_organization_members(uuid)';
  EXECUTE v_novo;
  EXECUTE 'REVOKE ALL ON FUNCTION public.list_organization_members(uuid) FROM PUBLIC';
  FOR a IN SELECT * FROM aclexplode(COALESCE(v_acl, acldefault('f', v_owner)))
            WHERE privilege_type = 'EXECUTE' LOOP
    IF a.grantee = 0 THEN
      EXECUTE 'GRANT EXECUTE ON FUNCTION public.list_organization_members(uuid) TO PUBLIC';
    ELSE
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.list_organization_members(uuid) TO %I',
                     (SELECT rolname FROM pg_roles WHERE oid = a.grantee));
    END IF;
  END LOOP;

  -- Confirmar: quem pode chamar é exatamente quem podia (comparado como
  -- conjunto — a ordem das entradas pode mudar).
  IF EXISTS (
    (SELECT grantee FROM aclexplode(COALESCE(v_acl, acldefault('f', v_owner))) WHERE privilege_type = 'EXECUTE'
     EXCEPT
     SELECT grantee FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
      WHERE p.proname = 'list_organization_members' AND p.pronamespace = 'public'::regnamespace
        AND x.privilege_type = 'EXECUTE')
    UNION ALL
    (SELECT grantee FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
      WHERE p.proname = 'list_organization_members' AND p.pronamespace = 'public'::regnamespace
        AND x.privilege_type = 'EXECUTE'
     EXCEPT
     SELECT grantee FROM aclexplode(COALESCE(v_acl, acldefault('f', v_owner))) WHERE privilege_type = 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'As permissões da list_organization_members não ficaram iguais às de antes. Nada foi gravado.';
  END IF;
  RAISE NOTICE 'Corrigida: list_organization_members';
END $$;

-- ═════════════════════════════════════════════════════════════════════════
-- PARA VER ANTES, EM PRODUÇÃO (só leitura): a forma que o ficheiro espera
-- ═════════════════════════════════════════════════════════════════════════
--   SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
--          p.prosrc ~ '''max_players'',\s*COALESCE\(g\.max_players,\s*g\.num_courts\s*\*\s*4\),' AS eventos_ok,
--          p.prosrc ~ 'AND\s+(?:\(o\.kind\s*=\s*''group''\s+OR\s+NOT\s+o\.is_global\)|NOT\s+o\.is_global)\s+THEN\s+''\[\]''::jsonb' AS fechado_ok,
--          pg_get_function_result(p.oid) AS devolve, p.proacl
--     FROM pg_proc p
--    WHERE p.pronamespace = 'public'::regnamespace
--      AND p.proname IN ('get_club_profile', 'list_organization_members');
-- Esperado: eventos_ok e fechado_ok verdadeiros na get_club_profile; a
-- list_organization_members devolve TABLE(id uuid, name text, avatar_url text).
