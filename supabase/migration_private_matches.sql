-- ════════════════════════════════════════════════════════════════════════
-- Migration: Private matches (2v2 friendly games) & cross-org global ranking
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. private_matches: one ad-hoc 2v2 result, independent of organizations ─
-- Not modeled as a `games` row: games carries mix-only fields (num_courts,
-- format, short_code, brackets) that don't fit a single friendly result.
CREATE TABLE private_matches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id UUID NOT NULL REFERENCES profiles(id),
  team_a_player1_id UUID NOT NULL REFERENCES profiles(id),
  team_a_player2_id UUID REFERENCES profiles(id),
  team_b_player1_id UUID REFERENCES profiles(id),
  team_b_player2_id UUID REFERENCES profiles(id),
  score_a INTEGER,
  score_b INTEGER,
  winner_team TEXT CHECK (winner_team IN ('a', 'b')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed')),
  played_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

ALTER TABLE private_matches ENABLE ROW LEVEL SECURITY;

-- Only the 4 players (whichever slots are filled) can see a match. All
-- writes happen through SECURITY DEFINER RPCs (Tasks 2-3 below) — there is
-- deliberately no INSERT/UPDATE policy, so a raw client-side
-- `supabase.from('private_matches').insert(...)` is rejected by RLS.
CREATE POLICY "Players can view their private matches"
  ON private_matches FOR SELECT
  USING (
    auth.uid() = team_a_player1_id
    OR auth.uid() = team_a_player2_id
    OR auth.uid() = team_b_player1_id
    OR auth.uid() = team_b_player2_id
  );

-- ── 2. private_match_stats: immutable per-player snapshot, written once ───
-- by confirm_private_match() (Task 3). Mirrors mix_player_stats' role.
CREATE TABLE private_match_stats (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  private_match_id UUID NOT NULL REFERENCES private_matches(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id),
  points_earned INTEGER NOT NULL,
  won BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
  UNIQUE (private_match_id, user_id)
);

ALTER TABLE private_match_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own private match stats"
  ON private_match_stats FOR SELECT
  USING (auth.uid() = user_id);
