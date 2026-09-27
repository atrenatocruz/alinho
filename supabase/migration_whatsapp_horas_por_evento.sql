-- ═════════════════════════════════════════════════════════════════════════
-- Lembretes no WhatsApp dentro de cada evento: as horas passam do clube
-- para cada mix, jogo em aberto, torneio e turma
--
-- PORQUÊ. Decisão do Francisco (27 set, design-handoff/2026-09-27-whatsapp-
-- no-evento/SPEC.md, aprovado): «Isto tem de sair daqui e ficar dentro de
-- todos os jogos com avisos no WhatsApp.» Hoje as horas são do clube
-- (organizations.whatsapp_post_hours, #553 do Renato, horas certas 8–22).
-- Passam a ser de cada evento, de meia em meia hora, até 3 por dia.
--
-- O QUE FAZ (nomes combinados com Bugs, Dev 1, Dev 2 e Dev 4):
--   1. whatsapp_post_times TIME[] em games (mix e jogos em aberto),
--      game_recurrences (mix que se repete; as datas novas herdam-no),
--      tournaments e lesson_series (turma). Até 3 horas, 08:00–22:00, às
--      horas certas ou meias. [] = sem lembretes; NULL = por escolher (o
--      robô usa as horas do clube, como hoje).
--   2. set_event_whatsapp_post_times(kind, id, ['HH:MM',…]): grava, para
--      os 4 tipos, sem mexer nos criar/editar de cada um. Só quem pode
--      editar o evento ('not_allowed'); horas fora da regra: 'invalid_times'.
--   3. default_whatsapp_post_times(org, kind): o «vem preenchido» — as horas
--      do último evento do mesmo tipo no clube; sem nenhum, as do clube.
--   4. effective_whatsapp_post_times(kind, id): o que o robô lê (só
--      service_role) — as do evento ou, sem elas, as do clube.
--   5. Na passagem, os eventos abertos ficam com as horas do clube (o A2N
--      não deixa de publicar às 10h).
-- A parte do robô (ler as horas do evento) é do Renato / Bugs.
--
-- kind: 'mix' e 'open_slot' (games), 'mix_series' (game_recurrences),
--       'tournament' (tournaments), 'lesson' (lesson_series).
--
-- Dev 3, 27 set 2026 · depois de migration_whatsapp_post_hours.sql
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 0. Peças de que depende ─────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'organizations' AND column_name = 'whatsapp_post_hours') THEN
    RAISE EXCEPTION 'Falta organizations.whatsapp_post_hours (migration_whatsapp_post_hours.sql). Parar e ler.';
  END IF;
  IF to_regclass('public.lesson_series') IS NULL OR to_regclass('public.tournaments') IS NULL
     OR to_regprocedure('public.is_tournament_admin(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Faltam turmas ou torneios. Parar e ler.';
  END IF;
END $$;

-- ── 1. A regra das horas ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.whatsapp_post_times_ok(p_times TIME[])
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_times IS NULL OR (
    cardinality(p_times) <= 3
    AND NOT EXISTS (SELECT 1 FROM unnest(p_times) t
                     WHERE t IS NULL OR t < '08:00' OR t > '22:00'
                        OR extract(minute FROM t) NOT IN (0, 30) OR extract(second FROM t) <> 0));
$$;

ALTER TABLE games            ADD COLUMN IF NOT EXISTS whatsapp_post_times TIME[];
ALTER TABLE game_recurrences ADD COLUMN IF NOT EXISTS whatsapp_post_times TIME[];
ALTER TABLE tournaments      ADD COLUMN IF NOT EXISTS whatsapp_post_times TIME[];
ALTER TABLE lesson_series    ADD COLUMN IF NOT EXISTS whatsapp_post_times TIME[];

ALTER TABLE games            DROP CONSTRAINT IF EXISTS games_whatsapp_post_times_check;
ALTER TABLE games            ADD CONSTRAINT games_whatsapp_post_times_check CHECK (whatsapp_post_times_ok(whatsapp_post_times));
ALTER TABLE game_recurrences DROP CONSTRAINT IF EXISTS game_recurrences_whatsapp_post_times_check;
ALTER TABLE game_recurrences ADD CONSTRAINT game_recurrences_whatsapp_post_times_check CHECK (whatsapp_post_times_ok(whatsapp_post_times));
ALTER TABLE tournaments      DROP CONSTRAINT IF EXISTS tournaments_whatsapp_post_times_check;
ALTER TABLE tournaments      ADD CONSTRAINT tournaments_whatsapp_post_times_check CHECK (whatsapp_post_times_ok(whatsapp_post_times));
ALTER TABLE lesson_series    DROP CONSTRAINT IF EXISTS lesson_series_whatsapp_post_times_check;
ALTER TABLE lesson_series    ADD CONSTRAINT lesson_series_whatsapp_post_times_check CHECK (whatsapp_post_times_ok(whatsapp_post_times));

-- As datas novas de um mix que se repete herdam as horas da série (sem
-- mexer no process_due_game_recurrences, que outras migrações redefinem).
CREATE OR REPLACE FUNCTION public.games_inherit_whatsapp_post_times()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF NEW.recurrence_id IS NOT NULL AND NEW.whatsapp_post_times IS NULL THEN
    SELECT whatsapp_post_times INTO NEW.whatsapp_post_times FROM game_recurrences WHERE id = NEW.recurrence_id;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.games_inherit_whatsapp_post_times() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS games_inherit_whatsapp_post_times_trigger ON games;
CREATE TRIGGER games_inherit_whatsapp_post_times_trigger
  BEFORE INSERT ON games
  FOR EACH ROW EXECUTE FUNCTION games_inherit_whatsapp_post_times();

-- ── 2. Peças internas ───────────────────────────────────────────────────
-- As horas do clube (horas certas) em TIME[].
CREATE OR REPLACE FUNCTION public.club_whatsapp_post_times(p_organization_id UUID)
RETURNS TIME[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(ARRAY(SELECT make_time(h, 0, 0) FROM unnest(o.whatsapp_post_hours) h ORDER BY h), '{}')
    FROM organizations o WHERE o.id = p_organization_id;
$$;

CREATE OR REPLACE FUNCTION public.whatsapp_times_text(p_times TIME[])
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN p_times IS NULL THEN NULL
              ELSE COALESCE(ARRAY(SELECT to_char(t, 'HH24:MI') FROM unnest(p_times) t ORDER BY t), '{}') END;
$$;

REVOKE ALL ON FUNCTION public.club_whatsapp_post_times(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_times_text(TIME[]) FROM PUBLIC, anon, authenticated;
-- A whatsapp_post_times_ok NÃO se revoga: é usada nos CHECK das 4 tabelas,
-- e o Postgres verifica o EXECUTE a quem escreve a linha (qualquer UPDATE
-- dela, até do robô com service_role). Revogá-la partia as escritas em
-- games (visto pelo SI, 27 set). É IMMUTABLE e não lê nada: não há risco.
GRANT EXECUTE ON FUNCTION public.whatsapp_post_times_ok(TIME[]) TO PUBLIC, anon, authenticated, service_role;

-- ── 3. Gravar ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_event_whatsapp_post_times(p_kind TEXT, p_id UUID, p_times TEXT[])
RETURNS TEXT[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org     UUID;
  v_ok      BOOLEAN := FALSE;
  v_times   TIME[];
  v_teacher UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_allowed'; END IF;

  -- As horas: 'HH:MM', sem repetidas, pela ordem do dia.
  BEGIN
    SELECT COALESCE(array_agg(DISTINCT t::time ORDER BY t::time), '{}') INTO v_times
      FROM unnest(COALESCE(p_times, '{}')) t;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'invalid_times';
  END;
  IF EXISTS (SELECT 1 FROM unnest(COALESCE(p_times, '{}')) t WHERE t !~ '^\d{2}:\d{2}$')
     OR NOT whatsapp_post_times_ok(v_times) THEN
    RAISE EXCEPTION 'invalid_times';
  END IF;

  IF p_kind IN ('mix', 'open_slot') THEN
    SELECT organization_id INTO v_org FROM games WHERE id = p_id;
  ELSIF p_kind = 'mix_series' THEN
    SELECT organization_id INTO v_org FROM game_recurrences WHERE id = p_id;
  ELSIF p_kind = 'tournament' THEN
    v_ok := EXISTS (SELECT 1 FROM tournaments WHERE id = p_id) AND is_tournament_admin(p_id);
  ELSIF p_kind = 'lesson' THEN
    SELECT ls.organization_id, tp.user_id INTO v_org, v_teacher
      FROM lesson_series ls LEFT JOIN teacher_profiles tp ON tp.id = ls.teacher_profile_id
     WHERE ls.id = p_id;
    v_ok := v_teacher IS NOT DISTINCT FROM auth.uid() AND v_teacher IS NOT NULL;
  ELSE
    RAISE EXCEPTION 'not_allowed';
  END IF;

  IF NOT v_ok AND v_org IS NOT NULL THEN
    v_ok := EXISTS (SELECT 1 FROM memberships
                     WHERE organization_id = v_org AND user_id = auth.uid() AND is_admin);
  END IF;
  IF NOT v_ok THEN RAISE EXCEPTION 'not_allowed'; END IF;

  IF p_kind IN ('mix', 'open_slot') THEN
    UPDATE games SET whatsapp_post_times = v_times WHERE id = p_id;
  ELSIF p_kind = 'mix_series' THEN
    UPDATE game_recurrences SET whatsapp_post_times = v_times WHERE id = p_id;
    -- As datas da série já criadas e por começar também mudam (pedido do
    -- Bugs): senão a data seguinte sairia com as horas antigas.
    UPDATE games SET whatsapp_post_times = v_times
     WHERE recurrence_id = p_id AND status IN ('pending', 'open', 'closed');
  ELSIF p_kind = 'tournament' THEN
    UPDATE tournaments SET whatsapp_post_times = v_times WHERE id = p_id;
  ELSE
    UPDATE lesson_series SET whatsapp_post_times = v_times WHERE id = p_id;
  END IF;
  RETURN whatsapp_times_text(v_times);
END;
$$;

-- ── 4. O «vem preenchido» ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.default_whatsapp_post_times(p_organization_id UUID, p_kind TEXT)
RETURNS TEXT[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_times TIME[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM memberships WHERE organization_id = p_organization_id AND user_id = auth.uid()) THEN
    RETURN NULL;
  END IF;
  IF p_kind IN ('mix', 'mix_series') THEN
    SELECT whatsapp_post_times INTO v_times FROM (
      SELECT whatsapp_post_times, created_at FROM games
       WHERE organization_id = p_organization_id AND origin = 'admin' AND whatsapp_post_times IS NOT NULL
      UNION ALL
      SELECT whatsapp_post_times, created_at FROM game_recurrences
       WHERE organization_id = p_organization_id AND whatsapp_post_times IS NOT NULL
    ) x ORDER BY created_at DESC LIMIT 1;
  ELSIF p_kind = 'open_slot' THEN
    SELECT whatsapp_post_times INTO v_times FROM games
     WHERE organization_id = p_organization_id AND origin = 'open_slot' AND whatsapp_post_times IS NOT NULL
     ORDER BY created_at DESC LIMIT 1;
  ELSIF p_kind = 'tournament' THEN
    SELECT whatsapp_post_times INTO v_times FROM tournaments
     WHERE organization_id = p_organization_id AND whatsapp_post_times IS NOT NULL
     ORDER BY created_at DESC LIMIT 1;
  ELSIF p_kind = 'lesson' THEN
    SELECT whatsapp_post_times INTO v_times FROM lesson_series
     WHERE organization_id = p_organization_id AND whatsapp_post_times IS NOT NULL
     ORDER BY created_at DESC LIMIT 1;
  END IF;
  RETURN whatsapp_times_text(COALESCE(v_times, club_whatsapp_post_times(p_organization_id)));
END;
$$;

-- ── 5. O que o robô lê ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.effective_whatsapp_post_times(p_kind TEXT, p_id UUID)
RETURNS TEXT[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_times TIME[];
  v_org   UUID;
BEGIN
  IF p_kind IN ('mix', 'open_slot') THEN
    SELECT whatsapp_post_times, organization_id INTO v_times, v_org FROM games WHERE id = p_id;
  ELSIF p_kind = 'mix_series' THEN
    SELECT whatsapp_post_times, organization_id INTO v_times, v_org FROM game_recurrences WHERE id = p_id;
  ELSIF p_kind = 'tournament' THEN
    SELECT whatsapp_post_times, organization_id INTO v_times, v_org FROM tournaments WHERE id = p_id;
  ELSIF p_kind = 'lesson' THEN
    SELECT whatsapp_post_times, organization_id INTO v_times, v_org FROM lesson_series WHERE id = p_id;
  END IF;
  RETURN whatsapp_times_text(COALESCE(v_times, club_whatsapp_post_times(v_org), '{}'));
END;
$$;

REVOKE ALL ON FUNCTION public.set_event_whatsapp_post_times(TEXT, UUID, TEXT[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.default_whatsapp_post_times(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.effective_whatsapp_post_times(TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_event_whatsapp_post_times(TEXT, UUID, TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.default_whatsapp_post_times(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.effective_whatsapp_post_times(TEXT, UUID) TO service_role;

-- ── 6. Na passagem: os eventos abertos ficam com as horas do clube ──────
UPDATE games g SET whatsapp_post_times = club_whatsapp_post_times(g.organization_id)
 WHERE g.whatsapp_post_times IS NULL AND g.status IN ('open', 'pending', 'draft');
UPDATE game_recurrences r SET whatsapp_post_times = club_whatsapp_post_times(r.organization_id)
 WHERE r.whatsapp_post_times IS NULL AND r.is_active;
UPDATE tournaments t SET whatsapp_post_times = club_whatsapp_post_times(t.organization_id)
 WHERE t.whatsapp_post_times IS NULL AND t.status IN ('rascunho', 'inscricoes');
UPDATE lesson_series s SET whatsapp_post_times = club_whatsapp_post_times(s.organization_id)
 WHERE s.whatsapp_post_times IS NULL AND s.organization_id IS NOT NULL AND s.status IN ('active', 'pending_teacher');

COMMIT;

-- Verificar depois de correr:
--   SELECT count(*) FILTER (WHERE whatsapp_post_times IS NULL) FROM games WHERE status IN ('open','pending','draft');  -- 0
--   SELECT has_function_privilege('anon', 'public.set_event_whatsapp_post_times(text, uuid, text[])', 'EXECUTE');      -- false
--   SELECT has_function_privilege('authenticated', 'public.effective_whatsapp_post_times(text, uuid)', 'EXECUTE');     -- false
