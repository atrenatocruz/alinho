-- ════════════════════════════════════════════════════════════════════════
-- Apagar um mix que tem inscritos volta a funcionar.
--
-- SINTOMA (Francisco, 22 set 2026): carregou no caixote do lixo do mix
-- «Terças @ IPC» no Gerir e o mix continuou lá. Não é um caso isolado:
-- acontece com QUALQUER mix que tenha pelo menos um inscrito.
--
-- PORQUÊ. Apagar o jogo apaga em cascata os inscritos (participants). Cada
-- inscrito apagado dispara o log do histórico de entradas e saídas
-- (log_participant_event, de migration_participant_events.sql), que INSERE
-- uma linha em participant_events com o game_id daquele jogo — jogo que
-- acabou de ser apagado. No fim da instrução o Postgres verifica a chave
-- estrangeira dessa linha nova, não encontra o jogo, e rebenta tudo:
--
--   ERRO 23503: insert or update on table "participant_events"
--   violates foreign key constraint "participant_events_game_id_fkey"
--
-- Confirmado em produção a 22 set com um ensaio desfeito no fim (o mix
-- nunca chegou a ser apagado): o apagar falhava com este erro exato.
--
-- O QUE MUDA. Quando o jogo já não existe, o log é saltado. É o que a
-- própria função já diz de si mesma: «Logging is diagnostics; it must never
-- be load-bearing» — um registo de diagnóstico não pode impedir de apagar
-- um mix. E não se perde histórico nenhum: as linhas de participant_events
-- daquele jogo são apagadas em cascata logo a seguir, porque o jogo deixou
-- de existir.
--
-- Quando alguém sai de um mix que continua a existir, nada muda: o jogo
-- está lá, o registo é feito como sempre.
--
-- Esta função é redefinida em migration_participant_events.sql — se essa
-- vier a ser corrida outra vez por cima, esta correção perde-se e o bug
-- volta. Correr esta depois.
--
-- É seguro re-correr.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION log_participant_event()
RETURNS TRIGGER AS $$
DECLARE
  v_actor UUID := auth.uid();
  -- No JWT means nobody is signed in on this connection — in practice that
  -- is the bot, which talks to Postgres with the service-role key.
  v_source TEXT := CASE WHEN auth.uid() IS NULL THEN 'bot' ELSE 'app' END;
BEGIN
  -- `participants.user_id` is nullable in the schema (schema.sql:111) even
  -- though every current write sets it. A NOT NULL violation raised in here
  -- would abort the caller's INSERT/DELETE — i.e. break joining a mix — so
  -- an unattributable row is skipped rather than allowed to take the write
  -- down with it. Logging is diagnostics; it must never be load-bearing.
  --
  -- Split by TG_OP on purpose: in a DELETE trigger NEW is unassigned, and
  -- touching NEW.anything there raises "record 'new' is not assigned yet".
  IF TG_OP = 'DELETE' THEN
    IF OLD.user_id IS NULL THEN RETURN OLD; END IF;
    -- O jogo já não existe: isto é o apagar do mix a cair em cascata nos
    -- inscritos. Registar a saída aqui era inserir uma linha a apontar para
    -- um jogo apagado — chave estrangeira violada, e o apagar do mix
    -- falhava inteiro (Francisco, 22 set 2026).
    IF NOT EXISTS (SELECT 1 FROM games WHERE id = OLD.game_id) THEN
      RETURN OLD;
    END IF;
  ELSE
    IF NEW.user_id IS NULL THEN RETURN NEW; END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO participant_events (game_id, user_id, actor_id, partner_id, action, source, status_after)
    VALUES (
      NEW.game_id, NEW.user_id, v_actor, NEW.partner_id,
      -- 'cancelled' is part of the documented status vocabulary
      -- (schema.sql:113) even though nothing writes it today; mapping it to
      -- 'in' would be an actively misleading log line.
      CASE NEW.status WHEN 'waitlisted' THEN 'waitlisted' WHEN 'cancelled' THEN 'out' ELSE 'in' END,
      v_source, NEW.status
    );
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO participant_events (game_id, user_id, actor_id, partner_id, action, source, status_before)
    VALUES (OLD.game_id, OLD.user_id, v_actor, OLD.partner_id, 'out', v_source, OLD.status);
    RETURN OLD;

  ELSE -- UPDATE
    -- waitlisted → confirmed is the automatic suplente promotion, which
    -- runs inside whoever's transaction freed the spot. Attributing it to
    -- that player would read as "they added someone", so it is recorded as
    -- a system event with no actor.
    IF OLD.status IS DISTINCT FROM NEW.status THEN
      INSERT INTO participant_events (game_id, user_id, actor_id, partner_id, action, source, status_before, status_after)
      VALUES (
        NEW.game_id, NEW.user_id,
        CASE WHEN OLD.status = 'waitlisted' AND NEW.status = 'confirmed' THEN NULL ELSE v_actor END,
        NEW.partner_id,
        CASE WHEN OLD.status = 'waitlisted' AND NEW.status = 'confirmed' THEN 'promoted'
             WHEN NEW.status = 'waitlisted' THEN 'waitlisted'
             WHEN NEW.status = 'cancelled' THEN 'out'
             ELSE 'in' END,
        CASE WHEN OLD.status = 'waitlisted' AND NEW.status = 'confirmed' THEN 'system' ELSE v_source END,
        OLD.status, NEW.status
      );
    END IF;

    IF OLD.partner_id IS DISTINCT FROM NEW.partner_id THEN
      INSERT INTO participant_events (game_id, user_id, actor_id, partner_id, action, source, status_before, status_after)
      VALUES (
        NEW.game_id, NEW.user_id, v_actor,
        COALESCE(NEW.partner_id, OLD.partner_id),
        CASE WHEN NEW.partner_id IS NULL THEN 'partner_removed' ELSE 'partner_added' END,
        v_source, OLD.status, NEW.status
      );
    END IF;

    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── Verificação ──────────────────────────────────────────────────────────
-- A função já tem a trava:
-- SELECT pg_get_functiondef(oid) ~ 'NOT EXISTS \(SELECT 1 FROM games' AS tem_a_trava
-- FROM pg_proc WHERE proname = 'log_participant_event';
--
-- Ensaio que se desfaz no fim (troca o id pelo do mix a testar):
-- DO $$
-- DECLARE r TEXT;
-- BEGIN
--   BEGIN
--     DELETE FROM games WHERE id = '<id do mix>';
--     r := 'apagou sem erro';
--   EXCEPTION WHEN others THEN r := 'ERRO ' || SQLSTATE || ': ' || SQLERRM;
--   END;
--   RAISE EXCEPTION 'ENSAIO (tudo desfeito) -> %', r;
-- END $$;
