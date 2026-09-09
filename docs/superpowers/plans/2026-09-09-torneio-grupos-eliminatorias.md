# Torneio — Grupos + Eliminatórias — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "grupos + eliminatórias" mix format — teams split into small
round-robin pools, then the pool winners/runners-up cross into an
elimination bracket — plus bulk participant onboarding, so Alinho can run a
real 300-person, 3-day corporate padel tournament on 1-4 courts.

**Architecture:** Reuse the existing `games`/`teams`/`matches` schema and
the existing pure engine functions in `src/lib/mixLogic.js`
(`roundRobinRound`, `standings`, `eliminationPhases`, `firstElimMatches`,
`nextElimMatches`) completely unchanged. Add two new pure functions
(`splitIntoPools`, `seedKnockoutFromPools`) and one new React component
(`PoolGroupStage`) that calls the *existing* round-robin/standings functions
once per pool instead of once for the whole category. The existing
`sobe_desce`/`todos_contra_todos` code paths in `GameDetails.jsx` are not
touched — the new format gets its own parallel branch.

**Tech Stack:** React + Vite + Supabase (Postgres + Edge Functions).
Vitest is added in Task 1 for the new pure engine functions — this is the
first test infrastructure in the repo; there is no existing test runner
to match conventions against.

**Spec:** `docs/superpowers/specs/2026-09-09-torneio-grupos-eliminatorias-design.md`

## Global Constraints

- No changes to `participants` or `matches` table shape — a match's pool is
  inferred from its two teams' `pool_number`, never stored on the match
  itself.
- `advancePerPool` (how many teams leave each pool for the knockout) is
  fixed at `2`, not admin-configurable.
- Scoring stays a single `score_a`/`score_b` int per match — no sets/pro-set
  work in this plan.
- Every SQL migration file must be flagged explicitly as **not live until
  run in the Supabase SQL Editor** — a file existing in the repo is not a
  schema change in effect (per `CLAUDE.md`).
- `sobe_desce` and `todos_contra_todos` behavior must not change. Any task
  that touches a file shared with those formats must leave their code paths
  provably untouched (name every line changed).

---

## Task 1: Add pool-splitting to the mix engine

**Files:**
- Modify: `src/lib/mixLogic.js` (add `splitIntoPools`, near `seedCourts`)
- Modify: `package.json` (add `vitest` devDependency + `test` script)
- Create: `vitest.config.js`
- Test: `src/lib/mixLogic.test.js`

**Interfaces:**
- Produces: `splitIntoPools(items, poolSize)` — `items` is an array of
  `{ seed: number, ...rest }`; returns a **new** array (not the same order
  as input — sorted by seed descending first), each item spread with an
  added `pool_number` (1-based integer). Later tasks (Task 6) call this
  with `duplas` from `formDuplas` (which already have a `.seed` field).

- [ ] **Step 1: Install vitest**

Run: `npm install -D vitest`

- [ ] **Step 2: Add the test script to `package.json`**

In the `"scripts"` block (alongside `"dev"` and `"build"`), add:

```json
"test": "vitest run"
```

- [ ] **Step 3: Create `vitest.config.js`** at the project root:

```js
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
  },
})
```

- [ ] **Step 4: Write the failing test** — create `src/lib/mixLogic.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { splitIntoPools } from './mixLogic'

describe('splitIntoPools', () => {
  it('splits 8 items into 2 pools of 4, balancing strength by seed (snake order)', () => {
    // seeds 8,7,6,5,4,3,2,1 (already sorted desc for clarity)
    const items = [8, 7, 6, 5, 4, 3, 2, 1].map((seed) => ({ id: `t${seed}`, seed }))
    const result = splitIntoPools(items, 4)
    expect(result).toHaveLength(8)
    const byPool = (n) => result.filter((r) => r.pool_number === n).map((r) => r.id)
    // Snake seeding with 2 pools: lap0 -> pool1,pool2 ; lap1 -> pool2,pool1 ; ...
    // seeds desc: 8(p1) 7(p2) 6(p2) 5(p1) 4(p1) 3(p2) 2(p2) 1(p1)
    expect(byPool(1).sort()).toEqual(['t1', 't4', 't5', 't8'].sort())
    expect(byPool(2).sort()).toEqual(['t2', 't3', 't6', 't7'].sort())
  })

  it('creates ceil(n/poolSize) pools, last pool smaller when not evenly divisible', () => {
    const items = [1, 2, 3, 4, 5].map((seed) => ({ id: `t${seed}`, seed }))
    const result = splitIntoPools(items, 4)
    const poolNumbers = [...new Set(result.map((r) => r.pool_number))].sort()
    expect(poolNumbers).toEqual([1, 2])
  })

  it('preserves all original fields on each item', () => {
    const items = [{ id: 'a', seed: 10, extra: 'x' }]
    const result = splitIntoPools(items, 4)
    expect(result[0]).toMatchObject({ id: 'a', seed: 10, extra: 'x' })
    expect(result[0].pool_number).toBe(1)
  })
})
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npx vitest run src/lib/mixLogic.test.js`
Expected: FAIL — `splitIntoPools is not a function` (or similar import error).

- [ ] **Step 6: Implement `splitIntoPools`**

In `src/lib/mixLogic.js`, add this function near `seedCourts` (after it):

```js
/** Snake-seeds items into `ceil(items.length / poolSize)` pools, spreading
    strength evenly (pool 1,2,...,N, then N,...,2,1, repeating) — same
    balancing principle seedCourts uses for court 1. Returns a NEW array
    (sorted by seed desc, not input order), each item spread with an added
    `pool_number` (1-based). */
export function splitIntoPools(items, poolSize) {
  const numPools = Math.max(1, Math.ceil(items.length / poolSize))
  const sorted = [...items].sort((a, b) => (b.seed ?? 0) - (a.seed ?? 0))
  return sorted.map((item, i) => {
    const lap = Math.floor(i / numPools)
    const posInLap = i % numPools
    const pool_number = lap % 2 === 0 ? posInLap + 1 : numPools - posInLap
    return { ...item, pool_number }
  })
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run src/lib/mixLogic.test.js`
Expected: PASS (all 3 tests).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json vitest.config.js src/lib/mixLogic.js src/lib/mixLogic.test.js
git commit -m "feat: add pool-splitting to the mix engine (grupos+eliminatórias, Task 1)"
```

---

## Task 2: Add cross-pool knockout seeding to the mix engine

**Files:**
- Modify: `src/lib/mixLogic.js` (add `seedKnockoutFromPools`, near `standings`)
- Test: `src/lib/mixLogic.test.js` (append)

**Interfaces:**
- Consumes: `standings(teams, matches)` (existing, unmodified — already
  works per-pool for free: it only counts a match if both `team_a_id`/
  `team_b_id` are present in the `teams` array passed in, so calling it with
  just one pool's teams naturally scopes it to that pool).
- Produces: `seedKnockoutFromPools(poolStandingsArrays, advancePerPool = 2)`
  — `poolStandingsArrays` is an array of already-computed `standings()`
  results, one per pool, in pool-number order. Returns a flat ordered array
  of team ids, ready to pass straight into the *existing*
  `firstElimMatches(phase, orderedTeamIds)` — Task 8 is the only consumer.

- [ ] **Step 1: Write the failing tests** — append to `src/lib/mixLogic.test.js`:

```js
import { seedKnockoutFromPools } from './mixLogic'

// Helper: build a fake standings() result — only `.team.id` matters here.
const fakeStandings = (ids) => ids.map((id) => ({ team: { id }, wins: 0, diff: 0, scored: 0, played: 0 }))

describe('seedKnockoutFromPools', () => {
  it('2 pools, top 2 each: interleaves rank-major so the semifinal never repeats a pool', () => {
    const poolA = fakeStandings(['A1', 'A2', 'A3'])
    const poolB = fakeStandings(['B1', 'B2', 'B3'])
    const seeded = seedKnockoutFromPools([poolA, poolB], 2)
    expect(seeded).toEqual(['A1', 'B1', 'A2', 'B2'])
    // firstElimMatches('semi', seeded) pairs [0]v[3] and [1]v[2] — verify
    // neither pair is two teams from the same pool:
    expect([seeded[0], seeded[3]].sort()).not.toEqual(['A1', 'A2'].sort())
    expect([seeded[1], seeded[2]].sort()).not.toEqual(['B1', 'B2'].sort())
  })

  it('4 pools, top 2 each: no first-round (quarterfinal) pair shares a pool', () => {
    const pools = ['A', 'B', 'C', 'D'].map((letter) => fakeStandings([`${letter}1`, `${letter}2`, `${letter}3`]))
    const seeded = seedKnockoutFromPools(pools, 2)
    expect(seeded).toEqual(['A1', 'B1', 'C1', 'D1', 'A2', 'B2', 'C2', 'D2'])
    // firstElimMatches('quarter', seeded) pairs (0,7) (1,6) (2,5) (3,4)
    const pairs = [[0, 7], [1, 6], [2, 5], [3, 4]]
    const poolOf = (teamId) => teamId[0] // 'A1' -> 'A'
    for (const [i, j] of pairs) {
      expect(poolOf(seeded[i])).not.toBe(poolOf(seeded[j]))
    }
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/mixLogic.test.js`
Expected: FAIL — `seedKnockoutFromPools is not a function`.

- [ ] **Step 3: Implement `seedKnockoutFromPools`**

In `src/lib/mixLogic.js`, add after `standings`:

```js
/** Cross-pool seeding for the knockout phase: takes each pool's final
    standings (already-computed standings() results, one per pool, in pool
    order) and the number that advance per pool, and returns a flat ordered
    team-id list ready for the EXISTING firstElimMatches(phase, orderedIds)
    — which pairs position i against position (N-1-i). To avoid a
    same-pool rematch in the first knockout round, ranks are interleaved
    (1st-of-pool-1, 1st-of-pool-2, ..., 2nd-of-pool-1, 2nd-of-pool-2, ...)
    rather than grouped by rank tier. */
export function seedKnockoutFromPools(poolStandingsArrays, advancePerPool = 2) {
  const seeded = []
  for (let rank = 0; rank < advancePerPool; rank++) {
    for (const poolStandings of poolStandingsArrays) {
      const entry = poolStandings[rank]
      if (entry) seeded.push(entry.team.id)
    }
  }
  return seeded
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/mixLogic.test.js`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add src/lib/mixLogic.js src/lib/mixLogic.test.js
git commit -m "feat: add cross-pool knockout seeding to the mix engine (Task 2)"
```

---

## Task 3: Database migration

**Files:**
- Create: `supabase/migration_grupos_eliminatorias.sql`

**Interfaces:**
- Produces: `games.format` accepts `'grupos_eliminatorias'`; `games.pool_size
  INTEGER` (nullable); `teams.pool_number INTEGER` (nullable). Task 6
  (`GerirClube.jsx`) writes `pool_size` on insert/update; Task 7
  (`GameDetails.jsx` `handleStartMix`) writes `pool_number` on `teams`
  insert.

- [ ] **Step 1: Write the migration file**

```sql
-- ════════════════════════════════════════════════════════════════════════
-- Migration: Grupos + Eliminatórias mix format
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- NOT LIVE until run there — this file existing in the repo changes
-- nothing on its own.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. New format value ─────────────────────────────────────────────────
ALTER TABLE games DROP CONSTRAINT IF EXISTS games_format_check;
ALTER TABLE games ADD CONSTRAINT games_format_check
  CHECK (format IN ('sobe_desce', 'todos_contra_todos', 'grupos_eliminatorias'));

-- ── 2. Pool size (admin-set per category-mix, only meaningful for the
--      new format) ───────────────────────────────────────────────────────
ALTER TABLE games ADD COLUMN IF NOT EXISTS pool_size INTEGER;

-- ── 3. Which pool a dupla belongs to during the group phase. NULL once
--      the format reaches the knockout phase (pool no longer matters). ───
ALTER TABLE teams ADD COLUMN IF NOT EXISTS pool_number INTEGER;
```

- [ ] **Step 2: Verify the exact current constraint name**

Before this can be trusted to run cleanly, confirm the real name of the
`format` CHECK constraint (it may not be `games_format_check` — Postgres
auto-names constraints and `schema.sql`'s inline `CHECK (format IN (...))`
may have gotten a different auto-generated name than expected). Run in the
Supabase SQL Editor:

```sql
SELECT conname FROM pg_constraint
WHERE conrelid = 'games'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%format%';
```

If the returned name isn't `games_format_check`, edit Step 1's `DROP
CONSTRAINT IF EXISTS` line to use the real name instead.

- [ ] **Step 3: Flag this explicitly to the user**

This migration is **not live** until pasted into Supabase → SQL Editor and
run there. Say so explicitly when this task is reported done — do not let
later tasks assume `pool_size`/`pool_number` already exist in production
without this having actually been run.

- [ ] **Step 4: Commit**

```bash
git add supabase/migration_grupos_eliminatorias.sql
git commit -m "feat: migration for grupos+eliminatórias format (pool_size, pool_number) — NOT YET RUN in Supabase"
```

---

## Task 4: Format label + locale strings

**Files:**
- Modify: `src/lib/mixLogic.js` (`FORMAT_LABEL_KEY`)
- Modify: `src/locales/pt.json`
- Modify: `src/locales/en.json`

**Interfaces:**
- Produces: `FORMAT_LABEL_KEY.grupos_eliminatorias` (a translation key
  string) — consumed by Task 6 (`GerirClube.jsx`'s `FORMATS` list) and by
  `GameDetails.jsx`'s existing generic format-label rendering (already
  keyed off `FORMAT_LABEL_KEY`, no change needed there — the same lookup
  pattern that already renders `sobe_desce`/`todos_contra_todos` picks up
  the new key automatically).

- [ ] **Step 1: Add the format label key**

In `src/lib/mixLogic.js`, find:

```js
export const FORMAT_LABEL_KEY = {
  sobe_desce: 'mixlogic.format_sobe_desce',
  todos_contra_todos: 'mixlogic.format_todos_contra_todos',
}
```

Change to:

```js
export const FORMAT_LABEL_KEY = {
  sobe_desce: 'mixlogic.format_sobe_desce',
  todos_contra_todos: 'mixlogic.format_todos_contra_todos',
  grupos_eliminatorias: 'mixlogic.format_grupos_eliminatorias',
}
```

- [ ] **Step 2: Add the locale strings**

In `src/locales/pt.json`, find the `"mixlogic"` object (sibling to
`format_sobe_desce`/`format_todos_contra_todos`) and add:

```json
"format_grupos_eliminatorias": "Grupos + Eliminatórias"
```

Also add, in the `"gerirclube"` object (sibling to `"format_label"`):

```json
"pool_size_label": "Jogadores por grupo",
"pool_size_help": "Cada grupo joga todos-contra-todos; os 2 primeiros de cada grupo avançam para as eliminatórias."
```

And in the `"gamedetails"` object (sibling to `"group_standings_title"`):

```json
"pool_label": "Grupo {{number}}",
"pool_standings_title": "Classificação — Grupo {{number}}",
"pool_advance_to_knockout": "Avançar para as eliminatórias",
"pool_all_complete_hint": "Todos os grupos terminaram — pronto para gerar as eliminatórias.",
"bulk_import_title": "Importar jogadores em massa",
"bulk_import_placeholder": "Um nome por linha",
"bulk_import_button": "Importar",
"bulk_import_importing": "A importar...",
"bulk_import_summary": "{{created}} criados, {{failed}} falharam",
"error_invalid_pool_count": "Número de grupos inválido ({{count}}). Com o tamanho de grupo atual, ajusta o tamanho para que o número de grupos seja 1, 2 ou 4."
```

- [ ] **Step 3: Add the matching English strings**

In `src/locales/en.json`, mirror Step 2's keys with English text:

```json
"format_grupos_eliminatorias": "Groups + Knockout"
```

```json
"pool_size_label": "Players per group",
"pool_size_help": "Each group plays round-robin; the top 2 from each group advance to the knockout stage."
```

```json
"pool_label": "Group {{number}}",
"pool_standings_title": "Standings — Group {{number}}",
"pool_advance_to_knockout": "Advance to knockout stage",
"pool_all_complete_hint": "All groups finished — ready to generate the knockout bracket.",
"bulk_import_title": "Bulk import players",
"bulk_import_placeholder": "One name per line",
"bulk_import_button": "Import",
"bulk_import_importing": "Importing...",
"bulk_import_summary": "{{created}} created, {{failed}} failed",
"error_invalid_pool_count": "Invalid group count ({{count}}). With the current group size, adjust it so the number of groups is 1, 2, or 4."
```

- [ ] **Step 4: Verify the app still builds**

Run: `npm run build`
Expected: builds successfully (JSON syntax errors in the locale files
would fail this).

- [ ] **Step 5: Commit**

```bash
git add src/lib/mixLogic.js src/locales/pt.json src/locales/en.json
git commit -m "feat: locale strings for grupos+eliminatórias format (Task 4)"
```

---

## Task 5: Mix-creation form — new format option + pool size field

**Files:**
- Modify: `src/pages/GerirClube.jsx`

**Interfaces:**
- Consumes: `FORMAT_LABEL_KEY.grupos_eliminatorias` (Task 4).
- Produces: `games` rows created/updated with `format: 'grupos_eliminatorias'`
  and a sanitized integer `pool_size` — consumed by Task 7
  (`handleStartMix`) and Task 8 (`GameDetails.jsx` rendering).

- [ ] **Step 1: Add the format option**

Find (near the top of the file):

```js
const FORMATS = [
  { value: 'sobe_desce', labelKey: FORMAT_LABEL_KEY.sobe_desce },
  { value: 'todos_contra_todos', labelKey: FORMAT_LABEL_KEY.todos_contra_todos },
]
```

Change to:

```js
const FORMATS = [
  { value: 'sobe_desce', labelKey: FORMAT_LABEL_KEY.sobe_desce },
  { value: 'todos_contra_todos', labelKey: FORMAT_LABEL_KEY.todos_contra_todos },
  { value: 'grupos_eliminatorias', labelKey: FORMAT_LABEL_KEY.grupos_eliminatorias },
]
```

- [ ] **Step 2: Add `pool_size` to the empty form**

Find:

```js
const EMPTY_GAME_FORM = {
  title: '',
  date: '',
  location: '',
  price_per_player: '',
  prize: '',
  num_courts: 1,
  court_time_minutes: 90,
  game_time_minutes: 20,
  format: 'sobe_desce',
  gender_restriction: 'indiferente',
  level: '',
  auto_start_hours_before: '',
  recurrence: EMPTY_RECURRENCE,
}
```

Add `pool_size: 4,` right after `format: 'sobe_desce',`.

- [ ] **Step 3: Add the pool-size input, shown only for this format**

Find (the format `Segmented` block):

```jsx
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {t('gerirclube.format_label')}
                      </label>
                      <Segmented
                        options={translatedFormats}
                        value={gameForm.format}
                        onChange={(v) => setGameForm({ ...gameForm, format: v })}
                      />
                    </div>
```

Add immediately after it:

```jsx
                    {gameForm.format === 'grupos_eliminatorias' && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          {t('gerirclube.pool_size_label')}
                        </label>
                        <input
                          type="number"
                          min="3"
                          max="8"
                          value={gameForm.pool_size}
                          onChange={(e) => setGameForm({ ...gameForm, pool_size: e.target.value })}
                          className="input-field"
                        />
                        <p className="text-sm text-muted mt-1.5">{t('gerirclube.pool_size_help')}</p>
                      </div>
                    )}
```

- [ ] **Step 4: Sanitize `pool_size` on create**

In `handleCreateGame`, find:

```js
            price_per_player: gameForm.price_per_player === '' ? null : parseFloat(gameForm.price_per_player),
            auto_start_hours_before: gameForm.auto_start_hours_before === '' ? null : parseInt(gameForm.auto_start_hours_before, 10),
```

Add right after:

```js
            pool_size: gameForm.format === 'grupos_eliminatorias' ? (parseInt(gameForm.pool_size, 10) || 4) : null,
```

- [ ] **Step 5: Sanitize `pool_size` on update**

In `handleUpdateGame`, find:

```js
          price_per_player: gameForm.price_per_player === '' ? null : parseFloat(gameForm.price_per_player),
          level: gameForm.level || null,
```

Add right after:

```js
          pool_size: gameForm.format === 'grupos_eliminatorias' ? (parseInt(gameForm.pool_size, 10) || 4) : null,
```

- [ ] **Step 6: Pre-fill `pool_size` when editing an existing mix**

Find (the function that populates `gameForm` from an existing `game` for
editing):

```js
      format: game.format || 'sobe_desce',
      gender_restriction: game.gender_restriction || 'indiferente',
```

Change to:

```js
      format: game.format || 'sobe_desce',
      pool_size: game.pool_size || 4,
      gender_restriction: game.gender_restriction || 'indiferente',
```

- [ ] **Step 7: Verify the build**

Run: `npm run build`
Expected: builds successfully.

- [ ] **Step 8: Manual verification**

Start the dev server (`npm run dev`), open "Gerir Clube" → "Criar Mix",
select "Grupos + Eliminatórias" in the format selector, confirm the pool
size field appears (and disappears when switching back to another
format), create a mix with it, confirm it saves without error.

- [ ] **Step 9: Commit**

```bash
git add src/pages/GerirClube.jsx
git commit -m "feat: mix-creation form support for grupos+eliminatórias format (Task 5)"
```

---

## Task 6: Assign pools when duplas are formed

**Files:**
- Modify: `src/pages/GameDetails.jsx` (`handleStartMix`)

**Interfaces:**
- Consumes: `splitIntoPools` (Task 1), `game.format`, `game.pool_size`
  (Task 3/5).
- Produces: `teams` rows carrying `pool_number` when
  `game.format === 'grupos_eliminatorias'` — consumed by Task 8
  (`PoolGroupStage`).

**Ruling from Task 2's review (recorded in the SDD ledger):**
`seedKnockoutFromPools` (Task 2) and the *existing, unmodified*
`firstElimMatches`/`eliminationPhases` only support exactly 2, 4, or 8
teams advancing to the knockout phase — that's a pre-existing constraint
of `firstElimMatches`'s hardcoded branches, shared with
`todos_contra_todos`, not something Task 2 introduced. With
`advancePerPool` fixed at 2, that means **the pool count must be exactly
1, 2, or 4** — any other pool count (e.g. 3 pools = 6 advancing) would
silently drop teams from the bracket. This task is where that must be
caught, since it's the last point before teams are locked in and
`pool_size` can still be adjusted. Step 2 below includes this guard.

- [ ] **Step 1: Import `splitIntoPools`**

Find the `mixLogic` import block (starts `import { countPeople, ...`) and
add `splitIntoPools` to the destructured list.

- [ ] **Step 2: Assign pools before inserting `teams`**

Find, inside `handleStartMix`:

```js
      // 4.1 formação de duplas
      const duplas = formDuplas(participants, pointsById, repeatPairKeys)
      if (duplas.length < 2) throw new Error(t('gamedetails.error_need_two_duplas'))

      const { error: teamsError } = await supabase
        .from('teams')
        .insert(duplas.map(d => ({
          game_id: id,
          player1_id: d.player1.id,
          player2_id: d.player2.id,
          seed_ranking: d.seed,
        })))
      if (teamsError) throw teamsError
```

Change to:

```js
      // 4.1 formação de duplas
      const duplas = formDuplas(participants, pointsById, repeatPairKeys)
      if (duplas.length < 2) throw new Error(t('gamedetails.error_need_two_duplas'))

      // Grupos+eliminatórias needs each dupla's pool assigned before
      // insert (there's no separate round trip to fetch ids back and
      // patch pool_number afterwards).
      const isGruposEliminatorias = game.format === 'grupos_eliminatorias'
      const poolSize = game.pool_size || 4
      // firstElimMatches/eliminationPhases (existing, unmodified — shared
      // with todos_contra_todos) only support exactly 2, 4, or 8 teams
      // advancing to the knockout phase. With advancePerPool fixed at 2,
      // that means the pool count itself must be exactly 1, 2, or 4 — any
      // other count would silently drop teams from the bracket later.
      // This is the last point before teams are locked in where pool_size
      // can still be adjusted, so it's caught here, not later.
      if (isGruposEliminatorias) {
        const numPools = Math.max(1, Math.ceil(duplas.length / poolSize))
        if (![1, 2, 4].includes(numPools)) {
          throw new Error(t('gamedetails.error_invalid_pool_count', { count: numPools }))
        }
      }
      const pooledDuplas = isGruposEliminatorias
        ? splitIntoPools(duplas, poolSize)
        : duplas

      const { error: teamsError } = await supabase
        .from('teams')
        .insert(pooledDuplas.map(d => ({
          game_id: id,
          player1_id: d.player1.id,
          player2_id: d.player2.id,
          seed_ranking: d.seed,
          ...(isGruposEliminatorias ? { pool_number: d.pool_number } : {}),
        })))
      if (teamsError) throw teamsError
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: builds successfully.

- [ ] **Step 4: Manual verification of the new guard**

Confirm by reading the code (no running app needed for this step): with
`pool_size = 4` and, say, 12 duplas, `numPools = ceil(12/4) = 3` — the
guard must throw before any `teams` insert happens. With 8 duplas and
`pool_size = 4`, `numPools = 2` — must proceed normally. Note both cases
in your report.

- [ ] **Step 5: Commit**

```bash
git add src/pages/GameDetails.jsx
git commit -m "feat: assign pool_number when forming duplas for grupos+eliminatórias (Task 6)"
```

---

## Task 7: `PoolGroupStage` component (per-pool round drawing)

**Files:**
- Create: `src/components/PoolGroupStage.jsx`

**Interfaces:**
- Consumes: `roundRobinRound`, `standings` (existing, unmodified, from
  `mixLogic.js`).
- Produces:
  - Props: `{ teams, matches, numCourts, advancePerPool = 2, onDrawRound(rows), onAllPoolsComplete(seededTeamIds) }`.
    - `teams`: all of this game's `teams` rows (with `pool_number`,
      `seed_ranking`, `id`).
    - `matches`: all of this game's `matches` rows with `phase === 'group'`.
    - `onDrawRound(rows)`: called with match rows
      (`{ court_number, team_a_id, team_b_id }`, no `game_id`/`round_number`/
      `phase` — the caller, `GameDetails.jsx`, adds those, mirroring how
      `handleStartRound1`/`handleAdvance` already insert rows today).
    - `onAllPoolsComplete(seededTeamIds)`: called once, when every pool has
      finished all its round-robin rounds — `seededTeamIds` is the return
      value of `seedKnockoutFromPools`, ready for `GameDetails.jsx` to feed
      into the existing `firstElimMatches`.
  - This component owns no Supabase calls itself — `GameDetails.jsx` (Task
    8) does all persistence, matching the existing pattern where
    `GameDetails.jsx` owns all writes and re-fetches after.

- [ ] **Step 1: Write the component**

```jsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PrimaryButton } from './ui'
import { roundRobinRound, standings, seedKnockoutFromPools } from '../lib/mixLogic'

/** Group stage for the "grupos_eliminatorias" format: one independent
    round-robin per pool, admin-paced (draws each pool's next round
    explicitly — no auto-timer, matching the round-by-round model the rest
    of the mix engine already uses). Once every pool has played out its
    full round-robin, shows a single "advance to knockout" action that
    seeds the bracket via seedKnockoutFromPools. */
export default function PoolGroupStage({ teams, matches, numCourts, advancePerPool = 2, onDrawRound, onAllPoolsComplete, busy }) {
  const { t } = useTranslation()
  const poolNumbers = [...new Set(teams.map((tm) => tm.pool_number))].filter((n) => n != null).sort((a, b) => a - b)
  const [activePool, setActivePool] = useState(poolNumbers[0])

  const poolTeams = (poolNumber) => teams.filter((tm) => tm.pool_number === poolNumber)
  const poolTeamIds = (poolNumber) =>
    [...poolTeams(poolNumber)].sort((a, b) => (b.seed_ranking ?? 0) - (a.seed_ranking ?? 0)).map((tm) => tm.id)
  const poolMatches = (poolNumber) => {
    const ids = new Set(poolTeamIds(poolNumber))
    return matches.filter((m) => ids.has(m.team_a_id) && ids.has(m.team_b_id))
  }
  const poolRoundsTotal = (poolNumber) => Math.max(poolTeams(poolNumber).length - 1, 1)
  const poolMaxRound = (poolNumber) => {
    const ms = poolMatches(poolNumber)
    return ms.length ? Math.max(...ms.map((m) => m.round_number)) : 0
  }
  const poolCurrentRoundDone = (poolNumber) => {
    const maxRound = poolMaxRound(poolNumber)
    if (maxRound === 0) return false
    const current = poolMatches(poolNumber).filter((m) => m.round_number === maxRound)
    return current.length > 0 && current.every((m) => m.winner_team_id)
  }
  const poolComplete = (poolNumber) =>
    poolMaxRound(poolNumber) >= poolRoundsTotal(poolNumber) && poolCurrentRoundDone(poolNumber)

  const allPoolsComplete = poolNumbers.length > 0 && poolNumbers.every(poolComplete)

  const handleDrawPoolRound = (poolNumber) => {
    const maxRound = poolMaxRound(poolNumber)
    const rows = roundRobinRound(poolTeamIds(poolNumber), numCourts, maxRound)
    onDrawRound(rows)
  }

  const handleAdvanceToKnockout = () => {
    const poolStandingsArrays = poolNumbers.map((n) => standings(poolTeams(n), poolMatches(n)))
    onAllPoolsComplete(seedKnockoutFromPools(poolStandingsArrays, advancePerPool))
  }

  if (poolNumbers.length === 0) return null

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5 flex-wrap">
        {poolNumbers.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setActivePool(n)}
            className={`px-3.5 py-2 min-h-[44px] rounded-ctrl text-sm font-extrabold transition-all duration-fast ${
              activePool === n ? 'bg-ink-900 text-white' : 'bg-surface text-muted border border-line hover:text-ink-900'
            }`}
          >
            {t('gamedetails.pool_label', { number: n })}
            {poolComplete(n) ? ' ✓' : ''}
          </button>
        ))}
      </div>

      {activePool != null && (
        <div className="card space-y-3">
          {poolCurrentRoundDone(activePool) || poolMaxRound(activePool) === 0 ? (
            <PrimaryButton disabled={busy || poolComplete(activePool)} onClick={() => handleDrawPoolRound(activePool)} className="w-full">
              {poolMaxRound(activePool) === 0
                ? t('gamedetails.start_round1')
                : poolComplete(activePool)
                  ? t('gamedetails.pool_all_complete_hint')
                  : t('gamedetails.advance_round')}
            </PrimaryButton>
          ) : null}

          {standings(poolTeams(activePool), poolMatches(activePool)).length > 0 && (
            <div>
              <h3 className="text-lg text-ink-900 mb-3">{t('gamedetails.pool_standings_title', { number: activePool })}</h3>
              <div className="space-y-1.5">
                {standings(poolTeams(activePool), poolMatches(activePool)).map((s, i) => (
                  <div key={s.team.id} className="flex items-center gap-3 text-sm py-1.5 border-b border-line last:border-0">
                    <span className="w-6 font-extrabold text-ink-900 tabular-nums">{i + 1}</span>
                    <span className="text-muted tabular-nums" title={t('gamedetails.wins_title')}>{s.wins}{t('gamedetails.wins_abbrev')}</span>
                    <span className="text-muted tabular-nums w-12 text-right" title={t('gamedetails.points_diff_title')}>
                      {s.diff > 0 ? '+' : ''}{s.diff}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {allPoolsComplete && (
        <PrimaryButton disabled={busy} onClick={handleAdvanceToKnockout} className="w-full">
          {t('gamedetails.pool_advance_to_knockout')}
        </PrimaryButton>
      )}
    </div>
  )
}
```

Note: the standings rows above intentionally don't show a team name column
(unlike the existing `tctStandings` render block, which uses a `teamName()`
helper local to `GameDetails.jsx`) — Task 8 passes `teams` already, so if
name display turns out to be needed, add a `teamName` prop rather than
duplicating `GameDetails.jsx`'s own lookup here. Flag this as a visible gap
in Task 8's manual verification step rather than guessing at it now.

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: builds successfully (this component isn't wired in yet, so this
only checks for syntax errors — Task 8 is where it gets exercised for
real).

- [ ] **Step 3: Commit**

```bash
git add src/components/PoolGroupStage.jsx
git commit -m "feat: PoolGroupStage component for per-pool round drawing (Task 7)"
```

---

## Task 8: Wire `PoolGroupStage` into `GameDetails.jsx`

**Files:**
- Modify: `src/pages/GameDetails.jsx`

**Interfaces:**
- Consumes: `PoolGroupStage` (Task 7), `seedKnockoutFromPools` (Task 2, via
  `PoolGroupStage`), existing unmodified `firstElimMatches`,
  `eliminationPhases`, `nextElimMatches`.
- Produces: a fully working group+knockout flow for
  `format === 'grupos_eliminatorias'`, with `sobe_desce`/`todos_contra_todos`
  completely untouched.

- [ ] **Step 1: Import `PoolGroupStage`**

Add near the other component imports:

```js
import PoolGroupStage from '../components/PoolGroupStage'
```

- [ ] **Step 2: Add the `isGruposEliminatorias` flag and advancing-team count**

Find:

```js
  const isSobeDesce = (game?.format || 'sobe_desce') === 'sobe_desce'
  const groupRounds = isSobeDesce ? roundsTotal : Math.min(Math.max(teams.length - 1, 1), roundsTotal)
  const inGroupPhase = maxRound < groupRounds
  const elimPhases = isSobeDesce ? [] : eliminationPhases(teams.length, roundsTotal - groupRounds)
```

Change to:

```js
  const isSobeDesce = (game?.format || 'sobe_desce') === 'sobe_desce'
  const isGruposEliminatorias = game?.format === 'grupos_eliminatorias'
  const groupRounds = isSobeDesce ? roundsTotal : Math.min(Math.max(teams.length - 1, 1), roundsTotal)
  // grupos_eliminatorias never uses this flat single-group derivation —
  // its group phase is entirely owned by PoolGroupStage (rendered instead
  // of this block below); inGroupPhase/groupRounds here stay meaningless
  // for it but harmless, since the isGruposEliminatorias branches below
  // never read them.
  const inGroupPhase = maxRound < groupRounds
  // For grupos_eliminatorias, the bracket size is decided by how many
  // teams actually ADVANCE out of the pools (poolCount * advancePerPool),
  // not the category's total team count — and there's no time-based round
  // cap (a 3-day event has no single "session length"), so pass a large
  // sentinel instead of `roundsTotal - groupRounds`.
  const advancingTeamCount = isGruposEliminatorias
    ? [...new Set(teams.map((tm) => tm.pool_number))].filter((n) => n != null).length * 2
    : teams.length
  const elimPhases = isSobeDesce
    ? []
    : isGruposEliminatorias
      ? eliminationPhases(advancingTeamCount, Number.MAX_SAFE_INTEGER)
      : eliminationPhases(teams.length, roundsTotal - groupRounds)
```

- [ ] **Step 3: Track whether the knockout bracket has been seeded yet**

The existing `matches` list is the only source of truth for phase
progression elsewhere in this file, but for `grupos_eliminatorias` there's
no way to tell "pools are done, but the bracket hasn't been seeded yet"
apart from checking whether any non-`'group'` phase match exists yet. Find:

```js
  const existingElim = [...new Set(matches.filter(m => m.phase !== 'group').map(m => m.phase))]
  const nextPhase = elimPhases.find(ph => !existingElim.includes(ph))
```

Leave this unchanged — it already works for `grupos_eliminatorias` too
(`existingElim` is empty until `onAllPoolsComplete` inserts the first
elimination-phase matches in Step 5 below, at which point this file's
*existing* elim-phase rendering takes over unmodified).

- [ ] **Step 4: Branch `handleStartRound1`/render — show `PoolGroupStage` instead, while pools aren't seeded into the bracket yet**

Find:

```js
  const canAdvance = currentRoundDone && (inGroupPhase || !!nextPhase)
  const canFinalize = roundsStarted && allDone && !canAdvance
```

Change to:

```js
  const canAdvance = currentRoundDone && (inGroupPhase || !!nextPhase)
  const canFinalize = roundsStarted && allDone && !canAdvance
  // grupos_eliminatorias is still in its pool stage exactly until the
  // first elimination-phase match exists — PoolGroupStage owns everything
  // before that point, this file's existing round/elim rendering owns
  // everything after.
  const inPoolStage = isGruposEliminatorias && existingElim.length === 0
```

- [ ] **Step 5: Add the pool-stage handlers**

Find `handleAdvance` (the function containing
`rows = firstElimMatches(phase, orderedIds)`), and add two new handlers
right after it (before `return` / JSX):

```js
  const handleDrawPoolRound = async (rows) => {
    setBusy(true)
    setMixError('')
    try {
      const { error } = await supabase.from('matches').insert(
        rows.map((m) => ({ ...m, game_id: id, round_number: maxRound + 1, phase: 'group' }))
      )
      if (error) throw error
      loadGameDetails()
    } catch (error) {
      console.error('Error drawing pool round:', error)
      setMixError(error.message || t('gamedetails.error_start_round1'))
    } finally {
      setBusy(false)
    }
  }

  const handleAllPoolsComplete = async (seededTeamIds) => {
    setBusy(true)
    setMixError('')
    try {
      const phase = elimPhases[0]
      const rows = firstElimMatches(phase, seededTeamIds)
      const { error } = await supabase.from('matches').insert(
        rows.map((m) => ({ ...m, game_id: id, round_number: maxRound + 1, phase }))
      )
      if (error) throw error
      loadGameDetails()
    } catch (error) {
      console.error('Error seeding knockout bracket:', error)
      setMixError(error.message || t('gamedetails.error_start_round1'))
    } finally {
      setBusy(false)
    }
  }
```

Note: `round_number: maxRound + 1` for pool-round draws is intentionally
the GLOBAL `maxRound` (across all pools' matches combined), not a
per-pool round counter — round numbers only need to be unique/increasing
within this game for the existing `rounds.map` rendering (Task 8 doesn't
change that rendering), they don't need to mean "this is pool A's Nth
round" on their own; `PoolGroupStage` already scopes everything else by
team-id membership, not by round number.

- [ ] **Step 6: Render `PoolGroupStage` in place of the flat group-phase UI, for this format only**

Find the "Classificação (todos contra todos)" block (it appears **twice**,
character-identical, once for the live view and once for the finished/
history view):

```jsx
          {/* Classificação (todos contra todos) */}
          {!isSobeDesce && roundsStarted && tctStandings.length > 0 && (
            <div className="card">
              <h3 className="text-lg text-ink-900 mb-3">{t('gamedetails.group_standings_title')}</h3>
              <div className="space-y-1.5">
                {tctStandings.map((s, i) => (
                  <div key={s.team.id} className="flex items-center gap-3 text-sm py-1.5 border-b border-line last:border-0">
                    <span className="w-6 font-extrabold text-ink-900 tabular-nums">{i + 1}</span>
                    <span className="flex-1 font-extrabold text-ink-900 truncate">{teamName(s.team.id)}</span>
                    <span className="text-muted tabular-nums" title={t('gamedetails.wins_title')}>{s.wins}{t('gamedetails.wins_abbrev')}</span>
                    <span className="text-muted tabular-nums w-12 text-right" title={t('gamedetails.points_diff_title')}>
                      {s.diff > 0 ? '+' : ''}{s.diff}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
```

Replace **both occurrences** (use `replace_all: true` — they're
character-identical) with:

```jsx
          {/* Classificação (todos contra todos) — never for grupos_eliminatorias, which gets its own per-pool standings from PoolGroupStage below */}
          {!isSobeDesce && !isGruposEliminatorias && roundsStarted && tctStandings.length > 0 && (
            <div className="card">
              <h3 className="text-lg text-ink-900 mb-3">{t('gamedetails.group_standings_title')}</h3>
              <div className="space-y-1.5">
                {tctStandings.map((s, i) => (
                  <div key={s.team.id} className="flex items-center gap-3 text-sm py-1.5 border-b border-line last:border-0">
                    <span className="w-6 font-extrabold text-ink-900 tabular-nums">{i + 1}</span>
                    <span className="flex-1 font-extrabold text-ink-900 truncate">{teamName(s.team.id)}</span>
                    <span className="text-muted tabular-nums" title={t('gamedetails.wins_title')}>{s.wins}{t('gamedetails.wins_abbrev')}</span>
                    <span className="text-muted tabular-nums w-12 text-right" title={t('gamedetails.points_diff_title')}>
                      {s.diff > 0 ? '+' : ''}{s.diff}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {inPoolStage && (
            <PoolGroupStage
              teams={teams}
              matches={matches.filter((m) => m.phase === 'group')}
              numCourts={numCourts}
              busy={busy}
              onDrawRound={handleDrawPoolRound}
              onAllPoolsComplete={handleAllPoolsComplete}
            />
          )}
```

- [ ] **Step 7: Verify the build**

Run: `npm run build`
Expected: builds successfully.

- [ ] **Step 8: Manual verification**

This is the task where the actual tournament flow becomes testable
end-to-end. Requires the Task 3 migration to have been run in Supabase
first (ask the user to confirm, don't assume).

1. Start the dev server (`npm run dev`).
2. In "Gerir Clube", create a mix with format "Grupos + Eliminatórias",
   pool size 4, and at least 8 confirmed participants (use the existing
   "Adicionar jogador de teste" admin button — Task 6 already wired pool
   assignment into the same `handleStartMix` this button's flow uses).
3. Open the mix, start it ("Começar Mix") — confirm `teams` get
   `pool_number` assigned (2 pools of 4).
4. Confirm pool tabs render, draw rounds for each pool independently,
   enter scores, confirm each pool's own standings update.
5. Once all pools finish, confirm "Avançar para as eliminatórias" appears
   and, on click, a semifinal (or appropriate phase) bracket is created —
   confirm by hand that no first-round match pairs two teams that were in
   the same pool.
6. Confirm the *existing* elimination bracket rendering (from before this
   plan) displays and accepts scores normally from here on — this part
   should need no changes at all.

If any step fails, do not silently patch around it — stop and report
exactly what broke, since this is the core mechanism the tournament
depends on.

- [ ] **Step 9: Commit**

```bash
git add src/pages/GameDetails.jsx
git commit -m "feat: wire PoolGroupStage into GameDetails.jsx for grupos+eliminatórias (Task 8)"
```

---

## Task 9: Bulk participant onboarding — edge function

**Files:**
- Create: `supabase/functions/admin-bulk-create-participants/index.ts`

**Interfaces:**
- Produces: an HTTP POST endpoint (invoked via
  `supabase.functions.invoke('admin-bulk-create-participants', { body })`)
  accepting `{ organization_id: string, entries: Array<{ name: string, game_id: string }> }`,
  returning `{ created: Array<{ name: string, user_id: string, game_id: string }>, failed: Array<{ name: string, game_id: string, error: string }> }`.
  Consumed by Task 10 (`GameDetails.jsx` bulk-import UI).

- [ ] **Step 1: Write the edge function**

Parameterizes the exact same pattern
`supabase/functions/admin-create-test-user/index.ts` already uses
(real, never-logged-in Auth user + profile + membership, created
server-side because `profiles.id` is a hard FK to `auth.users`), looping
over many entries in one invocation instead of creating exactly one
"Teste N" person per call.

```ts
// Bulk version of admin-create-test-user: creates many real (never-logged-
// into) participants in one call, each with a real supplied name (not
// "Teste N"), tagged is_guest=true (not is_test — these are real event
// participants), and adds each one directly to their assigned game's
// `participants` — built for onboarding ~300 people for a one-off
// corporate tournament without 300 individual browser round-trips.
//
// Access control mirrors admin-create-test-user: rejects the anon key,
// verifies the caller is an admin of organization_id — required here (not
// left to RLS) because this uses the service-role key, which bypasses RLS.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function base64UrlDecode(input: string): string {
  let base64 = input.replace(/-/g, '+').replace(/_/g, '/')
  while (base64.length % 4) base64 += '='
  return atob(base64)
}

function decodeJwt(authHeader: string | null): { role: string | null; sub: string | null } {
  if (!authHeader?.startsWith('Bearer ')) return { role: null, sub: null }
  const token = authHeader.slice('Bearer '.length)
  const parts = token.split('.')
  if (parts.length !== 3) return { role: null, sub: null }
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1]))
    return {
      role: typeof payload.role === 'string' ? payload.role : null,
      sub: typeof payload.sub === 'string' ? payload.sub : null,
    }
  } catch {
    return { role: null, sub: null }
  }
}

interface Entry {
  name: string
  game_id: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const { role, sub: callerId } = decodeJwt(req.headers.get('Authorization'))
  if (role !== 'authenticated' || !callerId) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  let body: { organization_id?: string; entries?: Entry[] }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const organizationId = body.organization_id
  const entries = body.entries
  if (!organizationId || !Array.isArray(entries) || entries.length === 0) {
    return jsonResponse({ error: 'Missing organization_id or entries' }, 400)
  }
  if (entries.length > 500) {
    return jsonResponse({ error: 'Too many entries in one call (max 500)' }, 400)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set')
    return jsonResponse({ error: 'Server misconfigured' }, 500)
  }
  const admin = createClient(supabaseUrl, serviceRoleKey)

  const { data: callerMembership, error: callerError } = await admin
    .from('memberships')
    .select('is_admin')
    .eq('organization_id', organizationId)
    .eq('user_id', callerId)
    .maybeSingle()
  if (callerError) {
    console.error('Failed to check caller membership:', callerError)
    return jsonResponse({ error: 'Server error' }, 500)
  }
  if (!callerMembership?.is_admin) {
    return jsonResponse({ error: 'Only org admins can bulk-import participants' }, 403)
  }

  const created: Array<{ name: string; user_id: string; game_id: string }> = []
  const failed: Array<{ name: string; game_id: string; error: string }> = []

  for (const entry of entries) {
    try {
      const name = entry.name?.trim()
      if (!name || !entry.game_id) {
        failed.push({ name: entry.name ?? '', game_id: entry.game_id ?? '', error: 'Missing name or game_id' })
        continue
      }

      const { data: authUser, error: createError } = await admin.auth.admin.createUser({
        email: `bulk-${crypto.randomUUID()}@padelapp.test`,
        email_confirm: true,
        password: crypto.randomUUID(),
        user_metadata: { name },
      })
      if (createError || !authUser?.user) {
        failed.push({ name, game_id: entry.game_id, error: createError?.message || 'Failed to create auth user' })
        continue
      }

      const { error: membershipError } = await admin.from('memberships').insert({
        user_id: authUser.user.id,
        organization_id: organizationId,
        is_admin: false,
        is_guest: true,
        level: 'iniciante',
      })
      if (membershipError) {
        failed.push({ name, game_id: entry.game_id, error: membershipError.message })
        continue
      }

      const { error: participantError } = await admin.from('participants').insert({
        game_id: entry.game_id,
        user_id: authUser.user.id,
        status: 'confirmed',
        joined_alone: true,
      })
      if (participantError) {
        failed.push({ name, game_id: entry.game_id, error: participantError.message })
        continue
      }

      created.push({ name, user_id: authUser.user.id, game_id: entry.game_id })

      // Supabase Auth's admin.createUser can rate-limit under a tight
      // loop at this volume — a small pause between creates trades a
      // little time for not failing halfway through a 300-person import.
      await new Promise((resolve) => setTimeout(resolve, 150))
    } catch (err) {
      failed.push({ name: entry.name ?? '', game_id: entry.game_id ?? '', error: err instanceof Error ? err.message : 'Unknown error' })
    }
  }

  return jsonResponse({ created, failed })
})
```

- [ ] **Step 2: Flag deployment explicitly**

Like every Supabase Edge Function in this repo, this needs an explicit
`supabase functions deploy admin-bulk-create-participants` before it's
callable — say so explicitly when reporting this task done, the same way
the Task 3 migration gets flagged as not-yet-run.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/admin-bulk-create-participants/index.ts
git commit -m "feat: admin-bulk-create-participants edge function (Task 9)"
```

---

## Task 10: Bulk participant onboarding — admin UI

**Files:**
- Modify: `src/pages/GameDetails.jsx`

**Interfaces:**
- Consumes: the `admin-bulk-create-participants` edge function (Task 9).

- [ ] **Step 1: Add state for the bulk-import UI**

Near the other `useState` declarations for admin actions (alongside
`addingTestUser`), add:

```js
  const [bulkImportText, setBulkImportText] = useState('')
  const [bulkImporting, setBulkImporting] = useState(false)
  const [bulkImportResult, setBulkImportResult] = useState(null)
```

- [ ] **Step 2: Add the handler**

Near `handleAddTestUser`, add:

```js
  const handleBulkImport = async () => {
    const names = bulkImportText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    if (names.length === 0) return

    setBulkImporting(true)
    setBulkImportResult(null)
    try {
      const { data, error } = await supabase.functions.invoke('admin-bulk-create-participants', {
        body: {
          organization_id: gameOrganizationId,
          entries: names.map((name) => ({ name, game_id: id })),
        },
      })
      if (error) throw error
      setBulkImportResult(data)
      setBulkImportText('')
      loadGameDetails()
    } catch (error) {
      console.error('Error bulk-importing participants:', error)
      setBulkImportResult({ created: [], failed: names.map((name) => ({ name, game_id: id, error: error.message })) })
    } finally {
      setBulkImporting(false)
    }
  }
```

- [ ] **Step 3: Add the UI, next to the existing "Adicionar jogador de teste" admin button**

Find:

```jsx
          {isAdmin && (
            <PrimaryButton
              variant="ghost"
              onClick={handleAddTestUser}
              disabled={addingTestUser}
              className="w-full"
            >
              <UserPlus size={20} />
              {addingTestUser
                ? t('gamedetails.adding')
                : peopleCount < capacity
                  ? t('gamedetails.add_test_player')
                  : t('gamedetails.add_test_player_waitlist')}
            </PrimaryButton>
          )}
```

Add immediately after it:

```jsx
          {isAdmin && (
            <div className="card space-y-3">
              <h3 className="text-lg text-ink-900">{t('gamedetails.bulk_import_title')}</h3>
              <textarea
                value={bulkImportText}
                onChange={(e) => setBulkImportText(e.target.value)}
                placeholder={t('gamedetails.bulk_import_placeholder')}
                className="input-field min-h-[120px]"
              />
              <PrimaryButton
                variant="ghost"
                onClick={handleBulkImport}
                disabled={bulkImporting || !bulkImportText.trim()}
                className="w-full"
              >
                {bulkImporting ? t('gamedetails.bulk_import_importing') : t('gamedetails.bulk_import_button')}
              </PrimaryButton>
              {bulkImportResult && (
                <p className="text-sm text-muted">
                  {t('gamedetails.bulk_import_summary', {
                    created: bulkImportResult.created.length,
                    failed: bulkImportResult.failed.length,
                  })}
                </p>
              )}
            </div>
          )}
```

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: builds successfully.

- [ ] **Step 5: Manual verification**

Requires Task 9's edge function to actually be deployed first (ask the
user to confirm, don't assume). In the dev server, open a mix as admin,
paste a handful of names into the new textarea, click import, confirm the
summary line shows the right created/failed counts and the people appear
in the mix's participant list.

- [ ] **Step 6: Commit**

```bash
git add src/pages/GameDetails.jsx
git commit -m "feat: bulk participant import admin UI (Task 10)"
```

---

## After Task 10: operational steps that are not code

These block the real event and are easy to lose track of amid the coding
tasks — none of them are a task above on purpose (per the spec, no new
mechanism is needed for any of them):

- [ ] **Run the Task 3 migration** in Supabase → SQL Editor. Nothing in
  Tasks 4-10 works against production until this has actually happened —
  say so explicitly, don't assume it from the file existing in the repo.
- [ ] **Deploy the Task 9 edge function**: `supabase functions deploy admin-bulk-create-participants`.
- [ ] **Create the event's organization** using the existing
  platform-admin "create club" flow — no new code needed for this, it's
  the same mechanism any club is created with today.
- [ ] **Create one category-mix per level division** inside that
  organization, using Task 5's enhanced form (format "Grupos +
  Eliminatórias", pool size set per category).
- [ ] **Bulk-import each category's participants** via Task 10's UI, one
  category-mix at a time.
