# Voucher QR Redemption — Design Spec

Date: 2026-09-14. Follow-on to the Profile Vouchers Wallet feature (Trello **#200**, already live on `main` — `docs/superpowers/specs/2026-09-14-profile-vouchers-wallet-design.md`). Brainstormed and approved with Renato in a prior session; this document records the resulting design, not a re-opened discussion.

## Goal

Replace the current fully honor-system redemption ("Usar" button, player marks their own voucher used, no verification) with a second path that mirrors how a physical voucher actually works: the player shows something at the counter, staff validates and redeems it. Concretely — tapping a voucher on the player's own Profile shows a QR code carrying the voucher's id; a club admin gets a camera scanner (plus a manual-entry fallback) inside `GerirClube.jsx` that looks the voucher up, shows what it is and who it belongs to, and only redeems it on the admin's explicit confirmation.

The existing self-service "Usar" button is **not removed** — both paths coexist as two ways to reach the same end state (`vouchers.status = 'usado'`). Whichever happens first wins; no new coordination mechanism is added beyond the idempotency `mark_voucher_used` already has, because the new admin path gets the identical idempotency shape in its own RPC (see Backend Changes).

## Key Decisions

**Why does the QR carry only the voucher's bare UUID, with no signature or expiring token?**
Confirmed with Renato: this is a convenience carrier, not a security boundary — the same posture this repo already takes everywhere per `CLAUDE.md`'s security framing ("what stops someone from calling this table/RPC directly, bypassing the UI entirely?"). A leaked or guessed voucher UUID alone gets an attacker nothing: reading the row requires being the owner or an org-mate (existing RLS), and redeeming it requires being an admin of that specific organization (new RPC's own check, below). Adding a signed/expiring token would protect against a threat that doesn't exist here — nobody bypasses RLS by knowing a UUID — so it's YAGNI for a pilot feature.

**Why is the admin flow two-step (look up → show details → confirm) instead of scan-and-redeem-instantly?**
This is the entire point of the feature over the existing self-service button: it lets the admin *validate* — see whose voucher it is, what it's for, and its current status — before committing, the way a till operator reads a physical voucher before honoring it. An instant-redeem-on-scan flow would just be the self-service button with extra steps. The confirm step uses a real button in the detail view (not a browser `confirm()`) because, unlike this repo's other `confirm()`-gated destructive actions (deleting a mix, removing a member), there's a full details screen to show first — the details themselves are the confirmation UI; a bare yes/no dialog on top would be redundant.

**Why a new `admin_redeem_voucher` RPC instead of extending `mark_voucher_used`?**
`mark_voucher_used(p_voucher_id)` hard-requires `user_id = auth.uid()` in its `WHERE` clause — that's exactly wrong for an admin redeeming *someone else's* voucher. Loosening that check would also loosen the self-service path's own guarantee (a player can only ever mark their own voucher used), which nothing about this feature asks for. Two small, parallel `SECURITY DEFINER` functions — one gated on ownership, one gated on org-admin membership — is a direct mirror of how this repo already handles "same table, two different authorization shapes for two different callers" (compare `finalize_mix`'s admin-only write path against the read-only RLS policy on the same tables).

**Why not a shared internal SQL helper between the two RPCs?**
Considered and rejected as unnecessary indirection. The two functions differ in exactly the part that can't be factored out cleanly: the authorization predicate (`user_id = auth.uid()` vs. an `EXISTS (... memberships ...)` admin check) and the user-facing error message. A shared helper would need to take the predicate itself as a parameter — effectively dynamic SQL — to save roughly ten lines of an `UPDATE ... WHERE ... status = 'por_usar'` statement that's simple enough to read at a glance in each function. Two independent, fully-readable functions is the simpler design here; this is the "don't over-engineer" call flagged as open in the brief, resolved in favor of duplication over abstraction.

**Why does the read path (admin looking up a voucher's details) need no new RPC?**
The existing `vouchers` SELECT policy (`"Own or org-mates vouchers"`, `USING (user_id = auth.uid() OR shares_org_with(user_id))`) already permits this: a club admin is definitionally an org-mate of every other member of their club, so they can already `SELECT` any voucher belonging to someone in their org directly via PostgREST. This mirrors exactly how the vouchers wallet spec itself already reasoned about org-mates reading each other's vouchers (a small-club pilot product where teammates already see each other's stats). No new table, column, or policy — just a richer `.select()` with two more joins (the voucher's owner, via `profiles`) than `Profile.jsx`'s own wallet query already uses.

**Why does the scanner live in `GerirClube.jsx` behind its own header icon, rather than as a fourth pill tab or a button inside the Members tab?**
`GerirClube.jsx` already has this exact precedent for an infrequent, full-screen, distinct-workflow admin action: Settings. It is **not** a fourth entry in the `games`/`members` pill-tab row — it's reached via a gear icon button in the page header, swaps in as its own full-screen view (`activeTab === 'settings'`), and has its own back button that returns to `games`. Voucher redemption has the same shape: infrequent (happens only when a player is physically at the counter), a genuinely separate workflow from both "manage games" and "manage members" (it's about validating one voucher, not managing the member roster), and self-contained enough that it doesn't need to share screen space with anything else while it's open. Reusing the Settings pattern — a second header icon button next to the gear, entering a hidden-from-the-pill-row `activeTab === 'redeem'` screen — was chosen over:
- **A fourth pill tab.** Rejected: the pill row is already tight on a ~400px viewport with two entries plus a request-count badge on Members; a third/fourth pill for an action used rarely (at the counter, not during normal club admin work) would permanently cost screen width for something most sessions never touch. Tabs in this file are reserved for the three *standing* admin concerns (games, members, club settings); redemption is closer to a one-off tool.
- **A button inside the Members tab.** Considered because redemption is "about a specific player," but rejected: it conflates two unrelated tasks (managing the roster vs. validating a voucher at checkout) on one screen, and there's no natural anchor — the admin scanning a QR doesn't already know which member row to attach the button to; the whole point is that the lookup step *finds* the player.

**Why does the admin-facing detail view need the owner's name, and how is it fetched?**
Without it, "validate" is meaningless — the admin needs to see whose voucher this is before honoring it, the same way a till operator checks a name on a physical voucher. `Profile.jsx`'s own wallet query already establishes the nested-select shape for `game`/`organization`; this feature adds one more nested relation, `user:profiles!vouchers_user_id_fkey (name)`, following the exact FK-hint-qualified join syntax already used elsewhere in this codebase for a `profiles` join that needs disambiguation (e.g. `GameDetails.jsx`'s `user:profiles!participants_user_id_fkey (id, name, ...)`). `vouchers.user_id` has exactly one foreign key to `profiles` (no second FK from this table to `profiles` to disambiguate against), so the hint is technically optional to PostgREST here — it's still specified explicitly in this spec to match the codebase's established convention rather than relying on an implicit single-path inference that could break if a future migration ever adds a second `profiles` reference to this table.

## Data Model

No new tables and no new columns. `vouchers` (`id, game_id, user_id, organization_id, status, created_at, used_at`) is unchanged — this feature adds only a second write path (a new RPC) and a richer read (`.select()` with one more join) against the existing table and its existing RLS policy.

## Backend Changes (SQL)

### `admin_redeem_voucher` — the new redeem-on-behalf-of-owner RPC

New `SECURITY DEFINER` RPC, `authenticated`-callable, mirroring `mark_voucher_used`'s idempotency shape (`UPDATE ... WHERE status = 'por_usar'`, `RAISE EXCEPTION` on `NOT FOUND`) but replacing the ownership check with the same org-admin check shape `finalize_mix` and `correct_finished_mix_match` already use (`EXISTS (SELECT 1 FROM memberships WHERE organization_id = ... AND user_id = auth.uid() AND is_admin)`):

```sql
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

Two lookups instead of one (`SELECT organization_id` first, then the guarded `UPDATE`) because the admin check needs `organization_id` *before* the update can run — unlike `mark_voucher_used`, where the ownership predicate (`user_id = auth.uid()`) can live directly in the `UPDATE ... WHERE` clause without a prior read. A voucher id that doesn't exist at all is reported as "não encontrado" at the first check rather than falling through to the generic "não encontrado ou já usado" of the second — slightly more precise, though both are already unreachable through the UI's own lookup step (see Data Flow), which only ever calls this RPC after a successful read of the same row.

`mark_voucher_used` itself is **not modified** — it keeps its exact current body, still the only path for the self-service "Usar" button.

### No RLS changes

The existing `"Own or org-mates vouchers"` SELECT policy already covers the admin read path (see Key Decisions). No new policy, no new column, no change to `migration_vouchers.sql`'s original shape.

## Components (Frontend)

### New npm dependencies

- **`qrcode` (^1.5.4)** — QR generation, rendering the voucher id as a scannable image in the player-facing detail view. Small, dependency-light, produces a `data:image/png;base64,...` string via `QRCode.toDataURL(text)` that a plain `<img>` can render — no canvas wiring needed in the component itself. Verified via the npm registry: latest published version 1.5.4, ~19.1M weekly downloads as of the week of 2026-09-05 — by far the standard choice for this in the JS ecosystem, and QR generation is a stable, already-solved algorithm domain where infrequent releases aren't a maintenance red flag.
- **`html5-qrcode` (^2.3.8)** — camera access + decode for the admin scanner, bundling permission handling and the decode loop into one package rather than hand-wiring `getUserMedia` + a separate raw decoder (e.g. `jsQR`). Verified: latest published version 2.3.8 (April 2023 — no release in ~3.5 years as of this spec). This staleness was checked against the obvious alternative, `qr-scanner` (the nimiq package): also stale (1.4.2, November 2022 — *older* than `html5-qrcode`'s last release) and, per npm's download-stats API, at roughly a quarter of `html5-qrcode`'s adoption (258K vs. 1.15M weekly downloads, week of 2026-09-05). Both target the same stable, slow-moving browser APIs (`getUserMedia`, `<canvas>` `ImageData`), so neither staleness reflects a broken package — `html5-qrcode` is kept as the better-justified pick because it remains far more widely relied upon despite the same lack of recent releases, and it's the more turnkey option (built-in start/stop lifecycle and camera-list handling), reducing how much of that lifecycle this feature has to hand-roll itself. If `html5-qrcode` ever does break against a future browser change, the required manual-entry fallback (below) already covers the resulting gap without a code change.
- Neither package conflicts with anything in the existing `package.json` dependency list (checked: no existing QR/camera/barcode dependency, no duplicate transitive concern flagged by either package's own peer-dependency list — both are dependency-free at runtime).

### `src/lib/vouchers.js` — new pure helper

Extends the existing pure-logic module (currently just `sortVouchersForWallet`) with a voucher-id validator, used by both the manual-entry path and as a guard before ever querying with scanner output (a mis-scanned or garbage QR shouldn't reach Supabase at all):

```js
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
// below), so this is a tolerance measure for hand-typed input with stray
// whitespace, not a supported "voucher URL" format.
export function normalizeScannedVoucherId(value) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  const segments = trimmed.split('/')
  return segments[segments.length - 1].trim()
}
```

Both functions are pure and framework-free, following the same `src/lib/xp.js`/`src/lib/vouchers.js` precedent this repo already uses for anything unit-testable without mocking Supabase.

### `VoucherCard` (`src/components/ui.jsx`) — click-through to QR

Existing component (`src/components/ui.jsx`, currently lines 592-627) gains one new optional prop, `onShowQR`, and the card's own `por_usar` branch becomes clickable — the `usado` branch is untouched (no QR affordance for an already-redeemed voucher, per the locked decision):

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
      {/* ...unchanged header/prize markup... */}
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

`e.stopPropagation()` on the existing "Usar" button's click handler is the one required change to existing behavior — without it, tapping "Usar" would also fire the new card-level `onShowQR`, opening the QR modal on top of the confirm dialog it just triggered. `onShowQR` is optional (`undefined` is a safe no-op prop default) so existing callers that don't pass it keep working unchanged — relevant only if this component is ever reused somewhere that shouldn't have the QR affordance, which isn't currently the case but costs nothing to keep optional.

### New: `VoucherQRModal` (`src/components/ui.jsx`)

Exported alongside the other `...Modal` components in this file (`PhotoViewerModal`, `FollowListModal`, `ShareModal`), following `PhotoViewerModal`'s exact shape: `createPortal`, dark backdrop, renders nothing without its subject so callers can mount it unconditionally, closes on backdrop click or an explicit X:

```jsx
export function VoucherQRModal({ voucher, onClose }) {
  const { t } = useTranslation()
  const [qrDataUrl, setQrDataUrl] = useState(null)

  useEffect(() => {
    if (!voucher) return
    let cancelled = false
    QRCode.toDataURL(voucher.id, { margin: 1, width: 256 })
      .then((url) => { if (!cancelled) setQrDataUrl(url) })
      .catch((err) => console.error('Error generating voucher QR code:', err))
    return () => { cancelled = true }
  }, [voucher])

  if (!voucher) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 animate-fade-in p-4" onClick={onClose}>
      <div className="card max-w-xs w-full text-center" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} aria-label={t('ui.close')} className="absolute top-3 right-3 ...">
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
```

`voucher` is a small plain object (`{ id, gameTitle, organizationName }`) built by the caller from the row it already has, not a re-fetch — the modal has no data-loading responsibility of its own beyond generating the QR image, matching `PhotoViewerModal`'s own "purely presentational, caller supplies everything" shape. `QRCode` imported from `qrcode`; `useEffect`/`useState`/`X`/`createPortal` are all already imported in `ui.jsx` today (used by the other modals in this file).

### `src/pages/Profile.jsx` — wiring the click-through

New state, `qrVoucher` (the small object above, or `null`), and a handler that only opens the modal for a `por_usar` voucher (defensive — the card itself never calls this for a `usado` one, but the handler stays honest about the precondition rather than relying solely on the caller):

```js
const [qrVoucher, setQrVoucher] = useState(null)

const handleShowVoucherQR = (v) => {
  if (v.status !== 'por_usar') return
  setQrVoucher({ id: v.id, gameTitle: v.game?.title || '', organizationName: v.game?.organization?.name || '' })
}
```

`VoucherCard` in the wallet stack (current `Profile.jsx` ~line 1210) gains `onShowQR={() => handleShowVoucherQR(v)}`. `<VoucherQRModal voucher={qrVoucher} onClose={() => setQrVoucher(null)} />` renders once, unconditionally, near this file's existing `<PhotoViewerModal .../>` mount point — same "always mounted, renders nothing without its subject" convention.

### `src/pages/GerirClube.jsx` — admin redeem screen

**Header:** a new icon button next to the existing Settings gear button (current ~line 1355-1363), same `w-11 h-11` circular icon-button styling, opening the redeem screen:

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
```

Placed before the Settings button so Settings stays the rightmost/most-peripheral action, matching how Settings is already the most infrequent of the three standing tabs. `QrCode` added to this file's `lucide-react` import list.

**Tab visibility:** the existing pill row's guard (`{activeTab !== 'settings' && (...)}`) becomes `{activeTab !== 'settings' && activeTab !== 'redeem' && (...)}` — the redeem screen is hidden from the pill row exactly like Settings already is, entered only via its header icon and exited only via its own back button.

**New state**, alongside this file's existing form-state declarations:

```js
const [scanInput, setScanInput] = useState('')
const [scanLookupState, setScanLookupState] = useState('idle') // 'idle' | 'loading' | 'not_found' | 'found'
const [scannedVoucher, setScannedVoucher] = useState(null)
const [redeeming, setRedeeming] = useState(false)
const [redeemError, setRedeemError] = useState('')
const [redeemSuccess, setRedeemSuccess] = useState(false)
const [cameraActive, setCameraActive] = useState(false)
```

**Lookup handler** (called from both the manual-entry submit and the scanner's decode callback, after normalizing/validating via the new `src/lib/vouchers.js` helpers):

```js
const handleLookupVoucher = async (rawId) => {
  const id = normalizeScannedVoucherId(rawId)
  if (!isValidVoucherId(id)) {
    setScanLookupState('not_found') // treated the same as "not found" — see Error Handling
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
```

A voucher belonging to a different organization is filtered out by RLS before it ever reaches this handler — PostgREST returns an empty result the same way a genuinely nonexistent id would, so both cases render identically as "not found" (see Error Handling; this is intentional, not a gap — it avoids revealing that *a* voucher exists at that id when the admin has no right to see it).

**Confirm handler:**

```js
const handleConfirmRedeem = async () => {
  setRedeeming(true)
  setRedeemError('')
  const { error } = await supabase.rpc('admin_redeem_voucher', { p_voucher_id: scannedVoucher.id })
  setRedeeming(false)
  if (error) {
    console.error('Error redeeming voucher:', error)
    setRedeemError(t('gerirclube.redeem_confirm_error'))
    // Re-fetch so the detail view reflects reality (e.g. someone else
    // redeemed it in the gap between lookup and this confirm tap).
    handleLookupVoucher(scannedVoucher.id)
    return
  }
  setScannedVoucher((v) => ({ ...v, status: 'usado', used_at: new Date().toISOString() }))
  setRedeemSuccess(true)
}
```

**Reset handler** ("Procurar outro"), clearing lookup state back to the scan/manual-entry screen for the next redemption:

```js
const handleResetRedeem = () => {
  setScanInput('')
  setScanLookupState('idle')
  setScannedVoucher(null)
  setRedeemError('')
  setRedeemSuccess(false)
}
```

**Screen body** (`activeTab === 'redeem'`, new section mirroring the Settings screen's own "back button + heading" opening):

```jsx
{activeTab === 'redeem' && (
  <div>
    <button type="button" onClick={() => { setActiveTab('games'); handleResetRedeem() }} className="inline-flex items-center gap-1.5 text-ink-700 font-extrabold text-sm hover:underline mb-4">
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
          <label className="block text-sm font-medium text-gray-700 mb-2">{t('gerirclube.redeem_manual_label')}</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              placeholder={t('gerirclube.redeem_manual_placeholder')}
              className="input-field flex-1"
            />
            <button type="button" onClick={() => handleLookupVoucher(scanInput)} disabled={!scanInput.trim() || scanLookupState === 'loading'} className="...">
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
          <p className="text-[11px] text-muted">{scannedVoucher.game?.organization?.name} · {formatDateLib(scannedVoucher.game?.date, i18n.language, { day: '2-digit', month: 'short', year: 'numeric' })}</p>
        </div>
        {scannedVoucher.game?.prize && (
          <div className="pt-3 border-t border-line">
            <p className="text-[11px] font-mono font-extrabold uppercase tracking-wide text-muted">{t('gerirclube.redeem_detail_prize_label')}</p>
            <p className="text-sm text-ink-900">{scannedVoucher.game.prize}</p>
          </div>
        )}

        {scannedVoucher.status === 'usado' ? (
          <p className="pt-3 border-t border-line text-sm text-ink-200">
            {t('gerirclube.redeem_already_used', { date: formatDateLib(scannedVoucher.used_at, i18n.language, { day: '2-digit', month: 'short', year: 'numeric' }) })}
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
```

This screen body is illustrative of structure and state wiring for the implementation plan to follow precisely — exact Tailwind classes for the lookup button and disabled states should match this file's existing `input-field`-adjacent button conventions (e.g. the `handleCopyInviteLink` button in the Members tab) rather than being invented fresh.

### New: `src/components/VoucherScanner.jsx`

A small, self-contained component wrapping `html5-qrcode`'s camera lifecycle — extracted rather than inlined into the already-large `GerirClube.jsx` (2,500+ lines) for the same reason `PlayerSearch` already lives in its own file and is imported in: camera start/stop has real lifecycle concerns (must stop the stream on unmount or when toggled off, must handle permission denial) that are easier to reason about and test in isolation than inline inside an already-dense tab body.

```jsx
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Html5Qrcode } from 'html5-qrcode'
import { Camera, CameraOff, ScanLine } from 'lucide-react'

const SCANNER_ELEMENT_ID = 'voucher-qr-scanner'

// Camera-based QR scanning only via `active`/`onToggle`/`onDecode` props —
// this component owns no state about *what* was scanned, only the camera
// lifecycle. `onDecode` fires once per successful scan; the caller is
// responsible for turning `active` back off afterwards (GerirClube.jsx
// does this itself in its onDecode callback) so a second stray frame
// can't fire a second decode while the parent is still processing the
// first one.
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
        () => {} // per-frame "no code in this frame" — expected, not an error
      )
      .catch((err) => {
        console.error('Error starting camera:', err)
        setPermissionError(true)
      })
    return () => {
      scanner.stop().catch(() => {}).finally(() => scanner.clear())
    }
  }, [active])

  return (
    <div>
      <button type="button" onClick={onToggle} className="w-full flex items-center justify-center gap-2 text-sm font-extrabold px-4 py-2.5 rounded-ctrl bg-ink-50 text-ink-700 hover:bg-ink-200 transition-colors duration-fast">
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

Camera is **off by default** when the redeem screen opens — it only starts when the admin explicitly taps the toggle button. This avoids an unsolicited permission prompt on every visit to the screen (most redemptions might reasonably go through manual entry if the admin's device/lighting makes scanning awkward) and keeps the required manual-entry fallback genuinely equal-first-class rather than visually secondary to the camera.

## Architecture

No new backend process, no new API surface beyond the one RPC above. Same shape the vouchers wallet feature itself already established: the browser talks to Supabase directly (publishable anon key), every authorization rule lives in RLS or inside a `SECURITY DEFINER` function, and the WhatsApp bot process is untouched. The only genuinely new client-side surface is browser camera access (`getUserMedia`, via `html5-qrcode`), which is local to `VoucherScanner.jsx` and has no server-side counterpart — the server never knows or cares whether a voucher id arrived via camera or manual typing, both funnel into the identical `handleLookupVoucher` → `handleConfirmRedeem` path.

## Data Flow

**Self-service (existing, unchanged):** player taps "Usar" on their own `por_usar` `VoucherCard` → `confirm()` → `mark_voucher_used(voucher_id)` → row flips to `usado`.

**QR click-through (new):** player taps anywhere else on a `por_usar` `VoucherCard` → `VoucherQRModal` opens, generating a QR image (`qrcode` lib) encoding the voucher's bare `id` → player shows this screen at the counter.

**Admin redeem (new):**
1. Admin opens `GerirClube.jsx`, taps the new header QR icon → `activeTab` becomes `'redeem'`, a fresh (`idle`) lookup screen renders.
2. Admin either (a) taps "start camera," points it at the player's QR, `VoucherScanner` decodes and calls back with the raw text, camera auto-stops; or (b) types/pastes the id into the manual field and taps "Procurar." Both funnel into `handleLookupVoucher`.
3. `handleLookupVoucher` normalizes/validates the id shape, then reads the voucher row (with owner name, mix, prize, club name) via the existing RLS-authorized `SELECT`. Not found (bad shape, genuinely nonexistent id, or a different org's voucher silently filtered by RLS) → inline "not found" message, screen stays on the lookup step for another attempt.
4. Found → detail card renders. If `status === 'usado'` already, it's a read-only "already redeemed, on `<date>`" state with a "search another" exit and no confirm button. If `status === 'por_usar'`, a "Confirmar validação" button appears.
5. Admin taps confirm → `admin_redeem_voucher(voucher_id)` RPC. Success → detail card updates in place to show a success message; admin taps "search another" to reset for the next player. Failure (most likely: someone else — the player's own "Usar" tap, or a different admin — redeemed it in the gap between lookup and confirm) → inline error, and the screen re-fetches the row so the admin immediately sees the real current state rather than a stale "still redeemable" view.

## Error Handling

- **Invalid or garbage scanned/typed text.** Rejected client-side by `isValidVoucherId` before any query — same "not found" message as a well-formed-but-nonexistent id, since there's no product reason to distinguish "that's not shaped like a voucher id" from "that id doesn't exist" for the admin.
- **Voucher belongs to a different organization.** RLS filters the row out before the admin's query ever returns it — indistinguishable, by design, from "not found." This avoids confirming to an admin that *a* voucher exists at a scanned/typed id they have no right to see, matching this repo's existing posture that authorization failures shouldn't leak existence.
- **Voucher already redeemed** (by the player's own "Usar" tap, or by a different admin scan) **before this admin's lookup.** The detail view shows the already-`usado` state directly from the initial `SELECT` — no confirm button ever appears, so there's no race to protect against at this stage.
- **Voucher redeemed by someone else in the gap between this admin's lookup and their confirm tap** (the one real race). `admin_redeem_voucher`'s `UPDATE ... WHERE status = 'por_usar'` finds zero rows and raises; the client catches the RPC error, shows it, and re-fetches the row so the UI immediately reflects the true current state instead of silently retrying or leaving a stale "still redeemable" view up.
- **Non-admin somehow reaching the redeem screen.** Not reachable through the UI — `GerirClube.jsx` itself is already gated per-organization at the route level (`resolveOrg`, existing code: only a membership with `is_admin`, or a platform admin via `ensureOrgAdminAccess`, ever sets `org` and renders the page body at all). Even if it were reached, `admin_redeem_voucher`'s own `EXISTS (... is_admin)` check is the real boundary and would raise regardless of what the UI shows — matching `CLAUDE.md`'s framing that the RPC-level check, not the page guard, is what actually stops a direct call.
- **Camera permission denied, no camera hardware, or `html5-qrcode` failing to start for any other reason.** `VoucherScanner`'s `.start(...).catch(...)` sets `permissionError`, showing a short inline message; the manual-entry field is always rendered alongside the scanner (never conditionally hidden behind "try camera first"), so this is a graceful narrowing to one working input, not a dead end.
- **Camera scanning over a non-HTTPS, non-localhost origin.** Browsers refuse `getUserMedia` entirely outside a secure context (HTTPS or `localhost`) — this app already deploys via Vercel over HTTPS, so production is unaffected, and local dev over `http://localhost` is also fine per the same browser rule. Flagged here as a constraint to be aware of, not a blocker: if anyone ever tests over a plain-HTTP dev tunnel (not `localhost`), the camera button will fail to start and the manual-entry fallback is what covers that session, exactly like a real permission denial would.
- **Migration not yet run in production.** Both the new `SELECT` shape (extra join) and the `admin_redeem_voucher` RPC call fail (missing function / unknown column) until `migration_voucher_qr_redemption.sql` is pasted into the Supabase SQL Editor. The redeem screen's lookup handler already logs-and-shows-"not found" on any query error, so this fails soft into the same "not found" message rather than a broken screen — though in this specific case that's a misleading message (it isn't really "not found," the backend piece isn't live yet); this is called out explicitly in the implementation plan's rollout note rather than special-cased in the UI copy, matching how the original vouchers wallet spec treated its own "relation does not exist" case as an acceptable fail-soft rather than a distinct UI state.

## i18n

`src/locales/pt.json` is source of truth, written first; `src/locales/en.json` mirrors every key.

**New keys, `profile.*`:**
- `profile.voucher_qr_hint`: "Mostra este código ao staff do clube para validar o voucher."

**New keys, `gerirclube.*`:**
- `gerirclube.redeem_voucher_label`: "Ler QR code"
- `gerirclube.redeem_heading`: "Validar voucher"
- `gerirclube.redeem_start_camera`: "Ligar câmara"
- `gerirclube.redeem_stop_camera`: "Desligar câmara"
- `gerirclube.redeem_camera_unavailable`: "Não foi possível aceder à câmara. Usa o código manualmente abaixo."
- `gerirclube.redeem_manual_label`: "Ou introduz o código do voucher"
- `gerirclube.redeem_manual_placeholder`: "Código do voucher"
- `gerirclube.redeem_lookup_button`: "Procurar"
- `gerirclube.redeem_not_found`: "Voucher não encontrado."
- `gerirclube.redeem_detail_owner_label`: "Jogador"
- `gerirclube.redeem_detail_mix_label`: "Mix"
- `gerirclube.redeem_detail_prize_label`: "Prémio"
- `gerirclube.redeem_already_used`: "Este voucher já foi usado a {{date}}."
- `gerirclube.redeem_confirm_button`: "Confirmar validação"
- `gerirclube.redeem_confirm_success`: "Voucher validado com sucesso."
- `gerirclube.redeem_confirm_error`: "Não foi possível validar o voucher."
- `gerirclube.redeem_search_another`: "Procurar outro"

`gerirclube.back_button` and `ui.close` are existing keys, reused as-is. No existing keys are removed or changed.

## Testing

Same split this codebase already uses everywhere else (`vitest` for pure logic only; no RLS/RPC/component test harness):

- **Automated (`vitest`):** `src/lib/vouchers.test.js` gains new cases for `isValidVoucherId` (well-formed UUID accepted, case-insensitive, rejects empty string/non-UUID text/`null`/`undefined`) and `normalizeScannedVoucherId` (trims whitespace, strips a URL-style wrapper down to its last path segment, passes a bare id through unchanged).
- **Explicitly not automated:** `VoucherScanner.jsx`'s camera lifecycle (`html5-qrcode` integration) and any component test exercising real `getUserMedia` — this repo has no browser/camera test harness, and CI/local `vitest` runs have no camera to grant permission to. This mirrors the same testing posture the original vouchers wallet spec already took for its own Supabase-backed UI.
- **Manual, SQL Editor** (after running the new migration against a dev/staging Supabase project):
  - `admin_redeem_voucher` as an admin of the voucher's own org (succeeds); as an admin of a *different* org (raises "Apenas admins podem validar este voucher"); as a non-admin member of the same org (raises the same); on an already-`usado` voucher (raises "Voucher não encontrado ou já usado"); on a nonexistent id (raises "Voucher não encontrado").
  - Confirming `mark_voucher_used` and `admin_redeem_voucher` racing on the same voucher (call both in quick succession) — exactly one succeeds, the other raises; final state is `usado` either way, never double-processed.
- **Manual, UI smoke test** in dev (`import.meta.env.DEV` "Entrar como Admin" shortcut):
  - Player: tapping a `por_usar` card opens the QR modal with a scannable image; tapping "Usar" still works and does *not* also open the QR modal; a `usado` card has no click-through at all.
  - Admin: header icon opens the redeem screen; camera toggle requests permission and (on grant) shows a live preview; scanning a real generated voucher QR decodes correctly and surfaces the right owner/mix/prize; manual entry of the same id produces an identical detail view; an already-`usado` voucher shows the read-only state with no confirm button; confirming a `por_usar` voucher flips it to the success state, and reopening the same player's Profile shows the card now in its `usado` state without a manual refresh being required beyond the normal Profile reload.
  - Denying camera permission (or testing on a device/browser without one) shows the fallback message and the manual field still works.
  - Mobile viewport (~400px) — scanner preview, manual field, and detail card all stay legible and don't overflow.

## Migration Rollout

`supabase/migration_voucher_qr_redemption.sql` — new, self-contained, re-runnable (uses `CREATE OR REPLACE FUNCTION`, `REVOKE`/`GRANT`), adding only `admin_redeem_voucher`. **This file existing in the repo does not mean it has run** — per `CLAUDE.md`, someone (Renato) has to paste it into the Supabase SQL Editor before the admin redeem screen's confirm step works in production; the player-facing QR modal and the admin's *lookup* step (a plain `SELECT` against already-live RLS) work without it — only the final `admin_redeem_voucher` RPC call depends on this migration having actually run. This must be restated at the end of the implementation plan.

## Out of Scope

- **Signed or expiring QR tokens.** The QR is a bare voucher UUID; see Key Decisions for why a stronger token isn't warranted here.
- **Removing or changing the existing self-service "Usar" button/`mark_voucher_used` RPC.** Explicitly kept as-is, unchanged, per the locked decision that both paths coexist.
- **A shared SQL helper between `mark_voucher_used` and `admin_redeem_voucher`.** Considered and rejected — see Key Decisions.
- **Un-redeeming / reversing an admin-confirmed redemption.** Same "no undo" posture the original wallet feature already established for `mark_voucher_used` — a voucher marked `usado` by either path stays `usado`.
- **Batch/multi-voucher scanning in one session.** "Procurar outro" resets to a fresh lookup one voucher at a time; no queue or history-of-redemptions-this-session view.
- **A dedicated "redemption history" or audit log surface.** `vouchers.used_at` already records when a voucher was redeemed; no new admin-facing report or export is built here.
- **Uploading a QR image file instead of live camera scanning** (`html5-qrcode` supports this as an option, but it isn't requested and the manual-entry fallback already covers the "camera doesn't work" case more directly).
- **WhatsApp bot surface.** No bot command or message related to voucher redemption — web-app-only, same as the original wallet feature.
