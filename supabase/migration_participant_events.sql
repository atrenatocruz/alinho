-- ════════════════════════════════════════════════════════════════════════
-- Migration: histórico de entradas e saídas (IN/OUT) nos mixes — Trello #171.
--
-- An append-only log of every join/leave/promotion on a mix, so an admin
-- can reconstruct what actually happened when the roster doesn't match
-- what players remember.
--
-- WHY THIS IS NEEDED AT ALL: leaving a mix is a hard DELETE everywhere —
-- GameDetails.jsx (handleLeave, handleLeaveWaitlist, handleRemovePerson)
-- and the bot's `out` handler (whatsapp-bot/src/commands.js) all call
-- .delete() on `participants`. The row is destroyed, `participants` has
-- no updated_at, and there is no audit table anywhere in the schema. So
-- today a player who joined and then vanished leaves *zero* trace. That
-- is precisely the reported incident (card "Bot não registou IN de um
-- jogador"): there was nothing left to inspect.
--
-- WHY A TRIGGER, NOT WRITES AT EACH CALL SITE: `participants` is written
-- from three different places —
--   1. the web app (browser, RLS, auth.uid() = the acting player),
--   2. the WhatsApp bot (separate process, service-role key, no JWT, so
--      auth.uid() IS NULL),
--   3. Postgres itself — the suplente auto-promotion trigger
--      (migration_suplentes.sql) flips a waitlisted row to confirmed
--      inside the leaving player's own transaction.
-- A trigger on the table is the single point all three converge on.
-- Logging at each call site would have missed the bot and the automatic
-- promotion, which are exactly the two paths nobody can currently see.
--
-- APPEND-ONLY BY CONSTRUCTION: there is deliberately no INSERT, UPDATE or
-- DELETE policy on this table. The only writer is the SECURITY DEFINER
-- trigger below, so a log row cannot be rewritten or quietly removed by
-- anyone going through the REST API — same reasoning as the `consents`
-- table in the cookie-consent spec.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE participant_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  -- The player the event is about.
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- Who caused it: auth.uid() at the time. NULL for the bot (service-role,
  -- no JWT) and for automatic promotions. Differs from user_id when an
  -- admin removes somebody else.
  actor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  -- The partner on the same participants row, when the player joined as a
  -- pair — one participants row represents two people entering.
  partner_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN (
    'in',              -- joined a confirmed spot
    'waitlisted',      -- joined straight onto the suplentes list
    'out',             -- left / was removed (the row was deleted)
    'promoted',        -- suplente automatically promoted to confirmed
    'partner_added',
    'partner_removed'
  )),
  source TEXT NOT NULL CHECK (source IN ('app', 'bot', 'system')),
  status_before TEXT,
  status_after TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

-- The only query this table serves: one mix's log, oldest first.
CREATE INDEX participant_events_game_id_created_at_idx
  ON participant_events (game_id, created_at);

ALTER TABLE participant_events ENABLE ROW LEVEL SECURITY;

-- Read: admins of the mix's own club. Reuses the existing is_org_admin
-- helper (schema.sql:196) rather than inlining another copy of the
-- memberships EXISTS check — see CLAUDE.md on that duplication being debt,
-- not a pattern to copy.
--
-- Deliberately admin-only: this is a debugging/accountability tool, and it
-- records who removed whom. Exposing "admin X removed you" to every member
-- is a different product decision, not this card's.
CREATE POLICY "Org admins can read participant events"
  ON participant_events FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM games
    WHERE games.id = participant_events.game_id
      AND is_org_admin(games.organization_id)
  ));

-- ── The single writer ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION log_participant_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

DROP TRIGGER IF EXISTS participant_events_trigger ON participants;
CREATE TRIGGER participant_events_trigger
AFTER INSERT OR UPDATE OR DELETE ON participants
FOR EACH ROW EXECUTE FUNCTION log_participant_event();

-- The trigger is the only writer; nothing calls this directly.
REVOKE ALL ON FUNCTION log_participant_event() FROM public;

GRANT SELECT ON participant_events TO authenticated;
