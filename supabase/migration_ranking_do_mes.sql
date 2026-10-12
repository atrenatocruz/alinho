-- ═════════════════════════════════════════════════════════════════════════
-- Ranking do mês + molduras do pódio
--
-- PORQUÊ. Aprovados pelo Francisco a 12 out (via Marketing), plano okay a
-- 12 out. Regras: design-handoff/2026-10-12-ranking-do-mes-podio/
-- REGRAS-BA.md e design-handoff/2026-10-12-molduras-podio/SPEC.md. Ecrãs:
-- Dev 4.
--
-- O QUE CONTA. Só lê o que a conta do nível (elo do Ruben) já grava, sem
-- mexer nela: rating_delta de mix_player_stats, tournament_player_stats,
-- private_match_stats (inclui os pares dos jogos entre amigos que contam) e
-- applied_elo_deltas de group_matches. Sem rating_delta = não conta
-- (amigáveis, empates entre amigos, aulas).
--   · Pontos do mês = soma do que o nível mexeu, arredondada. Quem ainda
--     estava nos primeiros 12 jogos no início do evento conta metade (o K 40
--     dele passa a valer como K 20). Os jogos antes do evento contam-se a
--     partir do rating_games de hoje.
--   · Mês = o do início do evento, na hora de Lisboa.
--   · Entra no pódio quem tem 4 jogos no mês nesse âmbito. Desempate: mais
--     vitórias, depois mais jogos; igual em tudo partilha o lugar.
--   · Âmbito: geral (tudo) ou um clube/grupo (só os eventos dele; os jogos
--     entre amigos só se foram criados nesse grupo). O clube global conta
--     como o geral.
--   · Filtros: todos, masculino, feminino (profiles.gender), lugares
--     contados dentro do filtro.
--   · Fora: contas de teste (profiles.is_test; no clube também
--     memberships.is_test), professores escondidos (ranking_hidden_user_ids)
--     e perfis sem nome. Perfis privados entram (regra de 1 out).
--
-- O FECHO. ranking_months + ranking_month_places guardam cada mês como
-- ficou a dia 1 às 00:00 (hora de Lisboa): o pg_cron corre a cada minuto e
-- fecha os meses que acabaram (o primeiro é outubro de 2026). Uma correção
-- depois do fecho já não muda esse mês.
--
-- AS MOLDURAS. Quem fecha o mês em 1.º, 2.º ou 3.º (filtro «todos»), no
-- geral ou num clube, usa ouro, prata ou bronze durante o mês seguinte
-- inteiro. Com várias, a melhor: lugar mais alto; com o mesmo lugar, o
-- geral ganha ao clube.
--
-- PARA O ECRÃ (Dev 4)
--   get_month_ranking(p_organization_id, p_month, p_gender) → place,
--     user_id, name, avatar_url, rating, gender, points, games, wins,
--     qualified, is_me, frame. Os que entram (qualified) e, se não entrar, a
--     linha de quem pede («Ainda fora · N de 4 jogos»). NULL = geral; p_month
--     qualquer dia do mês (NULL = o mês de agora); p_gender NULL/'todos',
--     'masculino', 'feminino'.
--   get_month_ranking_months(p_organization_id) → os meses fechados com
--     gente nesse âmbito (para «Meses anteriores»).
--   get_user_frames(p_user_ids) → a melhor moldura de cada um, agora.
--   get_user_frame_list(p_user_id) → todas as molduras dessa pessoa, agora.
--   frame: 'ouro' | 'prata' | 'bronze'; scope_name = nome do clube ou NULL
--   (geral); month = o mês que deu a moldura.
--
-- Dev 3, 12 out 2026 · ecrãs: Dev 4
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. O fecho de cada mês ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ranking_months (
  month     DATE PRIMARY KEY CHECK (extract(day FROM month) = 1),
  closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.ranking_month_places (
  month           DATE NOT NULL REFERENCES public.ranking_months(month) ON DELETE CASCADE,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,  -- NULL = geral
  filter          TEXT NOT NULL CHECK (filter IN ('todos', 'masculino', 'feminino')),
  user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  place           INTEGER NOT NULL,
  points          INTEGER NOT NULL,
  games           INTEGER NOT NULL,
  wins            INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ranking_month_places_uniq
  ON public.ranking_month_places (month, COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), filter, user_id);
CREATE INDEX IF NOT EXISTS ranking_month_places_frames
  ON public.ranking_month_places (month, user_id) WHERE filter = 'todos' AND place <= 3;

-- Só pelas funções abaixo.
ALTER TABLE public.ranking_months ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ranking_month_places ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ranking_months, public.ranking_month_places FROM anon, authenticated;

-- ── 2. O mês de agora e os limites de um mês (hora de Lisboa) ───────────
CREATE OR REPLACE FUNCTION public.ranking_current_month()
RETURNS DATE
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT date_trunc('month', NOW() AT TIME ZONE 'Europe/Lisbon')::date;
$function$;
REVOKE ALL ON FUNCTION public.ranking_current_month() FROM PUBLIC, anon, authenticated;

-- ── 3. Os eventos que contam num mês, por pessoa (interna) ──────────────
CREATE OR REPLACE FUNCTION public.ranking_month_events(p_month DATE)
RETURNS TABLE(user_id UUID, organization_id UUID, games INTEGER, wins INTEGER, points NUMERIC)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH ev AS (
    SELECT s.user_id, g.organization_id AS org, g.date AS at,
           COALESCE(s.matches_played, 0) AS games, COALESCE(s.matches_won, 0) AS wins, s.rating_delta AS d, 'm' || s.id AS ref
      FROM mix_player_stats s JOIN games g ON g.id = s.game_id
     WHERE s.rating_delta IS NOT NULL
    UNION ALL
    SELECT s.user_id, t.organization_id,
           COALESCE(CASE WHEN c.day_date IS NOT NULL THEN (c.day_date + COALESCE(c.start_time, time '00:00')) AT TIME ZONE 'Europe/Lisbon' END,
                    t.starts_on::timestamp AT TIME ZONE 'Europe/Lisbon', s.created_at),
           COALESCE(s.matches_played, 0), COALESCE(s.matches_won, 0), s.rating_delta, 't' || s.id
      FROM tournament_player_stats s
      JOIN tournament_categories c ON c.id = s.category_id
      JOIN tournaments t ON t.id = c.tournament_id
     WHERE s.rating_delta IS NOT NULL
    UNION ALL
    SELECT s.user_id, pm.organization_id,
           COALESCE(CASE WHEN pm.scheduled_date IS NOT NULL THEN (pm.scheduled_date + COALESCE(pm.scheduled_time, time '12:00')) AT TIME ZONE 'Europe/Lisbon' END,
                    pm.played_at, pm.created_at),
           1, CASE WHEN s.won THEN 1 ELSE 0 END, s.rating_delta, 'p' || s.id
      FROM private_match_stats s JOIN private_matches pm ON pm.id = s.private_match_id
     WHERE s.rating_delta IS NOT NULL
    UNION ALL
    SELECT x.key::uuid, gm.organization_id,
           COALESCE(CASE WHEN gm.scheduled_date IS NOT NULL THEN (gm.scheduled_date + COALESCE(gm.scheduled_time, time '12:00')) AT TIME ZONE 'Europe/Lisbon' END,
                    gm.created_at),
           1,
           CASE WHEN (gm.applied_winner_team = 'a' AND x.key::uuid IN (gm.team_a_player1_id, gm.team_a_player2_id))
                  OR (gm.applied_winner_team = 'b' AND x.key::uuid IN (gm.team_b_player1_id, gm.team_b_player2_id)) THEN 1 ELSE 0 END,
           x.value::numeric, 'g' || gm.id || x.key
      FROM group_matches gm CROSS JOIN LATERAL jsonb_each_text(gm.applied_elo_deltas) AS x
     WHERE gm.ranked_applied AND gm.applied_elo_deltas IS NOT NULL
  ), quem AS (
    SELECT DISTINCT ev.user_id FROM ev
     WHERE ev.at >= p_month::timestamp AT TIME ZONE 'Europe/Lisbon'
       AND ev.at < (p_month + interval '1 month')::timestamp AT TIME ZONE 'Europe/Lisbon'
  ), w AS (
    -- Jogos antes do evento = os de hoje menos os deste evento e dos seguintes.
    SELECT ev.*, COALESCE(p.rating_games, 0)
             - SUM(ev.games) OVER (PARTITION BY ev.user_id ORDER BY ev.at DESC, ev.ref DESC ROWS UNBOUNDED PRECEDING) AS antes
      FROM ev JOIN quem q ON q.user_id = ev.user_id JOIN profiles p ON p.id = ev.user_id
  )
  SELECT w.user_id, w.org, w.games, w.wins, CASE WHEN w.antes < 12 THEN w.d / 2 ELSE w.d END
    FROM w
   WHERE w.at >= p_month::timestamp AT TIME ZONE 'Europe/Lisbon'
     AND w.at < (p_month + interval '1 month')::timestamp AT TIME ZONE 'Europe/Lisbon';
$function$;
REVOKE ALL ON FUNCTION public.ranking_month_events(DATE) FROM PUBLIC, anon, authenticated;

-- ── 4. A tabela de um mês, num âmbito e num filtro (interna) ────────────
CREATE OR REPLACE FUNCTION public.ranking_month_table(p_month DATE, p_organization_id UUID, p_filter TEXT)
RETURNS TABLE(user_id UUID, place INTEGER, points INTEGER, games INTEGER, wins INTEGER, qualified BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH s AS (
    SELECT e.user_id, ROUND(SUM(e.points))::int AS points, SUM(e.games)::int AS games, SUM(e.wins)::int AS wins
      FROM ranking_month_events(p_month) e
      JOIN profiles p ON p.id = e.user_id
     WHERE (p_organization_id IS NULL OR e.organization_id = p_organization_id)
       AND NOT COALESCE(p.is_test, FALSE)
       AND COALESCE(btrim(p.name), '') <> ''
       AND e.user_id NOT IN (SELECT ranking_hidden_user_ids())
       AND (p_organization_id IS NULL OR NOT EXISTS (
             SELECT 1 FROM memberships m WHERE m.organization_id = p_organization_id AND m.user_id = e.user_id AND COALESCE(m.is_test, FALSE)))
       AND (COALESCE(p_filter, 'todos') = 'todos' OR p.gender = p_filter)
     GROUP BY e.user_id
  )
  SELECT s.user_id,
         CASE WHEN s.games >= 4 THEN (RANK() OVER (PARTITION BY s.games >= 4 ORDER BY s.points DESC, s.wins DESC, s.games DESC))::int END,
         s.points, s.games, s.wins, s.games >= 4
    FROM s;
$function$;
REVOKE ALL ON FUNCTION public.ranking_month_table(DATE, UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- ── 5. Fechar os meses que acabaram (pg_cron, a cada minuto) ────────────
CREATE OR REPLACE FUNCTION public.close_due_ranking_months()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_month DATE;
  v_now   DATE := ranking_current_month();
  v_org   UUID;
  v_f     TEXT;
  v_n     INTEGER := 0;
BEGIN
  v_month := COALESCE((SELECT max(month) + interval '1 month' FROM ranking_months)::date, DATE '2026-10-01');
  WHILE v_month < v_now LOOP
    INSERT INTO ranking_months (month) VALUES (v_month);
    FOREACH v_f IN ARRAY ARRAY['todos', 'masculino', 'feminino'] LOOP
      -- O geral.
      INSERT INTO ranking_month_places (month, organization_id, filter, user_id, place, points, games, wins)
      SELECT v_month, NULL, v_f, t.user_id, t.place, t.points, t.games, t.wins
        FROM ranking_month_table(v_month, NULL, v_f) t WHERE t.qualified;
      -- Cada clube ou grupo com jogos nesse mês (o global é o geral).
      FOR v_org IN
        SELECT DISTINCT e.organization_id FROM ranking_month_events(v_month) e
          JOIN organizations o ON o.id = e.organization_id
         WHERE NOT COALESCE(o.is_global, FALSE)
      LOOP
        INSERT INTO ranking_month_places (month, organization_id, filter, user_id, place, points, games, wins)
        SELECT v_month, v_org, v_f, t.user_id, t.place, t.points, t.games, t.wins
          FROM ranking_month_table(v_month, v_org, v_f) t WHERE t.qualified;
      END LOOP;
    END LOOP;
    v_n := v_n + 1;
    v_month := (v_month + interval '1 month')::date;
  END LOOP;
  RETURN v_n;
END;
$function$;
-- Interna: só o pg_cron a chama.
REVOKE ALL ON FUNCTION public.close_due_ranking_months() FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'close-ranking-months';
SELECT cron.schedule('close-ranking-months', '* * * * *', 'SELECT public.close_due_ranking_months()');

-- ── 6. As molduras de agora (interna) ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.ranking_frames_now()
RETURNS TABLE(user_id UUID, frame TEXT, place INTEGER, organization_id UUID, scope_name TEXT, month DATE, best BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH f AS (
    SELECT r.user_id, CASE r.place WHEN 1 THEN 'ouro' WHEN 2 THEN 'prata' ELSE 'bronze' END AS frame,
           r.place, r.organization_id, o.name AS scope_name, r.month
      FROM ranking_month_places r
      LEFT JOIN organizations o ON o.id = r.organization_id
     WHERE r.month = (ranking_current_month() - interval '1 month')::date
       AND r.filter = 'todos' AND r.place <= 3
  )
  SELECT f.*, ROW_NUMBER() OVER (PARTITION BY f.user_id ORDER BY f.place, (f.organization_id IS NULL) DESC, f.scope_name) = 1
    FROM f;
$function$;
REVOKE ALL ON FUNCTION public.ranking_frames_now() FROM PUBLIC, anon, authenticated;

-- ── 7. Para o ecrã ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_month_ranking(p_organization_id UUID DEFAULT NULL, p_month DATE DEFAULT NULL, p_gender TEXT DEFAULT NULL)
RETURNS TABLE(place INTEGER, user_id UUID, name TEXT, avatar_url TEXT, rating NUMERIC, gender TEXT,
              points INTEGER, games INTEGER, wins INTEGER, qualified BOOLEAN, is_me BOOLEAN, frame TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_org    UUID := p_organization_id;
  v_month  DATE := COALESCE(date_trunc('month', p_month)::date, ranking_current_month());
  v_filter TEXT := COALESCE(NULLIF(p_gender, ''), 'todos');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'no_session'; END IF;
  IF v_filter NOT IN ('todos', 'masculino', 'feminino') THEN RAISE EXCEPTION 'bad_filter'; END IF;
  IF v_org IS NOT NULL AND org_is_global(v_org) THEN v_org := NULL; END IF;
  -- Um clube: quem é de lá ou o organiza (como o «Ranking» de sempre).
  IF v_org IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = v_org AND m.user_id = auth.uid())
     AND NOT is_org_admin(v_org) THEN
    RAISE EXCEPTION 'not_a_member';
  END IF;
  IF v_month > ranking_current_month() OR v_month < DATE '2026-10-01' THEN RETURN; END IF;

  IF EXISTS (SELECT 1 FROM ranking_months rm WHERE rm.month = v_month) THEN
    -- Mês fechado: como ficou a dia 1 às 00:00.
    RETURN QUERY
      SELECT r.place, r.user_id, p.name, p.avatar_url, p.rating, p.gender, r.points, r.games, r.wins, TRUE,
             r.user_id = auth.uid(), fr.frame
        FROM ranking_month_places r
        JOIN profiles p ON p.id = r.user_id
        LEFT JOIN ranking_frames_now() fr ON fr.user_id = r.user_id AND fr.best
       WHERE r.month = v_month AND r.organization_id IS NOT DISTINCT FROM v_org AND r.filter = v_filter
       ORDER BY r.place, lower(p.name);
  ELSE
    -- Mês em curso (ou acabado há segundos, antes do fecho): na hora.
    RETURN QUERY
      SELECT t.place, t.user_id, p.name, p.avatar_url, p.rating, p.gender, t.points, t.games, t.wins, t.qualified,
             t.user_id = auth.uid(), fr.frame
        FROM ranking_month_table(v_month, v_org, v_filter) t
        JOIN profiles p ON p.id = t.user_id
        LEFT JOIN ranking_frames_now() fr ON fr.user_id = t.user_id AND fr.best
       WHERE t.qualified OR t.user_id = auth.uid()
       ORDER BY t.qualified DESC, t.place, lower(p.name);
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_month_ranking(UUID, DATE, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_month_ranking(UUID, DATE, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_month_ranking_months(p_organization_id UUID DEFAULT NULL)
RETURNS TABLE(month DATE, people INTEGER)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_org UUID := p_organization_id;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'no_session'; END IF;
  IF v_org IS NOT NULL AND org_is_global(v_org) THEN v_org := NULL; END IF;
  IF v_org IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = v_org AND m.user_id = auth.uid())
     AND NOT is_org_admin(v_org) THEN
    RAISE EXCEPTION 'not_a_member';
  END IF;
  RETURN QUERY
    SELECT r.month, count(*)::int
      FROM ranking_month_places r
     WHERE r.organization_id IS NOT DISTINCT FROM v_org AND r.filter = 'todos'
     GROUP BY r.month
     ORDER BY r.month DESC;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_month_ranking_months(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_month_ranking_months(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_user_frames(p_user_ids UUID[])
RETURNS TABLE(user_id UUID, frame TEXT, place INTEGER, organization_id UUID, scope_name TEXT, month DATE)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT f.user_id, f.frame, f.place, f.organization_id, f.scope_name, f.month
    FROM ranking_frames_now() f
   WHERE auth.uid() IS NOT NULL AND f.best AND f.user_id = ANY(p_user_ids);
$function$;
REVOKE ALL ON FUNCTION public.get_user_frames(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_frames(UUID[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_user_frame_list(p_user_id UUID)
RETURNS TABLE(frame TEXT, place INTEGER, organization_id UUID, scope_name TEXT, month DATE, best BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT f.frame, f.place, f.organization_id, f.scope_name, f.month, f.best
    FROM ranking_frames_now() f
   WHERE auth.uid() IS NOT NULL AND f.user_id = p_user_id
   ORDER BY f.place, (f.organization_id IS NULL) DESC, f.scope_name;
$function$;
REVOKE ALL ON FUNCTION public.get_user_frame_list(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_frame_list(UUID) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT count(*) FROM cron.job WHERE jobname = 'close-ranking-months';  -- 1
--   SELECT has_function_privilege('anon', 'public.get_month_ranking(uuid,date,text)', 'EXECUTE');  -- false
--   SELECT has_function_privilege('authenticated', 'public.close_due_ranking_months()', 'EXECUTE');  -- false
--   SELECT has_table_privilege('authenticated', 'public.ranking_month_places', 'SELECT');  -- false
