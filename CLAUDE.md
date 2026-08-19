# alinho — working notes for Claude

Read this before making changes. For the deeper "why", see `PRODUCT.md` (vision, users, positioning, product principles), `DESIGN.md` (visual system), `FEATURES.md` (what's actually built), `README.md` (repo map, local dev), `DEPLOYMENT.md` (where this actually runs).

## What this is, in one paragraph

alinho is a multi-tenant padel game management app: club admins create games ("mixes"), players join solo or with a partner, results feed rankings, and a companion WhatsApp bot lets players reply "In"/"Out" without opening the app. It replaces scattered WhatsApp threads and spreadsheets. Portuguese-first (pt-PT), mobile-first, currently a free pilot with a handful of manually-onboarded clubs — no payments, no self-serve club creation, no fabricated metrics or testimonials anywhere (binding constraint, see `PRODUCT.md`).

## Mindset

- **Simplicity over feature bloat.** Minimum clicks to join a game. Don't add flexibility nobody asked for.
- **Meet players where they are.** The WhatsApp bot exists because forcing everyone into a new app habit doesn't work — integrate into the thread they already use, don't fight it.
- **One identity, many clubs.** Multi-tenant by design (`organizations` + `memberships`), not a fork-per-client. Don't build club-specific one-offs.
- **Don't invent trust signals.** No fake testimonials, user counts, or case studies in copy — ever. State absences plainly instead.
- **Security is RLS, not the UI.** There's no separate API server for the web app — the browser talks to Supabase directly with a publishable anon key. Every authorization rule that matters lives in Postgres Row Level Security policies (`supabase/schema.sql` + `migration_*.sql`), not in a page component's conditional rendering. If you add a feature that touches data, ask "what stops someone from calling this table/RPC directly, bypassing the UI entirely?" — that's the actual security boundary. See `SECURITY_REVIEW.md` for the kind of gap this catches when it's missed (a bug in RLS policy scoping once let any participant submit results for any game).

## Architecture at a glance

- **Web app** (`src/`): Vite + React + React Router + Tailwind, deployed to Vercel, auto-deploy on push to `main`.
- **Backend**: Supabase (Postgres + Auth + Realtime). No ORM, no migration runner — `supabase/schema.sql` is the base schema, `supabase/migration_*.sql` is a dated, sequential stack of hand-run changes. **A migration file existing in the repo does not mean it's live** — someone has to paste it into the Supabase SQL Editor. Always say so explicitly when you add one, and check whether it needs running before assuming a schema change is in effect.
- **Multi-tenancy**: `organizations` (clubs) + `memberships` (per-user, per-org: `is_admin`, `is_guest`, `level`). `profiles` holds only identity that's global across clubs. `profiles.is_platform_admin` (manually granted) is a separate, higher tier — can create new clubs and manage any club, not just ones they're a member of.
- **WhatsApp bot** (`whatsapp-bot/`): separate Node/Baileys process, one per club, uses the Supabase **service-role** key (bypasses RLS) — kept as its own process rather than folded into the web app for exactly that reason. Currently runs locally, not deployed — see `DEPLOYMENT.md`.

## Workflow this repo uses

Non-trivial features go through the `superpowers` skill: brainstorm → write a design spec (`docs/superpowers/specs/YYYY-MM-DD-<slug>-design.md`) → write an implementation plan (`docs/superpowers/plans/YYYY-MM-DD-<slug>.md`) → implement → review. Larger multi-step efforts additionally get task briefs/reports under `.superpowers/sdd/`. **These are historical records, not living docs — don't rewrite old specs/plans to match current state; they document a decision at the time it was made.** If you're planning new work, check whether a spec for it already exists before starting from scratch.

Branch off `main`, not `dev` — `dev` has drifted stale in the past (was 31 commits behind `main` as of 2026-07-30) and isn't the integration branch in practice, whatever its name suggests.

## Things that have bitten people before

- **New git worktree needs its own `.env`** — copy it in manually, it's gitignored and worktrees don't inherit it.
- **Login page has a dev-only "Entrar como Admin" shortcut** (gated by `import.meta.env.DEV`) for fast local testing without email OTP — never ships to production, don't remove the gate.
- **Domain redirects**: the app's canonical domain is `alinho.pt`. If auth/OAuth redirects break after a domain or hosting change, check Supabase → Authentication → URL Configuration — that's dashboard state, not code, and easy to forget (bit Google sign-in once already).
- **RLS policies duplicate logic across tables.** Many policies inline the same `EXISTS (SELECT 1 FROM memberships WHERE ...)` check rather than calling a shared helper function — this is existing debt, not a pattern to copy without checking whether a helper (`is_org_admin`, `shares_org_with`, etc.) already exists and should be reused or extended instead.
- **Don't skip confirmation dialogs on destructive actions** (deleting a mix, removing a member, stopping a recurrence) — these call `confirm()` deliberately; several were added after a review flagged a one-click-destroys-data path.

## Working style (carries over from prior sessions)

- Skip "does this look right?" confirmation loops on straightforward implementation — only pause to ask when a choice is genuinely ambiguous or hard to reverse (e.g., a schema/RLS design decision, deleting files, force-pushing).
- When something is ambiguous enough to need a real decision from the person you're working with, ask concisely rather than guessing and redoing the work.
