# Recurring mixes: pre-created "pending" occurrences (Phase 2)

## Context

Phase 1 ([2026-08-06-recurring-mixes-design.md](2026-08-06-recurring-mixes-design.md)) shipped time-based creation: a `game_recurrences` row holds the rule (frequency, when it ends, an offset), and every 5 minutes a cron function creates a brand-new `games` row the moment its scheduled creation time (`next_run_at`) arrives — creation and launch are the same instant.

Two real bugs and one product decision came out of using it:

1. **Bug:** the "Criar automaticamente em" date field is unconditionally hidden (`src/pages/Admin.jsx:860`) whenever editing a mix that's already the origin of an active recurrence — so turning "Mix recorrente" on for the very first time on an existing mix hides the field it needs. It also means this value can never be changed later, by design — but that's no longer wanted (see below).
2. **Product decision:** future occurrences should exist as real, editable rows *before* they're due — visible to the admin (so price/location can be tweaked ahead of time) with a "Pendente" state — rather than not existing at all until the cron creates them.
3. **Explicit requirement:** players must never see a `pending` mix. It only becomes visible the instant it's launched (flips to `open`).

This phase reworks the mechanism: the next occurrence is pre-created immediately whenever the current one launches, in a new `pending` status, and a separate "launch" step (still cron-driven, same 5-minute cadence) flips it to `open` when its scheduled time arrives.

## Schema changes

```sql
ALTER TABLE games ADD COLUMN launch_at TIMESTAMPTZ;
```
Only meaningful while `status = 'pending'` — the timestamp at which the cron flips it to `open`. `games.status` has no CHECK constraint today, so no migration is needed to add `'pending'` as a value.

```sql
ALTER TABLE game_recurrences DROP COLUMN next_run_at;
```
No longer needed — under the old model it was "when to create the next mix" (one shared value per recurrence); under the new model every `pending` row carries its own `launch_at`, so a shared per-recurrence "next time" doesn't mean anything anymore. `mix_offset_seconds` (the rule: how long before the mix date to launch) stays unchanged — its *meaning* doesn't shift, only how the admin enters it (see Frontend below).

**One-time backfill**, in the same migration, before the `DROP COLUMN`: any currently-active recurrence pre-creates its next occurrence as `pending` right now, using its existing `next_run_at` as that row's `launch_at` — otherwise every currently-active recurrence would silently stop producing new mixes the moment the old creation logic is replaced.

## Cron function rewrite

`process_due_game_recurrences()` no longer *creates* a mix when a schedule fires — it *launches* the currently-pending one and immediately pre-creates the one after that:

For every `games` row with `status = 'pending'` and `launch_at <= now()`, whose recurrence is still active:
1. Flip that row to `status = 'open'` (this is the moment the WhatsApp bot announces it — see below).
2. Compute the next date (current pending mix's date + one frequency step).
3. If that date is still within the recurrence's "ends" rule (never / on-date / after-N-occurrences), insert it as the new `pending` row, with `launch_at` = that date − `mix_offset_seconds`.
4. Otherwise, mark the recurrence `is_active = false` and stop — the mix that was just launched stays as the last one.

The `pg_cron` schedule itself (`SELECT cron.schedule('process-game-recurrences', '*/5 * * * *', ...)`) doesn't need re-registering — it calls the function by name, and `CREATE OR REPLACE FUNCTION` with the same signature is picked up automatically.

## WhatsApp bot — no changes needed

Verified against `whatsapp-bot/src/sync.js` and `roster.js`: the bot's `games` `INSERT` handler already ignores anything whose `status !== 'open'` (a `pending` insert is silently skipped), and `getOpenMixes()` already filters to `status IN ('open', 'closed')` (a `pending` mix never enters the roster message even via the periodic reconcile tick). When the cron later flips `pending → open`, that's an `UPDATE`, which the bot already treats as "new mix, announce with @all" — exactly the desired behavior, with zero bot-side changes.

## Frontend — Admin (`src/pages/Admin.jsx`)

- **Bug fix:** the "when to launch" field is no longer conditionally hidden — it shows whenever "Mix recorrente" is checked, both when enabling it for the first time and when editing an already-active recurrence's origin.
- **Input change:** replace the single absolute `DateTimeField` ("Criar automaticamente em") with two fields — a number input "Lançar quantos dias antes" and a time input "A que horas" — computing the same `mix_offset_seconds` value the rest of the system already expects: `mixDateTime - launchDateTime`, where `launchDateTime` is derived by subtracting the entered days from the mix's own date and setting the entered time of day.
- **`createRecurrence`:** after inserting the `game_recurrences` row and linking the origin mix, also insert the first future occurrence directly as `pending` (date = origin date advanced by one frequency step, `launch_at` = that date − offset) — under the old model this was left for the cron to create later; now it must exist immediately, same as every subsequent occurrence.
- **`updateRecurrence`:** in addition to updating the `game_recurrences` snapshot/rule (as today), also update the currently-pending occurrence's `launch_at` if the offset changed — changing "quantos dias antes" should affect the next launch, not just occurrences after that. It does **not** propagate title/location/price/etc. changes to the already-created pending row — that row is independently editable in the Jogos list if the admin wants to change it, which is a deliberate scope cut, not an oversight.
- **Jogos list:** a `pending` mix gets a distinct status badge (alongside the existing Aberto/Fechado/A decorrer/Terminado ones) — still editable and deletable like any other mix.

## Frontend — Player (`src/pages/Home.jsx`)

Add `pending` to the existing cancelled-only exclusion filter (`game.status !== 'cancelled'` → excludes `'cancelled'` and `'pending'`) — a pending mix is invisible to players everywhere in the app, not just de-emphasized. No new UI states, no `MixCard` variant, no `GameDetails.jsx` changes: since a pending mix never appears in any list, there's no navigation path that reaches it before it's launched.

## Known follow-up (tracked, not part of this change)

The multi-tenant branch (`worktree-multi-tenant-player-backoffice-split`, not yet pushed/merged) copied `Admin.jsx` into a new `GerirClube.jsx` before this fix existed. Whoever pushes that branch needs to port these same Admin.jsx changes into `GerirClube.jsx` first, or the recurring-mix bug and the "pending never visible to players" behavior regress the moment that branch lands. Already captured as a note on the "push the worktree" reminder.

## Testing

No automated test suite exists in this project — manual verification, matching every other migration in `supabase/`:

**SQL (manual, Supabase SQL editor):**
- Create a weekly recurring mix with a short offset (e.g. "1 dia antes, às 09:00"). Confirm a `pending` row for next week is created immediately, with the correct `launch_at`.
- Manually set that `launch_at` to the past, run `SELECT process_due_game_recurrences();`, confirm: the pending mix flips to `open`, and a new `pending` row for the week after exists with a fresh `launch_at`.
- Confirm a recurrence past its "ends" condition (e.g. `ends_after_occurrences` reached) stops producing new `pending` rows and flips `is_active` to `false`, without erroring.
- Run the backfill portion against a recurrence still using the old `next_run_at` value (before the column is dropped) and confirm it produces a sane `pending` row.

**Frontend (manual, in-browser):**
- Enable "Mix recorrente" on a plain existing mix for the first time — confirm the "quantos dias antes / a que horas" fields appear (the bug is fixed).
- Edit an already-recurring origin mix — confirm those same fields are visible and editable, and that changing them updates the currently-pending occurrence's launch time (verify in Supabase, `games.launch_at`).
- Confirm a `pending` mix shows in the admin's Jogos list with its own badge, and is editable/deletable.
- Confirm a `pending` mix does **not** appear anywhere in Home.jsx for a normal player.
- After manually launching a pending mix (flip status via SQL or by waiting for the cron), confirm it appears in Home.jsx and that the WhatsApp bot posts the @all announcement.
