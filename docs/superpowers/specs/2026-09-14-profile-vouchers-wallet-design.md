# Profile Vouchers Wallet — Design Spec

Date: 2026-09-14. Trello **#200** ("Página de Perfil: área 'Os meus vouchers' — ganhos e onde gastar"), requested by Francisco on 2026-09-09. Brainstormed and approved with Renato in a prior session; this document records the resulting design, not a re-opened discussion.

## Goal

Give a player a personal record of discount vouchers they've earned by winning mixes, and where to redeem them, on their own Profile page. A voucher is tied to a **mix (game)**, not to a partner/affiliate catalog — this sidesteps Trello **#199** ("Área de publicidade: clubes afiliados e parceiros de vouchers de desconto") entirely. #199's scope is still "to be defined" platform-wide and is explicitly **out of scope** here; this feature does not depend on it and introduces no coupling to it.

The trigger is a per-mix opt-in: an admin creating or editing a mix in `src/pages/GerirClube.jsx` toggles a new "tem voucher" checkbox. If it's on when the mix is finalized, the **two players of the winning team** — not every participant — each receive one voucher, described by the mix's existing free-text `prize` field (e.g. "10% desconto na loja X, apresenta este voucher no balcão"). No new text field: `prize` already doubles as the voucher's description and its redemption instructions.

## Key Decisions

**Why a per-mix flag instead of waiting for the #199 partner catalog?**
Francisco's request is narrowly "let a player see the vouchers they've won and where to spend them" — it doesn't require a platform-wide catalog of affiliated businesses, and #199's scope isn't defined yet. Confirmed with Renato: keep #200 fully self-contained. If #199 ships later, it can grow into "voucher templates a partner defines" without changing how a player *reads* their own wallet — the `vouchers` table and its RLS shape don't need to know a partner catalog exists.

**Why only the winning team's two players, not every participant?**
This mirrors how the `prize` field already reads today ("Vouchers para os vencedores" is literally the existing placeholder copy for it in `pt.json`) — the product intent for `prize` has always been "reward for winning," not "perk for playing." Awarding to all participants would silently redefine what the field has meant since it shipped.

**Why a dedicated `vouchers` table instead of adding columns to `mix_player_stats`?**
`mix_player_stats` is about match/mix statistics (points, wins, matches played) computed for every participant of every mix. A voucher is neither: it applies to 2 of N participants, only on mixes with `has_voucher = true`, and carries its own lifecycle (`por_usar`/`usado`, `used_at`). Bolting it onto `mix_player_stats` would leave those columns `NULL` for the overwhelming majority of rows and conflate two unrelated concerns. `player_trophies` (from `migration_trophies.sql`) is the closer precedent — a small, purpose-built table keyed by `(subject, source)`, with SELECT-only RLS and all writes behind a `SECURITY DEFINER` function — and `vouchers` follows that shape directly.

**Why no expiry/validity window?**
Explicit YAGNI call, confirmed with Renato: this is a pilot feature for a handful of clubs, and an expiry column implies either a cron sweep or client-side "is this stale" logic that nobody asked for. Only two states exist: `por_usar` and `usado`. If #199 later needs expiring vouchers (e.g., a partner-defined validity window), that's a natural extension of this table — noted under Out of Scope, not designed here.

**Why does `mark_voucher_used` have no undo?**
Confirmed with Renato: keep it simple. A voucher marked "usado" was, by definition, just redeemed at a till — there's no realistic scenario where a player needs to reverse that from the app, and adding `mark_voucher_unused` would only invite accidental taps to matter more, not less. The `confirm()` gate before calling the RPC (see UI Changes) is the safety net, matching this repo's existing rule for irreversible actions.

**Does `has_voucher` propagate from `game_recurrences` to the mixes it spawns?**
Yes — mirroring exactly how `prize` itself already propagates (see Data Model). A recurring mix series is one admin decision repeated on a cadence; if the series has a voucher prize this week, the reasonable default is that it keeps having one until the admin changes it, the same way `prize`'s text carries forward unedited. An admin who wants a one-off voucher on a single occurrence of an otherwise-recurring series can still turn `has_voucher` off on that one instance after it's created (same override mechanism `prize` and every other per-occurrence field already allow), so this default doesn't remove control — it just matches the existing pattern instead of inventing a new one.

**Why is voucher-writing entirely RPC-gated (no client INSERT/UPDATE policy)?**
Same reasoning as `player_trophies`: a voucher is proof something happened (won a mix with a prize on it) or proof something was redeemed. If a client could `INSERT` or `UPDATE` its own row directly, a participant could forge a voucher for a mix they didn't win, or un-redeem one after the fact. `SECURITY DEFINER` functions that re-derive the winning team from `teams`/`games` (for the award) or re-check ownership and current status (for `mark_voucher_used`) are the only path that can't be bypassed by calling the table directly — see `CLAUDE.md`'s security note: "what stops someone from calling this table/RPC directly, bypassing the UI entirely?"

## Data Model

### `games.has_voucher` / `game_recurrences.has_voucher`

Two new columns, `BOOLEAN NOT NULL DEFAULT FALSE`, added via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` in the migration — mirroring the existing `prize TEXT` columns on both tables (`supabase/schema.sql` lines 70 and 88).

```sql
ALTER TABLE games            ADD COLUMN IF NOT EXISTS has_voucher BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE game_recurrences ADD COLUMN IF NOT EXISTS has_voucher BOOLEAN NOT NULL DEFAULT FALSE;
```

`game_recurrences.has_voucher` propagates to every mix the recurrence spawns, the same three places `prize` already flows through today (all client/SQL, no new mechanism):

1. **`process_due_game_recurrences()`** (`supabase/schema.sql`, base definition; the currently-live redefinition is in `supabase/migration_whatsapp_groups.sql` — see Backend Changes below for why that file, not `schema.sql`, is the real starting point) — the cron-driven spawn function's `INSERT INTO games (...)` gains `has_voucher` in its column list and `rec.has_voucher` in its `VALUES` list, next to `rec.prize`.
2. **`recurrenceSnapshotAndRule(game, recurrence)`** (`src/pages/GerirClube.jsx`, ~line 590) — the shared payload builder for creating/updating a `game_recurrences` row gains `has_voucher: game.has_voucher`, next to the existing `prize: game.prize`.
3. **The client-side "pre-create next occurrence" insert** (`src/pages/GerirClube.jsx`, ~line 718-736, inside the recurrence-creation flow that pre-creates the immediately-next pending mix rather than waiting for the cron) — its `games` insert payload gains `has_voucher: game.has_voucher`, next to `prize: game.prize`.

The *first* mix in a series (and any standalone, non-recurring mix) needs no separate wiring: `gameForm`'s initial state already flows into the `games` insert/update via `...gameFields` spread (`src/pages/GerirClube.jsx`, ~line 774 and ~line 956) rather than an explicit field list, so adding `has_voucher: false` to the `gameForm` state object (next to `prize: ''`, ~line 103) is sufficient on its own.

### `vouchers`

New table, modeled directly on `player_trophies` (`supabase/migration_trophies.sql`, lines 32-41):

```sql
CREATE TABLE IF NOT EXISTS vouchers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id         UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  status          TEXT NOT NULL DEFAULT 'por_usar' CHECK (status IN ('por_usar', 'usado')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  used_at         TIMESTAMPTZ,
  UNIQUE (game_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_vouchers_user ON vouchers (user_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_game ON vouchers (game_id);
```

`UNIQUE (game_id, user_id)` gives the award step a natural `ON CONFLICT DO NOTHING` idempotency key — same trick `mix_player_stats` and `player_trophies` both already rely on, and necessary because `finalize_mix` must stay safely re-callable (see Error Handling).

RLS — SELECT mirrors `player_trophies` exactly (own rows or org-mates, via the existing `shares_org_with` helper, `supabase/schema.sql` lines 242-257); no write policies at all:

```sql
ALTER TABLE vouchers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Own or org-mates vouchers" ON vouchers;
CREATE POLICY "Own or org-mates vouchers"
  ON vouchers FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR shares_org_with(user_id));
-- No INSERT/UPDATE/DELETE policies — only finalize_mix() (award) and
-- mark_voucher_used() (redeem), both SECURITY DEFINER, write this table.
```

Org-mates can see each other's vouchers the same way they already see each other's trophies — this is a small-club pilot product where teammates already see each other's stats, not a privacy-sensitive surface.

## Backend Changes (SQL)

### Awarding: inside `finalize_mix`

`finalize_mix(p_game_id UUID, p_winner_team_id UUID)` already has the exact hook point this feature needs: after it finishes writing stats/XP/Elo, it calls `PERFORM check_and_award_trophies(mps.user_id) FROM mix_player_stats mps WHERE mps.game_id = p_game_id;` (`supabase/migration_trophies.sql`, lines 471-474). The voucher award is a second, analogous step added right after that line, gated on `games.has_voucher` and scoped to just the winning team (available as `p_winner_team_id` → `teams.player1_id`/`player2_id`):

```sql
IF (SELECT has_voucher FROM games WHERE id = p_game_id) THEN
  INSERT INTO vouchers (game_id, user_id, organization_id)
  SELECT p_game_id, pid, v_org_id
  FROM (
    SELECT player1_id AS pid FROM teams WHERE id = p_winner_team_id
    UNION ALL
    SELECT player2_id FROM teams WHERE id = p_winner_team_id
  ) winners
  WHERE pid IS NOT NULL
  ON CONFLICT (game_id, user_id) DO NOTHING;
END IF;
```

`v_org_id` is already a local variable in `finalize_mix`, set at the top of the function from `games.organization_id`. Excluding `pid IS NULL` covers the (rare) case of a team with an unfilled slot.

Because `finalize_mix` is redefined wholesale on every migration that touches it (the same "recriação completa da versão viva com UMA linha extra" pattern `migration_trophies.sql` itself used), `migration_vouchers.sql` must `CREATE OR REPLACE FUNCTION finalize_mix(...)` starting from the **current live body**, not from what's quoted above in isolation. As of this spec, that live body is the one in `supabase/migration_trophies.sql` (lines 351-476) — confirmed via `git log` as the most recently committed redefinition of `finalize_mix` (2026-09-09, after `migration_xp_engagement.sql`'s version). The implementation plan calls out re-checking this at execution time, since another migration could land between this spec and implementation.

### Redeeming: `mark_voucher_used`

New `SECURITY DEFINER` RPC, `authenticated`-callable, following the same guard/REVOKE/GRANT convention every other write RPC in this codebase uses (see `finalize_mix` itself, or `follow`/`accept_follow_request` in `migration_instagram_follow_system.sql`):

```sql
CREATE OR REPLACE FUNCTION mark_voucher_used(p_voucher_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE vouchers
  SET status = 'usado', used_at = NOW()
  WHERE id = p_voucher_id
    AND user_id = auth.uid()
    AND status = 'por_usar';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Voucher não encontrado ou já usado';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION mark_voucher_used(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION mark_voucher_used(UUID) TO authenticated;
```

The `WHERE user_id = auth.uid() AND status = 'por_usar'` clause is the entire authorization + idempotency check: it makes the RPC a no-op-that-raises for someone else's voucher, a missing id, or a voucher already marked `usado` — no separate `SELECT ... FOR UPDATE` needed, and no race window (see Error Handling).

### `process_due_game_recurrences()` propagation

As described under Data Model, `has_voucher` joins the `INSERT INTO games (...)` column/value lists next to `prize`/`rec.prize`. Same "full redefinition, current live body only" caveat applies — the live body to build from is in `supabase/migration_whatsapp_groups.sql` (confirmed via `git log` as the most recent redefinition, 2026-09-08), **not** the copy in `supabase/schema.sql`, which predates several later column additions (`gender_restriction`, `auto_start_hours_before`, `level`) and would silently drop them if used as the base.

## Components (Frontend)

### `src/pages/GerirClube.jsx` — mix creation/edit form

- `gameForm` initial state (~line 103) gains `has_voucher: false`, next to `prize: ''`.
- A new checkbox, placed directly after the existing `prize` field (~line 1536), following the exact `type="checkbox"` / `w-5 h-5` / label-wraps-input pattern already used for `settings.is_global` and `gameForm.recurrence.enabled` elsewhere in this same file:
  ```jsx
  <label className="flex items-center gap-3 cursor-pointer mt-3">
    <input
      type="checkbox"
      checked={gameForm.has_voucher}
      onChange={(e) => setGameForm({ ...gameForm, has_voucher: e.target.checked })}
      className="w-5 h-5"
    />
    <span className="text-sm text-ink-900">{t('gerirclube.has_voucher_label')}</span>
  </label>
  ```
- No other change to this file's submit handlers: `has_voucher` rides into the `games` insert/update through the existing `...gameFields` spread (see Data Model), and into `game_recurrences` through the two explicit-field-list spots already named above.

### `src/pages/Profile.jsx` — new "Vouchers" tab

- `TABS` (~line 20) gains a third entry: `{ key: 'vouchers', labelKey: 'profile.tab_vouchers' }`, after `historico`.
- New state: `vouchers` (array), `vouchersLoading` (bool, default `true`) — same naming/shape convention as `mixHistory`/`mixHistoryLoading`.
- New loader, called once when `tab === 'vouchers'` becomes active for the first time (same lazy-load-on-first-visit pattern the `historico`/trophy sections already use), querying directly against Supabase with the RLS policy above doing the authorization:
  ```js
  const { data, error } = await supabase
    .from('vouchers')
    .select('id, status, used_at, created_at, game:games (id, title, date, prize, organization:organizations (name))')
    .eq('user_id', profile.id)
    .order('created_at', { ascending: false })
  ```
  On error (including "relation vouchers does not exist" if the migration hasn't been run yet — see Error Handling), log and fall back to an empty list rather than surfacing a broken tab.
- Rendering, following the same `{!vouchersLoading && (...)}` blank-while-loading / `EmptyState` pattern the `historico` tab already uses (`src/pages/Profile.jsx` ~line 1082-1088):
  - Loading: tab area renders nothing (matches existing `historico` behavior — no skeleton exists anywhere else in this file, so none is introduced here).
  - Empty: `<EmptyState icon={Ticket} title={t('profile.vouchers_empty_title')} subtitle={t('profile.vouchers_empty_subtitle')} />` (`Ticket` from `lucide-react`, added to this file's existing icon import list).
  - Non-empty: the wallet stack (below).

### New: `VoucherCard` (`src/components/ui.jsx`)

Exported alongside `AchievementCard`, following its exact visual grammar (rounded card, border/fill driven by state, name/description from data, a status pill) rather than inventing a new one:

```jsx
// gameDate and usedAtLabel arrive pre-formatted (Profile.jsx already formats
// mix dates for the historico tab via a local formatMixDate helper — reuse
// that for gameDate; format usedAt the same way for usedAtLabel), so this
// component stays presentational and needs i18n only for its own labels.
export function VoucherCard({ prizeText, gameTitle, gameDate, organizationName, status, usedAtLabel, onMarkUsed }) {
  const { t } = useTranslation()
  const used = status === 'usado'
  return (
    <div className={`rounded-2xl border-2 p-4 bg-surface ${used ? 'border-ink-100 opacity-70' : 'border-lime-400 shadow-card'}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-mono font-extrabold uppercase tracking-wide text-muted truncate">{organizationName}</p>
        <span className={`px-1.5 py-px rounded-full text-[9px] font-mono font-extrabold uppercase tracking-wide ${used ? 'bg-ink-50 text-muted' : 'bg-lime-100 text-lime-700'}`}>
          {t(`profile.voucher_status_${status}`)}
        </span>
      </div>
      <p className="mt-1 text-sm font-extrabold text-ink-900">{gameTitle}</p>
      <p className="text-[11px] text-muted">{gameDate}</p>
      <p className="mt-2 text-sm text-ink-900 leading-snug">{prizeText}</p>
      {!used && (
        <button onClick={onMarkUsed} className="mt-3 text-[12px] font-extrabold text-lime-700 press">
          {t('profile.voucher_mark_used_action')}
        </button>
      )}
      {used && <p className="mt-3 text-[10px] text-ink-200">{t('profile.voucher_used_at', { date: usedAtLabel })}</p>}
    </div>
  )
}
```
Tailwind tokens (`lime-400`/`lime-700`/`lime-100`, `shadow-card`) are this codebase's existing brand-accent classes — the same ones `PrimaryButton`'s `lime` variant and the `historico` tab's #1-position pill already use (`src/components/ui.jsx` line 418; `src/pages/Profile.jsx` line 1105) — not new tokens.

### Wallet stack layout (Profile.jsx, `tab === 'vouchers'` body)

Cards render in normal document flow, ordered `por_usar` before `usado`, newest (`created_at`) first within each group (see `sortVouchersForWallet` below) — "most relevant/actionable on top" per the brief. The passbook overlap is a small, fixed negative top-margin plus an explicit inline `z-index` (not relying on default paint order, which would put a later sibling *over* an earlier one when they overlap):

```jsx
<div className="pt-1">
  {sortedVouchers.map((v, i) => (
    <div key={v.id} style={{ marginTop: i === 0 ? 0 : -16, zIndex: sortedVouchers.length - i, position: 'relative' }}>
      <VoucherCard {...} />
    </div>
  ))}
</div>
```
The 16px overlap only covers each card's top strip (organization name + status pill row) — the prize text and "marcar como usado" action always sit below the overlap zone, so nothing actionable is ever covered by the card above it. This is a deliberately small, static effect (no drag-to-fan, no tap-to-expand) — appropriate for a pilot feature with typically a handful of vouchers per player, not a gold-plated interaction.

### New pure module: `src/lib/vouchers.js`

Mirrors `src/lib/xp.js`'s "display puro" precedent — pure, framework-free functions, unit-testable without mocking Supabase:

```js
// status: 'por_usar' sorts before 'usado'; newest created_at first within each group.
export function sortVouchersForWallet(vouchers) {
  const rank = (v) => (v.status === 'por_usar' ? 0 : 1)
  return [...vouchers].sort((a, b) => rank(a) - rank(b) || new Date(b.created_at) - new Date(a.created_at))
}
```
`Profile.jsx` imports this rather than sorting inline, matching how `bandProgress`/`tierFromXp`/etc. already live in `lib/` rather than in the page component.

### Marking a voucher used

```js
const handleMarkUsed = async (voucherId) => {
  if (!confirm(t('profile.voucher_mark_used_confirm'))) return
  const { error } = await supabase.rpc('mark_voucher_used', { p_voucher_id: voucherId })
  if (error) {
    console.error('Error marking voucher used:', error)
    alert(t('profile.voucher_error_mark_used'))
    return
  }
  setVouchers((prev) => prev.map((v) => (v.id === voucherId ? { ...v, status: 'usado', used_at: new Date().toISOString() } : v)))
}
```
`confirm()` before the RPC call, matching this repo's rule for irreversible actions (`CLAUDE.md`, "Things that have bitten people before"). Local state updates optimistically after a successful RPC response rather than re-querying — consistent with how `handleTogglePrivateMatches` and similar single-row toggles elsewhere in this codebase already behave.

## Architecture

No new backend process and no new API surface beyond what's described above — this feature fits entirely inside the existing shape: the browser talks to Supabase directly (publishable anon key), every authorization rule lives in RLS or inside a `SECURITY DEFINER` function, and the only two write paths into `vouchers` are `finalize_mix` (award, already an admin-only, trust-boundary-checked RPC) and `mark_voucher_used` (redeem, newly added). Reads go straight through PostgREST with RLS deciding visibility — no new RPC needed for the read path, matching how `mixHistory` already reads `mix_player_stats`/`games` directly. Nothing here touches the WhatsApp bot process.

## Data Flow

1. Admin creates or edits a mix in `GerirClube.jsx`, toggling "tem voucher" on and writing prize/redemption text into the existing `prize` field. Saved as `games.has_voucher = true` (or propagated onto `game_recurrences.has_voucher` and every mix the series spawns, per Data Model).
2. Players play the mix; results get recorded as normal, unrelated to this feature.
3. An admin finalizes the mix (`finalize_mix(p_game_id, p_winner_team_id)`, existing admin-only flow, unchanged trigger point). After its existing stats/XP/Elo/trophy work, the new block checks `games.has_voucher`; if true, it inserts one `vouchers` row per winning-team player (idempotent via `ON CONFLICT (game_id, user_id) DO NOTHING`).
4. A winning player opens their own Profile → "Vouchers" tab. `Profile.jsx` queries `vouchers` filtered to `user_id = auth.uid()` (RLS also allows org-mates, unused by this page but usable by any future "teammate's vouchers" surface without a schema change); rows are sorted `por_usar` first / newest first and rendered as the stacked `VoucherCard` list.
5. At the club, the player taps "marcar como usado" on a `por_usar` card → `confirm()` → `mark_voucher_used(voucher_id)` RPC → row flips to `usado`, `used_at` set → card re-renders in the `usado` state (grayed, no action) and re-sorts behind any remaining `por_usar` cards.

## Error Handling

- **Double award / re-finalize.** `finalize_mix` is guarded (`status = 'in_progress'` check) against being called twice on the same mix under normal flow, but the voucher insert is additionally idempotent via `UNIQUE (game_id, user_id)` + `ON CONFLICT DO NOTHING` — a defensive second layer, same reasoning `mix_player_stats`'s own `ON CONFLICT` already uses in the same function.
- **Marking used twice / from two devices.** `mark_voucher_used`'s single `UPDATE ... WHERE status = 'por_usar'` is atomic — a second concurrent call (same voucher, same or different session) finds zero matching rows (`NOT FOUND`) and raises, rather than racing to double-set `used_at`. No explicit locking needed.
- **Marking someone else's voucher used.** Blocked by the same `WHERE user_id = auth.uid()` clause — RLS never even needs to run since the RPC is `SECURITY DEFINER`, but the ownership check inside it is the real boundary (matches the "what stops someone from calling this RPC directly" framing in `CLAUDE.md`).
- **Migration not yet run in production.** Both the `vouchers` SELECT and the `mark_voucher_used` RPC call will fail (`relation "vouchers" does not exist` / function not found) until the migration is pasted into the Supabase SQL Editor. `Profile.jsx`'s loader treats that failure the same as "no vouchers" — logs the error, sets an empty list, and the tab shows the empty state rather than a broken page. This mirrors `player_trophies`' existing documented fail-soft behavior ("sem migração, a secção não aparece").
- **Mix deleted or its game row removed.** `vouchers.game_id REFERENCES games(id) ON DELETE CASCADE` — a deleted mix takes its awarded vouchers with it, same cascade behavior `player_trophies`/`mix_player_stats` already rely on for their own foreign keys. No orphaned-voucher state is reachable.
- **User cancels the confirm() dialog.** No RPC call is made; UI is unchanged. Matches every other confirm-gated destructive action in this codebase.
- **Team with a missing/guest-left slot at award time.** The award query's `WHERE pid IS NOT NULL` skips a `NULL` `player1_id`/`player2_id`; that seat simply receives no voucher rather than erroring the whole `finalize_mix` call.
- **`prize` is empty on a `has_voucher = true` mix.** Not blocked at the database or RPC level — an admin can toggle "tem voucher" without filling in `prize`, which produces a voucher card with a blank description. This is treated as an admin input mistake, not a system error: the checkbox's hint text (`gerirclube.has_voucher_hint`) tells the admin the prize text becomes the voucher's description, but no client-side validation forces the two fields together, keeping this consistent with how every other optional text field in this form already works.

## i18n

`src/locales/pt.json` is source of truth, written first; `src/locales/en.json` mirrors every key (matching this repo's existing i18n convention).

**Added to `pt.json`** (English equivalents mirror the same keys in `en.json`):
- `profile.tab_vouchers`: "Vouchers"
- `profile.vouchers_empty_title`: "Ainda sem vouchers"
- `profile.vouchers_empty_subtitle`: "Vouchers ganhos ao vencer mixes com prémio aparecem aqui."
- `profile.voucher_status_por_usar`: "Por usar"
- `profile.voucher_status_usado`: "Usado"
- `profile.voucher_mark_used_action`: "Marcar como usado"
- `profile.voucher_mark_used_confirm`: "Marcar este voucher como usado? Não é possível desfazer."
- `profile.voucher_used_at`: "Usado a {{date}}"
- `profile.voucher_error_mark_used`: "Não foi possível marcar o voucher como usado."
- `gerirclube.has_voucher_label`: "Tem voucher"
- `gerirclube.has_voucher_hint`: "Os dois jogadores da dupla vencedora recebem um voucher com o texto do prémio acima." (tone/length matches the existing `gerirclube.prize_placeholder`: "ex: Vouchers para os vencedores")

No existing keys are removed or changed.

## Testing

This codebase has no automated tests for RLS policies, RPCs, or Supabase-backed React components (`vitest` is configured and used only for pure logic modules — `src/lib/mixLogic.test.js`, `src/lib/scoringLogic.test.js`). This feature follows that same split:

- **Automated:** `src/lib/vouchers.test.js` (new, `vitest`) covers `sortVouchersForWallet` — the one pure, framework-free piece of logic this feature introduces: `por_usar` sorts before `usado`; newest `created_at` first within each group; stable/no-mutation of the input array; empty-array input.
- **Manual, SQL Editor** (after running `migration_vouchers.sql` against a dev/staging Supabase project — see Migration Rollout below):
  - Toggling `has_voucher` on a mix, finalizing it, confirming exactly 2 `vouchers` rows exist (winning team only) and no rows exist for other participants.
  - Re-running `finalize_mix` is not reachable through the UI once a mix is `finished`, but confirming the `ON CONFLICT DO NOTHING` guard directly (re-invoking the SQL insert block manually) is a cheap sanity check for the idempotency claim in Error Handling.
  - `mark_voucher_used` as the owning user (succeeds), as a different authenticated user (raises), and a second call on an already-`usado` voucher (raises).
  - Confirming a non-winning participant, and a member of a *different* org, cannot `SELECT` the voucher row (RLS).
  - Confirming a recurring mix series with `has_voucher = true` produces vouchers-eligible mixes on every spawned occurrence (both the client pre-created next occurrence and a cron-spawned later one).
- **Manual, UI smoke test** in dev (`import.meta.env.DEV` "Entrar como Admin" shortcut for fast iteration):
  - Empty state renders correctly for a player with zero vouchers.
  - Wallet stack renders correctly for 1 voucher, several `por_usar`, and a mix of `por_usar`/`usado` — confirming visual ordering and that the overlap never hides the "marcar como usado" button.
  - Marking used end-to-end: confirm dialog cancel leaves state untouched; confirm dialog accept flips the card to the `usado` visual state without a page reload.
  - Mobile viewport (~400px width) — card text doesn't overflow, stack remains legible.

## Migration Rollout

`supabase/migration_vouchers.sql` is a new, self-contained, re-runnable migration file (uses `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS` before `CREATE POLICY`, `CREATE OR REPLACE FUNCTION`), following the exact convention `migration_trophies.sql` and every other file in `supabase/` already use. **This file existing in the repo does not mean it has run** — per `CLAUDE.md`, someone (Renato) has to paste it into the Supabase SQL Editor before any code depending on it (the checkbox writing `has_voucher`, the voucher award inside `finalize_mix`, the Profile "Vouchers" tab, `mark_voucher_used`) works in production. This must be called out explicitly again at the end of the implementation plan and is not something the implementer can verify by reading the repository alone.

## Out of Scope

- **Partner/affiliate catalog (#199).** No table, RLS, or UI for clubs/partners becoming "affiliated," and no admin surface for creating reusable voucher templates independent of a specific mix. This spec's `vouchers` table is intentionally shaped so #199 could later add a `partner_id` or similar without breaking this feature's read/redeem path, but that extension is not designed here.
- **Expiry / validity window.** No `expires_at` column, no cron sweep, no "this voucher expired" UI state. Only `por_usar`/`usado` exist. A natural future extension if #199 introduces partner-defined validity windows — not designed here.
- **Un-marking a voucher as used (`mark_voucher_unused`).** Not built; see Key Decisions.
- **Admin manually granting a voucher outside mix finalization** (e.g., a "give voucher" button in `GerirClube.jsx`'s member management). Not requested; the only award path is the automatic one inside `finalize_mix`.
- **Notifications on voucher award** (bell dropdown, WhatsApp bot message, etc.). Not requested — a player discovers a new voucher by opening their own Profile, same as trophies today have no award-moment notification either.
- **WhatsApp bot surface.** The bot has no voucher-related commands or messages; this is a web-app-only feature.
- **Animation/toast at the moment of award** (mirrors the same v2 deferral `trophies` already made for its own award moment).
