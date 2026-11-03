-- ═════════════════════════════════════════════════════════════════════════
-- Zona de cada pessoa no Ranking do mês e nos prémios dos parceiros (#731)
--
-- PORQUÊ. Francisco, 28 out: «os prémios deveriam ser dados pela localização da
-- pessoa». Até aqui a tabela de uma zona somava os pontos feitos nos grupos desse
-- distrito: a mesma pessoa aparecia em várias zonas, com os pontos divididos.
-- Regra: design-handoff/2026-10-28-zona-dos-premios/REGRA-BA.md. Plano aprovado
-- pelo Francisco a 3 nov: PLANO-DEV3.md na mesma pasta.
--
-- A REGRA, a partir de novembro de 2026 (outubro fica como fechou):
--   · A zona da pessoa no mês é o distrito onde jogou mais jogos. Empate: mais
--     pontos; depois, o último jogo.
--   · De que distrito é um jogo: o do grupo ou clube; se o grupo não tiver, o do
--     sítio. Jogos entre amigos: sempre o do sítio. Sem nenhum, não decide a zona,
--     mas os pontos contam na mesma.
--   · A tabela da zona são as pessoas dessa zona, com os pontos, jogos e vitórias
--     do Global. Cada pessoa aparece numa zona só. 4 jogos, contados todos juntos.
--   · No fim do mês a zona fica guardada. Um mês fechado lê o que ficou guardado,
--     como o Global: o pódio e os vouchers saem dos mesmos números que se veem.
--
-- O QUE ACRESCENTA
--   · place_district em games, game_recurrences, tournaments, private_matches e
--     group_matches. Só aceita os nomes de src/lib/leagueDistricts.js, ou nada.
--     Cada mix de uma série copia-o da série (gatilho, sem mexer na função das
--     séries).
--   · ranking_month_zones: mês, pessoa, zona, jogos lá, jogos no total.
--   · get_my_month_zone(p_month): a zona da própria pessoa, para o ecrã.
--   · set_place_district(p_kind, p_id, p_district): grava o distrito do sítio de
--     um torneio, jogo entre amigos ou jogo de grupo, que se criam por funções de
--     assinatura longa. Mix e série gravam-no diretamente, com o resto do sítio.
--   · create_self_serve_group ganha p_district. A app antiga cria sem distrito.
--   · search_club_places passa a dizer o distrito do clube: escolher um clube da
--     lista não passa pela Google. A app antiga ignora a coluna a mais.
--
-- O QUE A APP ANTIGA VÊ. Nenhum nome muda. As colunas novas ficam vazias.
-- Editar o sítio de um jogo numa app antiga deixa o distrito que lá estava.
--
-- ORDEM. Depois de migration_podio_do_mes_grupos_globais.sql e de
-- migration_parceiros_2_rm_real.sql (já corridas em produção). Tem de estar em
-- produção antes de 1 dez, primeiro pódio com prémios da RM.
--
-- Dev 3, 3 nov 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- Só troca se os corpos de hoje forem os esperados, ou se já estiverem trocados.
DO $$
DECLARE
  r RECORD;
  v_src TEXT;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('public.ranking_month_events(date)',        '0c02fe1c6523a1da548a5d13353f0324', 'ranking_month_event_rows'),
      ('public.ranking_month_zone_table(date,text,text)', '9bbb9612441d9699626c5edd5d5e0eb5', 'ranking_month_person_zones'),
      ('public.award_month_podium(date)',          '257dbdc18d3ecdc163a95119217d0836', 'ranking_month_zones_of'),
      ('public.close_due_ranking_months()',        'fbc20873059d563bede160120affc88b', 'ranking_month_zones'),
      ('public.list_my_partner_cards()',           'e446d28b9a8dc343dff9debbd3b8526e', 'ranking_my_recent_zones'),
      ('public.get_my_month_prize_offers()',       'd519209fb50604642a3a32c70aa11e03', 'ranking_my_recent_zones'),
      ('public.search_club_places(text)',          '9ec987f84a82ce5e1298e14cc473199d', 'o.district')
    ) AS t(sig, md5_hoje, marca)
  LOOP
    SELECT prosrc INTO v_src FROM pg_proc WHERE oid = to_regprocedure(r.sig);
    IF v_src IS NULL THEN RAISE EXCEPTION '% não existe. Parar.', r.sig; END IF;
    IF md5(replace(v_src, E'\r', '')) <> r.md5_hoje AND position(r.marca IN v_src) = 0 THEN
      RAISE EXCEPTION '%: o corpo não é o esperado (md5 %). Parar.', r.sig, md5(replace(v_src, E'\r', ''));
    END IF;
  END LOOP;

  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = to_regprocedure('public.create_self_serve_group(text,text)');
  IF v_src IS NOT NULL AND md5(replace(v_src, E'\r', '')) <> '925c79cfe3909203a91b15f5a9445fdd' THEN
    RAISE EXCEPTION 'create_self_serve_group: o corpo não é o esperado (md5 %). Parar.', md5(replace(v_src, E'\r', ''));
  END IF;
  IF v_src IS NULL AND to_regprocedure('public.create_self_serve_group(text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'create_self_serve_group não existe. Parar.';
  END IF;
END $$;


-- ─── «Criar o meu grupo» grava o distrito ────────────────────────────────

-- Os nomes de src/lib/leagueDistricts.js. Quem escreve nas tabelas passa por esta
-- função no CHECK, por isso authenticated tem de a poder chamar.
CREATE OR REPLACE FUNCTION public.is_place_district(p_district TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = public
AS $function$
  SELECT p_district IS NULL OR p_district = ANY (ARRAY[
    'Aveiro', 'Beja', 'Braga', 'Bragança', 'Castelo Branco', 'Coimbra', 'Évora', 'Faro', 'Guarda',
    'Leiria', 'Lisboa', 'Portalegre', 'Porto', 'Santarém', 'Setúbal', 'Viana do Castelo', 'Vila Real', 'Viseu',
    'Açores', 'Madeira']);
$function$;

REVOKE ALL ON FUNCTION public.is_place_district(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_place_district(TEXT) TO authenticated, service_role;

-- Acrescentar só um parâmetro deixava duas versões e o «not unique» na app antiga.
DROP FUNCTION IF EXISTS public.create_self_serve_group(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.create_self_serve_group(p_name TEXT, p_slug TEXT, p_district TEXT DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_org_id UUID;
  v_name TEXT := TRIM(COALESCE(p_name, ''));
  v_slug TEXT := TRIM(COALESCE(p_slug, ''));
  v_district TEXT := NULLIF(TRIM(COALESCE(p_district, '')), '');
  v_blocking_name TEXT;
BEGIN
  IF auth.uid() IS NULL
     OR COALESCE((auth.jwt()->>'is_anonymous')::boolean, FALSE) THEN
    RAISE EXCEPTION 'Precisas de uma conta registada para criar um grupo';
  END IF;

  IF v_name = '' THEN
    RAISE EXCEPTION 'O nome do grupo não pode estar vazio';
  END IF;
  IF v_slug = '' THEN
    RAISE EXCEPTION 'O identificador do grupo não pode estar vazio';
  END IF;
  IF v_slug !~ '^[a-z0-9-]+$' THEN
    RAISE EXCEPTION 'O identificador só pode conter letras minúsculas, números e hífens';
  END IF;
  IF NOT is_place_district(v_district) THEN
    RAISE EXCEPTION 'bad_district';
  END IF;

  -- Um grupo Free/Squad por dono (ver cabeçalho). Era: "já és admin de um
  -- grupo self-serve".
  SELECT o.name INTO v_blocking_name
  FROM organizations o
  WHERE o.owner_id = auth.uid()
    AND o.parent_organization_id IS NULL
    AND COALESCE(o.plan_tier, 'free') = 'free'
  LIMIT 1;

  IF v_blocking_name IS NOT NULL THEN
    RAISE EXCEPTION 'Já tens um grupo grátis (%). Para criares outro, passa esse grupo a um plano pago.', v_blocking_name USING HINT = 'already_has_free_group';
  END IF;

  IF organization_name_taken(v_name) THEN
    RAISE EXCEPTION 'name_taken';
  END IF;
  INSERT INTO organizations (name, slug, kind, parent_organization_id, self_serve, is_global, open_join, district)
  VALUES (v_name, v_slug, 'group', NULL, TRUE, FALSE, FALSE, v_district)
  RETURNING id INTO v_org_id;

  -- trg_set_owner_on_first_admin torna quem cria dono do grupo.
  INSERT INTO memberships (user_id, organization_id, is_admin)
  VALUES (auth.uid(), v_org_id, TRUE);

  RETURN v_org_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_self_serve_group(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_self_serve_group(TEXT, TEXT, TEXT) TO authenticated, service_role;


-- ─── O distrito do sítio ─────────────────────────────────────────────────

DO $$
DECLARE v_t TEXT;
BEGIN
  FOREACH v_t IN ARRAY ARRAY['games', 'game_recurrences', 'tournaments', 'private_matches', 'group_matches'] LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS place_district TEXT', v_t);
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = format('public.%I', v_t)::regclass AND conname = v_t || '_place_district_check') THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (is_place_district(place_district))', v_t, v_t || '_place_district_check');
    END IF;
  END LOOP;
END $$;

-- Cada mix de uma série copia o distrito do sítio da série.
CREATE OR REPLACE FUNCTION public.games_inherit_place_district()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public
AS $function$
BEGIN
  IF NEW.recurrence_id IS NOT NULL AND NEW.place_district IS NULL THEN
    SELECT place_district INTO NEW.place_district FROM game_recurrences WHERE id = NEW.recurrence_id;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.games_inherit_place_district() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS games_inherit_place_district_trigger ON public.games;
CREATE TRIGGER games_inherit_place_district_trigger
  BEFORE INSERT ON public.games
  FOR EACH ROW EXECUTE FUNCTION public.games_inherit_place_district();

-- Torneios, jogos entre amigos e jogos de grupo só se escrevem por funções, e
-- estas não têm um parâmetro para isto. Pode quem pode editar o resto.
CREATE OR REPLACE FUNCTION public.set_place_district(p_kind TEXT, p_id UUID, p_district TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_district TEXT := NULLIF(btrim(COALESCE(p_district, '')), '');
  v_org UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'no_session'; END IF;
  IF NOT is_place_district(v_district) THEN RAISE EXCEPTION 'bad_district'; END IF;

  IF p_kind = 'tournament' THEN
    IF NOT is_tournament_admin(p_id) THEN RAISE EXCEPTION 'not_allowed'; END IF;
    UPDATE tournaments SET place_district = v_district WHERE id = p_id;
  ELSIF p_kind = 'friend_match' THEN
    IF NOT friend_match_is_organizer(p_id) THEN RAISE EXCEPTION 'not_allowed'; END IF;
    UPDATE private_matches SET place_district = v_district WHERE id = p_id;
  ELSIF p_kind = 'group_match' THEN
    SELECT organization_id INTO v_org FROM group_matches WHERE id = p_id;
    IF v_org IS NULL OR NOT is_org_admin(v_org) THEN RAISE EXCEPTION 'not_allowed'; END IF;
    UPDATE group_matches SET place_district = v_district WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'bad_kind';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_place_district(TEXT, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_place_district(TEXT, UUID, TEXT) TO authenticated, service_role;

-- O distrito do clube escolhido da lista. organizations.district é texto livre: um
-- nome fora da lista vem vazio, para não fazer recusar o jogo que o grava.
-- Muda o que devolve, por isso tem de se apagar primeiro.
DROP FUNCTION IF EXISTS public.search_club_places(TEXT);

CREATE OR REPLACE FUNCTION public.search_club_places(p_query TEXT)
RETURNS TABLE(id UUID, name TEXT, location TEXT, latitude NUMERIC, longitude NUMERIC, district TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $function$
  SELECT o.id, o.name, o.location, o.latitude, o.longitude,
         CASE WHEN is_place_district(btrim(o.district)) THEN btrim(o.district) END
  FROM organizations o
  WHERE o.kind = 'club'
    AND o.parent_organization_id IS NULL
    AND org_is_findable(o)
    AND coalesce(btrim(o.location), '') <> ''
    AND length(btrim(coalesce(p_query, ''))) >= 2
    AND NOT EXISTS (
      SELECT 1 FROM regexp_split_to_table(lower(sem_acentos(btrim(p_query))), '[[:space:]]+') w
      WHERE w <> ''
        AND lower(sem_acentos(o.name || ' ' || o.location)) NOT LIKE '%' || w || '%'
    )
  ORDER BY (lower(sem_acentos(o.name)) LIKE lower(sem_acentos(btrim(p_query))) || '%') DESC, o.name
  LIMIT 4;
$function$;

REVOKE ALL ON FUNCTION public.search_club_places(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_club_places(TEXT) TO authenticated, service_role;


-- ─── A zona guardada no fim do mês ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ranking_month_zones (
  month       DATE NOT NULL REFERENCES ranking_months(month) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  district    TEXT,            -- vazio: jogou, mas nenhum jogo tinha distrito
  zone_games  INTEGER NOT NULL,
  total_games INTEGER NOT NULL,
  PRIMARY KEY (month, user_id)
);
CREATE INDEX IF NOT EXISTS ranking_month_zones_month_district_idx ON public.ranking_month_zones (month, district);

ALTER TABLE public.ranking_month_zones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ranking_month_zones FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ranking_month_zones TO service_role;


-- ─── A conta ─────────────────────────────────────────────────────────────

-- O corpo de ranking_month_events, com o momento do jogo e o distrito. É a única
-- conta dos pontos: ranking_month_events passa a ler daqui.
CREATE OR REPLACE FUNCTION public.ranking_month_event_rows(p_month DATE)
RETURNS TABLE(user_id UUID, organization_id UUID, played_at TIMESTAMPTZ, games INTEGER, wins INTEGER, points NUMERIC, district TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $function$
  WITH ev AS (
    SELECT s.user_id, g.organization_id AS org, g.date AS at,
           COALESCE(s.matches_played, 0) AS games, COALESCE(s.matches_won, 0) AS wins, s.rating_delta AS d, 'm' || s.id AS ref,
           g.place_district AS place, FALSE AS so_sitio
      FROM mix_player_stats s JOIN games g ON g.id = s.game_id
     WHERE s.rating_delta IS NOT NULL
    UNION ALL
    SELECT s.user_id, t.organization_id,
           COALESCE(CASE WHEN c.day_date IS NOT NULL THEN (c.day_date + COALESCE(c.start_time, time '00:00')) AT TIME ZONE 'Europe/Lisbon' END,
                    t.starts_on::timestamp AT TIME ZONE 'Europe/Lisbon', s.created_at),
           COALESCE(s.matches_played, 0), COALESCE(s.matches_won, 0), s.rating_delta, 't' || s.id,
           t.place_district, FALSE
      FROM tournament_player_stats s
      JOIN tournament_categories c ON c.id = s.category_id
      JOIN tournaments t ON t.id = c.tournament_id
     WHERE s.rating_delta IS NOT NULL
    UNION ALL
    -- Jogos entre amigos: contam sempre pelo sítio. O sítio está na sessão, ou no
    -- jogo de que este é o par.
    SELECT s.user_id, pm.organization_id,
           COALESCE(CASE WHEN pm.scheduled_date IS NOT NULL THEN (pm.scheduled_date + COALESCE(pm.scheduled_time, time '12:00')) AT TIME ZONE 'Europe/Lisbon' END,
                    pm.played_at, pm.created_at),
           1, CASE WHEN s.won THEN 1 ELSE 0 END, s.rating_delta, 'p' || s.id,
           COALESCE(pm.place_district, sessao.place_district, par.place_district), TRUE
      FROM private_match_stats s
      JOIN private_matches pm ON pm.id = s.private_match_id
      LEFT JOIN private_matches sessao ON sessao.id = pm.session_id
      LEFT JOIN private_matches par ON par.id = pm.friend_pair_of
     WHERE s.rating_delta IS NOT NULL
    UNION ALL
    SELECT x.key::uuid, gm.organization_id,
           COALESCE(CASE WHEN gm.scheduled_date IS NOT NULL THEN (gm.scheduled_date + COALESCE(gm.scheduled_time, time '12:00')) AT TIME ZONE 'Europe/Lisbon' END,
                    gm.created_at),
           1,
           CASE WHEN (gm.applied_winner_team = 'a' AND x.key::uuid IN (gm.team_a_player1_id, gm.team_a_player2_id))
                  OR (gm.applied_winner_team = 'b' AND x.key::uuid IN (gm.team_b_player1_id, gm.team_b_player2_id)) THEN 1 ELSE 0 END,
           x.value::numeric, 'g' || gm.id || x.key,
           gm.place_district, FALSE
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
  SELECT w.user_id, w.org, w.at, w.games, w.wins, CASE WHEN w.antes < 12 THEN w.d / 2 ELSE w.d END,
         CASE WHEN w.so_sitio THEN w.place ELSE COALESCE(NULLIF(btrim(o.district), ''), w.place) END
    FROM w
    LEFT JOIN organizations o ON o.id = w.org
   WHERE w.at >= p_month::timestamp AT TIME ZONE 'Europe/Lisbon'
     AND w.at < (p_month + interval '1 month')::timestamp AT TIME ZONE 'Europe/Lisbon';
$function$;

REVOKE ALL ON FUNCTION public.ranking_month_event_rows(DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ranking_month_event_rows(DATE) TO service_role;

CREATE OR REPLACE FUNCTION public.ranking_month_events(p_month DATE)
RETURNS TABLE(user_id UUID, organization_id UUID, games INTEGER, wins INTEGER, points NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $function$
  SELECT e.user_id, e.organization_id, e.games, e.wins, e.points FROM ranking_month_event_rows(p_month) e;
$function$;

REVOKE ALL ON FUNCTION public.ranking_month_events(DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ranking_month_events(DATE) TO service_role;

-- A zona de cada pessoa, a partir dos jogos do mês. Uma linha por quem jogou;
-- district vazio quando nenhum jogo tinha distrito.
CREATE OR REPLACE FUNCTION public.ranking_month_person_zones(p_month DATE)
RETURNS TABLE(user_id UUID, district TEXT, zone_games INTEGER, total_games INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $function$
  WITH e AS (
    SELECT * FROM ranking_month_event_rows(p_month)
  ), total AS (
    SELECT e.user_id, SUM(e.games)::int AS n FROM e GROUP BY e.user_id
  ), por_distrito AS (
    SELECT e.user_id, e.district, SUM(e.games)::int AS n, SUM(e.points) AS pts, MAX(e.played_at) AS ultimo
      FROM e WHERE e.district IS NOT NULL
     GROUP BY e.user_id, e.district
    HAVING SUM(e.games) > 0
  ), melhor AS (
    SELECT DISTINCT ON (d.user_id) d.user_id, d.district, d.n
      FROM por_distrito d
     ORDER BY d.user_id, d.n DESC, d.pts DESC, d.ultimo DESC, d.district
  )
  SELECT total.user_id, melhor.district, COALESCE(melhor.n, 0), total.n
    FROM total LEFT JOIN melhor ON melhor.user_id = total.user_id;
$function$;

REVOKE ALL ON FUNCTION public.ranking_month_person_zones(DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ranking_month_person_zones(DATE) TO service_role;

-- Mês fechado: o que ficou guardado (outubro não tem nada, fechou com a regra
-- antiga). Mês em curso: na hora.
CREATE OR REPLACE FUNCTION public.ranking_month_zones_of(p_month DATE)
RETURNS TABLE(user_id UUID, district TEXT, zone_games INTEGER, total_games INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $function$
  SELECT z.user_id, z.district, z.zone_games, z.total_games
    FROM ranking_month_zones z WHERE z.month = p_month
  UNION ALL
  SELECT l.user_id, l.district, l.zone_games, l.total_games
    FROM ranking_month_person_zones(p_month) l
   WHERE NOT EXISTS (SELECT 1 FROM ranking_months rm WHERE rm.month = p_month);
$function$;

REVOKE ALL ON FUNCTION public.ranking_month_zones_of(DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ranking_month_zones_of(DATE) TO service_role;

-- Mesma assinatura. Os meses antes de novembro continuam com a conta antiga.
CREATE OR REPLACE FUNCTION public.ranking_month_zone_table(p_month DATE, p_district TEXT, p_filter TEXT)
RETURNS TABLE(user_id UUID, place INTEGER, points INTEGER, games INTEGER, wins INTEGER, qualified BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  IF p_month < DATE '2026-11-01' THEN
    RETURN QUERY
      WITH s AS (
        SELECT t.user_id, SUM(t.points)::int AS points, SUM(t.games)::int AS games, SUM(t.wins)::int AS wins
          FROM organizations o
          CROSS JOIN LATERAL ranking_month_table(p_month, o.id, p_filter) t
         WHERE o.district = p_district
         GROUP BY t.user_id
      )
      SELECT s.user_id,
             CASE WHEN s.games >= 4 THEN (RANK() OVER (PARTITION BY s.games >= 4 ORDER BY s.points DESC, s.wins DESC, s.games DESC))::int END,
             s.points, s.games, s.wins, s.games >= 4
        FROM s;
  ELSIF EXISTS (SELECT 1 FROM ranking_months rm WHERE rm.month = p_month) THEN
    -- Mês fechado: como ficou a dia 1 às 00:00, os números do Global, só com quem
    -- ficou com 4 jogos.
    RETURN QUERY
      SELECT r.user_id,
             (RANK() OVER (ORDER BY r.points DESC, r.wins DESC, r.games DESC))::int,
             r.points, r.games, r.wins, TRUE
        FROM ranking_month_places r
        JOIN ranking_month_zones z ON z.month = r.month AND z.user_id = r.user_id
       WHERE r.month = p_month AND r.organization_id IS NULL
         AND r.filter = COALESCE(p_filter, 'todos') AND z.district = p_district;
  ELSE
    RETURN QUERY
      SELECT t.user_id,
             CASE WHEN t.games >= 4 THEN (RANK() OVER (PARTITION BY t.games >= 4 ORDER BY t.points DESC, t.wins DESC, t.games DESC))::int END,
             t.points, t.games, t.wins, t.games >= 4
        FROM ranking_month_table(p_month, NULL, p_filter) t
        JOIN ranking_month_person_zones(p_month) z ON z.user_id = t.user_id
       WHERE z.district = p_district;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.ranking_month_zone_table(DATE, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ranking_month_zone_table(DATE, TEXT, TEXT) TO service_role;

-- Corre logo a seguir a guardar a zona. Vale também para os distritos que só
-- existem pelo sítio dos jogos, sem nenhum grupo lá.
CREATE OR REPLACE FUNCTION public.award_month_podium(p_month DATE)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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
  FOR v_d IN SELECT DISTINCT z.district FROM ranking_month_zones_of(v_month) z WHERE z.district IS NOT NULL LOOP
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
GRANT EXECUTE ON FUNCTION public.award_month_podium(DATE) TO service_role;

CREATE OR REPLACE FUNCTION public.close_due_ranking_months()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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
    -- A zona de cada pessoa fica guardada (#731), antes do pódio que sai dela.
    IF v_month >= DATE '2026-11-01' THEN
      INSERT INTO ranking_month_zones (month, user_id, district, zone_games, total_games)
      SELECT v_month, z.user_id, z.district, z.zone_games, z.total_games
        FROM ranking_month_person_zones(v_month) z;
    END IF;
    -- Pódio do Mês (26 out): os 3 primeiros de cada zona.
    PERFORM award_month_podium(v_month);
    v_n := v_n + 1;
    v_month := (v_month + interval '1 month')::date;
  END LOOP;
  RETURN v_n;
END;
$function$;

REVOKE ALL ON FUNCTION public.close_due_ranking_months() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_due_ranking_months() TO service_role;


-- ─── Para o ecrã ─────────────────────────────────────────────────────────

-- A minha zona no mês. Combinado com o Dev 2 a 28 out. Antes de novembro de 2026
-- vem sempre sem zona: o ecrã nem mostra a linha.
CREATE OR REPLACE FUNCTION public.get_my_month_zone(p_month DATE DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_month DATE := COALESCE(date_trunc('month', p_month)::date, ranking_current_month());
  v_district TEXT;
  v_zone  INTEGER;
  v_total INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'no_session'; END IF;
  IF v_month >= DATE '2026-11-01' AND v_month <= ranking_current_month() THEN
    SELECT z.district, z.zone_games, z.total_games INTO v_district, v_zone, v_total
      FROM ranking_month_zones_of(v_month) z WHERE z.user_id = auth.uid();
  END IF;
  RETURN jsonb_build_object(
    'month', v_month,
    'district', v_district,
    'zone_games', COALESCE(v_zone, 0),
    'total_games', COALESCE(v_total, 0),
    'final', EXISTS (SELECT 1 FROM ranking_months rm WHERE rm.month = v_month));
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_month_zone(DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_month_zone(DATE) TO authenticated, service_role;


-- ─── Parceiros: quem joga na zona também vê o cartão e a oferta ──────────

-- A minha zona este mês e no mês passado.
CREATE OR REPLACE FUNCTION public.ranking_my_recent_zones()
RETURNS SETOF TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $function$
  SELECT z.district
    FROM unnest(ARRAY[ranking_current_month(), (ranking_current_month() - interval '1 month')::date]) AS m(month)
    CROSS JOIN LATERAL ranking_month_zones_of(m.month) z
   WHERE z.user_id = auth.uid() AND z.district IS NOT NULL;
$function$;

REVOKE ALL ON FUNCTION public.ranking_my_recent_zones() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ranking_my_recent_zones() TO service_role;

-- Nunca se tira o cartão a quem já o vê.
CREATE OR REPLACE FUNCTION public.list_my_partner_cards()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $function$
  SELECT COALESCE(jsonb_agg(partner_json(p.id) ORDER BY p.created_at, p.name), '[]'::jsonb)
    FROM partners p
   WHERE p.active AND auth.uid() IS NOT NULL
     AND (p.district IN (SELECT o.district FROM memberships m JOIN organizations o ON o.id = m.organization_id
                          WHERE m.user_id = auth.uid() AND o.district IS NOT NULL)
          OR p.district IN (SELECT ranking_my_recent_zones()));
$function$;

REVOKE ALL ON FUNCTION public.list_my_partner_cards() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_partner_cards() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_my_month_prize_offers()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $function$
  WITH me AS (SELECT auth.uid() AS uid, ranking_current_month() AS mon),
  zones AS (
    SELECT DISTINCT o.district
      FROM memberships mb JOIN organizations o ON o.id = mb.organization_id, me
     WHERE mb.user_id = me.uid AND NOT COALESCE(mb.is_guest, FALSE) AND o.district IS NOT NULL
    UNION
    SELECT z FROM ranking_my_recent_zones() AS z
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
GRANT EXECUTE ON FUNCTION public.get_my_month_prize_offers() TO authenticated, service_role;

COMMIT;

-- Verificar depois de correr:
--   SELECT count(*) FROM information_schema.columns
--    WHERE table_schema = 'public' AND column_name = 'place_district';                 → 5
--   SELECT has_function_privilege('anon', 'public.get_my_month_zone(date)', 'EXECUTE'),
--          has_function_privilege('authenticated', 'public.get_my_month_zone(date)', 'EXECUTE'),
--          has_function_privilege('anon', 'public.create_self_serve_group(text,text,text)', 'EXECUTE'),
--          has_function_privilege('authenticated', 'public.create_self_serve_group(text,text,text)', 'EXECUTE'),
--          has_function_privilege('authenticated', 'public.ranking_month_person_zones(date)', 'EXECUTE'),
--          to_regprocedure('public.create_self_serve_group(text,text)') IS NULL;       → false, true, false, true, false, true
--   SELECT count(*) FROM ranking_month_zones;                                           → 0 até fechar novembro
