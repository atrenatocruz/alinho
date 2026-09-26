-- ═════════════════════════════════════════════════════════════════════════
-- «Abrem as inscrições»: o mix que não se repete e o torneio abrem sozinhos
-- à hora marcada (Trello #342, passo 2 «Quando»)
--
-- Plano aprovado pelo Francisco a 26 set. Ecrãs: Dev 1 (torneio) e Bugs
-- (mix). Hoje só dava «Já»: nem o torneio nem o mix único tinham hora de
-- abrir.
--
-- MIX QUE NÃO SE REPETE — aproveita o que os mixes que se repetem já usam:
--   · cria-se com status 'pending' e launch_at = a hora de abrir (INSERT
--     direto, como hoje; a política de criar já aceita 'pending' e ele não
--     conta para o limite do plano até abrir);
--   · ninguém se inscreve antes (trava em participants, como a do rascunho);
--   · à hora marcada passa a 'open' sozinho, e o robô anuncia-o como anuncia
--     um mix novo (só anuncia 'open').
--   O cron das séries (process_due_game_recurrences) não é tocado: só olha
--   para os 'pending' COM série. Este trata os 'pending' SEM série.
--   Um 'pending' sem série e sem hora nunca abriria: fica proibido (CHECK,
--   NOT VALID — não reavalia linhas antigas).
--
-- TORNEIO — o 'rascunho' já existe e já está escondido (RLS) e fechado a
-- inscrições:
--   · tournaments.registrations_open_at = a hora de abrir;
--   · schedule_tournament_opening(id, hora): só o admin; sem hora ou hora
--     já passada abre logo (como o «Abrir inscrições» de hoje); com hora
--     futura guarda-a e o torneio fica em rascunho até lá;
--   · à hora marcada passa a 'inscricoes' sozinho;
--   · se o estado mudar por outro caminho (abrir à mão, voltar a rascunho),
--     a hora marcada apaga-se — nunca reabre sozinho um torneio que alguém
--     fechou.
--
-- UM SÓ TRABALHO AUTOMÁTICO: open_due_registrations(), de minuto a minuto.
--
-- Nota para o Renato (proposta, por acordar): ao abrir sozinho, o mix não
-- volta a medir o limite de mixes ativos do plano — tal como os das séries.
--
-- Dev 3, 26 set 2026 · depois de migration_mix_draft.sql
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 0. Peças de que depende ─────────────────────────────────────────────
DO $$
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    RAISE EXCEPTION 'Falta o pg_cron. Parar e ler.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'games' AND column_name = 'launch_at') THEN
    RAISE EXCEPTION 'Falta games.launch_at (migration_recurring_mixes_pending_state.sql). Parar e ler.';
  END IF;
  IF to_regclass('public.tournaments') IS NULL OR to_regprocedure('public.is_tournament_admin(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Faltam os torneios (tournaments / is_tournament_admin). Parar e ler.';
  END IF;
END $$;

-- ── 1. Mix único: 'pending' precisa de hora ─────────────────────────────
ALTER TABLE games DROP CONSTRAINT IF EXISTS games_pending_needs_launch_at;
ALTER TABLE games ADD CONSTRAINT games_pending_needs_launch_at
  CHECK (status IS DISTINCT FROM 'pending' OR recurrence_id IS NOT NULL OR launch_at IS NOT NULL) NOT VALID;

-- ── 2. Mix único: ninguém se inscreve antes de abrir ────────────────────
-- Só os 'pending' sem série: os das séries ficam como estão hoje.
CREATE OR REPLACE FUNCTION public.participants_not_open_yet_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM games
              WHERE id = NEW.game_id AND status = 'pending' AND recurrence_id IS NULL) THEN
    RAISE EXCEPTION 'mix_not_open_yet' USING ERRCODE = 'P0001',
      DETAIL = 'As inscrições deste mix ainda não abriram.';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.participants_not_open_yet_guard() FROM anon, authenticated, PUBLIC;

DROP TRIGGER IF EXISTS participants_not_open_yet_guard_trigger ON participants;
CREATE TRIGGER participants_not_open_yet_guard_trigger
  BEFORE INSERT OR UPDATE OF game_id ON participants
  FOR EACH ROW EXECUTE FUNCTION participants_not_open_yet_guard();

-- ── 3. Torneio: a hora de abrir ─────────────────────────────────────────
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS registrations_open_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS tournaments_opening_idx
  ON tournaments (registrations_open_at) WHERE status = 'rascunho' AND registrations_open_at IS NOT NULL;

-- Se o estado sair de 'rascunho' (por qualquer caminho), a hora marcada
-- já não serve; se voltar a 'rascunho' à mão, não reabre sozinho.
CREATE OR REPLACE FUNCTION public.tournaments_clear_opening()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.registrations_open_at := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.tournaments_clear_opening() FROM anon, authenticated, PUBLIC;

DROP TRIGGER IF EXISTS tournaments_clear_opening_trigger ON tournaments;
CREATE TRIGGER tournaments_clear_opening_trigger
  BEFORE UPDATE OF status ON tournaments
  FOR EACH ROW EXECUTE FUNCTION tournaments_clear_opening();

-- O admin marca a hora (ou abre já). Devolve o estado em que o torneio fica.
CREATE OR REPLACE FUNCTION public.schedule_tournament_opening(p_tournament_id UUID, p_opens_at TIMESTAMPTZ)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF NOT is_tournament_admin(p_tournament_id) THEN
    RAISE EXCEPTION 'Só um admin do clube pode abrir as inscrições deste torneio'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT status INTO v_status FROM tournaments WHERE id = p_tournament_id FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Torneio não encontrado'; END IF;
  IF v_status <> 'rascunho' THEN
    RAISE EXCEPTION 'As inscrições deste torneio já abriram';
  END IF;

  IF p_opens_at IS NULL OR p_opens_at <= NOW() THEN
    UPDATE tournaments SET status = 'inscricoes' WHERE id = p_tournament_id;
    RETURN 'inscricoes';
  END IF;

  UPDATE tournaments SET registrations_open_at = p_opens_at WHERE id = p_tournament_id;
  RETURN 'rascunho';
END;
$$;

REVOKE ALL ON FUNCTION public.schedule_tournament_opening(UUID, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.schedule_tournament_opening(UUID, TIMESTAMPTZ) FROM anon;
GRANT EXECUTE ON FUNCTION public.schedule_tournament_opening(UUID, TIMESTAMPTZ) TO authenticated;

-- ── 4. Abrir à hora certa ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.open_due_registrations()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Mixes únicos (os das séries são do process_due_game_recurrences).
  UPDATE games SET status = 'open', updated_at = NOW(), launch_at = NULL
   WHERE status = 'pending' AND recurrence_id IS NULL
     AND launch_at IS NOT NULL AND launch_at <= NOW();

  -- Torneios (o trigger apaga a hora marcada).
  UPDATE tournaments SET status = 'inscricoes'
   WHERE status = 'rascunho'
     AND registrations_open_at IS NOT NULL AND registrations_open_at <= NOW();
END;
$$;

REVOKE ALL ON FUNCTION public.open_due_registrations() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.open_due_registrations() FROM anon, authenticated;

-- cron.schedule substitui o trabalho se já existir: pode correr outra vez.
SELECT cron.schedule('open-due-registrations', '* * * * *', $$SELECT public.open_due_registrations()$$);

COMMIT;

-- Verificar depois de correr:
--   SELECT jobname, schedule FROM cron.job WHERE jobname = 'open-due-registrations';   -- 1 linha, '* * * * *'
--   SELECT has_function_privilege('anon', 'public.schedule_tournament_opening(uuid, timestamptz)', 'EXECUTE');  -- false
--   SELECT has_function_privilege('authenticated', 'public.open_due_registrations()', 'EXECUTE');              -- false
