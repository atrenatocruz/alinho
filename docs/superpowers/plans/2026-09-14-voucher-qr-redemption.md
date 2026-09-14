# Voucher QR Redemption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a club admin validate and redeem a player's voucher at the counter — by scanning a QR code shown on the player's Profile, or typing the voucher id manually — as a second path alongside the existing self-service "Usar" button, both ending at the same `vouchers.status = 'usado'` state.

**Architecture:** No new tables/columns. A new `admin_redeem_voucher(p_voucher_id UUID)` `SECURITY DEFINER` RPC (org-admin gated, mirrors `mark_voucher_used`'s idempotency shape) is the only backend addition — the read path (admin looking up a voucher's details before confirming) reuses the existing `"Own or org-mates vouchers"` RLS policy with a richer `.select()`. On the frontend: `VoucherCard` (`src/components/ui.jsx`) becomes click-through to a new `VoucherQRModal` (same file) that renders the voucher's bare id as a QR image; `GerirClube.jsx` gains a header icon (next to the existing Settings gear, entered the same way Settings already is — hidden from the pill-tab row) opening a "look up → show details → confirm" redeem screen that uses a new `VoucherScanner` component (camera) plus an always-visible manual text input, both funneling into the same lookup/confirm handlers.

**Tech Stack:** React + Vite + Supabase (Postgres + RLS + RPC), react-i18next, Tailwind. Two new npm dependencies: `qrcode` (QR generation) and `html5-qrcode` (camera scan + decode). `src/lib/vouchers.js` gains two new pure functions with real Vitest coverage, matching this repo's existing split (pure logic gets automated tests; SQL/RPC/camera-dependent UI is verified by `npm run build` + manual read-through + manual Supabase SQL Editor / device checks — there is no RLS/RPC/camera test harness in this repo).

**Spec:** `docs/superpowers/specs/2026-09-14-voucher-qr-redemption-design.md`

## Global Constraints

- The existing self-service "Usar" button and `mark_voucher_used` RPC are **not modified** — this plan only adds a second, parallel path. Do not touch `mark_voucher_used`'s body.
- The QR encodes the voucher's bare `id` (a UUID string) and nothing else — no signed token, no wrapping URL.
- The admin flow is **look up → show details → confirm**, never scan-and-redeem-instantly. The confirm step is a real button in the detail view, not a browser `confirm()`.
- A `usado` voucher never shows a QR affordance on `VoucherCard` — only `por_usar` vouchers are click-through.
- The manual-entry text input is always rendered alongside the camera scanner, never hidden behind "try camera first."
- The redeem screen lives in `GerirClube.jsx`, entered via a new header icon button (next to the existing Settings gear), hidden from the pill-tab row exactly like `activeTab === 'settings'` already is — not a fourth pill tab, not a button inside the Members tab.
- `src/locales/pt.json` is source of truth, written first in every i18n step; `src/locales/en.json` mirrors every key with an English translation in the same task.
- The migration file this plan produces (`supabase/migration_voucher_qr_redemption.sql`) is **not live** until a human pastes it into Supabase → SQL Editor → New query → Run. State that explicitly when Task 1 is reported done, and again in Task 9's final report — the admin confirm step cannot be functionally verified end-to-end against production until then (the player-facing QR modal and the admin's lookup step work without it, since they don't depend on the new RPC).

---

## Task 1: Database migration — `admin_redeem_voucher` RPC

**Files:**
- Create: `supabase/migration_voucher_qr_redemption.sql`

**Interfaces:**
- Produces: function `admin_redeem_voucher(p_voucher_id UUID) RETURNS VOID`. Consumed by: Task 8 (`GerirClube.jsx`'s confirm handler calls this RPC by name).

This task has no automated test — it's a hand-run SQL file, same as every other migration in `supabase/`. Verification is read-through plus (once actually run against a real Supabase project) manual SQL Editor checks, listed in Step 3.

- [ ] **Step 1: Write the migration file**

Create `supabase/migration_voucher_qr_redemption.sql`:

```sql
-- ════════════════════════════════════════════════════════════════════════
-- Migration: Voucher QR redemption. A second, admin-driven redemption
-- path alongside the existing self-service "Usar" button (mark_voucher_used,
-- migration_vouchers.sql) — a club admin scans (or manually types) a
-- voucher's id in GerirClube.jsx, sees its details (owner, mix, prize,
-- club), and on explicit confirmation calls this new RPC to redeem it on
-- the player's behalf.
--
-- mark_voucher_used is NOT modified by this migration — it stays exactly
-- as-is, still the only path for the self-service button. This file adds
-- one new function only; no new table, no new column, no RLS change (the
-- admin's read-before-confirm lookup already works today via the existing
-- "Own or org-mates vouchers" SELECT policy on vouchers).
--
-- NOT LIVE until run in Supabase → SQL Editor → New query → Run. A
-- migration file existing in this repo changes nothing on its own — the
-- GerirClube.jsx "Ler QR code" redeem screen's confirm step depends on
-- this having actually been pasted in and executed there. (The screen's
-- lookup step, and the player-facing QR modal, work without it — only the
-- final confirm call needs this RPC.)
--
-- See docs/superpowers/specs/2026-09-14-voucher-qr-redemption-design.md
-- for the full design and the reasoning behind each decision below.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION admin_redeem_voucher(p_voucher_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT organization_id INTO v_org_id FROM vouchers WHERE id = p_voucher_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Voucher não encontrado';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM memberships
    WHERE organization_id = v_org_id AND user_id = auth.uid() AND is_admin
  ) THEN
    RAISE EXCEPTION 'Apenas admins podem validar este voucher';
  END IF;

  UPDATE vouchers
  SET status = 'usado', used_at = NOW()
  WHERE id = p_voucher_id
    AND status = 'por_usar';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Voucher não encontrado ou já usado';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION admin_redeem_voucher(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION admin_redeem_voucher(UUID) TO authenticated;
```

The `SELECT organization_id ... IF v_org_id IS NULL` check runs before the admin-membership check because the admin check itself needs `v_org_id` — unlike `mark_voucher_used`, whose ownership predicate (`user_id = auth.uid()`) can live directly inside the guarded `UPDATE ... WHERE` clause without a prior read.

- [ ] **Step 2: Read-through self-check**

Re-read the full file. Confirm: the header disclaimer is present and unmodified from Step 1; the function has both a `REVOKE` and a `GRANT`; nothing in this file touches `mark_voucher_used`, any table's RLS policy, or any column.

- [ ] **Step 3: Document manual verification (for once this migration is actually run)**

These checks can't run now — they depend on a human pasting this file into a real Supabase project's SQL Editor first, against a voucher already created by the existing vouchers-wallet flow. Record them here so Task 9's final report can point back to this exact list:

```sql
-- 1. Redeem, as an admin of the voucher's own organization:
SELECT admin_redeem_voucher('<voucher id, currently por_usar>');
SELECT status, used_at FROM vouchers WHERE id = '<that voucher id>';
-- Expect: status = 'usado', used_at set.

-- 2. Redeem again — expect an exception ("Voucher não encontrado ou já usado").

-- 3. Redeem a DIFFERENT por_usar voucher as an admin of a DIFFERENT
--    organization than that voucher's own — expect an exception
--    ("Apenas admins podem validar este voucher").

-- 4. Redeem as a non-admin member of the voucher's own organization —
--    expect the same "Apenas admins podem validar este voucher" exception.

-- 5. Redeem a nonexistent id — expect "Voucher não encontrado".

-- 6. Race: as the voucher's own owner, call mark_voucher_used(id); as an
--    admin, call admin_redeem_voucher(id) on the same voucher shortly
--    after — confirm exactly one call succeeds and the other raises, and
--    the final row state is status='usado' with used_at set exactly once
--    (not overwritten by the losing call).
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migration_voucher_qr_redemption.sql
git commit -m "$(cat <<'EOF'
feat: admin_redeem_voucher RPC for QR-based voucher redemption

New SECURITY DEFINER RPC, org-admin gated, mirrors mark_voucher_used's
idempotency shape (UPDATE ... WHERE status = 'por_usar', raise on
NOT FOUND) so an admin can redeem a player's voucher on their behalf
after scanning/typing its id. mark_voucher_used itself is untouched.
NOT LIVE until run in Supabase SQL Editor.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011x8RPEBrD2mrnXhyJytueW
EOF
)"
```

---

## Task 2: npm dependencies — `qrcode` and `html5-qrcode`

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json` (generated by `npm install`, not hand-edited)

**Interfaces:**
- Produces: `qrcode` importable as `import QRCode from 'qrcode'` (used by Task 5's `VoucherQRModal`); `html5-qrcode` importable as `import { Html5Qrcode } from 'html5-qrcode'` (used by Task 7's `VoucherScanner`).

- [ ] **Step 1: Install both packages at pinned versions**

Run: `npm install qrcode@1.5.4 html5-qrcode@2.3.8`

Expected: `package.json`'s `dependencies` gains two new entries (npm inserts them; verify placement in Step 2), `package-lock.json` updates, no install errors.

- [ ] **Step 2: Verify `package.json`'s new entries**

Read `package.json`. Confirm the `dependencies` block now contains, alphabetically placed among the existing entries:

```json
    "html-to-image": "^1.11.13",
    "html5-qrcode": "^2.3.8",
    "i18next": "^26.4.0",
```

and

```json
    "lucide-react": "^0.294.0",
    "qrcode": "^1.5.4",
    "react": "^18.2.0",
```

If `npm install` placed them somewhere else in the file (npm does not always preserve alphabetical order), leave npm's own ordering as-is — this codebase has no lint rule enforcing key order in `package.json`, so don't hand-reorder after the fact.

- [ ] **Step 3: Build verification**

Run: `npm run build`
Expected: builds successfully — confirms both packages installed cleanly and neither conflicts with the existing Vite/React toolchain.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "$(cat <<'EOF'
chore: add qrcode + html5-qrcode dependencies for voucher QR redemption

qrcode generates the player-facing QR image; html5-qrcode drives the
admin-facing camera scanner (permission handling + decode in one
package).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011x8RPEBrD2mrnXhyJytueW
EOF
)"
```

---

## Task 3: i18n keys — `profile.voucher_qr_hint` and `gerirclube.redeem_*`

**Files:**
- Modify: `src/locales/pt.json`
- Modify: `src/locales/en.json`

**Interfaces:**
- Produces: `profile.voucher_qr_hint`, `gerirclube.redeem_voucher_label`, `gerirclube.redeem_heading`, `gerirclube.redeem_start_camera`, `gerirclube.redeem_stop_camera`, `gerirclube.redeem_camera_unavailable`, `gerirclube.redeem_manual_label`, `gerirclube.redeem_manual_placeholder`, `gerirclube.redeem_lookup_button`, `gerirclube.redeem_not_found`, `gerirclube.redeem_detail_owner_label`, `gerirclube.redeem_detail_mix_label`, `gerirclube.redeem_detail_prize_label`, `gerirclube.redeem_already_used`, `gerirclube.redeem_confirm_button`, `gerirclube.redeem_confirm_success`, `gerirclube.redeem_confirm_error`, `gerirclube.redeem_search_another`. Consumed by Tasks 5, 6, 8.

- [ ] **Step 1: Add keys to `pt.json`**

Find:

```json
  "gerirclube.has_voucher_hint": "Os dois jogadores da dupla vencedora recebem um voucher com o texto do prémio acima.",
```

Replace with (adds the new `gerirclube.redeem_*` keys right after it):

```json
  "gerirclube.has_voucher_hint": "Os dois jogadores da dupla vencedora recebem um voucher com o texto do prémio acima.",
  "gerirclube.redeem_voucher_label": "Ler QR code",
  "gerirclube.redeem_heading": "Validar voucher",
  "gerirclube.redeem_start_camera": "Ligar câmara",
  "gerirclube.redeem_stop_camera": "Desligar câmara",
  "gerirclube.redeem_camera_unavailable": "Não foi possível aceder à câmara. Usa o código manualmente abaixo.",
  "gerirclube.redeem_manual_label": "Ou introduz o código do voucher",
  "gerirclube.redeem_manual_placeholder": "Código do voucher",
  "gerirclube.redeem_lookup_button": "Procurar",
  "gerirclube.redeem_not_found": "Voucher não encontrado.",
  "gerirclube.redeem_detail_owner_label": "Jogador",
  "gerirclube.redeem_detail_mix_label": "Mix",
  "gerirclube.redeem_detail_prize_label": "Prémio",
  "gerirclube.redeem_already_used": "Este voucher já foi usado a {{date}}.",
  "gerirclube.redeem_confirm_button": "Confirmar validação",
  "gerirclube.redeem_confirm_success": "Voucher validado com sucesso.",
  "gerirclube.redeem_confirm_error": "Não foi possível validar o voucher.",
  "gerirclube.redeem_search_another": "Procurar outro",
```

Find:

```json
  "profile.voucher_error_mark_used": "Não foi possível marcar o voucher como usado.",
```

Replace with (adds `profile.voucher_qr_hint` right after it):

```json
  "profile.voucher_error_mark_used": "Não foi possível marcar o voucher como usado.",
  "profile.voucher_qr_hint": "Mostra este código ao staff do clube para validar o voucher.",
```

- [ ] **Step 2: Add the same keys to `en.json`**

Find:

```json
  "gerirclube.has_voucher_hint": "Both players of the winning team each receive a voucher with the prize text above.",
```

Replace with:

```json
  "gerirclube.has_voucher_hint": "Both players of the winning team each receive a voucher with the prize text above.",
  "gerirclube.redeem_voucher_label": "Scan QR code",
  "gerirclube.redeem_heading": "Redeem voucher",
  "gerirclube.redeem_start_camera": "Turn on camera",
  "gerirclube.redeem_stop_camera": "Turn off camera",
  "gerirclube.redeem_camera_unavailable": "Couldn't access the camera. Use the code manually below.",
  "gerirclube.redeem_manual_label": "Or enter the voucher code",
  "gerirclube.redeem_manual_placeholder": "Voucher code",
  "gerirclube.redeem_lookup_button": "Look up",
  "gerirclube.redeem_not_found": "Voucher not found.",
  "gerirclube.redeem_detail_owner_label": "Player",
  "gerirclube.redeem_detail_mix_label": "Mix",
  "gerirclube.redeem_detail_prize_label": "Prize",
  "gerirclube.redeem_already_used": "This voucher was already used on {{date}}.",
  "gerirclube.redeem_confirm_button": "Confirm redemption",
  "gerirclube.redeem_confirm_success": "Voucher redeemed successfully.",
  "gerirclube.redeem_confirm_error": "Couldn't redeem the voucher.",
  "gerirclube.redeem_search_another": "Look up another",
```

Find:

```json
  "profile.voucher_error_mark_used": "Couldn't mark the voucher as used.",
```

Replace with:

```json
  "profile.voucher_error_mark_used": "Couldn't mark the voucher as used.",
  "profile.voucher_qr_hint": "Show this code to the club's staff to redeem the voucher.",
```

- [ ] **Step 3: Verify both files are still valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/locales/pt.json', 'utf8')); JSON.parse(require('fs').readFileSync('src/locales/en.json', 'utf8')); console.log('OK')"`
Expected: `OK` printed, no exception.

- [ ] **Step 4: Commit**

```bash
git add src/locales/pt.json src/locales/en.json
git commit -m "$(cat <<'EOF'
feat: i18n keys for voucher QR redemption

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011x8RPEBrD2mrnXhyJytueW
EOF
)"
```

---

## Task 4: `src/lib/vouchers.js` — voucher-id validation helpers (TDD)

**Files:**
- Modify: `src/lib/vouchers.js`
- Modify: `src/lib/vouchers.test.js`

**Interfaces:**
- Produces: `isValidVoucherId(value: string) => boolean`; `normalizeScannedVoucherId(value: string) => string`. Consumed by Task 8 (`GerirClube.jsx`'s `handleLookupVoucher`).
- Existing `sortVouchersForWallet` in this file is untouched.

- [ ] **Step 1: Write the failing tests**

Open `src/lib/vouchers.test.js`. Find:

```js
import { describe, it, expect } from 'vitest'
import { sortVouchersForWallet } from './vouchers'
```

Replace with:

```js
import { describe, it, expect } from 'vitest'
import { sortVouchersForWallet, isValidVoucherId, normalizeScannedVoucherId } from './vouchers'
```

Find (the end of the file — the closing of the `sortVouchersForWallet` describe block):

```js
  it('returns an empty array for empty input', () => {
    expect(sortVouchersForWallet([])).toEqual([])
  })
})
```

Replace with (adds two new `describe` blocks after it):

```js
  it('returns an empty array for empty input', () => {
    expect(sortVouchersForWallet([])).toEqual([])
  })
})

describe('isValidVoucherId', () => {
  it('accepts a well-formed UUID', () => {
    expect(isValidVoucherId('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isValidVoucherId('550E8400-E29B-41D4-A716-446655440000')).toBe(true)
  })

  it('accepts a UUID with surrounding whitespace', () => {
    expect(isValidVoucherId('  550e8400-e29b-41d4-a716-446655440000  ')).toBe(true)
  })

  it('rejects an empty string', () => {
    expect(isValidVoucherId('')).toBe(false)
  })

  it('rejects non-UUID text', () => {
    expect(isValidVoucherId('not-a-voucher-id')).toBe(false)
  })

  it('rejects a UUID missing a segment', () => {
    expect(isValidVoucherId('550e8400-e29b-41d4-a716')).toBe(false)
  })

  it('rejects null and undefined', () => {
    expect(isValidVoucherId(null)).toBe(false)
    expect(isValidVoucherId(undefined)).toBe(false)
  })
})

describe('normalizeScannedVoucherId', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeScannedVoucherId('  550e8400-e29b-41d4-a716-446655440000  ')).toBe('550e8400-e29b-41d4-a716-446655440000')
  })

  it('passes a bare id through unchanged (aside from trimming)', () => {
    expect(normalizeScannedVoucherId('550e8400-e29b-41d4-a716-446655440000')).toBe('550e8400-e29b-41d4-a716-446655440000')
  })

  it('strips a URL-style wrapper down to its last path segment', () => {
    expect(normalizeScannedVoucherId('https://alinho.pt/v/550e8400-e29b-41d4-a716-446655440000')).toBe('550e8400-e29b-41d4-a716-446655440000')
  })

  it('returns an empty string for non-string input', () => {
    expect(normalizeScannedVoucherId(null)).toBe('')
    expect(normalizeScannedVoucherId(undefined)).toBe('')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/vouchers.test.js`
Expected: FAIL — `isValidVoucherId`/`normalizeScannedVoucherId` are not exported from `src/lib/vouchers.js`.

- [ ] **Step 3: Implement the two functions**

Open `src/lib/vouchers.js`. Find (the end of the file — the closing brace of `sortVouchersForWallet`):

```js
export function sortVouchersForWallet(vouchers) {
  const rank = (v) => (v.status === 'por_usar' ? 0 : 1)
  return [...vouchers].sort((a, b) => rank(a) - rank(b) || new Date(b.created_at) - new Date(a.created_at))
}
```

Replace with (adds the two new functions after it):

```js
export function sortVouchersForWallet(vouchers) {
  const rank = (v) => (v.status === 'por_usar' ? 0 : 1)
  return [...vouchers].sort((a, b) => rank(a) - rank(b) || new Date(b.created_at) - new Date(a.created_at))
}

// Loose UUID shape check (8-4-4-4-12 hex, case-insensitive) — good enough to
// reject obviously-wrong scanner/manual input before it reaches a query,
// without being strict about UUID *version* (gen_random_uuid() output is
// v4, but there's no product reason to reject a well-formed v1/v5 string
// here — the database is the real source of truth for "does this id exist").
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isValidVoucherId(value) {
  return typeof value === 'string' && UUID_SHAPE.test(value.trim())
}

// Scanner output and manual input both need the same cleanup before
// validation/query: trim whitespace, and (defensively) if a scanner ever
// decodes a full URL wrapper instead of a bare id, pull the last path
// segment — this feature always *encodes* a bare UUID (see VoucherQRModal
// in src/components/ui.jsx), so this is a tolerance measure for stray
// input shapes, not a supported "voucher URL" format.
export function normalizeScannedVoucherId(value) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  const segments = trimmed.split('/')
  return segments[segments.length - 1].trim()
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/vouchers.test.js`
Expected: PASS, all 16 tests green (5 existing `sortVouchersForWallet` cases + 7 new `isValidVoucherId` cases + 4 new `normalizeScannedVoucherId` cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/vouchers.js src/lib/vouchers.test.js
git commit -m "$(cat <<'EOF'
feat: voucher-id validation helpers for QR/manual redemption lookup

isValidVoucherId + normalizeScannedVoucherId — pure, framework-free,
used by GerirClube.jsx's admin redeem screen to sanity-check scanned
or typed input before querying Supabase.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011x8RPEBrD2mrnXhyJytueW
EOF
)"
```

---

## Task 5: `ui.jsx` — `VoucherCard` click-through + new `VoucherQRModal`

**Files:**
- Modify: `src/components/ui.jsx`

**Interfaces:**
- Consumes: `qrcode` package (Task 2).
- Produces: `VoucherCard` gains a new optional prop `onShowQR: () => void` (existing props unchanged). New export `VoucherQRModal({ voucher: { id, gameTitle, organizationName } | null, onClose: () => void })`. Consumed by Task 6 (`Profile.jsx`).

- [ ] **Step 1: Import `QRCode` from the new dependency**

Find (this file's import block, the `ShareCard` import line):

```jsx
import ShareCard, { CARD_W, CARD_H } from './ShareCard'
```

Replace with:

```jsx
import ShareCard, { CARD_W, CARD_H } from './ShareCard'
import QRCode from 'qrcode'
```

- [ ] **Step 2: Make `VoucherCard` click-through, guarding the existing "Usar" button**

Find (the current `VoucherCard` function body):

```jsx
export function VoucherCard({ prizeText, gameTitle, gameDate, organizationName, status, usedAtLabel, onMarkUsed }) {
  const { t } = useTranslation()
  const used = status === 'usado'
  return (
    <div className={`card relative overflow-hidden ${used ? 'shadow-none' : 'shadow-lift'}`}>
      <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${used ? 'bg-ink-100' : 'bg-ink-900'}`} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`flex items-center gap-1.5 text-[11px] font-mono font-extrabold uppercase tracking-wide truncate ${used ? 'text-ink-200' : 'text-muted'}`}>
            <Ticket size={12} className="shrink-0" />
            {organizationName}
          </p>
          <p className={`mt-1 text-base font-extrabold truncate ${used ? 'text-ink-200' : 'text-ink-900'}`}>{gameTitle}</p>
          <p className={`text-[11px] ${used ? 'text-ink-200' : 'text-muted'}`}>{gameDate}</p>
        </div>
        <span className={`shrink-0 px-2 py-1 rounded-full text-[9px] font-mono font-extrabold uppercase tracking-wide ${used ? 'bg-ink-50 text-ink-200' : 'bg-ink-900 text-canvas'}`}>
          {t(`profile.voucher_status_${status}`)}
        </span>
      </div>

      {prizeText && (
        <p className={`mt-3 pt-3 border-t border-line text-sm leading-snug ${used ? 'text-ink-200' : 'text-ink-900 font-semibold'}`}>
          {prizeText}
        </p>
      )}

      {!used ? (
        <PrimaryButton onClick={onMarkUsed} className="mt-3 w-full">
          {t('profile.voucher_mark_used_action')}
        </PrimaryButton>
      ) : (
        <p className="mt-3 text-[10px] text-ink-200">{t('profile.voucher_used_at', { date: usedAtLabel })}</p>
      )}
    </div>
  )
}
```

Replace with (adds `onShowQR` prop, makes the outer `<div>` clickable only for a `por_usar` voucher, and stops the "Usar" button's click from also triggering `onShowQR`):

```jsx
export function VoucherCard({ prizeText, gameTitle, gameDate, organizationName, status, usedAtLabel, onMarkUsed, onShowQR }) {
  const { t } = useTranslation()
  const used = status === 'usado'
  return (
    <div
      className={`card relative overflow-hidden ${used ? 'shadow-none' : 'shadow-lift cursor-pointer'}`}
      onClick={!used ? onShowQR : undefined}
      role={!used ? 'button' : undefined}
      tabIndex={!used ? 0 : undefined}
    >
      <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${used ? 'bg-ink-100' : 'bg-ink-900'}`} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`flex items-center gap-1.5 text-[11px] font-mono font-extrabold uppercase tracking-wide truncate ${used ? 'text-ink-200' : 'text-muted'}`}>
            <Ticket size={12} className="shrink-0" />
            {organizationName}
          </p>
          <p className={`mt-1 text-base font-extrabold truncate ${used ? 'text-ink-200' : 'text-ink-900'}`}>{gameTitle}</p>
          <p className={`text-[11px] ${used ? 'text-ink-200' : 'text-muted'}`}>{gameDate}</p>
        </div>
        <span className={`shrink-0 px-2 py-1 rounded-full text-[9px] font-mono font-extrabold uppercase tracking-wide ${used ? 'bg-ink-50 text-ink-200' : 'bg-ink-900 text-canvas'}`}>
          {t(`profile.voucher_status_${status}`)}
        </span>
      </div>

      {prizeText && (
        <p className={`mt-3 pt-3 border-t border-line text-sm leading-snug ${used ? 'text-ink-200' : 'text-ink-900 font-semibold'}`}>
          {prizeText}
        </p>
      )}

      {!used ? (
        <PrimaryButton onClick={(e) => { e.stopPropagation(); onMarkUsed() }} className="mt-3 w-full">
          {t('profile.voucher_mark_used_action')}
        </PrimaryButton>
      ) : (
        <p className="mt-3 text-[10px] text-ink-200">{t('profile.voucher_used_at', { date: usedAtLabel })}</p>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Add `VoucherQRModal`, exported right after `VoucherCard`**

Find (the end of `VoucherCard`, immediately before the `PhotoViewerModal` section comment):

```jsx
      {used && <p className="mt-3 text-[10px] text-ink-200">{t('profile.voucher_used_at', { date: usedAtLabel })}</p>}
    </div>
  )
}

/* ─── PhotoViewerModal ───────────────────────────────────────────────────
```

Replace with:

```jsx
      ) : (
        <p className="mt-3 text-[10px] text-ink-200">{t('profile.voucher_used_at', { date: usedAtLabel })}</p>
      )}
    </div>
  )
}

/* ─── VoucherQRModal ─────────────────────────────────────────────────────
   Shown when a player taps a por_usar VoucherCard. Purely presentational
   beyond generating the QR image itself — the caller (Profile.jsx) passes
   a small { id, gameTitle, organizationName } object built from the row
   it already has, not something this modal re-fetches. Renders nothing
   without a voucher, matching PhotoViewerModal's own "always mounted,
   inert without its subject" convention. The QR encodes the bare voucher
   id string — no signed token, no wrapping URL (see the design spec's Key
   Decisions for why: this is a convenience carrier, not a security
   boundary — the real authorization check happens server-side in
   admin_redeem_voucher when an admin's scan reaches the redeem RPC). */
export function VoucherQRModal({ voucher, onClose }) {
  const { t } = useTranslation()
  const [qrDataUrl, setQrDataUrl] = useState(null)

  useEffect(() => {
    if (!voucher) return
    let cancelled = false
    setQrDataUrl(null)
    QRCode.toDataURL(voucher.id, { margin: 1, width: 256 })
      .then((url) => { if (!cancelled) setQrDataUrl(url) })
      .catch((err) => console.error('Error generating voucher QR code:', err))
    return () => { cancelled = true }
  }, [voucher])

  if (!voucher) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 animate-fade-in p-4" onClick={onClose}>
      <div className="card max-w-xs w-full text-center relative" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onClose}
          aria-label={t('ui.close')}
          className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-full text-muted hover:text-ink-900 hover:bg-ink-50 transition-colors duration-fast"
        >
          <X size={18} />
        </button>
        {qrDataUrl && <img src={qrDataUrl} alt="" className="mx-auto rounded-lg" width={256} height={256} />}
        <p className="mt-3 text-sm font-extrabold text-ink-900">{voucher.gameTitle}</p>
        <p className="text-[11px] text-muted">{voucher.organizationName}</p>
        <p className="mt-2 text-xs text-muted">{t('profile.voucher_qr_hint')}</p>
      </div>
    </div>,
    document.body
  )
}

/* ─── PhotoViewerModal ───────────────────────────────────────────────────
```

`useState`/`useEffect`/`createPortal`/`X`/`useTranslation` are all already imported at the top of this file — no further import changes needed for this step.

- [ ] **Step 4: Build verification**

Run: `npm run build`
Expected: builds successfully (an unused-export warning for `VoucherQRModal` is fine — `Profile.jsx` starts importing it in Task 6).

- [ ] **Step 5: Commit**

```bash
git add src/components/ui.jsx
git commit -m "$(cat <<'EOF'
feat: VoucherCard click-through + VoucherQRModal

VoucherCard's por_usar state is now clickable (onShowQR), separate
from the existing "Usar" button (now stopPropagation-guarded so
tapping it doesn't also open the QR modal). VoucherQRModal renders
the voucher's bare id as a QR image via the qrcode package.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011x8RPEBrD2mrnXhyJytueW
EOF
)"
```

---

## Task 6: `Profile.jsx` — wire the QR modal to the wallet

**Files:**
- Modify: `src/pages/Profile.jsx`

**Interfaces:**
- Consumes: `VoucherQRModal` (Task 5), `profile.voucher_qr_hint` (Task 3, used inside `VoucherQRModal` itself — no direct reference needed in this file).
- Produces: nothing consumed by later tasks — this is the last piece of the player-facing QR surface.

- [ ] **Step 1: Import `VoucherQRModal`**

Find:

```jsx
import { PrimaryButton, GuestBadge, DateField, Avatar, Select, EmptyState, RatingBadge, PhotoViewerModal, FollowListModal, AchievementCard, VoucherCard } from '../components/ui'
```

Replace with:

```jsx
import { PrimaryButton, GuestBadge, DateField, Avatar, Select, EmptyState, RatingBadge, PhotoViewerModal, FollowListModal, AchievementCard, VoucherCard, VoucherQRModal } from '../components/ui'
```

- [ ] **Step 2: Add `qrVoucher` state and the show handler**

Find:

```jsx
  const [vouchers, setVouchers] = useState([])
  const [vouchersLoading, setVouchersLoading] = useState(true)
```

Replace with:

```jsx
  const [vouchers, setVouchers] = useState([])
  const [vouchersLoading, setVouchersLoading] = useState(true)
  const [qrVoucher, setQrVoucher] = useState(null)
```

Find (the end of `handleMarkVoucherUsed`, to insert the new handler directly after it):

```jsx
  const handleMarkVoucherUsed = async (voucherId) => {
    if (!confirm(t('profile.voucher_mark_used_confirm'))) return
    const { error } = await supabase.rpc('mark_voucher_used', { p_voucher_id: voucherId })
    if (error) {
      console.error('Error marking voucher used:', error)
      alert(t('profile.voucher_error_mark_used'))
      return
    }
    setVouchers((prev) => prev.map((v) => (
      v.id === voucherId ? { ...v, status: 'usado', used_at: new Date().toISOString() } : v
    )))
  }
```

Replace with:

```jsx
  const handleMarkVoucherUsed = async (voucherId) => {
    if (!confirm(t('profile.voucher_mark_used_confirm'))) return
    const { error } = await supabase.rpc('mark_voucher_used', { p_voucher_id: voucherId })
    if (error) {
      console.error('Error marking voucher used:', error)
      alert(t('profile.voucher_error_mark_used'))
      return
    }
    setVouchers((prev) => prev.map((v) => (
      v.id === voucherId ? { ...v, status: 'usado', used_at: new Date().toISOString() } : v
    )))
  }

  // Only a por_usar voucher ever has a QR to show — VoucherCard itself
  // never calls this for a usado one (its onClick is undefined in that
  // state), but this stays honest about the precondition rather than
  // relying solely on the caller.
  const handleShowVoucherQR = (v) => {
    if (v.status !== 'por_usar') return
    setQrVoucher({ id: v.id, gameTitle: v.game?.title || '', organizationName: v.game?.organization?.name || '' })
  }
```

- [ ] **Step 3: Pass `onShowQR` to `VoucherCard` and mount `VoucherQRModal`**

Find:

```jsx
                <VoucherCard
                  key={v.id}
                  prizeText={v.game?.prize || ''}
                  gameTitle={v.game?.title || ''}
                  gameDate={v.game?.date ? formatDateLib(v.game.date, i18n.language, { day: '2-digit', month: 'short', year: 'numeric' }) : ''}
                  organizationName={v.game?.organization?.name || ''}
                  status={v.status}
                  usedAtLabel={v.used_at ? formatDateLib(v.used_at, i18n.language, { day: '2-digit', month: 'short', year: 'numeric' }) : ''}
                  onMarkUsed={() => handleMarkVoucherUsed(v.id)}
                />
```

Replace with:

```jsx
                <VoucherCard
                  key={v.id}
                  prizeText={v.game?.prize || ''}
                  gameTitle={v.game?.title || ''}
                  gameDate={v.game?.date ? formatDateLib(v.game.date, i18n.language, { day: '2-digit', month: 'short', year: 'numeric' }) : ''}
                  organizationName={v.game?.organization?.name || ''}
                  status={v.status}
                  usedAtLabel={v.used_at ? formatDateLib(v.used_at, i18n.language, { day: '2-digit', month: 'short', year: 'numeric' }) : ''}
                  onMarkUsed={() => handleMarkVoucherUsed(v.id)}
                  onShowQR={() => handleShowVoucherQR(v)}
                />
```

Now find this file's existing `<PhotoViewerModal` mount point (where the profile-photo viewer is rendered unconditionally near the end of the component's JSX):

```jsx
      <PhotoViewerModal url={showPhoto ? photoUrl : null} onClose={() => setShowPhoto(false)} />
```

Replace with (mounts `VoucherQRModal` alongside it, same "always mounted, renders nothing without its subject" convention):

```jsx
      <PhotoViewerModal url={showPhoto ? photoUrl : null} onClose={() => setShowPhoto(false)} />
      <VoucherQRModal voucher={qrVoucher} onClose={() => setQrVoucher(null)} />
```

If the exact `photoUrl` variable name or prop shape above doesn't match what's actually in the file at this point (this file has gone through several photo-menu-related edits — re-read the surrounding ~15 lines before editing to confirm), adapt only the two lines being *inserted* (`<VoucherQRModal .../>` and nothing else) — do not alter the existing `PhotoViewerModal` line's own props.

- [ ] **Step 4: Build verification**

Run: `npm run build`
Expected: builds successfully.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Profile.jsx
git commit -m "$(cat <<'EOF'
feat: wire VoucherQRModal to the Profile vouchers wallet

Tapping a por_usar VoucherCard now opens its QR code; the existing
"Usar" button is unaffected (already guarded in ui.jsx's Task 5
commit).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011x8RPEBrD2mrnXhyJytueW
EOF
)"
```

---

## Task 7: `src/components/VoucherScanner.jsx` — camera scan component

**Files:**
- Create: `src/components/VoucherScanner.jsx`

**Interfaces:**
- Consumes: `html5-qrcode` package (Task 2).
- Produces: default export `VoucherScanner({ active: boolean, onToggle: () => void, onDecode: (text: string) => void })` — controlled component, owns only the camera lifecycle, not what was scanned. Consumed by Task 8 (`GerirClube.jsx`).

- [ ] **Step 1: Create the component**

Create `src/components/VoucherScanner.jsx`:

```jsx
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Html5Qrcode } from 'html5-qrcode'
import { Camera, CameraOff, ScanLine } from 'lucide-react'

const SCANNER_ELEMENT_ID = 'voucher-qr-scanner'

// Camera-based QR scanning, exposed purely as active/onToggle/onDecode —
// this component owns no state about *what* was scanned, only the camera
// lifecycle (start on `active`, stop on cleanup). `onDecode` fires once
// per successful scan; the caller is responsible for setting `active`
// back to false afterwards so a second stray frame can't fire a second
// decode while the parent is still processing the first one.
//
// Off by default wherever it's mounted (the parent controls `active`) —
// this avoids an unsolicited camera permission prompt the moment the
// redeem screen opens, and keeps the always-present manual-entry input
// genuinely equal-first-class rather than a hidden fallback.
export default function VoucherScanner({ active, onToggle, onDecode }) {
  const { t } = useTranslation()
  const instanceRef = useRef(null)
  const [permissionError, setPermissionError] = useState(false)

  useEffect(() => {
    if (!active) return

    const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID)
    instanceRef.current = scanner
    setPermissionError(false)

    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: 220 },
        (decodedText) => onDecode(decodedText),
        () => {} // per-frame "no code in this frame" callback — expected on every frame without a code in view, not an error
      )
      .catch((err) => {
        console.error('Error starting camera:', err)
        setPermissionError(true)
      })

    return () => {
      scanner
        .stop()
        .catch(() => {}) // already stopped/never started — fine to ignore
        .finally(() => scanner.clear())
    }
  }, [active])

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-center gap-2 text-sm font-extrabold px-4 py-2.5 rounded-ctrl bg-ink-50 text-ink-700 hover:bg-ink-200 transition-colors duration-fast"
      >
        {active ? <CameraOff size={16} /> : <Camera size={16} />}
        {active ? t('gerirclube.redeem_stop_camera') : t('gerirclube.redeem_start_camera')}
      </button>
      {active && (
        <div className="mt-3 relative rounded-ctrl overflow-hidden bg-ink-900" id={SCANNER_ELEMENT_ID} />
      )}
      {permissionError && (
        <p className="text-sm text-muted mt-2 flex items-center gap-1.5">
          <ScanLine size={14} /> {t('gerirclube.redeem_camera_unavailable')}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Build verification**

Run: `npm run build`
Expected: builds successfully (an unused-file warning, if any, is fine — `GerirClube.jsx` starts importing this in Task 8).

- [ ] **Step 3: Commit**

```bash
git add src/components/VoucherScanner.jsx
git commit -m "$(cat <<'EOF'
feat: VoucherScanner component (camera QR scan for admin redemption)

Wraps html5-qrcode's start/stop lifecycle in a small controlled
component, extracted rather than inlined into GerirClube.jsx —
same reasoning PlayerSearch already lives in its own file.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011x8RPEBrD2mrnXhyJytueW
EOF
)"
```

---

## Task 8: `GerirClube.jsx` — redeem screen (header icon, lookup, confirm)

**Files:**
- Modify: `src/pages/GerirClube.jsx`

**Interfaces:**
- Consumes: `VoucherScanner` (Task 7), `isValidVoucherId`/`normalizeScannedVoucherId` (Task 4), `admin_redeem_voucher` RPC (Task 1), all `gerirclube.redeem_*` i18n keys (Task 3).
- Produces: nothing consumed by later tasks — this is the last functional piece.

- [ ] **Step 1: Add the `QrCode` icon and the new lib import**

Find:

```jsx
import { Plus, Calendar, Users, Trash2, Edit2, Check, X, UserX, Repeat, Clock, ArrowLeft, Camera, Settings, Copy } from 'lucide-react'
```

Replace with:

```jsx
import { Plus, Calendar, Users, Trash2, Edit2, Check, X, UserX, Repeat, Clock, ArrowLeft, Camera, Settings, Copy, QrCode } from 'lucide-react'
```

Find:

```jsx
import { DAY_LABEL_KEY, listPendingTeacherRequests, approveTeacherProfile, rejectTeacherProfile } from '../lib/teachers'
```

Replace with (adds the new component and lib imports right after it):

```jsx
import { DAY_LABEL_KEY, listPendingTeacherRequests, approveTeacherProfile, rejectTeacherProfile } from '../lib/teachers'
import VoucherScanner from '../components/VoucherScanner'
import { isValidVoucherId, normalizeScannedVoucherId } from '../lib/vouchers'
```

- [ ] **Step 2: Add redeem-screen state**

Find:

```jsx
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [renamingOrg, setRenamingOrg] = useState(false)
```

Replace with:

```jsx
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [renamingOrg, setRenamingOrg] = useState(false)
  const [scanInput, setScanInput] = useState('')
  const [scanLookupState, setScanLookupState] = useState('idle') // 'idle' | 'loading' | 'not_found' | 'found'
  const [scannedVoucher, setScannedVoucher] = useState(null)
  const [cameraActive, setCameraActive] = useState(false)
  const [redeeming, setRedeeming] = useState(false)
  const [redeemError, setRedeemError] = useState('')
  const [redeemSuccess, setRedeemSuccess] = useState(false)
```

- [ ] **Step 3: Add the lookup, confirm, and reset handlers**

Find (this file's `handleRenameOrg` function — insert the new handlers directly after its closing brace; adapt the exact anchor if this function's body differs from what's below, matching only its start and end):

```jsx
  const handleRenameOrg = async () => {
```

Read the full `handleRenameOrg` function in the file to find its closing `}`, then insert immediately after that closing brace:

```jsx

  const handleLookupVoucher = async (rawId) => {
    const id = normalizeScannedVoucherId(rawId)
    if (!isValidVoucherId(id)) {
      setScanLookupState('not_found')
      return
    }
    setScanLookupState('loading')
    setRedeemError('')
    setRedeemSuccess(false)
    const { data, error } = await supabase
      .from('vouchers')
      .select('id, status, used_at, created_at, game:games (id, title, date, prize, organization:organizations (name)), user:profiles!vouchers_user_id_fkey (name)')
      .eq('id', id)
      .maybeSingle()
    if (error || !data) {
      console.error('Error looking up voucher:', error)
      setScanLookupState('not_found')
      return
    }
    setScannedVoucher(data)
    setScanLookupState('found')
  }

  const handleConfirmRedeem = async () => {
    setRedeeming(true)
    setRedeemError('')
    const { error } = await supabase.rpc('admin_redeem_voucher', { p_voucher_id: scannedVoucher.id })
    setRedeeming(false)
    if (error) {
      console.error('Error redeeming voucher:', error)
      setRedeemError(t('gerirclube.redeem_confirm_error'))
      // Re-fetch so the detail view reflects reality (e.g. someone else —
      // the player's own "Usar" tap, or a different admin — redeemed it
      // in the gap between lookup and this confirm tap).
      handleLookupVoucher(scannedVoucher.id)
      return
    }
    setScannedVoucher((v) => ({ ...v, status: 'usado', used_at: new Date().toISOString() }))
    setRedeemSuccess(true)
  }

  const handleResetRedeem = () => {
    setScanInput('')
    setScanLookupState('idle')
    setScannedVoucher(null)
    setRedeemError('')
    setRedeemSuccess(false)
  }
```

- [ ] **Step 4: Add the header icon button**

Find:

```jsx
          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            title={t('gerirclube.settings_label')}
            aria-label={t('gerirclube.settings_label')}
            className="shrink-0 w-11 h-11 flex items-center justify-center rounded-full bg-ink-50 text-ink-700 hover:bg-ink-200 transition-colors duration-fast"
          >
            <Settings size={20} />
          </button>
        </div>
      </div>
```

Replace with (adds the new redeem button before the Settings button, so Settings stays the rightmost/most-peripheral action):

```jsx
          <button
            type="button"
            onClick={() => setActiveTab('redeem')}
            title={t('gerirclube.redeem_voucher_label')}
            aria-label={t('gerirclube.redeem_voucher_label')}
            className="shrink-0 w-11 h-11 flex items-center justify-center rounded-full bg-ink-50 text-ink-700 hover:bg-ink-200 transition-colors duration-fast"
          >
            <QrCode size={20} />
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            title={t('gerirclube.settings_label')}
            aria-label={t('gerirclube.settings_label')}
            className="shrink-0 w-11 h-11 flex items-center justify-center rounded-full bg-ink-50 text-ink-700 hover:bg-ink-200 transition-colors duration-fast"
          >
            <Settings size={20} />
          </button>
        </div>
      </div>
```

- [ ] **Step 5: Hide the pill-tab row for the redeem screen too**

Find:

```jsx
      {/* Tabs — same pill style as Home.jsx/Rankings.jsx's tab rows.
          Hidden while the settings page is open (it isn't one of the tabs). */}
      {activeTab !== 'settings' && (
```

Replace with:

```jsx
      {/* Tabs — same pill style as Home.jsx/Rankings.jsx's tab rows.
          Hidden while the settings page or the voucher redeem screen is
          open (neither is one of the tabs). */}
      {activeTab !== 'settings' && activeTab !== 'redeem' && (
```

- [ ] **Step 6: Render the redeem screen**

Find (the exact tail of the component — the closing of the settings screen, the fragment, the loading ternary, and the component itself):

```jsx
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
```

Replace with (inserts the new `activeTab === 'redeem'` screen between the settings screen's close and the fragment's close):

```jsx
                </div>
              )}
            </div>
          )}

          {/* Voucher redeem screen — same "own screen, entered via a
              header icon, hidden from the pill row" pattern as Settings
              above, not a pill tab and not a button inside Members (see
              docs/superpowers/specs/2026-09-14-voucher-qr-redemption-design.md,
              Key Decisions). */}
          {activeTab === 'redeem' && (
            <div>
              <button
                type="button"
                onClick={() => { setActiveTab('games'); handleResetRedeem() }}
                className="inline-flex items-center gap-1.5 text-ink-700 font-extrabold text-sm hover:underline mb-4"
              >
                <ArrowLeft size={16} /> {t('gerirclube.back_button')}
              </button>
              <h3 className="text-xl font-semibold text-ink-900 mb-6">{t('gerirclube.redeem_heading')}</h3>

              {scanLookupState !== 'found' && (
                <div className="space-y-4">
                  <VoucherScanner
                    active={cameraActive}
                    onToggle={() => setCameraActive((a) => !a)}
                    onDecode={(text) => { setCameraActive(false); handleLookupVoucher(text) }}
                  />
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {t('gerirclube.redeem_manual_label')}
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={scanInput}
                        onChange={(e) => setScanInput(e.target.value)}
                        placeholder={t('gerirclube.redeem_manual_placeholder')}
                        className="input-field flex-1"
                      />
                      <button
                        type="button"
                        onClick={() => handleLookupVoucher(scanInput)}
                        disabled={!scanInput.trim() || scanLookupState === 'loading'}
                        className="px-4 py-2.5 rounded-ctrl bg-ink-900 text-white font-extrabold text-sm disabled:opacity-50 hover:bg-ink-700 transition-colors duration-fast"
                      >
                        {t('gerirclube.redeem_lookup_button')}
                      </button>
                    </div>
                    {scanLookupState === 'not_found' && (
                      <p className="text-sm text-danger mt-2">{t('gerirclube.redeem_not_found')}</p>
                    )}
                  </div>
                </div>
              )}

              {scanLookupState === 'found' && scannedVoucher && (
                <div className="card space-y-3">
                  <div>
                    <p className="text-[11px] font-mono font-extrabold uppercase tracking-wide text-muted">{t('gerirclube.redeem_detail_owner_label')}</p>
                    <p className="text-base font-extrabold text-ink-900">{scannedVoucher.user?.name || '—'}</p>
                  </div>
                  <div className="pt-3 border-t border-line">
                    <p className="text-[11px] font-mono font-extrabold uppercase tracking-wide text-muted">{t('gerirclube.redeem_detail_mix_label')}</p>
                    <p className="text-sm font-extrabold text-ink-900">{scannedVoucher.game?.title}</p>
                    <p className="text-[11px] text-muted">
                      {scannedVoucher.game?.organization?.name}
                      {scannedVoucher.game?.date && ` · ${formatDateLib(scannedVoucher.game.date, i18n.language, { day: '2-digit', month: 'short', year: 'numeric' })}`}
                    </p>
                  </div>
                  {scannedVoucher.game?.prize && (
                    <div className="pt-3 border-t border-line">
                      <p className="text-[11px] font-mono font-extrabold uppercase tracking-wide text-muted">{t('gerirclube.redeem_detail_prize_label')}</p>
                      <p className="text-sm text-ink-900">{scannedVoucher.game.prize}</p>
                    </div>
                  )}

                  {scannedVoucher.status === 'usado' ? (
                    <p className="pt-3 border-t border-line text-sm text-ink-200">
                      {t('gerirclube.redeem_already_used', {
                        date: scannedVoucher.used_at
                          ? formatDateLib(scannedVoucher.used_at, i18n.language, { day: '2-digit', month: 'short', year: 'numeric' })
                          : '',
                      })}
                    </p>
                  ) : redeemSuccess ? (
                    <p className="pt-3 border-t border-line text-sm text-ok font-extrabold">{t('gerirclube.redeem_confirm_success')}</p>
                  ) : (
                    <div className="pt-3 border-t border-line">
                      {redeemError && <p className="text-sm text-danger mb-2">{redeemError}</p>}
                      <PrimaryButton onClick={handleConfirmRedeem} disabled={redeeming} className="w-full">
                        {t('gerirclube.redeem_confirm_button')}
                      </PrimaryButton>
                    </div>
                  )}

                  <button type="button" onClick={handleResetRedeem} className="text-sm font-extrabold text-ink-700 hover:underline">
                    {t('gerirclube.redeem_search_another')}
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
```

`PrimaryButton` is likely not yet imported in this file — check the existing import from `'../components/ui'` (`import { DateField, DateTimeField, Avatar, Select } from '../components/ui'`) before this step and add `PrimaryButton` to it if it's missing:

Find:

```jsx
import { DateField, DateTimeField, Avatar, Select } from '../components/ui'
```

Replace with:

```jsx
import { DateField, DateTimeField, Avatar, Select, PrimaryButton } from '../components/ui'
```

- [ ] **Step 7: Build verification**

Run: `npm run build`
Expected: builds successfully.

- [ ] **Step 8: Commit**

```bash
git add src/pages/GerirClube.jsx
git commit -m "$(cat <<'EOF'
feat: admin voucher redeem screen (QR scan + manual entry) in GerirClube

New header icon opens a "look up -> show details -> confirm" screen,
mirroring the existing Settings header-icon/own-screen pattern rather
than a new pill tab. Scanner (VoucherScanner) and a manual text input
both feed the same lookup handler; confirm calls admin_redeem_voucher.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011x8RPEBrD2mrnXhyJytueW
EOF
)"
```

---

## Task 9: Final verification pass

**Files:** none (verification only — no changes expected; if any of these checks fail, fix in the relevant earlier task's files and re-commit there, don't patch around it here).

- [ ] **Step 1: Grep for stray references**

Run: `grep -rn "admin_redeem_voucher\|VoucherScanner\|VoucherQRModal\|isValidVoucherId\|normalizeScannedVoucherId\|onShowQR" src/ supabase/migration_voucher_qr_redemption.sql`
Expected: matches only in the files this plan touched — `supabase/migration_voucher_qr_redemption.sql`, `src/lib/vouchers.js`, `src/lib/vouchers.test.js`, `src/components/ui.jsx`, `src/pages/Profile.jsx`, `src/components/VoucherScanner.jsx`, `src/pages/GerirClube.jsx`. No stray partial edits elsewhere.

- [ ] **Step 2: Full build + test verification**

Run: `npm run build`
Expected: builds successfully.

Run: `npx vitest run`
Expected: PASS, including the new `isValidVoucherId`/`normalizeScannedVoucherId` cases from Task 4 — this is otherwise a pure regression check that nothing else in the repo's existing pure-logic test suite broke.

- [ ] **Step 3: Manual verification pass**

If Task 1's migration has been confirmed run against the environment being tested: walk the flow end to end using the `import.meta.env.DEV` "Entrar como Admin" shortcut.

*Player side:* open a Profile with at least one `por_usar` voucher (create one via the existing vouchers-wallet flow if none exists — toggle "tem voucher" on a mix, finalize it as the winning team). Tap the card away from the "Usar" button — confirm the QR modal opens with a scannable image, the mix title, club name, and hint text. Tap "Usar" directly — confirm it still triggers the existing confirm-dialog-then-redeem flow and does *not* also open the QR modal. Confirm a `usado` card has no click-through at all (tapping it does nothing).

*Admin side:* open `GerirClube.jsx` for that voucher's club, tap the new header icon — confirm the redeem screen opens with camera-off, manual field visible. Tap "Ligar câmara" — confirm a permission prompt appears (grant it) and a live preview renders; point it at the QR from the player side — confirm it decodes, stops the camera automatically, and shows the correct owner name / mix title+date / club name / prize text. Tap "Procurar outro," then manually type the same voucher's id into the text field and confirm it produces an identical detail view. With a `por_usar` voucher's detail showing, tap "Confirmar validação" — confirm it flips to the success message; reopen that player's Profile and confirm the card now shows the `usado` state. Look up an already-`usado` voucher (either one just redeemed, or a pre-existing one) — confirm the read-only "already used" state renders with no confirm button. Deny camera permission (or test on a device without a camera) — confirm the fallback message appears and the manual field still works.

Also check: mobile viewport (~400px) — scanner preview, manual field, and detail card all stay legible and don't overflow; the header now has two icon buttons (redeem + settings) that both fit without crowding.

If SQL Editor access is available in this environment, also run through Task 1 Step 3's SQL checks.

If the migration has **not** been confirmed run yet in the environment being tested: state that explicitly in the report. Steps 1-2 of this task (grep + build + vitest) are still fully valid since they don't touch a live database. The player-facing QR modal and the admin screen's *lookup* step can still be manually verified (they don't depend on the new RPC) — only the final "Confirmar validação" tap cannot be, since it calls `admin_redeem_voucher`, which doesn't exist until the migration runs. List that specific gap as what's pending.

- [ ] **Step 4: Report**

No commit in this task (nothing changed). Summarize in the final report: which of Steps 1-3 passed, and — regardless of outcome — restate explicitly that `supabase/migration_voucher_qr_redemption.sql` is not live in production until a human runs it in the Supabase SQL Editor, since that's true independent of anything this task can verify locally.
