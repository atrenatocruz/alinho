# Features

What alinho actually does today, and what's explicitly not built yet. Kept in sync with the app — when you ship something, update this file in the same PR rather than letting it drift (see the history of this file before 2026-08-19 for what happens otherwise: it went unmaintained for a month and described a different, single-tenant app).

## Authentication & identity

- Passwordless auth: email OTP or Google OAuth. No stored passwords.
- One profile per person, shared across every club they belong to (`profiles`) — level, guest status, and admin rights are per-club (`memberships`), not global.
- A person can belong to more than one club/organization at once.
- Phone numbers are never stored in plaintext — only an HMAC-SHA256 hash, so the WhatsApp bot can match a phone number to a player without the number itself ever reaching Supabase.

## Multi-tenant clubs

- Clubs ("organizations") are isolated via Supabase RLS, keyed off `memberships.organization_id`.
- Club admins manage their club from **Gerir** (`/gerir` → `/gerir/:slug`): games, members, and settings, tab by tab.
- **Platform admins** (`profiles.is_platform_admin`, granted manually via SQL) can create new clubs from Gerir, appointing anyone as that club's first admin, and can open and manage any club — access is granted on demand via a real admin membership, not an invisible bypass.
- Clubs can opt in to a public directory (**Clubes & Grupos**, `/clubes`) — `is_global` clubs are discoverable and searchable by anyone; `open_join` controls whether joining is instant or goes through an admin-approved request queue.

## Game management ("Mixes")

- Create, edit, delete games: title, date/time, location, price per player, prize, number of courts, court/game duration, format (`sobe e desce` or `todos contra todos`).
- Recurring mixes: a game can spawn future occurrences automatically on a schedule (daily/weekly/monthly/yearly), with a configurable "launch N days before, at HH:MM" that controls when the next occurrence becomes visible/joinable. Occurrences are pre-created as `pending` and flip to `open` at their launch time.
- A game closes automatically once enough players confirm for its court count (4 per court).
- Suplentes (waitlist): once a game is full, further joins go to a waitlist and are promoted automatically as spots free up.

## Player participation

- Join a game solo (auto-partner matching) or with a specific partner.
- Leave a game before it closes.
- Round-robin match generation and score entry once a game is under way; a round timer helps admins keep courts moving.
- Duplas (pair) cards are shareable — collapse/expand and share as an image.

## Private matches

- 2x2 games outside any club, created and joined via a shareable link (`/jogos-privados`), gated behind a feature flag (`admin_set_feature_flag`) any club admin can toggle for the whole app.
- Contributes to a separate "private" ranking track, combined with club points into a global total.

## Rankings & stats

- Per-club ranking plus a cross-club **Geral** (global) ranking that only counts `is_global` clubs' points, so a private club's numbers don't leak into a ranking non-members can see.
- Per-player stats: matches played/won, points, mix wins — configurable points-per-action per club (`organizations.points_rules`).
- Unified player profile page (`/jogador/:id`) — one identity across every club a person plays in.

## WhatsApp bot

- Separate always-on process (`whatsapp-bot/`) posts the mix roster into a WhatsApp group and syncs "In"/"Out"/"Fora" replies with `participants`, so players never have to open the app to book or release a spot.
- One bot process per club (its own WhatsApp number/session, scoped to one `organization_id`).

## UI/UX

- Fully Portuguese (pt-PT) interface, mobile-first.
- PWA: installable on iOS/Android, offline page caching, app manifest.
- Design system: near-black + lime accent, Outfit/Geist typography — see `DESIGN.md`.

## Explicitly not built

- No self-serve "create your own club" flow — creation is platform-admin-only (see Multi-tenant clubs above). Don't imply otherwise in copy.
- No payments/court-booking cost tracking beyond the informational price-per-player field.
- No push notifications, no email notifications beyond the OTP itself.
- No monetization/pricing model exists yet.

## Roadmap

Not tracked in this file — check open GitHub issues, or `docs/superpowers/plans/` for specs already written but not yet built.
