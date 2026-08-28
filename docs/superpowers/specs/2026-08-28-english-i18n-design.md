# English translation (i18n) — design spec

Trello: [#71 "Versão Inglês"](https://trello.com/c/o7PhIDdS) — many players at mixs aren't Portuguese; add an English UI, toggled from the header and persisted as a user setting.

## Decisions (confirmed with Renato, 2026-08-28)

- **Persistence**: `profiles.language` column (`'pt' | 'en'`), synced across devices — not device-local.
- **Scope**: full app, every page — not just player-facing screens.
- **WhatsApp bot**: included. Bot messages (help text, in/out confirmations, reminders) also respect the player's `profiles.language`.
- **Default**: always `'pt'` for every account, new or existing. No browser-locale auto-detection — matches the "Portuguese-first" product principle in `CLAUDE.md`. The player must explicitly switch.

## Data model

```sql
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'pt'
  CHECK (language IN ('pt', 'en'));
```

No RPC needed — `language` is an ordinary user-editable setting (unlike `rating`, which is column-grant-protected because it must never be client-writable). `AuthContext.jsx`'s existing `updateProfile(updates)` already does a plain `supabase.from('profiles').update(updates)` and refreshes local state, so `updateProfile({ language: 'en' })` is sufficient. New migration file: `supabase/migration_add_profile_language.sql` — like every other migration in this repo, it must be run manually in Supabase → SQL Editor; it does not apply itself on push.

## Web app architecture

**Library**: `react-i18next` + `i18next` (new deps). Resources are bundled statically at build time (small, fixed set of two languages — no lazy HTTP backend needed, avoids an extra network round-trip and loading-state complexity).

**File layout**:
```
src/locales/
  pt.json
  en.json
```
Flat JSON, keys namespaced by page/component to avoid collisions, e.g.:
```json
{ "comunidade.search_placeholder": "Procurar jogador ou clube...",
  "comunidade.player_count": "{{count}} jogador na comunidade",
  "comunidade.player_count_plural": "{{count}} jogadores na comunidade" }
```
`react-i18next`'s built-in pluralization (`_plural` suffix / `count` interpolation) replaces the current `x === 1 ? 'singular' : 'plural'` ternaries scattered through the pages — same output, less code at each call site.

**Wiring**:
- `src/lib/i18n.js` — `i18next.use(initReactI18next).init({ resources: { pt, en }, lng: 'pt', fallbackLng: 'pt', interpolation: { escapeValue: false } })`.
- Imported once in `src/main.jsx` before `<App />` renders.
- `AuthContext`: when `profile` loads, call `i18n.changeLanguage(profile.language)` so the UI reflects the account's stored preference as soon as it's known (falls back to `'pt'` until then, matching the DB default — no flash of wrong language since `'pt'` is also i18next's initial `lng`).
- Every page/component reads strings via `const { t } = useTranslation()` and `t('namespace.key')`, replacing hardcoded Portuguese literals in JSX.

**Header toggle** (`src/components/Layout.jsx`, in the existing icon row next to the notification bell / help / sign-out buttons, around line 358): a small "PT"/"EN" pill button. On click: `i18n.changeLanguage(next)` (instant UI flip) then `updateProfile({ language: next })` (persist in background, matching the fire-and-forget pattern `toggleFavoriteOrganization` already uses elsewhere in this file).

**Dates**: several pages call `date.toLocaleDateString('pt-PT', {...})` directly (`PlayerDetails.jsx`, `GameDetails.jsx`, others). These get centralized into one helper, `src/lib/formatDate.js`, that takes the current i18next language and maps `'pt' → 'pt-PT'`, `'en' → 'en-GB'` (GB, not US — matches the pt-PT day/month ordering players are used to, just translated). Call sites switch from the hardcoded locale string to this helper. This is the one deliberate refactor bundled into the feature — the alternative (leaving dates hardcoded to `pt-PT` while everything else switches to English) would be a half-translated page, defeating the point.

**Scope of translated files**: all 17 files in `src/pages/` and the 5 in `src/components/` (`Layout.jsx`, `PlayerSearch.jsx`, `ShareCard.jsx`, `SplashScreen.jsx`, `ui.jsx`) — every literal Portuguese string a player or admin can see. `alert()`/`confirm()` dialog text is in scope too (it's user-facing copy, same as JSX).

## WhatsApp bot

The bot (`whatsapp-bot/`) is a **separate Docker deployment** — its `Dockerfile` build context is scoped to the `whatsapp-bot/` directory, so it cannot import `../src/locales/*.json` from the web app at build time. Rather than restructure the deploy (out of scope for this feature), the bot gets its **own** small locale dictionary:

```
whatsapp-bot/src/locales.js   // { pt: {...}, en: {...} }, plain JS object, no new dependency
```

A `t(key, lang, vars)` helper (simple `{{var}}` interpolation, no library — the bot's message surface is much smaller than the web app's: `HELP_TEXT`/`HELP_FOOTER` in `messages.js`, plus in/out/waitlist confirmations and reminders in `commands.js`/`reminders.js`/`roster.js`). This is a deliberate divergence from the original "one shared dictionary" pitch in the approach discussion — the Docker build-context constraint makes a literal shared file impractical without touching deployment infra, and the bot's and web app's copy don't overlap 1:1 anyway (WhatsApp formatting like `*bold*` vs JSX).

**Language lookup**: every bot flow that composes a message for a specific player already fetches their `profiles` row (`phone.js`, `roster.js`, `reminders.js`, `sync.js`, `autostart.js` all do `.from('profiles')` today) — each of those `.select(...)` calls adds `language` to its column list, and message composition picks `t(key, profile.language ?? 'pt', vars)`.

## Rollout

Per the (recently corrected) Trello/Slack workflow rule in `CLAUDE.md`: this card moves to **Dev Done** once the code change is complete locally, and only to **Testing - QA** once it's actually pushed to `main` (web) — the bot additionally needs its own manual EC2 redeploy per `DEPLOYMENT.md` before its half is live, independent of the web push.

The `migration_add_profile_language.sql` file must be run manually in Supabase SQL Editor before `language` exists as a column — same caveat as every other migration in this repo.

## Testing

No existing test suite for these pages (confirmed earlier this session — no `*.test.*` files reference any `src/pages/*`). Verification is manual:
- `npm run build` succeeds (catches missing-import/syntax errors across all touched files).
- Spot-check the toggle on a handful of representative pages (Home, Comunidade, a mix's GameDetails) in both languages.
- Spot-check date formatting in both languages on a page that shows one (PlayerDetails match history).
- Bot: cannot be live-tested without a WhatsApp session; verify by reading the composed message output for both `lang` values in each touched function.

## Out of scope

- Auto-detecting browser locale (explicitly rejected — always defaults `'pt'`).
- Any language beyond pt/en.
- Translating admin-only Supabase Studio / SQL Editor artifacts, commit messages, or this spec itself.
