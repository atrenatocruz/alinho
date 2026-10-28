-- ═════════════════════════════════════════════════════════════════════════
-- Superadmin com o modo ligado vê tudo de qualquer perfil
--
-- PORQUÊ. Francisco, 28 out (pelo PO): «o superadmin, com o modo ligado, vê
-- tudo de qualquer perfil na Comunidade, também nos privados (nível, jogos,
-- grupos), como o admin de um grupo vê os seus membros. Com o modo
-- desligado, vê como qualquer pessoa.» E «como estava antes do switch»:
-- antes de 18 out (migration_superadmin_escondido) o superadmin estava
-- inscrito em 12 grupos pelo acesso e via membros e perfis a partir daí.
--
-- O QUE JÁ ESTAVA. Grupos e clubes onde não é membro: is_org_admin já aceita
-- is_platform_admin_me (lista de membros, números, eventos, «Já jogados»).
--
-- O QUE FAZ. Duas regras de privacidade dos perfis passam a abrir ao
-- superadmin com o modo ligado (is_platform_admin_me já exige
-- platform_admins.mode_on):
--   · can_view_section: as secções do perfil (resultados/nível, atividade,
--     grupos). Serve o get_player_profile, o histórico de jogos, o gráfico do
--     nível, parceiros e adversários, frente a frente, a lista de membros e a
--     pesquisa de jogadores.
--   · follow_lists_visible: as listas de quem segue e é seguido de um perfil
--     privado.
-- Nada disto o mostra a ele: continua escondido nos grupos e nas ações.
-- Emenda por texto ao corpo vivo (1 vez cada, ou «já estava»); os corpos
-- vivos têm \r em produção e normalizam-se antes. CREATE OR REPLACE mantém
-- os GRANT (o can_view_section tem anon de propósito: páginas públicas).
--
-- ORDEM. Qualquer.
--
-- Dev 3, 28 out 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  v_def TEXT;
  v_n   INT;
  r     RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('public.can_view_section(uuid,text)',
       E'    OR (p_visibility = ''friends'' AND is_mutual_follow(auth.uid(), p_owner_id));',
       E'    OR (p_visibility = ''friends'' AND is_mutual_follow(auth.uid(), p_owner_id))\n    -- O superadmin com o modo ligado vê tudo (Francisco, 28 out).\n    OR COALESCE(is_platform_admin_me(), FALSE);'),
      ('public.follow_lists_visible(uuid)',
       E'          OR is_mutual_follow(auth.uid(), p_user_id));',
       E'          OR is_mutual_follow(auth.uid(), p_user_id)\n          -- O superadmin com o modo ligado vê tudo (Francisco, 28 out).\n          OR COALESCE(is_platform_admin_me(), FALSE));')
    ) AS x(fn, old_txt, new_txt)
  LOOP
    v_def := replace(pg_get_functiondef(r.fn::regprocedure), E'\r', '');
    IF position('is_platform_admin_me' IN v_def) > 0 THEN
      RAISE NOTICE '% já estava', r.fn;
      CONTINUE;
    END IF;
    v_n := (length(v_def) - length(replace(v_def, r.old_txt, ''))) / length(r.old_txt);
    IF v_n <> 1 THEN
      RAISE EXCEPTION '%: esperava 1 vez a última regra, encontrei %. Parar.', r.fn, v_n;
    END IF;
    EXECUTE replace(v_def, r.old_txt, r.new_txt);
  END LOOP;
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT proname, position('is_platform_admin_me' IN prosrc) > 0, proacl FROM pg_proc
--    WHERE proname IN ('can_view_section', 'follow_lists_visible');
--   → 2× true, e o proacl igual ao de antes.
