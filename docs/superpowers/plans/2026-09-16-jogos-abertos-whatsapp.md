# Jogos em Aberto via WhatsApp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a club admin publish a batch of free time slots from the backoffice and have the WhatsApp bot post one combined message to the club's group; players join a specific slot by replying with its hour (e.g. "In 18"), with zero new tables and full reuse of the existing mix/ranking/results machinery.

**Architecture:** Open slots are `games` rows (`origin = 'open_slot'`) grouped by a shared `open_batch_id`. The admin backoffice gets a new "Jogos Abertos" tab, separate from the normal Mixes list, to publish and track them. The WhatsApp bot's existing Realtime pipeline (`sync.js`) already reposts on every `games`/`participants` change and its existing free-text matcher (`commands.js`) already resolves "in 18" by hour — both are extended, not replaced, to render open-slot batches as one compact combined message instead of one message per mix.

**Tech Stack:** Supabase (Postgres + RLS), Node/Baileys WhatsApp bot (`whatsapp-bot/`, no test framework — verify with throwaway node scripts), Vite + React + vitest (`src/`).

**Spec:** `docs/superpowers/specs/2026-09-16-jogos-abertos-whatsapp-design.md` (and the rules it inherits unchanged from `docs/superpowers/specs/2026-09-10-jogo-em-aberto-clube-design.md`).

## Global Constraints

- No new tables — reuse `games` (per spec's "Modelo de dados").
- Open-slot games never appear in the normal Mixes list/backoffice, even after they fill to 4/4 (per spec's "Backoffice" decision).
- The WhatsApp message for open slots must never show empty-vaga placeholders — only actual joined players, growing as people join (per spec's "WhatsApp bot" section).
- Level shown next to a slot (once the first joiner sets it) is informational only — never blocks later joins (per spec).
- A migration file in the repo is not a migration that has run — it must be pasted into the Supabase SQL Editor manually before code depending on it reaches `main` (per `CLAUDE.md`).
- `whatsapp-bot/` has no test framework and no CI — verify bot changes with a disposable local script, then note the manual EC2 redeploy requirement (per `CLAUDE.md`).

---

### Task 1: Database migration — `origin`, `open_batch_id`, dynamic level lock

**Files:**
- Create: `supabase/migration_open_slots.sql`

**Interfaces:**
- Produces: `games.origin` (`'admin'` default, `'open_slot'` for open slots), `games.open_batch_id` (UUID, nullable), trigger `open_slot_level_lock_trigger` on `participants`.
- Consumes: existing `games`, `participants`, `memberships` tables (schema.sql:81-119, 42-52).

- [ ] **Step 1: Write the migration file**

```sql
-- ════════════════════════════════════════════════════════════════════════
-- Jogos em aberto via WhatsApp — origin/open_batch_id em games + trigger
-- de nível dinâmico. Ver docs/superpowers/specs/2026-09-16-jogos-abertos-
-- whatsapp-design.md. Idempotente — pode ser corrida mais que uma vez.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE games ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'admin'
  CHECK (origin IN ('admin', 'open_slot'));

ALTER TABLE games ADD COLUMN IF NOT EXISTS open_batch_id UUID;

CREATE INDEX IF NOT EXISTS games_open_batch_id_idx ON games(open_batch_id)
  WHERE open_batch_id IS NOT NULL;

-- Ao primeiro participante confirmado num jogo em aberto sem nível ainda
-- definido, copia o nível da membership do clube para games.level — só
-- informativo (groups.js's mixVisibleToGroup nunca filtra jogos em aberto
-- por nível), nunca bloqueia entradas seguintes. SECURITY DEFINER pelo
-- mesmo motivo do check_game_full existente (schema.sql:452-454): quem
-- entra não é admin do clube, e sem isto a UPDATE seria bloqueada por
-- "Org admins can update games".
CREATE OR REPLACE FUNCTION lock_open_slot_level()
RETURNS TRIGGER AS $$
DECLARE
  v_org_id UUID;
  v_origin TEXT;
  v_current_level TEXT;
  v_member_level TEXT;
BEGIN
  IF NEW.status != 'confirmed' THEN
    RETURN NEW;
  END IF;

  SELECT organization_id, origin, level INTO v_org_id, v_origin, v_current_level
  FROM games WHERE id = NEW.game_id;

  IF v_origin != 'open_slot' OR v_current_level IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT level INTO v_member_level
  FROM memberships
  WHERE user_id = NEW.user_id AND organization_id = v_org_id;

  -- memberships.level é um campo legado que ainda pode conter valores fora
  -- da escala M1-M6/F1-F6 que games.level aceita (ex: 'iniciante' de contas
  -- antigas) — ignora silenciosamente em vez de rebentar a inserção do
  -- participante com uma violação de CHECK.
  IF v_member_level ~ '^[MF][1-6]$' THEN
    UPDATE games SET level = v_member_level, updated_at = NOW()
    WHERE id = NEW.game_id AND level IS NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS open_slot_level_lock_trigger ON participants;
CREATE TRIGGER open_slot_level_lock_trigger
AFTER INSERT ON participants
FOR EACH ROW EXECUTE FUNCTION lock_open_slot_level();
```

- [ ] **Step 2: Verify manually in the Supabase SQL Editor (dev project)**

Run, in order, after pasting the migration above:

```sql
-- 1. Columns exist with the right defaults.
SELECT column_name, column_default FROM information_schema.columns
WHERE table_name = 'games' AND column_name IN ('origin', 'open_batch_id');

-- 2. Re-running the file is a no-op (idempotency check) — run the whole
--    file a second time; it must succeed with no errors.

-- 3. Trigger fires and respects the level-scale guard. Replace the UUIDs
--    with a real organization_id/profile in your dev data, then:
INSERT INTO games (organization_id, title, date, origin)
VALUES ('<org-id>', 'Jogo em Aberto', NOW() + interval '1 day', 'open_slot')
RETURNING id \gset
INSERT INTO participants (game_id, user_id, status, joined_alone)
VALUES (:'id', '<profile-id-with-M4-membership-level>', 'confirmed', true);
SELECT level FROM games WHERE id = :'id'; -- expect 'M4' (or whatever that membership's level is)
```

Expected: columns present, second run of the file succeeds, `games.level` is set after the insert only when the joining member's `memberships.level` matches `^[MF][1-6]$`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migration_open_slots.sql
git commit -m "Add origin/open_batch_id columns + dynamic level-lock trigger for jogos em aberto (Trello #236)

Migration not yet run on Supabase — must be pasted into the SQL Editor
before any code depending on it (Tasks 2-8) reaches main."
```

**Note for whoever runs this next:** this migration must be run on the Supabase project (dev, then eventually prod) before Task 5's bot changes or Task 8's frontend changes go live — both assume `origin`/`open_batch_id` already exist.

---

### Task 2: Bot — open slots always visible regardless of group level filter

**Files:**
- Modify: `whatsapp-bot/src/groups.js:134-138`

**Interfaces:**
- Consumes: `game.origin` (from Task 1).
- Produces: `mixVisibleToGroup(game, group)` — unchanged signature, new behavior for `origin === 'open_slot'`.

- [ ] **Step 1: Write a throwaway verification script**

Create `whatsapp-bot/scratch_verify_visibility.mjs` (temporary, not committed):

```js
import { mixVisibleToGroup } from './src/groups.js'

const groupWithFilter = { levels: ['M5', 'M6'] }
const openSlotWithLevel = { origin: 'open_slot', level: 'M2' } // set by the Task 1 trigger
const regularMixWithLevel = { origin: 'admin', level: 'M2' }

console.assert(mixVisibleToGroup(openSlotWithLevel, groupWithFilter) === true, 'FAIL: open slot hidden by level filter')
console.assert(mixVisibleToGroup(regularMixWithLevel, groupWithFilter) === false, 'FAIL: regular mix filter regressed')
console.log('OK')
```

Run (from inside `whatsapp-bot/`, not the repo root — `groups.js` transitively imports `config.js`, which does `import 'dotenv/config'` and only finds `whatsapp-bot/.env` when the process's working directory is `whatsapp-bot/`): `node scratch_verify_visibility.mjs`
Expected: the first assertion currently FAILS (prints "FAIL: open slot hidden by level filter") because the function doesn't know about `origin` yet.

- [ ] **Step 2: Implement**

```js
/**
 * Regra de visibilidade grupo→nível: grupo sem filtro vê tudo; mix sem
 * nível aparece em todos os grupos do clube; caso contrário o nível do
 * mix tem de estar no filtro do grupo. Jogos em aberto (origin ===
 * 'open_slot') ignoram sempre o filtro de nível — o nível que lá aparece
 * é só informativo (ver design 2026-09-16), nunca deve fazer a mensagem
 * desaparecer de um grupo por o primeiro jogador ter travado um nível
 * fora do filtro desse grupo.
 */
export function mixVisibleToGroup(game, group) {
  if (game.origin === 'open_slot') return true
  if (!group.levels || group.levels.length === 0) return true
  if (!game.level) return true
  return group.levels.includes(game.level)
}
```

- [ ] **Step 3: Re-run the verification script**

Run (from inside `whatsapp-bot/`, not the repo root — `groups.js` transitively imports `config.js`, which does `import 'dotenv/config'` and only finds `whatsapp-bot/.env` when the process's working directory is `whatsapp-bot/`): `node scratch_verify_visibility.mjs`
Expected: `OK` printed, no assertion failures.

- [ ] **Step 4: Delete the throwaway script and commit**

```bash
rm whatsapp-bot/scratch_verify_visibility.mjs
git add whatsapp-bot/src/groups.js
git commit -m "Bot: jogos em aberto ignoram sempre o filtro de nível do grupo"
```

---

### Task 3: Bot — keep numeric mix labels consistent once open slots exist

**Why this task exists:** `sync.js` numbers each *individually posted* mix message "01", "02"... in open-mix date order (roster.js's `buildMixMessage`). `commands.js` independently recomputes the same numbering to resolve "In 01". Once open-slot games (rendered as one combined message, never individually numbered — Task 5) sit in the same open-mixes list, both places must agree to *skip* open-slot games when assigning numbers, or "In 03" spoken about a real mix could resolve to the wrong game.

**Files:**
- Modify: `whatsapp-bot/src/roster.js` (add exports, after `getOpenMixes`, i.e. after line 124)
- Modify: `whatsapp-bot/src/commands.js:114-124, 180-191`

**Interfaces:**
- Produces: `labelableMixes(openMixes)`, `mixLabel(mix, labelable)` — exported from `roster.js`.
- Consumes: `mix.origin` (Task 1), `mix.id`.

- [ ] **Step 1: Write a throwaway verification script**

Create `whatsapp-bot/scratch_verify_labels.mjs` (temporary):

```js
import { labelableMixes, mixLabel } from './src/roster.js'

const mixes = [
  { id: 'a', origin: 'admin' },
  { id: 'b', origin: 'open_slot' },
  { id: 'c', origin: 'admin' },
]
const labelable = labelableMixes(mixes)
console.assert(labelable.length === 2, 'FAIL: open_slot not excluded from labelable set')
console.assert(mixLabel(mixes[0], labelable) === '01', `FAIL: expected 01, got ${mixLabel(mixes[0], labelable)}`)
console.assert(mixLabel(mixes[1], labelable) === null, `FAIL: open_slot mix should never get a number, got ${mixLabel(mixes[1], labelable)}`)
console.assert(mixLabel(mixes[2], labelable) === '02', `FAIL: expected 02, got ${mixLabel(mixes[2], labelable)}`)
console.log('OK')
```

Run (from inside `whatsapp-bot/`, not the repo root — same reason as Task 2's Step 1): `node scratch_verify_labels.mjs`
Expected: FAILS — `labelableMixes`/`mixLabel` don't exist yet (`TypeError: labelableMixes is not a function`).

- [ ] **Step 2: Add the helpers to `roster.js`**

Insert immediately after `getOpenMixes` (after line 124):

```js
/** Mixes eligible for a sequential "01"/"02" number — jogos em aberto (origin === 'open_slot') are never individually numbered, since they're rendered as one combined message (see openSlots.js), not one message per mix. Order matters: callers pass `openMixes` already sorted by date (getOpenMixes does this). */
export function labelableMixes(openMixes) {
  return openMixes.filter((m) => m.origin !== 'open_slot')
}

/** `mix`'s own "01"/"02" label, or null when there's nothing to disambiguate (0 or 1 labelable mixes) or when `mix` itself isn't labelable (a jogo em aberto). */
export function mixLabel(mix, labelable) {
  if (labelable.length <= 1) return null
  const idx = labelable.findIndex((m) => m.id === mix.id)
  return idx === -1 ? null : String(idx + 1).padStart(2, '0')
}
```

- [ ] **Step 3: Re-run the verification script, expect it to pass now**

Run (from inside `whatsapp-bot/`, not the repo root — same reason as Task 2's Step 1): `node scratch_verify_labels.mjs`
Expected: `OK`.

- [ ] **Step 4: Wire the helpers into `commands.js`**

In `commands.js`, add `labelableMixes, mixLabel` to the existing `roster.js` import at the top of the file, then replace the two label computations:

Replace lines 114-124:
```js
/** Formats `matches` (a subset of `allOpenMixes`) for a disambiguation reply — labels come from each mix's position in the FULL open list, not the filtered subset, so they match what's printed on that mix's own WhatsApp message. */
function formatMixListForReply(matches, allOpenMixes, lang) {
  const total = allOpenMixes.length
  return matches
    .map((mix) => {
      const idx = allOpenMixes.findIndex((m) => m.id === mix.id)
      const label = total > 1 ? String(idx + 1).padStart(2, '0') : null
      return formatMixLine(mix, lang, label)
    })
    .join('\n')
}
```
with:
```js
/** Formats `matches` (a subset of `allOpenMixes`) for a disambiguation reply — labels come from each mix's position in the FULL open list (excluding jogos em aberto, which are never numbered — see mixLabel), so they match what's printed on that mix's own WhatsApp message. */
function formatMixListForReply(matches, allOpenMixes, lang) {
  const labelable = labelableMixes(allOpenMixes)
  return matches.map((mix) => formatMixLine(mix, lang, mixLabel(mix, labelable))).join('\n')
}
```

Replace line 180-191 (`matchOpenMixesByText`'s body):
```js
function matchOpenMixesByText(openMixes, rest, { glued }) {
  const tokens = rest.split(' ').filter(Boolean)
  let anyStructuredHit = false

  const matched = openMixes.filter((mix, i) => {
    const label = openMixes.length > 1 ? String(i + 1).padStart(2, '0') : null
    return tokens.every((token) => {
      const hit = mixMatchesToken(mix, token, label)
      if (hit) anyStructuredHit = true
      return hit
    })
  })
```
with:
```js
function matchOpenMixesByText(openMixes, rest, { glued }) {
  const tokens = rest.split(' ').filter(Boolean)
  const labelable = labelableMixes(openMixes)
  let anyStructuredHit = false

  const matched = openMixes.filter((mix) => {
    const label = mixLabel(mix, labelable)
    return tokens.every((token) => {
      const hit = mixMatchesToken(mix, token, label)
      if (hit) anyStructuredHit = true
      return hit
    })
  })
```

(the rest of `matchOpenMixesByText`, from the `if (anyStructuredHit || glued)` line onward, is unchanged)

- [ ] **Step 5: Manual smoke check**

Run, from inside `whatsapp-bot/` (not the repo root — `config.js` does `import 'dotenv/config'`, which loads `.env` relative to the current working directory, and `whatsapp-bot/.env` won't be found from anywhere else): `node -e "import('./src/commands.js').then(() => console.log('module loads OK'))"`.
Expected: `module loads OK`, no import/syntax errors (this file isn't unit-testable in isolation without a Supabase connection, so a load-check is the practical ceiling here — full behavior is covered by Task 6's manual WhatsApp test).

- [ ] **Step 6: Delete the throwaway script and commit**

```bash
rm whatsapp-bot/scratch_verify_labels.mjs
git add whatsapp-bot/src/roster.js whatsapp-bot/src/commands.js
git commit -m "Bot: jogos em aberto nunca recebem número de mix (01/02) — só se juntam por hora"
```

---

### Task 4: Bot — compact combined message renderer for a batch of open slots

**Files:**
- Create: `whatsapp-bot/src/openSlots.js`

**Interfaces:**
- Consumes: `supabase` (`whatsapp-bot/src/supabase.js`), `nameWithBand` (`whatsapp-bot/src/elo.js:23`), `helpFooter` (`whatsapp-bot/src/messages.js:3`).
- Produces: `loadOpenSlotBatch(batchId)` → `{ batchId, games: [{ game, people }] }` (sorted by `game.date`), `buildOpenSlotsMessage(batch)` → `string`. Both consumed by Task 5 (`sync.js`).

- [ ] **Step 1: Write a throwaway verification script for `buildOpenSlotsMessage`**

`buildOpenSlotsMessage` is pure (no DB access) so it can be verified directly. Create `whatsapp-bot/scratch_verify_openslots_message.mjs` (temporary):

```js
import { buildOpenSlotsMessage } from './src/openSlots.js'

const batch = {
  games: [
    {
      game: { id: '1', date: '2026-09-16T12:00:00+01:00', num_courts: 1, court_time_minutes: 90, max_players: 4, level: null, price_per_player: 5 },
      people: [],
    },
    {
      game: { id: '2', date: '2026-09-16T13:00:00+01:00', num_courts: 1, court_time_minutes: 90, max_players: 4, level: 'M4', price_per_player: 5 },
      people: [{ name: 'João', rating: null, gender: null }],
    },
  ],
}

const text = buildOpenSlotsMessage(batch)
console.assert(text.includes('JOGOS ABERTOS'), 'FAIL: missing header')
console.assert(text.includes('12:00-13:30'), 'FAIL: missing first slot time range')
console.assert(text.includes('👥 0/4 jogadores'), 'FAIL: missing empty-slot count')
console.assert(!text.includes('vaga livre'), 'FAIL: must never show empty-vaga placeholders')
console.assert(text.includes('(Nível: M4)'), 'FAIL: missing dynamic level display')
console.assert(text.includes('João'), 'FAIL: joined player not listed')
console.log(text)
console.log('OK')
```

Run (from inside `whatsapp-bot/`, not the repo root — same reason as Task 2's Step 1): `node scratch_verify_openslots_message.mjs`
Expected: FAILS — `openSlots.js` doesn't exist yet.

- [ ] **Step 2: Implement `whatsapp-bot/src/openSlots.js`**

```js
import { supabase } from './supabase.js'
import { helpFooter } from './messages.js'
import { nameWithBand } from './elo.js'
import { formatCurrency } from './roster.js'

/** Loads every game in one "jogos em aberto" batch plus its confirmed participants, in the same flattened shape roster.js's loadGame uses (partners included). One combined message covers the whole batch (see buildOpenSlotsMessage), so this loads all its games in two queries instead of one per game. */
export async function loadOpenSlotBatch(batchId) {
  const { data: games, error: gamesError } = await supabase
    .from('games')
    .select('*')
    .eq('open_batch_id', batchId)
    .order('date', { ascending: true })
  if (gamesError) throw new Error(`Failed to load open-slot batch ${batchId}: ${gamesError.message}`)

  const gameIds = games.map((g) => g.id)
  const { data: participants, error: participantsError } = await supabase
    .from('participants')
    .select('game_id, user_id, partner_id')
    .in('game_id', gameIds)
    .eq('status', 'confirmed')
    .order('created_at', { ascending: true })
  if (participantsError) {
    throw new Error(`Failed to load participants for batch ${batchId}: ${participantsError.message}`)
  }

  const profileIds = new Set()
  for (const row of participants) {
    profileIds.add(row.user_id)
    if (row.partner_id) profileIds.add(row.partner_id)
  }

  let profilesById = new Map()
  if (profileIds.size > 0) {
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, name, rating, gender')
      .in('id', Array.from(profileIds))
    if (profilesError) throw new Error(`Failed to load profiles for batch ${batchId}: ${profilesError.message}`)
    profilesById = new Map(profiles.map((p) => [p.id, p]))
  }

  const FALLBACK_PERSON = { name: 'Jogador', rating: null, gender: null }
  const byGameId = new Map(gameIds.map((id) => [id, []]))
  for (const row of participants) {
    const people = byGameId.get(row.game_id)
    people.push(profilesById.get(row.user_id) || FALLBACK_PERSON)
    if (row.partner_id) people.push(profilesById.get(row.partner_id) || FALLBACK_PERSON)
  }

  return { batchId, games: games.map((game) => ({ game, people: byGameId.get(game.id) || [] })) }
}

const LOCALE = 'pt-PT'

function formatTimeRange(date, durationMinutes) {
  const start = new Date(date)
  const end = new Date(start.getTime() + durationMinutes * 60_000)
  const fmt = (d) => d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Lisbon' })
  return `${fmt(start)}-${fmt(end)}`
}

function formatBatchDateHeader(date) {
  const d = new Date(date)
  const today = new Date()
  const isToday = d.toLocaleDateString('en-CA', { timeZone: 'Europe/Lisbon' }) === today.toLocaleDateString('en-CA', { timeZone: 'Europe/Lisbon' })
  const weekday = d.toLocaleDateString(LOCALE, { weekday: 'long', timeZone: 'Europe/Lisbon' })
  const capitalized = weekday.charAt(0).toUpperCase() + weekday.slice(1)
  return isToday ? `Hoje (${capitalized})` : capitalized
}

/**
 * One combined WhatsApp message per batch of jogos em aberto — deliberately
 * NOT one message per slot (unlike regular mixes, see roster.js), and
 * deliberately never shows an empty-vaga placeholder line (Renato,
 * 2026-09-16: avoid the giant wall-of-circles look of the reference bot).
 * Joining/leaving a specific slot is always by hour ("In 18"), resolved
 * generically by commands.js's existing matchOpenMixesByText — this
 * function only renders, it never assigns numeric labels (see roster.js's
 * labelableMixes/mixLabel, Task 3).
 */
export function buildOpenSlotsMessage(batch) {
  const [first] = batch.games
  const lines = [`🟡 *JOGOS ABERTOS* — ${formatBatchDateHeader(first.game.date)}`]
  if (first.game.price_per_player > 0) {
    lines.push(`💶 ${formatCurrency(first.game.price_per_player)}/jogador`)
  }
  lines.push('')

  for (const { game, people } of batch.games) {
    const capacity = game.max_players || game.num_courts * 4
    const timeRange = formatTimeRange(game.date, game.court_time_minutes)
    const levelSuffix = game.level ? ` (Nível: ${game.level})` : ''
    const isFull = people.length >= capacity
    const statusEmoji = isFull ? '🔒' : '🕐'
    lines.push(`${statusEmoji} ${timeRange}  👥 ${people.length}/${capacity} jogadores${levelSuffix}`)
    for (const person of people) {
      lines.push(`   • ${nameWithBand(person)}`)
    }
  }

  lines.push('')
  lines.push('🙋 Escreve *In* seguido da hora para entrares (ex: *In 18*), *Out* + hora para saíres.')
  return lines.join('\n') + helpFooter('pt')
}
```

- [ ] **Step 3: Re-run the verification script**

Run (from inside `whatsapp-bot/`, not the repo root — same reason as Task 2's Step 1): `node scratch_verify_openslots_message.mjs`
Expected: `OK`, printed message shows the expected header/time-range/level/name lines and never a "vaga livre"-style placeholder.

- [ ] **Step 4: Delete the throwaway script and commit**

```bash
rm whatsapp-bot/scratch_verify_openslots_message.mjs
git add whatsapp-bot/src/openSlots.js
git commit -m "Bot: mensagem combinada compacta para lotes de jogos em aberto"
```

---

### Task 5: Bot — wire open-slot batches into the Realtime repost pipeline

**Files:**
- Modify: `whatsapp-bot/src/sync.js`

**Interfaces:**
- Consumes: `loadOpenSlotBatch`, `buildOpenSlotsMessage` (Task 4); `mixVisibleToGroup` (Task 2, already imported).
- Produces: no new exports — `postGroupRoster`/`primeGroupHashes` now also handle `origin === 'open_slot'` games via one combined message per `open_batch_id`, tracked in `st.openSlotBatches`.

- [ ] **Step 1: Add the import and new per-group state**

At the top of `sync.js`, change:
```js
import { loadGame, getOpenMixes, buildMixMessage, recordMixMessage } from './roster.js'
```
to:
```js
import { loadGame, getOpenMixes, buildMixMessage, recordMixMessage } from './roster.js'
import { loadOpenSlotBatch, buildOpenSlotsMessage } from './openSlots.js'
```

In `stateFor` (lines 21-34), add `openSlotBatches: new Map()` to the initial state object:
```js
function stateFor(groupJid) {
  let st = groupState.get(groupJid)
  if (!st) {
    st = {
      debounceTimer: null,
      lastPostAt: 0,
      mixes: new Map(), // gameId -> { hash, messageId }
      openSlotBatches: new Map(), // batchId -> { hash, messageId }
      pendingTagAll: false,
      pendingPromotedByGame: new Map(),
    }
    groupState.set(groupJid, st)
  }
  return st
}
```

- [ ] **Step 2: Replace `postGroupRoster` (lines 53-101) in full**

Replace the entire function with:

```js
async function postGroupRoster(sendText, getGroupMentions, group, { tagAll = false, promotedByGameId = new Map() } = {}) {
  const visibleMixes = (await getOpenMixes(group.organizationId)).filter((mix) => mixVisibleToGroup(mix, group))
  const openMixes = visibleMixes.filter((mix) => mix.origin !== 'open_slot')
  const openSlotMixes = visibleMixes.filter((mix) => mix.origin === 'open_slot')
  const mixStates = await Promise.all(openMixes.map((mix) => loadGame(mix.id)))
  const st = stateFor(group.groupJid)
  const total = mixStates.length
  const seenGameIds = new Set()
  const mentions = tagAll && (total > 0 || openSlotMixes.length > 0) ? await getGroupMentions(group.groupJid) : null
  // At most one @all per flush, however many mixes' messages (or the open-
  // slot batch message) end up resent in it — shared across both loops
  // below so a brand-new mix and a brand-new open-slot batch in the same
  // flush don't each carry their own @all.
  let taggedThisFlush = false

  for (let i = 0; i < mixStates.length; i++) {
    const state = mixStates[i]
    const gameId = state.game.id
    seenGameIds.add(gameId)
    const label = total > 1 ? String(i + 1).padStart(2, '0') : null

    // Hash only the base message, never the one-time promotion callout — a
    // later reconcile tick never carries a promo, so hashing the
    // promo-prefixed text would make that tick look "different" from an
    // otherwise-unchanged mix and re-send it minus the callout.
    const baseText = buildMixMessage(state, { label })
    const nextHash = hash(baseText)
    const prev = st.mixes.get(gameId)
    if (prev && prev.hash === nextHash) continue

    const promo = promotedByGameId.get(gameId)
    const promoText = promo ? `${t('promoted_to_confirmed', promo.lang ?? 'pt', { name: promo.name })}\n\n` : ''
    const text = promoText + baseText
    const shouldTagThis = tagAll && !taggedThisFlush
    const fullText = shouldTagThis ? `📢 @all\n\n${text}` : text

    const messageId = await sendText(group.groupJid, fullText, shouldTagThis ? { mentions } : {})
    if (shouldTagThis) taggedThisFlush = true
    st.mixes.set(gameId, { hash: nextHash, messageId })
    if (messageId) recordMixMessage(messageId, gameId)
  }

  // Drop mixes no longer open, so a later reappearance (e.g. level filter
  // toggled off then back on) resends fresh instead of being swallowed as
  // "same as last post".
  for (const gameId of st.mixes.keys()) {
    if (!seenGameIds.has(gameId)) st.mixes.delete(gameId)
  }

  // Jogos em aberto: uma mensagem combinada por open_batch_id, nunca uma
  // por slot (ver openSlots.js).
  const batchIds = new Set(openSlotMixes.map((m) => m.open_batch_id).filter(Boolean))
  const seenBatchIds = new Set()
  for (const batchId of batchIds) {
    seenBatchIds.add(batchId)
    const batch = await loadOpenSlotBatch(batchId)
    if (batch.games.length === 0) continue
    const baseText = buildOpenSlotsMessage(batch)
    const nextHash = hash(baseText)
    const prev = st.openSlotBatches.get(batchId)
    if (prev && prev.hash === nextHash) continue

    const shouldTagThis = tagAll && !taggedThisFlush
    const fullText = shouldTagThis ? `📢 @all\n\n${baseText}` : baseText
    const messageId = await sendText(group.groupJid, fullText, shouldTagThis ? { mentions } : {})
    if (shouldTagThis) taggedThisFlush = true
    st.openSlotBatches.set(batchId, { hash: nextHash, messageId })
  }

  for (const batchId of st.openSlotBatches.keys()) {
    if (!seenBatchIds.has(batchId)) st.openSlotBatches.delete(batchId)
  }
}
```

- [ ] **Step 3: Mirror the same split in `primeGroupHashes`**

Replace:
```js
async function primeGroupHashes() {
  const groups = await getGroups()
  for (const group of groups) {
    try {
      const openMixes = (await getOpenMixes(group.organizationId)).filter((mix) => mixVisibleToGroup(mix, group))
      const mixStates = await Promise.all(openMixes.map((mix) => loadGame(mix.id)))
      const total = mixStates.length
      const st = stateFor(group.groupJid)
      for (let i = 0; i < mixStates.length; i++) {
        const state = mixStates[i]
        const label = total > 1 ? String(i + 1).padStart(2, '0') : null
        st.mixes.set(state.game.id, { hash: hash(buildMixMessage(state, { label })), messageId: null })
      }
    } catch (err) {
      console.error(`Failed to prime roster hash for ${group.groupJid}:`, err)
    }
  }
}
```
with:
```js
async function primeGroupHashes() {
  const groups = await getGroups()
  for (const group of groups) {
    try {
      const visibleMixes = (await getOpenMixes(group.organizationId)).filter((mix) => mixVisibleToGroup(mix, group))
      const openMixes = visibleMixes.filter((mix) => mix.origin !== 'open_slot')
      const openSlotMixes = visibleMixes.filter((mix) => mix.origin === 'open_slot')
      const mixStates = await Promise.all(openMixes.map((mix) => loadGame(mix.id)))
      const total = mixStates.length
      const st = stateFor(group.groupJid)
      for (let i = 0; i < mixStates.length; i++) {
        const state = mixStates[i]
        const label = total > 1 ? String(i + 1).padStart(2, '0') : null
        st.mixes.set(state.game.id, { hash: hash(buildMixMessage(state, { label })), messageId: null })
      }

      const batchIds = new Set(openSlotMixes.map((m) => m.open_batch_id).filter(Boolean))
      for (const batchId of batchIds) {
        const batch = await loadOpenSlotBatch(batchId)
        if (batch.games.length === 0) continue
        st.openSlotBatches.set(batchId, { hash: hash(buildOpenSlotsMessage(batch)), messageId: null })
      }
    } catch (err) {
      console.error(`Failed to prime roster hash for ${group.groupJid}:`, err)
    }
  }
}
```

- [ ] **Step 4: Manual smoke check**

Run, from inside `whatsapp-bot/` (not the repo root — see Task 3 Step 5's note on why): `node -e "import('./src/sync.js').then(() => console.log('module loads OK'))"`.
Expected: `module loads OK`, no import/syntax errors.

- [ ] **Step 5: Manual end-to-end check against a real (dev) WhatsApp group**

This is the point where the bot's actual behavior needs eyes on a real group, since there's no automated test harness for it:

1. Run Task 1's migration on the dev Supabase project if not already done.
2. Start the bot locally against dev (`whatsapp-bot`: whatever the existing local-run instructions are — check `whatsapp-bot/README.md` or `DEPLOYMENT.md` if unsure) connected to a real test WhatsApp group already registered in `whatsapp_groups`.
3. Insert 2-3 `games` rows sharing one `open_batch_id` (`origin = 'open_slot'`, different `date`/`court_time_minutes`) directly via SQL, or via Task 8's UI once built.
4. Confirm: **one** combined message appears in the group, no empty-vaga placeholders, showing each slot's time range and `0/4 jogadores`.
5. From a phone in that group, reply "In 18" (matching one slot's hour) — confirm the combined message is edited/reposted showing `1/4` and the joiner's name under that slot, and `(Nível: ...)` if that profile has a club level in the `M/F`+digit scale.
6. Reply "In" bare with 2+ open slots still open — confirm the bot asks which one (disambiguation), not a silent wrong join.
7. Fill a slot to 4/4 — confirm its line switches to 🔒 and stays in the combined message (does not vanish, does not appear in the normal Mixes list per Task 8's filter).

- [ ] **Step 6: Commit**

```bash
git add whatsapp-bot/src/sync.js
git commit -m "Bot: publica/atualiza jogos em aberto como uma mensagem combinada por lote"
```

**Reminder:** this bot has no CI/auto-deploy — after this lands on `dev`/`main`, it still needs a manual redeploy to the EC2 instance per club before it takes effect (per `CLAUDE.md`).

---

### Task 6: Frontend — pure batch-builder helper + tests

**Files:**
- Create: `src/lib/openSlots.js`
- Create: `src/lib/openSlots.test.js`

**Interfaces:**
- Produces: `buildOpenSlotRows({ organizationId, date, priceDefault, timeRanges, createdBy })` → `{ batchId, rows }`, where each row is a ready-to-insert `games` payload. Consumed by Task 7 (`OpenSlotsPanel.jsx`).

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest'
import { buildOpenSlotRows } from './openSlots'

describe('buildOpenSlotRows', () => {
  it('builds one row per time range, sharing one batch id', () => {
    const { batchId, rows } = buildOpenSlotRows({
      organizationId: 'org-1',
      date: '2026-09-16',
      priceDefault: 5,
      timeRanges: [
        { start: '12:00', end: '13:30' },
        { start: '13:00', end: '14:30' },
      ],
      createdBy: 'user-1',
    })

    expect(rows).toHaveLength(2)
    expect(rows[0].open_batch_id).toBe(batchId)
    expect(rows[1].open_batch_id).toBe(batchId)
    expect(rows[0].organization_id).toBe('org-1')
    expect(rows[0].origin).toBe('open_slot')
    expect(rows[0].title).toBe('Jogo em Aberto')
    expect(rows[0].price_per_player).toBe(5)
    expect(rows[0].created_by).toBe('user-1')
    expect(rows[0].status).toBe('open')
    // 12:00 -> 13:30 on 2026-09-16, Portugal wall-clock (WEST, UTC+1 in September)
    expect(rows[0].date).toBe(new Date('2026-09-16T12:00:00+01:00').toISOString())
    expect(rows[0].court_time_minutes).toBe(90)
    expect(rows[1].court_time_minutes).toBe(90)
  })

  it('rejects an end time before the start time', () => {
    expect(() =>
      buildOpenSlotRows({
        organizationId: 'org-1',
        date: '2026-09-16',
        priceDefault: null,
        timeRanges: [{ start: '14:00', end: '13:00' }],
        createdBy: 'user-1',
      })
    ).toThrow(/hora de fim/)
  })

  it('omits price_per_player when no default is set', () => {
    const { rows } = buildOpenSlotRows({
      organizationId: 'org-1',
      date: '2026-09-16',
      priceDefault: null,
      timeRanges: [{ start: '12:00', end: '13:00' }],
      createdBy: 'user-1',
    })
    expect(rows[0].price_per_player).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/lib/openSlots.test.js`
Expected: FAIL — `Failed to resolve import "./openSlots"` (module doesn't exist yet).

- [ ] **Step 3: Implement `src/lib/openSlots.js`**

```js
// Pure builder for a batch of "jogo em aberto" games rows — no Supabase
// calls here, so the admin UI (OpenSlotsPanel.jsx) can preview/validate a
// batch before publishing it. num_courts/max_players/format are left out
// of each row deliberately: their schema defaults (1 court, 4 players,
// 'sobe_desce') are already exactly right for a single 4-player slot.
export function buildOpenSlotRows({ organizationId, date, priceDefault, timeRanges, createdBy }) {
  const batchId = crypto.randomUUID()

  const rows = timeRanges.map(({ start, end }) => {
    const startDate = new Date(`${date}T${start}:00`)
    const endDate = new Date(`${date}T${end}:00`)
    const courtTimeMinutes = Math.round((endDate.getTime() - startDate.getTime()) / 60000)
    if (courtTimeMinutes <= 0) {
      throw new Error(`Hora de fim (${end}) tem de ser depois da hora de início (${start}).`)
    }

    return {
      organization_id: organizationId,
      title: 'Jogo em Aberto',
      date: startDate.toISOString(),
      court_time_minutes: courtTimeMinutes,
      price_per_player: priceDefault ?? null,
      origin: 'open_slot',
      open_batch_id: batchId,
      created_by: createdBy,
      status: 'open',
    }
  })

  return { batchId, rows }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/lib/openSlots.test.js`
Expected: PASS, all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/openSlots.js src/lib/openSlots.test.js
git commit -m "Add buildOpenSlotRows helper for publishing jogos em aberto batches"
```

---

### Task 7: Frontend — "Jogos Abertos" panel component

**Files:**
- Create: `src/components/OpenSlotsPanel.jsx`

**Interfaces:**
- Consumes: `buildOpenSlotRows` (Task 6), `supabase` (`../lib/supabase`), `PrimaryButton`/`Select` (`./ui`), `useAuth` (`../contexts/AuthContext`).
- Produces: `<OpenSlotsPanel organizationId={string} />` — self-contained: loads its own `open_slot` games, publish form, cancel action. Consumed by Task 8 (`GerirClube.jsx`).

- [ ] **Step 1: Implement the component**

```jsx
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2, Clock } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { PrimaryButton } from './ui'
import { buildOpenSlotRows } from '../lib/openSlots'

const EMPTY_RANGE = () => ({ start: '', end: '' })

export default function OpenSlotsPanel({ organizationId }) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [slots, setSlots] = useState([])
  const [loading, setLoading] = useState(true)
  const [date, setDate] = useState('')
  const [price, setPrice] = useState('')
  const [ranges, setRanges] = useState([EMPTY_RANGE()])

  const loadOpenSlots = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('games')
      .select('*, participants(id, status)')
      .eq('organization_id', organizationId)
      .eq('origin', 'open_slot')
      .order('date', { ascending: false })

    if (error) {
      console.error('Error loading open slots:', error)
    } else {
      setSlots(data || [])
    }
    setLoading(false)
  }

  useEffect(() => {
    if (organizationId) loadOpenSlots()
  }, [organizationId])

  const addRange = () => setRanges([...ranges, EMPTY_RANGE()])
  const removeRange = (index) => setRanges(ranges.filter((_, i) => i !== index))
  const updateRange = (index, field, value) => {
    setRanges(ranges.map((r, i) => (i === index ? { ...r, [field]: value } : r)))
  }

  const handlePublish = async () => {
    const validRanges = ranges.filter((r) => r.start && r.end)
    if (!date || validRanges.length === 0) {
      alert(t('open_slots.error_missing_fields'))
      return
    }

    let rows
    try {
      ;({ rows } = buildOpenSlotRows({
        organizationId,
        date,
        priceDefault: price === '' ? null : parseFloat(price),
        timeRanges: validRanges,
        createdBy: user.id,
      }))
    } catch (err) {
      alert(err.message)
      return
    }

    const { error } = await supabase.from('games').insert(rows)
    if (error) {
      console.error('Error publishing open slots:', error)
      alert(t('open_slots.error_publish') + error.message)
      return
    }

    setDate('')
    setPrice('')
    setRanges([EMPTY_RANGE()])
    loadOpenSlots()
  }

  const handleCancel = async (slotId) => {
    if (!confirm(t('open_slots.confirm_cancel'))) return
    const { error } = await supabase.from('games').update({ status: 'cancelled' }).eq('id', slotId)
    if (error) {
      console.error('Error cancelling open slot:', error)
      alert(t('open_slots.error_cancel'))
      return
    }
    loadOpenSlots()
  }

  const confirmedCount = (slot) => (slot.participants || []).filter((p) => p.status === 'confirmed').length
  const capacity = (slot) => slot.max_players || slot.num_courts * 4

  return (
    <div className="space-y-4">
      <div className="bg-surface border border-line rounded-ctrl p-4 space-y-3">
        <h3 className="font-extrabold text-ink-900">{t('open_slots.publish_title')}</h3>
        <div>
          <label className="text-sm font-bold text-ink-700">{t('open_slots.date_label')}</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="input-field w-full mt-1"
          />
        </div>
        <div>
          <label className="text-sm font-bold text-ink-700">{t('open_slots.price_label')}</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="input-field w-full mt-1"
            placeholder={t('open_slots.price_placeholder')}
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-bold text-ink-700">{t('open_slots.ranges_label')}</label>
          {ranges.map((range, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="time"
                value={range.start}
                onChange={(e) => updateRange(i, 'start', e.target.value)}
                className="input-field flex-1"
              />
              <span className="text-muted">–</span>
              <input
                type="time"
                value={range.end}
                onChange={(e) => updateRange(i, 'end', e.target.value)}
                className="input-field flex-1"
              />
              {ranges.length > 1 && (
                <button onClick={() => removeRange(i)} className="text-danger p-2" aria-label={t('open_slots.remove_range')}>
                  <Trash2 size={18} />
                </button>
              )}
            </div>
          ))}
          <button onClick={addRange} className="text-sm font-bold text-ink-700 flex items-center gap-1">
            <Plus size={16} /> {t('open_slots.add_range')}
          </button>
        </div>
        <PrimaryButton onClick={handlePublish} className="w-full">
          {t('open_slots.publish_button')}
        </PrimaryButton>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-ink-700"></div>
        </div>
      ) : (
        <div className="space-y-2">
          {slots.length === 0 && <p className="text-muted text-sm">{t('open_slots.empty_list')}</p>}
          {slots.map((slot) => (
            <div key={slot.id} className="bg-surface border border-line rounded-ctrl p-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock size={16} className="text-muted" />
                <span className="font-bold">
                  {new Date(slot.date).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' })}
                </span>
                <span className="text-muted text-sm">
                  {confirmedCount(slot)}/{capacity(slot)} · {t(`open_slots.status_${slot.status}`)}
                </span>
              </div>
              {slot.status !== 'cancelled' && confirmedCount(slot) === 0 && (
                <button onClick={() => handleCancel(slot.id)} className="text-danger p-2" aria-label={t('open_slots.cancel_button')}>
                  <Trash2 size={18} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add i18n keys**

In `src/locales/pt.json`, add (alongside the existing `gerirclube.*` keys, same nesting level):
```json
"open_slots": {
  "publish_title": "Publicar jogos em aberto",
  "date_label": "Data",
  "price_label": "Preço por jogador (opcional)",
  "price_placeholder": "Ex: 5.00",
  "ranges_label": "Horários",
  "add_range": "Adicionar horário",
  "remove_range": "Remover horário",
  "publish_button": "Publicar no WhatsApp",
  "empty_list": "Ainda não publicaste nenhum jogo em aberto.",
  "confirm_cancel": "Cancelar este horário? Esta ação não pode ser desfeita.",
  "error_missing_fields": "Escolhe uma data e pelo menos um horário completo.",
  "error_publish": "Erro ao publicar jogos em aberto: ",
  "error_cancel": "Erro ao cancelar horário.",
  "cancel_button": "Cancelar",
  "status_open": "aberto",
  "status_closed": "fechado",
  "status_cancelled": "cancelado"
}
```

In `src/locales/en.json`, add the matching English block:
```json
"open_slots": {
  "publish_title": "Publish open games",
  "date_label": "Date",
  "price_label": "Price per player (optional)",
  "price_placeholder": "E.g. 5.00",
  "ranges_label": "Time slots",
  "add_range": "Add time slot",
  "remove_range": "Remove time slot",
  "publish_button": "Publish to WhatsApp",
  "empty_list": "You haven't published any open games yet.",
  "confirm_cancel": "Cancel this slot? This cannot be undone.",
  "error_missing_fields": "Pick a date and at least one complete time slot.",
  "error_publish": "Error publishing open games: ",
  "error_cancel": "Error cancelling slot.",
  "cancel_button": "Cancel",
  "status_open": "open",
  "status_closed": "closed",
  "status_cancelled": "cancelled"
}
```

- [ ] **Step 3: Manual verification (dev server)**

Run: `npm run dev`, log in as a club admin, navigate to Gerir do clube (this component isn't wired into a tab yet — Task 8 does that; for now, temporarily render `<OpenSlotsPanel organizationId={currentOrganizationId} />` anywhere in `GerirClube.jsx`'s JSX to eyeball it, then remove that temporary line before Task 8).
Expected: form renders, adding/removing time ranges works, publishing with a real `organizationId` inserts rows visible in Supabase's table editor with `origin = 'open_slot'` and a shared `open_batch_id`.

- [ ] **Step 4: Commit**

```bash
git add src/components/OpenSlotsPanel.jsx src/locales/pt.json src/locales/en.json
git commit -m "Add OpenSlotsPanel: publish/list/cancel jogos em aberto batches"
```

---

### Task 8: Frontend — wire "Jogos Abertos" into Gerir do clube

**Files:**
- Modify: `src/pages/GerirClube.jsx:1, 476-498, 1606-1636, 1645`

**Interfaces:**
- Consumes: `OpenSlotsPanel` (Task 7).
- Produces: new `activeTab === 'open_slots'` state value; `loadGames` now excludes `origin = 'open_slot'` rows.

- [ ] **Step 1: Exclude open slots from the normal Mixes list query**

In `loadGames` (line 476-498), add `.eq('origin', 'admin')` to the query chain:
```js
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
            is_paused,
            frequency,
            ends_type,
            ends_on,
            ends_after_occurrences,
            mix_offset_seconds
          )
        `)
        .eq('organization_id', currentOrganizationId)
        .eq('origin', 'admin')
        .order('date', { ascending: false })
```

- [ ] **Step 2: Import `OpenSlotsPanel` and the `Clock` icon (already imported at line 5)**

Add to the import block (line 14, alongside the existing component imports):
```js
import OpenSlotsPanel from '../components/OpenSlotsPanel'
```

- [ ] **Step 3: Add the tab button**

In the tab-button row (lines 1606-1636), add a third button after the "members" one (before the closing `</div>` at line 1635):
```jsx
          <button
            onClick={() => setActiveTab('open_slots')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-ctrl text-sm font-extrabold whitespace-nowrap transition-all duration-fast ${
              activeTab === 'open_slots'
                ? 'bg-canvas text-ink-900 shadow-lift border border-line'
                : 'text-muted hover:text-ink-900'
            }`}
          >
            <Clock size={16} />
            {t('gerirclube.tab_open_slots')}
          </button>
```

- [ ] **Step 4: Render the panel for that tab**

Immediately after the closing of the `{activeTab === 'games' && (...)}` block (which starts at line 1645 — find its matching closing `)}` and insert right after it), add:
```jsx
          {activeTab === 'open_slots' && (
            <OpenSlotsPanel organizationId={currentOrganizationId} />
          )}
```

- [ ] **Step 5: Add the tab label i18n key**

In `src/locales/pt.json`, inside the existing `gerirclube` object (alongside `"tab_games"`, `"tab_members"`), add:
```json
"tab_open_slots": "Jogos Abertos",
```

In `src/locales/en.json`, inside the existing `gerirclube` object:
```json
"tab_open_slots": "Open Games",
```

- [ ] **Step 6: Remove Task 7's temporary inline render, if still present**

Delete whatever temporary `<OpenSlotsPanel .../>` line was added for Task 7's Step 3 manual check, if it wasn't already removed.

- [ ] **Step 7: Run the full frontend test suite**

Run: `npm run test`
Expected: all existing tests pass (this task touches no logic covered by existing `mixLogic.test.js`/`scoringLogic.test.js`/`vouchers.test.js`/`openSlots.test.js` — this is a regression check, not new coverage).

- [ ] **Step 8: Manual verification (dev server)**

Run: `npm run dev`, log in as a club admin:
1. Confirm a new "Jogos Abertos" tab appears alongside "Jogos"/"Membros".
2. Publish a batch of 2 time slots for today.
3. Confirm they do **not** appear in the "Jogos" (Mixes) tab list.
4. Confirm they **do** appear in the "Jogos Abertos" tab with correct 0/4 counts.
5. Manually flip one slot's `status` to `'closed'` in Supabase (simulating it filling up) and refresh — confirm it still only shows in "Jogos Abertos", never in "Jogos".

- [ ] **Step 9: Commit**

```bash
git add src/pages/GerirClube.jsx src/locales/pt.json src/locales/en.json
git commit -m "Wire Jogos Abertos tab into Gerir do clube, exclude open slots from the Mixes list"
```

---

## Post-implementation checklist (not a task — a reminder)

- Task 1's migration must be run on the Supabase dev project before manually testing Tasks 5-8, and on prod before any of this reaches `main`.
- Task 5's bot changes need a manual EC2 redeploy per club after landing (no CI/auto-deploy for `whatsapp-bot/`).
- Per this repo's Trello + Slack workflow rule: update the Trello card (#236 or a new one tied to it — confirm which with the board), move it to Dev Done once pushed to `dev`, and only to Testing - QA once mirrored to `main` with the migration confirmed run.
