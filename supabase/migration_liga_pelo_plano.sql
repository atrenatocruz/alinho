-- ═════════════════════════════════════════════════════════════════════════
-- Liga: criar e inscrever pelo PLANO (Community e Club), não pelo tipo
--
-- PORQUÊ. Decisão do Francisco, 21 out (via PO e Dev 1): a liga fica no
-- Community e no Club. Um grupo Community também cria liga e inscreve
-- equipas, como nos torneios (#538). A base só deixava clubes
-- (kind = 'club'). A liga é do Renato: o PO avisa-o.
--
-- O QUE FAZ. Nas 4 funções da liga que olham para o tipo, «é clube» passa a
-- «é clube OU tem o plano Community ou Club» (plan_tier pro/club; a mesma
-- regra do canPlanEvents do Gerir):
--   · create_league e apply_to_league (os erros groups_cannot_create /
--     groups_cannot_apply ficam com o mesmo nome, para a app antiga);
--   · get_league_page (viewer.admin_clubs, para o «Inscrever»);
--   · my_league_agenda.
--   Corpos VIVOS (iguais em produção e no alinho-dev a 21 out), 1 troca
--   literal em cada, com contagem exata e «já estava».
--
-- Dev 3, 21 out 2026 · ecrã: Dev 1
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  c_marca CONSTANT TEXT := 'pelo plano (21 out)';
  r RECORD;
  v_def TEXT;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.apply_to_league(uuid,uuid)',
       'IF v_org.kind IS DISTINCT FROM ''club'' THEN RAISE EXCEPTION ''groups_cannot_apply''; END IF;',
       'IF v_org.kind IS DISTINCT FROM ''club'' AND COALESCE(v_org.plan_tier, ''free'') NOT IN (''pro'', ''club'') THEN RAISE EXCEPTION ''groups_cannot_apply''; END IF;  -- pelo plano (21 out)'),
      ('public.create_league(text,uuid,text,text,text,text,text,timestamp with time zone,integer)',
       'IF v_org.kind IS DISTINCT FROM ''club'' THEN RAISE EXCEPTION ''groups_cannot_create''; END IF;',
       'IF v_org.kind IS DISTINCT FROM ''club'' AND COALESCE(v_org.plan_tier, ''free'') NOT IN (''pro'', ''club'') THEN RAISE EXCEPTION ''groups_cannot_create''; END IF;  -- pelo plano (21 out)'),
      ('public.get_league_page(text)',
       'AND o.kind = ''club'')));',
       'AND (o.kind = ''club'' OR o.plan_tier IN (''pro'', ''club'')))));  -- pelo plano (21 out)'),
      ('public.my_league_agenda()',
       'JOIN organizations o ON o.id = m.organization_id AND o.kind = ''club''',
       'JOIN organizations o ON o.id = m.organization_id AND (o.kind = ''club'' OR o.plan_tier IN (''pro'', ''club''))  -- pelo plano (21 out)' || E'\n       ')
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

-- Verificar depois de correr (4):
--   SELECT count(*) FROM pg_proc WHERE proname IN ('create_league', 'apply_to_league', 'get_league_page', 'my_league_agenda')
--      AND pg_get_functiondef(oid) LIKE '%pelo plano (21 out)%';
