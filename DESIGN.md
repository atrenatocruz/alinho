---
name: alinho
description: Confident sports-tech design system for organizing padel games — near-black courts, one lime ball accent, tactile Outfit/Geist typography.
colors:
  near-black: "#040404"
  ink-700: "#1F2937"
  ink-500: "#4B5563"
  ink-200: "#9CA3AF"
  ink-50: "#F3F4F6"
  match-lime: "#C5DD01"
  lime-600: "#99B200"
  lime-100: "#F8FCD4"
  canvas: "#FFFFFF"
  surface: "#F3F4F6"
  line: "#E5E7EB"
  muted: "#4B5563"
  ok: "#10B981"
  danger: "#EF4444"
  warning: "#F59E0B"
typography:
  display:
    fontFamily: "Outfit, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontWeight: 700
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Geist Sans, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Geist Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "11px"
    fontWeight: 700
    letterSpacing: "0.05em"
rounded:
  ctrl: "12px"
  card: "16px"
  full: "9999px"
components:
  button-primary:
    backgroundColor: "{colors.match-lime}"
    textColor: "{colors.near-black}"
    rounded: "{rounded.ctrl}"
    padding: "14px 24px"
    height: "48px"
  button-primary-hover:
    backgroundColor: "{colors.lime-600}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.near-black}"
    rounded: "{rounded.ctrl}"
    padding: "14px 24px"
    height: "48px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
    padding: "20px"
  input-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.near-black}"
    rounded: "{rounded.ctrl}"
    padding: "14px 16px"
    height: "48px"
---

# Design System: alinho

## Overview

**Creative North Star: "The Night Court"**

alinho reads like a padel court under floodlights at night: near-black surfaces (`#040404`) stand in for the dark court and sky, and Match Lime (`#C5DD01`) — the padel ball itself — is the one thing on screen allowed to glow. Everything else stays disciplined graphite and white so that single accent never has competition. The voice is confident sports-tech: bold Outfit headlines, extrabold labels on every tappable surface, liquid-glass header and floating "dynamic island" bottom nav, all built for a player glancing at a phone mid-game rather than someone settling in to read.

This is a deliberate break from the app's prior identity ("Os Padeleiros": court-blue + volt-green, Manrope type, an off-white canvas with white cards floating via shadow). alinho flips that relationship — a pure-white canvas with recessed light-gray cards — and drops the two-hue sports palette for one near-black family plus a single sharp accent.

**Key Characteristics:**
- One accent, used sparingly: Match Lime never competes with itself on a single screen.
- Near-black chrome (header, bottom nav) rendered as liquid glass; page content stays flat and tonal, no drop-shadow drama.
- Every interactive label is extrabold; nothing tappable is ever a light or regular weight.
- The court-line + dashed-net SVG motif recurs as the background signature wherever a dark, ink-900 surface appears.
- 48px minimum tap targets and `active:scale-[0.98]` press feedback everywhere — tactile, one-thumb, built for quick decisions.

## Colors

Near-black and white carry the system; lime is rationed to a single focal point per screen.

### Primary
- **Near Black** (`#040404`): headings, the header/bottom-nav chrome background, primary body text on light surfaces.
- **Charcoal** (`#1F2937`, `ink-700`): secondary high-hierarchy text, links, icon strokes, secondary-button border tone.
- **Dark Gray** (`#4B5563`, `ink-500` / `muted`): supporting body copy, secondary labels, placeholder text.
- **Medium Gray** (`#9CA3AF`, `ink-200`): muted text, disabled states, icon/dashed-border tone for "empty" slots.
- **Light Gray** (`#F3F4F6`, `ink-50` / `surface`): recessed card background, hover tint on light surfaces.

### Secondary
- **Match Lime** (`#C5DD01`): the single brand accent — primary CTA background, "joined"/"live"/"confirmed" state chips, the current-user badge, the logo's ball glyph. Never decorative, never more than one focal use per screen.
- **Hover Lime** (`#99B200`, `lime-600`): CTA hover/active state. Deliberately **darker** than the resting lime — the opposite of the typical lighten-on-hover convention.
- **Lime Tint** (`#F8FCD4`, `lime-100`): soft badge/chip background tint (e.g. the phone-prompt icon chip).

### Neutral
- **Canvas** (`#FFFFFF`): page background.
- **Surface** (`#F3F4F6`): card and sheet background — same value as Light Gray above, distinct role (recessed card, not just a text/hover tint).
- **Line** (`#E5E7EB`): hairline borders on cards, inputs, and dividers.

### Semantic
- **Ok** (`#10B981`): confirmed/closed states, valid input feedback.
- **Danger** (`#EF4444`): errors, invalid input, destructive actions — used at low opacity as a tinted background (`danger/10`) with full-opacity text, not a solid fill.
- **Warning** (`#F59E0B`): pending/temporary-notice states.

### Named Rules
**The One Ball Rule.** Match Lime appears for exactly one focal thing per screen — the primary CTA, or the single most important state (joined, live, confirmed, "this is you"). If two elements compete for lime at once, one of them is wrong.

**The Darker-Hover Rule.** Lime always gets *darker* on hover/active (`lime-400` → `lime-600`), never lighter. This is a deliberate style-guide choice, not an oversight — don't "fix" it back to a lighter hover.

## Typography

**Display Font:** Outfit (weights 500/600/700)
**Body Font:** Geist Sans (weights 400/500/700)
**Label/Mono Font:** Geist Mono (weights 500/700), tracked wide

**Character:** Outfit's geometric confidence carries headlines; Geist Sans stays neutral and legible for body copy; Geist Mono in small, uppercase, tracked-wide bursts marks anything that behaves like a status readout (badges, section eyebrows, level pills) — a nod to scoreboard/terminal typography without going full mono everywhere.

### Hierarchy
- **H1** (bold, `font-display`, tight tracking): page/hero titles.
- **H2** (semibold, `font-display`): section headers.
- **H3/H4** (medium, `font-display`): card titles, modal headers.
- **Body** (regular/medium, Geist Sans, 16–18px): standard copy, form labels.
- **Label** (extrabold, Geist Mono, uppercase, tracked-wide, 11–12px): badges (`LevelBadge`, `GuestBadge`), status chips, day-of-week eyebrows on game cards.

### Named Rules
**The Extrabold-If-Tappable Rule.** Any text on a button, badge, chip, or nav item is `font-extrabold`. Regular and medium weights are reserved for reading copy, never for something the user taps or that signals state.

## Layout

Mobile-first, single-column, centered in a `max-w-2xl` container at every breakpoint — there's no distinct wide-desktop layout; the app scales up within that same centered column rather than opening into a multi-column desktop shell. Spacing follows Tailwind's default 4px scale directly (no custom scale): tight control padding at 12–16px, card padding at 20px, section rhythm at 24–32px. Sticky header (64px) at the top; a floating pill-shaped bottom nav sits above the safe-area inset, never flush to the edge. Content areas use generous touch-friendly spacing; density stays low — this is a glance-and-tap surface, not a dense data table.

## Elevation & Depth

Soft and ambient. Depth mostly comes from tonal layering — a pure-white canvas with recessed light-gray (`surface`) cards and a hairline `line` border — rather than from shadow height. Where shadows do appear (`shadow-card`, `shadow-lift`), they're diffuse, low-opacity, and tinted from near-black itself rather than generic gray, and they intensify only on interaction (a card lifts slightly on hover/press, it doesn't sit "raised" at rest).

The one deliberately dramatic exception is **liquid glass**: the sticky header and floating bottom nav use `bg-ink-900/95` plus `backdrop-blur-xl`, a real material effect reserved exclusively for that persistent chrome.

### Shadow Vocabulary
- **card** (`0 1px 2px rgba(4,4,4,.05), 0 4px 16px rgba(4,4,4,.06)`): resting elevation for cards and sheets.
- **lift** (`0 2px 4px rgba(4,4,4,.07), 0 10px 28px rgba(4,4,4,.10)`): hover/active elevation for tappable cards and open sheets/modals.

### Named Rules
**The Liquid-Glass-Exception Rule.** `backdrop-blur` is reserved for the persistent header and bottom-nav chrome. Page content never uses blur — if a surface needs to feel distinct, use the tonal `surface`/`canvas` relationship instead.

## Shapes

Two radius steps cover the whole system: `rounded-ctrl` (12px) for anything you interact with directly — buttons, inputs, chips, small icon buttons — and `rounded-card` (16px) for containers — cards, sheets, modals. Bottom sheets go further on mobile (`rounded-t-card` on the top corners only, full `rounded-card` once the viewport is wide enough to center them). Badges, pills, and the bottom nav are fully rounded (`rounded-full`). A dashed border is a specific, reusable signal for "empty / not-yet-confirmed / guest" — empty avatar slots, the guest badge, the admin-bypass control — never used for a filled or confirmed element.

The recurring background signature is a low-opacity court motif: a rounded rectangle (the court boundary), a solid center line (the net post), and a dashed horizontal line (the net) — rendered in `white/[0.06]` on `ink-900` surfaces (Login hero, and the equivalent Landing hero). It's the system's one signature illustrative device, reused rather than replaced per surface.

## Components

### Buttons
- **Shape:** 12px radius (`rounded-ctrl`), 48px minimum height, `py-3.5 px-6`, `font-extrabold`.
- **Primary:** Match Lime background, near-black text, `shadow-card` at rest. Hover/active goes to Hover Lime (darker, per the Darker-Hover Rule). Press feedback: `active:scale-[0.98]`.
- **Secondary / Ghost:** `surface` background, near-black text, `line` border; hover moves to `ink-50` background with an `ink-200` border. No fill, no shadow — quiet by design next to the primary lime button.
- **Danger:** `danger/10` tinted background with full-opacity `danger` text — never a solid red fill.
- **WhatsApp:** one deliberate brand exception, `#25D366` solid fill — kept exactly because it needs to be instantly recognizable as "this opens WhatsApp," not reskinned into the ink/lime system.

### Chips / Badges
- **LevelBadge:** pill, Geist Mono extrabold uppercase, tracked-wide. Default: near-black background with lime text; flips to lime background with near-black text when it represents the current user (`me`) — an instant "this one is you" signal.
- **GuestBadge:** pill, dashed `ink-200` border, `canvas` background, muted text — the dashed treatment marks non-regular/provisional participants, consistent with the Shapes section's dashed-means-empty-or-provisional convention.
- **Status chips** (live / joined / closed on `MixCard`): solid pill, icon + text, never text alone — color and icon both carry the state so it reads at a glance.

### Cards / Containers
- **Corner Style:** 16px radius (`rounded-card`).
- **Background:** `surface` (recessed light gray) on the `canvas` (white) page background.
- **Shadow Strategy:** `shadow-card` at rest, `shadow-lift` on hover for tappable cards (see Elevation & Depth).
- **Border:** none by default; `line` hairline appears as an internal divider (e.g. between a card's header and footer rows), not as a card edge.
- **Internal Padding:** 20px (`p-5`).
- **State signal:** a left-edge lime bar (6px) marks "you're in this one" on `MixCard` — a colored edge stripe as a lightweight state indicator, reusable anywhere a card needs a binary "mine/not mine" signal.

### Inputs / Fields
- **Style:** `surface` background, `line` border, 12px radius, 48px minimum height.
- **Focus:** border shifts to `ink-500`, plus a soft `ink-50` focus ring — no glow, no color shift to lime (lime stays reserved for actions/state, not focus).
- **Error:** `danger`-tinted inline message below the field, not a red field border.
- **Pattern:** native date/time/select controls are fully replaced by custom bottom-sheet pickers (`DateField`, `DateTimeField`, `Select`) styled identically to `input-field` as the trigger, opening a portal'd sheet with the same `surface`/`rounded-card`/`shadow-lift` treatment as other modals — cross-browser consistency over native-control convenience.
- **Password fields:** an `input-field` with `pr-12` plus a show/hide toggle (Eye/EyeOff, 44px hit area) absolutely positioned inside the right padding — see `PasswordField` in `src/pages/Login.jsx`.

### Navigation
- **Header:** sticky, `ink-900/95` with `backdrop-blur-xl`, wordmark left, icon actions right at 44px+ tap targets, hairline `white/5` bottom border.
- **Bottom nav:** floating pill, same liquid-glass treatment (`ink-900/95` + blur + `ring-white/10`), pinned above the safe-area inset (never flush). The active item expands to show its label in lime text on a `white/15` chip; inactive items collapse to icon-only in `ink-200`, brightening to white on hover — a "dynamic island" morph rather than a static tab bar.

### Ball-Ring Motif (signature)
The logo's lime ring-and-swirl glyph recurs beyond the wordmark itself: as a countdown progress ring in `RoundTimer`, and as a small accent circle in `EmptyState`'s court-line illustration. Treat it as a reusable signature device for "something is in motion / time-bound" rather than a one-off logo detail.

## Do's and Don'ts

### Do:
- **Do** reserve Match Lime for exactly one focal thing per screen (see The One Ball Rule).
- **Do** keep every tappable label `font-extrabold` — buttons, badges, nav labels, chips.
- **Do** give every tap target a 48px minimum height.
- **Do** make lime hover *darker* (`lime-600`), never lighter.
- **Do** use a dashed border specifically to mean empty, provisional, or guest — never for a filled/confirmed element.
- **Do** reuse the court-line + dashed-net SVG motif at low opacity as the background signature on any `ink-900` hero or sheet, rather than inventing a new background pattern per surface.

### Don't:
- **Don't** bring back the old court-blue/volt-green palette, Manrope typeface, or the old off-white-canvas/white-floating-card relationship — that's the superseded "Os Padeleiros" identity, and the canvas/card relationship is deliberately inverted from it now.
- **Don't** use heavy, directional drop shadows for depth. Cards are flat-plus-tonal, not "lifted." Reserve `backdrop-blur` exclusively for the persistent header/bottom-nav chrome.
- **Don't** fabricate metrics, testimonials, user counts, or screenshots anywhere in the UI (binding constraint from PRODUCT.md).
