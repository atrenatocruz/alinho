-- ═════════════════════════════════════════════════════════════════════════
-- Mix: escolher em que grupos de WhatsApp sai, não só pelo nível
-- Cartão #751 (https://trello.com/c/jnyO36xD)
--
-- PORQUÊ. SPEC design-handoff/2026-10-30-mix-grupo-whatsapp/SPEC.md,
-- aprovada pelo Francisco a 30 out e pelo Renato a 31 out. Um clube com 12
-- grupos (cada um com o seu dia, sítio e formato) não se resolve só com o
-- nível do mix. Plano aprovado pelo Francisco a 31 out.
--
-- O QUE FAZ. Só acrescenta (a app antiga das lojas continua igual):
--   · games.whatsapp_group_ids e game_recurrences.whatsapp_group_ids
--     (uuid[]):
--       NULL  = sai como hoje, pelos níveis (todos os mixes que já existem,
--               e os que a app antiga criar);
--       '{}'  = não sai no WhatsApp, só na app;
--       lista = sai nesses grupos.
--     Um gatilho limpa a lista: tira ids que não sejam grupos do clube do
--     mix (também para quem escreve em games diretamente) e, numa data nova
--     de uma série, herda a lista da série (como as horas dos lembretes).
--     Por isso process_due_game_recurrences e recurrence_insert_pending
--     NÃO são redefinidas.
--   · participants.whatsapp_group_id: o grupo por onde a pessoa entrou.
--     Só o robô (service role, sem auth.uid()) o grava; vindo da app, o
--     gatilho ignora-o.
--   · mix_whatsapp_group_ids(game)        → os grupos onde o mix sai, com
--     a regra de hoje para NULL (para o robô e para as funções abaixo).
--   · get_mix_whatsapp_groups(game)       → para o Editar, a página do mix
--     e a folha «Tirar o grupo» (com quantas pessoas entraram por cada um).
--   · set_mix_whatsapp_groups(game, ids, following) → grava; com
--     «Este e os seguintes», também a série e as datas seguintes por começar.
--   · suggest_mix_whatsapp_groups(clube, nível, dia, sítio) → a sugestão
--     do Criar: único grupo / pelo nível / pelo último mix desse dia e sítio.
-- Nomes combinados com o Dev 2 (ecrã). O robô é do Renato: ver
-- design-handoff/2026-10-30-mix-grupo-whatsapp/NOTA-PARA-Renato-robo.md.
-- REVOKE de PUBLIC e anon em todas as funções novas.
--
-- ORDEM. Qualquer: não mexe em funções que outras migrações redefinem.
--
-- Dev 3, 31 out 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE games            ADD COLUMN IF NOT EXISTS whatsapp_group_ids UUID[];
ALTER TABLE game_recurrences ADD COLUMN IF NOT EXISTS whatsapp_group_ids UUID[];
ALTER TABLE participants     ADD COLUMN IF NOT EXISTS whatsapp_group_id UUID
  REFERENCES whatsapp_groups(id) ON DELETE SET NULL;

-- ── Os ids de grupos, só do clube, sem repetidos e por ordem ─────────────
CREATE OR REPLACE FUNCTION whatsapp_group_ids_of_org(p_organization_id UUID, p_ids UUID[])
RETURNS UUID[]
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE WHEN p_ids IS NULL THEN NULL ELSE
    COALESCE((SELECT array_agg(w.id ORDER BY w.id) FROM whatsapp_groups w
               WHERE w.organization_id = p_organization_id AND w.id = ANY (p_ids)), '{}')
  END;
$$;
REVOKE ALL ON FUNCTION whatsapp_group_ids_of_org(UUID, UUID[]) FROM PUBLIC, anon, authenticated;

-- ── Gatilho em games: herdar da série e limpar ───────────────────────────
CREATE OR REPLACE FUNCTION games_whatsapp_groups_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.recurrence_id IS NOT NULL AND NEW.whatsapp_group_ids IS NULL THEN
    SELECT whatsapp_group_ids INTO NEW.whatsapp_group_ids FROM game_recurrences WHERE id = NEW.recurrence_id;
  END IF;
  -- Sem erro: um grupo apagado entretanto não pode travar a série.
  NEW.whatsapp_group_ids := whatsapp_group_ids_of_org(NEW.organization_id, NEW.whatsapp_group_ids);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION games_whatsapp_groups_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS games_whatsapp_groups_guard_trigger ON games;
CREATE TRIGGER games_whatsapp_groups_guard_trigger
  BEFORE INSERT OR UPDATE OF whatsapp_group_ids, organization_id ON games
  FOR EACH ROW EXECUTE FUNCTION games_whatsapp_groups_guard();

CREATE OR REPLACE FUNCTION game_recurrences_whatsapp_groups_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.whatsapp_group_ids := whatsapp_group_ids_of_org(NEW.organization_id, NEW.whatsapp_group_ids);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION game_recurrences_whatsapp_groups_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS game_recurrences_whatsapp_groups_guard_trigger ON game_recurrences;
CREATE TRIGGER game_recurrences_whatsapp_groups_guard_trigger
  BEFORE INSERT OR UPDATE OF whatsapp_group_ids, organization_id ON game_recurrences
  FOR EACH ROW EXECUTE FUNCTION game_recurrences_whatsapp_groups_guard();

-- ── Gatilho em participants: só o robô diz por que grupo se entrou ───────
CREATE OR REPLACE FUNCTION participants_whatsapp_group_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.whatsapp_group_id := CASE WHEN TG_OP = 'UPDATE' THEN OLD.whatsapp_group_id END;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION participants_whatsapp_group_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS participants_whatsapp_group_guard_trigger ON participants;
CREATE TRIGGER participants_whatsapp_group_guard_trigger
  BEFORE INSERT OR UPDATE OF whatsapp_group_id ON participants
  FOR EACH ROW EXECUTE FUNCTION participants_whatsapp_group_guard();

-- ── Onde sai o mix (NULL → a regra de hoje, a do mixVisibleToGroup) ──────
-- Grupo sem níveis vê tudo; mix sem nível sai em todos; jogo em aberto
-- ignora o nível. Sem ligar a maiúsculas, como o robô.
CREATE OR REPLACE FUNCTION mix_whatsapp_group_ids(p_game_id UUID)
RETURNS UUID[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN g.whatsapp_group_ids IS NOT NULL THEN whatsapp_group_ids_of_org(g.organization_id, g.whatsapp_group_ids)
  ELSE COALESCE((
    SELECT array_agg(w.id ORDER BY w.id) FROM whatsapp_groups w
     WHERE w.organization_id = g.organization_id
       AND (g.origin = 'open_slot' OR g.level IS NULL OR COALESCE(cardinality(w.levels), 0) = 0
            OR upper(g.level) IN (SELECT upper(l) FROM unnest(w.levels) l))), '{}')
  END
  FROM games g WHERE g.id = p_game_id;
$$;
REVOKE ALL ON FUNCTION mix_whatsapp_group_ids(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION mix_whatsapp_group_ids(UUID) TO service_role;

-- ── 1. Para o ecrã: os grupos onde sai e quantos entraram por cada um ────
-- Quem não é admin do clube recebe uma lista vazia (como list_whatsapp_groups).
-- joined_count conta pessoas inscritas (com o par), confirmadas ou suplentes.
CREATE OR REPLACE FUNCTION get_mix_whatsapp_groups(p_game_id UUID)
RETURNS TABLE (id UUID, label TEXT, joined_count INT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT w.id, w.label,
         COALESCE((SELECT sum(1 + (p.partner_id IS NOT NULL OR p.partner_guest_id IS NOT NULL)::int)
                     FROM participants p
                    WHERE p.game_id = g.id AND p.whatsapp_group_id = w.id
                      AND p.status IN ('confirmed', 'waitlisted')), 0)::int
    FROM games g
    JOIN whatsapp_groups w ON w.id = ANY (mix_whatsapp_group_ids(g.id))
   WHERE g.id = p_game_id AND is_org_admin(g.organization_id)
   ORDER BY (w.label IS NULL) DESC, lower(w.label), w.created_at;
$$;
REVOKE ALL ON FUNCTION get_mix_whatsapp_groups(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_mix_whatsapp_groups(UUID) TO authenticated;

-- ── 2. Gravar. '{}' = só na app. p_following = «Este e os seguintes» ────
CREATE OR REPLACE FUNCTION set_mix_whatsapp_groups(p_game_id UUID, p_group_ids UUID[], p_following BOOLEAN DEFAULT FALSE)
RETURNS UUID[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_game games%ROWTYPE;
  v_ids  UUID[];
BEGIN
  SELECT * INTO v_game FROM games WHERE id = p_game_id;
  IF v_game.id IS NULL OR auth.uid() IS NULL OR NOT is_org_admin(v_game.organization_id) THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  IF p_group_ids IS NULL THEN RAISE EXCEPTION 'bad_groups'; END IF;
  v_ids := whatsapp_group_ids_of_org(v_game.organization_id, p_group_ids);
  IF EXISTS (SELECT 1 FROM unnest(p_group_ids) x WHERE x IS NULL OR NOT x = ANY (v_ids)) THEN
    RAISE EXCEPTION 'group_not_in_club';
  END IF;

  UPDATE games SET whatsapp_group_ids = v_ids WHERE id = v_game.id;
  IF p_following AND v_game.recurrence_id IS NOT NULL THEN
    UPDATE game_recurrences SET whatsapp_group_ids = v_ids WHERE id = v_game.recurrence_id;
    UPDATE games SET whatsapp_group_ids = v_ids
     WHERE recurrence_id = v_game.recurrence_id AND id <> v_game.id AND date > v_game.date
       AND status IN ('draft', 'pending', 'open', 'closed');
  END IF;
  RETURN v_ids;
END;
$$;
REVOKE ALL ON FUNCTION set_mix_whatsapp_groups(UUID, UUID[], BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_mix_whatsapp_groups(UUID, UUID[], BOOLEAN) TO authenticated;

-- ── 3. A sugestão do Criar (SPEC §2) ─────────────────────────────────────
-- p_weekday como o getDay() do JS (0 = domingo). Devolve
-- {group_ids, reason: 'only'|'level'|'last'|null, weekday, place}.
CREATE OR REPLACE FUNCTION suggest_mix_whatsapp_groups(p_organization_id UUID, p_level TEXT, p_weekday INT, p_location TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_all   UUID[];
  v_ids   UUID[];
  v_place TEXT := lower(btrim(regexp_replace(COALESCE(p_location, ''), '\s+', ' ', 'g')));
  v_last  games%ROWTYPE;
BEGIN
  IF NOT is_org_admin(p_organization_id) THEN
    RETURN jsonb_build_object('group_ids', '[]'::jsonb, 'reason', NULL, 'weekday', p_weekday, 'place', NULL);
  END IF;
  SELECT array_agg(id ORDER BY id) INTO v_all FROM whatsapp_groups WHERE organization_id = p_organization_id;

  IF cardinality(v_all) = 1 THEN
    RETURN jsonb_build_object('group_ids', to_jsonb(v_all), 'reason', 'only', 'weekday', p_weekday, 'place', NULL);
  END IF;

  IF NULLIF(btrim(p_level), '') IS NOT NULL
     AND EXISTS (SELECT 1 FROM whatsapp_groups WHERE organization_id = p_organization_id AND cardinality(levels) > 0) THEN
    SELECT array_agg(w.id ORDER BY w.id) INTO v_ids FROM whatsapp_groups w
     WHERE w.organization_id = p_organization_id
       AND (COALESCE(cardinality(w.levels), 0) = 0 OR upper(btrim(p_level)) IN (SELECT upper(l) FROM unnest(w.levels) l));
    IF cardinality(v_ids) > 0 THEN
      RETURN jsonb_build_object('group_ids', to_jsonb(v_ids), 'reason', 'level', 'weekday', p_weekday, 'place', NULL);
    END IF;
  END IF;

  IF v_place <> '' AND p_weekday BETWEEN 0 AND 6 THEN
    SELECT * INTO v_last FROM games g
     WHERE g.organization_id = p_organization_id AND COALESCE(g.origin, 'admin') <> 'open_slot'
       AND g.status <> 'cancelled'
       AND extract(dow FROM g.date AT TIME ZONE 'Europe/Lisbon') = p_weekday
       AND lower(btrim(regexp_replace(COALESCE(g.location, ''), '\s+', ' ', 'g'))) = v_place
     ORDER BY g.date DESC LIMIT 1;
    IF v_last.id IS NOT NULL THEN
      v_ids := mix_whatsapp_group_ids(v_last.id);
      IF cardinality(v_ids) > 0 THEN
        RETURN jsonb_build_object('group_ids', to_jsonb(v_ids), 'reason', 'last', 'weekday', p_weekday, 'place', v_last.location);
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('group_ids', '[]'::jsonb, 'reason', NULL, 'weekday', p_weekday, 'place', NULL);
END;
$$;
REVOKE ALL ON FUNCTION suggest_mix_whatsapp_groups(UUID, TEXT, INT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION suggest_mix_whatsapp_groups(UUID, TEXT, INT, TEXT) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT table_name, column_name FROM information_schema.columns
--    WHERE column_name IN ('whatsapp_group_ids', 'whatsapp_group_id') ORDER BY 1;
--     → game_recurrences, games, participants
--   SELECT proname, has_function_privilege('anon', oid, 'EXECUTE') anon,
--          has_function_privilege('authenticated', oid, 'EXECUTE') auth
--     FROM pg_proc WHERE proname IN ('get_mix_whatsapp_groups', 'set_mix_whatsapp_groups',
--          'suggest_mix_whatsapp_groups', 'mix_whatsapp_group_ids', 'whatsapp_group_ids_of_org');
--     → anon sempre false; auth true só nas três primeiras
--   SELECT count(*) FROM games WHERE whatsapp_group_ids IS NOT NULL;  → 0 (os de antes ficam NULL)
