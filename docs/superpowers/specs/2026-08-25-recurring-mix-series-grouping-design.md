# Recurring mixes: group occurrences into one series card + history (Phase 3)

## Context

Phase 1 ([2026-08-06-recurring-mixes-design.md](2026-08-06-recurring-mixes-design.md)) and Phase 2 ([2026-08-18-recurring-mixes-pending-state-design.md](2026-08-18-recurring-mixes-pending-state-design.md)) built recurring mixes as a chain of independent `games` rows — one per occurrence, linked by `recurrence_id`, each with its own status/participants/results. That data model is sound: rankings and match history (`get_player_match_history`, `statsLogic.js`) are already entirely per-`game_id` and untouched by anything below.

The problem is display, not data. A club admin (Francisco, in a WhatsApp conversation with the project owner on 2026-08-25) got genuinely confused seeing two mixes with the identical title and only a date to tell them apart — one was this week's occurrence, the other was next week's, already auto-created and opened. `Home.jsx`'s Jogos list and `GerirClube.jsx`'s admin game list both have zero recurrence awareness: they list every `games` row individually, sorted by date, so a recurring series reads as N unrelated mixes that happen to share a name. This gets worse the more recurring mixes a club runs.

A second, related gap: the two occurrences the admin saw were *simultaneously* `open` — `process_due_game_recurrences()` flips the next occurrence from `pending` to `open` purely based on `launch_at <= now()`, with no check on whether the previous occurrence in the same series has been closed out yet.

This phase fixes both, without touching how results/points/history are stored: existing `games` rows keep being created and preserved exactly as today (no migration, no archiving, no risk to past data) — a recurring series is grouped for *display* only, computed client-side from data already being fetched.

## Grouping utility

New pure function, same style as `src/lib/mixLogic.js` (no I/O, unit-testable in isolation even though this project has no test runner today):

```js
// src/lib/recurrenceGrouping.js
export function groupGamesBySeries(games) { ... }
```

Input: a flat array of `games` rows (as already fetched by `Home.jsx` / `GerirClube.jsx`, both already `select('*', ...)` so `recurrence_id` is present with no query changes needed).

Behavior:
- Games with `recurrence_id === null` (one-off mixes) pass through unchanged, one entry per game, `history: []`.
- Games sharing a non-null `recurrence_id` are collapsed into one entry. The **representative** occurrence (the one rendered as the card) is chosen by priority:
  1. Earliest-dated occurrence among `status IN ('open', 'closed', 'in_progress')`, if any exist.
  2. Else the earliest-dated `pending` occurrence (the next upcoming, not yet launched — note: `Home.jsx` already filters `pending` out entirely for players; `GerirClube.jsx` shows it).
  3. Else the most recent `finished` occurrence — a paused or ended series still shows its last result instead of disappearing from the list.
- Every other occurrence in the group is attached as `history`, sorted newest-first.
- Output order: representative entries keep the position of whichever occurrence they represent, so existing sort-by-date behavior in both callers is undisturbed.

This function does not query the database — it operates purely on rows already in memory, so it costs nothing beyond what's already fetched.

## Frontend — `Home.jsx` and `GerirClube.jsx`

Both pipe their existing `games` array through `groupGamesBySeries()` before rendering, replacing the flat list with the grouped one. Nothing about the fetch queries changes.

`MixCard` (`src/components/ui.jsx`) gains a small "Recorrente" badge, shown when the card represents a series (`recurrence_id != null`) — same visual language as the existing amber/pending status pills, placed near the title so it reads as "this repeats" without implying anything about status. No other visual change to the card — it still shows the representative occurrence's own title/date/roster/status exactly as today.

`GerirClube.jsx`'s game list — same grouping applied. Admins still need to manage individual occurrences (edit a specific date's details, delete one), so the representative card links straight to that occurrence's normal edit/detail flow, unchanged; history (below) is where the other occurrences become reachable.

## Frontend — `GameDetails.jsx` history section

When the loaded game has a non-null `recurrence_id`, add a "Histórico" section (collapsed by default, matching the collapsible pattern already used for grouped match history on `PlayerDetails.jsx`). Populated by a plain query run alongside `loadGameDetails()`:

```js
supabase.from('games').select('id, date, status, winner_team_id')
  .eq('recurrence_id', game.recurrence_id)
  .neq('id', game.id)
  .order('date', { ascending: false })
```

No new RPC — RLS on `games` already scopes this to org members, same as every other games query in this file. Each row renders as a compact date + status/result line, linking to that occurrence's own `GameDetails` page (`/jogo/:id`) — the existing route, unchanged. This satisfies the "see the history" part of the original ask without a dedicated series page: tapping a series card goes straight into the current occurrence (per the approved design), and history is one section down on that same page.

The section renders only when the query returns at least one row — a freshly-created recurrence (origin occurrence, no siblings yet) shows no "Histórico" section at all rather than an empty collapsible.

## Backend — cron overlap fix (`process_due_game_recurrences()`)

Add a guard to the existing loop in `supabase/schema.sql` (and a corresponding migration file): before flipping a `pending` occurrence to `open`, check whether another `games` row with the same `recurrence_id` currently has `status IN ('open', 'closed', 'in_progress')`. If one does, skip this iteration entirely for that recurrence — do not flip status, and do not advance the chain (no next `pending` row created, no `occurrences_created` increment) — leaving the pending occurrence exactly as it was, to be picked up on a later 5-minute tick once the guard clears.

This composes with the stale-mix auto-cancel job shipped earlier this session (`migration_cancel_stale_mixes.sql`): if a previous occurrence is ever abandoned rather than explicitly finished, it self-clears to `cancelled` 24h after its date, which satisfies the guard and unblocks the next occurrence automatically — no scenario where a stuck occurrence permanently jams its series.

## Out of scope

- No schema changes to `games` or `game_recurrences` — this phase is additive/display-only plus the one cron guard above.
- No change to how the WhatsApp bot announces mixes — it already reacts to individual `games` row updates (see Phase 2's design doc); grouping is a web-app-only display concept.
- No dedicated "series" page — ruled out per the approved design (tap → straight into the current occurrence; history lives on that page).
- No retroactive grouping/backfill needed — grouping is computed at render time from existing data, not stored, so there's nothing to migrate for already-running recurrences.

## Testing

No automated test suite exists in this project — manual verification, matching every other change in this repo.

**Frontend (manual, in-browser):**
- A club with one recurring mix and one unrelated one-off mix: confirm the Jogos list shows one card for the series (its current/next occurrence) and one card for the one-off, not N+1 cards.
- Open the series' card, confirm it lands on the expected occurrence's normal detail page, and confirm the "Histórico" section lists the other occurrences with correct dates/status, each linking to its own detail page with its own real results.
- Repeat both checks in `GerirClube.jsx`'s admin game list.
- A series with zero other occurrences yet (freshly created recurrence): confirm no "Histórico" section renders (empty state handled, not an empty collapsible).
- A one-off mix (no `recurrence_id`): confirm no "Recorrente" badge and no "Histórico" section.

**SQL (manual, Supabase SQL editor):**
- With one occurrence of a series still `open`, manually set the next `pending` occurrence's `launch_at` to the past and run `SELECT process_due_game_recurrences();` — confirm it stays `pending` (guard held), and no new `pending` row was created after it.
- Close out (finish or let the stale-mix job cancel) that open occurrence, re-run the function — confirm the held occurrence now flips to `open` and the chain advances normally (next `pending` row created).
