-- ═════════════════════════════════════════════════════════════════════════
-- «Pódio do Mês» e os avisos dos prémios dos parceiros
--
-- PORQUÊ. Aprovado pelo Francisco a 26 out («sim, aprovo») e o plano a 26 out
-- («ok, avança com o pódio do mês»): design-handoff/2026-10-22-premios-
-- parceiros-avisos/SPEC.md; regras no fim de design-handoff/2026-10-18-
-- parceiros-primeiro/PROPOSTA-BA.md. Tem de estar no ar antes de 1 dez.
-- Ecrãs (janelas e sino): Dev 4.
--
-- O QUE FAZ
--   · Conquista nova «podio_do_mes» (rara, categoria 'xp'): ficar nos 3
--     primeiros do Ranking do mês da tua zona («Todos»), em todas as zonas,
--     haja ou não prémio, a partir do ranking de novembro de 2026 (o de
--     outubro não dá). Dá-se no fecho do mês (close_due_ranking_months
--     chama award_month_podium). Fica com o dia (event_on = o último dia do
--     mês), event_kind 'ranking_mes' e a zona em event_label; o
--     get_player_achievements_v2 devolve a zona em event_title. Como as
--     outras, ganha-se uma vez. Aviso no sino: 'achievement_podio_mes'
--     ({ month, district, place }).
--   · O aviso a quem ganhou o prémio ('partner_prize_won') passa a levar
--     também o que se ganha (description) e o logótipo do parceiro.
--   · A janela do início do mês: get_my_month_prize_offers() diz os prémios
--     deste mês nas zonas dos clubes e grupos de quem pergunta, que ainda não
--     viu. mark_month_prize_offer_seen(p_partner_id) grava que viu, como um
--     aviso já lido no sino ('partner_month_offer'). Uma vez por pessoa, por
--     parceiro e por mês. Só com o interruptor «parceiros» ligado.
--
-- ORDEM. Depois de migration_conquistas_contexto.sql e de
-- migration_parceiros_3_pagina_do_parceiro.sql (usa as colunas e as funções
-- delas). As três funções vivas são remendadas por texto, com contagem
-- exata; correr duas vezes não faz mal («já estava»).
--
-- COMPATIBILIDADE. Só acrescenta.
--
-- Dev 3, 26 out 2026 · ecrãs: Dev 4
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.get_player_achievements_v2(uuid)') IS NULL THEN RAISE EXCEPTION 'Falta migration_conquistas_contexto.sql. Parar.'; END IF;
  IF to_regprocedure('public.process_partner_month_vouchers()') IS NULL THEN RAISE EXCEPTION 'Falta migration_parceiros_3_pagina_do_parceiro.sql. Parar.'; END IF;
END $$;

-- ── 1. A conquista ──────────────────────────────────────────────────────
INSERT INTO achievements (key, category, rarity, sort, active)
VALUES ('podio_do_mes', 'xp', 'raro', 1032, TRUE)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.player_achievements ADD COLUMN IF NOT EXISTS event_label TEXT;
GRANT SELECT (event_label) ON public.player_achievements TO authenticated;

-- Os 3 primeiros de cada zona num mês já acabado.
CREATE OR REPLACE FUNCTION public.award_month_podium(p_month DATE)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_month DATE := date_trunc('month', p_month)::date;
  v_last  DATE := (date_trunc('month', p_month) + INTERVAL '1 month' - INTERVAL '1 day')::date;
  v_at    TIMESTAMPTZ := ((date_trunc('month', p_month) + INTERVAL '1 month')::timestamp AT TIME ZONE 'Europe/Lisbon') - INTERVAL '1 second';
  v_d     TEXT;
  v_n     INTEGER := 0;
  v_k     INTEGER;
BEGIN
  -- Só a partir do ranking de novembro (Francisco, 26 out: «só a partir de
  -- novembro. Anunciamos e damos os prémios no final do mês de nov.»).
  IF v_month < DATE '2026-11-01' THEN RETURN 0; END IF;
  FOR v_d IN SELECT DISTINCT o.district FROM organizations o WHERE o.district IS NOT NULL AND NOT COALESCE(o.is_global, FALSE) LOOP
    WITH top AS (
      SELECT t.user_id, t.place FROM ranking_month_zone_table(v_month, v_d, 'todos') t
       WHERE t.qualified AND t.place <= 3
    ), ins AS (
      INSERT INTO player_achievements (user_id, achievement_key, awarded_at, context, event_kind, event_on, event_label)
      SELECT top.user_id, 'podio_do_mes', v_at, 'facto', 'ranking_mes', v_last, v_d
        FROM top
        JOIN achievements a ON a.key = 'podio_do_mes' AND a.active
      ON CONFLICT (user_id, achievement_key) DO NOTHING
      RETURNING user_id
    )
    INSERT INTO notifications (user_id, kind, data)
    SELECT ins.user_id, 'achievement_podio_mes',
           jsonb_build_object('month', v_month, 'district', v_d, 'place', (SELECT place FROM top WHERE top.user_id = ins.user_id))
      FROM ins;
    GET DIAGNOSTICS v_k = ROW_COUNT;
    v_n := v_n + v_k;
  END LOOP;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public.award_month_podium(DATE) FROM PUBLIC, anon, authenticated;

-- ── 2. Remendos às funções vivas ────────────────────────────────────────
DO $$
DECLARE
  v_def TEXT;
  v_n   INT;
  r     RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- O fecho do mês dá a conquista.
      ('public.close_due_ranking_months()', 'award_month_podium',
       '    v_n := v_n + 1;',
       '    -- Pódio do Mês (26 out): os 3 primeiros de cada zona.' || E'\n'
         || '    PERFORM award_month_podium(v_month);' || E'\n'
         || '    v_n := v_n + 1;'),
      -- A zona da conquista aparece como o título do evento.
      ('public.get_player_achievements_v2(uuid)', 'ranking_mes',
       '''torneio'' THEN (SELECT t.name FROM tournaments t WHERE t.id = pa.event_id) END',
       '''torneio'' THEN (SELECT t.name FROM tournaments t WHERE t.id = pa.event_id)' || E'\n'
         || '                                WHEN ''ranking_mes'' THEN pa.event_label END'),
      -- O aviso a quem ganhou leva o que se ganha e o logótipo.
      ('public.process_partner_month_vouchers()', '''description''',
       '''prize_month'', v.prize_month, ''prize_district'', v.prize_district, ''valid_until'', v.valid_until)',
       '''prize_month'', v.prize_month, ''prize_district'', v.prize_district, ''valid_until'', v.valid_until,' || E'\n'
         || '                                  ''description'', (SELECT z.description FROM partner_month_prizes z WHERE z.partner_id = p.id AND z.place = v.prize_place),' || E'\n'
         || '                                  ''partner_logo_url'', p.logo_url)')
    ) AS x(fn, done, old_txt, new_txt)
  LOOP
    v_def := replace(pg_get_functiondef(r.fn::regprocedure), E'\r', '');
    IF position(r.done IN v_def) > 0 THEN
      RAISE NOTICE '% já estava', r.fn;
      CONTINUE;
    END IF;
    v_n := (length(v_def) - length(replace(v_def, r.old_txt, ''))) / length(r.old_txt);
    IF v_n <> 1 THEN
      RAISE EXCEPTION '%: esperava 1 vez «%», encontrei %. Parar.', r.fn, left(r.old_txt, 60), v_n;
    END IF;
    EXECUTE replace(v_def, r.old_txt, r.new_txt);
  END LOOP;
END $$;

-- ── 3. A janela do início do mês ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_month_prize_offers()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH me AS (SELECT auth.uid() AS uid, ranking_current_month() AS mon),
  zones AS (
    SELECT DISTINCT o.district
      FROM memberships mb JOIN organizations o ON o.id = mb.organization_id, me
     WHERE mb.user_id = me.uid AND NOT COALESCE(mb.is_guest, FALSE) AND o.district IS NOT NULL
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'partner_id', p.id, 'partner_slug', p.slug, 'partner_name', p.name, 'logo_url', p.logo_url,
           'district', p.district, 'month', me.mon,
           'prizes', (SELECT COALESCE(jsonb_agg(jsonb_build_object('place', z.place, 'discount_pct', z.discount_pct,
                                                                   'description', z.description) ORDER BY z.place), '[]'::jsonb)
                        FROM partner_month_prizes z WHERE z.partner_id = p.id))
         ORDER BY p.name), '[]'::jsonb)
    FROM partners p, me
   WHERE me.uid IS NOT NULL
     AND COALESCE((SELECT enabled FROM feature_flags WHERE key = 'parceiros'), FALSE)
     AND p.active AND p.prizes_from IS NOT NULL
     AND me.mon >= p.prizes_from AND (p.prizes_until IS NULL OR me.mon <= p.prizes_until)
     AND p.district IN (SELECT district FROM zones)
     AND EXISTS (SELECT 1 FROM partner_month_prizes z WHERE z.partner_id = p.id)
     AND NOT EXISTS (SELECT 1 FROM notifications n
                      WHERE n.user_id = me.uid AND n.kind = 'partner_month_offer'
                        AND n.data->>'partner_id' = p.id::text AND n.data->>'month' = me.mon::text);
$function$;
REVOKE ALL ON FUNCTION public.get_my_month_prize_offers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_month_prize_offers() TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_month_prize_offer_seen(p_partner_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_mon DATE := ranking_current_month();
  v_p   partners%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_allowed'; END IF;
  SELECT * INTO v_p FROM partners WHERE id = p_partner_id;
  IF v_p.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF EXISTS (SELECT 1 FROM notifications WHERE user_id = auth.uid() AND kind = 'partner_month_offer'
              AND data->>'partner_id' = p_partner_id::text AND data->>'month' = v_mon::text) THEN
    RETURN;
  END IF;
  -- Fica no sino, já lido (SPEC, ponto 1).
  INSERT INTO notifications (user_id, kind, data, read_at)
  VALUES (auth.uid(), 'partner_month_offer',
          jsonb_build_object('partner_id', v_p.id, 'partner_slug', v_p.slug, 'partner_name', v_p.name,
                             'district', v_p.district, 'month', v_mon),
          NOW());
END;
$function$;
REVOKE ALL ON FUNCTION public.mark_month_prize_offer_seen(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_month_prize_offer_seen(UUID) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT count(*) FROM achievements WHERE key = 'podio_do_mes' AND active;   → 1
--   SELECT proname, position('award_month_podium' IN prosrc) > 0 FROM pg_proc WHERE proname = 'close_due_ranking_months';   → true
--   SELECT position('ranking_mes' IN prosrc) > 0 FROM pg_proc WHERE proname = 'get_player_achievements_v2';   → true
--   SELECT position('''description''' IN prosrc) > 0 FROM pg_proc WHERE proname = 'process_partner_month_vouchers';   → true
--   SELECT has_function_privilege('anon', 'public.get_my_month_prize_offers()', 'EXECUTE');   → false
