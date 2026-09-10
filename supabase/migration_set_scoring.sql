-- ════════════════════════════════════════════════════════════════════════
-- Migration: Set scoring formats (melhor de 2/3 sets / pro-set a 9)
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- NOT LIVE until run there — this file existing in the repo changes
-- nothing on its own. Every existing mix defaults to 'pontos_simples',
-- today's behavior, unchanged.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Per-mix scoring choice ───────────────────────────────────────────
ALTER TABLE games ADD COLUMN IF NOT EXISTS scoring_format TEXT NOT NULL DEFAULT 'pontos_simples';
ALTER TABLE games DROP CONSTRAINT IF EXISTS games_scoring_format_check;
ALTER TABLE games ADD CONSTRAINT games_scoring_format_check
  CHECK (scoring_format IN ('pontos_simples', 'pro_set_9', 'melhor_2_sets', 'melhor_3_sets'));

-- ── 2. Per-set scores, populated for melhor_2_sets and melhor_3_sets
--      matches — they share this table, differing only in whether the 1-1
--      decider (set_number 3) is a super tie-break (melhor_2_sets,
--      is_super_tiebreak = true) or a normal 3rd set (melhor_3_sets,
--      is_super_tiebreak = false). ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS match_sets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  set_number INTEGER NOT NULL CHECK (set_number IN (1, 2, 3)),
  score_a INTEGER NOT NULL,
  score_b INTEGER NOT NULL,
  is_super_tiebreak BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  UNIQUE (match_id, set_number)
);
ALTER TABLE match_sets ENABLE ROW LEVEL SECURITY;

-- Same shape as "Org members can view matches" / "Org admins manage
-- matches" (schema.sql) — match_sets inherits matches' org scoping via
-- match_id -> matches.game_id -> games.organization_id.
DROP POLICY IF EXISTS "Org members can view match sets" ON match_sets;
CREATE POLICY "Org members can view match sets"
  ON match_sets FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM matches
    JOIN games ON games.id = matches.game_id
    JOIN memberships ON memberships.organization_id = games.organization_id
    WHERE matches.id = match_sets.match_id AND memberships.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Org admins manage match sets" ON match_sets;
CREATE POLICY "Org admins manage match sets"
  ON match_sets FOR ALL
  USING (EXISTS (
    SELECT 1 FROM matches
    JOIN games ON games.id = matches.game_id
    JOIN memberships ON memberships.organization_id = games.organization_id
    WHERE matches.id = match_sets.match_id AND memberships.user_id = auth.uid() AND memberships.is_admin
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM matches
    JOIN games ON games.id = matches.game_id
    JOIN memberships ON memberships.organization_id = games.organization_id
    WHERE matches.id = match_sets.match_id AND memberships.user_id = auth.uid() AND memberships.is_admin
  ));

-- Same shape as "Scorekeepers can submit scores while in progress"
-- (migration_game_scorekeepers.sql) — but match_sets rows are INSERTed
-- fresh (matches rows already exist by the time a scorekeeper acts, set
-- rows don't), so this needs INSERT, not just UPDATE.
DROP POLICY IF EXISTS "Scorekeepers can submit match sets while in progress" ON match_sets;
CREATE POLICY "Scorekeepers can submit match sets while in progress"
  ON match_sets FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM matches
    JOIN games ON games.id = matches.game_id
    WHERE matches.id = match_sets.match_id AND games.status = 'in_progress'
      AND EXISTS (SELECT 1 FROM game_scorekeepers gs WHERE gs.game_id = games.id AND gs.user_id = auth.uid())
  ));

DROP POLICY IF EXISTS "Scorekeepers can correct match sets while in progress" ON match_sets;
CREATE POLICY "Scorekeepers can correct match sets while in progress"
  ON match_sets FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM matches
    JOIN games ON games.id = matches.game_id
    WHERE matches.id = match_sets.match_id AND games.status = 'in_progress'
      AND EXISTS (SELECT 1 FROM game_scorekeepers gs WHERE gs.game_id = games.id AND gs.user_id = auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM matches
    JOIN games ON games.id = matches.game_id
    WHERE matches.id = match_sets.match_id AND games.status = 'in_progress'
      AND EXISTS (SELECT 1 FROM game_scorekeepers gs WHERE gs.game_id = games.id AND gs.user_id = auth.uid())
  ));

-- Mirrors the UPDATE policy above exactly (same USING clause) — without
-- this, a scorekeeper's delete-then-insert correction of a sets-format
-- match (GameDetails.jsx handleSaveScore) silently deletes 0 rows under
-- RLS, then the re-insert hits the UNIQUE (match_id, set_number)
-- constraint and throws, leaving stale set rows under an already-updated
-- matches row.
DROP POLICY IF EXISTS "Scorekeepers can delete match sets while in progress" ON match_sets;
CREATE POLICY "Scorekeepers can delete match sets while in progress"
  ON match_sets FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM matches
    JOIN games ON games.id = matches.game_id
    WHERE matches.id = match_sets.match_id AND games.status = 'in_progress'
      AND EXISTS (SELECT 1 FROM game_scorekeepers gs WHERE gs.game_id = games.id AND gs.user_id = auth.uid())
  ));
