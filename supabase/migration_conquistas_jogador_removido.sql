-- ═════════════════════════════════════════════════════════════════════════
-- Conquistas «quando e com quem»: quem apagou a conta aparece como
-- «Jogador removido», em vez de desaparecer
--
-- PORQUÊ. Achado do QA (27 out): na get_player_achievements_v2, a dupla
-- vencida (beaten) vinha de «FROM profiles b WHERE b.id = ANY(beaten_ids)».
-- Um jogador cujo perfil já não existe (conta apagada por inteiro) saía da
-- lista. A regra da BA e da UX (design-handoff/2026-10-21-conquistas-quando-
-- e-quebra-enguico, REGRAS-BA §84, SPEC-UX §34) é «Jogador removido», sem link.
--
-- O QUE FAZ (emenda por texto a get_player_achievements_v2 viva)
--   · beaten: percorre os beaten_ids pela ordem, com LEFT JOIN a profiles.
--     Sem perfil, ou com a conta anonimizada (email removido-…@alinho.invalid),
--     vai name = NULL e linkable = false. O ecrã mostra «Jogador removido»
--     na língua de quem vê (achievements.when_removed).
--   · partner_linkable: sem perfil, false (antes dava true e fazia um link
--     para um perfil que não existe).
--
-- ORDEM. Depois de migration_conquistas_contexto.sql (cria a função). Não
-- depende da migration_podio_do_mes.sql (essa mexe noutra linha).
--
-- COMPATIBILIDADE. Mesmas colunas; só muda o conteúdo do beaten e do
-- partner_linkable nesses casos.
--
-- Dev 3, 27 out 2026 · ecrãs: Dev 2 · regras: BA
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  v_fn  TEXT := 'public.get_player_achievements_v2(uuid)';
  v_def TEXT;
  v_n   INT;
  r     RECORD;
BEGIN
  v_def := replace(pg_get_functiondef(v_fn::regprocedure), E'\r', '');
  IF position('WITH ORDINALITY AS u(id, n)' IN v_def) > 0 THEN
    RAISE NOTICE '% já estava', v_fn;
    RETURN;
  END IF;
  FOR r IN
    SELECT * FROM (VALUES
      ('(SELECT jsonb_agg(jsonb_build_object(''id'', b.id, ''name'', b.name, ''linkable'', NOT COALESCE(b.is_private, FALSE)))',
       '(SELECT jsonb_agg(jsonb_build_object(''id'', u.id,'
         || ' ''name'', CASE WHEN b.email LIKE ''removido-%@alinho.invalid'' THEN NULL ELSE b.name END,'
         || ' ''linkable'', b.id IS NOT NULL AND NOT COALESCE(b.is_private, FALSE)) ORDER BY u.n)'),
      ('FROM profiles b WHERE b.id = ANY(pa.beaten_ids))',
       'FROM unnest(pa.beaten_ids) WITH ORDINALITY AS u(id, n) LEFT JOIN profiles b ON b.id = u.id)'),
      ('THEN NOT COALESCE((SELECT pp.is_private FROM profiles pp WHERE pp.id = pa.partner_id), FALSE) END,',
       'THEN COALESCE((SELECT NOT COALESCE(pp.is_private, FALSE) FROM profiles pp WHERE pp.id = pa.partner_id), FALSE) END,')
    ) AS x(old_txt, new_txt)
  LOOP
    v_n := (length(v_def) - length(replace(v_def, r.old_txt, ''))) / length(r.old_txt);
    IF v_n <> 1 THEN RAISE EXCEPTION '%: esperava 1 vez «%», encontrei %. Parar.', v_fn, r.old_txt, v_n; END IF;
    v_def := replace(v_def, r.old_txt, r.new_txt);
  END LOOP;
  EXECUTE v_def;
END $$;

REVOKE EXECUTE ON FUNCTION public.get_player_achievements_v2(uuid) FROM PUBLIC, anon;

COMMIT;

-- Verificar depois de correr:
--   SELECT position('WITH ORDINALITY AS u(id, n)' IN prosrc) > 0
--     FROM pg_proc WHERE proname = 'get_player_achievements_v2';   → true
