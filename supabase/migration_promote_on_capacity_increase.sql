-- ════════════════════════════════════════════════════════════════════════
-- Promote suplentes when an admin raises a mix's capacity (adds a court),
-- not just when someone leaves.
--
-- check_game_promote() (see migration_suplentes.sql) only runs on
-- `AFTER DELETE ON participants` — it never fires when an admin edits a
-- full mix to add a court, so the freed-up slots stayed empty and
-- suplentes never got auto-promoted even though there was now room.
--
-- Extracts the promotion loop into promote_waitlist(game_id), reused by
-- both the existing DELETE trigger and a new trigger that fires
-- `AFTER UPDATE OF num_courts, max_players ON games`, only promoting when
-- capacity actually went up (a decrease should not reopen or touch
-- anything — it's not what triggered this).
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION promote_waitlist(p_game_id UUID)
RETURNS VOID AS $$
DECLARE
  cap INTEGER;
  people INTEGER;
  v_waitlisted_id UUID;
BEGIN
  SELECT COALESCE(max_players, num_courts * 4) INTO cap FROM games WHERE id = p_game_id;

  LOOP
    SELECT COALESCE(SUM(1 + CASE WHEN partner_id IS NOT NULL THEN 1 ELSE 0 END), 0)
      INTO people
      FROM participants
     WHERE game_id = p_game_id AND status = 'confirmed';

    EXIT WHEN people >= cap;

    SELECT id INTO v_waitlisted_id
      FROM participants
     WHERE game_id = p_game_id AND status = 'waitlisted'
     ORDER BY created_at
     LIMIT 1;

    EXIT WHEN v_waitlisted_id IS NULL;

    UPDATE participants SET status = 'confirmed' WHERE id = v_waitlisted_id;
  END LOOP;

  -- No one left to promote but a slot is still free — reopen for fresh
  -- signups, same condition check_game_reopen used to check.
  SELECT COALESCE(SUM(1 + CASE WHEN partner_id IS NOT NULL THEN 1 ELSE 0 END), 0)
    INTO people
    FROM participants
   WHERE game_id = p_game_id AND status = 'confirmed';

  IF people < cap THEN
    UPDATE games SET status = 'open', updated_at = NOW()
    WHERE id = p_game_id AND status = 'closed';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Same behavior as before, now delegating to the shared helper.
CREATE OR REPLACE FUNCTION check_game_promote()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM promote_waitlist(OLD.game_id);
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION check_game_capacity_increase()
RETURNS TRIGGER AS $$
DECLARE
  old_cap INTEGER;
  new_cap INTEGER;
BEGIN
  old_cap := COALESCE(OLD.max_players, OLD.num_courts * 4);
  new_cap := COALESCE(NEW.max_players, NEW.num_courts * 4);

  IF new_cap > old_cap THEN
    PERFORM promote_waitlist(NEW.id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS game_capacity_increase_trigger ON games;
CREATE TRIGGER game_capacity_increase_trigger
AFTER UPDATE OF num_courts, max_players ON games
FOR EACH ROW EXECUTE FUNCTION check_game_capacity_increase();
