# Player search & unified profile — design

## Problem

There's no accessible way to find another player in the app. Today the only
place a name search exists is buried inside Rankings → "Lista de
jogadores" (a collapsed section) or inside the private-match creation flow.
Separately, `PlayerDetails.jsx` (`/jogador/:id`) only works for someone who
shares your current club: its stats, level, and head-to-head are all
queried scoped to `currentOrganizationId`, so tapping a player from another
club (e.g. a Global-ranking row) currently has nowhere useful to go — the
Global tab's rows were made non-interactive for exactly this reason.

## Goal

1. A dedicated **"Jogadores"** page (new bottom-nav tab, route `/jogadores`)
   with a single search box searching every player in the app (reusing
   `search_players`, no club distinction in the results).
2. `/jogador/:id` stops depending on a shared club. It works for *any*
   player, showing stats aggregated across every club they play in (not
   just the current one), a level badge when you happen to share a club
   with them, and head-to-head combining club mixes (in any shared club)
   with private matches between the two of you.
3. Global-ranking rows (Rankings → Global tab) become clickable again,
   pointing at this same unified `/jogador/:id`.

## Data model

No new tables — three new `SECURITY DEFINER` RPCs, following the same
pattern already established for `search_players`/`get_global_rankings`
(intentionally bypassing the org-restricted `profiles`/`player_stats`/
`matches` RLS, exposing only aggregate/non-sensitive fields).

### `get_player_profile(p_user_id UUID)`

Replaces `PlayerDetails.jsx`'s three parallel queries (`profiles`,
`memberships`, `player_stats`, all filtered to `currentOrganizationId`).

```sql
RETURNS TABLE (
  id UUID,
  name TEXT,
  avatar_url TEXT,
  level TEXT,
  game_wins BIGINT,
  game_losses BIGINT,
  mix_wins BIGINT,
  mixes_played BIGINT,
  club_points BIGINT,
  private_points BIGINT,
  total_points BIGINT
)
```

- `game_wins`/`game_losses`/`mix_wins`/`mixes_played`/`club_points`: summed
  from `player_stats` across every organization `p_user_id` belongs to (not
  just the caller's current one) — same aggregation shape as
  `get_global_rankings()`.
- `private_points`: summed from `private_match_stats`, same as
  `get_global_rankings()`.
- `level`: the level from a membership `p_user_id` holds in an organization
  the *caller* (`auth.uid()`) also belongs to, if one exists; otherwise
  `NULL`. If they share more than one club, any one of them is fine — level
  rarely differs meaningfully across clubs for this app's purposes, and
  picking isn't worth extra ceremony.
- If `p_user_id` has no `player_stats` row anywhere and no
  `private_match_stats` row, the numeric columns come back `0`, not absent
  — same convention as the existing stat tiles (`stats?.field || 0`).

### `get_head_to_head_summary(p_opponent_id UUID)`

```sql
RETURNS TABLE (wins INTEGER, losses INTEGER, matches_played INTEGER)
```

Combines two sources for `auth.uid()` vs `p_opponent_id`:
- Mix matches: same pairing logic as the existing `mix_head_to_head()`
  (LATERAL VALUES over `teams`/`matches`), but with no
  `p_organization_id` filter — scans every mix in every club, restricted
  only to matches where the two of them were on opposite teams with a
  recorded winner.
- Private matches: `private_matches` rows with `status = 'confirmed'`
  where the two of them were on opposite teams, using the caller's own
  `private_match_stats.won`.
- The two sources are unioned and counted together into one win/loss/played
  total. (A confirmed private match always has all 4 slots filled — enforced
  by `confirm_private_match()` — so no NULL-slot guard is needed here, but
  the code still uses the `ARRAY_REMOVE(ARRAY[...], NULL)` membership-check
  pattern for consistency with the rest of the codebase.)

### `get_head_to_head_matches(p_opponent_id UUID)`

```sql
RETURNS TABLE (
  match_id UUID,
  source TEXT,          -- 'mix' | 'private'
  label TEXT,           -- mix's game title, or 'Jogo entre amigos' for private
  match_date TIMESTAMPTZ,
  player_score INTEGER,
  opponent_score INTEGER,
  won BOOLEAN
)
```

Same two sources as the summary, row-per-match instead of aggregated,
`UNION ALL`'d and ordered by `match_date DESC`. Replaces
`mix_head_to_head_matches()` for this page (that function is left as-is;
nothing else calls it, but it's not being deleted — out of scope to hunt
for other consumers of a function this design doesn't touch).

## Frontend

### New page: `src/pages/Players.jsx` — route `/jogadores`

- New bottom-nav entry in `Layout.jsx` (icon: `Users`, distinct from
  Perfil's `User`).
- Single search input, empty state below it ("Procura um jogador pelo
  nome") until 2+ characters are typed.
- On 2+ characters: calls `searchPlayers(query)` (the existing wrapper
  around `search_players`, already used by `PlayerSearch.jsx` — no club
  filtering, exactly as it already behaves).
- Each result row: avatar + name, tappable, `navigate('/jogador/' + id)`.
- No "your club" vs "other clubs" split — one flat result list, as
  decided.

### `src/pages/PlayerDetails.jsx` — rewritten to be club-independent

- Drop `currentOrganizationId` from the `useEffect` dependency/gate
  entirely — the page loads for any user id regardless of whether the
  viewer belongs to any club.
- `loadPlayer()` becomes one call to `get_player_profile(id)` instead of
  three parallel Supabase queries.
- `loadH2h()` calls `get_head_to_head_summary(id)` instead of
  `mix_head_to_head`.
- `toggleOpponent()`'s single-opponent match list calls
  `get_head_to_head_matches(id)` instead of `mix_head_to_head_matches`.
  Since this page now always targets one specific player (not a list of
  every opponent you've faced), the "Confrontos diretos" section collapses
  from a list of opponents to a single row — this player vs you — expandable
  to the combined match list. Reuse the existing expand/collapse chevron
  pattern, just with one row instead of many.
- `LevelBadge` renders only when `player.level` is non-null (same
  conditional pattern already used elsewhere, e.g. Rankings' Global tab).
- Each combined-match-list row shows `label` (game title or "Jogo entre
  amigos") instead of always assuming a mix's title/round/phase — private
  match rows don't have a round/phase, so that part of the row is omitted
  for `source = 'private'`.

### `src/pages/Rankings.jsx` — Global tab rows become links again

Revert the plain-`<div>` change made during the private-matches final
review back to `<Link to={\`/jogador/${player.user_id}\`}>` — now safe,
since `/jogador/:id` no longer requires a shared club.

## Out of scope

- No changes to `mix_head_to_head`/`mix_head_to_head_matches` themselves —
  they're superseded for this page's purposes but not removed or altered.
- No new privacy controls (e.g. opting out of being found in search) — this
  mirrors the existing `search_players` behavior already shipped for
  private matches, just exposed through a dedicated page instead of only
  inside the match-creation flow.
- No changes to `player_stats`/`finalize_mix`/the per-club Rankings tabs
  (`geral`/`mensal`/`mixes`) — those stay exactly as they are.
