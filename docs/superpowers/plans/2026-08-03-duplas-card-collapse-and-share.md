# Duplas card collapse + full-name layout + WhatsApp share Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the post-"Começar Mix" Duplas card collapsible, replace its
ambiguous `"João / Francisco"` first-name display with per-pair
avatar+full-name rows, and add a WhatsApp share (text + branded image) of
the formed duplas.

**Architecture:** Two files change. `src/components/ShareCard.jsx` gets a
new `DuplasCard` variant (same `CardShell`/`CardAvatar`/`html-to-image`
export pipeline the existing `InviteCard`/`PodiumCard` already use — no new
infrastructure). `src/pages/GameDetails.jsx` gets local UI state for the
collapse and the new share modal, plus a rewritten (not new) Duplas card
JSX block.

**Tech Stack:** React 18, Tailwind utility classes, `lucide-react` icons,
`html-to-image` (already a dependency, used by `ShareCard.jsx`).

## Global Constraints

- No automated test suite in this repo — verification is `npm run build`
  after each task, plus a manual dev-server pass (see Task 3).
- 2-space indent, no semicolons, Portuguese user-facing copy — match every
  neighboring file exactly.
- `teamName()` (first-name-only) stays as-is everywhere except the Duplas
  card itself — winner banner, round match rows, standings, and the
  existing mix-summary share text are explicitly out of scope.
- The Duplas card starts **expanded** (`duplasExpanded` default `true`).
- The "Partilhar" (duplas) button lives inside the Duplas card header,
  visible only while expanded.
- `DuplasCard` image variant: ≤4 duplas uses normal spacing/avatar size
  (34px, matching `PodiumCard`); ≥5 duplas switches to a compact tier
  (22px avatars, tighter spacing) so more pairs fit the fixed 360×640
  canvas.

---

### Task 1: `DuplasCard` variant in `ShareCard.jsx`

**Files:**
- Modify: `src/components/ShareCard.jsx`

**Interfaces:**
- Consumes: existing `CardShell`, `CardAvatar`, `LogoFooter` (all defined
  earlier in this file, unchanged).
- Produces: a `DuplasCard({ game, duplas })` component, and the top-level
  `ShareCard` component (`forwardRef`, exported default) now accepts
  `variant === 'duplas'` in addition to `'podium'`/`'invite'`. `duplas` for
  this variant is an array of `{ id, player1: {id, name, avatar_url},
  player2: {id, name, avatar_url} }` — no `points`/`name` fields required
  (unlike the `duplaStats` shape `PodiumCard` consumes). Task 3 passes this
  prop from `GameDetails.jsx`'s `teams` state, which already has this
  exact shape.

- [ ] **Step 1: Add the `DuplasCard` component**

In `src/components/ShareCard.jsx`, insert after the `PodiumCard` function
(after its closing `}` before the `ShareCard` forwardRef block):

```jsx
// Fixed-height canvas (640px), no scroll — a list of pairs has to fit
// without one. Two density tiers keep it legible either way: normal for
// a typical mix (≤4 duplas), compact (smaller avatars, tighter spacing)
// once there are more pairs than that.
const DUPLAS_COMPACT_THRESHOLD = 5

function DuplasCard({ game, duplas }) {
  const compact = duplas.length >= DUPLAS_COMPACT_THRESHOLD
  const avatarSize = compact ? 22 : 34
  return (
    <CardShell>
      <p className="text-[13px] font-mono font-extrabold tracking-[0.2em] uppercase text-lime-400 mb-3">
        🎾 Duplas
      </p>
      <h1 className={`${compact ? 'text-[22px] mb-1' : 'text-[26px] mb-2'} leading-[1.2] font-bold text-white font-display`}>
        {game.title}
      </h1>
      {game.location && (
        <p className="text-[15px] text-ink-200 font-semibold">{game.location}</p>
      )}
      <div className={`${compact ? 'space-y-1.5 mt-4' : 'space-y-3 mt-8'} flex-1 overflow-hidden`}>
        {duplas.map((d, i) => (
          <div key={d.id} className={`rounded-2xl bg-white/5 ${compact ? 'px-3 py-2' : 'px-4 py-3'}`}>
            <p className={`font-mono font-extrabold uppercase tracking-wide text-lime-400 ${compact ? 'text-[9px] mb-1' : 'text-[11px] mb-2'}`}>
              Dupla {i + 1}
            </p>
            <div className={compact ? 'space-y-1' : 'space-y-1.5'}>
              {[d.player1, d.player2].map((player, idx) => (
                <div key={player?.id || idx} className="flex items-center gap-2">
                  <CardAvatar name={player?.name} url={player?.avatar_url} size={avatarSize} ring />
                  <span className={`text-white font-extrabold truncate ${compact ? 'text-[12px]' : 'text-sm'}`}>
                    {player?.name || '?'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <LogoFooter tagline="junta-te no alinho" />
    </CardShell>
  )
}
```

- [ ] **Step 2: Wire the variant into the `ShareCard` switch**

In the same file, find the `ShareCard` forwardRef's return statement:

```jsx
  return (
    <div ref={nodeRef}>
      {variant === 'podium'
        ? <PodiumCard game={game} duplas={duplas} />
        : <InviteCard game={game} people={people} capacity={capacity} formattedDate={formattedDate} />}
    </div>
  )
```

Replace with:

```jsx
  return (
    <div ref={nodeRef}>
      {variant === 'podium'
        ? <PodiumCard game={game} duplas={duplas} />
        : variant === 'duplas'
        ? <DuplasCard game={game} duplas={duplas} />
        : <InviteCard game={game} people={people} capacity={capacity} formattedDate={formattedDate} />}
    </div>
  )
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: exits 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/ShareCard.jsx
git commit -m "feat: add DuplasCard share-image variant"
```

---

### Task 2: Collapsible Duplas card with avatar+full-name rows

**Files:**
- Modify: `src/pages/GameDetails.jsx`

**Interfaces:**
- Consumes: `teams` state (already loaded, `{id, player1: {id, name,
  avatar_url, is_guest}, player2: {...}, winner_team_id via game}`),
  existing `Avatar`, `GuestBadge` components (already imported), existing
  `handlePickForSwap`, `editingPairs`, `swapPick`, `busy` state (all
  already defined, unchanged).
- Produces: new state `duplasExpanded` (boolean, default `true`). Task 3
  reads/sets nothing from this task directly but renders inside the same
  card header this task builds.

- [ ] **Step 1: Add the `ChevronDown` icon import and new state**

In `src/pages/GameDetails.jsx`, update the `lucide-react` import (currently
line 4):

```jsx
import { Calendar, MapPin, ArrowLeft, UserPlus, User, Check, Lock, Trophy, Play, ChevronRight, Swords, X, Repeat, Share2, ChevronDown } from 'lucide-react'
```

Add new state next to the existing `editingPairs`/`swapPick`/`showShare`
declarations:

```jsx
  const [duplasExpanded, setDuplasExpanded] = useState(true)
```

- [ ] **Step 2: Replace the Duplas card JSX block**

Find this exact block (the whole "Duplas" card, inside the `mixStarted`
fragment):

```jsx
          {/* Duplas */}
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg text-ink-900">Duplas</h3>
              {isAdmin && game.status === 'in_progress' && (
                <button
                  onClick={() => {
                    setEditingPairs(v => !v)
                    setSwapPick(null)
                  }}
                  className="inline-flex items-center gap-1.5 text-ink-700 text-sm font-extrabold min-h-[44px] px-2"
                >
                  <Repeat size={16} />
                  {editingPairs ? 'Concluir' : 'Editar duplas'}
                </button>
              )}
            </div>

            {editingPairs && (
              <p className="text-muted text-sm mb-3 bg-ink-50 rounded-ctrl px-3 py-2.5">
                Toca em <strong className="text-ink-900">dois jogadores</strong> (de duplas diferentes) para os trocar.
              </p>
            )}

            <div className="space-y-2">
              {teams.map((t, i) => (
                <div key={t.id} className={`flex items-center gap-3 rounded-ctrl p-3 ${
                  t.id === game.winner_team_id ? 'bg-lime-400/20' : 'bg-canvas'
                }`}>
                  <span className="w-7 h-7 rounded-full bg-ink-700 text-white text-xs font-extrabold flex items-center justify-center shrink-0">
                    {i + 1}
                  </span>
                  {editingPairs ? (
                    <div className="flex-1 flex items-center gap-1.5 flex-wrap">
                      {[['player1_id', t.player1], ['player2_id', t.player2]].map(([slot, player]) => {
                        const picked = swapPick?.teamId === t.id && swapPick?.slot === slot
                        return (
                          <button
                            key={slot}
                            onClick={() => handlePickForSwap(t.id, slot)}
                            disabled={busy}
                            className={`px-3 py-2 min-h-[40px] rounded-full text-sm font-extrabold transition-all duration-fast active:scale-[0.97] ${
                              picked
                                ? 'bg-lime-400 text-ink-900 ring-2 ring-ink-900'
                                : 'bg-surface text-ink-900 border border-line hover:border-ink-200'
                            }`}
                          >
                            {player?.name?.split(' ')[0] || '?'}
                          </button>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="flex-1 font-extrabold text-ink-900 truncate">
                      {teamName(t.id)}
                      {t.id === game.winner_team_id && ' 🏆'}
                    </p>
                  )}
                  {(t.player1?.is_guest || t.player2?.is_guest) && <GuestBadge />}
                </div>
              ))}
            </div>
          </div>
```

Replace it with:

```jsx
          {/* Duplas */}
          <div className="card">
            <div
              className="flex items-center justify-between mb-3 cursor-pointer"
              onClick={() => setDuplasExpanded(v => !v)}
            >
              <h3 className="text-lg text-ink-900">Duplas</h3>
              <div className="flex items-center gap-1">
                {duplasExpanded && (
                  <>
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowDuplasShare(true) }}
                      className="inline-flex items-center gap-1.5 text-ink-700 text-sm font-extrabold min-h-[44px] px-2"
                    >
                      <Share2 size={16} />
                      Partilhar
                    </button>
                    {isAdmin && game.status === 'in_progress' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setEditingPairs(v => !v)
                          setSwapPick(null)
                        }}
                        className="inline-flex items-center gap-1.5 text-ink-700 text-sm font-extrabold min-h-[44px] px-2"
                      >
                        <Repeat size={16} />
                        {editingPairs ? 'Concluir' : 'Editar duplas'}
                      </button>
                    )}
                  </>
                )}
                <ChevronDown
                  size={20}
                  className={`text-muted transition-transform duration-fast shrink-0 ${duplasExpanded ? 'rotate-180' : ''}`}
                />
              </div>
            </div>

            {duplasExpanded && (
              <>
                {editingPairs && (
                  <p className="text-muted text-sm mb-3 bg-ink-50 rounded-ctrl px-3 py-2.5">
                    Toca em <strong className="text-ink-900">dois jogadores</strong> (de duplas diferentes) para os trocar.
                  </p>
                )}

                <div className="space-y-2">
                  {teams.map((t, i) => (
                    <div key={t.id} className={`rounded-ctrl p-3 ${
                      t.id === game.winner_team_id ? 'bg-lime-400/20' : 'bg-canvas'
                    }`}>
                      <div className="flex items-center justify-between mb-1.5">
                        <p className="text-[11px] font-extrabold text-muted uppercase tracking-wide">
                          Dupla {i + 1}
                        </p>
                        <div className="flex items-center gap-1.5">
                          {t.id === game.winner_team_id && <span>🏆</span>}
                          {(t.player1?.is_guest || t.player2?.is_guest) && <GuestBadge />}
                        </div>
                      </div>
                      {editingPairs ? (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {[['player1_id', t.player1], ['player2_id', t.player2]].map(([slot, player]) => {
                            const picked = swapPick?.teamId === t.id && swapPick?.slot === slot
                            return (
                              <button
                                key={slot}
                                onClick={() => handlePickForSwap(t.id, slot)}
                                disabled={busy}
                                className={`px-3 py-2 min-h-[40px] rounded-full text-sm font-extrabold transition-all duration-fast active:scale-[0.97] ${
                                  picked
                                    ? 'bg-lime-400 text-ink-900 ring-2 ring-ink-900'
                                    : 'bg-surface text-ink-900 border border-line hover:border-ink-200'
                                }`}
                              >
                                {player?.name?.split(' ')[0] || '?'}
                              </button>
                            )
                          })}
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {[t.player1, t.player2].map((player, idx) => (
                            <div key={player?.id || idx} className="flex items-center gap-2">
                              <Avatar name={player?.name} url={player?.avatar_url} size="w-8 h-8 text-xs" />
                              <span className="text-sm font-extrabold text-ink-900 truncate">{player?.name || '?'}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
```

Note: this step references `setShowDuplasShare` — Task 3 adds that state.
Since both tasks touch the same file and this JSX references it before
Task 3 defines it, do Task 3's Step 1 (state) immediately after this step,
before verifying the build, or the build will fail on an undefined
setter. The task boundary is about the reviewable diff, not strict
sequencing — see Task 3.

- [ ] **Step 3: Verify the build**

This will fail until Task 3 Step 1 is also applied (see note above) since
`setShowDuplasShare` doesn't exist yet. Proceed directly to Task 3 Step 1,
then come back and run:

Run: `npm run build`
Expected: exits 0, no errors.

- [ ] **Step 4: Commit**

Commit together with Task 3 (see Task 3 Step 4) — both land in the same
commit since Task 2's JSX references Task 3's state.

---

### Task 3: WhatsApp share of duplas

**Files:**
- Modify: `src/pages/GameDetails.jsx`

**Interfaces:**
- Consumes: `DuplasCard` variant from Task 1 (`variant: 'duplas'` on
  `ShareCard`'s `imageCard` prop), `teams` state, existing `ShareModal`
  component (unchanged props: `title`, `message`, `url`, `onClose`,
  `imageCard`), existing `shareUrl` and `formatDate` already defined in
  this file.
- Produces: state `showDuplasShare` (boolean), function
  `buildDuplasShareMessage()` returning a string.

- [ ] **Step 1: Add `showDuplasShare` state**

Next to the `duplasExpanded` state added in Task 2 Step 1:

```jsx
  const [showDuplasShare, setShowDuplasShare] = useState(false)
```

(Do this before running the build in Task 2 Step 3 — see the note there.)

- [ ] **Step 2: Add `buildDuplasShareMessage`**

Right after the existing `buildShareMessage` function definition:

```jsx
  const buildDuplasShareMessage = () => {
    const lines = [`🎾 Duplas — ${game?.title || 'Mix'}`, '']
    teams.forEach((t, i) => {
      lines.push(`Dupla ${i + 1}: ${t.player1?.name || '?'} & ${t.player2?.name || '?'}`)
    })
    return lines.join('\n')
  }
```

- [ ] **Step 3: Render the duplas `ShareModal`**

Right after the closing `</div>` of the Duplas card (the block Task 2
Step 2 produced), still inside the `mixStarted` fragment, add:

```jsx
          {showDuplasShare && (
            <ShareModal
              title="Partilhar Duplas"
              message={buildDuplasShareMessage()}
              url={shareUrl}
              onClose={() => setShowDuplasShare(false)}
              imageCard={{
                variant: 'duplas',
                game,
                duplas: teams,
                formattedDate: formatDate(game.date),
              }}
            />
          )}
```

- [ ] **Step 4: Verify the build and commit (covers Task 2 + Task 3)**

Run: `npm run build`
Expected: exits 0, no errors.

```bash
git add src/pages/GameDetails.jsx
git commit -m "feat: collapsible Duplas card with full names + WhatsApp share"
```

---

### Task 4: Manual verification

**Files:** none (verification only).

- [ ] **Step 1: Start the app**

Run: `npm run dev`, sign in as admin, open a mix game that has reached
"Começar Mix" (or start one with at least 4 players).

- [ ] **Step 2: Verify the collapsible card**

Confirm the Duplas card is expanded by default, each pair shows "Dupla N"
with two avatar+full-name rows (not "Dupla 1 - João / Francisco"),
clicking the header collapses/expands it (chevron rotates), and clicking
the "Partilhar"/"Editar duplas" buttons does *not* also toggle the
collapse.

- [ ] **Step 3: Verify edit mode still works**

Click "Editar duplas", tap two players from different duplas, confirm they
swap and the card returns to the new avatar+name display afterward.

- [ ] **Step 4: Verify the WhatsApp share**

Click "Partilhar" in the Duplas card header. Confirm the modal opens with
duplas-specific text (not the mix summary), the WhatsApp button opens
`wa.me` with that text, and the share-image button produces a card image
showing "Dupla N" rows with photos — test with a mix that has ≤4 duplas
and, if possible, one with ≥5 to confirm the compact layout doesn't
overflow the card.

- [ ] **Step 5: Full build check**

Run: `npm run build`
Expected: exits 0.

No commit for this task — verification only.
