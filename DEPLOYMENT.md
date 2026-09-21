# Deployment

## Current live setup

- **Web app**: Vite + React SPA, deployed on **Vercel** from GitHub `atrenatocruz/alinho`, branch `main`, auto-deploy on push. `vercel.json` rewrites every route to `index.html` for client-side routing and sets security headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, HSTS).
- **Domain**: **https://alinho.pt** (and `www.alinho.pt`) is the primary domain. The original `*.vercel.app` URL still resolves but isn't linked anywhere anymore. When touching auth/redirect/absolute-URL logic, use `alinho.pt` — and if the domain ever changes again, double check Supabase → Authentication → URL Configuration (Site URL + Redirect URLs), since that's dashboard config, not code, and easy to forget (this broke Google sign-in once already: it silently fell back to the old Vercel URL until the allowlist was updated).
- **Backend**: Supabase, project ref `subiamucdrhxsxuippmy`. Uses the browser-safe publishable key (`sb_publishable_...`) in Vercel env vars `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`. Auth: email + password (confirm-email off until the SMTP below is live) + Google OAuth.
- **WhatsApp bot** (`whatsapp-bot/`): deployed on an **AWS EC2 free-tier instance** (see `whatsapp-bot/README.md` for the EC2 deploy steps — Docker, `--restart unless-stopped`). A code change there needs a manual redeploy to that instance; there's no CI/auto-deploy step for it the way there is for the Vercel app. **Check with the team for current access/redeploy steps before assuming this file is exhaustive** — it won't update itself.

## Auth dashboard config (not in code)

Supabase → Authentication settings live in the dashboard, not the repo, so a code change that depends on them does nothing until someone updates them by hand.

**URL Configuration → Redirect URLs.** The app builds every auth redirect from wherever the visitor is standing, never from a fixed domain:

- password reset: `${window.location.origin}/redefinir-password` (`src/contexts/AuthContext.jsx`)
- Google sign-in and email signup: `window.location.href` — any path

So the allow-list has to cover **every origin people actually use**, not just `alinho.pt`. Checklist:

- [ ] `https://alinho.pt/**`
- [ ] `https://www.alinho.pt/**` — `www` resolves too and `vercel.json` does not redirect it to the bare domain, so someone on `www` sends `https://www.alinho.pt/redefinir-password`
- [ ] the Vercel URL `dev` deploys to, if anyone tests auth there
- [ ] `http://localhost:5173/**` for local testing
- [ ] **Site URL** = `https://alinho.pt`

If a redirect is not on the list, Supabase does not error: it silently falls back to the Site URL. For password reset that means the link **signs the person in on the home page and never shows the "new password" screen** — it looks like it worked while the password was never changed. Google sign-in already relies on `window.location.href`, so if it works on a given origin, a wildcard for that origin is probably already there; confirm rather than assume.

**Email Templates → Reset Password.** The default is generic English. The Portuguese version, with its subject line, is versioned in `supabase/templates/reset-password.pt.html` — paste it by hand; this project does not use the Supabase CLI, so nothing loads it automatically. Supabase keeps one text per email, not one per language.

## Email (SMTP)

Provider: **Resend**, sending as `alinho <noreply@alinho.pt>`. Two separate paths use it, and both are dashboard/secret state — nothing in the repo makes either one live. Design and rationale: `docs/superpowers/specs/2026-09-21-smtp-email-transacional-design.md`.

**1. Domain (once).** Resend → Domains → add `alinho.pt`, region EU. Copy the records it shows into Cloudflare (the zone's DNS host), all as **DNS only** (grey cloud): an MX and a TXT (SPF) on `send`, and a TXT (DKIM) on `resend._domainkey`. The DKIM value is unique to the account, so take it from the Resend screen, not from here. None of these touch the root domain's own MX/TXT. Add one more by hand — Resend doesn't create it:

- [ ] TXT `_dmarc` → `v=DMARC1; p=none; rua=mailto:alinhopt@gmail.com`

Wait for Resend to show the domain as verified before going on. Then create an API key with **Sending access**, restricted to `alinho.pt`.

**2. Supabase Auth emails** (password reset, signup confirmation). Supabase → Authentication → Emails → SMTP Settings:

- [ ] Enable custom SMTP. Host `smtp.resend.com`, port `465`, username `resend`, password = the API key
- [ ] Sender email `noreply@alinho.pt`, sender name `alinho`
- [ ] Authentication → Rate Limits → raise "emails per hour" from the custom-SMTP default (30) if needed — keep it under Resend's free-tier cap of 100/day
- [ ] Email Templates: paste `supabase/templates/reset-password.pt.html` and `supabase/templates/confirm-signup.pt.html` (subject lines are in each file's header comment)
- [ ] Send yourself a password reset from `/esqueci-password` and check it arrives from `noreply@alinho.pt`, not from Supabase
- [ ] **Only then** turn on Authentication → Providers → Email → "Confirm email". With it on, signup shows a "confirma o teu email" screen instead of logging straight in (`src/pages/Login.jsx`) — that code has to be on `main` first, or new signups hit an "email not confirmed" error

Without custom SMTP, Supabase's shared mailer allows only a few emails per hour across the whole project — fine for the odd password reset, not for confirming every signup.

**3. Transactional emails** (club invites today) go through the `send-email` Edge Function, which calls Resend's HTTP API:

- [ ] Run `supabase/migration_organization_invite_email.sql` in the SQL Editor
- [ ] Supabase → Edge Functions → Secrets: `RESEND_API_KEY` (required), `EMAIL_REPLY_TO=alinhopt@gmail.com`. `EMAIL_FROM` and `APP_URL` default to `alinho <noreply@alinho.pt>` and `https://alinho.pt`
- [ ] Deploy `supabase/functions/send-email` the same way as the other functions, **with** JWT verification on (the default — unlike `game-ics`)

Until all three are done the app behaves exactly as before: the invite still lands in the person's notification bell, and the failed email call is only a `console.error`.

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
- **An auth email (password reset, signup confirmation) doesn't arrive**: check spam; then Resend → Emails shows whether it was sent, bounced or never reached Resend at all. Never reached = Supabase's SMTP settings or rate limit (Authentication → Rate Limits), see "Email (SMTP)" above.
- **A club invite email doesn't arrive**: by design only one goes out per invite, never to test/WhatsApp-guest accounts. Otherwise check the `send-email` function logs in Supabase — they carry the skip reason or the Resend error.
- **Google sign-in falls back to the wrong domain**: see the domain note above — check the Redirect URLs allowlist.
- **A migration doesn't seem to have taken effect**: it probably hasn't been run yet — see "Database changes" above.
