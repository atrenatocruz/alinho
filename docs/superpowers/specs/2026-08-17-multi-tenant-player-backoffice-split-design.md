# Multi-tenant redesign (Phase 2: player/backoffice split, global discovery)

## Context

Phase 1 ([2026-07-16-multi-tenant-design.md](2026-07-16-multi-tenant-design.md)) shipped the data model: `organizations`, `memberships`, org-scoped RLS, and a `?org=<slug>` query-param invite link. It works, but two things turned out not to be intuitive in practice:

- A player who belongs to more than one club can't see mixs from all of them at once — the app only ever has a single "current organization" (`AuthContext.currentOrganizationId`), so switching clubs means re-entering a slug.
- There's no self-service way to discover a club — every join is either the single-club auto-join fallback or an out-of-band invite link.

This phase does three things together, because they share the same root cause (a club-scoped mental model bleeding into the player's cross-club experience):

1. **Split player app from club backoffice.** Management (mixs, members, settings) moves to `/gerir`, a distinctly-laid-out backoffice section within the same app. The player-facing app drops `/admin` entirely.
2. **Player Home aggregates across every club a player belongs to** instead of showing one club at a time.
3. **Optional public discovery.** A club can opt into being `is_global`: listed in a new "Clubes & Grupos" directory, counted in a combined global ranking/community, joinable via "Follow" (instantly if `open_join`, otherwise via an admin-approved request). Non-global clubs stay exactly as private and invite-only as they are today.

## Schema changes

### `organizations` — two new columns
```sql
ALTER TABLE organizations ADD COLUMN is_global BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE organizations ADD COLUMN open_join BOOLEAN NOT NULL DEFAULT FALSE;
```
`open_join` is only meaningful when `is_global = TRUE`:
- `is_global = false` — not listed anywhere; entry only via the existing `?org=<slug>` invite link. `open_join` is ignored.
- `is_global = true, open_join = true` — listed in the directory; "Follow" creates a `membership` immediately.
- `is_global = true, open_join = false` — listed in the directory; "Follow" creates a pending `membership_requests` row instead.

### `membership_requests` (new)
```sql
CREATE TABLE membership_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES profiles(id),
  UNIQUE (user_id, organization_id) WHERE (status = 'pending')
);
```
The partial unique index (only over `status = 'pending'`) allows a rejected request to be re-submitted later, while still preventing duplicate pending requests from the same "Follow" click landing twice.

## RLS changes

**`profiles`, `player_stats`, `mix_player_stats` SELECT** — widen the existing "shares an org with you" policy with an OR clause for global orgs:
```sql
USING (
  id = auth.uid() OR
  EXISTS (SELECT 1 FROM memberships m1 JOIN memberships m2 ON m1.organization_id = m2.organization_id
          WHERE m1.user_id = auth.uid() AND m2.user_id = profiles.id) OR
  EXISTS (SELECT 1 FROM memberships m JOIN organizations o ON o.id = m.organization_id
          WHERE m.user_id = profiles.id AND o.is_global = TRUE)
)
```
This is what makes "Comunidade Global" and "Ranking Global" show people you don't share a club with.

**`membership_requests`** — a user sees/creates their own rows; org admins see and resolve rows for their org (same "join memberships WHERE is_admin" shape used elsewhere).

## RPCs

- `follow_organization(p_organization_id UUID)` — single entrypoint for the "Follow" button, so the frontend never needs to branch on `open_join` itself:
  - rejects if the target org isn't `is_global`
  - `open_join = true` → inserts into `memberships`, returns `'joined'`
  - `open_join = false` → inserts into `membership_requests` (no-op if a `pending` row already exists), returns `'pending'`
- `approve_membership_request(p_request_id UUID)` / `reject_membership_request(p_request_id UUID)` — guarded by "caller is admin of the request's organization"; approve creates the `membership` row and marks the request `approved`.
- `leave_organization(p_organization_id UUID)` — self-service unfollow/leave, blocked if the caller is that org's last admin (an orphaned, unmanageable club is worse than a blocked click).

## Routing architecture

**Revision (2026-08-17):** the original design put the backoffice on `<slug>.alinho.pt`, a separate origin. Dropped in favor of a same-origin, path-based split — a PWA manifest is scoped per origin, so two origins means two separately-installed PWAs (two home-screen icons, two service workers), and it's exactly admins-who-are-also-players who'd feel that fragmentation most. Keeping everything on one origin sidesteps that entirely, and as a side effect removes the need for cross-origin session sharing altogether — `localStorage` already works, nothing to change there.

**Single app, new top-level route:**
```
/gerir            -> list of orgs the caller administers; 1 result redirects straight to /gerir/:slug
/gerir/:slug      -> backoffice for that org (games / members / settings — see below)
```
Guarded the same way `/admin` is guarded today (`Guard require="admin"` in `App.jsx`), except the check becomes "is admin of *this* `:slug`" rather than a single global `isAdmin` flag — someone can be admin of one club and merely a player in another, so the guard needs the specific org, not just "is admin of something." A backoffice-specific layout replaces `Layout` here (no player bottom-nav; a header identifying which club is being managed instead).

**No new infrastructure.** No wildcard domain, no DNS/TLS changes, no dev-only hostname workaround — `/gerir/:slug` behaves identically in local dev and production, like every other route in the app.

**Invite links:** the player-facing invite link stays `alinho.pt/login?org=<slug>` (unchanged). The "Gerir" link/button shown to admins from the Clubes & Grupos directory now points at `/gerir/<slug>` — an in-app navigation, not a domain switch, so it opens inside the same installed PWA.

## Player experience changes

**Home** — query changes from `.eq('organization_id', currentOrganizationId)` to `.in('organization_id', <all membership org ids>)`. Each `MixCard` gains a small club name/logo tag since mixs from different clubs now share one list. Empty state changes from "paste a club slug" to "you don't follow any club yet", pointing at the new directory. The `?org=slug` direct-invite path is untouched — still the only way into a non-global club.

**Rankings / Comunidade** — each gains a second-level tab, reusing the tab pattern already on Home:
- "O meu clube" — today's per-club behavior (picker if 2+ memberships).
- "Global" — combines every `is_global = true` organization, regardless of whether the viewer follows it.

**Clubes & Grupos** (replaces the `Clubes.jsx` "Em breve" placeholder entirely — same nav slot, new purpose): lists every `is_global = true` organization with name, logo, member count, and a context-dependent action button (Follow / Pedido enviado / A seguir·Deixar de seguir). Non-global clubs never appear here.

## Backoffice (replaces `/admin`)

Today's three `/admin` tabs (`games`, `members`, `settings`) move to `/gerir/:slug` unchanged in logic, plus:
- **Membros** gains a "Pedidos" view listing pending `membership_requests` for that org (only populated when `is_global=true, open_join=false`), with accept/reject.
- **Definições** gains `is_global` and `open_join` toggles (`open_join` only editable/relevant while `is_global` is on).

`/admin` is removed; any bookmark to it redirects to `/gerir`. An admin of multiple clubs switches between them by navigating back to `/gerir` (the picker) or via "Gerir" links from the directory — an in-app navigation, same as any other route change.

## Error handling & edge cases

- `:slug` in `/gerir/:slug` doesn't match any organization — a clear "este clube não existe" page with a link back to `/gerir`, not a blank screen.
- Authenticated but not an admin of *this* club's backoffice (e.g. typed/bookmarked someone else's `/gerir/:slug`) — distinct "sem acesso" state, not a 404 (they may well be an admin of a *different* club).
- Duplicate follow/join-request clicks — idempotent via the partial unique index; `follow_organization` returns success rather than erroring on an existing pending request.
- Rejected request re-submitted later — allowed (partial unique index only covers `pending`), preserving rejection history.
- Last admin of a club tries to leave or self-demote — blocked by `leave_organization`/the admin-demotion RPC.
- Club flips `is_global` from true to false — its pending `membership_requests` should be invalidated/cleared (no longer meaningful); existing memberships are untouched, they just stop counting toward the global views.
- Old `?org=slug` link to a club that has since become `is_global=true, open_join=true` — works unchanged, functionally equivalent to a Follow.

## Testing

No automated test suite exists in this project (frontend or SQL migrations) — validation has always been manual, migration by migration. This phase follows the same convention:

**SQL/RLS (manual, via Supabase SQL editor):**
- Three test orgs: `is_global=false`; `is_global=true, open_join=true`; `is_global=true, open_join=false`.
- A user with no membership anywhere cannot read `profiles`/`player_stats` from the non-global org, but can from both global ones.
- `follow_organization` on the open org creates a membership immediately; on the restricted org it creates a pending request and *no* membership.
- `approve_membership_request` fails when called by an admin of a *different* org.
- Calling `follow_organization` twice in a row doesn't error or duplicate rows.

**Frontend (manual, in-browser):**
- A player in 2+ clubs sees Home mixs from both, tagged by club; Rankings/Comunidade "O meu clube" prompts a club choice, "Global" shows only `is_global` clubs.
- Full Follow flow on an open club (immediate) and a restricted club (request → backoffice approval → shows up on Home).
- Admin of exactly one club: `/gerir` redirects straight to `/gerir/:slug`. Admin of 2+: `/gerir` shows a picker.
- Only one PWA install/icon end to end — install the app as a player, become admin of a club, confirm no second install prompt or icon appears for `/gerir`.
- An old `?org=slug` link still works for a non-global club.
- An admin of only one club navigating to a different club's `/gerir/:slug` (typed or bookmarked) sees "sem acesso", not a generic error.

## Open questions

None outstanding — all decisions in this document were confirmed during brainstorming (2026-08-17), including one revision made mid-review: the backoffice moved from a `<slug>.alinho.pt` subdomain to a same-origin `/gerir` route after the PWA-fragmentation trade-off surfaced (see Routing architecture). The join-request-with-approval flow for restricted clubs was chosen explicitly over the alternatives considered and stands as designed.
