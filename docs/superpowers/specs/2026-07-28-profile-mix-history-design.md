# Profile mix history — design

## Problem

A player has no way to see their own history of finished mixes and how they
placed in each one. `mix_player_stats` already stores per-game points for
every player, and `GameDetails.jsx` already computes a dupla's rank within a
single mix (for the results share card), but nothing surfaces that history
across mixes, from the player's own perspective.

## Goal

Add a "Histórico de mixes" section to `src/pages/Profile.jsx` listing every
finished mix the player took part in, most recent first, each showing the
mix's date/title/location and the player's placement (e.g. "1º de 4
duplas"), tappable to open that mix's detail page (`/jogo/:id`).

Scope: `Profile.jsx` only (non-guest view — guests already see a minimal
profile with no stats section, and never get placed on a team, so they'd
have nothing to show here anyway).

## Data

No schema changes. Two batched Supabase queries, run alongside the existing
`loadStats()` call:

1. `mix_player_stats` rows for `user_id = profile.id` and this org, joined
   with `games (title, date, location)` — one row per finished mix the
   player actually played in (this table is only written by `finalize_mix()`
   for players who ended up on a team, so it's already exactly "mixes I
   participated in"). Ordered by `games.date` descending.
2. For that batch's `game_id`s, fetch all `teams` (player1_id/player2_id)
   and all `mix_player_stats` (user_id, points_earned) rows across those
   games in two `IN (...)` queries.

Client-side, per game: group teams and stats by `game_id`, compute each
team's combined `points_earned`, sort descending — the same logic
`GameDetails.jsx` already uses for `duplaStats`. The player's placement is
their team's 1-indexed rank in that sorted list; total duplas is the
list's length.

## UI

New card, placed after the existing stat tiles grid and before "Informação
pessoal":

```
Histórico de mixes
┌─────────────────────────────────────────┐
│ Mix de Segunda-feira            [1º de 4]│
│ 27/07 · Smash Padel - Almada             │
├─────────────────────────────────────────┤
│ Mix de Segunda-feira            [3º de 4]│
│ 20/07 · Smash Padel - Almada             │
└─────────────────────────────────────────┘
```

- Each row is a button, full row tappable, `navigate('/jogo/' + game_id)` —
  same destination as tapping a `MixCard` from Home.
- Position badge: 1st place uses the lime `bg-lime-400 text-ink-900` style
  already used for rank #1 in `Rankings.jsx`; other placements use the
  neutral `bg-ink-50 text-ink-700` style used elsewhere for lower ranks.
- Row layout/typography follows the existing H2H match rows in
  `PlayerDetails.jsx` (title + muted date/location line, value aligned
  right).
- Empty state (no finished mixes yet): reuse the `Trophy` icon and the same
  "Ainda não há mixs terminados"-style short copy used for the Terminados
  tab on Home, adapted to first person ("Ainda não tens mixes terminados").
- Section renders only for non-guest users. It always shows (title +
  content), regardless of `statTiles`' own visibility — when there are no
  finished mixes yet it shows its own empty state rather than being hidden.

## Out of scope

- No pagination/infinite scroll — same deferral as the Mixs Terminados tab.
- No change to `mix_player_stats`, `finalize_mix()`, or any other schema/DB
  function.
- No change to `GameDetails.jsx`'s own podium/duplaStats computation — this
  duplicates the same small ranking calculation for a different (per-user,
  cross-game) query shape; not worth extracting into a shared helper for
  one extra call site.
