# Private matches & global ranking — design

## Problem

Ranking today (`player_stats`) is scoped per organization (club) — a player's
points only reflect the official mixes played inside clubs they belong to.
There's no way to log a casual 2v2 game between friends outside a club
context, and no single number that represents a player's overall standing
across every club (and every friendly game) they've played in.

## Goal

1. Let any user record a **private match**: a single 2v2 game (fixed dupla vs
   fixed dupla, one score) between any 4 app users, independent of
   organizations. No brackets, no rounds — just one result.
2. Points from private matches never affect any club's `player_stats`/
   `Rankings.jsx` — they stay outside the organization boundary entirely.
3. Add a **global ranking**: a public, app-wide leaderboard ordering every
   player by the sum of their club points (across every org they belong to)
   plus their private-match points.

## Data model

New tables only — `games`/`teams`/`matches` (and `finalize_mix`,
`player_stats`, `mix_player_stats`) are untouched. Those tables carry
mix-only fields (`num_courts`, `format`, `short_code`, brackets/rounds) that
don't fit a single ad-hoc 2v2 game.

```sql
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

CREATE TABLE private_match_stats (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  private_match_id UUID NOT NULL REFERENCES private_matches(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id),
  points_earned INTEGER NOT NULL,
  won BOOLEAN NOT NULL,
  UNIQUE (private_match_id, user_id)
);
```

- `team_a_player1_id` (the creator's own slot) is required at creation; the
  other three slots may be `NULL` until filled by search or by a join link
  (see below).
- `winner_team` is derived from `score_a`/`score_b` when either is set; kept
  as a stored column (not computed) to mirror `games.winner_team_id`'s
  pattern and simplify the confirm function.
- Points are fixed, not configurable — there's no organization to hold a
  `points_rules` row for a private match. Reuse the existing defaults for
  scale-consistency: `point_per_match_played = 1`, `point_per_match_win = 3`.
  No mix-participation/mix-win bonus (there is no mix).
- `private_match_stats` is the immutable per-player snapshot, written once,
  at confirmation — same role as `mix_player_stats` plays for mixes.

## Confirmation flow

- Any of the 4 players can set/edit `score_a`/`score_b` while
  `status = 'pending'`.
- Only `creator_id` can confirm. A `confirm_private_match(p_match_id)` RPC:
  1. Requires all 4 player slots filled and a score set.
  2. Requires `auth.uid() = creator_id`.
  3. Sets `status = 'confirmed'`, `confirmed_at = now()`, `winner_team`.
  4. Inserts one `private_match_stats` row per player: participation point
     for all 4, win bonus added for the 2 on the winning side.
- No expiry, no dispute/reject flow, no editing after confirmation — out of
  scope for this pass (see below).

## Creating & inviting

New entry point (e.g. "+ Jogo entre amigos" on Dashboard/Profile):

1. Creator picks their own partner and the opposing dupla, each slot filled
   either by **searching an existing username** (autocomplete over
   `profiles`) or **left open**.
2. Score can be entered at creation time or later by any filled-in player.
3. Row inserted with `status = 'pending'`.

Two ways to fill an open slot:
- **Search**: creator already knows the player's username → picks directly,
  that player gets an in-app notification ("Ana registou um jogo contigo —
  confirma o resultado").
- **Link**: creator shares `/private-match/:id/join?slot=team_b_player2`;
  opening it while logged in claims that slot. Needed because the app has no
  "friends list" — this is how you add someone you can't search for yet.

A match only becomes eligible for confirmation once all 4 slots are filled.

## Global ranking

Computed by query, not denormalized — same approach `Rankings.jsx` already
uses (read `player_stats`, sort client-side), just widened to drop the
organization filter and add private points:

```sql
SELECT ps.user_id,
       SUM(ps.total_points) AS club_points,
       COALESCE((SELECT SUM(points_earned) FROM private_match_stats
                  WHERE user_id = ps.user_id), 0) AS private_points
FROM player_stats ps
GROUP BY ps.user_id
ORDER BY (club_points + private_points) DESC
```

- No change to `player_stats`, `finalize_mix`, or any club's
  `Rankings.jsx` — this is purely additive on top.
- New page: **Ranking Global**, public, all app users ordered by
  `club_points + private_points`.
- `Profile.jsx`: new "Jogos entre amigos" section (list of the player's
  confirmed private matches — mirrors the existing mix-history section
  added for club mixes), and the profile's points breakdown shows club
  total vs. private total vs. combined global total.
- Dashboard: CTA to create a private match, plus a list of the player's
  `pending` matches awaiting their score entry or their confirmation.

## Out of scope

- Result disputes/rejection by the creator (if they disagree with the score
  someone else entered, there's no reject action yet — they just don't
  confirm).
- Real push notifications (in-app notification only for this pass).
- Editing or reversing a match after `confirmed`.
- Recurring "friend groups" with their own sub-ranking — every private match
  is a standalone record; there's no saved circle of regular playing
  partners.
- Guests (`is_guest`) participating in private matches — private matches
  require a real `profiles` account for all 4 slots (search/link both
  resolve to `profiles.id`), no guest exception.
