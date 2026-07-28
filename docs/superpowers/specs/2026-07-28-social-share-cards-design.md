# Social share cards (Instagram) — design

## Problem

Players want to promote a mix ("come play") or brag about results ("we won")
on Instagram/WhatsApp. Today "Partilhar" (`GameDetails.jsx` → `ShareModal`)
only produces plain text + a link — nothing image-based, and nothing branded.

## Goal

From the same "Partilhar" entry point on the mix page, let anyone generate
a branded, on-theme image (alinho ink/lime look) sized for Instagram
Stories, and hand it straight to the OS share sheet (or download it).

Two variants, chosen automatically from the mix's current status:

- **Invite card** — `game.status` is `open`/`closed`/`in_progress` (not yet
  finished). Promotes the mix: title, date/time, location, who's already in.
- **Podium card** — `game.status === 'finished'`. Top 3 players from
  `mix_player_stats` (already loaded into `mixStats`, sorted by
  `points_earned` desc), medal-styled — this covers both "we won" and
  "here's how the mix went".

No new trigger surfaces (Home, Rankings) in this pass — just the existing
"Partilhar" button on the mix detail page, which already sees both game
states.

## Format

Instagram Story ratio, 1080×1920 PNG. Works as a Story share directly; also
fine to drop into a feed post or a WhatsApp chat (recipients just see a tall
image).

## Approach

**New dependency:** `html-to-image` (`toPng`). Renders a real DOM node to a
PNG client-side — no server, no canvas-manual-drawing, keeps existing fonts
(Outfit/Geist, already self-hosted via `@fontsource/*`) and the logo SVG
looking exactly like the rest of the app. Chosen over `html2canvas` for
better SVG/webfont fidelity and a much smaller bundle.

**New component** `src/components/ShareCard.jsx`:
- Renders the branded card off-screen (`position: fixed; left: -9999px`) at
  full 1080×1920 px, plus a scaled-down `<div style="transform: scale(...)">`
  wrapper for the on-screen preview — same DOM, so preview and export always
  match exactly.
- Two sub-layouts, `variant="invite" | "podium"`, both built from the same
  shell: ink-900 background, faint court-line motif (reuses the pattern
  already in `EmptyState`), `primary-dark-card.svg` wordmark pinned to the
  bottom, lime accent on headline numerals/medals.
- Exposes an imperative `exportPng()` (via `useImperativeHandle` + `ref`)
  that calls `toPng` on the full-size node and resolves a `Blob`.

**`ShareModal` (ui.jsx) changes:**
- New top section, above the existing text-share block: renders
  `<ShareCard variant={...} ... />` (scaled preview) + one button,
  "Partilhar imagem":
  - Calls `exportPng()` → gets a `Blob` → builds a `File`.
  - If `navigator.canShare?.({ files: [file] })` → `navigator.share({ files: [file], title, text: caption })`. This is the path that opens the OS sheet with Instagram as a direct target on phones.
  - Else → trigger an `<a download>` on an object URL for the blob, and show
    a one-line hint: "Imagem guardada — abre o Instagram e escolhe-a nos teus stories."
- Existing WhatsApp/copy-link/text-caption section stays unchanged below it.

**`GameDetails.jsx` changes:**
- Pass the data the card needs into `ShareModal`: `game`, `people` (already
  computed), `mixStats` (already loaded), so it can pick+build the right
  variant. No new data fetching — everything the cards need is already
  loaded on that page today.

## Content specifics

**Invite card:**
- 🎾 + game title (Outfit bold, large)
- Formatted date/time + location (reuses `formatDate` already in
  `GameDetails`)
- "X/Y jogadores" + up to 6 avatars/initials (same data as
  `PlayerAvatarRow`, drawn manually since this is rasterized, not live DOM
  reused across pages)
- Footer: alinho wordmark + "junta-te no alinho"

**Podium card:**
- 🏆 "Resultados do Mix" + game title
- Top 3 rows from `mixStats`: medal (🥇🥈🥉), player name, points. Degrades
  to however many players actually have stats (2 if only 2 played).
- Footer: alinho wordmark

## Error handling

- `exportPng()` failures (rare — font/image load race) caught, show
  "Não foi possível gerar a imagem. Tenta novamente." inline, existing
  text-share path is unaffected since it's a separate section.
- `navigator.share` throwing (user cancelled the OS sheet) is swallowed,
  same pattern already used for the native-share fallback below it.

## Out of scope

- Square/feed-ratio variant (Story-only per this pass).
- Any share card outside the mix detail page.
- Server-side image generation (not needed — this is a static SPA).
