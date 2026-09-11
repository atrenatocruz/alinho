# Instagram-Style Follow System — Design Spec

## Goal

Replace the current **mutual, symmetric friend-request system** (`friend_requests`) with a **one-directional follow system** (`follows`), Instagram-style: following a public account is instant, following a private account creates a pending request the target must accept or decline. The "friends"-tier profile-visibility setting keeps its name and its three-way `public`/`friends`/`private` shape in the database, but under the hood now means **mutual follow** (both users follow each other) instead of mutual accept. The `amigos`/`convites` tabs leave `Profile.jsx` entirely — follow requests and club invites live only in the notification bell (`Layout.jsx`), with inline accept/decline. Followers/following lists become public, viewable for any player from their profile's hero card.

## Key Decisions

**Why a single `follows` table with a `status` column, instead of two tables (an always-accepted `follows` + a separate `follow_requests`)?**
This app has shipped this exact shape twice already — `friend_requests` and `organization_invites` are both one table, one `status TEXT CHECK (... IN ('pending', 'accepted', ...))` column, no direct client `INSERT`/`UPDATE` policy (creation/acceptance always goes through a `SECURITY DEFINER` RPC), and a single "either party can `DELETE` their own row" policy covering unfollow/cancel/decline in one shot. A two-table split (mirroring the app's old, since-replaced `player_follows`, which had no pending state at all) would need accept to move a row between two tables inside a transaction, and would split "who does X follow" queries across two places depending on status. One table, one status column, reuses two RLS patterns already proven in this codebase.

**Why does `is_private` gate only the follow-approval step, and not hide profile content the way a real Instagram private account does?**
This app already has an orthogonal, independently-shipped mechanism for content visibility: `profiles.activity_visibility` / `results_visibility` / `clubs_visibility`, each independently `public`/`friends`/`private`, gated server-side through `can_view_section()`. `is_private` is scoped narrowly to "does following me require my approval" — it does not become a second, overlapping content lock. Confirmed with the human: this is intentional, not a shortcut. The two mechanisms compose the way they already did under the old friend-request system (a profile could be fully public-content and still require mutual accept to reach `friends`-tier sections) — only the definition of "friends" changes, not who else gets to see what.

**Why does `profiles.is_private` default to `false` for every existing user?**
Nobody today has ever had to approve a connection to be seen — the app's original follow system (`player_follows`, since replaced) was unrestricted, and even the current mutual `friend_requests` system, once accepted, never locks anyone in or back out. Defaulting every existing account to public preserves that status quo on ship day: follows resume being instant for everyone unless a person actively opts into `is_private = true`, mirroring how Instagram itself defaults new accounts to public.

**Why does `get_player_profile` return `follow_status` (self/none/pending/following) instead of the current 5-state `friendship_status` (which includes `pending_received`)?**
`pending_received` only made sense under a *mutual* model: a friend request could be initiated by either party, so visiting the other person's own profile might show "they asked you — accept here." Under one-directional follow, "do I follow X" and "does X want to follow me" are two independent relationships. The second one is never relevant on X's own page — it only matters in the notification bell, where the target reviews it. Dropping it isn't a missing feature; it's the old state not having anywhere left to exist. `PlayerDetails.jsx`'s follow button consequently goes from 4 states to 3: Follow / Requested / Following.

**Why a separate `is_mutual_follow` boolean instead of folding "mutual" into `follow_status`?**
`follow_status` answers "what should the button say" (Follow/Requested/Following) — a UI-state question. `is_mutual_follow` answers "does this viewer get friends-tier content" — a gating question. A `'mutual'` status value would force the button to treat two values (`following`, `mutual`) as equivalent for rendering, for no benefit — Instagram's own follow button never distinguishes "following" from "you follow each other" either. Keeping them as two separate fields keeps each one single-purpose.

**Why keep the `'friends'` string literal in the `activity_visibility`/`results_visibility`/`clubs_visibility` `CHECK` constraints unchanged, rather than renaming it to something follow-flavored?**
Renaming the enum value would require a data migration touching every existing profile row for a cosmetic reason. The three visibility columns and their `CHECK` constraints are untouched by this feature — only `can_view_section()`'s internal definition of "friends" changes (it now calls `is_mutual_follow()` instead of the old `are_friends()`/mutual-accept check). No migration needed on `profiles`' three visibility columns.

**Why does `Home.jsx`'s "friend is playing" mix-card badge switch to one-directional following, not mutual follow?**
Confirmed with the human: lower bar, matches how the rest of the follow feature already works (nothing else in this feature requires mutual anything to show public information about someone), and it needs no new RPC — `list_following(profile.id)`, already built for the followers/following modal, is a direct fit. This wasn't in the original friend-request-era behavior (that used `listFriends()`, i.e. mutual), so it's a deliberate loosening, not a preserved behavior.

**Why a new `get_follow_counts(p_user_id)` RPC, when the brief's RPC list didn't call for one?**
`Profile.jsx` (viewing your *own* profile) never calls `get_player_profile` today — it reads identity from `AuthContext`'s already-loaded `profile` object plus a handful of lighter, purpose-built queries (`loadStats`, `loadMixHistory`, etc.). Showing tappable follower/following counts on the own-profile hero card (a new requirement — that card shows no such count today) needs *some* source for those two numbers. Fetching the full `get_player_profile` payload just to read two counts would pull down a heavier query than this page has ever needed. A two-column RPC is the smaller addition.

**Why does the followers/following list render as a modal, not a dedicated route?**
Both `Profile.jsx` and `PlayerDetails.jsx` already use exactly this pattern for an analogous "quick look, then back to what you were doing" interaction — `PhotoViewerModal`. A new route would need its own page shell, back-button behavior, and i18n page title for something this lightweight, and would navigate the viewer away from the profile they were just looking at. Confirmed with the human as the preferred approach.

## Data Model

- **`profiles.is_private BOOLEAN NOT NULL DEFAULT false`** — new column. Default `false` for every existing row (see Key Decisions).
- **New table `follows`**, replacing `friend_requests` entirely:
  ```sql
  CREATE TABLE follows (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    follower_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    followed_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    status        TEXT NOT NULL DEFAULT 'accepted' CHECK (status IN ('pending', 'accepted')),
    created_at    TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    CHECK (follower_id <> followed_id),
    UNIQUE (follower_id, followed_id)
  );
  ```
  One row = one directional relationship. Followers of X = accepted rows where `followed_id = X`. X's following list = accepted rows where `follower_id = X`. Mutual follow = an accepted row exists in both directions between the same two ids. Pending follow requests directed at X (only possible when `X.is_private = true`) = rows where `followed_id = X AND status = 'pending'`.
- RLS on `follows`:
  ```sql
  ALTER TABLE follows ENABLE ROW LEVEL SECURITY;

  CREATE POLICY "Accepted follows are publicly visible, pending only to the two parties"
    ON follows FOR SELECT TO authenticated
    USING (status = 'accepted' OR auth.uid() = follower_id OR auth.uid() = followed_id);

  CREATE POLICY "Follower can always leave; followed party can only decline while pending"
    ON follows FOR DELETE TO authenticated
    USING (auth.uid() = follower_id OR (auth.uid() = followed_id AND status = 'pending'));
  ```
  No direct client `INSERT`/`UPDATE` policy — creating a follow and accepting a pending one both go through `SECURITY DEFINER` RPCs, same pattern `friend_requests`/`organization_invites` already use. The DELETE policy deliberately does **not** let the followed party delete an *accepted* row — "remove this follower" is a distinct feature nobody asked for (see Out of Scope), not a side effect of decline. The follower can always delete their own row regardless of status, covering both "cancel my pending request" and "unfollow."
- `are_friends(a, b)` is replaced by `is_mutual_follow(a, b)`, called from the one existing call site inside `can_view_section()` (signature and every other caller of `can_view_section()` is unchanged):
  ```sql
  CREATE FUNCTION is_mutual_follow(a UUID, b UUID)
  RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
  AS $$
    SELECT EXISTS (SELECT 1 FROM follows WHERE follower_id = a AND followed_id = b AND status = 'accepted')
       AND EXISTS (SELECT 1 FROM follows WHERE follower_id = b AND followed_id = a AND status = 'accepted');
  $$;
  ```
- `get_player_profile(p_user_id UUID)` — return shape changes (DROP + CREATE, same as every prior return-shape change to this function):

  | Old column | New column | Notes |
  |---|---|---|
  | `friends_count` | `followers_count`, `following_count` | two counts, not one |
  | `friendship_status` | `follow_status` | now 4 values: `self`/`none`/`pending`/`following` — `pending_received` is gone (see Key Decisions) |
  | `friendship_request_id` | `follow_request_id` | id of the *viewer's own* `follows` row toward this profile, in **either** status (pending or accepted), `NULL` if `follow_status = 'none'`/`'self'` — used by `PlayerDetails.jsx` to know which row to `DELETE` for both "cancel my pending request" and "unfollow," so it has to cover both statuses, not just the pending case its old name implied |
  | *(none)* | `is_private` | this profile's own private/public flag |
  | *(none)* | `is_mutual_follow` | drives `PlayerDetails.jsx`'s `isHidden()` gate; independent of `follow_status` |

  Every other column (`game_wins`, `results_visibility`, `club_names`, etc.) and every `can_view_section(...)`-gated `CASE` expression is unchanged — only the friend/follow-shaped columns move.

## RPCs

All `SECURITY DEFINER`, `REVOKE ALL ... FROM public` + `GRANT EXECUTE ... TO authenticated`, matching this codebase's existing convention for every RPC in `friend_requests`/`organization_invites`.

- **`follow(p_target_id UUID) RETURNS TEXT`** — replaces `send_friend_request`. Blocks self-follow (`p_target_id = auth.uid()`, `RAISE EXCEPTION`, same message style as `send_friend_request`'s self-request guard) on top of the table's own `CHECK`. Idempotent: an existing row (either status) just returns its current status unchanged. New row: if the target's `is_private = false`, insert `status = 'accepted'`, return `'accepted'`; if `is_private = true`, insert `status = 'pending'`, return `'pending'`.
- **`accept_follow_request(p_request_id UUID) RETURNS VOID`** — replaces `accept_friend_request`. Target only (`followed_id = auth.uid()`), only while `status = 'pending'`, flips to `'accepted'`. Same not-found-or-already-resolved exception style as `accept_friend_request`.
- **Unfollow / cancel / decline — no RPC.** A plain client-side `DELETE FROM follows WHERE id = ...`, with the RLS policy above deciding who's allowed to do it. Same "one DELETE covers three cases" trick `removeFriendRequest`/`declineOrganizationInvite` already document and rely on.
- **`list_followers(p_user_id UUID) RETURNS TABLE (id UUID, name TEXT, avatar_url TEXT)`** — accepted rows where `followed_id = p_user_id`, joined to `profiles` on `follower_id`. Callable for any user id — followers/following lists are public per this feature's whole premise — but still `TO authenticated` only, matching every other RPC in this app (nothing here is `anon`-readable).
- **`list_following(p_user_id UUID) RETURNS TABLE (id UUID, name TEXT, avatar_url TEXT)`** — same shape, accepted rows where `follower_id = p_user_id`, joined on `followed_id`.
- **`get_follow_counts(p_user_id UUID) RETURNS TABLE (followers_count BIGINT, following_count BIGINT)`** — the two counts alone, for `Profile.jsx`'s own hero card (see Key Decisions).
- **`list_incoming_follow_requests() RETURNS TABLE (id UUID, follower_id UUID, follower_name TEXT, follower_avatar_url TEXT, created_at TIMESTAMPTZ)`** — replaces `list_incoming_friend_requests`. Pending rows where `followed_id = auth.uid()`. Consumed only by the `Layout.jsx` bell now (no more tab to also feed).
- **Not built: `list_outgoing_follow_requests`.** Under the old tab UI, "requests I've sent" needed its own list because nothing else showed them. Now a pending outgoing request is visible and cancellable right on the target's own `PlayerDetails.jsx` page (`follow_status === 'pending'` renders "Requested," clicking it cancels) — the same place you'd go to follow them in the first place. No separate surface, no separate RPC.

## Migration of Existing Data

Part of the same migration file that creates `follows` and drops `friend_requests`:

- **Existing `friend_requests` rows with `status = 'accepted'`** (today's mutual friendships) → insert **two** `follows` rows per pair, both `status = 'accepted'`: `(requester_id → addressee_id)` and `(addressee_id → requester_id)`. This preserves every existing friendship as a mutual follow — nobody who currently has friends-tier access to someone loses it the moment this ships, and follower/following counts start non-zero for people who had real connections under the old system.
  ```sql
  INSERT INTO follows (follower_id, followed_id, status)
  SELECT requester_id, addressee_id, 'accepted' FROM friend_requests WHERE status = 'accepted'
  UNION ALL
  SELECT addressee_id, requester_id, 'accepted' FROM friend_requests WHERE status = 'accepted'
  ON CONFLICT (follower_id, followed_id) DO NOTHING;
  ```
- **Existing `friend_requests` rows with `status = 'pending'`** → **dropped, not migrated.** Confirmed with the human. A pending friend request doesn't translate cleanly onto one-directional follow: the two systems default differently (mutual: nothing happens until both agree; follow, with every existing user defaulting to public: following is instant unless the target opted into private). Auto-converting a stale pending friend request into an instant accepted follow would attach a follower to someone who never asked for one and never reviewed it under the new rules. Anyone who still wants to connect can just send a fresh follow once the new UI ships.
- **`friend_requests` table itself** → `DROP TABLE friend_requests CASCADE` once the rows above are copied out. Same one-line pattern `migration_friend_requests.sql` already used to retire its own predecessor, `player_follows`.
- **Functions that only existed to serve `friend_requests`** → `DROP FUNCTION IF EXISTS send_friend_request(UUID), accept_friend_request(UUID), list_incoming_friend_requests(), list_friends(), list_outgoing_friend_requests(), are_friends(UUID, UUID)` in the same migration, after `is_mutual_follow`/`get_player_profile`/etc. have already been created (so `can_view_section()` never has a moment where it's pointing at a dropped function).

## UI Changes

### `src/pages/Profile.jsx`
- `TABS` drops the `amigos` and `convites` entries — down to `perfil` / `historico`.
- Delete the `tab === 'amigos'` and `tab === 'convites'` render blocks in full, plus every piece of state and every loader/handler that existed only to feed them: `friendRequests`, `friendRequestActing`, `outgoingRequests`, `outgoingRequestActing`, `friends`, `friendsLoading`, `orgInvites`, `orgInvitesLoading`, `orgInviteActing`, `loadFriendRequests`, `loadOutgoingRequests`, `loadFriends`, `handleAcceptFriendRequest`, `handleDeclineFriendRequest`, `handleCancelOutgoingRequest`, `loadOrgInvites`, `handleAcceptOrgInvite`, `handleDeclineOrgInvite`.
- Hero card gains a new tappable followers/following line (own counts, via `get_follow_counts`), opening `FollowListModal` for the signed-in user's own id — this is new UI; the own-profile hero shows no such count today.
- The privacy section inside the edit form (next to the three `VISIBILITY_OPTIONS` selects) gains an `is_private` toggle (`Segmented`, "Público"/"Privado"), saved through the same `updateProfile()` call the three visibility selects already use.
- `import { listIncomingFriendRequests, acceptFriendRequest, removeFriendRequest, listFriends, listOutgoingFriendRequests } from '../lib/friends'` is deleted; replaced by whatever subset of the new `src/lib/follows.js` this file actually still needs (`get_follow_counts` wrapper only, plus the `is_private` field already arriving on `profile` for free via `AuthContext`'s existing `select('*')`).

### `src/pages/PlayerDetails.jsx`
- The `friends_count` hero text line becomes a tappable followers/following line, opening `FollowListModal` for `player.id`.
- The `!player.my_profile` button block drops from 4 states to 3:
  - `follow_status === 'following'` → "A seguir" (clicking calls `removeFollow(player.follow_request_id)`, gated behind `confirm()`, same destructive-action-confirmation rule the rest of the app follows)
  - `follow_status === 'pending'` → "Pedido enviado" (clicking calls `removeFollow(player.follow_request_id)` to cancel, no confirmation needed — cancelling a request you just sent isn't destructive the way unfollowing an established connection is)
  - else → "Seguir" (clicking calls `followPlayer(player.id)`)
  - The old `pending_received` branch and its `handleAcceptRequest` handler are deleted outright — that state cannot occur on this page anymore (see Key Decisions).
- `isHidden(visibility)` changes its guard from `player.friendship_status !== 'friends'` to `!player.is_mutual_follow`.
- `import { sendFriendRequest, acceptFriendRequest, removeFriendRequest } from '../lib/friends'` → `import { followPlayer, removeFollow } from '../lib/follows'` (only `follow`/unfollow-or-cancel are needed here; accept isn't, since this page never renders an accept action).

### `src/components/Layout.jsx` (bell dropdown)
- `listIncomingFriendRequests` import/state → `listIncomingFollowRequests`.
- The `friendRequests.map(...)` row block currently links out to `/perfil?tab=amigos`. That destination is gone, so this becomes **inline accept/decline** — two small icon buttons per row (`UserCheck`/`X`, the same pair the old `amigos` tab used for incoming requests), matching how `joinRequestsByOrg` already renders inline in this same dropdown rather than linking away.
- The `orgInvites.map(...)` row block currently links out to `/perfil?tab=convites` — same fix, becomes inline accept/decline. This also resolves a small pre-existing inconsistency: join-requests were already inline, friend-requests/org-invites were not.
- The empty-state's `<Link to="/perfil?tab=amigos">{t('layout.view_friends')}</Link>` CTA is **dropped entirely**, not repointed. Confirmed with the human: there's no page left that "view friends" naturally leads to, and inventing a destination for it wasn't asked for. The empty state becomes just the `t('layout.no_new_notifications')` text with no follow-up link.

### New: `FollowListModal` (`src/components/ui.jsx`)
- Exported alongside `PhotoViewerModal`, same file, same "small reusable modal" precedent.
- Props: `userId`, `initialTab` (`'followers' | 'following'`), `onClose`.
- Two tabs (Seguidores / A seguir) inside the modal, each backed by `list_followers`/`list_following`, rendering avatar+name rows as `Link to="/jogador/:id"` that close the modal on navigate — same row styling the old `friends` tab used.
- Used from both `Profile.jsx`'s hero (own id) and `PlayerDetails.jsx`'s hero (`player.id`).

### `src/pages/Home.jsx`
- `listFriends()` → `listFollowing(profile.id)` (from the new `src/lib/follows.js`). The "friend is in this mix" `MixCard` badge (`friendIds` prop, `src/components/ui.jsx`) switches from mutual-friendship to one-directional following — confirmed with the human (see Key Decisions). No prop-shape change to `MixCard` itself; `friendIds` still just receives a `Set` of ids.

### New module: `src/lib/follows.js` (replaces `src/lib/friends.js`)
Thin RPC wrappers, same shape as the file it replaces: `followPlayer(targetId)` → `follow` RPC, `acceptFollowRequest(requestId)` → `accept_follow_request` RPC, `removeFollow(followRowId)` → plain `.from('follows').delete().eq('id', followRowId)`, `listFollowers(userId)`, `listFollowing(userId)`, `listIncomingFollowRequests()`, `getFollowCounts(userId)`.

## i18n

`src/locales/pt.json` is source of truth, written first; `src/locales/en.json` mirrors every key.

**Removed** (dead once the tabs/old flow are gone): `profile.tab_friends`, `profile.tab_invites`, `profile.friend_requests_heading`, `profile.accept_request_aria`, `profile.decline_request_aria`, `profile.sent_requests_heading`, `profile.pending_badge`, `profile.cancel_request_aria`, `profile.no_friends_title`, `profile.no_friends_subtitle`, `profile.no_invites_title`, `profile.no_invites_subtitle`, `profile.invited_by`, `profile.accept_invite_aria`, `profile.decline_invite_aria`, `profile.error_cancel_friend_request`, `profile.error_accept_friend_request`, `profile.error_decline_friend_request`, `profile.error_accept_org_invite`, `profile.error_decline_org_invite`, `playerdetails.friend_request_failed`, `playerdetails.accept_request_failed`, `playerdetails.friends_count`, `playerdetails.friends_count_other`, `playerdetails.cancel_request_confirm`, `playerdetails.accept_request`, `playerdetails.add_friend`, `layout.view_friends`, `layout.wants_to_be_friends`.

**Added** (`mixlogic`-style flat keys under existing namespaces): `profile.privacy_is_private_label`, `profile.privacy_is_private_hint`, `profile.followers_count`, `profile.followers_count_other`, `profile.following_count`, `profile.following_count_other`, `playerdetails.follow_button` ("Seguir"), `playerdetails.following_button` ("A seguir"), `playerdetails.requested_button` ("Pedido enviado"), `playerdetails.unfollow_confirm` (kept, text unchanged — "Deixar de seguir {{name}}?..."), `playerdetails.cancel_follow_request_confirm`, `playerdetails.followers_count`, `playerdetails.following_count`, `layout.follow_wants_to_follow` (replacing `wants_to_be_friends`), `layout.accept_follow_aria`, `layout.decline_follow_aria`, `layout.accept_invite_aria` / `layout.decline_invite_aria` (new — the org-invite row in the bell needs its own inline-action labels now that it's no longer just a link), `followlist.tab_followers`, `followlist.tab_following`, `followlist.empty_followers`, `followlist.empty_following`.

**Unchanged:** `profile.friends_label` (still the display label for the `friends` visibility option — its meaning shifts to mutual-follow, its Portuguese text "Amigos" doesn't need to), `profile.visibility_public`, `profile.visibility_private`.

## What Gets Deleted

- `src/lib/friends.js` — replaced in full by `src/lib/follows.js`.
- `friend_requests` table, and every RPC that only existed for it: `send_friend_request`, `accept_friend_request`, `list_incoming_friend_requests`, `list_friends`, `list_outgoing_friend_requests`.
- The `are_friends(a, b)` function — replaced by `is_mutual_follow(a, b)`.
- The `amigos`/`convites` tab bodies in `Profile.jsx`, and every piece of now-dead state/handler that fed only them (listed above under `Profile.jsx`).
- Every i18n key listed as **Removed** above, from both `pt.json` and `en.json`.

## Out of Scope

- **Remove follower** — a private-account owner unilaterally kicking out an already-accepted follower. Declining a *pending* request is in scope (RLS already allows it); removing an *accepted* one is a distinct feature nobody asked for, and the DELETE policy in this spec deliberately doesn't allow it.
- **New-follower notifications** for public-account follows. The bell shows pending requests *awaiting a decision* — a public account's instant new follower needs no action, so it generates no notification.
- **Block/mute** — not requested, not a trivial side effect of unfollow.
- **`list_outgoing_follow_requests`** — see RPCs section; superseded by the target's own profile button.
- **Auto-accepting a stale pending request** if the target later flips `is_private` from true to false — stays manual; not worth a trigger for an edge case this narrow.
- Any change to how `activity_visibility`/`results_visibility`/`clubs_visibility` themselves work, or to `can_view_section()`'s signature — only `is_mutual_follow()` (formerly `are_friends()`) changes underneath it.
