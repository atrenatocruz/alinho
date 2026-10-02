-- ═════════════════════════════════════════════════════════════════════════
-- Comunidade: o género da média dos inscritos (M, F ou MX) no cartão do mix
--
-- PORQUÊ. Dev 2, com o PO (30 set): a pastilha da média dos mixes deixou de
-- usar o N (decisão #577: só M, F e MX), e a letra vem de quem está
-- inscrito. No cartão da Comunidade (mix de um clube onde ainda não estou)
-- o list_explore_events só mandava avg_rating.
--
-- O QUE FAZ. list_explore_events ganha a coluna avg_gender, logo a seguir
-- ao avg_rating: 'masculino' se os inscritos que entram na média e têm
-- género forem todos homens, 'feminino' se forem todas mulheres, 'misto'
-- se houver dos dois, null se ninguém tiver género. Contam os mesmos da
-- média (confirmados, com nível, sem convidados). Muda o que devolve →
-- DROP + CREATE a partir do corpo VIVO (o da migration_mix_guest_sem_conta
-- do Ruben, 1 out): só se juntam a coluna e o seu cálculo; o resto fica
-- exatamente como está.
--
-- Dev 3, 2 out 2026 · ecrã: Dev 2
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  c_tipo_mau CONSTANT TEXT := '(avg_rating numeric)';
  c_tipo_bom CONSTANT TEXT := '\1, avg_gender text';
  c_col_mau  CONSTANT TEXT := '(AND pr\.rating IS NOT NULL AND COALESCE\(mm\.is_guest, false\) = false\s+\),)';
  c_col_bom  CONSTANT TEXT := '\1
    (
      -- género da média (Dev 2, 2 out): os mesmos que entram no avg_rating
      SELECT CASE
               WHEN count(*) FILTER (WHERE NULLIF(pr.gender, '''') IS NOT NULL) = 0 THEN NULL
               WHEN bool_and(NULLIF(pr.gender, '''') IS NULL OR pr.gender = ''masculino'') THEN ''masculino''
               WHEN bool_and(NULLIF(pr.gender, '''') IS NULL OR pr.gender = ''feminino'') THEN ''feminino''
               ELSE ''misto''
             END
      FROM participants p
      JOIN profiles pr ON pr.id IN (p.user_id, p.partner_id)
      LEFT JOIN memberships mm ON mm.user_id = pr.id AND mm.organization_id = g.organization_id
      WHERE p.game_id = g.id AND p.status = ''confirmed''
        AND pr.rating IS NOT NULL AND COALESCE(mm.is_guest, false) = false
    ),';
  v_def TEXT := pg_get_functiondef('public.list_explore_events(timestamp with time zone)'::regprocedure);
BEGIN
  IF v_def LIKE '%avg_gender%' THEN
    RAISE NOTICE 'list_explore_events: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_tipo_mau, 'g')) <> 1
     OR (SELECT count(*) FROM regexp_matches(v_def, c_col_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'list_explore_events: os pedaços a trocar não aparecem 1 vez. Parar e ler.';
  END IF;
  v_def := regexp_replace(v_def, c_tipo_mau, c_tipo_bom);
  v_def := regexp_replace(v_def, c_col_mau, c_col_bom);
  DROP FUNCTION public.list_explore_events(timestamp with time zone);
  EXECUTE v_def;
END $$;

REVOKE ALL ON FUNCTION public.list_explore_events(timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_explore_events(timestamp with time zone) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_explore_events(timestamp with time zone) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_functiondef('public.list_explore_events(timestamptz)'::regprocedure) LIKE '%avg_gender%';  -- true
--   SELECT has_function_privilege('anon', 'public.list_explore_events(timestamptz)', 'EXECUTE');  -- false
