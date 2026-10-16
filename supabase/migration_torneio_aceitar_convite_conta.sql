-- ═════════════════════════════════════════════════════════════════════════
-- Torneio: os convites por aceitar não contam para o máximo de categorias
--
-- PORQUÊ. QA, 12 out (grave, também em produção, sem vítimas por não haver
-- torneio aberto): o tournament_respond_invite recusava com
-- 'max_categories_reached' quando o convite que se aceita enchia a conta —
-- o tournament_categories_left contava todas as inscrições da pessoa,
-- incluindo os convites recebidos e o próprio que se está a aceitar. Com
-- máximo 1, ninguém conseguia aceitar o parceiro. E qualquer pessoa podia
-- encher o máximo de outra só a convidá-la.
--
-- DECISÃO DO PO (12 out): um convite recebido e ainda não aceite não conta;
-- passa a contar ao aceitar, e aí verifica-se o máximo (sem contar o
-- próprio duas vezes). Os convites que eu fiz contam para mim — já estou
-- nessa inscrição. Quem convida alguém que já está no máximo é avisado ao
-- convidar.
--
-- O QUE FAZ
--   1. tournament_categories_left(p_tournament_id, p_user, p_except_entry)
--      (nova) e a de 2 argumentos (= a nova sem exceção): contam as
--      inscrições ativas onde a pessoa é o 1.º lugar, ou o 2.º já com o
--      convite aceite (status <> 'convite').
--   2. tournament_respond_invite (todas as versões): ao aceitar, conta sem o
--      próprio convite. Corpo VIVO, 1 troca literal («já estava»).
--   3. tournament_signup: convidar alguém que já está no máximo recusa com
--      'partner_max_categories_reached'. Corpo VIVO, 1 troca literal.
--
-- ORDEM. Depois de migration_torneio_t_shirts.sql (é a versão das t-shirts
-- do tournament_signup que tem o pedaço a trocar).
--
-- Dev 3, 12 out 2026 · ecrã: Dev 1 (mostrar os erros no aceitar e no
-- convidar)
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. A conta ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tournament_categories_left(p_tournament_id UUID, p_user UUID, p_except_entry UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT GREATEST(
    COALESCE((SELECT COALESCE((rules->>'max_categories')::int, (rules->>'max_categories_per_person')::int) FROM tournaments WHERE id = p_tournament_id), 2)
    - (SELECT COUNT(*) FROM tournament_entries e
         JOIN tournament_categories c ON c.id = e.category_id
        WHERE c.tournament_id = p_tournament_id AND e.status <> 'desistiu'
          AND e.id IS DISTINCT FROM p_except_entry
          -- Um convite recebido e ainda não aceite não ocupa lugar (PO, 12 out).
          AND (e.player1_id = p_user OR (e.player2_id = p_user AND e.status <> 'convite')))::int,
    0);
$function$;
REVOKE ALL ON FUNCTION public.tournament_categories_left(UUID, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tournament_categories_left(UUID, UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.tournament_categories_left(p_tournament_id UUID, p_user UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT tournament_categories_left(p_tournament_id, p_user, NULL::uuid);
$function$;

-- ── 2. Aceitar: sem contar o próprio convite ────────────────────────────
DO $$
DECLARE
  c_mau CONSTANT TEXT := '    IF tournament_categories_left(v_tournament, v_me) <= 0 THEN';
  f     RECORD;
  v_def TEXT;
BEGIN
  FOR f IN SELECT oid FROM pg_proc WHERE proname = 'tournament_respond_invite' AND pronamespace = 'public'::regnamespace LOOP
    v_def := pg_get_functiondef(f.oid);
    IF v_def LIKE '%tournament_categories_left(v_tournament, v_me, v_entry.id)%' THEN
      RAISE NOTICE '%: já estava', f.oid::regprocedure;
      CONTINUE;
    END IF;
    IF (length(v_def) - length(replace(v_def, c_mau, ''))) / length(c_mau) <> 1 THEN
      RAISE EXCEPTION '%: o pedaço a trocar não aparece 1 vez. Parar e ler.', f.oid::regprocedure;
    END IF;
    EXECUTE replace(v_def, c_mau,
      E'    -- O próprio convite não conta duas vezes (QA, 12 out).\n'
      || '    IF tournament_categories_left(v_tournament, v_me, v_entry.id) <= 0 THEN');
  END LOOP;
END $$;

-- ── 3. Convidar alguém que já está no máximo: avisa ao convidar ─────────
DO $$
DECLARE
  c_mau CONSTANT TEXT := E'    IF tournament_person_in_category(p_category_id, p_partner_id) THEN\n'
                      || E'      RAISE EXCEPTION ''partner_already_in_category'';\n'
                      || E'    END IF;';
  v_def TEXT := pg_get_functiondef('public.tournament_signup(uuid,uuid,text,text,text,text,text)'::regprocedure);
BEGIN
  IF v_def LIKE '%partner_max_categories_reached%' THEN
    RAISE NOTICE 'tournament_signup: já estava';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, c_mau, ''))) / length(c_mau) <> 1 THEN
    RAISE EXCEPTION 'tournament_signup: o pedaço a trocar não aparece 1 vez (correu o migration_torneio_t_shirts.sql?). Parar e ler.';
  END IF;
  EXECUTE replace(v_def, c_mau, c_mau
    || E'\n    -- Já está no máximo de categorias: nunca poderia aceitar (PO, 12 out).\n'
    || E'    IF tournament_categories_left(v_cat.tournament_id, p_partner_id) <= 0 THEN\n'
    || E'      RAISE EXCEPTION ''partner_max_categories_reached'';\n'
    || E'    END IF;');
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT bool_and(pg_get_functiondef(oid) LIKE '%v_me, v_entry.id) <= 0%') FROM pg_proc WHERE proname = 'tournament_respond_invite';  -- true
--   SELECT pg_get_functiondef('public.tournament_signup(uuid,uuid,text,text,text,text,text)'::regprocedure) LIKE '%partner_max_categories_reached%';  -- true
--   SELECT has_function_privilege('anon', 'public.tournament_categories_left(uuid,uuid,uuid)', 'EXECUTE');  -- false
