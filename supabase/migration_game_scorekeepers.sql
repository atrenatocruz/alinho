-- ════════════════════════════════════════════════════════════════════════
-- Migration: game scorekeepers — an admin can delegate score entry for one
-- specific mix to one or more players, so the admin doesn't have to walk
-- court to court collecting results themselves. Permission is scoped to
-- that single game and only while it's in_progress — once the mix closes
-- (finished/cancelled), the matches UPDATE policy's own status check
-- means a delegated scorekeeper can no longer edit anything, no manual
-- revocation needed. Trello #26.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE game_scorekeepers (
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  PRIMARY KEY (game_id, user_id)
);
ALTER TABLE game_scorekeepers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can see scorekeepers"
  ON game_scorekeepers FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM games JOIN memberships ON memberships.organization_id = games.organization_id
    WHERE games.id = game_scorekeepers.game_id AND memberships.user_id = auth.uid()
  ));

CREATE POLICY "Org admins manage scorekeepers"
  ON game_scorekeepers FOR ALL
  USING (EXISTS (
    SELECT 1 FROM games JOIN memberships ON memberships.organization_id = games.organization_id
    WHERE games.id = game_scorekeepers.game_id AND memberships.user_id = auth.uid() AND memberships.is_admin
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM games JOIN memberships ON memberships.organization_id = games.organization_id
    WHERE games.id = game_scorekeepers.game_id AND memberships.user_id = auth.uid() AND memberships.is_admin
  ));

-- Deliberately UPDATE-only (not FOR ALL like "Org admins manage matches")
-- — a delegated scorekeeper reports scores, they don't restructure the
-- bracket (insert/delete matches stays admin-only).
CREATE POLICY "Scorekeepers can submit scores while in progress"
  ON matches FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM games
    WHERE games.id = matches.game_id AND games.status = 'in_progress'
      AND EXISTS (SELECT 1 FROM game_scorekeepers gs WHERE gs.game_id = games.id AND gs.user_id = auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM games
    WHERE games.id = matches.game_id AND games.status = 'in_progress'
      AND EXISTS (SELECT 1 FROM game_scorekeepers gs WHERE gs.game_id = games.id AND gs.user_id = auth.uid())
  ));
