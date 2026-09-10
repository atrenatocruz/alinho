# Set Scoring Formats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two new match-scoring styles — **melhor de 3 sets** and **pro-set a 9** — as a per-mix choice (`games.scoring_format`) independent of match-structure format (`sobe_desce`/`todos_contra_todos`/`grupos_eliminatorias`), so any format can use any scoring style.

**Architecture:** A new pure logic module (`src/lib/scoringLogic.js`) implements the two new formats' validation/decision rules, tested with vitest (already set up in this repo). A new `ScoreEntry` component replaces the inline score-input JSX currently duplicated at two render sites in `GameDetails.jsx`, branching on `scoring_format` to show the right input shape. `matches.score_a`/`score_b` keeps meaning "the number that decides the match" for every format (points today, sets won for `melhor_3_sets`, games for `pro_set_9`) — every existing consumer (`standings()`, `finalize_mix`, ELO calc, which only reads win/loss/tie — never the magnitude — confirmed in `migration_elo_rating.sql:147-151`) needs zero changes.

**Tech Stack:** React + Vite + Supabase (Postgres + Edge Functions). Vitest already set up (`vitest.config.js`, `src/lib/mixLogic.test.js`).

**Spec:** `docs/superpowers/specs/2026-09-10-set-scoring-formats-design.md`

## Global Constraints

- `scoring_format` applies to every mix regardless of `format` — unlike `pool_size` (which only matters for `grupos_eliminatorias` and had to be excluded from `...gameFields` to avoid breaking other formats before its migration ran), `scoring_format` is sent unconditionally for every mix, the same way `age_restriction`/`latitude`/`longitude` already are in this codebase. This is safe **only** after the migration has run — flag that explicitly, same as every migration in this repo (per `CLAUDE.md`).
- No changes to `standings()`, `finalize_mix`, ELO calculation, or any existing format's engine logic (`sobe_desce`/`todos_contra_todos`/`grupos_eliminatorias`) — this plan only changes how a match's `score_a`/`score_b` gets collected and computed, never how those numbers get used afterward.
- Ad/no-ad or in-set (6-6) tie-break modeling is out of scope — a set's games score is trusted input, same level as today's simple score entry.

---

## Task 1: Scoring logic — pure functions

**Files:**
- Create: `src/lib/scoringLogic.js`
- Test: `src/lib/scoringLogic.test.js`

**Interfaces:**
- Produces: `validateProSetScore(a, b)` → `{ valid: boolean, needsBreaker: boolean }`. `needsBreaker` is true exactly when `a === 8 && b === 8` (score not yet valid, caller must collect a super tie-break next). `valid` is true for any win-by-2 result up to 9 (e.g. `9-7`, `9-0`), or for a `9-8`/`8-9` result (which only a super tie-break can produce — see `computeProSetFinalScore`). Neither `valid` nor `needsBreaker` is true for an in-progress/invalid pair like `7-5` (not a valid final pro-set score) — that case is for the caller's own "not finished yet" input validation, not this function's concern; this function only judges scores the UI is about to submit as final.
- Produces: `computeProSetFinalScore(gamesA, gamesB, breaker)` → `{ score_a, score_b }`. If `breaker` is `null`, returns `{ score_a: gamesA, score_b: gamesB }` unchanged (caller already validated it's a normal win-by-2 finish). If `breaker` is `{ a, b }` (the super tie-break's own score, e.g. `10-7`), returns `9-8` in favor of whichever side won the breaker, ignoring `gamesA`/`gamesB` (which must have been `8-8`).
- Produces: `computeSetsResult(sets)` — `sets` is an array of `{ score_a, score_b }` (1, 2, or 3 entries — entry 3, if present, is the super tie-break). Returns `{ setsA, setsB, decided }`. `setsA`/`setsB` count how many sets (of the entries actually present) each side won (a set is won by whichever side has the higher `score_a`/`score_b` in that entry — ties within one set entry aren't valid but this function doesn't need to reject them, the UI does). `decided` is true once either side has reached 2. Empty array or a single entry never decides the match; a 2nd entry can decide it (2-0); a 3rd only exists when the first two split 1-1.

- [ ] **Step 1: Write the failing tests** — create `src/lib/scoringLogic.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { validateProSetScore, computeProSetFinalScore, computeSetsResult } from './scoringLogic'

describe('validateProSetScore', () => {
  it('accepts a normal win-by-2 finish', () => {
    expect(validateProSetScore(9, 7)).toEqual({ valid: true, needsBreaker: false })
    expect(validateProSetScore(9, 0)).toEqual({ valid: true, needsBreaker: false })
  })

  it('rejects 9-8 as a direct entry (only a breaker can produce it)', () => {
    expect(validateProSetScore(9, 8)).toEqual({ valid: false, needsBreaker: false })
  })

  it('flags 8-8 as needing a super tie-break, not a valid final score', () => {
    expect(validateProSetScore(8, 8)).toEqual({ valid: false, needsBreaker: true })
  })

  it('rejects a still-in-progress score', () => {
    expect(validateProSetScore(7, 5)).toEqual({ valid: false, needsBreaker: false })
  })

  it('is symmetric for the b-wins case', () => {
    expect(validateProSetScore(6, 9)).toEqual({ valid: true, needsBreaker: false })
  })
})

describe('computeProSetFinalScore', () => {
  it('passes through a normal win-by-2 score unchanged', () => {
    expect(computeProSetFinalScore(9, 7, null)).toEqual({ score_a: 9, score_b: 7 })
  })

  it('converts an 8-8 + won breaker into 9-8 for the breaker winner (side a)', () => {
    expect(computeProSetFinalScore(8, 8, { a: 10, b: 7 })).toEqual({ score_a: 9, score_b: 8 })
  })

  it('converts an 8-8 + won breaker into 8-9 for the breaker winner (side b)', () => {
    expect(computeProSetFinalScore(8, 8, { a: 6, b: 10 })).toEqual({ score_a: 8, score_b: 9 })
  })
})

describe('computeSetsResult', () => {
  it('is undecided after one set', () => {
    expect(computeSetsResult([{ score_a: 6, score_b: 4 }])).toEqual({ setsA: 1, setsB: 0, decided: false })
  })

  it('is decided 2-0 after two sets won by the same side', () => {
    const sets = [{ score_a: 6, score_b: 4 }, { score_a: 6, score_b: 2 }]
    expect(computeSetsResult(sets)).toEqual({ setsA: 2, setsB: 0, decided: true })
  })

  it('is undecided 1-1 after a split, decided 2-1 once the super tie-break is added', () => {
    const split = [{ score_a: 6, score_b: 4 }, { score_a: 3, score_b: 6 }]
    expect(computeSetsResult(split)).toEqual({ setsA: 1, setsB: 1, decided: false })
    const withBreaker = [...split, { score_a: 10, score_b: 7 }]
    expect(computeSetsResult(withBreaker)).toEqual({ setsA: 2, setsB: 1, decided: true })
  })

  it('handles the b-side winning the decider', () => {
    const withBreaker = [
      { score_a: 6, score_b: 4 }, { score_a: 3, score_b: 6 }, { score_a: 8, score_b: 10 },
    ]
    expect(computeSetsResult(withBreaker)).toEqual({ setsA: 1, setsB: 2, decided: true })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/scoringLogic.test.js`
Expected: FAIL — module `./scoringLogic` doesn't exist.

- [ ] **Step 3: Implement `scoringLogic.js`**

```js
/* ════════════════════════════════════════════════════════════════════════
   Scoring logic — pure functions for the two set-based scoring formats
   (pro_set_9, melhor_3_sets). No I/O, fully testable — mirrors mixLogic.js's
   style. matches.score_a/score_b keeps meaning "the number that decides
   the match" for every scoring format (points today, sets won for
   melhor_3_sets, games for pro_set_9) — every existing consumer
   (standings(), finalize_mix, ELO) only ever reads win/loss/tie from these
   two numbers, never their magnitude, so none of that code needs to change.
   ════════════════════════════════════════════════════════════════════════ */

/** Judges a pro-set games score the UI is about to submit as final.
    valid: a normal win-by-2 finish (up to 9). needsBreaker: the score is
    8-8 — not valid on its own, the UI must collect a super tie-break next
    (see computeProSetFinalScore). Anything else (an in-progress score, or
    9-8/8-9 typed directly rather than produced by a breaker) is neither. */
export function validateProSetScore(a, b) {
  if (a === 8 && b === 8) return { valid: false, needsBreaker: true }
  const higher = Math.max(a, b)
  const lower = Math.min(a, b)
  const valid = higher === 9 && lower <= 7
  return { valid, needsBreaker: false }
}

/** Converts an 8-8 pro-set plus its super tie-break into the recorded 9-8
    final score. `breaker` is null for a normal (non-8-8) finish, in which
    case gamesA/gamesB pass through unchanged — the caller must have
    already confirmed via validateProSetScore that they're a valid direct
    finish. */
export function computeProSetFinalScore(gamesA, gamesB, breaker) {
  if (!breaker) return { score_a: gamesA, score_b: gamesB }
  return breaker.a > breaker.b ? { score_a: 9, score_b: 8 } : { score_a: 8, score_b: 9 }
}

/** Tallies sets won from a list of set score entries (1-3 entries, the 3rd
    being a super tie-break when the first two split 1-1). decided is true
    once either side reaches 2 — the caller stops collecting further sets
    at that point. */
export function computeSetsResult(sets) {
  let setsA = 0
  let setsB = 0
  for (const s of sets) {
    if (s.score_a > s.score_b) setsA++
    else if (s.score_b > s.score_a) setsB++
  }
  return { setsA, setsB, decided: setsA >= 2 || setsB >= 2 }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/scoringLogic.test.js`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/scoringLogic.js src/lib/scoringLogic.test.js
git commit -m "feat: pure logic for pro-set and melhor-de-3-sets scoring (Task 1)"
```

---

## Task 2: Database migration

**Files:**
- Create: `supabase/migration_set_scoring.sql`

**Interfaces:**
- Produces: `games.scoring_format` (`'pontos_simples' | 'pro_set_9' | 'melhor_3_sets'`, default `'pontos_simples'`); `match_sets` table (`match_id`, `set_number`, `score_a`, `score_b`, `is_super_tiebreak`), RLS mirroring `matches`. Consumed by Task 4 (form), Task 7 (persistence).

- [ ] **Step 1: Write the migration**

```sql
-- ════════════════════════════════════════════════════════════════════════
-- Migration: Set scoring formats (melhor de 3 sets / pro-set a 9)
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- NOT LIVE until run there — this file existing in the repo changes
-- nothing on its own. Every existing mix defaults to 'pontos_simples',
-- today's behavior, unchanged.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Per-mix scoring choice ───────────────────────────────────────────
ALTER TABLE games ADD COLUMN IF NOT EXISTS scoring_format TEXT NOT NULL DEFAULT 'pontos_simples';
ALTER TABLE games DROP CONSTRAINT IF EXISTS games_scoring_format_check;
ALTER TABLE games ADD CONSTRAINT games_scoring_format_check
  CHECK (scoring_format IN ('pontos_simples', 'pro_set_9', 'melhor_3_sets'));

-- ── 2. Per-set scores, only populated for melhor_3_sets matches ────────
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
CREATE POLICY "Org members can view match sets"
  ON match_sets FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM matches
    JOIN games ON games.id = matches.game_id
    JOIN memberships ON memberships.organization_id = games.organization_id
    WHERE matches.id = match_sets.match_id AND memberships.user_id = auth.uid()
  ));

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
CREATE POLICY "Scorekeepers can submit match sets while in progress"
  ON match_sets FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM matches
    JOIN games ON games.id = matches.game_id
    WHERE matches.id = match_sets.match_id AND games.status = 'in_progress'
      AND EXISTS (SELECT 1 FROM game_scorekeepers gs WHERE gs.game_id = games.id AND gs.user_id = auth.uid())
  ));

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
```

- [ ] **Step 2: Flag this explicitly**

This migration is **not live** until pasted into Supabase → SQL Editor and run there. Once it is, `scoring_format` is sent unconditionally on every mix create/update (Task 4) — say so explicitly when reporting this task done, and flag it again when Task 4 is dispatched, since Task 4 depends on this having actually run in whatever environment it's tested against.

- [ ] **Step 3: Commit**

```bash
git add supabase/migration_set_scoring.sql
git commit -m "feat: migration for set scoring formats (scoring_format, match_sets) — NOT YET RUN in Supabase"
```

---

## Task 3: Label keys + locale strings

**Files:**
- Modify: `src/lib/mixLogic.js` (`SCORING_FORMAT_LABEL_KEY`)
- Modify: `src/locales/pt.json`
- Modify: `src/locales/en.json`

**Interfaces:**
- Produces: `SCORING_FORMAT_LABEL_KEY` (mirrors `FORMAT_LABEL_KEY`'s shape) — consumed by Task 4 (`GerirClube.jsx`'s scoring-format selector).

- [ ] **Step 1: Add `SCORING_FORMAT_LABEL_KEY`**

In `src/lib/mixLogic.js`, right after `FORMAT_LABEL_KEY`'s closing brace:

```js
export const SCORING_FORMAT_LABEL_KEY = {
  pontos_simples: 'mixlogic.scoring_pontos_simples',
  pro_set_9: 'mixlogic.scoring_pro_set_9',
  melhor_3_sets: 'mixlogic.scoring_melhor_3_sets',
}
```

- [ ] **Step 2: Add the Portuguese strings**

In `src/locales/pt.json`, in the `"mixlogic"` object (sibling to `format_grupos_eliminatorias`), add:

```json
"scoring_pontos_simples": "Pontos simples",
"scoring_pro_set_9": "Pro set a 9",
"scoring_melhor_3_sets": "Melhor de 3 sets"
```

In the `"gerirclube"` object, add:

```json
"scoring_label": "Pontuação"
```

In the `"gamedetails"` object, add:

```json
"set_number": "Set {{number}}",
"super_tiebreak": "Super tie-break",
"super_tiebreak_prompt": "8-8 — decide-se com super tie-break (até 10, diferença de 2)",
"set_saved": "Set {{number}}: {{a}}-{{b}}",
"next_set": "Set seguinte",
"save_set": "Guardar set"
```

- [ ] **Step 3: Add the matching English strings**

In `src/locales/en.json`, mirror Step 2's keys:

```json
"scoring_pontos_simples": "Simple points",
"scoring_pro_set_9": "Pro set to 9",
"scoring_melhor_3_sets": "Best of 3 sets"
```

```json
"scoring_label": "Scoring"
```

```json
"set_number": "Set {{number}}",
"super_tiebreak": "Super tie-break",
"super_tiebreak_prompt": "8-8 — decided by a super tie-break (first to 10, win by 2)",
"set_saved": "Set {{number}}: {{a}}-{{b}}",
"next_set": "Next set",
"save_set": "Save set"
```

- [ ] **Step 4: Verify the app still builds**

Run: `npm run build`
Expected: builds successfully.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mixLogic.js src/locales/pt.json src/locales/en.json
git commit -m "feat: locale strings for set scoring formats (Task 3)"
```

---

## Task 4: Mix-creation form — scoring format selector

**Files:**
- Modify: `src/pages/GerirClube.jsx`

**Interfaces:**
- Consumes: `SCORING_FORMAT_LABEL_KEY` (Task 3).
- Produces: `games` rows created/updated with `scoring_format` — consumed by Task 7 (`ScoreEntry`/`handleSaveScore`).

**Note:** unlike `pool_size`, `scoring_format` is sent unconditionally for every mix (same pattern as `age_restriction`/`latitude`) — it must NOT be excluded from `...gameFields`. This only works once Task 2's migration has actually run; flag that explicitly when this task is reported done.

- [ ] **Step 1: Add the `SCORING_FORMATS` list**

Find:

```js
const FORMATS = [
  { value: 'sobe_desce', labelKey: FORMAT_LABEL_KEY.sobe_desce },
  { value: 'todos_contra_todos', labelKey: FORMAT_LABEL_KEY.todos_contra_todos },
  { value: 'grupos_eliminatorias', labelKey: FORMAT_LABEL_KEY.grupos_eliminatorias },
]
```

Add right after it:

```js
const SCORING_FORMATS = [
  { value: 'pontos_simples', labelKey: SCORING_FORMAT_LABEL_KEY.pontos_simples },
  { value: 'pro_set_9', labelKey: SCORING_FORMAT_LABEL_KEY.pro_set_9 },
  { value: 'melhor_3_sets', labelKey: SCORING_FORMAT_LABEL_KEY.melhor_3_sets },
]
```

Add `SCORING_FORMAT_LABEL_KEY` to this file's existing `mixLogic` import (find the line importing `FORMAT_LABEL_KEY` from `../lib/mixLogic` and add it to the destructured list).

- [ ] **Step 2: Add `scoring_format` to the empty form**

Find:

```js
  format: 'sobe_desce',
  pool_size: 4,
```

Change to:

```js
  format: 'sobe_desce',
  pool_size: 4,
  scoring_format: 'pontos_simples',
```

- [ ] **Step 3: Add the translated options derivation**

Find:

```js
  const translatedFormats = FORMATS.map((f) => ({ value: f.value, label: t(f.labelKey) }))
```

Add right after it:

```js
  const translatedScoringFormats = SCORING_FORMATS.map((s) => ({ value: s.value, label: t(s.labelKey) }))
```

- [ ] **Step 4: Add the selector to the form**

Find (the end of the `pool_size` conditional block, right before the gender selector):

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

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {t('gerirclube.gender_label')}
                      </label>
```

Insert a new field between the closing `)}` and the gender `<div>`:

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

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {t('gerirclube.scoring_label')}
                      </label>
                      <Segmented
                        options={translatedScoringFormats}
                        value={gameForm.scoring_format}
                        onChange={(v) => setGameForm({ ...gameForm, scoring_format: v })}
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {t('gerirclube.gender_label')}
                      </label>
```

- [ ] **Step 5: Pre-fill on edit**

Find:

```js
      format: game.format || 'sobe_desce',
      pool_size: game.pool_size || 4,
```

Change to:

```js
      format: game.format || 'sobe_desce',
      pool_size: game.pool_size || 4,
      scoring_format: game.scoring_format || 'pontos_simples',
```

(This works via `...gameFields` in both `handleCreateGame`/`handleUpdateGame` without any other change, since `scoring_format` is a plain field on `gameForm`, sent unconditionally — same as `age_restriction`. Do not add a conditional spread or an exclusion for it.)

- [ ] **Step 6: Verify the build**

Run: `npm run build`
Expected: builds successfully.

- [ ] **Step 7: Manual verification**

Start the dev server, open "Criar Mix", confirm the "Pontuação" selector appears with 3 options and defaults to "Pontos simples".

- [ ] **Step 8: Commit**

```bash
git add src/pages/GerirClube.jsx
git commit -m "feat: scoring format selector in mix-creation form (Task 4)"
```

---

## Task 5: `ScoreEntry` component — pontos_simples + pro_set_9

**Files:**
- Create: `src/components/ScoreEntry.jsx`

**Interfaces:**
- Consumes: `validateProSetScore`, `computeProSetFinalScore` (Task 1).
- Produces: default-exported component with props `{ match, scoringFormat, editable, teamAName, teamBName, initialScores, onScoreChange, onSave, saving }`:
  - `match`: the match row (`id`, `score_a`, `score_b`, `winner_team_id`, `team_a_id`, `team_b_id`).
  - `scoringFormat`: `'pontos_simples' | 'pro_set_9' | 'melhor_3_sets'`.
  - `editable`: boolean — whether inputs render at all (mirrors the existing `editable` computation in `GameDetails.jsx`).
  - `teamAName`/`teamBName`: strings (already-resolved via the existing `teamName()` helper — this component does no name lookups itself).
  - `initialScores`: `{ a, b }` strings (mirrors the existing `scores[m.id]` shape) — used to pre-fill when correcting a saved `pontos_simples`/`pro_set_9` score. `melhor_3_sets` (Task 6) doesn't use this prop; it manages its own multi-step local state.
  - `onScoreChange(matchId, { a, b })`: called on every keystroke for `pontos_simples`/`pro_set_9` inputs — the parent keeps owning the `scores` state exactly as today, this component doesn't introduce a second source of truth for those two formats.
  - `onSave({ score_a, score_b })`: called once a final, valid score is ready to persist — for `pontos_simples`/`pro_set_9` this fires on a save button click; Task 6 wires `melhor_3_sets`'s own multi-step flow to call the same prop once all sets are decided.
  - `saving`: boolean — disables the save control while a save is in flight.
  - This task only implements the `pontos_simples` and `melhor_3_sets` branches' *shared scaffold* plus the `pro_set_9` branch in full. Task 6 fills in the `melhor_3_sets` branch (a placeholder that renders nothing beyond a "not yet implemented" comment is NOT acceptable — see Task 6, which must land before this component is wired into `GameDetails.jsx` in Task 7; these two tasks together produce the finished component).

- [ ] **Step 1: Write the component's `pontos_simples` and `pro_set_9` branches**

```jsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { validateProSetScore, computeProSetFinalScore } from '../lib/scoringLogic'

/** Renders the score-input UI for one match, branching on the mix's
    scoring_format. pontos_simples/pro_set_9 are a single {a, b} input pair
    (the parent owns that state, same as before this component existed);
    melhor_3_sets manages its own multi-set flow internally (see the
    sibling task that adds that branch — this file is incomplete without
    it, the two land together before GameDetails.jsx is wired to use
    either). */
export default function ScoreEntry({
  match, scoringFormat, editable, teamAName, teamBName,
  initialScores, onScoreChange, onSave, saving,
}) {
  const { t } = useTranslation()

  if (scoringFormat === 'melhor_3_sets') {
    return (
      <SetsScoreEntry
        match={match}
        editable={editable}
        teamAName={teamAName}
        teamBName={teamBName}
        onSave={onSave}
        saving={saving}
      />
    )
  }

  // pontos_simples and pro_set_9 share the same single-pair input shape —
  // only validation and the optional 8-8 breaker prompt differ.
  const s = initialScores || { a: '', b: '' }
  const [breakerScore, setBreakerScore] = useState({ a: '', b: '' })
  const aNum = parseInt(s.a, 10)
  const bNum = parseInt(s.b, 10)
  const bothEntered = s.a !== '' && s.b !== '' && !Number.isNaN(aNum) && !Number.isNaN(bNum)

  let needsBreaker = false
  let readyToSave = false
  let finalScore = null

  if (scoringFormat === 'pro_set_9') {
    if (bothEntered) {
      const check = validateProSetScore(aNum, bNum)
      needsBreaker = check.needsBreaker
      if (check.valid) {
        readyToSave = true
        finalScore = { score_a: aNum, score_b: bNum }
      } else if (needsBreaker) {
        const ba = parseInt(breakerScore.a, 10)
        const bb = parseInt(breakerScore.b, 10)
        const breakerBothEntered = breakerScore.a !== '' && breakerScore.b !== '' && !Number.isNaN(ba) && !Number.isNaN(bb)
        if (breakerBothEntered && ba !== bb) {
          readyToSave = true
          finalScore = computeProSetFinalScore(aNum, bNum, { a: ba, b: bb })
        }
      }
    }
  } else {
    // pontos_simples: unchanged rule — any two non-equal non-negative ints.
    if (bothEntered && aNum !== bNum) {
      readyToSave = true
      finalScore = { score_a: aNum, score_b: bNum }
    }
  }

  // Shared read-only row (both editable and non-editable states use it for
  // a team once that team's own score isn't being typed into right now) —
  // preserves the winner highlight (lime background + 🏆) the old inline
  // teamRow() closure had, using match.winner_team_id directly since it's
  // already on the match prop.
  const readOnlyRow = (teamLabel, teamId, scoreVal) => {
    const isWinner = !!match.winner_team_id && match.winner_team_id === teamId
    return (
      <div className={`flex items-center gap-3 rounded-ctrl px-3 py-2.5 ${isWinner ? 'bg-lime-400/25' : 'bg-surface'}`}>
        <span className={`flex-1 min-w-0 text-sm font-extrabold ${
          match.winner_team_id && !isWinner ? 'text-muted' : 'text-ink-900'
        }`}>
          {teamLabel}
          {isWinner && <span className="ml-1.5 text-lime-600">🏆</span>}
        </span>
        <span className={`text-xl font-extrabold tabular-nums shrink-0 ${isWinner ? 'text-ink-900' : 'text-muted'}`}>
          {scoreVal}
        </span>
      </div>
    )
  }

  if (!editable) {
    return (
      <div className="space-y-1.5">
        {readOnlyRow(teamAName, match.team_a_id, match.score_a)}
        {readOnlyRow(teamBName, match.team_b_id, match.score_b)}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 rounded-ctrl px-3 py-2.5 bg-surface">
        <span className="flex-1 min-w-0 text-sm font-extrabold text-ink-900">{teamAName}</span>
        <input
          type="number" min="0" inputMode="numeric"
          value={s.a}
          onChange={(e) => onScoreChange(match.id, { ...s, a: e.target.value })}
          className="w-16 px-2 py-2 text-center text-lg font-extrabold rounded-ctrl border border-line bg-surface shrink-0"
          placeholder="0"
        />
      </div>
      <div className="flex items-center gap-3 rounded-ctrl px-3 py-2.5 bg-surface">
        <span className="flex-1 min-w-0 text-sm font-extrabold text-ink-900">{teamBName}</span>
        <input
          type="number" min="0" inputMode="numeric"
          value={s.b}
          onChange={(e) => onScoreChange(match.id, { ...s, b: e.target.value })}
          className="w-16 px-2 py-2 text-center text-lg font-extrabold rounded-ctrl border border-line bg-surface shrink-0"
          placeholder="0"
        />
      </div>

      {needsBreaker && (
        <div className="rounded-ctrl bg-canvas p-2.5 space-y-2">
          <p className="text-xs font-extrabold text-muted">{t('gamedetails.super_tiebreak_prompt')}</p>
          <div className="flex items-center gap-2">
            <input
              type="number" min="0" inputMode="numeric"
              value={breakerScore.a}
              onChange={(e) => setBreakerScore((prev) => ({ ...prev, a: e.target.value }))}
              className="w-16 px-2 py-2 text-center text-lg font-extrabold rounded-ctrl border border-line bg-surface"
              placeholder="0"
            />
            <span className="text-muted">–</span>
            <input
              type="number" min="0" inputMode="numeric"
              value={breakerScore.b}
              onChange={(e) => setBreakerScore((prev) => ({ ...prev, b: e.target.value }))}
              className="w-16 px-2 py-2 text-center text-lg font-extrabold rounded-ctrl border border-line bg-surface"
              placeholder="0"
            />
          </div>
        </div>
      )}

      {readyToSave && (
        <button
          onClick={() => onSave(finalScore)}
          disabled={saving}
          className="w-full py-2.5 rounded-ctrl bg-ink-900 text-lime-400 text-sm font-extrabold transition-all duration-fast active:scale-[0.98] disabled:opacity-40"
        >
          {t('gamedetails.save_score')}
        </button>
      )}
    </div>
  )
}

// Placeholder signature for Task 6 to fill in — Task 6 replaces this whole
// function body (and only this function), the pontos_simples/pro_set_9
// code above is untouched by that task.
function SetsScoreEntry({ match, editable, teamAName, teamBName, onSave, saving }) {
  return null
}
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: builds successfully (this component isn't wired into the app yet — Task 7 does that — so this only checks for syntax errors).

- [ ] **Step 3: Commit**

```bash
git add src/components/ScoreEntry.jsx
git commit -m "feat: ScoreEntry component, pontos_simples + pro_set_9 branches (Task 5)"
```

---

## Task 6: `ScoreEntry` component — melhor_3_sets branch

**Files:**
- Modify: `src/components/ScoreEntry.jsx` (replace the `SetsScoreEntry` placeholder from Task 5)

**Interfaces:**
- Consumes: `computeSetsResult` (Task 1).
- Produces: a working `SetsScoreEntry` — same `onSave({ score_a, score_b })` contract as the other two branches (Task 5), called once the match is decided (2 sets won by one side).

- [ ] **Step 1: Replace the placeholder**

Find (the entire placeholder function from Task 5):

```jsx
// Placeholder signature for Task 6 to fill in — Task 6 replaces this whole
// function body (and only this function), the pontos_simples/pro_set_9
// code above is untouched by that task.
function SetsScoreEntry({ match, editable, teamAName, teamBName, onSave, saving }) {
  return null
}
```

Replace with:

```jsx
// Collects one set at a time. sets[i] = {score_a, score_b} once entered;
// a 3rd entry (index 2) only ever appears after the first two split 1-1,
// and is a super tie-break rather than a normal set. Local-only state —
// nothing is persisted until the whole match is decided (onSave fires
// once), matching the plan's "no partial match_sets rows" design.
function SetsScoreEntry({ match, editable, teamAName, teamBName, onSave, saving }) {
  const { t } = useTranslation()
  const [sets, setSets] = useState([])
  const [current, setCurrent] = useState({ a: '', b: '' })

  const result = computeSetsResult(sets)
  const isDecider = sets.length === 2 && !result.decided // 1-1 split -> next entry is the super tie-break
  const currentSetNumber = sets.length + 1

  const aNum = parseInt(current.a, 10)
  const bNum = parseInt(current.b, 10)
  const currentValid = current.a !== '' && current.b !== '' && !Number.isNaN(aNum) && !Number.isNaN(bNum) && aNum !== bNum

  const handleAddSet = () => {
    if (!currentValid) return
    const nextSets = [...sets, { score_a: aNum, score_b: bNum, is_super_tiebreak: isDecider }]
    setSets(nextSets)
    setCurrent({ a: '', b: '' })
    const nextResult = computeSetsResult(nextSets)
    if (nextResult.decided) {
      onSave({ score_a: nextResult.setsA, score_b: nextResult.setsB, sets: nextSets })
    }
  }

  // Same read-only row shape as the pontos_simples/pro_set_9 branch above
  // (winner highlight via match.winner_team_id) — shows the sets-won
  // summary (e.g. 2-1), not a per-set breakdown; the per-set detail is
  // still in match_sets for a future history view, just not surfaced here.
  const readOnlyRow = (teamLabel, teamId, scoreVal) => {
    const isWinner = !!match.winner_team_id && match.winner_team_id === teamId
    return (
      <div className={`flex items-center gap-3 rounded-ctrl px-3 py-2.5 ${isWinner ? 'bg-lime-400/25' : 'bg-surface'}`}>
        <span className={`flex-1 min-w-0 text-sm font-extrabold ${
          match.winner_team_id && !isWinner ? 'text-muted' : 'text-ink-900'
        }`}>
          {teamLabel}
          {isWinner && <span className="ml-1.5 text-lime-600">🏆</span>}
        </span>
        <span className={`text-xl font-extrabold tabular-nums shrink-0 ${isWinner ? 'text-ink-900' : 'text-muted'}`}>
          {scoreVal}
        </span>
      </div>
    )
  }

  if (!editable) {
    return (
      <div className="space-y-1.5">
        {readOnlyRow(teamAName, match.team_a_id, match.score_a)}
        {readOnlyRow(teamBName, match.team_b_id, match.score_b)}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {sets.map((s, i) => (
        <p key={i} className="text-xs font-extrabold text-muted">
          {t('gamedetails.set_saved', { number: i + 1, a: s.score_a, b: s.score_b })}
        </p>
      ))}

      {!result.decided && (
        <>
          {isDecider && (
            <p className="text-xs font-extrabold text-muted">{t('gamedetails.super_tiebreak')}</p>
          )}
          <div className="flex items-center gap-3 rounded-ctrl px-3 py-2.5 bg-surface">
            <span className="flex-1 min-w-0 text-sm font-extrabold text-ink-900">{teamAName}</span>
            <input
              type="number" min="0" inputMode="numeric"
              value={current.a}
              onChange={(e) => setCurrent((prev) => ({ ...prev, a: e.target.value }))}
              className="w-16 px-2 py-2 text-center text-lg font-extrabold rounded-ctrl border border-line bg-surface shrink-0"
              placeholder="0"
            />
          </div>
          <div className="flex items-center gap-3 rounded-ctrl px-3 py-2.5 bg-surface">
            <span className="flex-1 min-w-0 text-sm font-extrabold text-ink-900">{teamBName}</span>
            <input
              type="number" min="0" inputMode="numeric"
              value={current.b}
              onChange={(e) => setCurrent((prev) => ({ ...prev, b: e.target.value }))}
              className="w-16 px-2 py-2 text-center text-lg font-extrabold rounded-ctrl border border-line bg-surface shrink-0"
              placeholder="0"
            />
          </div>
          {currentValid && (
            <button
              onClick={handleAddSet}
              disabled={saving}
              className="w-full py-2.5 rounded-ctrl bg-ink-900 text-lime-400 text-sm font-extrabold transition-all duration-fast active:scale-[0.98] disabled:opacity-40"
            >
              {t('gamedetails.save_set', { number: currentSetNumber })}
            </button>
          )}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add the missing import**

Find, at the top of `src/components/ScoreEntry.jsx`:

```js
import { validateProSetScore, computeProSetFinalScore } from '../lib/scoringLogic'
```

Change to:

```js
import { validateProSetScore, computeProSetFinalScore, computeSetsResult } from '../lib/scoringLogic'
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: builds successfully.

- [ ] **Step 4: Manual verification**

This component still isn't wired into the app (Task 7 does that) — verify by reading the code: trace a 2-0 finish (sets `[{6,4},{6,2}]` → `onSave` fires with `score_a:2, score_b:0`) and a 2-1 finish via decider (`[{6,4},{3,6},{10,7}]` → `onSave` fires with `score_a:2, score_b:1`, third entry has `is_super_tiebreak:true`). Note both in your report.

- [ ] **Step 5: Commit**

```bash
git add src/components/ScoreEntry.jsx
git commit -m "feat: ScoreEntry melhor_3_sets branch (Task 6)"
```

---

## Task 7: Wire `ScoreEntry` into `GameDetails.jsx`

**Files:**
- Modify: `src/pages/GameDetails.jsx`

**Interfaces:**
- Consumes: `ScoreEntry` (Tasks 5+6 combined).
- Produces: both score-entry render sites (live view ~line 2021-2101, history/finished view ~line 2186-2243) use `ScoreEntry` instead of their current inline input JSX; `handleSaveScore` persists `match_sets` rows when the mix's `scoring_format` is `melhor_3_sets`.

- [ ] **Step 1: Import `ScoreEntry`**

Add near the other component imports:

```js
import ScoreEntry from '../components/ScoreEntry'
```

- [ ] **Step 2: Generalize `handleSaveScore` to accept a precomputed final score**

Find:

```js
  const handleSaveScore = async (match) => {
    const s = scores[match.id] || {}
    const a = parseInt(s.a, 10)
    const b = parseInt(s.b, 10)
    if (Number.isNaN(a) || Number.isNaN(b) || a < 0 || b < 0) return
    if (a === b) {
      setMixError(t('gamedetails.error_no_ties'))
      return
    }
    setMixError('')
    try {
      const { error } = await supabase
        .from('matches')
        .update({
          score_a: a,
          score_b: b,
          winner_team_id: a > b ? match.team_a_id : match.team_b_id,
        })
        .eq('id', match.id)
      if (error) throw error
      setScores(prev => ({ ...prev, [match.id]: undefined }))
      setEditingMatchId(current => (current === match.id ? null : current))
      loadGameDetails()
    } catch (error) {
      console.error('Error saving score:', error)
      setMixError(t('gamedetails.error_save_score'))
    }
  }
```

Change to:

```js
  // finalScore is { score_a, score_b } for pontos_simples/pro_set_9 (from
  // ScoreEntry's own validated computation — this function no longer
  // re-derives or re-validates it), or { score_a, score_b, sets } for
  // melhor_3_sets, where `sets` is the full per-set array to persist into
  // match_sets alongside the match's own sets-won score_a/score_b.
  const handleSaveScore = async (match, finalScore) => {
    const { score_a: a, score_b: b, sets } = finalScore
    setMixError('')
    try {
      const { error } = await supabase
        .from('matches')
        .update({
          score_a: a,
          score_b: b,
          winner_team_id: a > b ? match.team_a_id : match.team_b_id,
        })
        .eq('id', match.id)
      if (error) throw error

      if (sets) {
        // Corrections re-save all sets — delete-then-insert keeps this
        // idempotent rather than needing per-set upsert logic.
        const { error: deleteError } = await supabase.from('match_sets').delete().eq('match_id', match.id)
        if (deleteError) throw deleteError
        const { error: setsError } = await supabase.from('match_sets').insert(
          sets.map((s, i) => ({
            match_id: match.id,
            set_number: i + 1,
            score_a: s.score_a,
            score_b: s.score_b,
            is_super_tiebreak: !!s.is_super_tiebreak,
          }))
        )
        if (setsError) throw setsError
      }

      setScores(prev => ({ ...prev, [match.id]: undefined }))
      setEditingMatchId(current => (current === match.id ? null : current))
      loadGameDetails()
    } catch (error) {
      console.error('Error saving score:', error)
      setMixError(t('gamedetails.error_save_score'))
    }
  }
```

Note: the old `a === b` tie rejection and `Number.isNaN`/negative checks are gone from this function — they're now `ScoreEntry`'s job (each branch only calls `onSave` once it has already validated a decided, non-tied result). This function trusts its caller, matching the plan's "ScoreEntry owns validation" boundary.

- [ ] **Step 3: Replace the live-view score-entry block**

Find (inside the `ms.map(m => { ... })` block, live view — the whole `teamRow` closure plus its two call sites plus the save/cancel button block):

```jsx
                    const isCorrecting = editingMatchId === m.id
                    const s = scores[m.id] || { a: '', b: '' }
                    const canEditScores = (isAdmin || isScorekeeper) && game.status === 'in_progress'
                    const editable = canEditScores && (!done || isCorrecting)
                    // one row per dupla — full-width names, no truncation
                    const teamRow = (teamId, scoreVal, scoreKey) => {
                      const isWinner = done && m.winner_team_id === teamId
                      return (
                        <div className={`flex items-center gap-3 rounded-ctrl px-3 py-2.5 ${
                          isWinner ? 'bg-lime-400/25' : 'bg-surface'
                        }`}>
                          <span className={`flex-1 min-w-0 text-sm font-extrabold ${
                            done && !isWinner ? 'text-muted' : 'text-ink-900'
                          }`}>
                            {teamName(teamId)}
                            {isWinner && <span className="ml-1.5 text-lime-600">🏆</span>}
                          </span>
                          {editable ? (
                            <input
                              type="number" min="0" inputMode="numeric"
                              value={s[scoreKey]}
                              onChange={e => setScores(prev => ({ ...prev, [m.id]: { ...s, [scoreKey]: e.target.value } }))}
                              className="w-16 px-2 py-2 text-center text-lg font-extrabold rounded-ctrl border border-line bg-surface shrink-0"
                              placeholder="0"
                            />
                          ) : (
                            <span className={`text-xl font-extrabold tabular-nums shrink-0 ${
                              isWinner ? 'text-ink-900' : 'text-muted'
                            }`}>
                              {scoreVal}
                            </span>
                          )}
                        </div>
                      )
                    }
                    return (
                      <div key={m.id} className="rounded-ctrl bg-canvas p-2.5">
                        <div className="flex items-center justify-between mb-2 px-1">
                          <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted">
                            {t('gamedetails.court_number', { number: m.court_number })}
                          </p>
                          {canEditScores && done && !isCorrecting && (
                            <button
                              onClick={() => startEditingScore(m)}
                              className="inline-flex items-center gap-1 text-[11px] font-extrabold text-muted hover:text-ink-900 min-h-[28px] px-1"
                            >
                              <Pencil size={12} />
                              {t('gamedetails.edit_score')}
                            </button>
                          )}
                        </div>
                        <div className="space-y-1.5">
                          {teamRow(m.team_a_id, m.score_a, 'a')}
                          {teamRow(m.team_b_id, m.score_b, 'b')}
                        </div>

                        {editable && s.a !== '' && s.b !== '' && (
                          <div className="flex gap-2 mt-2.5">
                            {isCorrecting && (
                              <button
                                onClick={() => cancelEditingScore(m.id)}
                                className="flex-1 py-2.5 rounded-ctrl bg-ink-50 text-ink-700 text-sm font-extrabold transition-all duration-fast active:scale-[0.98]"
                              >
                                {t('gamedetails.cancel')}
                              </button>
                            )}
                            <button
                              onClick={() => handleSaveScore(m)}
                              className="flex-1 py-2.5 rounded-ctrl bg-ink-900 text-lime-400 text-sm font-extrabold transition-all duration-fast active:scale-[0.98]"
                            >
                              {t('gamedetails.save_score')}
                            </button>
                          </div>
                        )}
                      </div>
                    )
```

Replace with:

```jsx
                    const isCorrecting = editingMatchId === m.id
                    const canEditScores = (isAdmin || isScorekeeper) && game.status === 'in_progress'
                    const editable = canEditScores && (!done || isCorrecting)
                    return (
                      <div key={m.id} className="rounded-ctrl bg-canvas p-2.5">
                        <div className="flex items-center justify-between mb-2 px-1">
                          <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted">
                            {t('gamedetails.court_number', { number: m.court_number })}
                          </p>
                          {canEditScores && done && !isCorrecting && (
                            <button
                              onClick={() => startEditingScore(m)}
                              className="inline-flex items-center gap-1 text-[11px] font-extrabold text-muted hover:text-ink-900 min-h-[28px] px-1"
                            >
                              <Pencil size={12} />
                              {t('gamedetails.edit_score')}
                            </button>
                          )}
                        </div>
                        <ScoreEntry
                          match={m}
                          scoringFormat={game.scoring_format || 'pontos_simples'}
                          editable={editable}
                          teamAName={teamName(m.team_a_id)}
                          teamBName={teamName(m.team_b_id)}
                          initialScores={scores[m.id] || { a: '', b: '' }}
                          onScoreChange={(matchId, next) => setScores(prev => ({ ...prev, [matchId]: next }))}
                          onSave={(finalScore) => handleSaveScore(m, finalScore)}
                          saving={false}
                        />
                        {isCorrecting && (
                          <button
                            onClick={() => cancelEditingScore(m.id)}
                            className="w-full mt-2 py-2.5 rounded-ctrl bg-ink-50 text-ink-700 text-sm font-extrabold transition-all duration-fast active:scale-[0.98]"
                          >
                            {t('gamedetails.cancel')}
                          </button>
                        )}
                      </div>
                    )
```

Note: the winner-highlight styling (`bg-lime-400/25`, 🏆) that lived in the old inline `teamRow` is preserved — `ScoreEntry`'s own non-editable branch (Tasks 5/6) reimplements it via `match.winner_team_id`, so the read-only state (`done && !isCorrecting`) looks the same as before.

- [ ] **Step 4: Replace the history/finished-view score-entry block**

Find (the second, simpler occurrence — no correcting state):

```jsx
                          {ms.map(m => {
                            const done = !!m.winner_team_id
                            const s = scores[m.id] || { a: '', b: '' }
                            const editable = !done && (isAdmin || isScorekeeper) && game.status === 'in_progress'
                            // one row per dupla — full-width names, no truncation
                            const teamRow = (teamId, scoreVal, scoreKey) => {
                              const isWinner = done && m.winner_team_id === teamId
                              return (
                                <div className={`flex items-center gap-3 rounded-ctrl px-3 py-2.5 ${
                                  isWinner ? 'bg-lime-400/25' : 'bg-surface'
                                }`}>
                                  <span className={`flex-1 min-w-0 text-sm font-extrabold ${
                                    done && !isWinner ? 'text-muted' : 'text-ink-900'
                                  }`}>
                                    {teamName(teamId)}
                                    {isWinner && <span className="ml-1.5 text-lime-600">🏆</span>}
                                  </span>
                                  {done ? (
                                    <span className={`text-xl font-extrabold tabular-nums shrink-0 ${
                                      isWinner ? 'text-ink-900' : 'text-muted'
                                    }`}>
                                      {scoreVal}
                                    </span>
                                  ) : editable ? (
                                    <input
                                      type="number" min="0" inputMode="numeric"
                                      value={s[scoreKey]}
                                      onChange={e => setScores(prev => ({ ...prev, [m.id]: { ...s, [scoreKey]: e.target.value } }))}
                                      className="w-16 px-2 py-2 text-center text-lg font-extrabold rounded-ctrl border border-line bg-surface shrink-0"
                                      placeholder="0"
                                    />
                                  ) : null}
                                </div>
                              )
                            }
                            return (
                              <div key={m.id} className="rounded-ctrl bg-canvas p-2.5">
                                <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted mb-2 px-1">
                                  {t('gamedetails.court_number', { number: m.court_number })}
                                </p>
                                <div className="space-y-1.5">
                                  {teamRow(m.team_a_id, m.score_a, 'a')}
                                  {teamRow(m.team_b_id, m.score_b, 'b')}
                                </div>

                                {editable && s.a !== '' && s.b !== '' && (
                                  <button
                                    onClick={() => handleSaveScore(m)}
                                    className="mt-2.5 w-full py-2.5 rounded-ctrl bg-ink-900 text-lime-400 text-sm font-extrabold transition-all duration-fast active:scale-[0.98]"
                                  >
                                    {t('gamedetails.save_score')}
                                  </button>
                                )}
                              </div>
                            )
                          })}
```

Replace with:

```jsx
                          {ms.map(m => {
                            const done = !!m.winner_team_id
                            const editable = !done && (isAdmin || isScorekeeper) && game.status === 'in_progress'
                            return (
                              <div key={m.id} className="rounded-ctrl bg-canvas p-2.5">
                                <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted mb-2 px-1">
                                  {t('gamedetails.court_number', { number: m.court_number })}
                                </p>
                                <ScoreEntry
                                  match={m}
                                  scoringFormat={game.scoring_format || 'pontos_simples'}
                                  editable={editable}
                                  teamAName={teamName(m.team_a_id)}
                                  teamBName={teamName(m.team_b_id)}
                                  initialScores={scores[m.id] || { a: '', b: '' }}
                                  onScoreChange={(matchId, next) => setScores(prev => ({ ...prev, [matchId]: next }))}
                                  onSave={(finalScore) => handleSaveScore(m, finalScore)}
                                  saving={false}
                                />
                              </div>
                            )
                          })}
```

- [ ] **Step 5: Verify the build**

Run: `npm run build`
Expected: builds successfully.

- [ ] **Step 6: Manual verification**

Requires Task 2's migration to have been run (ask the user to confirm, don't assume). In the dev server: create a mix with `scoring_format = 'pro_set_9'`, confirm entering `8-8` prompts a super tie-break and the saved result is `9-8`/`8-9`; create one with `melhor_3_sets`, confirm entering 2 sets that split 1-1 prompts a 3rd super-tie-break entry, and the match's `score_a`/`score_b` end up as sets won (e.g. `2-1`) with 3 rows in `match_sets`. Confirm a `pontos_simples` mix still behaves exactly as before (regression check — this task touched its render path even though its logic didn't change).

- [ ] **Step 7: Commit**

```bash
git add src/pages/GameDetails.jsx
git commit -m "feat: wire ScoreEntry into GameDetails.jsx for all scoring formats (Task 7)"
```
