# Deployment

## Current live setup

- **Web app**: Vite + React SPA, deployed on **Vercel** from GitHub `atrenatocruz/alinho`, branch `main`, auto-deploy on push. `vercel.json` rewrites every route to `index.html` for client-side routing and sets security headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, HSTS).
- **Domain**: **https://alinho.pt** (and `www.alinho.pt`) is the primary domain. The original `*.vercel.app` URL still resolves but isn't linked anywhere anymore. When touching auth/redirect/absolute-URL logic, use `alinho.pt` — and if the domain ever changes again, double check Supabase → Authentication → URL Configuration (Site URL + Redirect URLs), since that's dashboard config, not code, and easy to forget (this broke Google sign-in once already: it silently fell back to the old Vercel URL until the allowlist was updated).
- **Backend**: Supabase, project ref `subiamucdrhxsxuippmy`. Uses the browser-safe publishable key (`sb_publishable_...`) in Vercel env vars `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`. Auth: email OTP (confirm-email off) + Google OAuth.
- **WhatsApp bot** (`whatsapp-bot/`): as of this writing it still runs **locally**, on a machine the team controls, from this same repo's `whatsapp-bot/` folder — not deployed anywhere. A code change there only takes effect after that process is restarted by hand; there's no CI/deploy step. The plan is to move it to a small always-on host (AWS EC2 free tier was the pick — see `whatsapp-bot/README.md` for full step-by-step for both EC2 and Fly.io) once that migration happens. **Check with the team before assuming this has changed** — this file won't update itself.

## Database changes

There's no migration runner. `supabase/schema.sql` is the base schema (for a fresh project); every `supabase/migration_*.sql` file is an incremental change, meant to be pasted into Supabase → SQL Editor → New query → Run, by hand, in date order. A migration file existing in the repo does not mean it's live — check with whoever has SQL Editor access, or diff against the live schema, before assuming a migration ran.

## Setting up a second/fresh environment

Only needed if you're spinning up a new environment (staging, a fork, local testing against your own project) — the environment above already exists and doesn't need re-creating.

1. **Supabase**: create a project, open SQL Editor, run `supabase/schema.sql`, then every `migration_*.sql` in date order. Authentication → Providers: enable Email (confirm-email off is simplest for small groups). Settings → API: copy the Project URL and publishable/anon key.
2. **Vercel**: import the GitHub repo, framework preset Vite, build command `npm run build`, output directory `dist`. Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (from step 1). Deploy.
3. **First admin**: sign up through the deployed app (email OTP), then in Supabase → Table Editor → `memberships`, find your row and set `is_admin = true`. (There's no `profiles.is_admin` anymore — admin rights are per-club, on the `memberships` row, since the multi-tenant rewrite. If you need platform-admin — the ability to create new clubs and manage any club — that's `profiles.is_platform_admin`, granted directly via SQL, no UI for it by design.)
4. **WhatsApp bot** (optional, per club): see `whatsapp-bot/README.md`.

## Free-tier limits (current Supabase/Vercel plans)

Fine for the current pilot scale (a handful of manually onboarded clubs). Revisit if/when that changes — Supabase Pro and Vercel Pro are both paid upgrades if the free tier is ever actually hit.

## Troubleshooting

- **"supabase not configured" / "Failed to fetch"**: check `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` in Vercel's env vars, redeploy after changing them.
- **Email OTP doesn't arrive**: check spam, confirm Email auth is enabled in Supabase.
- **Google sign-in falls back to the wrong domain**: see the domain note above — check the Redirect URLs allowlist.
- **A migration doesn't seem to have taken effect**: it probably hasn't been run yet — see "Database changes" above.
