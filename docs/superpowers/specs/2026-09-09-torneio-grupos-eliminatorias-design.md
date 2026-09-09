# Torneio — Grupos + Eliminatórias — Design Spec

## Goal

Alinho is about to run a real, paid, 3-day corporate padel tournament: ~300
people, mixed fixed duplas + solos needing pairing, split into several
level-based categories, on only 1-4 courts, run by a dedicated tournament
director entering results on an admin screen — not the players themselves.
This is no longer the free-pilot context the rest of the app was built
under (see `PRODUCT.md`); it's the first real "stage 1" production use, with
a hard 30-day deadline.

This spec covers the one piece that's genuinely missing to make that event
possible: **a group-stage + knockout tournament engine**, plus the supporting
bulk-onboarding and multi-day pacing changes. It does **not** cover the
broader "new mix formats" backlog (Americano, Mexicano, King/Queen of the
Court, a custom-format builder, or set/pro-set scoring) — see "Explicitly out
of scope" below. That backlog was sourced from a proposal Francisco prepared
(`Alinho_Modelos_de_Jogo_Mixes_Proposta_Renato.docx`) and remains a separate,
later effort; this spec only pulls the one format (his "GROUPS_BRACKET"
engine) that's on the critical path for the tournament.

## Why this, and not the two alternatives considered

Three approaches were on the table:

- **A — Extend the existing engine** (chosen): add pool/group splitting and
  cross-pool knockout seeding to `mixLogic.js`, reusing `formDuplas`,
  `standings`, `eliminationPhases`, `firstElimMatches` as-is. Reuses ~80% of
  already-shipped, already-used code paths.
- **B — A separate "Torneio" module**: new tables for tournaments,
  categories, pools, bracket matches — the cleaner long-term shape the
  Francisco proposal's EVENTO/ENGINE split points toward. Rejected *for now*:
  new schema means new RLS surface to design and review from scratch (see
  `SECURITY_REVIEW.md` on the cost of getting that wrong), and there isn't
  time to do that properly in 30 days.
- **C — A mostly-manual admin tool**: staff draws groups on paper/a
  spreadsheet, the app only records scores after the fact. Faster to build,
  but more manual coordination during a live 3-day event and nothing
  reusable afterward.

**Why A over B, given B is the "more correct" long-term shape:** the
deadline is real and external (a paying corporate client, a fixed date).
Reusing proven, already-shipped code (the round-robin circle method, the
elimination-phase builder, `formDuplas`'s mixed-fixed/solo pairing) is lower
risk than reviewing a new schema and a new set of RLS policies from scratch.
If a genuinely different lifecycle shows up later (e.g. a league spanning
many weeks), that's the moment to revisit B — not speculatively now.

**Why not fold in Francisco's other formats (Americano, Mexicano, etc.) or
the custom-builder wizard while we're in here:** none of them are required
for this tournament, and the wizard in particular is real classifier-shaped
complexity for a "handful of manually-onboarded clubs" product. Scope
creep here directly threatens the 30-day deadline for no benefit to this
event.

**Why scoring stays simple (single score, no sets) for now:** unresolved
on the event side as of this writing. Deliberately keeping the group/bracket
engine decoupled from scoring (matching Francisco's own layering: ENGINE ≠
SCORING) means this can change later without touching anything in this spec.

## Data model

- `games.format` gets a new allowed value: `'grupos_eliminatorias'`,
  alongside the existing `'sobe_desce'` / `'todos_contra_todos'`. Migration
  updates the `CHECK` constraint.
- `games.pool_size` — new nullable `INTEGER` column. Only meaningful for
  `format = 'grupos_eliminatorias'`; the admin sets it when creating the
  category-mix (e.g. `4`).
- `teams.pool_number` — new nullable `INTEGER` column. Which pool a dupla
  belongs to during the group phase; `NULL` once the format reaches the
  knockout phase (a team's pool no longer matters after seeding).
- No changes to `participants` or `matches` — `matches.phase` already
  supports `'group' | 'quarter' | 'semi' | 'final'`, which is exactly what's
  needed; a match's `phase = 'group'` row is disambiguated by its two teams'
  `pool_number`, not by a new column on `matches` itself.
- No changes to the multi-tenant model — the event gets one new
  `organizations` row (created the same way any club is created today), and
  each category is just another `games` row inside it.

## Engine additions (`src/lib/mixLogic.js`)

Kept in the file's existing style: small, pure, independently testable
functions — no generic "engine module" abstraction, no plugin registry.
That abstraction may be worth building once there are enough concrete
engines to see the real shared shape; two formats isn't that point yet.

- **`splitIntoPools(teams, poolSize)`** — snake-seeds teams into pools by
  `seed_ranking` descending (pool 1, 2, ..., N, N, ..., 2, 1, repeating),
  the same balancing principle `seedCourts` already uses for court 1. A
  remainder pool smaller than `poolSize` is allowed; there's no
  attempt to force perfectly even pools at the cost of balance.
- **`roundRobinRound`** — unchanged signature, called once per pool with
  that pool's own team-id list. No new multi-pool scheduling logic: with
  only 1-4 courts, the admin decides when to draw pool A's next round vs.
  pool B's, the same "admin draws each round explicitly" model the function
  already documents.
- **`standings`** — extended to accept an optional pool filter (teams +
  matches scoped to one pool), so group-phase standings can be computed
  per pool instead of across the whole category.
- **`seedKnockoutFromPools(poolStandings, advancePerPool)`** (new) — takes
  each pool's final standings, takes the top `advancePerPool` teams from
  each, and produces the ordered seed list for the knockout phase using
  standard cross-pool pairing (pool A's 1st vs. pool B's 2nd, etc.),
  avoiding a same-pool rematch in the first knockout round wherever the
  bracket size allows it. Its output feeds directly into the *existing*
  `eliminationPhases` / `firstElimMatches` / `nextElimMatches` — those
  don't change at all. `advancePerPool` defaults to `2` (standard "top-2 per
  group" tournament format) and is fixed, not admin-configurable — nothing
  in this event's requirements calls for anything else, and it's a trivial
  parameter to expose later if a future tournament needs it.

## Bulk participant onboarding

`supabase/functions/admin-create-test-user/index.ts` already does 90% of
what's needed — a real, never-logged-in Supabase Auth user + profile +
`is_guest` membership, created server-side because `profiles.id` is a hard
FK to `auth.users` and only the service-role key can call
`auth.admin.createUser`. It just hardcodes the name to `"Teste N"` and
creates exactly one person per call.

New edge function, **`admin-bulk-create-participants`**, parameterizing
that same pattern:
- Input: an array of `{ name, category }` (category maps to which
  category's `games` row the person gets added to as a participant).
- Same admin/org-membership check as `admin-create-test-user`.
- Loops server-side in one invocation (not 300 browser round-trips),
  creating each person as `is_guest: true` (not `is_test` — these are real
  event participants, not throwaway fixtures).
- Returns created `user_id`s plus any per-row failures, so the admin UI can
  show a summary and retry just the failed rows.
- **Risk to flag, not fully resolved here:** Supabase Auth's
  `admin.createUser` may rate-limit at ~300 calls in a tight loop. The
  function should pace itself (small delay between creates) and be safe to
  re-run on a partial failure without duplicating already-created people —
  the implementation plan needs to work out the exact pacing/idempotency
  approach.

Paired with a simple admin-only paste/CSV UI (new, small) that calls this
function and shows the created/failed summary.

## Multi-day round pacing

`totalRounds()` (`Math.max(1, Math.floor(court_time_minutes /
game_time_minutes))`) assumes a single continuous session and doesn't apply
to this format — a 3-day event has no single "session length" to divide by.
For `format = 'grupos_eliminatorias'`, round availability isn't
time-gated at all: the admin draws the next round (per pool, or the next
knockout round) whenever they're ready, across however many of the 3 days
it takes.

## Organization + category setup

One new `organizations` row for the event (created the same way any club is
today — no new mechanism needed). Each level-based category becomes its own
`games` row inside that organization, `format = 'grupos_eliminatorias'`,
its own `pool_size`. Categories run sequentially or interleaved across the
3 days at the admin's discretion, constrained by the 1-4 available courts —
no automatic cross-category scheduler is being built; that's a staff
decision, not something the app needs to solve.

## Explicitly out of scope

- Americano, Mexicano, King/Queen of the Court engines
- The "Criar formato" natural-language wizard / custom builder
- Set-based / pro-set scoring (stays a single `score_a`/`score_b` int per
  match, unless the event side confirms it's actually required — see "Why
  scoring stays simple" above)
- Any generic pluggable "engine module" abstraction
- Automatic multi-court, multi-category scheduling optimization

## Open questions for the team

- Does the event actually need set/pro-set scoring? (Unresolved as of this
  writing — assumed "no" for this spec; low cost to revisit since scoring is
  decoupled from the engine.)
- Default/expected `pool_size` — spec assumes the admin sets it per
  category at mix-creation time; no auto-suggestion logic is planned.
- Exact rate-limit/backoff behavior for `admin-bulk-create-participants` at
  ~300 creates — needs to be worked out in the implementation plan, not
  here.
