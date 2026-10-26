-- ═════════════════════════════════════════════════════════════════════════
-- Mix: pedir a correção de um resultado ao organizador
--
-- PORQUÊ. Aprovado pelo Francisco a 23 out («sim aprovo pedir a correcção dos
-- mixes»): design-handoff/2026-10-23-mix-pedir-correcao/ (REGRAS-BA.md, 11
-- regras, e SPEC.md). O mesmo «Pedir correção» do torneio, no mix. Ecrãs:
-- Dev 2.
--
-- O QUE FAZ
--   · games.finished_at: quando o mix terminou (para as 48 horas). Grava-se
--     sozinho ao passar a 'finished'; os que já terminaram ficam com o
--     updated_at, que é o mais perto que há.
--   · mix_match_corrections: um pedido por jogo, para sempre (aceite ou
--     recusado, não se pede outra vez para o mesmo jogo).
--   · request_mix_match_correction(p_match_id, p_score_a, p_score_b,
--     p_note, p_sets) → id. Pedem os jogadores com conta desse jogo, com o
--     mix a decorrer ou até 48 h depois de terminar. Quem organiza não pede
--     (corrige diretamente). Aviso no sino a todos os admins do grupo/clube
--     ('mix_correction_requested').
--     Erros: no_session, not_found, not_scored, not_a_player, is_organizer,
--     too_late, already_requested, bad_score, same_score, draw_not_allowed.
--   · resolve_mix_match_correction(p_correction_id, p_accept, p_reason,
--     p_new_winner_team_id) → {ok, accepted, ...}. Aceitar faz o mesmo que o
--     «Corrigir resultado» de hoje: com o mix a decorrer, save_mix_match_
--     result; terminado, correct_finished_mix_match (o p_new_winner_team_id
--     é a dupla vencedora do mix depois da correção, como no ecrã de hoje;
--     no Americano é ignorado) e devolve o que essa devolve. Recusar leva
--     uma razão opcional. Os avisos dos admins ficam lidos; os 4 jogadores
--     recebem 'mix_correction_accepted' ou 'mix_correction_declined'.
--     Erros: not_found, not_allowed, not_pending.
--   · list_mix_match_corrections(p_game_id): os pedidos do mix, para quem
--     vê o mix (o ecrã mostra a caixa âmbar, verde ou cinzenta no jogo).
--   O fecho do Ranking do mês não muda: o correct_finished_mix_match já não
--   mexe no que foi dado.
--
-- COMPATIBILIDADE. Só acrescenta.
--
-- Dev 3, 26 out 2026 · ecrãs: Dev 2
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Quando o mix terminou ────────────────────────────────────────────
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.games_set_finished_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF NEW.status = 'finished' AND OLD.status IS DISTINCT FROM 'finished' THEN
    NEW.finished_at := COALESCE(NEW.finished_at, NOW());
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.games_set_finished_at() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS games_set_finished_at ON public.games;
CREATE TRIGGER games_set_finished_at
  BEFORE UPDATE OF status ON public.games
  FOR EACH ROW EXECUTE FUNCTION public.games_set_finished_at();

UPDATE public.games SET finished_at = updated_at WHERE status = 'finished' AND finished_at IS NULL;

-- ── 2. Os pedidos ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mix_match_corrections (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id      UUID NOT NULL UNIQUE REFERENCES public.matches(id) ON DELETE CASCADE,
  game_id       UUID NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  requested_by  UUID NOT NULL,
  old_score_a   INTEGER,
  old_score_b   INTEGER,
  score_a       INTEGER NOT NULL,
  score_b       INTEGER NOT NULL,
  sets          JSONB,
  note          TEXT,
  status        TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aceite', 'recusado')),
  decided_by    UUID,
  decided_at    TIMESTAMPTZ,
  reason        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mix_match_corrections_game ON public.mix_match_corrections (game_id);
ALTER TABLE public.mix_match_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mix_match_corrections FROM PUBLIC, anon, authenticated;

-- Os jogadores com conta de um jogo do mix.
CREATE OR REPLACE FUNCTION public.mix_match_player_ids(p_match_id UUID)
RETURNS UUID[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT COALESCE(array_agg(DISTINCT x) FILTER (WHERE x IS NOT NULL), '{}')
    FROM matches m
    JOIN teams t ON t.id IN (m.team_a_id, m.team_b_id)
    CROSS JOIN LATERAL (VALUES (t.player1_id), (t.player2_id)) AS v(x)
   WHERE m.id = p_match_id;
$function$;
REVOKE ALL ON FUNCTION public.mix_match_player_ids(UUID) FROM PUBLIC, anon, authenticated;

-- ── 3. Pedir ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.request_mix_match_correction(
  p_match_id UUID, p_score_a INTEGER, p_score_b INTEGER, p_note TEXT DEFAULT NULL, p_sets JSONB DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid  UUID := auth.uid();
  v_m    matches%ROWTYPE;
  v_g    games%ROWTYPE;
  v_id   UUID;
  v_name TEXT;
  v_group TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'no_session'; END IF;
  SELECT * INTO v_m FROM matches WHERE id = p_match_id;
  IF v_m.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  SELECT * INTO v_g FROM games WHERE id = v_m.game_id;
  IF v_g.status NOT IN ('in_progress', 'finished') THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_m.score_a IS NULL OR v_m.score_b IS NULL THEN RAISE EXCEPTION 'not_scored'; END IF;
  IF NOT (v_uid = ANY (mix_match_player_ids(p_match_id))) THEN
    RAISE EXCEPTION 'not_a_player' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Quem organiza corrige diretamente (regra 10).
  IF is_org_admin(v_g.organization_id) THEN RAISE EXCEPTION 'is_organizer'; END IF;
  IF v_g.status = 'finished' AND COALESCE(v_g.finished_at, v_g.updated_at) < NOW() - INTERVAL '48 hours' THEN
    RAISE EXCEPTION 'too_late';
  END IF;
  IF EXISTS (SELECT 1 FROM mix_match_corrections WHERE match_id = p_match_id) THEN
    RAISE EXCEPTION 'already_requested';
  END IF;
  IF p_score_a IS NULL OR p_score_b IS NULL OR p_score_a < 0 OR p_score_b < 0 OR p_score_a > 99 OR p_score_b > 99 THEN
    RAISE EXCEPTION 'bad_score';
  END IF;
  IF p_sets IS NOT NULL AND jsonb_typeof(p_sets) <> 'array' THEN RAISE EXCEPTION 'bad_score'; END IF;
  IF p_score_a = v_m.score_a AND p_score_b = v_m.score_b THEN RAISE EXCEPTION 'same_score'; END IF;
  -- Depois do fim, a correção não pode deixar um empate (como o «Corrigir
  -- resultado» de hoje).
  IF v_g.status = 'finished' AND p_score_a = p_score_b THEN RAISE EXCEPTION 'draw_not_allowed'; END IF;

  INSERT INTO mix_match_corrections (match_id, game_id, requested_by, old_score_a, old_score_b, score_a, score_b, sets, note)
  VALUES (p_match_id, v_g.id, v_uid, v_m.score_a, v_m.score_b, p_score_a, p_score_b, p_sets,
          NULLIF(left(btrim(COALESCE(p_note, '')), 500), ''))
  RETURNING id INTO v_id;

  SELECT name INTO v_name FROM profiles WHERE id = v_uid;
  SELECT name INTO v_group FROM organizations WHERE id = v_g.organization_id;
  INSERT INTO notifications (user_id, kind, game_id, actor_id, data)
  SELECT mb.user_id, 'mix_correction_requested', v_g.id, v_uid,
         jsonb_build_object('correction_id', v_id, 'match_id', p_match_id,
                            'round_number', v_m.round_number, 'court_number', v_m.court_number,
                            'score_a', p_score_a, 'score_b', p_score_b,
                            'requester_name', v_name, 'group_name', v_group,
                            'game_title', v_g.title, 'game_date', v_g.date)
    FROM memberships mb
   WHERE mb.organization_id = v_g.organization_id AND mb.is_admin AND mb.user_id <> v_uid;

  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.request_mix_match_correction(UUID, INTEGER, INTEGER, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_mix_match_correction(UUID, INTEGER, INTEGER, TEXT, JSONB) TO authenticated;

-- ── 4. Responder (organizador) ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_mix_match_correction(
  p_correction_id UUID, p_accept BOOLEAN, p_reason TEXT DEFAULT NULL, p_new_winner_team_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_c   mix_match_corrections%ROWTYPE;
  v_g   games%ROWTYPE;
  v_out JSONB := '{}'::jsonb;
  v_kind TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_allowed'; END IF;
  SELECT * INTO v_c FROM mix_match_corrections WHERE id = p_correction_id FOR UPDATE;
  IF v_c.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  SELECT * INTO v_g FROM games WHERE id = v_c.game_id;
  IF NOT EXISTS (SELECT 1 FROM memberships
                  WHERE organization_id = v_g.organization_id AND (is_platform_admin_me() OR (user_id = auth.uid() AND is_admin))) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_c.status <> 'pendente' THEN RAISE EXCEPTION 'not_pending'; END IF;

  -- Respondido, o aviso fica lido para todos os admins (o primeiro decide).
  UPDATE notifications SET read_at = NOW()
   WHERE kind = 'mix_correction_requested' AND read_at IS NULL AND data->>'correction_id' = v_c.id::text;

  IF COALESCE(p_accept, FALSE) THEN
    -- Marca antes de aplicar: a correção é a mesma do «Corrigir resultado».
    UPDATE mix_match_corrections SET status = 'aceite', decided_by = auth.uid(), decided_at = NOW()
     WHERE id = v_c.id;
    IF v_g.status = 'finished' THEN
      v_out := COALESCE(to_jsonb(correct_finished_mix_match(v_c.match_id, v_c.score_a, v_c.score_b, p_new_winner_team_id, v_c.sets)), '{}'::jsonb);
    ELSE
      v_out := save_mix_match_result(v_c.match_id, v_c.score_a, v_c.score_b, v_c.sets);
    END IF;
    v_kind := 'mix_correction_accepted';
  ELSE
    UPDATE mix_match_corrections
       SET status = 'recusado', decided_by = auth.uid(), decided_at = NOW(),
           reason = NULLIF(left(btrim(COALESCE(p_reason, '')), 500), '')
     WHERE id = v_c.id;
    v_kind := 'mix_correction_declined';
  END IF;

  -- Avisa os jogadores com conta desse jogo (quem pediu e os outros).
  INSERT INTO notifications (user_id, kind, game_id, actor_id, data)
  SELECT x, v_kind, v_g.id, auth.uid(),
         jsonb_build_object('correction_id', v_c.id, 'match_id', v_c.match_id,
                            'score_a', v_c.score_a, 'score_b', v_c.score_b,
                            'reason', NULLIF(left(btrim(COALESCE(p_reason, '')), 500), ''),
                            'requester_name', (SELECT name FROM profiles WHERE id = v_c.requested_by),
                            'game_title', v_g.title, 'game_date', v_g.date)
    FROM unnest(mix_match_player_ids(v_c.match_id)) AS x
   WHERE x IS DISTINCT FROM auth.uid();

  RETURN jsonb_build_object('ok', TRUE, 'accepted', COALESCE(p_accept, FALSE)) || COALESCE(v_out, '{}'::jsonb);
END;
$function$;
REVOKE ALL ON FUNCTION public.resolve_mix_match_correction(UUID, BOOLEAN, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_mix_match_correction(UUID, BOOLEAN, TEXT, UUID) TO authenticated;

-- ── 5. Ver os pedidos de um mix ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_mix_match_corrections(p_game_id UUID)
RETURNS TABLE(correction_id UUID, match_id UUID, status TEXT, requested_by UUID, requester_name TEXT,
              old_score_a INTEGER, old_score_b INTEGER, score_a INTEGER, score_b INTEGER, note TEXT,
              reason TEXT, created_at TIMESTAMPTZ, decided_at TIMESTAMPTZ)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  -- Quem vê o mix (as mesmas regras da tabela games).
  IF NOT EXISTS (SELECT 1 FROM games g WHERE g.id = p_game_id
                  AND (is_platform_admin_me()
                       OR EXISTS (SELECT 1 FROM memberships mb WHERE mb.organization_id = g.organization_id AND mb.user_id = auth.uid()))) THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT c.id, c.match_id, c.status, c.requested_by, p.name, c.old_score_a, c.old_score_b, c.score_a, c.score_b,
           c.note, c.reason, c.created_at, c.decided_at
      FROM mix_match_corrections c
      LEFT JOIN profiles p ON p.id = c.requested_by
     WHERE c.game_id = p_game_id
     ORDER BY c.created_at;
END;
$function$;
REVOKE ALL ON FUNCTION public.list_mix_match_corrections(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_mix_match_corrections(UUID) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT count(*) FROM pg_trigger WHERE tgname = 'games_set_finished_at';   → 1
--   SELECT has_table_privilege('anon', 'public.mix_match_corrections', 'SELECT');   → false
--   SELECT has_function_privilege('anon', 'public.request_mix_match_correction(uuid,integer,integer,text,jsonb)', 'EXECUTE');   → false
