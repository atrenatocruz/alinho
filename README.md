# alinho

A multi-tenant padel game management app for friend groups and clubs — centralizes game creation, joining, partner matching, rankings, and syncs with a WhatsApp bot so players can reply "In"/"Out" without opening the app. Portuguese-first (pt-PT), mobile-first.

Live at **https://alinho.pt**.

For the full product vision and constraints, read [`PRODUCT.md`](PRODUCT.md). For the design system (colors, type, components), read [`DESIGN.md`](DESIGN.md). If you're using Claude Code, [`CLAUDE.md`](CLAUDE.md) has the working conventions for this repo.

## Repo layout

- `src/` — the web app: Vite + React + Tailwind, deployed to Vercel.
- `supabase/` — `schema.sql` (base schema, run once on a fresh Supabase project) plus a chronological stack of `migration_*.sql` files (each one already applied to the live project — see [Database changes](#database-changes) below).
- `whatsapp-bot/` — a separate always-on Node/Baileys process that posts mix rosters into a WhatsApp group and syncs "In"/"Out" replies back to `participants`. See [`whatsapp-bot/README.md`](whatsapp-bot/README.md).
- `docs/superpowers/` — design specs and implementation plans for past features, written before each change, kept as a historical record. `.superpowers/sdd/` holds task briefs/reports for larger multi-step efforts. Don't rewrite these to match current state — they're point-in-time.

## Local development

```bash
npm install
cp .env.example .env   # fill in the values — ask a teammate, or point at your own Supabase project and run supabase/schema.sql + every migration_*.sql in date order
npm run dev
```

Open http://localhost:5173. There's a dev-only "Entrar como Admin" shortcut on the login page (gated by `import.meta.env.DEV`, never ships to production) for fast local testing without going through email OTP.

## Stack

- **Frontend**: Vite, React, React Router, Tailwind CSS, `lucide-react` icons, `vite-plugin-pwa`.
- **Backend**: Supabase (Postgres + Auth + Realtime). All authorization is enforced through Postgres Row Level Security — the browser talks to Supabase directly with a publishable anon key, there is no separate API server for the web app.
- **Auth**: passwordless — email OTP or Google OAuth. No stored passwords.
- **WhatsApp bot**: Node.js + [Baileys](https://github.com/WhiskeySockets/Baileys) (unofficial WhatsApp Web client — the official Cloud API can't post into groups). Uses the Supabase **service-role** key, bypassing RLS, so it's kept as a separate process rather than folded into the web app.

## Deployment

See [`DEPLOYMENT.md`](DEPLOYMENT.md) for the full picture (current live setup, plus how to stand up a fresh environment). Short version: the web app auto-deploys to Vercel on every push to `main`; the WhatsApp bot currently runs locally and has a documented path to AWS EC2 in [`whatsapp-bot/README.md`](whatsapp-bot/README.md).

## Database changes

There's no migration runner — every `supabase/migration_*.sql` file is meant to be pasted into the Supabase SQL Editor and run once, by hand, in the order its filename/date implies. When you add a new one, tell whoever has SQL Editor access it needs to be run — a migration file existing in the repo does **not** mean it's live.

## Workflow

Non-trivial features go through the `superpowers` skill workflow: brainstorm → write a design spec (`docs/superpowers/specs/`) → write an implementation plan (`docs/superpowers/plans/`) → implement → review. See `CLAUDE.md` for specifics on how this repo uses it.
