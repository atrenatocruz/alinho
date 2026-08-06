# Mix Price, Prize, and GPS Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a mix's per-player price and prize (when set) on the game-details hero card, and make the existing location text open Google Maps.

**Architecture:** Two new nullable columns (`price_per_player NUMERIC(6,2)`, `prize TEXT`) added to the `games` table via an additive SQL migration. The admin create/edit form gains two optional inputs for these fields. The `GameDetails.jsx` hero card gains two new conditional rows (price, prize) and wraps its existing location row in a link to a Google Maps search URL built from the free-text `location` value. No changes to the compact list card (`MixCard`) or `ShareCard.jsx` — out of scope per the spec.

**Tech Stack:** React 18 + Vite, Tailwind CSS, `lucide-react` icons, `@supabase/supabase-js` (no ORM/repository layer — pages call `supabase.from(...)` directly), plain `useState` form objects (no form library). No test framework is configured in this repo (`package.json` has no test runner) — verification steps in this plan use manual dev-server checks instead of automated tests.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-08-06-mix-price-prize-gps-design.md` — follow it exactly; do not add scope beyond it (no `MixCard`/list-card changes, no `ShareCard.jsx` changes, no lat/lng column, no pasted-maps-link field, price is always per-player in €).
- Migrations in this repo are plain `.sql` files run manually via Supabase → SQL Editor (no Supabase CLI migration folder). New migration file: `supabase/migration_price_prize.sql`, following the header/comment style of `supabase/migration_mixes.sql`.
- `supabase/schema.sql` must also be updated to stay the authoritative full-schema reference (this repo keeps both the incremental migration file and the full schema in sync).
- No test framework exists — do not add one. Verify UI changes by running `npm run dev` and checking the page in a browser.

---

### Task 1: Database migration — `price_per_player` and `prize` columns

**Files:**
- Create: `supabase/migration_price_prize.sql`
- Modify: `supabase/schema.sql:52-68` (the `games` table definition)

**Interfaces:**
- Produces: `games.price_per_player` (NUMERIC(6,2), nullable) and `games.prize` (TEXT, nullable), consumed by Task 2 (admin form) and Task 3 (hero card display).

- [ ] **Step 1: Write the migration file**

Create `supabase/migration_price_prize.sql`:

```sql
-- ════════════════════════════════════════════════════════════════════════
-- Migration: Mix price per player + prize
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- No dashboard toggles needed for this migration.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE games ADD COLUMN IF NOT EXISTS price_per_player NUMERIC(6,2);
ALTER TABLE games ADD COLUMN IF NOT EXISTS prize TEXT;
```

- [ ] **Step 2: Update `supabase/schema.sql` to match**

In `supabase/schema.sql`, the `games` table block currently reads (lines 52-68):

```sql
CREATE TABLE games (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  title TEXT NOT NULL,
  date TIMESTAMPTZ NOT NULL,
  location TEXT,
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

Replace it with (adds `price_per_player` and `prize` right after `location`):

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

- [ ] **Step 3: Run the migration against the live Supabase project**

Open the Supabase dashboard → SQL Editor → paste the full contents of `supabase/migration_price_prize.sql` → Run. Confirm no errors, then confirm via Table Editor that `games` now has `price_per_player` and `prize` columns.

- [ ] **Step 4: Commit**

```bash
git add supabase/migration_price_prize.sql supabase/schema.sql
git commit -m "feat: add price_per_player and prize columns to games table"
```

---

### Task 2: Admin form — collect price and prize

**Files:**
- Modify: `src/pages/Admin.jsx:32-40` (`EMPTY_GAME_FORM`)
- Modify: `src/pages/Admin.jsx:169-221` (`handleCreateGame`)
- Modify: `src/pages/Admin.jsx:223-255` (`handleUpdateGame`)
- Modify: `src/pages/Admin.jsx:362-373` (`startEditGame`)
- Modify: `src/pages/Admin.jsx:467-478` (form JSX, "Local" field block)

**Interfaces:**
- Consumes: `games.price_per_player`, `games.prize` columns from Task 1.
- Produces: `gameForm.price_per_player` (string in form state, e.g. `''` or `'5'`), `gameForm.prize` (string, e.g. `''` or `'Vouchers'`), submitted to Supabase as `price_per_player: number|null` and `prize: string`. Task 3 reads `game.price_per_player` and `game.prize` from the saved row.

- [ ] **Step 1: Add the two fields to `EMPTY_GAME_FORM`**

In `src/pages/Admin.jsx`, replace:

```js
const EMPTY_GAME_FORM = {
  title: '',
  date: '',
  location: '',
  num_courts: 1,
  court_time_minutes: 90,
  game_time_minutes: 20,
  format: 'sobe_desce',
}
```

with:

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
}
```

- [ ] **Step 2: Add the form inputs after the "Local" field**

In `src/pages/Admin.jsx`, after this existing block (currently lines 467-478):

```jsx
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Local
                      </label>
                      <input
                        type="text"
                        value={gameForm.location}
                        onChange={(e) => setGameForm({ ...gameForm, location: e.target.value })}
                        className="input-field"
                        placeholder="Clube de Padel"
                      />
                    </div>
```

insert:

```jsx
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Preço por jogador (€)
                      </label>
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        value={gameForm.price_per_player}
                        onChange={(e) => setGameForm({ ...gameForm, price_per_player: e.target.value })}
                        className="input-field"
                        placeholder="ex: 5"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Prémio
                      </label>
                      <input
                        type="text"
                        value={gameForm.prize}
                        onChange={(e) => setGameForm({ ...gameForm, prize: e.target.value })}
                        className="input-field"
                        placeholder="ex: Vouchers para os vencedores"
                      />
                    </div>
```

- [ ] **Step 3: Convert `price_per_player` to a number (or null) before writing to Supabase**

`gameForm.price_per_player` is a string from the input (possibly `''`), but the DB column is `NUMERIC` — an empty string must become `null`, not be sent as-is (Postgres rejects `''` for a numeric column).

In `handleCreateGame` (currently lines 192-206):

```js
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
            created_by: user.id,
            status: 'open'
          }
        ])
        .select()
```

replace with:

```js
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
```

In `handleUpdateGame` (currently lines 236-244):

```js
      const { error } = await supabase
        .from('games')
        .update({
          ...gameForm,
          date: new Date(gameForm.date).toISOString(),
          num_courts: numCourts,
          max_players: numCourts * 4,
        })
        .eq('id', editingGame.id)
```

replace with:

```js
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
```

(`prize` needs no conversion — `''` is a valid value for a `TEXT` column, and the display logic in Task 3 treats an empty string as "no prize".)

- [ ] **Step 4: Prefill the two fields when editing an existing mix**

In `src/pages/Admin.jsx`, replace:

```js
  const startEditGame = (game) => {
    setEditingGame(game)
    setGameForm({
      title: game.title,
      date: toLocalInput(game.date),
      location: game.location || '',
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

- [ ] **Step 5: Manually verify in the dev server**

Run: `npm run dev`

In the browser: go to Admin → Jogos → Criar jogo. Confirm the "Preço por jogador (€)" and "Prémio" fields appear after "Local", both optional. Create a mix with a price (e.g. `5`) and a prize (e.g. `Vouchers`), and a second mix leaving both blank. Confirm both save without a Supabase error (check the browser console for the `insert` error path). Edit the first mix and confirm the price and prize fields are prefilled correctly.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Admin.jsx
git commit -m "feat: collect mix price per player and prize in admin form"
```

---

### Task 3: Hero card — show price, prize, and a GPS link on location

**Files:**
- Modify: `src/pages/GameDetails.jsx:4` (icon imports)
- Modify: `src/pages/GameDetails.jsx:864-881` (hero card info rows)

**Interfaces:**
- Consumes: `game.price_per_player` (number or null), `game.prize` (string or null/empty), `game.location` (string or null) — all from the `games` row loaded elsewhere in this file as `game`.

- [ ] **Step 1: Add the `Euro` icon to the existing import**

In `src/pages/GameDetails.jsx`, replace:

```js
import { Calendar, MapPin, ArrowLeft, UserPlus, User, Check, Lock, Trophy, Play, ChevronRight, Swords, X, Repeat, Share2, ChevronDown, RotateCcw } from 'lucide-react'
```

with:

```js
import { Calendar, MapPin, ArrowLeft, UserPlus, User, Check, Lock, Trophy, Play, ChevronRight, Swords, X, Repeat, Share2, ChevronDown, RotateCcw, Euro } from 'lucide-react'
```

(`Trophy` is already imported — reused for the prize row.)

- [ ] **Step 2: Wrap the location row in a Google Maps link, and add price/prize rows**

In `src/pages/GameDetails.jsx`, replace this block (currently lines 864-881):

```jsx
        <div className="space-y-2 text-muted mt-4">
          <div className="flex items-center gap-2.5">
            <Calendar size={20} className="text-ink-700 shrink-0" />
            <span className="capitalize">{formatDate(game.date)}</span>
          </div>
          {game.location && (
            <div className="flex items-center gap-2.5">
              <MapPin size={20} className="text-ink-700 shrink-0" />
              <span>{game.location}</span>
            </div>
          )}
          <div className="flex items-center gap-2.5">
            <Swords size={20} className="text-ink-700 shrink-0" />
            <span>
              {FORMAT_LABEL[game.format] || 'Sobe e desce'} • {numCourts} {numCourts === 1 ? 'campo' : 'campos'} • {roundsTotal} rondas de {game.game_time_minutes || 20}min
            </span>
          </div>
        </div>
```

with:

```jsx
        <div className="space-y-2 text-muted mt-4">
          <div className="flex items-center gap-2.5">
            <Calendar size={20} className="text-ink-700 shrink-0" />
            <span className="capitalize">{formatDate(game.date)}</span>
          </div>
          {game.location && (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(game.location)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2.5"
            >
              <MapPin size={20} className="text-ink-700 shrink-0" />
              <span>{game.location}</span>
            </a>
          )}
          <div className="flex items-center gap-2.5">
            <Swords size={20} className="text-ink-700 shrink-0" />
            <span>
              {FORMAT_LABEL[game.format] || 'Sobe e desce'} • {numCourts} {numCourts === 1 ? 'campo' : 'campos'} • {roundsTotal} rondas de {game.game_time_minutes || 20}min
            </span>
          </div>
          {game.price_per_player > 0 && (
            <div className="flex items-center gap-2.5">
              <Euro size={20} className="text-ink-700 shrink-0" />
              <span>{game.price_per_player}€ / jogador</span>
            </div>
          )}
          {game.prize && (
            <div className="flex items-center gap-2.5">
              <Trophy size={20} className="text-ink-700 shrink-0" />
              <span>Prémio: {game.prize}</span>
            </div>
          )}
        </div>
```

- [ ] **Step 3: Manually verify in the dev server**

Run: `npm run dev` (if not already running from Task 2).

In the browser: open the details page for the mix created in Task 2 with a price and prize. Confirm the hero card shows the location as a tappable link (opens Google Maps search in a new tab with the correct query), a "5€ / jogador" row with a Euro icon, and a "Prémio: Vouchers" row with a Trophy icon. Open the details page for the mix left blank in Task 2 and confirm neither the price row nor the prize row is rendered, and the layout looks correct without them (no stray gaps).

- [ ] **Step 4: Commit**

```bash
git add src/pages/GameDetails.jsx
git commit -m "feat: show mix price, prize, and GPS link on game details hero card"
```
