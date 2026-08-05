# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: club/group admins who onboard their friend group or padel club onto alinho — creating games, managing membership, and organizing weekly play. Secondary: individual players within those groups, who join games, track rankings, and reply "In"/"Out" via WhatsApp without opening the app.

## Product Purpose

alinho replaces scattered WhatsApp threads and spreadsheets for organizing padel games among friend groups and clubs. It centralizes game creation, joining (solo or with a partner), automatic partner matching, real-time participant visibility, and automatic ranking/stats calculation after results are submitted.

## Positioning

Framed as a general product any group of padel friends or a club can adopt — not a private tool built for one specific group — backed by real multi-tenant support (`organizations` table, org-scoped data via `memberships`). Differentiates from commercial club-management tools (e.g. Robot Padel) by staying simpler, faster to use, and by integrating directly into WhatsApp (a bot posts the mix roster into the group chat; replying "In"/"Out" syncs to the app) rather than requiring everyone to leave the chat thread they already use.

## Operating Context

- All UI is Portuguese (pt-PT); the audience organizes and plays padel casually, not as a commercial club running tournaments.
- Games commonly assume groups of 4 (padel doubles); a game auto-closes when 4 players confirm.
- Onboarding is currently manual and invite-link based (`?org=<slug>` or default-org auto-join) — there is no self-serve "create your own organization" flow yet.
- A companion WhatsApp bot (`whatsapp-bot/`) runs as a separate per-client process (its own WhatsApp number/session, scoped to one `organization_id`), posting rosters and syncing In/Out replies.
- Phone numbers are never stored in plaintext — only an HMAC-SHA256 hash computed via a shared secret outside Supabase, so the same person can be matched across clubs without exposing their number.

## Capabilities and Constraints

- Multi-tenant: a player can belong to more than one club/organization at once; the org boundary is enforced via Supabase RLS through `memberships`.
- Auth is passwordless (email OTP / Google), no stored passwords.
- Currently a free pilot — 2-5 manually onboarded clients, no payment flow exists. Monetization and pricing are explicitly undecided; do not invent claims about either.
- No self-serve organization/club creation exists yet — do not promise it in copy.
- No fabricated metrics, testimonials, user counts, or case studies anywhere in product surfaces.

## Brand Commitments

- Name: **alinho** (rebranded from "Os Padeleiros" / "padel.app"). The rename is complete across the web app.
- Identity: near-black + a lime accent (the padel ball) on a neutral gray scale, Outfit (display) + Geist Sans/Mono (body/labels) typography, defined in a user-provided brand style guide and logo SVGs under `src/logo/`.
- Tagline in use: "E tu, alinhas?"

## Evidence on Hand

- Brand style guide image and logo SVG set (`src/logo/`) define the current visual identity.
- No real testimonials, customer logos, or usage metrics exist yet — future work must not fabricate any.

## Product Principles

1. Simplicity first — no feature bloat, minimum clicks to join a game.
2. Meet players where they already are — WhatsApp integration over forcing a new habit.
3. Mobile-first, Portuguese-native — not translated, designed in Portuguese for phone use.
4. One identity, many clubs — multi-tenant by design, not a fork-per-client.
5. Don't fabricate trust signals — real content only, absences stated rather than filled.

## Accessibility & Inclusion

No specific standard confirmed as a binding requirement.
