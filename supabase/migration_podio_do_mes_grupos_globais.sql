-- ═════════════════════════════════════════════════════════════════════════
-- Pódio do Mês: os distritos dos grupos «globais» também contam
--
-- PORQUÊ. O SI (28 out): no award_month_podium o ciclo dos distritos tinha
-- «AND NOT COALESCE(o.is_global, FALSE)». is_global quer dizer «aparece no
-- diretório e no Geral» e não tem nada a ver com a zona. Os grupos
-- principais (A2N, + 1 Grupo, Smash Padel Almada, Aquele Padel Maroto, Jota
-- Padeleiros) são todos is_global, por isso um distrito só com grupos assim
-- (Setúbal, o da RM Terapias) ficava sem Pódio do Mês e sem prémios, mesmo
-- com o distrito posto. O ranking_month_zone_table (o que os ecrãs mostram
-- em «district:<zona>») e os prémios não filtram por is_global: com isto o
-- pódio passa a sair dos mesmos distritos que o ecrã mostra.
--
-- O QUE FAZ. Tira só esse pedaço do ciclo (emenda por texto ao corpo vivo;
-- 1 vez, ou «já estava»). Mantém o resto do corpo e os GRANT (só
-- service_role: corre pelo cron, não pela app).
--
-- ORDEM. Qualquer; antes do fecho de novembro (1 dez).
--
-- Dev 3, 28 out 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  v_def TEXT;
  v_n   INT;
  v_old TEXT := 'WHERE o.district IS NOT NULL AND NOT COALESCE(o.is_global, FALSE) LOOP';
  v_new TEXT := 'WHERE o.district IS NOT NULL LOOP';
BEGIN
  v_def := replace(pg_get_functiondef('public.award_month_podium(date)'::regprocedure), E'\r', '');
  IF position('is_global' IN v_def) = 0 THEN
    RAISE NOTICE 'award_month_podium já estava';
    RETURN;
  END IF;
  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'award_month_podium: esperava 1 vez o filtro is_global, encontrei %. Parar.', v_n;
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END $$;

REVOKE EXECUTE ON FUNCTION public.award_month_podium(date) FROM PUBLIC, anon, authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT position('is_global' IN prosrc) = 0, proacl FROM pg_proc WHERE proname = 'award_month_podium';
--   → true, e o proacl só com postgres e service_role.
