# Recurring mixes: pending-state rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the "launch date" field being permanently hidden after a recurrence goes active, switch it to a relative "days before + time" input, and rework recurring mixes so the next occurrence is pre-created as a `pending` row the moment the current one launches — visible/editable to admins, invisible to players until it launches.

**Architecture:** One SQL migration adds `games.launch_at`, backfills a `pending` row for every currently-active recurrence, drops the now-unused `game_recurrences.next_run_at`, and replaces `process_due_game_recurrences()` so it launches the due `pending` mix and immediately pre-creates the one after that (instead of creating a mix from scratch when its time arrives). `src/pages/Admin.jsx` gets the bug fix, the new relative-offset input, and pre-creates the first `pending` occurrence when a recurrence starts. `src/pages/Home.jsx` and `src/pages/Rankings.jsx` exclude `pending` mixes from every player-facing list. The WhatsApp bot needs no changes — verified it already ignores non-`open` inserts and only rosters `open`/`closed` mixes.

**Tech Stack:** React (Vite SPA), Supabase (Postgres + RLS + RPCs + pg_cron).

## Global Constraints

- No automated test framework — verification is manual: SQL run/checked in the Supabase SQL Editor, and the frontend checked via `npm run build` plus a manual walkthrough where a live session is available. This matches every existing migration and the project's established convention.
- New SQL goes in one new file, `supabase/migration_recurring_mixes_pending_state.sql`, run manually via Supabase → SQL Editor → New query → Run.
- Unlike the multi-tenant plan (which left `supabase/schema.sql` unsynced, matching *its* recent precedent), **this feature's own precedent syncs `schema.sql`** — the original `migration_recurring_mixes.sql` was fully reflected there. Apply the same schema/function changes to `supabase/schema.sql` as part of Task 1, to keep that precedent intact for this specific feature.
- European Portuguese for all user-facing copy.
- Follow existing code style in every file touched (Tailwind utility classes already used in the same file, existing comment density/tone).

---

## Task 1: Database migration — `launch_at`, backfill, cron rewrite

**Files:**
- Create: `supabase/migration_recurring_mixes_pending_state.sql`
- Modify: `supabase/schema.sql` (apply the same DDL/function changes — `games.launch_at` column, `game_recurrences.next_run_at` removed, `process_due_game_recurrences()` replaced with the new body; no backfill needed here, since `schema.sql` describes a fresh install, not a live upgrade)

**Interfaces:**
- Produces: `games.launch_at TIMESTAMPTZ` (nullable; meaningful only while `status = 'pending'`); `games.status` gains the value `'pending'` (no CHECK constraint exists, so no schema change needed for the value itself); `game_recurrences` no longer has `next_run_at`.

- [ ] **Step 1: Write the migration file**

```sql
-- ════════════════════════════════════════════════════════════════════════
-- Migration: recurring mixes rework — pre-create the next occurrence as
-- 'pending' the moment the current one launches, instead of creating it
-- (and launching it, same instant) only when its scheduled time arrives.
-- See docs/superpowers/specs/2026-08-18-recurring-mixes-pending-state-design.md
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. games gains launch_at — only meaningful while status = 'pending' ──
ALTER TABLE games ADD COLUMN launch_at TIMESTAMPTZ;

-- ── 2. One-time backfill: give every currently-active recurrence its
--       first `pending` occurrence right now, using its existing
--       next_run_at as that row's launch_at — otherwise it would never
--       produce another mix once the old time-based creation is replaced. ─
INSERT INTO games (
  organization_id, title, date, location, price_per_player, prize,
  num_courts, max_players, court_time_minutes, game_time_minutes, format,
  status, created_by, recurrence_id, is_recurrence_origin, launch_at
)
SELECT
  rec.organization_id, rec.title,
  rec.next_run_at + make_interval(secs => rec.mix_offset_seconds),
  rec.location, rec.price_per_player, rec.prize,
  rec.num_courts, rec.num_courts * 4, rec.court_time_minutes, rec.game_time_minutes, rec.format,
  'pending', rec.created_by, rec.id, false, rec.next_run_at
FROM game_recurrences rec
WHERE rec.is_active = true
ON CONFLICT (recurrence_id, date) WHERE recurrence_id IS NOT NULL DO NOTHING;

-- ── 3. next_run_at is obsolete — every pending row now carries its own
--       launch_at instead of one shared "next creation time" ────────────
ALTER TABLE game_recurrences DROP COLUMN next_run_at;

-- ── 4. Replace the cron function: launch the due pending mix, then
--       pre-create the one after it (instead of creating-and-launching a
--       mix in one step when its schedule fires). ────────────────────────
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
    UPDATE games SET status = 'open', updated_at = now() WHERE id = rec.pending_game_id;

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

REVOKE ALL ON FUNCTION process_due_game_recurrences() FROM public;
```

(No change needed to the existing `SELECT cron.schedule('process-game-recurrences', '*/5 * * * *', $$SELECT process_due_game_recurrences()$$);` — it calls the function by name, and `CREATE OR REPLACE FUNCTION` with the same signature is picked up automatically.)

- [ ] **Step 2: Run the migration**

Supabase → SQL Editor → New query → paste the entire file → Run. Confirm it completes with no errors.

- [ ] **Step 3: Verify with manual SQL checks**

```sql
-- A) launch_at exists, next_run_at is gone
SELECT column_name FROM information_schema.columns WHERE table_name = 'games' AND column_name = 'launch_at';
SELECT column_name FROM information_schema.columns WHERE table_name = 'game_recurrences' AND column_name = 'next_run_at';
-- expect: first query returns one row, second returns zero rows

-- B) if any recurrence was active before this migration, confirm it now
-- has exactly one pending occurrence
SELECT gr.id, count(g.id) AS pending_count
FROM game_recurrences gr
LEFT JOIN games g ON g.recurrence_id = gr.id AND g.status = 'pending'
WHERE gr.is_active = true
GROUP BY gr.id;
-- expect: pending_count = 1 for every row

-- C) manually force a launch and confirm the chain: pick a pending game's
-- id from (B) above, then:
UPDATE games SET launch_at = now() - interval '1 minute' WHERE id = '<pending-game-id>';
SELECT process_due_game_recurrences();
SELECT id, status, date, launch_at FROM games WHERE id = '<pending-game-id>';
-- expect: status = 'open'
SELECT id, status, date, launch_at FROM games WHERE recurrence_id = (SELECT recurrence_id FROM games WHERE id = '<pending-game-id>') AND status = 'pending';
-- expect: exactly one row, a fresh pending occurrence one frequency step later
```

- [ ] **Step 4: Apply the same changes to `supabase/schema.sql`**

In `supabase/schema.sql`:
- Add `launch_at TIMESTAMPTZ,` to the `games` table's `CREATE TABLE` (any position after `winner_team_id` is fine — match the file's existing column grouping style).
- Remove the `next_run_at TIMESTAMPTZ NOT NULL,` line from the `game_recurrences` table's `CREATE TABLE`.
- Replace the existing `process_due_game_recurrences()` function body with the new one from Step 1 (the schema file describes a fresh install, so no backfill INSERT belongs here — only the table/column changes and the new function).

- [ ] **Step 5: Commit**

```bash
git add supabase/migration_recurring_mixes_pending_state.sql supabase/schema.sql
git commit -m "feat: pre-create recurring mixes as pending, launch on schedule"
```

---

## Task 2: Admin.jsx — fix the bug, relative offset input, pre-create pending occurrences

**Files:**
- Modify: `src/pages/Admin.jsx`

**Interfaces:**
- Consumes: `games.launch_at`, `game_recurrences.mix_offset_seconds` (unchanged meaning), `'pending'` as a `games.status` value (Task 1).

- [ ] **Step 1: Replace `EMPTY_RECURRENCE`, and fix the now-stale comment above `recurrenceSnapshotAndRule`**

Change:
```js
const EMPTY_RECURRENCE = {
  enabled: false,
  frequency: 'weekly',
  endsType: 'never',
  endsOn: '',
  endsAfterOccurrences: '',
  nextRunAt: '',
}
```
to:
```js
const EMPTY_RECURRENCE = {
  enabled: false,
  frequency: 'weekly',
  endsType: 'never',
  endsOn: '',
  endsAfterOccurrences: '',
  launchDaysBefore: '',
  launchTime: '09:00',
}
```

Also, the comment directly above `recurrenceSnapshotAndRule` is now inaccurate — it claims `mix_offset_seconds`/`next_run_at` "must never be recomputed on an edit of the origin Mix, or the schedule corrupts," but Steps 4-5 below deliberately do recompute and persist `mix_offset_seconds` on every create/update, that being the whole point of making the launch fields editable. Change:
```js
  // Fields shared between creating and updating a game_recurrences row —
  // the rule itself plus the snapshot of settings future Mixes will copy.
  // Deliberately excludes mix_offset_seconds/next_run_at: those are set
  // once at creation time (see createRecurrence) and must never be
  // recomputed on an edit of the origin Mix, or the schedule corrupts.
  const recurrenceSnapshotAndRule = (game, recurrence) => ({
```
to:
```js
  // Fields shared between creating and updating a game_recurrences row —
  // the rule itself plus the snapshot of settings future Mixes will copy.
  // Excludes mix_offset_seconds: createRecurrence/updateRecurrence compute
  // and attach it separately (see computeLaunchOffsetSeconds below), since
  // it depends on the launch-fields input, not on the snapshot/rule fields.
  const recurrenceSnapshotAndRule = (game, recurrence) => ({
```

- [ ] **Step 2: Fix `advanceByFrequency`'s stale comment, and add offset-conversion helpers next to it**

The comment above `advanceByFrequency` is also now inaccurate — it references the removed "criar automaticamente em" field and a "seed next_run_at one step ahead" rationale that no longer applies (there is no `next_run_at` anymore). The function itself is still used correctly (advance a date by one frequency step), just for a different purpose now. Change:
```js
  // Mirrors the cron function's own step (see process_due_game_recurrences
  // in supabase/schema.sql) — by construction, offset = (mix date) -
  // (entered "criar automaticamente em"), so the first tick from the
  // entered value would always land exactly on the origin Mix's own date.
  // Seeding next_run_at one step ahead skips that guaranteed no-op tick.
  const advanceByFrequency = (date, frequency) => {
```
to:
```js
  // Computes the date one frequency step after `date` — used to pre-create
  // the first pending occurrence when a recurrence starts (createRecurrence
  // below), mirroring what process_due_game_recurrences (supabase/schema.sql)
  // does for every occurrence after that.
  const advanceByFrequency = (date, frequency) => {
```

Right after the existing `advanceByFrequency` function, add:

```js
  // Converts the "N dias antes, às HH:MM" input into the same
  // mix_offset_seconds shape the rest of the system (and the cron
  // function) already works with: seconds between the mix's own
  // date/time and the computed launch date/time.
  const computeLaunchOffsetSeconds = (mixDateStr, daysBefore, launchTime) => {
    const mixDate = new Date(mixDateStr)
    const launchDate = new Date(mixDate)
    launchDate.setDate(launchDate.getDate() - parseInt(daysBefore, 10))
    const [hh, mm] = launchTime.split(':').map(Number)
    launchDate.setHours(hh, mm, 0, 0)
    return Math.round((mixDate.getTime() - launchDate.getTime()) / 1000)
  }

  // Inverse of computeLaunchOffsetSeconds — used to populate the edit form
  // from a stored mix_offset_seconds value.
  const deriveLaunchFields = (mixDateStr, mixOffsetSeconds) => {
    const mixDate = new Date(mixDateStr)
    const launchDate = new Date(mixDate.getTime() - mixOffsetSeconds * 1000)
    const mixMidnight = new Date(mixDate.getFullYear(), mixDate.getMonth(), mixDate.getDate())
    const launchMidnight = new Date(launchDate.getFullYear(), launchDate.getMonth(), launchDate.getDate())
    const daysBefore = Math.round((mixMidnight.getTime() - launchMidnight.getTime()) / 86400000)
    const launchTime = `${String(launchDate.getHours()).padStart(2, '0')}:${String(launchDate.getMinutes()).padStart(2, '0')}`
    return { daysBefore, launchTime }
  }
```

- [ ] **Step 3: Simplify `validateRecurrence`**

Change:
```js
  const validateRecurrence = (recurrence, mixDateStr, checkNextRunAt = true) => {
    if (!recurrence.enabled) return null
    if (checkNextRunAt) {
      if (!recurrence.nextRunAt) return 'Escolhe a data e hora em que o próximo Mix deve ser criado automaticamente'
      if (new Date(recurrence.nextRunAt).getTime() >= new Date(mixDateStr).getTime()) {
        return 'A data de "criar automaticamente em" tem de ser antes da data e hora do Mix'
      }
    }
    if (recurrence.endsType === 'on_date' && !recurrence.endsOn) return 'Escolhe a data em que a recorrência termina'
    if (recurrence.endsType === 'after_occurrences' && (!recurrence.endsAfterOccurrences || parseInt(recurrence.endsAfterOccurrences, 10) < 1)) {
      return 'Indica um número de ocorrências válido'
    }
    return null
  }
```
to:
```js
  const validateRecurrence = (recurrence) => {
    if (!recurrence.enabled) return null
    if (!recurrence.launchDaysBefore || parseInt(recurrence.launchDaysBefore, 10) < 1) {
      return 'Indica quantos dias antes o mix deve ser lançado'
    }
    if (!recurrence.launchTime) return 'Escolhe a que horas o mix deve ser lançado'
    if (recurrence.endsType === 'on_date' && !recurrence.endsOn) return 'Escolhe a data em que a recorrência termina'
    if (recurrence.endsType === 'after_occurrences' && (!recurrence.endsAfterOccurrences || parseInt(recurrence.endsAfterOccurrences, 10) < 1)) {
      return 'Indica um número de ocorrências válido'
    }
    return null
  }
```
(The field is now always shown whenever recurrence is enabled, so the conditional "only validate if the field was visible" parameter is no longer needed — always validate it. The mix-date-ordering check is also no longer needed: a positive whole number of days before is inherently before the mix's own date/time.)

Update both call sites:
- In `handleCreateGame`, change `validateRecurrence(recurrence, gameForm.date)` to `validateRecurrence(recurrence)`.
- In `handleUpdateGame`, change `validateRecurrence(recurrence, gameForm.date, !hadActiveRecurrence)` to `validateRecurrence(recurrence)`.

- [ ] **Step 4: Rewrite `createRecurrence` to also pre-create the first pending occurrence**

Replace:
```js
  const createRecurrence = async (game, recurrence, userId) => {
    const { data: newRecurrence, error: recurrenceError } = await supabase
      .from('game_recurrences')
      .insert([{
        ...recurrenceSnapshotAndRule(game, recurrence),
        mix_offset_seconds: Math.round(
          (new Date(game.date).getTime() - new Date(recurrence.nextRunAt).getTime()) / 1000
        ),
        next_run_at: advanceByFrequency(new Date(recurrence.nextRunAt), recurrence.frequency).toISOString(),
        organization_id: currentOrganizationId,
        created_by: userId,
      }])
      .select()
      .single()

    if (recurrenceError) {
      console.error('Error creating recurrence:', recurrenceError)
      alert('O Mix foi criado, mas não foi possível ativar a recorrência: ' + recurrenceError.message)
      return
    }

    const { error: linkError } = await supabase
      .from('games')
      .update({ recurrence_id: newRecurrence.id, is_recurrence_origin: true })
      .eq('id', game.id)

    if (linkError) {
      console.error('Error linking game to recurrence:', linkError)
      alert('O Mix foi criado, mas não foi possível ligá-lo à recorrência: ' + linkError.message)
    }
  }
```
with:
```js
  const createRecurrence = async (game, recurrence, userId) => {
    const mixOffsetSeconds = computeLaunchOffsetSeconds(game.date, recurrence.launchDaysBefore, recurrence.launchTime)

    const { data: newRecurrence, error: recurrenceError } = await supabase
      .from('game_recurrences')
      .insert([{
        ...recurrenceSnapshotAndRule(game, recurrence),
        mix_offset_seconds: mixOffsetSeconds,
        organization_id: currentOrganizationId,
        created_by: userId,
      }])
      .select()
      .single()

    if (recurrenceError) {
      console.error('Error creating recurrence:', recurrenceError)
      alert('O Mix foi criado, mas não foi possível ativar a recorrência: ' + recurrenceError.message)
      return
    }

    const { error: linkError } = await supabase
      .from('games')
      .update({ recurrence_id: newRecurrence.id, is_recurrence_origin: true })
      .eq('id', game.id)

    if (linkError) {
      console.error('Error linking game to recurrence:', linkError)
      alert('O Mix foi criado, mas não foi possível ligá-lo à recorrência: ' + linkError.message)
      return
    }

    // Pre-create the next occurrence as `pending`, same as the cron will
    // do for every occurrence after this one — under the old model this
    // was left for the cron to create later; now it must exist immediately.
    const nextDate = advanceByFrequency(new Date(game.date), recurrence.frequency)
    const { error: pendingError } = await supabase
      .from('games')
      .insert([{
        organization_id: currentOrganizationId,
        title: game.title,
        date: nextDate.toISOString(),
        location: game.location,
        price_per_player: game.price_per_player,
        prize: game.prize,
        num_courts: game.num_courts,
        max_players: (game.num_courts || 1) * 4,
        court_time_minutes: game.court_time_minutes,
        game_time_minutes: game.game_time_minutes,
        format: game.format,
        status: 'pending',
        created_by: userId,
        recurrence_id: newRecurrence.id,
        is_recurrence_origin: false,
        launch_at: new Date(nextDate.getTime() - mixOffsetSeconds * 1000).toISOString(),
      }])

    if (pendingError) {
      console.error('Error pre-creating next occurrence:', pendingError)
      alert('O Mix e a recorrência foram criados, mas não foi possível pré-criar o próximo Mix: ' + pendingError.message)
    }
  }
```

- [ ] **Step 5: Rewrite `updateRecurrence` to also keep the pending occurrence's launch time in sync**

Replace:
```js
  const updateRecurrence = async (recurrenceId, game, recurrence) => {
    const { error } = await supabase
      .from('game_recurrences')
      .update({
        ...recurrenceSnapshotAndRule(game, recurrence),
        updated_at: new Date().toISOString(),
      })
      .eq('id', recurrenceId)

    if (error) {
      console.error('Error updating recurrence:', error)
      alert('O Mix foi atualizado, mas não foi possível atualizar a recorrência: ' + error.message)
    }
  }
```
with:
```js
  const updateRecurrence = async (recurrenceId, game, recurrence) => {
    const mixOffsetSeconds = computeLaunchOffsetSeconds(game.date, recurrence.launchDaysBefore, recurrence.launchTime)

    const { error } = await supabase
      .from('game_recurrences')
      .update({
        ...recurrenceSnapshotAndRule(game, recurrence),
        mix_offset_seconds: mixOffsetSeconds,
        updated_at: new Date().toISOString(),
      })
      .eq('id', recurrenceId)

    if (error) {
      console.error('Error updating recurrence:', error)
      alert('O Mix foi atualizado, mas não foi possível atualizar a recorrência: ' + error.message)
      return
    }

    // Keep the already pre-created pending occurrence's launch time in sync
    // — otherwise changing "quantos dias antes" here would only take
    // effect two cycles from now instead of the very next one.
    const { data: pendingGame, error: pendingFetchError } = await supabase
      .from('games')
      .select('id, date')
      .eq('recurrence_id', recurrenceId)
      .eq('status', 'pending')
      .maybeSingle()

    if (pendingFetchError) {
      console.error('Error finding pending occurrence:', pendingFetchError)
      return
    }
    if (!pendingGame) return

    const { error: launchUpdateError } = await supabase
      .from('games')
      .update({ launch_at: new Date(new Date(pendingGame.date).getTime() - mixOffsetSeconds * 1000).toISOString() })
      .eq('id', pendingGame.id)

    if (launchUpdateError) {
      console.error('Error updating pending occurrence launch time:', launchUpdateError)
      alert('A recorrência foi atualizada, mas não foi possível atualizar a hora de lançamento do próximo Mix: ' + launchUpdateError.message)
    }
  }
```

- [ ] **Step 6: Update `loadGames`'s select to fetch `mix_offset_seconds` instead of `next_run_at`**

Change:
```js
          recurrence:game_recurrences (
            id,
            is_active,
            frequency,
            ends_type,
            ends_on,
            ends_after_occurrences,
            next_run_at
          )
```
to:
```js
          recurrence:game_recurrences (
            id,
            is_active,
            frequency,
            ends_type,
            ends_on,
            ends_after_occurrences,
            mix_offset_seconds
          )
```

- [ ] **Step 7: Update `startEditGame` to derive the new fields**

Change:
```js
  const startEditGame = (game) => {
    setEditingGame(game)
    const hasActiveRecurrence = game.is_recurrence_origin && game.recurrence?.is_active
    setGameForm({
      title: game.title,
      date: toLocalInput(game.date),
      location: game.location || '',
      price_per_player: game.price_per_player ?? '',
      prize: game.prize || '',
      num_courts: game.num_courts || 1,
      court_time_minutes: game.court_time_minutes || 90,
      game_time_minutes: game.game_time_minutes || 20,
      format: game.format || 'sobe_desce',
      recurrence: hasActiveRecurrence
        ? {
            enabled: true,
            frequency: game.recurrence.frequency,
            endsType: game.recurrence.ends_type,
            endsOn: game.recurrence.ends_on ? toLocalInput(game.recurrence.ends_on).slice(0, 10) : '',
            endsAfterOccurrences: game.recurrence.ends_after_occurrences ?? '',
            nextRunAt: toLocalInput(game.recurrence.next_run_at),
          }
        : EMPTY_RECURRENCE,
    })
  }
```
to:
```js
  const startEditGame = (game) => {
    setEditingGame(game)
    const hasActiveRecurrence = game.is_recurrence_origin && game.recurrence?.is_active
    const launchFields = hasActiveRecurrence
      ? deriveLaunchFields(game.date, game.recurrence.mix_offset_seconds)
      : null
    setGameForm({
      title: game.title,
      date: toLocalInput(game.date),
      location: game.location || '',
      price_per_player: game.price_per_player ?? '',
      prize: game.prize || '',
      num_courts: game.num_courts || 1,
      court_time_minutes: game.court_time_minutes || 90,
      game_time_minutes: game.game_time_minutes || 20,
      format: game.format || 'sobe_desce',
      recurrence: hasActiveRecurrence
        ? {
            enabled: true,
            frequency: game.recurrence.frequency,
            endsType: game.recurrence.ends_type,
            endsOn: game.recurrence.ends_on ? toLocalInput(game.recurrence.ends_on).slice(0, 10) : '',
            endsAfterOccurrences: game.recurrence.ends_after_occurrences ?? '',
            launchDaysBefore: String(launchFields.daysBefore),
            launchTime: launchFields.launchTime,
          }
        : EMPTY_RECURRENCE,
    })
  }
```

- [ ] **Step 8: Replace the launch-date form field, and stop hiding it**

Find:
```jsx
                            {!(editingGame && editingGame.is_recurrence_origin && editingGame.recurrence?.is_active) && (
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                  Criar automaticamente em
                                </label>
                                <DateTimeField
                                  value={gameForm.recurrence.nextRunAt}
                                  onChange={(v) => setGameForm({
                                    ...gameForm,
                                    recurrence: { ...gameForm.recurrence, nextRunAt: v }
                                  })}
                                  required
                                />
                                <p className="text-sm text-muted mt-1.5">
                                  Tem de ser antes da data deste Mix — a mesma distância no tempo é usada para criar cada Mix futuro (ex.: 3 dias antes → cada novo Mix é criado 3 dias antes de acontecer).
                                </p>
                              </div>
                            )}
```
replace with (no longer conditionally hidden — always rendered whenever the enclosing `{gameForm.recurrence.enabled && (...)}` block is showing):
```jsx
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                Lançar quantos dias antes
                              </label>
                              <input
                                type="number"
                                min="1"
                                value={gameForm.recurrence.launchDaysBefore}
                                onChange={(e) => setGameForm({
                                  ...gameForm,
                                  recurrence: { ...gameForm.recurrence, launchDaysBefore: e.target.value }
                                })}
                                className="input-field"
                                placeholder="ex: 3"
                                required
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                A que horas
                              </label>
                              <input
                                type="time"
                                value={gameForm.recurrence.launchTime}
                                onChange={(e) => setGameForm({
                                  ...gameForm,
                                  recurrence: { ...gameForm.recurrence, launchTime: e.target.value }
                                })}
                                className="input-field"
                                required
                              />
                              <p className="text-sm text-muted mt-1.5">
                                O próximo Mix fica visível e disponível para inscrições nesta altura — a mesma distância é reaplicada em cada Mix seguinte.
                              </p>
                            </div>
```

- [ ] **Step 9: Add a "Pendente" status badge**

Find:
```jsx
                      <div className={`inline-block px-4 py-2 rounded-xl font-medium ${
                        game.status === 'open' ? 'bg-blue-100 text-blue-700' :
                        game.status === 'closed' ? 'bg-green-100 text-green-700' :
                        game.status === 'in_progress' ? 'bg-lime-400 text-ink-900' :
                        game.status === 'completed' || game.status === 'finished' ? 'bg-gray-100 text-gray-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {game.status === 'open' && 'Aberto'}
                        {game.status === 'closed' && 'Mix fechado — campo reservado'}
                        {game.status === 'in_progress' && 'A decorrer'}
                        {(game.status === 'completed' || game.status === 'finished') && 'Terminado'}
                        {game.status === 'cancelled' && 'Cancelado'}
                      </div>
```
replace with:
```jsx
                      <div className={`inline-block px-4 py-2 rounded-xl font-medium ${
                        game.status === 'open' ? 'bg-blue-100 text-blue-700' :
                        game.status === 'closed' ? 'bg-green-100 text-green-700' :
                        game.status === 'in_progress' ? 'bg-lime-400 text-ink-900' :
                        game.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                        game.status === 'completed' || game.status === 'finished' ? 'bg-gray-100 text-gray-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {game.status === 'open' && 'Aberto'}
                        {game.status === 'closed' && 'Mix fechado — campo reservado'}
                        {game.status === 'in_progress' && 'A decorrer'}
                        {game.status === 'pending' && 'Pendente — ainda não foi lançado'}
                        {(game.status === 'completed' || game.status === 'finished') && 'Terminado'}
                        {game.status === 'cancelled' && 'Cancelado'}
                      </div>
```

- [ ] **Step 10: Verify**

Run `npm run build` from the repo root and confirm it completes with no errors. If a live Supabase session is available: enable "Mix recorrente" on a plain existing mix for the first time, confirm the "quantos dias antes / a que horas" fields appear and save correctly (check `game_recurrences.mix_offset_seconds` and the new `pending` row's `launch_at` in Supabase); edit the origin again and confirm the fields are pre-filled and stay visible; confirm the Jogos list shows the pending occurrence with the amber "Pendente" badge and that it's editable/deletable.

- [ ] **Step 11: Commit**

```bash
git add src/pages/Admin.jsx
git commit -m "fix: always show recurring-mix launch fields, switch to relative days-before input, pre-create pending occurrences"
```

---

## Task 3: Home.jsx and Rankings.jsx — hide pending mixes from players

**Files:**
- Modify: `src/pages/Home.jsx:121`
- Modify: `src/pages/Rankings.jsx:144`

**Interfaces:**
- Consumes: `'pending'` as a `games.status` value (Task 1).

- [ ] **Step 1: Home.jsx**

Change:
```js
        .filter((game) => game.status !== 'cancelled')
```
to:
```js
        .filter((game) => game.status !== 'cancelled' && game.status !== 'pending')
```

- [ ] **Step 2: Rankings.jsx**

Change:
```js
          .eq('organization_id', currentOrganizationId)
          .neq('status', 'cancelled')
          .order('date', { ascending: false }),
```
to:
```js
          .eq('organization_id', currentOrganizationId)
          .neq('status', 'cancelled')
          .neq('status', 'pending')
          .order('date', { ascending: false }),
```

- [ ] **Step 3: Verify**

Run `npm run build` from the repo root and confirm it completes with no errors. If a live session is available: confirm a `pending` mix (created in Task 2's verification) does not appear in Home.jsx's "Mixs Ativos" tab nor in Rankings.jsx's "Mixes" tab, for a plain (non-admin) player account.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Home.jsx src/pages/Rankings.jsx
git commit -m "fix: hide pending recurring mixes from player-facing views"
```

---

## Known limitation (not addressed by this plan)

If an admin deletes a `pending` occurrence directly (instead of stopping the recurrence via "Parar recorrência"), the recurrence stalls permanently — nothing re-creates a replacement `pending` row, since the cron only acts on an existing `pending` row's `launch_at`. This matches the existing "Parar recorrência" button's intended use (stopping is deliberate, via that button, not via deleting the pending row) and wasn't part of the request; flagging it here rather than adding recovery logic that wasn't asked for.

## Follow-up (tracked separately)

`worktree-multi-tenant-player-backoffice-split` (not yet pushed) contains `src/pages/GerirClube.jsx`, copied from `Admin.jsx` before this fix existed. Porting these same changes into `GerirClube.jsx` before/when that branch is pushed is already tracked as part of the "push the worktree" reminder — no action needed here.
