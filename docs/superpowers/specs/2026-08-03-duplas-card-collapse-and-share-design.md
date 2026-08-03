# Duplas card: collapsible, unambiguous layout, WhatsApp share

**Date**: 2026-08-03
**Status**: Approved

## Context

After "Começar Mix", the Duplas card in `src/pages/GameDetails.jsx` shows
each pair as `"1 - João / Francisco"` via `teamName()`
(`GameDetails.jsx:641-646`), which joins first names only. Two players
sharing a first name are indistinguishable. The card is also always fully
expanded, and there's no way to share the formed pairs to WhatsApp (only
the overall mix summary can be shared, via the existing `ShareModal` at
`GameDetails.jsx:758-773`).

## Part 1 — Collapsible card, full-name + avatar layout

`GameDetails.jsx`, the Duplas card block (currently lines 882-943):

- New state `const [duplasExpanded, setDuplasExpanded] = useState(true)`.
- Header becomes a clickable row (title + chevron) toggling
  `duplasExpanded`. The existing "Editar duplas" toggle and a new
  "Partilhar" button move into this header, rendered only when expanded,
  with `e.stopPropagation()` on their clicks so they don't also toggle the
  collapse.
- Each non-editing pair row drops the numbered circle badge and the
  `teamName()` string, replaced with:
  ```
  Dupla {i+1}                          🏆 (if winner_team_id)
  [Avatar] {player1.name}
  [Avatar] {player2.name}
  ```
  using the existing `Avatar` component (`src/components/ui.jsx:435`) fed
  by `t.player1`/`t.player2` (`{id, name, avatar_url}`, already loaded by
  the `teams` query at `GameDetails.jsx:106-113` — no new query needed).
  `GuestBadge` moves next to the trophy in the header row of each pair.
- Edit-mode (tap-two-players-to-swap pill buttons, lines 913-932) is
  unchanged — different interaction, not in scope.

Out of scope (explicitly deferred): `teamName()` is still used elsewhere
(winner banner, round match rows, standings, the mix-summary share text)
and keeps its first-name-only ambiguity there. Only this card changes.

## Part 2 — WhatsApp share of duplas

The new "Partilhar" button in the Duplas card header opens the existing
`ShareModal` (`src/components/ui.jsx:601-800`) — same component the mix
summary share already uses — with duplas-specific content:

**Text** (`buildDuplasShareMessage()`, new function in `GameDetails.jsx`
next to `buildShareMessage()`):
```js
const buildDuplasShareMessage = () => {
  const lines = [`🎾 Duplas — ${game?.title || 'Mix'}`, '']
  teams.forEach((t, i) => {
    lines.push(`Dupla ${i + 1}: ${t.player1?.name || '?'} & ${t.player2?.name || '?'}`)
  })
  return lines.join('\n')
}
```
Full names, so the shared text is unambiguous too. `ShareModal` appends
`\n\n🔗 {url}` automatically (existing behavior), `url` = the same
`shareUrl` (current page link) already used for the mix share.

**Image**: new `DuplasCard` variant in `src/components/ShareCard.jsx`,
alongside the existing `InviteCard`/`PodiumCard` (same `CardShell`,
`html-to-image` export at fixed 360×640, canvas-baked circular avatars via
the existing `CardAvatar`/`bakeCircularAvatar` — iOS Safari compatibility,
already solved by that file). Renders every pair as "Dupla N" + two
avatar+full-name rows, in document order (`teams` array — already sorted
by formation order, no re-sort needed). Two density tiers based on pair
count, since the card is a fixed-size canvas:
- **≤4 duplas**: current `PodiumCard`-scale avatars (34px) and spacing.
- **≥5 duplas**: compact tier — smaller avatars (~22px) and tighter
  row/section spacing, so up to ~10-12 pairs still fit the fixed height
  without overflow or scrolling (a card image can't scroll).

`ShareCard`'s top-level switch (`src/components/ShareCard.jsx:225-253`)
gets a new `variant === 'duplas'` branch. `GameDetails.jsx` passes
`imageCard={{ variant: 'duplas', game, duplas: teams, formattedDate: formatDate(game.date) }}`
— `teams` already has the `{player1, player2}` shape `DuplasCard` needs,
no transformation required (unlike `duplaStats`, which is podium-specific
and adds computed `points`).

The modal's existing "share as text" (wa.me) and "share image"
(navigator.share / download) buttons work unchanged — only the content
passed into the modal differs from the mix-summary share.

## Testing

No automated test suite in this repo (established in the prior feature's
plan). Verification is `npm run build` after each change, plus a manual
pass in the dev server: expand/collapse the card, confirm avatar+full-name
rows render correctly including for guests and for same-first-name pairs,
confirm edit-mode swapping still works, and confirm both WhatsApp-text and
share-image buttons produce correct duplas-specific content for a mix with
≤4 duplas and one with ≥5 (compact layout).
