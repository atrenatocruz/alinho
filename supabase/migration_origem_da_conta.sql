-- ═════════════════════════════════════════════════════════════════════════
-- Origem da conta (#688): de onde veio cada conta nova e quem a convidou
--
-- PORQUÊ. Teste de publicidade paga aprovado pelo Francisco (18 out,
-- design-handoff/2026-10-18-publicidade-paga/PLANO.md): não se gasta nada
-- sem saber de onde vem cada conta. Plano dos dados: okay do Francisco a
-- 19 out. Colunas e cortes: Marketing e BA (19 out). Também é a base das
-- conquistas de convites (#625), que contam só quem jogou.
--
-- O QUE FAZ
--   · user_invite_codes: um código curto por pessoa, que vai como ?ref= nos
--     links que ela partilha.
--   · account_origins: por conta nova, a origem (?origem= do link) e quem a
--     convidou. Grava-se uma vez, só em contas criadas há menos de 48 horas.
--     Ninguém a lê pela app: só os relatórios dos superadmins.
--   · account_origin_type: o tipo de origem pelo prefixo do nome (anúncio
--     pago, redes, QR, convites…). Para acrescentar um tipo, muda-se só esta.
--     Quem chegou só com o código de quem convidou (sem ?origem=) aparece como
--     «(convite pessoal)».
--   · Relatórios (só superadmins, com o modo ligado):
--       get_account_origin_report(p_from, p_to, p_period, p_group, p_district)
--       get_invite_report(p_from, p_to)
--
-- PARA O ECRÃ (Dev 4)
--   get_my_invite_code() → TEXT (o ?ref= de quem partilha).
--   set_my_account_origin(p_origin, p_ref_code) → BOOLEAN, logo a seguir à
--     primeira sessão. false = não gravou (conta antiga, já gravada, nada
--     válido); nunca dá erro por isso.
--   Origem: letras minúsculas, números, - e _, até 60 (o resto ignora-se).
--
-- ORDEM. Produção no main de 23 out, com a Política nova (PO). Precisa da
-- migration_superadmin_modo.sql (is_platform_admin_me), que já correu.
--
-- Dev 3, 19 out 2026 · ecrã: Dev 4 · relatório: Marketing e BA
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Tabelas (sem acesso direto) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_invite_codes (
  user_id    UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  code       TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.account_origins (
  user_id     UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  origin      TEXT CHECK (origin ~ '^[a-z0-9_-]{1,60}$'),
  ref_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_account_origins_ref ON public.account_origins (ref_user_id) WHERE ref_user_id IS NOT NULL;
ALTER TABLE public.user_invite_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_origins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_invite_codes, public.account_origins FROM PUBLIC, anon, authenticated;

-- ── 2. O meu código de convite ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_invite_code()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  c_letras CONSTANT TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'no_session'; END IF;
  SELECT code INTO v_code FROM user_invite_codes WHERE user_id = auth.uid();
  IF v_code IS NOT NULL THEN RETURN v_code; END IF;
  LOOP
    SELECT string_agg(substr(c_letras, 1 + floor(random() * length(c_letras))::int, 1), '')
      INTO v_code FROM generate_series(1, 7);
    BEGIN
      INSERT INTO user_invite_codes (user_id, code) VALUES (auth.uid(), v_code);
      RETURN v_code;
    EXCEPTION WHEN unique_violation THEN
      -- Outro pedido meu ao mesmo tempo, ou o código já existe: tenta de novo.
      SELECT code INTO v_code FROM user_invite_codes WHERE user_id = auth.uid();
      IF v_code IS NOT NULL THEN RETURN v_code; END IF;
    END;
  END LOOP;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_my_invite_code() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_invite_code() TO authenticated;

-- ── 3. Gravar a origem da conta nova ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_my_account_origin(p_origin TEXT, p_ref_code TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_origin TEXT := NULLIF(lower(btrim(p_origin)), '');
  v_ref    UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'no_session'; END IF;
  -- Só contas novas, e uma vez.
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = auth.uid() AND u.created_at > NOW() - interval '48 hours') THEN
    RETURN FALSE;
  END IF;
  IF EXISTS (SELECT 1 FROM account_origins WHERE user_id = auth.uid()) THEN RETURN FALSE; END IF;
  IF v_origin IS NOT NULL AND v_origin !~ '^[a-z0-9_-]{1,60}$' THEN v_origin := NULL; END IF;
  SELECT c.user_id INTO v_ref FROM user_invite_codes c WHERE c.code = upper(btrim(p_ref_code));
  IF v_ref = auth.uid() THEN v_ref := NULL; END IF;
  IF v_origin IS NULL AND v_ref IS NULL THEN RETURN FALSE; END IF;
  INSERT INTO account_origins (user_id, origin, ref_user_id) VALUES (auth.uid(), v_origin, v_ref)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN FOUND;
END;
$function$;
REVOKE ALL ON FUNCTION public.set_my_account_origin(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_account_origin(TEXT, TEXT) TO authenticated;

-- ── 4. O tipo de origem, pelo prefixo (interna) ─────────────────────────
CREATE OR REPLACE FUNCTION public.account_origin_type(p_origin TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $function$
  SELECT CASE
    WHEN p_origin IS NULL                                        THEN '(sem origem)'
    WHEN p_origin ~ '^(meta|tiktok-ads|google)-'                 THEN 'Anúncio pago'
    WHEN p_origin IN ('ig-bio', 'fb-pagina', 'tiktok-bio')       THEN 'Perfil nas redes'
    WHEN p_origin ~ '^(post|story)-'                             THEN 'Post ou story'
    WHEN p_origin ~ '^qr-'                                       THEN 'Cartaz com QR'
    WHEN p_origin ~ '^(partilha|cartao)-'                        THEN 'Cartão de partilha'
    WHEN p_origin ~ '^influencer-'                               THEN 'Influencer'
    WHEN p_origin ~ '^parceiro-'                                 THEN 'Parceiro'
    WHEN p_origin = 'convite-grupo'                              THEN 'Convite de grupo'
    WHEN p_origin IN ('convite-mix', 'convite-torneio')          THEN 'Convite de parceiro de jogo'
    WHEN p_origin = 'convite-amigos'                             THEN 'Convite de jogo entre amigos'
    ELSE 'Outro'
  END;
$function$;
REVOKE ALL ON FUNCTION public.account_origin_type(TEXT) FROM PUBLIC, anon, authenticated;

-- ── 5. Os jogos de cada pessoa, com data (interna) ──────────────────────
-- Só o que conta (com rating_delta), como o Ranking do mês.
CREATE OR REPLACE FUNCTION public.account_played_events(p_user_ids UUID[])
RETURNS TABLE(user_id UUID, at TIMESTAMPTZ, matches INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT s.user_id, g.date, COALESCE(s.matches_played, 0)
    FROM mix_player_stats s JOIN games g ON g.id = s.game_id
   WHERE s.rating_delta IS NOT NULL AND s.user_id = ANY(p_user_ids)
  UNION ALL
  SELECT s.user_id, s.created_at, COALESCE(s.matches_played, 0)
    FROM tournament_player_stats s
   WHERE s.rating_delta IS NOT NULL AND s.user_id = ANY(p_user_ids)
  UNION ALL
  SELECT s.user_id, s.created_at, 1
    FROM private_match_stats s
   WHERE s.rating_delta IS NOT NULL AND s.user_id = ANY(p_user_ids)
  UNION ALL
  SELECT x.key::uuid,
         COALESCE(CASE WHEN gm.scheduled_date IS NOT NULL THEN (gm.scheduled_date + COALESCE(gm.scheduled_time, time '12:00')) AT TIME ZONE 'Europe/Lisbon' END,
                  gm.created_at),
         1
    FROM group_matches gm CROSS JOIN LATERAL jsonb_each_text(gm.applied_elo_deltas) AS x
   WHERE gm.ranked_applied AND gm.applied_elo_deltas IS NOT NULL AND x.key::uuid = ANY(p_user_ids);
$function$;
REVOKE ALL ON FUNCTION public.account_played_events(UUID[]) FROM PUBLIC, anon, authenticated;

-- ── 6. Relatório por origem (superadmins) ───────────────────────────────
-- Contas criadas entre p_from e p_to (inclusive, hora de Lisboa), sem contas
-- de teste. p_period: 'total' | 'semana' | 'mes'. p_group: 'origem' | 'tipo'.
-- p_district: a zona do primeiro clube ou grupo em que a conta entrou.
-- Tudo o que é «30 dias» conta a partir da criação da conta (ou do grupo).
CREATE OR REPLACE FUNCTION public.get_account_origin_report(
  p_from DATE, p_to DATE, p_period TEXT DEFAULT 'total', p_group TEXT DEFAULT 'origem', p_district TEXT DEFAULT NULL)
RETURNS TABLE(period DATE, origin TEXT, origin_type TEXT,
              accounts INTEGER, played_7d INTEGER, played_30d INTEGER, played_again_30d INTEGER, games_30d INTEGER,
              groups_created INTEGER, groups_with_mix_30d INTEGER, people_in_groups INTEGER, invited_accounts INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_users UUID[];
BEGIN
  IF NOT COALESCE(is_platform_admin_me(), FALSE) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN RAISE EXCEPTION 'bad_dates'; END IF;
  IF COALESCE(p_period, 'total') NOT IN ('total', 'semana', 'mes') THEN RAISE EXCEPTION 'bad_period'; END IF;
  IF COALESCE(p_group, 'origem') NOT IN ('origem', 'tipo') THEN RAISE EXCEPTION 'bad_group'; END IF;

  -- Só com o código de quem convidou, sem link: «(convite pessoal)».
  CREATE TEMP TABLE IF NOT EXISTS _origem_contas (user_id UUID, created_at TIMESTAMPTZ, origin TEXT, zona TEXT) ON COMMIT DROP;
  TRUNCATE _origem_contas;
  INSERT INTO _origem_contas
  SELECT p.id, p.created_at,
         COALESCE(ao.origin, CASE WHEN ao.ref_user_id IS NOT NULL THEN '(convite pessoal)' END),
         (SELECT o.district FROM memberships m JOIN organizations o ON o.id = m.organization_id
           WHERE m.user_id = p.id AND NOT COALESCE(o.is_global, FALSE)
           ORDER BY m.created_at, o.id LIMIT 1)
    FROM profiles p
    LEFT JOIN account_origins ao ON ao.user_id = p.id
   WHERE (p.created_at AT TIME ZONE 'Europe/Lisbon')::date BETWEEN p_from AND p_to
     AND NOT COALESCE(p.is_test, FALSE);
  IF NULLIF(btrim(p_district), '') IS NOT NULL THEN
    DELETE FROM _origem_contas WHERE zona IS DISTINCT FROM btrim(p_district);
  END IF;
  SELECT array_agg(c.user_id) INTO v_users FROM _origem_contas c;

  RETURN QUERY
  WITH ev AS (
    SELECT e.user_id, e.at, e.matches FROM account_played_events(COALESCE(v_users, '{}')) e
  ), per AS (
    SELECT c.*,
           CASE COALESCE(p_period, 'total')
             WHEN 'semana' THEN date_trunc('week', c.created_at AT TIME ZONE 'Europe/Lisbon')::date
             WHEN 'mes'    THEN date_trunc('month', c.created_at AT TIME ZONE 'Europe/Lisbon')::date
             ELSE p_from END AS periodo,
           CASE WHEN c.origin = '(convite pessoal)' THEN 'Convite pessoal' ELSE account_origin_type(c.origin) END AS tipo,
           (SELECT count(*) FROM ev WHERE ev.user_id = c.user_id AND ev.at >= c.created_at AND ev.at < c.created_at + interval '7 days') AS ev7,
           (SELECT count(*) FROM ev WHERE ev.user_id = c.user_id AND ev.at >= c.created_at AND ev.at < c.created_at + interval '30 days') AS ev30,
           (SELECT COALESCE(sum(ev.matches), 0) FROM ev WHERE ev.user_id = c.user_id AND ev.at >= c.created_at AND ev.at < c.created_at + interval '30 days') AS jogos30
      FROM _origem_contas c
  ), grupos AS (
    SELECT c.user_id, o.id AS org_id, o.created_at AS org_at
      FROM _origem_contas c JOIN organizations o ON o.owner_id = c.user_id AND o.created_at >= c.created_at - interval '1 hour'
     WHERE NOT COALESCE(o.is_global, FALSE)
  ), por_conta AS (
    SELECT per.user_id,
           (SELECT count(*) FROM grupos gr WHERE gr.user_id = per.user_id) AS g_criados,
           (SELECT count(*) FROM grupos gr WHERE gr.user_id = per.user_id
               AND EXISTS (SELECT 1 FROM games g JOIN mix_player_stats s ON s.game_id = g.id
                            WHERE g.organization_id = gr.org_id AND g.date >= gr.org_at AND g.date < gr.org_at + interval '30 days')) AS g_mix,
           (SELECT count(DISTINCT m.user_id) FROM grupos gr JOIN memberships m ON m.organization_id = gr.org_id
             WHERE gr.user_id = per.user_id AND m.user_id <> per.user_id) AS g_pessoas,
           (SELECT count(*) FROM account_origins a WHERE a.ref_user_id = per.user_id) AS convidadas
      FROM per
  )
  SELECT per.periodo,
         CASE WHEN COALESCE(p_group, 'origem') = 'tipo' THEN per.tipo ELSE COALESCE(per.origin, '(sem origem)') END,
         per.tipo,
         count(*)::int,
         count(*) FILTER (WHERE per.ev7 > 0)::int,
         count(*) FILTER (WHERE per.ev30 > 0)::int,
         count(*) FILTER (WHERE per.ev30 >= 2)::int,
         COALESCE(sum(per.jogos30), 0)::int,
         COALESCE(sum(pc.g_criados), 0)::int,
         COALESCE(sum(pc.g_mix), 0)::int,
         COALESCE(sum(pc.g_pessoas), 0)::int,
         COALESCE(sum(pc.convidadas), 0)::int
    FROM per JOIN por_conta pc ON pc.user_id = per.user_id
   GROUP BY 1, 2, 3
   ORDER BY 1, 4 DESC, 2;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_account_origin_report(DATE, DATE, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_account_origin_report(DATE, DATE, TEXT, TEXT, TEXT) TO authenticated;

-- ── 7. Relatório por quem convida (superadmins) ─────────────────────────
-- Contas criadas entre p_from e p_to por convite; «jogaram» = pelo menos um
-- jogo que conta desde que criaram conta.
CREATE OR REPLACE FUNCTION public.get_invite_report(p_from DATE, p_to DATE)
RETURNS TABLE(user_id UUID, name TEXT, brought INTEGER, brought_played INTEGER)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_users UUID[];
BEGIN
  IF NOT COALESCE(is_platform_admin_me(), FALSE) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN RAISE EXCEPTION 'bad_dates'; END IF;
  SELECT array_agg(a.user_id) INTO v_users
    FROM account_origins a JOIN profiles p ON p.id = a.user_id
   WHERE a.ref_user_id IS NOT NULL AND (p.created_at AT TIME ZONE 'Europe/Lisbon')::date BETWEEN p_from AND p_to;
  RETURN QUERY
    SELECT a.ref_user_id, r.name, count(*)::int,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM account_played_events(COALESCE(v_users, '{}')) e
                                           WHERE e.user_id = a.user_id AND e.at >= p.created_at))::int
      FROM account_origins a
      JOIN profiles p ON p.id = a.user_id
      JOIN profiles r ON r.id = a.ref_user_id
     WHERE a.user_id = ANY(COALESCE(v_users, '{}'))
     GROUP BY a.ref_user_id, r.name
     ORDER BY 3 DESC, 4 DESC, r.name;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_invite_report(DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_invite_report(DATE, DATE) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT has_table_privilege('authenticated', 'public.account_origins', 'SELECT');                       -- false
--   SELECT has_function_privilege('anon', 'public.set_my_account_origin(text,text)', 'EXECUTE');            -- false
--   SELECT has_function_privilege('authenticated', 'public.account_played_events(uuid[])', 'EXECUTE');      -- false
