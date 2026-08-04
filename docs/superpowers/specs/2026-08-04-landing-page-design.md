# Landing page for alinho — design

## Purpose

alinho currently has no public-facing page. Visiting `/` while logged out
immediately redirects to `/login` — a bare auth form with no explanation of
what the product is. This spec adds a real marketing landing page that
becomes the front door of the site for logged-out visitors, explains what
alinho does, and offers clear sign-in/sign-up entry points.

Positioning: alinho is framed as a general product any group of padel
friends can adopt (matches the multi-organization support already in the
backend — `organizations` table, `join_organization` RPC), not as a private
tool for one specific group. However, there is currently **no self-serve
"create your own group" flow** — joining happens via an invite link
(`?org=<slug>`) or auto-joining the single existing default organization.
Landing copy must not promise self-serve group creation.

## Routing

- New page component: `src/pages/Landing.jsx`.
- `App.jsx`, the `/` route: currently wrapped in `ProtectedRoute`, which
  redirects any logged-out visitor straight to `/login`. This route changes
  to branch directly instead of using `ProtectedRoute`:
  - while `showSplash` is true → `<SplashScreen />` (unchanged behavior)
  - else if `user` → `<Layout><Home /></Layout>` (unchanged behavior for
    logged-in members)
  - else → `<Landing />` (new)
- No other route changes. `/login` keeps working exactly as it does today,
  including the `?redirect=` and `?org=` handling.
- `Login.jsx` gains one small addition: read an optional `?mode=signup`
  query param on mount and use it to set the initial `mode` state (defaults
  to `'login'` when absent, as today). This lets the landing page's "Criar
  conta" CTA link to `/login?mode=signup` and land the visitor directly on
  the signup tab, while "Entrar" / "Já tenho conta" CTAs link to plain
  `/login`.

## Visual language

Reuses the existing design system entirely — no new tokens, fonts, or
component classes are introduced.

- Color: `ink-900` (near-black) as the dominant dark surface, `lime-400`/
  `lime-600` as the single sharp accent, `canvas`/`surface` for light
  sections, per `src/index.css` tokens.
- Type: Outfit for headings (`font-display`), Geist Sans for body
  (`font-sans`), Geist Mono for small uppercase eyebrow labels, matching
  current usage.
- Components: `.btn-primary`, `.btn-secondary`, `.card`, `rounded-card`
  (16px), `rounded-ctrl` (12px), `shadow-card`/`shadow-lift` — all pulled
  from `src/index.css`, not redefined.
- Motion: existing `animate-fade-up` / `animate-fade-in` keyframes only,
  respecting the existing `prefers-reduced-motion` block. No new animation
  library.
- Motif: the court-lines + dashed net-line SVG background and the wordmark's
  lime ball/swirl (see `Login.jsx` hero and `Layout.jsx`'s `Wordmark`) are
  the recurring visual signature — the landing hero evolves this same motif
  rather than introducing a new one.
- Icons: `lucide-react`, reusing the same icons already assigned to each
  feature elsewhere in the app (`Home`/calendar-style icon for Jogos,
  `Trophy` for Rankings, `Users` for Comunidade, `PadelIcon` for Clubes,
  a phone/message icon for the WhatsApp bot, a lock/users icon for Jogos
  privados) so the landing page's iconography matches the in-app nav.

## Page sections

1. **Nav** — sticky header. Transparent over the hero, solidifies to
   `ink-900` (matching `Layout.jsx`'s header treatment) once scrolled.
   `Wordmark` (light-background variant is not applicable here since it
   starts over a dark hero — use the dark variant, matching Login's usage)
   on the left. Right side: "Entrar" text link → `/login`, plus a
   "Criar conta" pill button → `/login?mode=signup`. On narrow mobile
   widths the nav can collapse to just "Entrar" to avoid crowding.

2. **Hero** — full-bleed `ink-900` section with the court-lines/dashed-net
   SVG motif in low-opacity white (as in `Login.jsx`). Contents:
   - Bold Outfit headline naming the real pain point (organizing padel
     games over scattered WhatsApp threads, lost scores/rankings) and the
     one-line promise alinho delivers instead.
   - One-line subhead in `ink-200`.
   - Two CTAs: primary `.btn-primary` "Criar conta" → `/login?mode=signup`,
     secondary `.btn-secondary`-style (adapted for the dark background,
     matching the outline treatment) "Já tenho conta" → `/login`.
   - A floating, slightly tilted mockup card built from real UI classes
     (`.card`, badge/chip styles, `PrimaryButton`-style visual language) —
     e.g. a representative "game card" showing a date, location, and
     player avatars/slots, the same visual grammar `Home.jsx` uses for real
     game cards. This is illustrative UI, not a screenshot — no image
     assets required.

3. **Features grid** — light `canvas`/`surface` section, responsive grid
   (1 column mobile → 2 at `sm` → 3 at `lg`), one card per real feature:
   - Jogos — create/join games, auto-partner matching, real-time updates
   - Rankings — automatic stats, win rate, points tracking
   - Comunidade — see the group's members
   - Clubes — club info
   - Jogos privados — invite-only private matches
   - WhatsApp bot — reply "In"/"Out" in the group chat to manage a mix
     without opening the app
   Each card: icon in a `lime-400/15`-tinted rounded chip (matching the
   treatment already used in `Instructions.jsx`'s `PhoneRequiredModal`
   icon), bold title, one-line description. No fabricated metrics,
   testimonials, or user counts anywhere on the page.

4. **How it works** — 3 numbered steps, horizontal on `lg`, stacked on
   mobile, connected by the same dashed-line motif as the hero's net line:
   1. Cria a tua conta
   2. Junta-te a um jogo (ou cria um, se fores admin)
   3. Acompanha os teus resultados e o ranking

5. **Closing CTA band** — full-bleed `lime-400` or `ink-900` strip (pick
   whichever contrasts better against the features section immediately
   above it) with one line restating the value prop and a single button
   → `/login?mode=signup`.

6. **Footer** — minimal: `Wordmark`, "Entrar" / "Instruções" (→
   `/instrucoes`, an existing public page) links, © current year. No social
   links, no fake badges.

## Explicitly out of scope

- No self-serve "create your own organization/group" flow — doesn't exist
  in the backend today (only `join_organization` by slug and the single
  default-org auto-join). Landing copy must not promise this.
- No embedded auth form on the landing page itself — all sign-in/sign-up
  CTAs link to the existing `/login` page, which already has the complete
  Google + email/password login and signup forms. Avoids duplicating auth
  logic.
- No real product screenshots — illustrative mockups built from the app's
  own UI classes instead, per the earlier decision to avoid depending on
  screenshot assets.
- No changes to `index.html` meta tags — the existing description
  ("App para gerir jogos de padel do grupo alinho") and theme-color are
  adequate and untouched.
- No changes to any authenticated page (`Home`, `Rankings`, `Admin`, etc.)
  or to the `Layout` component's nav/header.

## Testing

Manual verification only (no existing test suite in this project):
- Logged-out visit to `/` shows `Landing`, not a redirect to `/login`.
- Logged-in visit to `/` still shows `Home` inside `Layout`, unchanged.
- All CTAs on the landing page (nav, hero, closing band, footer) navigate
  to the correct destination, and `/login?mode=signup` opens with the
  signup tab pre-selected.
- Responsive check at mobile (375px), tablet, and desktop widths.
- `prefers-reduced-motion` respected (no motion-only regressions).
