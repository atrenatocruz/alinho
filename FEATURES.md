# Features

What alinho actually does today, and what's explicitly not built yet. Kept in sync with the app — when you ship something, update this file in the same PR rather than letting it drift (see the history of this file before 2026-08-19 for what happens otherwise: it went unmaintained for a month and described a different, single-tenant app).

**It drifted again.** Between 2026-08-25 and 2026-09-08 roughly fifteen shipped features never made it into this file, while several people and agents worked from it as the reference for "what exists". Caught and backfilled on 2026-09-08. If you are reading this because you are about to skip the update: that is exactly how both gaps happened.

## Authentication & identity

- Passwordless auth: email OTP or Google OAuth. No stored passwords.
- One profile per person, shared across every club they belong to (`profiles`) — level, guest status, and admin rights are per-club (`memberships`), not global.
- A person can belong to more than one club/organization at once.
- Phone numbers are never stored in plaintext — only an HMAC-SHA256 hash, so the WhatsApp bot can match a phone number to a player without the number itself ever reaching Supabase.

## Privacy & consent

- **Cookie consent banner** with a single accept/decline choice — no per-category toggles, because there is currently no analytics, ads, or tracking script in the codebase to categorize.
- **Privacy Policy** (`/privacidade`) and **Terms of Service** (`/termos`) pages, linked from the footer and from signup.
- **Consent gate**: brand-new accounts must accept the Privacy Policy and Terms once before reaching the app, covering both email and Google signup (Google has no form step to put a checkbox on). Gated on `profiles.consent_accepted_at IS NULL`, the same pattern as the rating-onboarding screen. Pre-existing pilot accounts are grandfathered by a backfill.
- An append-only `consents` table is the actual audit record — who consented, to which policy version, when. Never updated or deleted once written; the denormalized column on `profiles` is only the cheap per-route check.
- Full spec: `docs/superpowers/specs/2026-08-31-cookie-consent-privacy-policy-design.md`. The policy copy is an engineering draft grounded in what the app does, **not certified legal advice** — it still needs review before being treated as binding.

## Multi-tenant clubs

- Clubs ("organizations") are isolated via Supabase RLS, keyed off `memberships.organization_id`.
- Club admins manage their club from **Gerir** (`/gerir` → `/gerir/:slug`): games, members, and settings, tab by tab.
- **Platform admins** (`profiles.is_platform_admin`, granted manually via SQL) can create new clubs from Gerir, appointing anyone as that club's first admin, and can open and manage any club — access is granted on demand via a real admin membership, not an invisible bypass.
- Clubs can opt in to a public directory (**Clubes & Grupos**, `/clubes`) — `is_global` clubs are discoverable and searchable by anyone; `open_join` controls whether joining is instant or goes through an admin-approved request queue.
- **Organization invites**: an admin can search for a player and invite them directly, or copy an invite link, from the Membros tab. Pending invites show in the notifications bell and in a **Convites** tab on the player's profile, where they accept or decline.
- **Groups inside a club**: a club can hold sub-groups, managed inline from GerirClube (list, join requests, approval). Groups are scoped to their parent club — admin reach, tiered visibility, approval-only join.
- **Self-serve groups**: any authenticated player can create their own group without admin involvement, capped (members / concurrent active mixes / courts). Marked with an explicit `self_serve` flag so it stays distinct from the older platform-admin group path. Spec: `docs/superpowers/specs/2026-08-27-self-serve-groups-design.md`.
- **Teacher profiles**: players can request to be listed as a teacher within a club, with contact and availability slots; a club admin approves or rejects. Surfaced as its own Comunidade tab.

## Game management ("Mixes")

- Create, edit, delete games: title, date/time, location, price per player, prize, number of courts, court/game duration, format (`sobe e desce` or `todos contra todos`).
- **Gender restriction** per mix: só homens / só mulheres / misto / indiferente.
- **Court availability**: a mix can show closed vs. available courts, in-app and in the WhatsApp announcement.
- Recurring mixes: a game can spawn future occurrences automatically on a schedule (daily/weekly/monthly/yearly), with a configurable "launch N days before, at HH:MM" that controls when the next occurrence becomes visible/joinable. Occurrences are pre-created as `pending` and flip to `open` at their launch time. A series can be **paused and resumed** without losing its configuration, and an occurrence will not open while the previous one is still active.
- **Series grouping**: occurrences of one recurring series collapse into a single card on the Jogos list and a single row in the admin game list, rather than flooding both with near-identical entries. A **Recorrente** badge marks them.
- **Optional auto-start**: a mix can start itself at a set time, forming the duplas and announcing them on WhatsApp with nobody present. The admin form shows the computed opening time under the auto-start hours field. Note this path lives in the bot (`whatsapp-bot/src/autostart.js`) and duplicates part of the app's own start logic.
- A game closes automatically once enough players confirm for its court count (4 per court).
- Suplentes (waitlist): once a game is full, further joins go to a waitlist and are promoted automatically as spots free up.
- **Histórico de entradas e saídas (IN/OUT)**: every join, leave, waitlist entry, automatic suplente promotion and partner change on a mix is recorded in an append-only `participant_events` log, written by a database trigger on `participants` so it captures all three writers — the web app, the WhatsApp bot, and Postgres' own promotion trigger. Visible to club admins on the mix page, with full player names, the source (App / WhatsApp / automatic), and who acted when an admin removed somebody else. Exists because leaving is a hard DELETE everywhere, so before this a player who vanished from a roster left no trace at all.

## Player participation

- Join a game solo (auto-partner matching) or with a specific partner. Solo pairing is closest-points-first, with a soft preference for side-compatible partners and for avoiding a repeat of last mix's pairing.
- Leave a game before it closes.
- Round-robin match generation and score entry once a game is under way; a round timer helps admins keep courts moving.
- **Score correction**: an already-saved match score can be corrected mid-mix rather than being final on first entry.
- **Scorekeeper delegation**: an admin can delegate score entry for one specific mix to one or more players, so they don't have to walk court to court collecting results. Scoped to that game and only while it is `in_progress` — no manual revocation needed.
- Finished mixes show their results in real tabs: **Estatísticas / Duplas / Rondas**.
- Duplas (pair) cards are shareable — collapse/expand and share as an image.

## Private matches

- 2x2 games outside any club, created and joined via a shareable link (`/jogos-privados`), gated behind a feature flag any club admin can toggle for the whole app. Changing global feature flags requires platform admin.
- **Count toward the global Elo rating** (same math as mixes via the shared `apply_elo_pairing` core, no merit bonus) — the per-game delta shows in the match history. Results require **cross-team confirmation**: any player submits the score, a player from the opposing team confirms, and that confirmation closes the game and applies the points. Games confirmed before this shipped keep their old flat points only.
- Also contributes flat points to a separate "private" track, combined with club points into a global total.

## Rankings & stats

- **Elo rating (Ranking v1)**: every player has one global rating (`profiles.rating`), recalculated inside `finalize_mix` after each mix from actual match results — divisor 400, individual FIDE-style K (40/30/20), pair rating = average, partner redistribution capped at 35/65, merit bonus (1% of own rating to the winning pair, +0.5% for a perfect night) paid proportionally by the other participants. Public bands M1–M6/F1–F6 (`< 700` Iniciante, 700–999 band 6, then 200-point bands) derived from the rating. Full spec: `docs/superpowers/specs/2026-08-25-elo-ranking-design.md`.
- **First-registration self-assessment**: brand-new accounts pick Iniciado (700) / Regular (900) / Avançado (1100) on a one-time blocking screen before entering the app; pre-existing accounts never see it (seeded at 900 via the backfill migration, history replayed on top).
- Self-declared level badges have been **replaced by Elo-derived group levels** — the rating is the single source of level, shown in the header, the global ranking, the player profile, and alongside points throughout the mix flow.
- The **Geral** (global) and **Por Clube** ranking tabs order by Elo rating; `total_points` (attendance-flavored) still accumulates and drives the Mensal tab. The global tab only counts `is_global` clubs' points, so a private club's numbers don't leak into a ranking non-members can see.
- The **Clubes & Grupos** ranking shows and orders by a club's **average Elo level**, not its hidden points total.
- Per-mix leaderboard orders by that mix's Elo swing (`rating_delta`), falling back to points/wins for mixes finalized before the Elo rollout.
- **Kudos ("👍 da noite")**: after a mix ends, each participant can give one thumbs-up to a teammate of choice (48h window, all guards in Postgres — one vote per mix, no self-votes, participants only). Each kudos received = +1 XP (symbolic; the visible recognition is the point). Podium shows on the finished mix, and received-kudos totals show on profiles, Strava-style.
- **Trophy shelf**: 47 achievements (pt-PT padel-flavored names) across play, wins, friendlies, Elo/XP progression, kudos and tenure, with 4 rarity tiers (comum/raro/épico/lendário) and a live "% of players have this" stat (PSN-style). Awarding is a pure function of existing state (`check_and_award_trophies`, idempotent, hooked into finalize/confirm/kudos RPCs; history backfilled). Shelf on own profile (4 most recent + full grid with locked criteria visible) and earned-only grid on public profiles. `evento` category exists for sponsored trophies, hand-awarded via platform-admin RPC.
- Per-player stats: matches played/won, points, mix wins — configurable points-per-action per club (`organizations.points_rules`).
- **XP / assiduidade**: global per-player XP (`profiles.xp` + `xp_events` ledger) rewarding dedication — mix participation 20, 5 per game, mix win 30, friendly 10 (+5 win) — written only inside `finalize_mix`/`confirm_private_match` with idempotent constraints. 10 shield levels from Iniciado (50 XP) to World Class (20,000 XP ≈ 3 years at 5x/week), shown as a colored ring on avatars (glowing when the player played in the last 7 days), an XP bar on the profile, and an "Assiduidade" leaderboard tab (global or per-club via the ledger). Historical games were backfilled — XP is additive, unlike Elo.
- Unified player profile page (`/jogador/:id`) — one identity across every club a person plays in, showing preferred playing side. A Ranking Global card in Profile jumps to the player's own position.

## WhatsApp bot

- Separate always-on process (`whatsapp-bot/`) posts the mix roster into a WhatsApp group and syncs "In"/"Out"/"Fora" replies with `participants`, so players never have to open the app to book or release a spot.
- One bot process per club (its own WhatsApp number/session, scoped to one `organization_id`).
- Roster shows **full player names and Elo band**, keeps signup order, and reposts immediately on the first In. Incoming group messages are processed in a **FIFO queue** so simultaneous replies can't race.
- Mix announcements carry a **calendar (.ics) link**.
- An **unregistered WhatsApp number can join a mix as a guest**, without an account. Guest profiles get the same 900-rating baseline as everyone else.
- Bot messages respect the player's `profiles.language`.

## UI/UX

- **Bilingual: Portuguese (pt-PT) and English**, via `react-i18next`. Portuguese is the default and the fallback. A signed-in player's choice lives on `profiles.language` and is set from Profile → personal info; a pre-auth visitor can switch from Landing/Login and the choice is stashed in `localStorage` (cleared on sign-out, so a shared device doesn't leak it between accounts). Dates and times are locale-aware (`en` maps to en-GB, not en-US).
- Mobile-first throughout.
- PWA: installable on iOS/Android, offline page caching, app manifest.
- Design system: near-black + lime accent, Outfit/Geist typography — see `DESIGN.md`.
- Tapping a profile photo opens it full-screen.
- `/mix-offline` is a no-backend "Plan B" tool, reached by tapping 5 times on the load-error screen — deliberately undocumented in the UI.

## Explicitly not built

- **No self-serve "create your own club" flow.** Club creation is platform-admin-only. Note this is now narrower than it used to be: self-serve **group** creation does exist (see Multi-tenant clubs) — a group is not a club. Don't blur the two in copy.
- No payments; nothing beyond the informational price-per-player field. No monetization or pricing model exists yet.
- No push notifications, no email notifications beyond the OTP itself.
- No game formats beyond `sobe e desce` and `todos contra todos`, and both assume a **fixed dupla for the whole mix**. Rotating-partner formats (Americano / "pares partidos"), group stages, and 3rd/4th-place playoffs do not exist. See `docs/superpowers/specs/2026-09-08-game-formats-design.md` for what adding them costs and what is still undecided.

## Roadmap

Not tracked in this file — check the Trello board (see `CLAUDE.md`), or `docs/superpowers/plans/` for specs already written but not yet built.
