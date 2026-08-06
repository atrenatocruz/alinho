# Mixes Recorrentes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an organizer configure a Mix to be automatically re-created on a recurring schedule (daily/weekly/monthly/yearly), copying its settings but never its participants, via a background job that runs independently of the app being online.

**Architecture:** A new `game_recurrences` table stores the recurrence rule plus a snapshot of the Mix's copyable settings. `games` gains `recurrence_id` (FK) and `is_recurrence_origin` (marks the Mix whose edits update the snapshot). A `pg_cron` job, scheduled every 5 minutes, calls a `SECURITY DEFINER` SQL function that creates due Mixes directly in Postgres — no dependency on the Vercel SPA or the WhatsApp bot process being up. The Admin UI adds a recurrence block to the create/edit Mix form (visible when creating fresh, or editing the origin of an active recurrence), plus a "Recorrente" badge and "Parar recorrência" action on generated instances in the Mixes list.

**Tech Stack:** React 18 + Vite, Tailwind CSS, `lucide-react` icons, `@supabase/supabase-js` (pages call `supabase.from(...)` directly, no ORM), plain `useState` form objects. PostgreSQL via Supabase, `pg_cron` extension for scheduling. No test framework is configured in this repo — verification steps use manual dev-server checks and Supabase SQL Editor / Table Editor inspection instead of automated tests.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-08-06-recurring-mixes-design.md` — follow it exactly.
- Migrations in this repo are plain `.sql` files run manually via Supabase → SQL Editor (no Supabase CLI migration folder). New migration file: `supabase/migration_recurring_mixes.sql`, following the header/comment style of `supabase/migration_price_prize.sql`.
- `supabase/schema.sql` must also be updated to stay the authoritative full-schema reference (this repo keeps both the incremental migration file and the full schema in sync).
- No test framework exists — do not add one. Verify SQL changes via the Supabase SQL Editor / Table Editor, and UI changes by running `npm run dev` and checking the page in a browser.
- Out of scope (per spec): reactivating a deactivated recurrence, editing a recurrence from a non-origin instance, showing recurrence info outside the Admin panel (e.g. `GameDetails.jsx`, the WhatsApp roster message).
- The recurrence's `mix_offset_seconds` is computed once, in JS, as `(mix date) − (auto-create date)`, in seconds — never recomputed later. The cron function must use `make_interval(secs => ...)`, not string concatenation, to turn it back into an interval.

---

### Task 1: Database migration — `game_recurrences` table + cron job

**Files:**
- Create: `supabase/migration_recurring_mixes.sql`
- Modify: `supabase/schema.sql:6` (extensions), `supabase/schema.sql:52-70` (the `games` table definition), `supabase/schema.sql` RLS section (after the existing `games` policies, currently ending around line 274), end of file (currently ending at line 779)

**Interfaces:**
- Produces: table `game_recurrences` (columns: `id, organization_id, is_active, frequency, ends_type, ends_on, ends_after_occurrences, occurrences_created, mix_offset_seconds, next_run_at, title, location, price_per_player, prize, num_courts, court_time_minutes, game_time_minutes, format, created_by, created_at, updated_at`); `games.recurrence_id` (UUID, nullable FK to `game_recurrences.id`); `games.is_recurrence_origin` (boolean, default false); unique index `games_recurrence_date_key` on `games(recurrence_id, date)`; function `process_due_game_recurrences()`; scheduled cron job named `process-game-recurrences`. All consumed by Tasks 2-4 (frontend) and exercised end-to-end in Task 5.

- [ ] **Step 1: Write the migration file**

Create `supabase/migration_recurring_mixes.sql`:

```sql
-- ════════════════════════════════════════════════════════════════════════
-- Migration: Mixes recorrentes (recurring Mixes)
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- Requires the pg_cron extension. If "CREATE EXTENSION" below errors with
-- a permission error, enable it first via Dashboard → Database →
-- Extensions → search "pg_cron" → Enable, then re-run this file.
-- ════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

-- ── game_recurrences: the recurrence rule + a snapshot of the settings ──
-- copied into every auto-created Mix. The Mix that owns this row
-- (games.is_recurrence_origin = true) is the only one whose edits update
-- this snapshot — already-created Mixes are never rewritten.
CREATE TABLE game_recurrences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'yearly')),
  ends_type TEXT NOT NULL CHECK (ends_type IN ('never', 'on_date', 'after_occurrences')),
  ends_on TIMESTAMPTZ,
  ends_after_occurrences INTEGER,
  occurrences_created INTEGER NOT NULL DEFAULT 1, -- the original Mix counts as occurrence 1
  mix_offset_seconds INTEGER NOT NULL, -- (mix date) - (auto-create date), fixed at creation time
  next_run_at TIMESTAMPTZ NOT NULL,
  title TEXT NOT NULL,
  location TEXT,
  price_per_player NUMERIC(6,2),
  prize TEXT,
  num_courts INTEGER NOT NULL,
  court_time_minutes INTEGER NOT NULL,
  game_time_minutes INTEGER NOT NULL,
  format TEXT NOT NULL,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

ALTER TABLE games ADD COLUMN IF NOT EXISTS recurrence_id UUID REFERENCES game_recurrences(id);
ALTER TABLE games ADD COLUMN IF NOT EXISTS is_recurrence_origin BOOLEAN NOT NULL DEFAULT false;

-- Idempotency backstop: the same recurrence can never produce two Mixes on
-- the same date, even if the cron job somehow runs twice concurrently.
CREATE UNIQUE INDEX IF NOT EXISTS games_recurrence_date_key
  ON games(recurrence_id, date) WHERE recurrence_id IS NOT NULL;

ALTER TABLE game_recurrences ENABLE ROW LEVEL SECURITY;

-- Mirrors the games RLS policies: members can view, only org admins manage.
CREATE POLICY "Org members can view game recurrences"
  ON game_recurrences FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM memberships
    WHERE memberships.organization_id = game_recurrences.organization_id AND memberships.user_id = auth.uid()
  ));

CREATE POLICY "Org admins can create game recurrences"
  ON game_recurrences FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM memberships
    WHERE memberships.organization_id = game_recurrences.organization_id
      AND memberships.user_id = auth.uid() AND memberships.is_admin
  ));

CREATE POLICY "Org admins can update game recurrences"
  ON game_recurrences FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM memberships
    WHERE memberships.organization_id = game_recurrences.organization_id
      AND memberships.user_id = auth.uid() AND memberships.is_admin
  ));

CREATE POLICY "Org admins can delete game recurrences"
  ON game_recurrences FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM memberships
    WHERE memberships.organization_id = game_recurrences.organization_id
      AND memberships.user_id = auth.uid() AND memberships.is_admin
  ));

-- ── Background job: create due Mixes, advance the schedule ─────────────
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
    SELECT * FROM game_recurrences
    WHERE is_active = true AND next_run_at <= now()
    FOR UPDATE SKIP LOCKED
  LOOP
    v_new_date := rec.next_run_at + make_interval(secs => rec.mix_offset_seconds);

    -- End conditions are checked BEFORE creating the Mix that would exceed them.
    IF (rec.ends_type = 'on_date' AND v_new_date > rec.ends_on)
       OR (rec.ends_type = 'after_occurrences' AND rec.occurrences_created >= rec.ends_after_occurrences) THEN
      UPDATE game_recurrences SET is_active = false, updated_at = now() WHERE id = rec.id;
      CONTINUE;
    END IF;

    INSERT INTO games (
      organization_id, title, date, location, price_per_player, prize,
      num_courts, max_players, court_time_minutes, game_time_minutes, format,
      status, created_by, recurrence_id, is_recurrence_origin
    )
    VALUES (
      rec.organization_id, rec.title, v_new_date, rec.location, rec.price_per_player, rec.prize,
      rec.num_courts, rec.num_courts * 4, rec.court_time_minutes, rec.game_time_minutes, rec.format,
      'open', rec.created_by, rec.id, false
    )
    ON CONFLICT (recurrence_id, date) DO NOTHING;

    UPDATE game_recurrences
    SET next_run_at = rec.next_run_at + (CASE rec.frequency
          WHEN 'daily'   THEN interval '1 day'
          WHEN 'weekly'  THEN interval '1 week'
          WHEN 'monthly' THEN interval '1 month'
          WHEN 'yearly'  THEN interval '1 year'
        END),
        occurrences_created = occurrences_created + 1,
        updated_at = now()
    WHERE id = rec.id;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION process_due_game_recurrences() FROM public;

-- cron.schedule updates the job in place if 'process-game-recurrences'
-- already exists, so this migration is safe to re-run.
SELECT cron.schedule(
  'process-game-recurrences',
  '*/5 * * * *',
  $$SELECT process_due_game_recurrences()$$
);
```

- [ ] **Step 2: Update `supabase/schema.sql` — enable `pg_cron`**

In `supabase/schema.sql`, replace:

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

with:

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
```

- [ ] **Step 3: Update `supabase/schema.sql` — `games` columns + new table + unique index**

In `supabase/schema.sql`, the `games` table block currently reads (lines 52-70):

```sql
CREATE TABLE games (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  title TEXT NOT NULL,
  date TIMESTAMPTZ NOT NULL,
  location TEXT,
  price_per_player NUMERIC(6,2),
  prize TEXT,
  max_players INTEGER DEFAULT 4, -- derived = num_courts * 4, written by the app
  num_courts INTEGER NOT NULL DEFAULT 1,
  court_time_minutes INTEGER NOT NULL DEFAULT 90,
  game_time_minutes INTEGER NOT NULL DEFAULT 20,
  format TEXT NOT NULL DEFAULT 'sobe_desce' CHECK (format IN ('sobe_desce', 'todos_contra_todos')),
  status TEXT DEFAULT 'open', -- open, closed, in_progress, finished, cancelled
  winner_team_id UUID,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);
```

Replace it with (adds `recurrence_id` and `is_recurrence_origin`, and the new `game_recurrences` table + unique index right after):

```sql
CREATE TABLE game_recurrences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'yearly')),
  ends_type TEXT NOT NULL CHECK (ends_type IN ('never', 'on_date', 'after_occurrences')),
  ends_on TIMESTAMPTZ,
  ends_after_occurrences INTEGER,
  occurrences_created INTEGER NOT NULL DEFAULT 1, -- the original Mix counts as occurrence 1
  mix_offset_seconds INTEGER NOT NULL, -- (mix date) - (auto-create date), fixed at creation time
  next_run_at TIMESTAMPTZ NOT NULL,
  title TEXT NOT NULL,
  location TEXT,
  price_per_player NUMERIC(6,2),
  prize TEXT,
  num_courts INTEGER NOT NULL,
  court_time_minutes INTEGER NOT NULL,
  game_time_minutes INTEGER NOT NULL,
  format TEXT NOT NULL,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE games (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  title TEXT NOT NULL,
  date TIMESTAMPTZ NOT NULL,
  location TEXT,
  price_per_player NUMERIC(6,2),
  prize TEXT,
  max_players INTEGER DEFAULT 4, -- derived = num_courts * 4, written by the app
  num_courts INTEGER NOT NULL DEFAULT 1,
  court_time_minutes INTEGER NOT NULL DEFAULT 90,
  game_time_minutes INTEGER NOT NULL DEFAULT 20,
  format TEXT NOT NULL DEFAULT 'sobe_desce' CHECK (format IN ('sobe_desce', 'todos_contra_todos')),
  status TEXT DEFAULT 'open', -- open, closed, in_progress, finished, cancelled
  winner_team_id UUID,
  created_by UUID REFERENCES profiles(id),
  recurrence_id UUID REFERENCES game_recurrences(id),
  is_recurrence_origin BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE UNIQUE INDEX games_recurrence_date_key
  ON games(recurrence_id, date) WHERE recurrence_id IS NOT NULL;
```

- [ ] **Step 4: Update `supabase/schema.sql` — RLS policies**

In `supabase/schema.sql`, after the existing `"Org admins can delete games"` policy block:

```sql
CREATE POLICY "Org admins can delete games"
  ON games FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM memberships
    WHERE memberships.organization_id = games.organization_id
      AND memberships.user_id = auth.uid() AND memberships.is_admin
  ));
```

insert:

```sql

-- game_recurrences: mirrors the games policies above.
CREATE POLICY "Org members can view game recurrences"
  ON game_recurrences FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM memberships
    WHERE memberships.organization_id = game_recurrences.organization_id AND memberships.user_id = auth.uid()
  ));

CREATE POLICY "Org admins can create game recurrences"
  ON game_recurrences FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM memberships
    WHERE memberships.organization_id = game_recurrences.organization_id
      AND memberships.user_id = auth.uid() AND memberships.is_admin
  ));

CREATE POLICY "Org admins can update game recurrences"
  ON game_recurrences FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM memberships
    WHERE memberships.organization_id = game_recurrences.organization_id
      AND memberships.user_id = auth.uid() AND memberships.is_admin
  ));

CREATE POLICY "Org admins can delete game recurrences"
  ON game_recurrences FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM memberships
    WHERE memberships.organization_id = game_recurrences.organization_id
      AND memberships.user_id = auth.uid() AND memberships.is_admin
  ));
```

(Also remember `ALTER TABLE game_recurrences ENABLE ROW LEVEL SECURITY;` needs to appear once, near the other `ENABLE ROW LEVEL SECURITY` statements earlier in the file — add it directly above these new policies if there isn't already a dedicated block for it.)

- [ ] **Step 5: Update `supabase/schema.sql` — append the cron function + schedule**

At the very end of `supabase/schema.sql` (after the last `"Users can delete their own avatar"` policy), append:

```sql

-- ════════════════════════════════════════════════════════════════════════
-- Recurring Mixes: background job (pg_cron)
-- See supabase/migration_recurring_mixes.sql for the full rationale.
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
    SELECT * FROM game_recurrences
    WHERE is_active = true AND next_run_at <= now()
    FOR UPDATE SKIP LOCKED
  LOOP
    v_new_date := rec.next_run_at + make_interval(secs => rec.mix_offset_seconds);

    IF (rec.ends_type = 'on_date' AND v_new_date > rec.ends_on)
       OR (rec.ends_type = 'after_occurrences' AND rec.occurrences_created >= rec.ends_after_occurrences) THEN
      UPDATE game_recurrences SET is_active = false, updated_at = now() WHERE id = rec.id;
      CONTINUE;
    END IF;

    INSERT INTO games (
      organization_id, title, date, location, price_per_player, prize,
      num_courts, max_players, court_time_minutes, game_time_minutes, format,
      status, created_by, recurrence_id, is_recurrence_origin
    )
    VALUES (
      rec.organization_id, rec.title, v_new_date, rec.location, rec.price_per_player, rec.prize,
      rec.num_courts, rec.num_courts * 4, rec.court_time_minutes, rec.game_time_minutes, rec.format,
      'open', rec.created_by, rec.id, false
    )
    ON CONFLICT (recurrence_id, date) DO NOTHING;

    UPDATE game_recurrences
    SET next_run_at = rec.next_run_at + (CASE rec.frequency
          WHEN 'daily'   THEN interval '1 day'
          WHEN 'weekly'  THEN interval '1 week'
          WHEN 'monthly' THEN interval '1 month'
          WHEN 'yearly'  THEN interval '1 year'
        END),
        occurrences_created = occurrences_created + 1,
        updated_at = now()
    WHERE id = rec.id;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION process_due_game_recurrences() FROM public;

SELECT cron.schedule(
  'process-game-recurrences',
  '*/5 * * * *',
  $$SELECT process_due_game_recurrences()$$
);
```

- [ ] **Step 6: Run the migration against the live Supabase project**

Open the Supabase dashboard → SQL Editor → paste the full contents of `supabase/migration_recurring_mixes.sql` → Run. Confirm no errors. Then confirm via Table Editor that `game_recurrences` exists with all columns, and that `games` now has `recurrence_id` and `is_recurrence_origin`.

- [ ] **Step 7: Verify the cron function and job manually**

Run each of these in the SQL Editor, in order, substituting the placeholders as you go:

```sql
-- 1. Grab an existing organization id to test with.
SELECT id FROM organizations LIMIT 1;
```

```sql
-- 2. Create a test recurrence that's already due (next_run_at in the past).
-- Substitute <ORG_ID> with the id from step 1.
INSERT INTO game_recurrences (
  organization_id, frequency, ends_type, mix_offset_seconds, next_run_at,
  title, num_courts, court_time_minutes, game_time_minutes, format
) VALUES (
  '<ORG_ID>', 'weekly', 'never', 3600, now() - interval '1 minute',
  'Mix de teste recorrente', 2, 90, 20, 'sobe_desce'
) RETURNING id;
```

```sql
-- 3. Run the job manually. Substitute <RECURRENCE_ID> with the id from step 2.
SELECT process_due_game_recurrences();

SELECT id, title, date, status, recurrence_id, is_recurrence_origin
FROM games WHERE recurrence_id = '<RECURRENCE_ID>';
-- Expect: exactly one row, date ≈ (next_run_at + 1 hour), status = 'open',
-- is_recurrence_origin = false.

SELECT next_run_at, occurrences_created FROM game_recurrences WHERE id = '<RECURRENCE_ID>';
-- Expect: next_run_at advanced by 1 week from the original, occurrences_created = 2.
```

```sql
-- 4. Idempotency check — running it again immediately must not duplicate anything
-- (next_run_at is now a week out, so nothing is due).
SELECT process_due_game_recurrences();
SELECT count(*) FROM games WHERE recurrence_id = '<RECURRENCE_ID>';
-- Expect: still 1.
```

```sql
-- 5. End-condition check: a recurrence that has already reached its occurrence
-- cap must deactivate instead of creating another Mix. Substitute <ORG_ID> again.
INSERT INTO game_recurrences (
  organization_id, frequency, ends_type, ends_after_occurrences, occurrences_created,
  mix_offset_seconds, next_run_at, title, num_courts, court_time_minutes, game_time_minutes, format
) VALUES (
  '<ORG_ID>', 'daily', 'after_occurrences', 1, 1,
  3600, now() - interval '1 minute', 'Mix de teste (fim)', 2, 90, 20, 'sobe_desce'
) RETURNING id;
```

```sql
-- Substitute <ENDS_ID> with the id just returned.
SELECT process_due_game_recurrences();
SELECT is_active FROM game_recurrences WHERE id = '<ENDS_ID>';
-- Expect: false.
SELECT count(*) FROM games WHERE recurrence_id = '<ENDS_ID>';
-- Expect: 0 — no Mix created past the cap.
```

```sql
-- 6. Confirm the cron job itself is scheduled and active.
SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'process-game-recurrences';
-- Expect: one row, schedule = '*/5 * * * *', active = true.
```

```sql
-- 7. Clean up all test data from this step.
DELETE FROM games WHERE recurrence_id IN ('<RECURRENCE_ID>', '<ENDS_ID>');
DELETE FROM game_recurrences WHERE id IN ('<RECURRENCE_ID>', '<ENDS_ID>');
```

- [ ] **Step 8: Commit**

```bash
git add supabase/migration_recurring_mixes.sql supabase/schema.sql
git commit -m "feat: add game_recurrences table and pg_cron background job"
```

---

### Task 2: Admin form — recurrence controls + create-flow wiring

**Files:**
- Modify: `src/pages/Admin.jsx:2` (icon imports — no change needed here, `Repeat` is added in Task 4)
- Modify: `src/pages/Admin.jsx:32-42` (`EMPTY_GAME_FORM`)
- Modify: `src/pages/Admin.jsx:171-224` (`handleCreateGame`)
- Modify: `src/pages/Admin.jsx:566-567` (form JSX, between the "Formato" field and the submit buttons)

**Interfaces:**
- Consumes: `game_recurrences` table and `games.recurrence_id`/`is_recurrence_origin` columns from Task 1.
- Produces: `gameForm.recurrence` shape `{ enabled: boolean, frequency: 'daily'|'weekly'|'monthly'|'yearly', endsType: 'never'|'on_date'|'after_occurrences', endsOn: string ('' or 'YYYY-MM-DD'), endsAfterOccurrences: string ('' or a positive integer as string), nextRunAt: string ('' or datetime-local format) }`; `EMPTY_RECURRENCE`; `recurrencePayloadFromGame(game, recurrence)` (returns the DB-shaped fields shared by insert/update); `createRecurrence(game, recurrence, userId)` (async, inserts `game_recurrences` and links the game back to it). Task 3 reuses `recurrencePayloadFromGame` and `createRecurrence`; Task 3 and 4 both read `game.recurrence` / `game.is_recurrence_origin`.

- [ ] **Step 1: Add recurrence constants and extend `EMPTY_GAME_FORM`**

In `src/pages/Admin.jsx`, replace:

```js
const FORMATS = [
  { value: 'sobe_desce', label: 'Sobe e desce' },
  { value: 'todos_contra_todos', label: 'Todos contra todos' },
]

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
}
```

with:

```js
const FORMATS = [
  { value: 'sobe_desce', label: 'Sobe e desce' },
  { value: 'todos_contra_todos', label: 'Todos contra todos' },
]
const RECURRENCE_FREQUENCIES = [
  { value: 'daily', label: 'Diariamente' },
  { value: 'weekly', label: 'Semanalmente' },
  { value: 'monthly', label: 'Mensalmente' },
  { value: 'yearly', label: 'Anualmente' },
]
const RECURRENCE_ENDS = [
  { value: 'never', label: 'Nunca' },
  { value: 'on_date', label: 'Até uma data' },
  { value: 'after_occurrences', label: 'Após X ocorrências' },
]

const EMPTY_RECURRENCE = {
  enabled: false,
  frequency: 'weekly',
  endsType: 'never',
  endsOn: '',
  endsAfterOccurrences: '',
  nextRunAt: '',
}

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
  recurrence: EMPTY_RECURRENCE,
}
```

- [ ] **Step 2: Add the recurrence helpers and wire `handleCreateGame`**

`gameForm.recurrence` is a nested object — it must never be spread directly into a Supabase `games` insert/update payload (the `games` table has no `recurrence` column). Both `handleCreateGame` and (in Task 3) `handleUpdateGame` destructure it out first.

In `src/pages/Admin.jsx`, replace `handleCreateGame` in full:

```js
  const handleCreateGame = async (e) => {
    e.preventDefault()

    // Date used to be enforced by DateTimeField's underlying native
    // input's `required` attribute — it's a fully custom component now.
    if (!gameForm.date) {
      alert('Escolhe uma data e hora para o jogo')
      return
    }

    try {
      const { data: { user } } = await supabase.auth.getUser()
      // num_courts is kept as a raw string in gameForm while the admin is
      // typing (see the input's onChange) — clamp it to a valid 1-6 count
      // here, at submit time, rather than on every keystroke.
      const numCourts = Math.min(6, Math.max(1, parseInt(gameForm.num_courts, 10) || 1))

      console.log('Creating game with data:', {
        ...gameForm,
        created_by: user.id,
        status: 'open'
      })

      const { data, error } = await supabase
        .from('games')
        .insert([
          {
            ...gameForm,
            organization_id: currentOrganizationId,
            // datetime-local is Portugal wall-clock; store the real instant
            date: new Date(gameForm.date).toISOString(),
            num_courts: numCourts,
            max_players: numCourts * 4, // derived
            price_per_player: gameForm.price_per_player === '' ? null : parseFloat(gameForm.price_per_player),
            created_by: user.id,
            status: 'open'
          }
        ])
        .select()

      if (error) {
        console.error('Database error:', error)
        throw error
      }

      console.log('Game created successfully:', data)
      setShowCreateGame(false)
      setGameForm(EMPTY_GAME_FORM)
      loadGames()
    } catch (error) {
      console.error('Error creating game:', error)
      alert('Erro ao criar jogo: ' + error.message)
    }
  }
```

with:

```js
  // Fields shared between creating and updating a game_recurrences row —
  // the rule itself plus the snapshot of settings future Mixes will copy.
  const recurrencePayloadFromGame = (game, recurrence) => ({
    frequency: recurrence.frequency,
    ends_type: recurrence.endsType,
    ends_on: recurrence.endsType === 'on_date' ? new Date(`${recurrence.endsOn}T23:59:59`).toISOString() : null,
    ends_after_occurrences: recurrence.endsType === 'after_occurrences' ? parseInt(recurrence.endsAfterOccurrences, 10) : null,
    mix_offset_seconds: Math.round(
      (new Date(game.date).getTime() - new Date(recurrence.nextRunAt).getTime()) / 1000
    ),
    next_run_at: new Date(recurrence.nextRunAt).toISOString(),
    title: game.title,
    location: game.location,
    price_per_player: game.price_per_player,
    prize: game.prize,
    num_courts: game.num_courts,
    court_time_minutes: game.court_time_minutes,
    game_time_minutes: game.game_time_minutes,
    format: game.format,
  })

  const validateRecurrence = (recurrence) => {
    if (!recurrence.enabled) return null
    if (!recurrence.nextRunAt) return 'Escolhe a data e hora em que o próximo Mix deve ser criado automaticamente'
    if (recurrence.endsType === 'on_date' && !recurrence.endsOn) return 'Escolhe a data em que a recorrência termina'
    if (recurrence.endsType === 'after_occurrences' && (!recurrence.endsAfterOccurrences || parseInt(recurrence.endsAfterOccurrences, 10) < 1)) {
      return 'Indica um número de ocorrências válido'
    }
    return null
  }

  // Inserts the game_recurrences row for a newly-flagged origin Mix, then
  // links `game` back to it. Used both when recurrence is turned on at
  // creation time (handleCreateGame) and when it's turned on while editing
  // a Mix that wasn't recurring yet (handleUpdateGame, Task 3).
  const createRecurrence = async (game, recurrence, userId) => {
    const { data: newRecurrence, error: recurrenceError } = await supabase
      .from('game_recurrences')
      .insert([{
        ...recurrencePayloadFromGame(game, recurrence),
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

  const handleCreateGame = async (e) => {
    e.preventDefault()

    // Date used to be enforced by DateTimeField's underlying native
    // input's `required` attribute — it's a fully custom component now.
    if (!gameForm.date) {
      alert('Escolhe uma data e hora para o jogo')
      return
    }

    const { recurrence, ...gameFields } = gameForm

    const recurrenceError = validateRecurrence(recurrence)
    if (recurrenceError) {
      alert(recurrenceError)
      return
    }

    try {
      const { data: { user } } = await supabase.auth.getUser()
      // num_courts is kept as a raw string in gameForm while the admin is
      // typing (see the input's onChange) — clamp it to a valid 1-6 count
      // here, at submit time, rather than on every keystroke.
      const numCourts = Math.min(6, Math.max(1, parseInt(gameForm.num_courts, 10) || 1))

      console.log('Creating game with data:', {
        ...gameFields,
        created_by: user.id,
        status: 'open'
      })

      const { data, error } = await supabase
        .from('games')
        .insert([
          {
            ...gameFields,
            organization_id: currentOrganizationId,
            // datetime-local is Portugal wall-clock; store the real instant
            date: new Date(gameForm.date).toISOString(),
            num_courts: numCourts,
            max_players: numCourts * 4, // derived
            price_per_player: gameForm.price_per_player === '' ? null : parseFloat(gameForm.price_per_player),
            created_by: user.id,
            status: 'open'
          }
        ])
        .select()

      if (error) {
        console.error('Database error:', error)
        throw error
      }

      console.log('Game created successfully:', data)

      if (recurrence.enabled) {
        await createRecurrence(data[0], recurrence, user.id)
      }

      setShowCreateGame(false)
      setGameForm(EMPTY_GAME_FORM)
      loadGames()
    } catch (error) {
      console.error('Error creating game:', error)
      alert('Erro ao criar jogo: ' + error.message)
    }
  }
```

- [ ] **Step 3: Add the recurrence UI block to the form**

In `src/pages/Admin.jsx`, the "Formato" field is currently followed directly by the submit buttons:

```jsx
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Formato
                      </label>
                      <Segmented
                        options={FORMATS}
                        value={gameForm.format}
                        onChange={(v) => setGameForm({ ...gameForm, format: v })}
                      />
                    </div>

                    <div className="flex gap-3">
```

Insert the recurrence block between them:

```jsx
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Formato
                      </label>
                      <Segmented
                        options={FORMATS}
                        value={gameForm.format}
                        onChange={(v) => setGameForm({ ...gameForm, format: v })}
                      />
                    </div>

                    {(!editingGame || (editingGame.is_recurrence_origin && editingGame.recurrence?.is_active)) && (
                      <div className="border-t border-line pt-4 space-y-4">
                        <label className="flex items-center gap-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={gameForm.recurrence.enabled}
                            onChange={(e) => setGameForm({
                              ...gameForm,
                              recurrence: { ...gameForm.recurrence, enabled: e.target.checked }
                            })}
                            className="w-5 h-5"
                          />
                          <span className="text-sm font-medium text-gray-700">Mix recorrente</span>
                        </label>

                        {gameForm.recurrence.enabled && (
                          <>
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                Frequência
                              </label>
                              <Segmented
                                options={RECURRENCE_FREQUENCIES}
                                value={gameForm.recurrence.frequency}
                                onChange={(v) => setGameForm({
                                  ...gameForm,
                                  recurrence: { ...gameForm.recurrence, frequency: v }
                                })}
                              />
                            </div>

                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                Termina
                              </label>
                              <Segmented
                                options={RECURRENCE_ENDS}
                                value={gameForm.recurrence.endsType}
                                onChange={(v) => setGameForm({
                                  ...gameForm,
                                  recurrence: { ...gameForm.recurrence, endsType: v }
                                })}
                              />
                              {gameForm.recurrence.endsType === 'on_date' && (
                                <input
                                  type="date"
                                  value={gameForm.recurrence.endsOn}
                                  onChange={(e) => setGameForm({
                                    ...gameForm,
                                    recurrence: { ...gameForm.recurrence, endsOn: e.target.value }
                                  })}
                                  className="input-field mt-2"
                                  required
                                />
                              )}
                              {gameForm.recurrence.endsType === 'after_occurrences' && (
                                <input
                                  type="number"
                                  min="1"
                                  value={gameForm.recurrence.endsAfterOccurrences}
                                  onChange={(e) => setGameForm({
                                    ...gameForm,
                                    recurrence: { ...gameForm.recurrence, endsAfterOccurrences: e.target.value }
                                  })}
                                  className="input-field mt-2"
                                  placeholder="ex: 10"
                                  required
                                />
                              )}
                            </div>

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
                                Data e hora em que o próximo Mix desta série deve ser criado — não é a data do Mix em si.
                              </p>
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    <div className="flex gap-3">
```

(`editingGame.recurrence` doesn't exist yet at this point in the plan — it's populated by Task 3's `loadGames` change. Until Task 3 lands, this condition simply evaluates to "hide the block while editing any existing Mix," which is safe.)

- [ ] **Step 4: Manually verify in the dev server**

Run: `npm run dev`

In the browser: go to Admin → Jogos → Criar novo jogo. Fill in the normal fields, check "Mix recorrente", pick "Semanalmente", leave "Termina" on "Nunca", and set "Criar automaticamente em" to a date/time a few days before the Mix's own date/time. Submit. Confirm no error alert appears.

Open the Supabase Table Editor:
- `games`: the new row has `recurrence_id` set (non-null) and `is_recurrence_origin = true`.
- `game_recurrences`: one new row exists, with `frequency = 'weekly'`, `ends_type = 'never'`, `next_run_at` matching what you entered, and `mix_offset_seconds` equal to the difference (in seconds) between the Mix's date/time and the "criar automaticamente" date/time you entered.

Also create a second, non-recurring Mix (leave the checkbox unchecked) and confirm it saves normally with `recurrence_id = null`.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Admin.jsx
git commit -m "feat: add recurring Mix controls and create-flow wiring to admin form"
```

---

### Task 3: Admin form — edit-flow wiring

**Files:**
- Modify: `src/pages/Admin.jsx` — `loadGames` (currently lines 99-126, before Task 2's edits shifted anything after it)
- Modify: `src/pages/Admin.jsx` — `startEditGame` (currently lines 366-379)
- Modify: `src/pages/Admin.jsx` — `handleUpdateGame` (currently lines 226-259)

(Task 2 only inserted code after `handleCreateGame` and inside the form JSX further down the file, so `loadGames`, `startEditGame`, and `handleUpdateGame` — all of which sit between those two areas — keep their original line numbers through this task. Locate each by its exact code shown below rather than relying solely on line numbers.)

**Interfaces:**
- Consumes: `recurrencePayloadFromGame(game, recurrence)`, `createRecurrence(game, recurrence, userId)`, `validateRecurrence(recurrence)`, `EMPTY_RECURRENCE` from Task 2.
- Produces: `updateRecurrence(recurrenceId, game, recurrence)` (async); `game.recurrence` embedded object on every row returned by `loadGames` (shape: `{ id, is_active, frequency, ends_type, ends_on, ends_after_occurrences, next_run_at }` or `null`). Task 4 reads `game.recurrence` and `game.is_recurrence_origin` to render the list badge/actions.

- [ ] **Step 1: Add the recurrence join to `loadGames`**

In `src/pages/Admin.jsx`, replace:

```js
  const loadGames = async () => {
    try {
      const { data, error } = await supabase
        .from('games')
        .select(`
          *,
          participants (
            id,
            user_id,
            partner_id,
            status
          )
        `)
        .eq('organization_id', currentOrganizationId)
        .order('date', { ascending: false })
```

with:

```js
  const loadGames = async () => {
    try {
      const { data, error } = await supabase
        .from('games')
        .select(`
          *,
          participants (
            id,
            user_id,
            partner_id,
            status
          ),
          recurrence:game_recurrences (
            id,
            is_active,
            frequency,
            ends_type,
            ends_on,
            ends_after_occurrences,
            next_run_at
          )
        `)
        .eq('organization_id', currentOrganizationId)
        .order('date', { ascending: false })
```

(the rest of `loadGames` is unchanged.)

- [ ] **Step 2: Prefill recurrence fields in `startEditGame`**

In `src/pages/Admin.jsx`, replace:

```js
  const startEditGame = (game) => {
    setEditingGame(game)
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
    })
  }
```

with:

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

- [ ] **Step 3: Add `updateRecurrence` and wire `handleUpdateGame`**

In `src/pages/Admin.jsx`, replace `handleUpdateGame` in full:

```js
  const handleUpdateGame = async (e) => {
    e.preventDefault()

    if (!gameForm.date) {
      alert('Escolhe uma data e hora para o jogo')
      return
    }

    try {
      // See handleCreateGame — num_courts is a raw string while typing,
      // clamped to a valid 1-6 count here at submit time.
      const numCourts = Math.min(6, Math.max(1, parseInt(gameForm.num_courts, 10) || 1))

      const { error } = await supabase
        .from('games')
        .update({
          ...gameForm,
          date: new Date(gameForm.date).toISOString(),
          num_courts: numCourts,
          max_players: numCourts * 4,
          price_per_player: gameForm.price_per_player === '' ? null : parseFloat(gameForm.price_per_player),
        })
        .eq('id', editingGame.id)

      if (error) throw error

      setEditingGame(null)
      setGameForm(EMPTY_GAME_FORM)
      loadGames()
    } catch (error) {
      console.error('Error updating game:', error)
      alert('Erro ao atualizar jogo')
    }
  }
```

with:

```js
  // Updates the snapshot + rule on the origin Mix's recurrence. Only ever
  // called from handleUpdateGame when editing the origin of an active
  // recurrence — already-created Mixes are never touched by this.
  const updateRecurrence = async (recurrenceId, game, recurrence) => {
    const { error } = await supabase
      .from('game_recurrences')
      .update({
        ...recurrencePayloadFromGame(game, recurrence),
        updated_at: new Date().toISOString(),
      })
      .eq('id', recurrenceId)

    if (error) {
      console.error('Error updating recurrence:', error)
      alert('O Mix foi atualizado, mas não foi possível atualizar a recorrência: ' + error.message)
    }
  }

  const handleUpdateGame = async (e) => {
    e.preventDefault()

    if (!gameForm.date) {
      alert('Escolhe uma data e hora para o jogo')
      return
    }

    const { recurrence, ...gameFields } = gameForm
    const hadActiveRecurrence = editingGame.is_recurrence_origin && editingGame.recurrence?.is_active

    const recurrenceError = validateRecurrence(recurrence)
    if (recurrenceError) {
      alert(recurrenceError)
      return
    }

    try {
      // See handleCreateGame — num_courts is a raw string while typing,
      // clamped to a valid 1-6 count here at submit time.
      const numCourts = Math.min(6, Math.max(1, parseInt(gameForm.num_courts, 10) || 1))

      const { data, error } = await supabase
        .from('games')
        .update({
          ...gameFields,
          date: new Date(gameForm.date).toISOString(),
          num_courts: numCourts,
          max_players: numCourts * 4,
          price_per_player: gameForm.price_per_player === '' ? null : parseFloat(gameForm.price_per_player),
        })
        .eq('id', editingGame.id)
        .select()
        .single()

      if (error) throw error

      if (hadActiveRecurrence && recurrence.enabled) {
        // Origin Mix, recurrence still on: keep the shared rule/snapshot in sync.
        await updateRecurrence(editingGame.recurrence.id, data, recurrence)
      } else if (hadActiveRecurrence && !recurrence.enabled) {
        // Origin Mix, toggled off: stop creating future Mixes. Never reactivated later.
        await supabase
          .from('game_recurrences')
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq('id', editingGame.recurrence.id)
      } else if (!hadActiveRecurrence && recurrence.enabled) {
        // Wasn't recurring (never was, or a previous recurrence was stopped): start a new one.
        const { data: { user } } = await supabase.auth.getUser()
        await createRecurrence(data, recurrence, user.id)
      }

      setEditingGame(null)
      setGameForm(EMPTY_GAME_FORM)
      loadGames()
    } catch (error) {
      console.error('Error updating game:', error)
      alert('Erro ao atualizar jogo')
    }
  }
```

- [ ] **Step 4: Manually verify in the dev server**

Run: `npm run dev` (if not already running from Task 2).

Using the recurring Mix created in Task 2's verification:
1. Click "Editar" on it. Confirm the "Mix recorrente" section is visible and pre-filled (checkbox on, "Semanalmente" selected, "Nunca" for Termina, the "Criar automaticamente em" field showing the value you entered).
2. Change the frequency to "Mensalmente" and save. In the Table Editor, confirm the `game_recurrences` row's `frequency` is now `'monthly'`.
3. Edit it again, uncheck "Mix recorrente", save. Confirm the `game_recurrences` row's `is_active` is now `false`.
4. Edit the same Mix again — confirm the "Mix recorrente" section is hidden entirely now (the recurrence is inactive), consistent with "editing an inactive recurrence doesn't reactivate it."
5. On the non-recurring Mix created in Task 2, edit it, check "Mix recorrente", fill in the fields, save. In the Table Editor, confirm a brand-new `game_recurrences` row was created and that Mix's `recurrence_id`/`is_recurrence_origin` now point to it.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Admin.jsx
git commit -m "feat: wire recurring Mix editing, including origin snapshot sync"
```

---

### Task 4: Admin games list — recurrence badge, stop action, delete cascade

**Files:**
- Modify: `src/pages/Admin.jsx:2` (icon imports)
- Modify: `src/pages/Admin.jsx` — `handleDeleteGame` (currently lines 261-278)
- Modify: `src/pages/Admin.jsx` — the games list card JSX (currently around lines 590-630, inside the `games.map(game => { ... })` block)

**Interfaces:**
- Consumes: `game.recurrence` (embedded object or `null`) and `game.is_recurrence_origin` from Task 3's `loadGames`.
- Produces: `handleStopRecurrence(recurrenceId)` (async).

- [ ] **Step 1: Import the `Repeat` icon**

In `src/pages/Admin.jsx`, replace:

```js
import { Plus, Calendar, Users, Trash2, Edit2, Check, X, UserX } from 'lucide-react'
```

with:

```js
import { Plus, Calendar, Users, Trash2, Edit2, Check, X, UserX, Repeat } from 'lucide-react'
```

- [ ] **Step 2: Add `handleStopRecurrence` and cascade-deactivate on delete**

In `src/pages/Admin.jsx`, replace `handleDeleteGame` in full:

```js
  const handleDeleteGame = async (gameId) => {
    if (!confirm('Tens a certeza que queres eliminar este jogo?')) return

    try {
      const { error } = await supabase
        .from('games')
        .delete()
        .eq('id', gameId)

      if (error) throw error

      alert('Jogo eliminado com sucesso!')
      loadGames()
    } catch (error) {
      console.error('Error deleting game:', error)
      alert('Erro ao eliminar jogo')
    }
  }
```

with:

```js
  const handleDeleteGame = async (gameId) => {
    if (!confirm('Tens a certeza que queres eliminar este jogo?')) return

    try {
      const gameToDelete = games.find(g => g.id === gameId)

      const { error } = await supabase
        .from('games')
        .delete()
        .eq('id', gameId)

      if (error) throw error

      // The origin Mix is the only place the "Mix recorrente" toggle lives —
      // deleting it must also stop the recurrence, otherwise it would keep
      // creating Mixes automatically with no UI left to turn it off from.
      if (gameToDelete?.is_recurrence_origin && gameToDelete.recurrence?.is_active) {
        await supabase
          .from('game_recurrences')
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq('id', gameToDelete.recurrence_id)
      }

      alert('Jogo eliminado com sucesso!')
      loadGames()
    } catch (error) {
      console.error('Error deleting game:', error)
      alert('Erro ao eliminar jogo')
    }
  }

  const handleStopRecurrence = async (recurrenceId) => {
    if (!confirm('Parar esta recorrência? Os Mixes já criados mantêm-se; não serão criados mais Mixes automaticamente.')) return

    try {
      const { error } = await supabase
        .from('game_recurrences')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', recurrenceId)

      if (error) throw error

      loadGames()
    } catch (error) {
      console.error('Error stopping recurrence:', error)
      alert('Erro ao parar a recorrência: ' + error.message)
    }
  }
```

- [ ] **Step 3: Add the badge and "Parar recorrência" action to each list card**

In `src/pages/Admin.jsx`, the games list card currently reads:

```jsx
                          <div className="space-y-1 text-gray-600">
                            <p>{formatDate(game.date)}</p>
                            {game.location && <p>📍 {game.location}</p>}
                            <p>
                              👥 {peopleCount}/{game.max_players || (game.num_courts || 1) * 4} jogadores
                            </p>
                            <p className="text-sm">
                              {FORMAT_LABEL[game.format] || 'Sobe e desce'} • {game.num_courts || 1} {(game.num_courts || 1) === 1 ? 'campo' : 'campos'} • {totalRounds(game)} rondas
                            </p>
                          </div>
                        </div>
```

Replace it with:

```jsx
                          <div className="space-y-1 text-gray-600">
                            <p>{formatDate(game.date)}</p>
                            {game.location && <p>📍 {game.location}</p>}
                            <p>
                              👥 {peopleCount}/{game.max_players || (game.num_courts || 1) * 4} jogadores
                            </p>
                            <p className="text-sm">
                              {FORMAT_LABEL[game.format] || 'Sobe e desce'} • {game.num_courts || 1} {(game.num_courts || 1) === 1 ? 'campo' : 'campos'} • {totalRounds(game)} rondas
                            </p>
                          </div>
                          {game.recurrence?.is_active && (
                            <div className="mt-2 flex items-center gap-2 flex-wrap">
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-lime-100 text-lime-800 text-xs font-bold">
                                <Repeat size={12} />
                                Recorrente
                              </span>
                              {!game.is_recurrence_origin && (
                                <button
                                  type="button"
                                  onClick={() => handleStopRecurrence(game.recurrence.id)}
                                  className="text-xs font-semibold text-red-600 hover:underline"
                                >
                                  Parar recorrência
                                </button>
                              )}
                            </div>
                          )}
                        </div>
```

- [ ] **Step 4: Manually verify in the dev server**

Run: `npm run dev` (if not already running).

1. In Admin → Jogos, find the recurring Mix from Tasks 2-3. Confirm it shows a "Recorrente" badge and no "Parar recorrência" button (it's the origin — that's controlled via Edit instead).
2. Simulate an auto-created instance: in the Supabase SQL Editor, insert a second row into `games` copying that Mix's `organization_id`/settings, with a different `date`, the same `recurrence_id`, and `is_recurrence_origin = false`. Reload the Admin page and confirm this second card shows the badge **and** a "Parar recorrência" button.
3. Click "Parar recorrência" on that second card, confirm the dialog, and confirm both cards' badges disappear after the list reloads (the shared `game_recurrences.is_active` is now `false`).
4. Create a fresh recurring Mix, then delete it via the trash icon. In the Table Editor, confirm its `game_recurrences` row now has `is_active = false`.
5. Clean up the manually-inserted test `games` row from step 2 via the Table Editor if it's still there.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Admin.jsx
git commit -m "feat: show recurring Mix badge and stop action in admin games list"
```

---

### Task 5: End-to-end verification of the scheduled job

**Files:** none (verification only — no code changes, no commit).

**Interfaces:**
- Consumes: everything from Tasks 1-4.

- [ ] **Step 1: Create a real recurring Mix through the Admin UI**

In the browser, create a Mix with "Mix recorrente" on, frequency "Diariamente" (fastest to observe), "Termina" = "Nunca", and "Criar automaticamente em" set to a couple of minutes from now.

- [ ] **Step 2: Wait for the cron tick (or trigger it manually)**

Either wait up to 5 minutes for the real `pg_cron` schedule to pick it up, or in the Supabase SQL Editor run:

```sql
SELECT process_due_game_recurrences();
```

after the "criar automaticamente em" time has passed.

- [ ] **Step 3: Confirm the new Mix in the Admin UI**

Reload Admin → Jogos. Confirm a new Mix appears dated one day after the original (since frequency is daily), with the same title/location/price/prize/courts/court time/game time/format as the origin, status "Aberto", zero participants, and showing the "Recorrente" badge with a "Parar recorrência" button (confirming it's correctly marked non-origin).

- [ ] **Step 4: Confirm the cron job is live**

In the SQL Editor:

```sql
SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'process-game-recurrences';
```

Expect one row, `schedule = '*/5 * * * *'`, `active = true`.

- [ ] **Step 5: Clean up test data**

Delete the test Mix(es) and the test `game_recurrences` row via the Admin UI (delete the origin Mix — Task 4's cascade will deactivate the recurrence) and, if any auto-created instances remain, delete those too via the trash icon, so no test data lingers in the live club's data.
