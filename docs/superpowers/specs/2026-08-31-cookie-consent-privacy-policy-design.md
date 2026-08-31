# Cookie Consent + Privacy Policy + Terms of Service — Design Spec

## Goal

Trello #154: alinho.pt processes personal data (name, email, birthday,
gender, avatar, a hashed phone number for the WhatsApp bot, Google OAuth
identity, club/game/ranking data) with no Privacy Policy, no Terms of
Service, and no cookie-consent mechanism — despite the signup flow already
being expected to reference both. Flagged as urgent (Francisco, Slack
28-29 Aug) because MVP1's push toward self-serve growth increases exposure
(more users signing up with no documented legal basis for processing their
data). This spec closes that gap: a cookie-consent banner, a Privacy
Policy page, a Terms of Service page, and a one-time consent gate for new
accounts with a durable, auditable consent record.

**This spec's Privacy Policy / Terms of Service copy is an engineering
draft grounded in what the app actually does — not certified legal
advice.** It must be reviewed (by Renato, or counsel) before being treated
as binding. The pages ship with real, accurate content from day one (never
lorem ipsum) so review has something concrete to react to, but "shipped"
here means "live on the code side," not "legally final."

## Key Decisions

**Why a single blocking consent gate for both signup methods, not an
inline checkbox on the email/password form (the Red Bull reference in the
ticket)?**
Google sign-up has no form step to put a checkbox on — it redirects
straight to Google and back with the `auth.users` row already created.
Only a post-auth gate covers both paths with one mechanism. The app
already has this exact pattern for a different one-time new-account
requirement (`EscolherNivel`, gated by `profiles.rating_onboarded_at IS
NULL` in `App.jsx`'s `Guard`) — this spec adds a second, analogous gate
rather than inventing a new shape.

**Why an append-only `consents` table AND a denormalized
`profiles.consent_accepted_at` column, instead of just one?**
The column is what `Guard` checks on every route (cheap, no join, mirrors
`rating_onboarded_at` exactly). The table is the actual audit record — who
consented, to which policy version, when — and is intentionally never
updated or deleted once written, so it can't be silently rewritten later.
Same split responsibility the rating-onboarding feature doesn't need
(it has no separate audit requirement) but consent does: "prove consent
was given" is the entire point of this ticket.

**Why grandfather existing pilot accounts instead of re-gating them too?**
The ticket's urgency is about forward risk — new signups during the push
to self-serve, with no documented basis. Retroactively blocking every
already-active pilot user behind a new gate for a policy that didn't exist
when they joined is a worse outcome for a problem the ticket isn't
actually about. The migration backfills `consent_accepted_at = NOW()` for
every current profile, identical in spirit to how `rating_onboarded_at`
was backfilled when the rating-onboarding gate shipped.

**Why a simple accept/decline banner, no per-category toggles?**
There is currently no analytics, ads, or tracking script anywhere in the
codebase — confirmed by search, not assumption. A categorized consent UI
would manage categories that don't exist yet. One binary choice matches
both the ticket's own framing ("aceitar/recusar não-essenciais") and this
project's simplicity principle. If real non-essential cookies are ever
added, the category UI can be built then, against actual categories
instead of imagined ones.

**Why is the banner's choice client-side only (localStorage), while
signup consent is server-side (DB)?**
The banner covers cookies that don't yet exist — there's nothing on the
server to enforce against a "declined" choice today, so persisting it
there would be state with no consumer. Signup consent is different: it's
the actual legal basis for processing the account's data, needs to
survive across devices/sessions, and needs to be provable later — that's
what the `consents` table is for.

## 1 — Data Model Changes

New migration `supabase/migration_add_privacy_consent.sql` (not live
until run by hand in Supabase → SQL Editor, per this repo's convention):

```sql
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS consent_accepted_at TIMESTAMPTZ;
COMMENT ON COLUMN profiles.consent_accepted_at IS
  'When this account accepted the Privacy Policy/Terms. NULL = new account
   that has not passed the consent gate yet. Written only by
   complete_privacy_consent().';

-- Existing pilot accounts are grandfathered — the ticket''s urgency is
-- about new signups with no documented consent, not retroactively
-- re-gating already-active users.
UPDATE profiles SET consent_accepted_at = NOW() WHERE consent_accepted_at IS NULL;

CREATE TABLE consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  policy_version TEXT NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE consents IS
  'Append-only audit log of Privacy Policy/Terms acceptance. Never updated
   or deleted — profiles.consent_accepted_at is the fast-path flag Guard
   checks; this table is the provable record.';

ALTER TABLE consents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select own consents" ON consents FOR SELECT
  USING (auth.uid() = user_id);
-- No UPDATE/DELETE policy at all — not even for the owner. Insert only
-- happens via the SECURITY DEFINER RPC below, never a direct client insert.

CREATE OR REPLACE FUNCTION complete_privacy_consent(p_policy_version TEXT)
RETURNS void AS $$
BEGIN
  -- No-op for an account that's already consented — mirrors
  -- complete_rating_onboarding's guard, so a second call (e.g. a retry
  -- after a flaky network) never creates a duplicate audit row.
  IF EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND consent_accepted_at IS NOT NULL) THEN
    RETURN;
  END IF;

  INSERT INTO consents (user_id, policy_version) VALUES (auth.uid(), p_policy_version);

  UPDATE profiles SET consent_accepted_at = NOW() WHERE id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION complete_privacy_consent(TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION complete_privacy_consent(TEXT) TO authenticated;
```

`consent_accepted_at` needs the same client-write lockdown every other
system-written `profiles` column already has (see
`migration_fix_profiles_column_grants.sql` and its established pattern) —
this migration must NOT grant client UPDATE on it; only the RPC (as
`SECURITY DEFINER`) writes it.

A `POLICY_VERSION` constant (e.g. `'2026-08-31'`) lives in the frontend
consent-gate code and is passed to the RPC. Bumping it later (a real
policy change) is a future concern — this spec just wires the plumbing so
that's possible; it does not build a version-diffing/re-consent flow, since
there's only one version to launch with.

## 2 — Cookie Consent Banner

New component `src/components/CookieConsentBanner.jsx`, mounted once at
the top of `App.jsx` (inside `Router`, outside `Guard` and `Routes` — so it
renders identically on Landing, Login, and every in-app route). Fixed
bottom bar, `z-50`, short pt/en copy + a link to `/privacidade` + two
buttons ("Aceitar" / "Recusar"). Reads/writes a single `localStorage` key
(`cookieConsent: 'accepted' | 'declined'`) wrapped in try/catch (private
browsing can throw on storage access — falls back to always showing the
banner rather than crashing). Once set, the component renders `null`.
Neither button blocks interaction with the rest of the page.

## 3 — Privacy Policy (`/privacidade`) and Terms of Service (`/termos`) Pages

Two new page components, `src/pages/PrivacyPolicy.jsx` and
`src/pages/TermsOfService.jsx`, structurally following the existing
`Instructions.jsx` pattern (unguarded public route, back-arrow header,
`max-w-4xl` prose column, `card` sections). Registered as unguarded routes
in `App.jsx` next to `/instrucoes`.

Privacy Policy content sections: what data is collected and why (account
fields, hashed phone for the WhatsApp bot, game/ranking/club data);
processors named accurately (Supabase for data + auth, Vercel for
hosting, Google for OAuth, a self-hosted WhatsApp bot on AWS EC2 using an
unofficial client library — not Meta's official Business API, which
matters for what sub-processor claims are true); no analytics/ad trackers
today (ties into the cookie banner section); data retention (kept while
the account is active); user rights (access/correction/deletion — deletion
is available on request via the contact email below, since there's no
self-serve delete feature yet — the policy won't claim one); cookies used
(only strictly-necessary session storage today); data controller: **Alinho
— alinhopt@gmail.com**; last-updated date.

Terms of Service content sections: what the service is (padel game/mix
management, multi-tenant clubs); free pilot status, no payments; user
responsibilities (accurate profile info, fair play); the WhatsApp bot as
an optional companion channel; admin/club-scoped relationship (an admin
manages their club's games/members, not other clubs'); liability
limitations appropriate to a free pilot; changes to these terms; contact:
**Alinho — alinhopt@gmail.com**; last-updated date.

## 4 — Consent Gate (new-account blocking screen)

New `src/pages/ConsentGate.jsx`, structurally a near-twin of
`EscolherNivel.jsx`: blocking full-screen card, shown by `Guard` in
`App.jsx` exactly where `rating_onboarded_at === null` is already checked
— add a sibling check `profile.consent_accepted_at === null` immediately
after it (same ordering rationale: both are one-time new-account gates,
neither should be skippable by navigating elsewhere). Content: a short
summary, links to `/privacidade` and `/termos` (opening in the same tab is
fine — this is a blocking screen, not a form to preserve), a single
"Aceito" button calling `complete_privacy_consent(POLICY_VERSION)`, then
`refreshMemberships()` (or equivalent profile refetch) the same way
`EscolherNivel` does, so `Guard` re-evaluates and lets the user through.
No decline path — declining the Privacy Policy/Terms while wanting to use
an account that necessarily stores personal data isn't a coherent app
state to design for; a user who won't accept can simply not use the app
(same posture EscolherNivel takes toward its own required choice).

Error handling mirrors `EscolherNivel`'s: RPC failure shows an inline
error message with the button re-enabled for retry, no silent failure.

## 5 — Login.jsx and Landing.jsx Updates

`Login.jsx` signup form: add a line of plain text below the submit button
linking to `/termos` and `/privacidade` ("Ao criar conta, aceitas os
Termos de Serviço e a Política de Privacidade") — informational, not a
required checkbox (the actual enforcement point is the consent gate in §4,
which every new account passes through regardless of signup method). This
keeps one enforcement mechanism instead of two.

`Landing.jsx`'s `Footer`: add links to `/privacidade` and `/termos`
alongside the existing login/instructions links.

## 6 — i18n

All new user-facing strings (banner copy + buttons, both page bodies, gate
copy + button, the two new Login/Footer links) get `pt.json` and `en.json`
entries under `cookieconsent.*`, `privacy.*`, `terms.*`, and
`consentgate.*` namespaces, following this repo's existing per-page
namespace convention.

## 7 — Rollout Notes

- Migration is written but **not live** until pasted into Supabase → SQL
  Editor by hand — flagged explicitly in the implementation, per this
  repo's standing convention (a migration file existing in the repo ≠ it
  running).
- Until the migration runs, `profiles.consent_accepted_at` doesn't exist —
  a `select('*')` simply omits the key, so `profile.consent_accepted_at`
  reads as `undefined`, not `null`. `Guard`'s `=== null` check would then
  be false for everyone, silently skipping the gate entirely (not
  crashing, but not protecting anyone either) until the column exists.
  Sequencing note for whoever runs this: **run the migration first**, then
  deploy the frontend change, so the gate is live for the first new signup
  that hits it rather than silently no-op-ing for a window.
- No backend/bot changes — `whatsapp-bot/` is unaffected by this spec.

## 8 — Out of Scope

- Self-serve account/data deletion (the policy states deletion is
  available on request instead of claiming a feature that doesn't exist).
- Cookie category toggles (nothing non-essential exists to categorize).
- Re-consent/versioning flow for a future policy change (the plumbing —
  `policy_version` on both the RPC and the audit table — supports adding
  this later without a schema change).
- Legal certification of the policy text (explicitly flagged above).
