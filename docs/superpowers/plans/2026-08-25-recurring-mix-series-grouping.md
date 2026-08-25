# Recurring mix series grouping — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop recurring-mix occurrences from displaying as separate, identically-titled cards — group them into one card per series (with history reachable from it), and stop two occurrences of the same series from being open simultaneously.

**Architecture:** A new pure client-side utility (`groupGamesBySeries`) collapses a flat `games` array into one entry per recurring series (or one-off mix), picking a representative occurrence to display. `Home.jsx` and `GerirClube.jsx` pipe their existing fetched data through it before rendering — no query or schema changes for the display side. `GameDetails.jsx` gains a small "Histórico" section fetching sibling occurrences directly. Separately, the existing `pg_cron` function `process_due_game_recurrences()` gets a guard so it never opens a new occurrence while the previous one in the same series is still active.

**Tech Stack:** Vite + React (JSX, no TypeScript), Tailwind (utility classes, no CSS files), Supabase (Postgres + `pg_cron`), `lucide-react` icons. No automated test suite exists in this project — every step below is verified manually (build + browser, or the Supabase SQL editor), matching how every other feature in this repo has been verified.

**Spec:** `docs/superpowers/specs/2026-08-25-recurring-mix-series-grouping-design.md`

## Global Constraints

- No schema changes to `games` or `game_recurrences`, and no new RPC — grouping is computed client-side from data already fetched (spec: "Out of scope").
- All existing `games` rows, results, and rankings stay exactly as-is — nothing is migrated, archived, or deleted.
- UI copy is Portuguese (pt-PT), matching the rest of the app (e.g. "Recorrente", "Histórico").
- New visual elements must reuse existing established patterns exactly, not invent new ones: the lime "Recorrente" line style already used for club names on `MixCard`, and the collapsible card pattern already used for grouped match history on `PlayerDetails.jsx`.
- The SQL migration file is not live until manually pasted into Supabase → SQL Editor — say so explicitly when that task is done, per this repo's convention (`CLAUDE.md`).
- No automated tests — verify each task by building (`npx vite build`) and checking behavior in-browser, or via the Supabase SQL editor for the backend task.

---

### Task 1: `groupGamesBySeries` utility

**Files:**
- Create: `src/lib/recurrenceGrouping.js`

**Interfaces:**
- Produces: `groupGamesBySeries(games: Array<{id, recurrence_id, date, status, organization_id, ...}>) => Array<{ game: <original game row>, history: Array<game row> }>`. Consumed by Task 3 (`Home.jsx`) and Task 4 (`GerirClube.jsx`).

- [ ] **Step 1: Write the utility**

```js
// src/lib/recurrenceGrouping.js
/* Pure display grouping — no I/O. Collapses recurring-mix occurrences
   (games rows sharing a non-null recurrence_id) into one entry per series,
   so a Jogos/Gerir list shows one card per recurring mix instead of one
   per date. Results/rankings/history stay entirely per-game_id, untouched
   by this — see docs/superpowers/specs/2026-08-25-recurring-mix-series-grouping-design.md. */

const ACTIVE_STATUSES = ['open', 'closed', 'in_progress']
const FINISHED_STATUSES = ['finished', 'completed']

/** Representative-occurrence priority: earliest active > earliest pending
    > most recent finished > (fallback, e.g. every occurrence cancelled)
    most recent by date — always returns one of `occurrences`. */
function pickRepresentative(occurrences) {
  const active = occurrences.filter((g) => ACTIVE_STATUSES.includes(g.status))
  if (active.length > 0) {
    return active.reduce((earliest, g) => (new Date(g.date) < new Date(earliest.date) ? g : earliest))
  }
  const pending = occurrences.filter((g) => g.status === 'pending')
  if (pending.length > 0) {
    return pending.reduce((earliest, g) => (new Date(g.date) < new Date(earliest.date) ? g : earliest))
  }
  const finished = occurrences.filter((g) => FINISHED_STATUSES.includes(g.status))
  if (finished.length > 0) {
    return finished.reduce((latest, g) => (new Date(g.date) > new Date(latest.date) ? g : latest))
  }
  return occurrences.reduce((latest, g) => (new Date(g.date) > new Date(latest.date) ? g : latest))
}

/**
 * Groups a flat games array into one entry per recurring series (games
 * sharing a non-null recurrence_id) or per one-off mix (recurrence_id
 * null). Output preserves the REPRESENTATIVE occurrence's own position in
 * the input array (not the group's first-seen position), so date-sorted
 * input stays date-sorted output.
 */
export function groupGamesBySeries(games) {
  const occurrencesByKey = new Map()
  for (const game of games) {
    const key = game.recurrence_id || game.id
    if (!occurrencesByKey.has(key)) occurrencesByKey.set(key, [])
    occurrencesByKey.get(key).push(game)
  }

  const representativeByKey = new Map()
  const historyByKey = new Map()
  for (const [key, occurrences] of occurrencesByKey) {
    const representative = occurrences.length === 1 ? occurrences[0] : pickRepresentative(occurrences)
    representativeByKey.set(key, representative)
    historyByKey.set(
      key,
      occurrences.filter((g) => g.id !== representative.id).sort((a, b) => new Date(b.date) - new Date(a.date))
    )
  }

  const seen = new Set()
  const result = []
  for (const game of games) {
    const key = game.recurrence_id || game.id
    if (seen.has(key)) continue
    if (game.id !== representativeByKey.get(key).id) continue
    seen.add(key)
    result.push({ game: representativeByKey.get(key), history: historyByKey.get(key) })
  }
  return result
}
```

- [ ] **Step 2: Trace through by hand against the priority rules**

No test runner exists in this project (`package.json` has no `test` script — confirmed this session). Verify by tracing these scenarios against the code above, in a scratch note or just mentally — each should hold:
  - Two one-off mixes (`recurrence_id: null` on both, different `id`s) → 2 entries, `history: []` on both, same relative order as input.
  - A series of 3 occurrences: one `finished` (oldest), one `open` (middle), one `pending` (newest) → representative is the `open` one (active beats pending beats finished), `history` = the other two, sorted newest-first (`pending` one before `finished` one).
  - A series of 2 occurrences, both `cancelled` → representative is the most recent by date (fallback branch), `history` = the other one. Confirms the function never throws for a non-empty group regardless of status combination.
  - A series where the representative (`open`, dated later) is positioned AFTER an older `finished` sibling in the input array (i.e. input sorted ascending by date, as both callers' Supabase queries already are) → output entry appears at the representative's own (later) index, not the older sibling's (earlier) index.

- [ ] **Step 3: Build to confirm no syntax errors**

Run: `npx vite build`
Expected: succeeds (this file has no importers yet, so it's included in the bundle but inert — a syntax error here would still fail the build).

- [ ] **Step 4: Commit**

```bash
git add src/lib/recurrenceGrouping.js
git commit -m "feat: add groupGamesBySeries utility for collapsing recurring-mix occurrences"
```

---

### Task 2: "Recorrente" badge on `MixCard`

**Files:**
- Modify: `src/components/ui.jsx:4` (import), `src/components/ui.jsx:599-604` (badge)

**Interfaces:**
- Consumes: `game.recurrence_id` (already present on every fetched game row — no query changes needed).

- [ ] **Step 1: Add the `Repeat` icon to the existing lucide-react import**

In `src/components/ui.jsx`, line 4, change:

```js
import { MapPin, CheckCircle2, ChevronRight, ChevronDown, ChevronLeft, Lock, Play, Calendar, X, Share2, MessageCircle, Link2, ImageDown, Trophy } from 'lucide-react'
```

to:

```js
import { MapPin, CheckCircle2, ChevronRight, ChevronDown, ChevronLeft, Lock, Play, Calendar, X, Share2, MessageCircle, Link2, ImageDown, Trophy, Repeat } from 'lucide-react'
```

- [ ] **Step 2: Add the badge inside `MixCard`, right before the title**

In `src/components/ui.jsx`, find (inside `MixCard`, right after the `showClub` block, right before the `<h3>` title):

```jsx
      {showClub && game.organization?.name && (
        <p className="text-[11px] font-extrabold uppercase tracking-widest text-lime-700 mb-1">
          {game.organization.name}
        </p>
      )}
      <h3 className="text-lg text-ink-900 leading-snug mb-1">{game.title}</h3>
```

Replace with:

```jsx
      {showClub && game.organization?.name && (
        <p className="text-[11px] font-extrabold uppercase tracking-widest text-lime-700 mb-1">
          {game.organization.name}
        </p>
      )}
      {game.recurrence_id && (
        <p className="flex items-center gap-1 text-[11px] font-extrabold uppercase tracking-widest text-lime-700 mb-1">
          <Repeat size={12} /> Recorrente
        </p>
      )}
      <h3 className="text-lg text-ink-900 leading-snug mb-1">{game.title}</h3>
```

- [ ] **Step 3: Build**

Run: `npx vite build`
Expected: succeeds. Full behavioral verification (does the badge actually show up correctly) happens in Task 3, once `Home.jsx` is wired to pass real grouped data through `MixCard`.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui.jsx
git commit -m "feat: add Recorrente badge to MixCard for recurring mixes"
```

---

### Task 3: Wire grouping into `Home.jsx`

**Files:**
- Modify: `src/pages/Home.jsx` (import, lines ~180-205, lines ~302-339)

**Interfaces:**
- Consumes: `groupGamesBySeries` from Task 1 (`src/lib/recurrenceGrouping.js`).

- [ ] **Step 1: Import the utility**

In `src/pages/Home.jsx`, after the existing:

```js
import { listPendingMembershipRequestsForAdmin } from '../lib/organizations'
```

add:

```js
import { groupGamesBySeries } from '../lib/recurrenceGrouping'
```

- [ ] **Step 2: Replace the active/finished split and org-grouping to work on grouped entries**

Find:

```js
  const favoriteOrgIds = new Set(memberships.filter((m) => m.is_favorite).map((m) => m.organization_id))
  // Array.prototype.sort is stable, so this only moves favorited-club
  // games ahead of the rest — the date order already in `games` (or its
  // reverse, for finished) is preserved within each of the two groups.
  const byFavoriteFirst = (a, b) =>
    Number(favoriteOrgIds.has(b.organization_id)) - Number(favoriteOrgIds.has(a.organization_id))
  const activeGames = games.filter((game) => !isFinished(game)).sort(byFavoriteFirst)
  const finishedGames = [...games.filter(isFinished)].reverse().sort(byFavoriteFirst)
  const visibleGames = tab === 'ativos' ? activeGames : finishedGames

  // Grouped by club/group when the player belongs to more than one — makes
  // it obvious at a glance whose mix each card belongs to, instead of a
  // small per-card label buried in a flat list. Preserves visibleGames'
  // existing order (favorites first, then date) by grouping on first
  // occurrence rather than re-sorting.
  const groupedGames = []
  const gamesByOrgId = new Map()
  for (const game of visibleGames) {
    let group = gamesByOrgId.get(game.organization_id)
    if (!group) {
      group = { organization_id: game.organization_id, organization: game.organization, games: [] }
      gamesByOrgId.set(game.organization_id, group)
      groupedGames.push(group)
    }
    group.games.push(game)
  }
```

Replace with:

```js
  const favoriteOrgIds = new Set(memberships.filter((m) => m.is_favorite).map((m) => m.organization_id))
  // Array.prototype.sort is stable, so this only moves favorited-club
  // games ahead of the rest — the date order already in `games` (or its
  // reverse, for finished) is preserved within each of the two groups.
  const byFavoriteFirst = (a, b) =>
    Number(favoriteOrgIds.has(b.organization_id)) - Number(favoriteOrgIds.has(a.organization_id))
  // One entry per recurring series (its representative occurrence) plus
  // one per one-off mix — see src/lib/recurrenceGrouping.js. Bucketed into
  // active/finished by the REPRESENTATIVE's own status, so a series with
  // a currently active occurrence shows under Ativos even if older
  // occurrences in the same series already finished.
  const seriesEntries = groupGamesBySeries(games)
  const activeEntries = seriesEntries.filter((entry) => !isFinished(entry.game)).sort((a, b) => byFavoriteFirst(a.game, b.game))
  const finishedEntries = [...seriesEntries.filter((entry) => isFinished(entry.game))].reverse().sort((a, b) => byFavoriteFirst(a.game, b.game))
  const visibleEntries = tab === 'ativos' ? activeEntries : finishedEntries

  // Grouped by club/group when the player belongs to more than one — makes
  // it obvious at a glance whose mix each card belongs to, instead of a
  // small per-card label buried in a flat list. Preserves visibleEntries'
  // existing order (favorites first, then date) by grouping on first
  // occurrence rather than re-sorting.
  const groupedGames = []
  const gamesByOrgId = new Map()
  for (const entry of visibleEntries) {
    const orgId = entry.game.organization_id
    let group = gamesByOrgId.get(orgId)
    if (!group) {
      group = { organization_id: orgId, organization: entry.game.organization, entries: [] }
      gamesByOrgId.set(orgId, group)
      groupedGames.push(group)
    }
    group.entries.push(entry)
  }
```

- [ ] **Step 3: Update the render to use entries**

Find (three references: the empty-state check, the multi-club map, and the single-club map):

```jsx
          {visibleGames.length === 0 ? (
```

Replace with:

```jsx
          {visibleEntries.length === 0 ? (
```

Find:

```jsx
                  <div className="space-y-3.5">
                    {group.games.map((game) => (
                      <MixCard key={game.id} game={game} joined={isUserJoined(game)} showClub={false} />
                    ))}
                  </div>
```

Replace with:

```jsx
                  <div className="space-y-3.5">
                    {group.entries.map((entry) => (
                      <MixCard key={entry.game.id} game={entry.game} joined={isUserJoined(entry.game)} showClub={false} />
                    ))}
                  </div>
```

Find:

```jsx
            <div className="space-y-3.5">
              {visibleGames.map(game => (
                <MixCard key={game.id} game={game} joined={isUserJoined(game)} showClub={false} />
              ))}
            </div>
```

Replace with:

```jsx
            <div className="space-y-3.5">
              {visibleEntries.map((entry) => (
                <MixCard key={entry.game.id} game={entry.game} joined={isUserJoined(entry.game)} showClub={false} />
              ))}
            </div>
```

- [ ] **Step 4: Build**

Run: `npx vite build`
Expected: succeeds, no references to the now-removed `visibleGames`/`activeGames`/`finishedGames`/`group.games` remain (a leftover reference would be a build-time `ReferenceError` only at runtime, not caught by the build — so also `grep -n "visibleGames\|activeGames\|finishedGames\|group.games" src/pages/Home.jsx` and confirm no matches).

- [ ] **Step 5: Manual browser verification**

Start the dev server (`npx vite`), log in (use the dev-only "Entrar como Admin" shortcut, or a real account), and check:
- A club with a recurring mix that has 2+ occurrences (e.g. this week's + next week's already created) shows **one** card in the Jogos list, not two.
- That card shows the "Recorrente" badge (from Task 2) above its title.
- A one-off mix (no recurrence) still shows its own card, no badge.
- If no recurring mix with multiple live occurrences exists in test data yet, this can be verified after Task 6 (the SQL migration) is applied and a cron cycle has run, or by manually inserting a second `games` row with a shared `recurrence_id` via the Supabase SQL editor for a quick check now.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Home.jsx
git commit -m "feat: group recurring-mix occurrences into one card on the Jogos list"
```

---

### Task 4: Wire grouping into `GerirClube.jsx`

**Files:**
- Modify: `src/pages/GerirClube.jsx:11` (import), `src/pages/GerirClube.jsx:1391-1397` (list)

**Interfaces:**
- Consumes: `groupGamesBySeries` from Task 1.

Note: `GerirClube.jsx` already has its own "Recorrente" badge (a `Repeat`-icon pill, gated on `game.recurrence?.is_active`) on each game card — that's unrelated admin-only UI (shows the recurrence rule + a "Parar recorrência" button) and needs no change. This task only removes the duplicate cards.

- [ ] **Step 1: Import the utility**

In `src/pages/GerirClube.jsx`, after the existing:

```js
import { totalRounds, FORMAT_LABEL } from '../lib/mixLogic'
```

add:

```js
import { groupGamesBySeries } from '../lib/recurrenceGrouping'
```

- [ ] **Step 2: Group before filtering, unwrap the representative inside `.map`**

Find:

```jsx
              <div className="space-y-3">
                {games
                  .filter(game => gameFilter === 'finished'
                    ? DONE_STATUSES.includes(game.status)
                    : !DONE_STATUSES.includes(game.status))
                  .map(game => {
                  const peopleCount = (game.participants || [])
```

Replace with:

```jsx
              <div className="space-y-3">
                {groupGamesBySeries(games)
                  .filter(entry => gameFilter === 'finished'
                    ? DONE_STATUSES.includes(entry.game.status)
                    : !DONE_STATUSES.includes(entry.game.status))
                  .map(entry => {
                  const game = entry.game
                  const peopleCount = (game.participants || [])
```

Everything below this point in the `.map()` body (title, date, status pill, edit/delete buttons, the existing "Recorrente" pill) already references `game`, which stays in scope unchanged — no further edits needed in this block.

- [ ] **Step 3: Build**

Run: `npx vite build`
Expected: succeeds.

- [ ] **Step 4: Manual browser verification**

As an admin, open Gerir → a club with a recurring mix that has 2+ occurrences:
- The "A decorrer / Futuros" filter shows **one** row for the series (its current/next occurrence), not one per occurrence.
- Switching to "Terminados" shows past occurrences of OTHER (non-recurring, or fully-finished) mixes as before; a series with a currently active occurrence does not also show a stray finished-occurrence row under "Terminados" (that history is reached from the card itself — see Task 5).
- The existing "Recorrente" pill + "Parar recorrência" button on the representative's card still work exactly as before (edit, delete, stop recurrence).

- [ ] **Step 5: Commit**

```bash
git add src/pages/GerirClube.jsx
git commit -m "feat: group recurring-mix occurrences into one row in the admin game list"
```

---

### Task 5: "Histórico" section on `GameDetails.jsx`

**Files:**
- Modify: `src/pages/GameDetails.jsx` (state ~line 55, `loadGameDetails` ~line 89, render ~line 1092, module-level constant ~line 18)

**Interfaces:**
- No new exports. Self-contained: fetches directly via Supabase, same pattern as every other query already in this file.

- [ ] **Step 1: Add a status-label map for compact history rows**

In `src/pages/GameDetails.jsx`, after the existing:

```js
const SIDE_LABEL = { left: 'Esquerda', right: 'Direita', both: 'Ambos' }
```

add:

```js
const HISTORY_STATUS_LABEL = {
  open: 'Aberto',
  closed: 'Fechado',
  in_progress: 'A decorrer',
  pending: 'Pendente',
  finished: 'Terminado',
  completed: 'Terminado',
  cancelled: 'Cancelado',
}
```

- [ ] **Step 2: Add state**

Find:

```js
  const [pointsById, setPointsById] = useState({})
```

Replace with:

```js
  const [pointsById, setPointsById] = useState({})
  const [recurrenceHistory, setRecurrenceHistory] = useState([])
  const [historyExpanded, setHistoryExpanded] = useState(false)
```

- [ ] **Step 3: Fetch sibling occurrences after loading the game**

Find:

```js
      if (gameError) throw gameError
      setGame(gameData)
```

Replace with:

```js
      if (gameError) throw gameError
      setGame(gameData)

      if (gameData.recurrence_id) {
        const { data: historyData, error: historyError } = await supabase
          .from('games')
          .select('id, date, status, winner_team_id')
          .eq('recurrence_id', gameData.recurrence_id)
          .neq('id', gameData.id)
          .order('date', { ascending: false })
        if (historyError) {
          console.error('Error loading recurrence history:', historyError)
        } else {
          setRecurrenceHistory(historyData || [])
        }
      } else {
        setRecurrenceHistory([])
      }
```

- [ ] **Step 4: Render the collapsible section, right after the hero card**

Find:

```jsx
        </div>
      </div>

      {/* Winner (mix finalizado) */}
```

(the closing of the hero card `<div className="card relative overflow-hidden">`, immediately before the winner section)

Replace with:

```jsx
        </div>
      </div>

      {/* Histórico — other occurrences of the same recurring mix */}
      {recurrenceHistory.length > 0 && (
        <div className="card p-0 overflow-hidden">
          <button
            onClick={() => setHistoryExpanded((v) => !v)}
            aria-expanded={historyExpanded}
            className="w-full flex items-center gap-3 px-4 py-3.5 min-h-[56px] transition-colors duration-fast hover:bg-ink-50"
          >
            <Repeat size={18} className="text-ink-700 shrink-0" />
            <p className="flex-1 min-w-0 text-left font-extrabold text-ink-900">Histórico</p>
            <span className="text-sm text-muted">{recurrenceHistory.length}</span>
            <ChevronDown
              size={20}
              className={`text-muted transition-transform duration-base shrink-0 ${historyExpanded ? 'rotate-180' : ''}`}
            />
          </button>

          {historyExpanded && (
            <div className="border-t border-line divide-y divide-line animate-fade-up">
              {recurrenceHistory.map((h) => (
                <Link
                  key={h.id}
                  to={`/jogo/${h.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-ink-50 transition-colors duration-fast"
                >
                  <span className="text-sm text-ink-900 capitalize">
                    {new Date(h.date).toLocaleDateString('pt-PT', { weekday: 'short', day: 'numeric', month: 'short' })}
                  </span>
                  <span className="text-xs font-extrabold text-muted">
                    {HISTORY_STATUS_LABEL[h.status] || h.status}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Winner (mix finalizado) */}
```

(`Repeat`, `ChevronDown`, and `Link` are all already imported in this file — no import changes needed.)

- [ ] **Step 5: Build**

Run: `npx vite build`
Expected: succeeds.

- [ ] **Step 6: Manual browser verification**

- Open the representative occurrence of a recurring series with at least one sibling occurrence: confirm a collapsed "Histórico" section appears below the hero card, showing the sibling count; expand it, confirm each row shows a compact date + status, and tapping one navigates to that occurrence's own `/jogo/:id` page with its own real roster/results.
- Open a freshly-created recurring mix with no siblings yet (or a one-off mix, `recurrence_id` null): confirm no "Histórico" section renders at all.

- [ ] **Step 7: Commit**

```bash
git add src/pages/GameDetails.jsx
git commit -m "feat: show recurring-mix history on GameDetails"
```

---

### Task 6: Cron overlap guard

**Files:**
- Create: `supabase/migration_recurrence_overlap_guard.sql`
- Modify: `supabase/schema.sql` (the `process_due_game_recurrences()` function — this function has been kept in sync with its own migrations across both prior phases, unlike some other tables in this file, so this task continues that practice)

**Interfaces:** None (SQL-only, no frontend dependency).

- [ ] **Step 1: Read the current function to confirm the exact text before editing**

Run: `grep -n "FUNCTION process_due_game_recurrences" -A 55 supabase/schema.sql`

Confirm the loop currently starts with:

```sql
    FOR UPDATE OF g SKIP LOCKED
  LOOP
    UPDATE games SET status = 'open', updated_at = now(), launch_at = NULL WHERE id = rec.pending_game_id;
```

If the text on disk differs from this (e.g. someone else changed it since this plan was written), stop and re-read the full function before proceeding — the edit below assumes this exact anchor.

- [ ] **Step 2: Create the migration file**

Create `supabase/migration_recurrence_overlap_guard.sql`:

```sql
-- ════════════════════════════════════════════════════════════════════════
-- Migration: guard against two occurrences of the same recurring mix being
-- open at once. See docs/superpowers/specs/2026-08-25-recurring-mix-series-grouping-design.md.
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION process_due_game_recurrences()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec RECORD;
  v_new_date TIMESTAMPTZ;
BEGIN
  FOR rec IN
    SELECT g.id AS pending_game_id, g.date AS pending_date, gr.*
    FROM games g
    JOIN game_recurrences gr ON gr.id = g.recurrence_id
    WHERE g.status = 'pending' AND g.launch_at <= now() AND gr.is_active = true
    FOR UPDATE OF g SKIP LOCKED
  LOOP
    -- Don't launch (or advance the chain past) this occurrence while a
    -- previous one in the same series is still open/closed/in_progress —
    -- otherwise two occurrences of the same recurring mix can be visible
    -- and joinable at once. Left pending; picked up again next tick once
    -- the previous occurrence is closed out (or auto-cancelled by
    -- migration_cancel_stale_mixes.sql after 24h).
    IF EXISTS (
      SELECT 1 FROM games
      WHERE recurrence_id = rec.id AND status IN ('open', 'closed', 'in_progress')
    ) THEN
      CONTINUE;
    END IF;

    UPDATE games SET status = 'open', updated_at = now(), launch_at = NULL WHERE id = rec.pending_game_id;

    v_new_date := (
      (rec.pending_date AT TIME ZONE 'Europe/Lisbon') + (CASE rec.frequency
            WHEN 'daily'   THEN interval '1 day'
            WHEN 'weekly'  THEN interval '1 week'
            WHEN 'monthly' THEN interval '1 month'
            WHEN 'yearly'  THEN interval '1 year'
          END)
    ) AT TIME ZONE 'Europe/Lisbon';

    IF (rec.ends_type = 'on_date' AND v_new_date > rec.ends_on)
       OR (rec.ends_type = 'after_occurrences' AND rec.occurrences_created >= rec.ends_after_occurrences) THEN
      UPDATE game_recurrences SET is_active = false, updated_at = now() WHERE id = rec.id;
      CONTINUE;
    END IF;

    INSERT INTO games (
      organization_id, title, date, location, price_per_player, prize,
      num_courts, max_players, court_time_minutes, game_time_minutes, format,
      status, created_by, recurrence_id, is_recurrence_origin, launch_at
    )
    VALUES (
      rec.organization_id, rec.title, v_new_date, rec.location, rec.price_per_player, rec.prize,
      rec.num_courts, rec.num_courts * 4, rec.court_time_minutes, rec.game_time_minutes, rec.format,
      'pending', rec.created_by, rec.id, false,
      v_new_date - make_interval(secs => rec.mix_offset_seconds)
    )
    ON CONFLICT (recurrence_id, date) WHERE recurrence_id IS NOT NULL DO NOTHING;

    UPDATE game_recurrences
    SET occurrences_created = occurrences_created + 1, updated_at = now()
    WHERE id = rec.id;
  END LOOP;
END;
$$;
```

- [ ] **Step 3: Apply the same guard to `schema.sql`'s copy of the function**

In `supabase/schema.sql`, find:

```sql
    FOR UPDATE OF g SKIP LOCKED
  LOOP
    UPDATE games SET status = 'open', updated_at = now(), launch_at = NULL WHERE id = rec.pending_game_id;
```

Replace with:

```sql
    FOR UPDATE OF g SKIP LOCKED
  LOOP
    -- Don't launch (or advance the chain past) this occurrence while a
    -- previous one in the same series is still open/closed/in_progress —
    -- otherwise two occurrences of the same recurring mix can be visible
    -- and joinable at once. Left pending; picked up again next tick once
    -- the previous occurrence is closed out (or auto-cancelled by
    -- migration_cancel_stale_mixes.sql after 24h).
    IF EXISTS (
      SELECT 1 FROM games
      WHERE recurrence_id = rec.id AND status IN ('open', 'closed', 'in_progress')
    ) THEN
      CONTINUE;
    END IF;

    UPDATE games SET status = 'open', updated_at = now(), launch_at = NULL WHERE id = rec.pending_game_id;
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migration_recurrence_overlap_guard.sql supabase/schema.sql
git commit -m "fix: don't open a recurring mix occurrence while the previous one is still active"
```

- [ ] **Step 5: Tell the user the migration needs to be run manually**

State explicitly (per this repo's convention — a migration file existing in the repo does not mean it's live): `supabase/migration_recurrence_overlap_guard.sql` needs to be pasted into Supabase → SQL Editor → New query → Run before this guard takes effect.

- [ ] **Step 6: Manual SQL verification (after the migration is run)**

In the Supabase SQL editor:
- With one occurrence of a series still `open`, manually set the next `pending` occurrence's `launch_at` to a past timestamp and run `SELECT process_due_game_recurrences();`. Confirm: that `pending` row's `status` is still `pending` afterward (guard held), and no new `pending` row was created after it (check `game_recurrences.occurrences_created` didn't increment).
- Close out that `open` occurrence (e.g. `UPDATE games SET status = 'finished' WHERE id = '<id>'`), then re-run `SELECT process_due_game_recurrences();`. Confirm: the held occurrence now flips to `open`, and a fresh `pending` row for the following date now exists (`occurrences_created` incremented).

---

## Self-Review Notes

- **Spec coverage:** Grouping utility (Task 1) ✓, `Home.jsx` (Task 3) ✓, `GerirClube.jsx` (Task 4) ✓, `MixCard` badge (Task 2) ✓, `GameDetails.jsx` history (Task 5) ✓, cron overlap guard (Task 6) ✓. "Out of scope" items (no schema changes beyond the guard, no WhatsApp bot changes, no dedicated series page, no backfill) are all honored — no task does any of them.
- **Type/shape consistency:** `groupGamesBySeries` returns `{ game, history }` — Task 3 and Task 4 both consume `.game` the same way; `.history` is intentionally unused by both (only `GameDetails.jsx` shows history, via its own independent query in Task 5, not via this utility's `history` field — a single game's detail page has no access to the full games array `groupGamesBySeries` needs).
- **No placeholders:** every step has literal code, not a description of code.
