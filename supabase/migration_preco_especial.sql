-- ═════════════════════════════════════════════════════════════════════════
-- Preço especial para um grupo (mix, série, jogo em aberto, categoria)
--
-- PORQUÊ. Francisco, 7 out: desenho aprovado («está top»,
-- design-handoff/2026-10-07-preco-especial/SPEC.md) e plano da base de
-- dados aprovado («sim»). Vale em todos os eventos com preço: mix (e
-- série), jogo em aberto e cada categoria do torneio; mais tarde liga e
-- aulas. O preço é só informativo: paga-se no clube. Ecrãs: Dev 2 (mix),
-- Dev 1 (torneio), Dev 4 (jogo em aberto). NÃO vai no main de 12 out.
--
-- O QUE FAZ
--   · event_special_prices: um preço especial por evento (game_id,
--     recurrence_id ou tournament_category_id: só um), price em euros
--     (0 = Grátis) e audience 'members' (membros do clube ou grupo, sem
--     convidados) ou 'list' (pessoas escolhidas, em
--     event_special_price_people). 'none' só numa data de uma série: «nesta
--     data, sem preço especial» (desligar só esta data, com a série ligada).
--     Sem acesso direto: só pelas funções.
--   · Numa série, o preço especial guarda-se na série e cada data usa-o,
--     a não ser que a data tenha o seu («Mudar só este mix»). Mudar o da
--     série muda o de todas as datas que não têm o seu. No jogo em aberto,
--     grava-se em todos os horários da mesma publicação (open_batch_id).
--   · kind, como nas horas do WhatsApp: 'mix' (id do jogo), 'mix_series'
--     (id da série), 'open_slot' (id de um horário), 'tournament_category'.
--   · set_event_special_price(kind, id, price, audience, user_ids) → o que
--     ficou (como o get). price NULL = desligar. Só quem organiza
--     ('not_allowed'); 'bad_input' (preço < 0 ou audience inválida);
--     'not_member' (alguém da lista não é do clube ou grupo).
--   · get_event_special_price(kind, id) → jsonb {price, audience, people
--     [{id, name, avatar_url}], from_series} ou null. Só quem organiza:
--     para o criar/editar.
--   · prices_for_me(kind, ids[]) → por evento: normal_price, my_price,
--     is_special (eu tenho o preço especial), members_price (só quando o
--     grupo são os membros: para «Grátis para membros» a quem é de fora).
--     Uma chamada por lista. A lista de pessoas nunca sai daqui.
--   · event_price_roster(kind, id) → por pessoa inscrita (com conta):
--     price e is_special. Só quem organiza: para a lista de inscritos e a
--     linha «3 com preço especial · 2 pagam 15 €».
--   O preço normal continua onde está (games.price_per_player,
--   game_recurrences.price_per_player, tournament_categories.price_cents,
--   este em cêntimos: aqui devolve-se sempre em euros).
--
-- Dev 3, 7 out 2026 · ecrãs: Dev 2, Dev 1, Dev 4
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.event_special_prices (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id                UUID UNIQUE REFERENCES games(id) ON DELETE CASCADE,
  recurrence_id          UUID UNIQUE REFERENCES game_recurrences(id) ON DELETE CASCADE,
  tournament_category_id UUID UNIQUE REFERENCES tournament_categories(id) ON DELETE CASCADE,
  price                  NUMERIC(8,2) NOT NULL CHECK (price >= 0),
  audience               TEXT NOT NULL CHECK (audience IN ('members', 'list', 'none')),
  updated_by             UUID REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (num_nonnulls(game_id, recurrence_id, tournament_category_id) = 1)
);
CREATE TABLE IF NOT EXISTS public.event_special_price_people (
  special_price_id UUID NOT NULL REFERENCES event_special_prices(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  PRIMARY KEY (special_price_id, user_id)
);
ALTER TABLE public.event_special_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_special_price_people ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_special_prices FROM anon, authenticated;
REVOKE ALL ON public.event_special_price_people FROM anon, authenticated;

-- ── Ajudas internas ─────────────────────────────────────────────────────
-- O clube, o preço normal (em euros) e o torneio (para a regra de admin).
CREATE OR REPLACE FUNCTION public.esp_event(p_kind TEXT, p_id UUID,
  OUT org UUID, OUT normal_price NUMERIC, OUT tournament UUID, OUT recurrence UUID, OUT batch UUID)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF p_kind IN ('mix', 'open_slot') THEN
    SELECT g.organization_id, g.price_per_player, g.recurrence_id, g.open_batch_id
      INTO org, normal_price, recurrence, batch FROM games g WHERE g.id = p_id;
  ELSIF p_kind = 'mix_series' THEN
    SELECT r.organization_id, r.price_per_player INTO org, normal_price FROM game_recurrences r WHERE r.id = p_id;
  ELSIF p_kind = 'tournament_category' THEN
    SELECT t.organization_id, round(c.price_cents / 100.0, 2), t.id INTO org, normal_price, tournament
      FROM tournament_categories c JOIN tournaments t ON t.id = c.tournament_id WHERE c.id = p_id;
  END IF;
END;
$function$;

-- O preço especial que vale para o evento: o próprio, ou o da série.
CREATE OR REPLACE FUNCTION public.esp_row(p_kind TEXT, p_id UUID)
RETURNS event_special_prices
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT sp.* FROM event_special_prices sp
   WHERE (p_kind IN ('mix', 'open_slot') AND sp.game_id = p_id)
      OR (p_kind = 'mix_series' AND sp.recurrence_id = p_id)
      OR (p_kind = 'tournament_category' AND sp.tournament_category_id = p_id)
      OR (p_kind = 'mix' AND sp.recurrence_id = (SELECT recurrence_id FROM games WHERE id = p_id))
   ORDER BY (sp.game_id IS NOT NULL OR sp.tournament_category_id IS NOT NULL) DESC
   LIMIT 1;
$function$;

-- Esta pessoa tem o preço especial?
CREATE OR REPLACE FUNCTION public.esp_applies(p_sp event_special_prices, p_org UUID, p_user UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT p_sp.id IS NOT NULL AND p_user IS NOT NULL AND CASE p_sp.audience
    WHEN 'members' THEN EXISTS (SELECT 1 FROM memberships m
                                 WHERE m.organization_id = p_org AND m.user_id = p_user
                                   AND NOT COALESCE(m.is_guest, FALSE))
    WHEN 'list' THEN EXISTS (SELECT 1 FROM event_special_price_people pp
                              WHERE pp.special_price_id = p_sp.id AND pp.user_id = p_user)
    ELSE FALSE END;
$function$;

CREATE OR REPLACE FUNCTION public.esp_is_admin(p_kind TEXT, p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE e RECORD;
BEGIN
  SELECT * INTO e FROM esp_event(p_kind, p_id);
  IF e.org IS NULL OR auth.uid() IS NULL THEN RETURN FALSE; END IF;
  IF e.tournament IS NOT NULL THEN RETURN is_tournament_admin(e.tournament); END IF;
  RETURN is_org_admin(e.org);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.esp_event(TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.esp_row(TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.esp_applies(event_special_prices, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.esp_is_admin(TEXT, UUID) FROM PUBLIC, anon, authenticated;

-- ── Para quem organiza: ler e gravar ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_event_special_price(p_kind TEXT, p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE sp event_special_prices;
BEGIN
  IF NOT esp_is_admin(p_kind, p_id) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  sp := esp_row(p_kind, p_id);
  IF sp.id IS NULL OR sp.audience = 'none' THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'price', sp.price,
    'audience', sp.audience,
    'from_series', p_kind = 'mix' AND sp.recurrence_id IS NOT NULL,
    'people', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'avatar_url', p.avatar_url) ORDER BY p.name)
                          FROM event_special_price_people pp JOIN profiles p ON p.id = pp.user_id
                         WHERE pp.special_price_id = sp.id), '[]'::jsonb));
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_event_special_price(
  p_kind TEXT, p_id UUID, p_price NUMERIC, p_audience TEXT DEFAULT 'members', p_user_ids UUID[] DEFAULT '{}')
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  e       RECORD;
  v_games UUID[];
  v_id    UUID;
  v_sp    UUID;
BEGIN
  IF p_kind NOT IN ('mix', 'mix_series', 'open_slot', 'tournament_category') THEN RAISE EXCEPTION 'bad_input'; END IF;
  IF NOT esp_is_admin(p_kind, p_id) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  SELECT * INTO e FROM esp_event(p_kind, p_id);

  IF p_price IS NOT NULL THEN
    IF p_price < 0 OR p_audience NOT IN ('members', 'list') THEN RAISE EXCEPTION 'bad_input'; END IF;
    IF p_audience = 'list' AND EXISTS (
         SELECT 1 FROM unnest(COALESCE(p_user_ids, '{}')) u
          WHERE NOT EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = e.org AND m.user_id = u)) THEN
      RAISE EXCEPTION 'not_member';
    END IF;
  END IF;

  -- Os eventos onde se grava: o jogo; todos os horários da publicação; a série; a categoria.
  IF p_kind = 'open_slot' AND e.batch IS NOT NULL THEN
    SELECT array_agg(id) INTO v_games FROM games WHERE open_batch_id = e.batch;
  ELSIF p_kind IN ('mix', 'open_slot') THEN
    v_games := ARRAY[p_id];
  END IF;

  -- Desligar só uma data de uma série com preço especial: fica marcada
  -- 'none', senão voltava a valer o da série.
  IF p_price IS NULL AND p_kind = 'mix' AND e.recurrence IS NOT NULL
     AND EXISTS (SELECT 1 FROM event_special_prices WHERE recurrence_id = e.recurrence) THEN
    INSERT INTO event_special_prices (game_id, price, audience, updated_by)
    VALUES (p_id, 0, 'none', auth.uid())
    ON CONFLICT (game_id) DO UPDATE SET price = 0, audience = 'none', updated_by = EXCLUDED.updated_by, updated_at = NOW();
    DELETE FROM event_special_price_people
     WHERE special_price_id = (SELECT id FROM event_special_prices WHERE game_id = p_id);
    RETURN NULL;
  END IF;

  IF p_price IS NULL THEN
    DELETE FROM event_special_prices
     WHERE (v_games IS NOT NULL AND game_id = ANY (v_games))
        OR (p_kind = 'mix_series' AND recurrence_id = p_id)
        OR (p_kind = 'tournament_category' AND tournament_category_id = p_id);
    RETURN NULL;
  END IF;

  FOR v_id IN SELECT unnest(COALESCE(v_games, ARRAY[p_id])) LOOP
    IF p_kind IN ('mix', 'open_slot') THEN
      INSERT INTO event_special_prices (game_id, price, audience, updated_by)
      VALUES (v_id, p_price, p_audience, auth.uid())
      ON CONFLICT (game_id) DO UPDATE SET price = EXCLUDED.price, audience = EXCLUDED.audience,
        updated_by = EXCLUDED.updated_by, updated_at = NOW()
      RETURNING id INTO v_sp;
    ELSIF p_kind = 'mix_series' THEN
      INSERT INTO event_special_prices (recurrence_id, price, audience, updated_by)
      VALUES (v_id, p_price, p_audience, auth.uid())
      ON CONFLICT (recurrence_id) DO UPDATE SET price = EXCLUDED.price, audience = EXCLUDED.audience,
        updated_by = EXCLUDED.updated_by, updated_at = NOW()
      RETURNING id INTO v_sp;
    ELSE
      INSERT INTO event_special_prices (tournament_category_id, price, audience, updated_by)
      VALUES (v_id, p_price, p_audience, auth.uid())
      ON CONFLICT (tournament_category_id) DO UPDATE SET price = EXCLUDED.price, audience = EXCLUDED.audience,
        updated_by = EXCLUDED.updated_by, updated_at = NOW()
      RETURNING id INTO v_sp;
    END IF;
    DELETE FROM event_special_price_people WHERE special_price_id = v_sp;
    IF p_audience = 'list' THEN
      INSERT INTO event_special_price_people (special_price_id, user_id)
      SELECT DISTINCT v_sp, u FROM unnest(COALESCE(p_user_ids, '{}')) u WHERE u IS NOT NULL;
    END IF;
  END LOOP;

  RETURN get_event_special_price(p_kind, p_id);
END;
$function$;

-- ── Para quem vê: o meu preço, numa chamada por lista ───────────────────
CREATE OR REPLACE FUNCTION public.prices_for_me(p_kind TEXT, p_ids UUID[])
RETURNS TABLE (id UUID, normal_price NUMERIC, my_price NUMERIC, is_special BOOLEAN, members_price NUMERIC)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_id UUID;
  e    RECORD;
  sp   event_special_prices;
  v_me BOOLEAN;
BEGIN
  FOREACH v_id IN ARRAY COALESCE(p_ids, '{}') LOOP
    SELECT * INTO e FROM esp_event(p_kind, v_id);
    CONTINUE WHEN e.org IS NULL;
    sp := esp_row(p_kind, v_id);
    v_me := esp_applies(sp, e.org, auth.uid());
    id := v_id;
    normal_price := e.normal_price;
    is_special := v_me;
    my_price := CASE WHEN v_me THEN sp.price ELSE e.normal_price END;
    -- A quem é de fora só se diz o preço dos membros; a lista nunca.
    members_price := CASE WHEN sp.audience = 'members' THEN sp.price END;
    RETURN NEXT;
  END LOOP;
END;
$function$;

-- ── Para quem organiza: o preço de cada inscrito ────────────────────────
CREATE OR REPLACE FUNCTION public.event_price_roster(p_kind TEXT, p_id UUID)
RETURNS TABLE (user_id UUID, price NUMERIC, is_special BOOLEAN)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  e  RECORD;
  sp event_special_prices;
BEGIN
  IF NOT esp_is_admin(p_kind, p_id) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  SELECT * INTO e FROM esp_event(p_kind, p_id);
  sp := esp_row(p_kind, p_id);
  RETURN QUERY
  SELECT x.u,
         CASE WHEN esp_applies(sp, e.org, x.u) THEN sp.price ELSE e.normal_price END,
         esp_applies(sp, e.org, x.u)
    FROM (
      SELECT DISTINCT who.u FROM participants p
        CROSS JOIN LATERAL (VALUES (p.user_id), (p.partner_id)) AS who(u)
       WHERE p_kind IN ('mix', 'open_slot') AND p.game_id = p_id
         AND p.status IN ('confirmed', 'waitlisted', 'requested') AND who.u IS NOT NULL
      UNION
      SELECT DISTINCT who.u FROM tournament_entries te
        CROSS JOIN LATERAL (VALUES (te.player1_id), (te.player2_id)) AS who(u)
       WHERE p_kind = 'tournament_category' AND te.category_id = p_id
         AND te.status <> 'desistiu' AND who.u IS NOT NULL
    ) x;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_event_special_price(TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_event_special_price(TEXT, UUID, NUMERIC, TEXT, UUID[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.prices_for_me(TEXT, UUID[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.event_price_roster(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_event_special_price(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_event_special_price(TEXT, UUID, NUMERIC, TEXT, UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.prices_for_me(TEXT, UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.event_price_roster(TEXT, UUID) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT has_table_privilege('authenticated', 'public.event_special_prices', 'SELECT');  -- false
--   SELECT has_function_privilege('anon', 'public.prices_for_me(text,uuid[])', 'EXECUTE');  -- false
