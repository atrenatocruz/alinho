-- Copiado de supabase/migration_promote_on_capacity_increase.sql (a versão mais
-- recente destas duas funções no repositório) — só para o teste do guarda.

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

CREATE OR REPLACE FUNCTION check_game_promote()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM promote_waitlist(OLD.game_id);
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
