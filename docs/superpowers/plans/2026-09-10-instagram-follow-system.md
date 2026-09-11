# Instagram-Style Follow System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mutual, symmetric `friend_requests` system with a one-directional `follows` system (Instagram-style: instant follow on public accounts, pending-approval follow requests on private ones), remove the `amigos`/`convites` tabs from `Profile.jsx` in favor of inline accept/decline in the notification bell, and make followers/following lists public and viewable from any player's hero card.

**Architecture:** One new table (`follows`, replacing `friend_requests`) plus a new `profiles.is_private` column drive everything. A single migration file creates the schema, RLS, and every RPC, migrates existing accepted friendships into mutual follow pairs, and drops the old table/functions it replaces. A new `src/lib/follows.js` module (replacing `src/lib/friends.js`) wraps those RPCs. UI work follows the data layer: a new reusable `FollowListModal` in `src/components/ui.jsx`, then `Profile.jsx` (tabs removed, own hero gains follow counts + privacy toggle), `PlayerDetails.jsx` (follow button collapses from 4 states to 3, hero gains follow counts), `Layout.jsx`'s notification bell (inline accept/decline replacing the old tab-links), and `Home.jsx` (its "friend in this mix" badge switches to one-directional following). A final cleanup task deletes `src/lib/friends.js` once nothing imports it anymore.

**Tech Stack:** React + Vite + Supabase (Postgres + RPC), react-i18next. This feature has no pure-logic functions comparable to `mixLogic.js` — no new Vitest test files are added; verification is `npm run build` + the existing `npx vitest run` (regression only) + manual/read-through checks, matching how this repo has always verified its other RPC-wrapper-and-UI features (`friend_requests`, `organization_invites`).

**Spec:** `docs/superpowers/specs/2026-09-10-instagram-follow-system-design.md`

## Global Constraints

- `follows` fully replaces `friend_requests` — no code anywhere should reference `friend_requests`, `send_friend_request`, `accept_friend_request`, `list_incoming_friend_requests`, `list_friends`, `list_outgoing_friend_requests`, or `are_friends` once this plan is complete.
- `profiles.is_private` defaults to `false` for every row (existing and new) — follows stay instant unless a user opts into private.
- `is_private` gates **only** whether following that profile needs approval. It must never be wired into `activity_visibility`/`results_visibility`/`clubs_visibility` or `can_view_section()` as a second content lock — those three columns and their `'public'/'friends'/'private'` `CHECK` constraints are untouched by this feature; only what `'friends'` *means* changes (mutual follow, via a new `is_mutual_follow()` replacing `are_friends()`).
- The `follow_status` a viewer sees on someone else's profile has exactly 4 values: `self` / `none` / `pending` / `following`. There is no `pending_received` state — a target-initiated "they want to follow you" situation is only ever surfaced in the notification bell, never on that person's own `PlayerDetails.jsx` page.
- `src/locales/pt.json` is source of truth, written first in every i18n step; `src/locales/en.json` mirrors every key with an English translation in the same task.
- Destructive-action `confirm()` dialogs stay required for unfollowing an established connection (repo rule: never skip confirmation on destructive actions) — but are **not** required for cancelling your own still-pending outgoing request, which isn't destructive the same way.
- Out of scope, do not implement: removing an already-accepted follower, new-follower notifications for public accounts, block/mute, `list_outgoing_follow_requests`, or auto-accepting a stale pending request if a target flips from private to public later.
- Every migration file this plan produces must carry the repo's standard **"NOT LIVE until run in Supabase → SQL Editor → New query → Run"** disclaimer in its header comment (see Task 1, Step 2) — a migration file existing in the repo changes nothing until a human pastes it in.

---

## Task 1: Database migration — schema, RLS, RPCs, data migration, cleanup

**Files:**
- Create: `supabase/migration_instagram_follow_system.sql`

**Interfaces:**
- Produces: table `follows` (columns: `id`, `follower_id`, `followed_id`, `status`, `created_at`); `profiles.is_private BOOLEAN`; functions `is_mutual_follow(a UUID, b UUID)`, `follow(p_target_id UUID) RETURNS TEXT`, `accept_follow_request(p_request_id UUID) RETURNS VOID`, `list_followers(p_user_id UUID)`, `list_following(p_user_id UUID)`, `get_follow_counts(p_user_id UUID)`, `list_incoming_follow_requests()`; reshaped `get_player_profile(p_user_id UUID)` returning `followers_count`, `following_count`, `follow_status`, `follow_request_id`, `is_private`, `is_mutual_follow` in place of the old `friends_count`/`friendship_status`/`friendship_request_id`. Consumed by Task 3 (`src/lib/follows.js`) and, transitively, every UI task after it.
- Removes: table `friend_requests`; functions `send_friend_request`, `accept_friend_request`, `list_incoming_friend_requests`, `list_friends`, `list_outgoing_friend_requests`, `are_friends`.

This task has no automated test — it's a hand-run SQL file, same as every other migration in `supabase/`. Verification is read-through plus (once actually run against a real Supabase instance) manual RPC calls.

- [ ] **Step 1: Write the migration's header disclaimer**

Every migration file in this repo opens with this exact disclaimer shape (see `supabase/migration_friend_requests.sql`, `supabase/migration_americano_format.sql`) — write it first, verbatim in spirit, at the top of the new file:

```sql
-- ════════════════════════════════════════════════════════════════════════
-- Migration: Instagram-style one-directional follow system, replacing the
-- mutual friend-request system (friend_requests). Following a public
-- account is instant; following a private account (profiles.is_private)
-- creates a pending follow request the target must accept or decline.
-- The 'friends' tier of activity_visibility/results_visibility/
-- clubs_visibility now means MUTUAL FOLLOW instead of mutual accept — the
-- three visibility columns and their CHECK constraints are unchanged,
-- only what can_view_section() calls underneath them changes
-- (is_mutual_follow() replaces are_friends()).
--
-- No direct INSERT/UPDATE policy on follows — following/accepting always
-- goes through follow()/accept_follow_request() (SECURITY DEFINER), same
-- pattern as friend_requests/organization_invites. Declining a pending
-- request, cancelling a request you sent, and unfollowing are all the
-- same plain client-side DELETE, covered by RLS — no RPC needed for any
-- of the three (see the DELETE policy below for exactly who can delete
-- what).
--
-- NOT LIVE until run in Supabase → SQL Editor → New query → Run. A
-- migration file existing in this repo changes nothing on its own —
-- every existing mix/profile/follow keeps behaving exactly as it does
-- today until this file is actually pasted in and executed there.
--
-- See docs/superpowers/specs/2026-09-10-instagram-follow-system-design.md
-- for the full design and the reasoning behind each decision below.
-- ════════════════════════════════════════════════════════════════════════
```

- [ ] **Step 2: `profiles.is_private` column**

```sql
ALTER TABLE profiles ADD COLUMN is_private BOOLEAN NOT NULL DEFAULT false;
```

- [ ] **Step 3: `follows` table + RLS**

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
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;

-- Accepted follows are the public follow graph (anyone signed in can see
-- who follows whom, same as the app's original player_follows table).
-- Pending rows are only visible to the two parties involved — a private
-- account's incoming requests aren't a public list.
CREATE POLICY "Accepted follows are publicly visible, pending only to the two parties"
  ON follows FOR SELECT TO authenticated
  USING (status = 'accepted' OR auth.uid() = follower_id OR auth.uid() = followed_id);

-- The follower can always delete their own row (unfollow at any time, or
-- cancel their own still-pending request). The followed party can only
-- delete while status='pending' (declining a request) — this
-- deliberately does NOT let someone unilaterally remove an already-
-- accepted follower; "remove follower" is a distinct feature, out of
-- scope for this migration (see the spec's Out of Scope section).
CREATE POLICY "Follower can always leave; followed party can only decline while pending"
  ON follows FOR DELETE TO authenticated
  USING (auth.uid() = follower_id OR (auth.uid() = followed_id AND status = 'pending'));
```

- [ ] **Step 4: `is_mutual_follow` — replaces `are_friends`**

```sql
CREATE FUNCTION is_mutual_follow(a UUID, b UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (SELECT 1 FROM follows WHERE follower_id = a AND followed_id = b AND status = 'accepted')
     AND EXISTS (SELECT 1 FROM follows WHERE follower_id = b AND followed_id = a AND status = 'accepted');
$$;

REVOKE ALL ON FUNCTION is_mutual_follow(UUID, UUID) FROM public;
GRANT EXECUTE ON FUNCTION is_mutual_follow(UUID, UUID) TO authenticated;
```

- [ ] **Step 5: Repoint `can_view_section` at `is_mutual_follow`**

Signature and every other caller are unchanged — only the one internal call swaps:

```sql
CREATE OR REPLACE FUNCTION can_view_section(p_owner_id UUID, p_visibility TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    auth.uid() = p_owner_id
    OR p_visibility = 'public'
    OR (p_visibility = 'friends' AND is_mutual_follow(auth.uid(), p_owner_id));
$$;
```

- [ ] **Step 6: `follow(p_target_id)` — replaces `send_friend_request`**

Idempotent (re-calling on an existing row just returns its current status). Instant `accepted` insert for a public target, `pending` insert for a private one.

```sql
CREATE FUNCTION follow(p_target_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_existing_status TEXT;
  v_target_private BOOLEAN;
BEGIN
  IF p_target_id = auth.uid() THEN
    RAISE EXCEPTION 'Não podes seguir-te a ti mesmo';
  END IF;

  SELECT status INTO v_existing_status FROM follows
  WHERE follower_id = auth.uid() AND followed_id = p_target_id;
  IF v_existing_status IS NOT NULL THEN
    RETURN v_existing_status;
  END IF;

  SELECT is_private INTO v_target_private FROM profiles WHERE id = p_target_id;
  IF v_target_private IS NULL THEN
    RAISE EXCEPTION 'Jogador não encontrado';
  END IF;

  INSERT INTO follows (follower_id, followed_id, status)
  VALUES (auth.uid(), p_target_id, CASE WHEN v_target_private THEN 'pending' ELSE 'accepted' END);

  RETURN CASE WHEN v_target_private THEN 'pending' ELSE 'accepted' END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION follow(UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION follow(UUID) TO authenticated;
```

- [ ] **Step 7: `accept_follow_request(p_request_id)` — replaces `accept_friend_request`**

```sql
CREATE FUNCTION accept_follow_request(p_request_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE follows SET status = 'accepted'
  WHERE id = p_request_id AND followed_id = auth.uid() AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido para seguir não encontrado ou já não está pendente';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION accept_follow_request(UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION accept_follow_request(UUID) TO authenticated;
```

Note: unfollowing, cancelling your own pending request, and declining someone else's pending request all reuse the DELETE RLS policy from Step 3 — no RPC. Confirmed no RPC is needed for any of those three from the client: `supabase.from('follows').delete().eq('id', rowId)`.

- [ ] **Step 8: `list_followers(p_user_id)` / `list_following(p_user_id)`**

```sql
CREATE FUNCTION list_followers(p_user_id UUID)
RETURNS TABLE (id UUID, name TEXT, avatar_url TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT p.id, p.name, p.avatar_url
  FROM follows f
  JOIN profiles p ON p.id = f.follower_id
  WHERE f.followed_id = p_user_id AND f.status = 'accepted'
  ORDER BY p.name;
$$;

REVOKE ALL ON FUNCTION list_followers(UUID) FROM public;
GRANT EXECUTE ON FUNCTION list_followers(UUID) TO authenticated;

CREATE FUNCTION list_following(p_user_id UUID)
RETURNS TABLE (id UUID, name TEXT, avatar_url TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT p.id, p.name, p.avatar_url
  FROM follows f
  JOIN profiles p ON p.id = f.followed_id
  WHERE f.follower_id = p_user_id AND f.status = 'accepted'
  ORDER BY p.name;
$$;

REVOKE ALL ON FUNCTION list_following(UUID) FROM public;
GRANT EXECUTE ON FUNCTION list_following(UUID) TO authenticated;
```

Both are callable for any user id (public lists, no ownership check) — matches the requirement that followers/following are visible for any player, same way `list_followers`'s SELECT policy already allows (only `accepted` rows are visible to non-parties anyway, so there's nothing extra to leak here).

- [ ] **Step 9: `get_follow_counts(p_user_id)`**

```sql
CREATE FUNCTION get_follow_counts(p_user_id UUID)
RETURNS TABLE (followers_count BIGINT, following_count BIGINT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    (SELECT COUNT(*) FROM follows WHERE followed_id = p_user_id AND status = 'accepted'),
    (SELECT COUNT(*) FROM follows WHERE follower_id = p_user_id AND status = 'accepted');
$$;

REVOKE ALL ON FUNCTION get_follow_counts(UUID) FROM public;
GRANT EXECUTE ON FUNCTION get_follow_counts(UUID) TO authenticated;
```

- [ ] **Step 10: `list_incoming_follow_requests()` — replaces `list_incoming_friend_requests`**

```sql
CREATE FUNCTION list_incoming_follow_requests()
RETURNS TABLE (id UUID, follower_id UUID, follower_name TEXT, follower_avatar_url TEXT, created_at TIMESTAMPTZ)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT f.id, p.id, p.name, p.avatar_url, f.created_at
  FROM follows f
  JOIN profiles p ON p.id = f.follower_id
  WHERE f.followed_id = auth.uid() AND f.status = 'pending'
  ORDER BY f.created_at DESC;
$$;

REVOKE ALL ON FUNCTION list_incoming_follow_requests() FROM public;
GRANT EXECUTE ON FUNCTION list_incoming_follow_requests() TO authenticated;
```

- [ ] **Step 11: `get_player_profile` — reshaped return columns**

Return shape changes (`followers_count`/`following_count`/`follow_status`/`follow_request_id`/`is_private`/`is_mutual_follow` in place of `friends_count`/`friendship_status`/`friendship_request_id`) → `DROP` + `CREATE`, same as every prior shape change to this function. `follow_status` is 4-valued (`self`/`none`/`pending`/`following` — no `pending_received`, see Global Constraints). `follow_request_id` carries the viewer's own `follows` row id toward this profile in **either** status, so the frontend has one id to `DELETE` for both "cancel my pending request" and "unfollow."

```sql
DROP FUNCTION IF EXISTS get_player_profile(UUID);

CREATE FUNCTION get_player_profile(p_user_id UUID)
RETURNS TABLE (
  id UUID,
  name TEXT,
  avatar_url TEXT,
  level TEXT,
  game_wins BIGINT,
  game_losses BIGINT,
  mix_wins BIGINT,
  mixes_played BIGINT,
  club_points BIGINT,
  private_points BIGINT,
  total_points BIGINT,
  followers_count BIGINT,
  following_count BIGINT,
  follow_status TEXT,
  follow_request_id UUID,
  my_profile BOOLEAN,
  club_names TEXT,
  activity_visibility TEXT,
  results_visibility TEXT,
  clubs_visibility TEXT,
  is_private BOOLEAN,
  is_mutual_follow BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH club_stats AS (
    SELECT
      COALESCE(SUM(ps.game_wins), 0) AS game_wins,
      COALESCE(SUM(ps.game_losses), 0) AS game_losses,
      COALESCE(SUM(ps.mix_wins), 0) AS mix_wins,
      COALESCE(SUM(ps.mixes_played), 0) AS mixes_played,
      COALESCE(SUM(ps.total_points), 0) AS club_points
    FROM player_stats ps
    WHERE ps.user_id = p_user_id
  ),
  private_stats AS (
    SELECT COALESCE(SUM(pms.points_earned), 0) AS private_points
    FROM private_match_stats pms
    WHERE pms.user_id = p_user_id
  ),
  shared_level AS (
    SELECT m.level
    FROM memberships m
    WHERE m.user_id = p_user_id
      AND EXISTS (
        SELECT 1 FROM memberships caller
        WHERE caller.user_id = auth.uid()
          AND caller.organization_id = m.organization_id
      )
    LIMIT 1
  ),
  follow_counts AS (
    SELECT
      (SELECT COUNT(*) FROM follows WHERE followed_id = p_user_id AND status = 'accepted') AS followers_count,
      (SELECT COUNT(*) FROM follows WHERE follower_id = p_user_id AND status = 'accepted') AS following_count
  ),
  my_follow AS (
    SELECT id, status FROM follows
    WHERE follower_id = auth.uid() AND followed_id = p_user_id
  ),
  clubs AS (
    SELECT string_agg(DISTINCT o.name, ', ' ORDER BY o.name) AS names
    FROM memberships m
    JOIN organizations o ON o.id = m.organization_id
    WHERE m.user_id = p_user_id
  ),
  vis AS (
    SELECT activity_visibility, results_visibility, clubs_visibility, is_private
    FROM profiles WHERE id = p_user_id
  )
  SELECT
    p.id,
    p.name,
    p.avatar_url,
    (SELECT level FROM shared_level),
    CASE WHEN can_view_section(p_user_id, (SELECT results_visibility FROM vis)) THEN club_stats.game_wins END,
    CASE WHEN can_view_section(p_user_id, (SELECT results_visibility FROM vis)) THEN club_stats.game_losses END,
    CASE WHEN can_view_section(p_user_id, (SELECT results_visibility FROM vis)) THEN club_stats.mix_wins END,
    CASE WHEN can_view_section(p_user_id, (SELECT results_visibility FROM vis)) THEN club_stats.mixes_played END,
    CASE WHEN can_view_section(p_user_id, (SELECT results_visibility FROM vis)) THEN club_stats.club_points END,
    CASE WHEN can_view_section(p_user_id, (SELECT results_visibility FROM vis)) THEN private_stats.private_points END,
    CASE WHEN can_view_section(p_user_id, (SELECT results_visibility FROM vis)) THEN club_stats.club_points + private_stats.private_points END,
    (SELECT followers_count FROM follow_counts),
    (SELECT following_count FROM follow_counts),
    CASE
      WHEN p_user_id = auth.uid() THEN 'self'
      WHEN NOT EXISTS (SELECT 1 FROM my_follow) THEN 'none'
      WHEN (SELECT status FROM my_follow) = 'accepted' THEN 'following'
      ELSE 'pending'
    END,
    (SELECT id FROM my_follow),
    p_user_id = auth.uid(),
    CASE WHEN can_view_section(p_user_id, (SELECT clubs_visibility FROM vis)) THEN (SELECT names FROM clubs) END,
    (SELECT activity_visibility FROM vis),
    (SELECT results_visibility FROM vis),
    (SELECT clubs_visibility FROM vis),
    (SELECT is_private FROM vis),
    is_mutual_follow(auth.uid(), p_user_id)
  FROM profiles p, club_stats, private_stats
  WHERE p.id = p_user_id;
$$;

REVOKE ALL ON FUNCTION get_player_profile(UUID) FROM public;
GRANT EXECUTE ON FUNCTION get_player_profile(UUID) TO authenticated;
```

- [ ] **Step 12: Migrate existing accepted friendships into mutual follows**

Run *before* dropping `friend_requests` (next step needs it to still exist). Every accepted `friend_requests` row becomes two `follows` rows (both directions, both `accepted`) — see the spec's "Migration of Existing Data" section for why pending rows are deliberately excluded (dropped, not migrated).

```sql
INSERT INTO follows (follower_id, followed_id, status)
SELECT requester_id, addressee_id, 'accepted' FROM friend_requests WHERE status = 'accepted'
UNION ALL
SELECT addressee_id, requester_id, 'accepted' FROM friend_requests WHERE status = 'accepted'
ON CONFLICT (follower_id, followed_id) DO NOTHING;
```

- [ ] **Step 13: Drop `friend_requests` and every function that only served it**

```sql
DROP TABLE friend_requests CASCADE;

DROP FUNCTION IF EXISTS send_friend_request(UUID);
DROP FUNCTION IF EXISTS accept_friend_request(UUID);
DROP FUNCTION IF EXISTS list_incoming_friend_requests();
DROP FUNCTION IF EXISTS list_friends();
DROP FUNCTION IF EXISTS list_outgoing_friend_requests();
DROP FUNCTION IF EXISTS are_friends(UUID, UUID);
```

These drops come last, after Step 5 has already repointed `can_view_section` away from `are_friends` — so there's no moment where a live function references one that's about to disappear.

- [ ] **Step 14: Flag this explicitly**

This migration is **not live** until pasted into Supabase → SQL Editor and run there. State that explicitly when reporting this task done, and flag it again when Tasks 3–8 are dispatched, since every one of them depends on `follows`/its RPCs/`get_player_profile`'s new shape actually existing wherever they're tested against.

- [ ] **Step 15: Commit**

```bash
git add supabase/migration_instagram_follow_system.sql
git commit -m "feat: migration for Instagram-style follow system (schema, RLS, RPCs) — NOT YET RUN in Supabase"
```

---

## Task 2: i18n keys — remove dead friend/invite-tab strings, add follow strings

**Files:**
- Modify: `src/locales/pt.json`
- Modify: `src/locales/en.json`

**Interfaces:**
- Produces: every `t('...')` key Tasks 4–7 reference. Consumed by Tasks 4–7.

- [ ] **Step 1: Remove dead keys from `pt.json`**

Delete these exact lines (each is a full property line ending in a comma; none is the last property in its enclosing object, so the file stays valid JSON after removal):

```
  "layout.view_friends": "Ver amigos",
  "layout.wants_to_be_friends": "quer ser teu amigo",
  "playerdetails.friend_request_failed": "Não foi possível enviar o pedido. Tenta novamente.",
  "playerdetails.accept_request_failed": "Não foi possível aceitar o pedido. Tenta novamente.",
  "playerdetails.friends_count": "{{count}} amigo",
  "playerdetails.friends_count_other": "{{count}} amigos",
  "playerdetails.cancel_request_confirm": "Cancelar o pedido de amizade?",
  "playerdetails.accept_request": "Aceitar pedido",
  "playerdetails.add_friend": "Adicionar amigo",
  "profile.error_cancel_friend_request": "Não foi possível cancelar o pedido. Tenta novamente.",
  "profile.error_accept_friend_request": "Não foi possível aceitar o pedido. Tenta novamente.",
  "profile.error_decline_friend_request": "Não foi possível recusar o pedido. Tenta novamente.",
  "profile.error_accept_org_invite": "Não foi possível aceitar o convite. Tenta novamente.",
  "profile.error_decline_org_invite": "Não foi possível recusar o convite. Tenta novamente.",
  "profile.friend_requests_heading": "Pedidos de amizade",
  "profile.accept_request_aria": "Aceitar pedido",
  "profile.decline_request_aria": "Recusar pedido",
  "profile.sent_requests_heading": "Pedidos enviados",
  "profile.pending_badge": "Pendente",
  "profile.cancel_request_aria": "Cancelar pedido",
  "profile.no_friends_title": "Ainda não tens amigos",
  "profile.no_friends_subtitle": "Envia um pedido de amizade a partir do perfil de outro jogador.",
  "profile.no_invites_title": "Sem convites pendentes",
  "profile.no_invites_subtitle": "Convites de admins de clube para te juntares aparecem aqui.",
  "profile.invited_by": "Convidado por {{name}}",
  "profile.accept_invite_aria": "Aceitar convite",
  "profile.decline_invite_aria": "Recusar convite",
```

Keep (still used, meaning unchanged or repurposed in Task 6): `playerdetails.unfollow_confirm`, `playerdetails.unfollow_button`, `playerdetails.request_sent`, `profile.visibility_public`, `profile.friends_label`, `profile.visibility_private`.

- [ ] **Step 2: Add new keys to `pt.json`**

Add near the existing `profile.visibility_private` line (same `profile.*` privacy cluster):

```json
  "profile.privacy_is_private_label": "Conta privada",
  "profile.privacy_is_private_hint": "Contas privadas têm de aprovar cada novo pedido para seguir.",
  "profile.followers_count": "{{count}} seguidor",
  "profile.followers_count_other": "{{count}} seguidores",
  "profile.following_count": "{{count}} a seguir",
```

Add near where the old `playerdetails.add_friend`/`accept_request` keys were:

```json
  "playerdetails.follow_button": "Seguir",
  "playerdetails.following_button": "A seguir",
  "playerdetails.requested_button": "Pedido enviado",
  "playerdetails.cancel_follow_request_confirm": "Cancelar o pedido para seguir?",
  "playerdetails.followers_count": "{{count}} seguidor",
  "playerdetails.followers_count_other": "{{count}} seguidores",
  "playerdetails.following_count": "{{count}} a seguir",
```

Add near where the old `layout.wants_to_be_friends`/`layout.view_friends` keys were:

```json
  "layout.follow_wants_to_follow": "quer seguir-te",
  "layout.accept_follow_aria": "Aceitar pedido para seguir",
  "layout.decline_follow_aria": "Recusar pedido para seguir",
  "layout.accept_invite_aria": "Aceitar convite",
  "layout.decline_invite_aria": "Recusar convite",
```

Add a new top-level `followlist.*` cluster (new namespace, for the `FollowListModal` built in Task 4):

```json
  "followlist.tab_followers": "Seguidores",
  "followlist.tab_following": "A seguir",
  "followlist.empty_followers": "Ainda sem seguidores.",
  "followlist.empty_following": "Ainda não segue ninguém.",
```

- [ ] **Step 3: Mirror both removals and additions in `en.json`**

Delete the equivalent lines (same keys, English values):

```
  "layout.view_friends": "View friends",
  "layout.wants_to_be_friends": "wants to be your friend",
  "playerdetails.friend_request_failed": "Could not send the request. Try again.",
  "playerdetails.accept_request_failed": "Could not accept the request. Try again.",
  "playerdetails.friends_count": "{{count}} friend",
  "playerdetails.friends_count_other": "{{count}} friends",
  "playerdetails.cancel_request_confirm": "Cancel the friend request?",
  "playerdetails.accept_request": "Accept request",
  "playerdetails.add_friend": "Add friend",
  "profile.error_cancel_friend_request": "Couldn't cancel the request. Please try again.",
  "profile.error_accept_friend_request": "Couldn't accept the request. Please try again.",
  "profile.error_decline_friend_request": "Couldn't decline the request. Please try again.",
  "profile.error_accept_org_invite": "Couldn't accept the invite. Please try again.",
  "profile.error_decline_org_invite": "Couldn't decline the invite. Please try again.",
  "profile.friend_requests_heading": "Friend requests",
  "profile.accept_request_aria": "Accept request",
  "profile.decline_request_aria": "Decline request",
  "profile.sent_requests_heading": "Sent requests",
  "profile.pending_badge": "Pending",
  "profile.cancel_request_aria": "Cancel request",
  "profile.no_friends_title": "You don't have any friends yet",
  "profile.no_friends_subtitle": "Send a friend request from another player's profile.",
  "profile.no_invites_title": "No pending invites",
  "profile.no_invites_subtitle": "Invites from club admins to join appear here.",
  "profile.invited_by": "Invited by {{name}}",
  "profile.accept_invite_aria": "Accept invite",
  "profile.decline_invite_aria": "Decline invite",
```

Add the matching English translations, same key set as Step 2:

```json
  "profile.privacy_is_private_label": "Private account",
  "profile.privacy_is_private_hint": "Private accounts must approve every new follow request.",
  "profile.followers_count": "{{count}} follower",
  "profile.followers_count_other": "{{count}} followers",
  "profile.following_count": "{{count}} following",
```

```json
  "playerdetails.follow_button": "Follow",
  "playerdetails.following_button": "Following",
  "playerdetails.requested_button": "Requested",
  "playerdetails.cancel_follow_request_confirm": "Cancel the follow request?",
  "playerdetails.followers_count": "{{count}} follower",
  "playerdetails.followers_count_other": "{{count}} followers",
  "playerdetails.following_count": "{{count}} following",
```

```json
  "layout.follow_wants_to_follow": "wants to follow you",
  "layout.accept_follow_aria": "Accept follow request",
  "layout.decline_follow_aria": "Decline follow request",
  "layout.accept_invite_aria": "Accept invite",
  "layout.decline_invite_aria": "Decline invite",
```

```json
  "followlist.tab_followers": "Followers",
  "followlist.tab_following": "Following",
  "followlist.empty_followers": "No followers yet.",
  "followlist.empty_following": "Not following anyone yet.",
```

- [ ] **Step 4: Verify both files still parse**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/locales/pt.json','utf8')); JSON.parse(require('fs').readFileSync('src/locales/en.json','utf8')); console.log('ok')"`
Expected: prints `ok` for both (run once per file, or combine as above — either way, a JSON syntax error throws and fails loudly).

- [ ] **Step 5: Commit**

```bash
git add src/locales/pt.json src/locales/en.json
git commit -m "feat: i18n keys for Instagram-style follow system (Task 2)"
```

---

## Task 3: `src/lib/follows.js` — RPC wrappers, replacing `src/lib/friends.js`

**Files:**
- Create: `src/lib/follows.js`

**Interfaces:**
- Consumes: `follow`, `accept_follow_request`, `list_followers`, `list_following`, `get_follow_counts`, `list_incoming_follow_requests` RPCs (Task 1).
- Produces: `followPlayer(targetId)`, `acceptFollowRequest(requestId)`, `removeFollow(followRowId)`, `listFollowers(userId)`, `listFollowing(userId)`, `getFollowCounts(userId)`, `listIncomingFollowRequests()`. Consumed by Tasks 4, 5, 6, 7, 8.

Same thin-wrapper shape as `src/lib/friends.js`/`src/lib/orgInvites.js` — no test file exists for either of those (they're too thin to warrant one; the logic under test is in the RPC, not the wrapper), so this task follows the same precedent: no new test file.

- [ ] **Step 1: Write the module**

```js
import { supabase } from './supabase'

// Returns 'pending' or 'accepted' — idempotent, safe to call again on an
// already-following (or already-pending) target.
export const followPlayer = async (targetId) => {
  const { data, error } = await supabase.rpc('follow', { p_target_id: targetId })
  if (error) throw error
  return data
}

export const acceptFollowRequest = async (requestId) => {
  const { error } = await supabase.rpc('accept_follow_request', { p_request_id: requestId })
  if (error) throw error
}

// Same DELETE covers three cases (RLS lets the follower delete any row,
// and the followed party delete only a pending one): unfollowing an
// accepted follow, cancelling your own pending request, or declining a
// pending request someone sent you.
export const removeFollow = async (followRowId) => {
  const { error } = await supabase.from('follows').delete().eq('id', followRowId)
  if (error) throw error
}

export const listFollowers = async (userId) => {
  const { data, error } = await supabase.rpc('list_followers', { p_user_id: userId })
  if (error) throw error
  return data || []
}

export const listFollowing = async (userId) => {
  const { data, error } = await supabase.rpc('list_following', { p_user_id: userId })
  if (error) throw error
  return data || []
}

export const getFollowCounts = async (userId) => {
  const { data, error } = await supabase.rpc('get_follow_counts', { p_user_id: userId })
  if (error) throw error
  return data?.[0] || { followers_count: 0, following_count: 0 }
}

export const listIncomingFollowRequests = async () => {
  const { data, error } = await supabase.rpc('list_incoming_follow_requests')
  if (error) throw error
  return data || []
}
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: builds successfully (the new file isn't imported anywhere yet, so this only checks it's syntactically valid and type-consistent with its own usage).

- [ ] **Step 3: Commit**

```bash
git add src/lib/follows.js
git commit -m "feat: src/lib/follows.js RPC wrappers (Task 3)"
```

---

## Task 4: `FollowListModal` — reusable followers/following list

**Files:**
- Modify: `src/components/ui.jsx`

**Interfaces:**
- Consumes: `listFollowers`, `listFollowing` (Task 3).
- Produces: `FollowListModal({ userId, initialTab, onClose })`, exported from `src/components/ui.jsx`. Consumed by Task 5 (`Profile.jsx`) and Task 6 (`PlayerDetails.jsx`).

- [ ] **Step 1: Add the import**

Find, at the top of `src/components/ui.jsx`:

```jsx
import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { MapPin, CheckCircle2, ChevronRight, ChevronDown, ChevronLeft, Lock, Play, Calendar, X, Share2, MessageCircle, Link2, ImageDown, Trophy, Repeat, Euro, Swords, Users } from 'lucide-react'
import ShareCard, { CARD_W, CARD_H } from './ShareCard'
import { ratingBand, groupRatingBand } from '../lib/elo'
import { achievementIcon, RARITY_META } from '../lib/achievements'
import { formatDate, formatTime, formatCurrency } from '../lib/formatDate'
import { FORMAT_LABEL_KEY, GENDER_RESTRICTION_LABEL_KEY, mixCapacity } from '../lib/mixLogic'
import { AGE_LABEL_KEY } from '../lib/ageCategories'
```

Replace with (adds `listFollowers`/`listFollowing` import — every other line unchanged):

```jsx
import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { MapPin, CheckCircle2, ChevronRight, ChevronDown, ChevronLeft, Lock, Play, Calendar, X, Share2, MessageCircle, Link2, ImageDown, Trophy, Repeat, Euro, Swords, Users } from 'lucide-react'
import ShareCard, { CARD_W, CARD_H } from './ShareCard'
import { ratingBand, groupRatingBand } from '../lib/elo'
import { achievementIcon, RARITY_META } from '../lib/achievements'
import { formatDate, formatTime, formatCurrency } from '../lib/formatDate'
import { FORMAT_LABEL_KEY, GENDER_RESTRICTION_LABEL_KEY, mixCapacity } from '../lib/mixLogic'
import { AGE_LABEL_KEY } from '../lib/ageCategories'
import { listFollowers, listFollowing } from '../lib/follows'
```

- [ ] **Step 2: Add `FollowListModal` right after `PhotoViewerModal`**

Find (the exact end of `PhotoViewerModal`, followed by the `PlayerAvatarRow` doc comment — a unique anchor):

```jsx
      <img
        src={url}
        alt={alt}
        className="max-w-full max-h-full object-contain animate-pop"
        onClick={(e) => e.stopPropagation()}
      />
    </div>,
    document.body
  )
}

/* ─── PlayerAvatarRow ────────────────────────────────────────────────────
```

Replace with (inserts the new modal between the two, changes nothing else):

```jsx
      <img
        src={url}
        alt={alt}
        className="max-w-full max-h-full object-contain animate-pop"
        onClick={(e) => e.stopPropagation()}
      />
    </div>,
    document.body
  )
}

/* ─── FollowListModal ────────────────────────────────────────────────────
   Followers/following for any player — public, tappable from that
   player's hero card on both Profile.jsx (own profile) and
   PlayerDetails.jsx (anyone else's). Same portal-to-body pattern as
   PhotoViewerModal, for the same reason (escapes Layout.jsx header's
   backdrop-blur containing block for fixed descendants). */
export function FollowListModal({ userId, initialTab = 'followers', onClose }) {
  const { t } = useTranslation()
  const [tab, setTab] = useState(initialTab)
  const [followers, setFollowers] = useState(null)
  const [following, setFollowing] = useState(null)

  useEffect(() => {
    let cancelled = false
    setFollowers(null)
    setFollowing(null)
    Promise.all([listFollowers(userId), listFollowing(userId)])
      .then(([followersData, followingData]) => {
        if (cancelled) return
        setFollowers(followersData)
        setFollowing(followingData)
      })
      .catch((error) => console.error('Error loading follow list:', error))
    return () => { cancelled = true }
  }, [userId])

  const rows = tab === 'followers' ? followers : following
  const emptyText = tab === 'followers' ? t('followlist.empty_followers') : t('followlist.empty_following')

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink-900/70 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-t-card sm:rounded-card shadow-lift w-full sm:max-w-sm max-h-[75vh] flex flex-col animate-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-line shrink-0">
          <div className="flex gap-1 p-1 bg-ink-50 rounded-ctrl">
            <button
              onClick={() => setTab('followers')}
              className={`px-3.5 py-1.5 rounded-ctrl text-sm font-extrabold transition-colors duration-fast ${
                tab === 'followers' ? 'bg-canvas text-ink-900 shadow-lift' : 'text-muted'
              }`}
            >
              {t('followlist.tab_followers')}
            </button>
            <button
              onClick={() => setTab('following')}
              className={`px-3.5 py-1.5 rounded-ctrl text-sm font-extrabold transition-colors duration-fast ${
                tab === 'following' ? 'bg-canvas text-ink-900 shadow-lift' : 'text-muted'
              }`}
            >
              {t('followlist.tab_following')}
            </button>
          </div>
          <button
            onClick={onClose}
            aria-label={t('ui.close')}
            className="w-9 h-9 flex items-center justify-center rounded-full text-muted hover:bg-ink-50"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto">
          {rows === null ? (
            <div className="flex items-center justify-center py-10">
              <div className="animate-spin rounded-full h-8 w-8 border-[3px] border-ink-50 border-t-ink-700"></div>
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted text-center py-10">{emptyText}</p>
          ) : (
            <div className="divide-y divide-line">
              {rows.map((p) => (
                <Link
                  key={p.id}
                  to={`/jogador/${p.id}`}
                  onClick={onClose}
                  className="flex items-center gap-3 px-4 py-3 transition-colors duration-fast hover:bg-ink-50"
                >
                  <Avatar name={p.name} url={p.avatar_url} size="w-10 h-10 text-sm" />
                  <p className="flex-1 min-w-0 font-extrabold text-ink-900 text-sm truncate">{p.name}</p>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

/* ─── PlayerAvatarRow ────────────────────────────────────────────────────
```

Note: `Avatar` is a function declaration defined earlier in this same file (already used by `PlayerAvatarRow` and every page that imports it) — no new import needed for it, function declarations are usable regardless of definition order within the module.

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: builds successfully.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui.jsx
git commit -m "feat: FollowListModal component (Task 4)"
```

---

## Task 5: `Profile.jsx` — remove amigos/convites tabs, add follow counts + privacy toggle

**Files:**
- Modify: `src/pages/Profile.jsx`

**Interfaces:**
- Consumes: `getFollowCounts` (Task 3), `FollowListModal` (Task 4).
- Produces: own-profile hero card with tappable followers/following counts; `is_private` toggle in the privacy section. Removes the `amigos`/`convites` tabs entirely.

- [ ] **Step 1: Update imports**

Find:

```jsx
import { listIncomingFriendRequests, acceptFriendRequest, removeFriendRequest, listFriends, listOutgoingFriendRequests } from '../lib/friends'
import { listIncomingOrganizationInvites, acceptOrganizationInvite, declineOrganizationInvite } from '../lib/orgInvites'
import { PrimaryButton, GuestBadge, DateField, Avatar, Select, EmptyState, RatingBadge, PhotoViewerModal, AchievementCard } from '../components/ui'
```

Replace with:

```jsx
import { getFollowCounts } from '../lib/follows'
import { PrimaryButton, GuestBadge, DateField, Avatar, Select, EmptyState, RatingBadge, PhotoViewerModal, FollowListModal, AchievementCard } from '../components/ui'
```

(The `orgInvites` import is dropped entirely — `Profile.jsx` no longer renders club invites anywhere; they live only in `Layout.jsx`'s bell after Task 7.)

- [ ] **Step 2: Shrink `TABS`**

Find:

```jsx
const TABS = [
  { key: 'perfil', labelKey: 'profile.tab_profile' },
  { key: 'amigos', labelKey: 'profile.tab_friends' },
  { key: 'convites', labelKey: 'profile.tab_invites' },
  { key: 'historico', labelKey: 'profile.tab_history' },
]
```

Replace with:

```jsx
const TABS = [
  { key: 'perfil', labelKey: 'profile.tab_profile' },
  { key: 'historico', labelKey: 'profile.tab_history' },
]
```

- [ ] **Step 3: Add `isPrivate` state and follow-count state, drop dead state**

Find:

```jsx
  const [activityVisibility, setActivityVisibility] = useState(profile?.activity_visibility || 'public')
  const [resultsVisibility, setResultsVisibility] = useState(profile?.results_visibility || 'public')
  const [clubsVisibility, setClubsVisibility] = useState(profile?.clubs_visibility || 'public')
```

Replace with:

```jsx
  const [activityVisibility, setActivityVisibility] = useState(profile?.activity_visibility || 'public')
  const [resultsVisibility, setResultsVisibility] = useState(profile?.results_visibility || 'public')
  const [clubsVisibility, setClubsVisibility] = useState(profile?.clubs_visibility || 'public')
  const [isPrivate, setIsPrivate] = useState(profile?.is_private || false)
```

Find:

```jsx
  const [friendRequests, setFriendRequests] = useState([])
  const [friendRequestActing, setFriendRequestActing] = useState(null)
  const [outgoingRequests, setOutgoingRequests] = useState([])
  const [outgoingRequestActing, setOutgoingRequestActing] = useState(null)
  const [friends, setFriends] = useState([])
  const [friendsLoading, setFriendsLoading] = useState(true)
  const [orgInvites, setOrgInvites] = useState([])
  const [orgInvitesLoading, setOrgInvitesLoading] = useState(true)
  const [orgInviteActing, setOrgInviteActing] = useState(null)
```

Replace with:

```jsx
  const [followCounts, setFollowCounts] = useState({ followers_count: 0, following_count: 0 })
  const [followListTab, setFollowListTab] = useState(null) // null = closed, else 'followers'|'following'
```

- [ ] **Step 4: Update the profile-loaded `useEffect` — swap loaders**

Find:

```jsx
      if (!isGuest) {
        loadPrivateMatchHistory()
        loadGlobalPoints()
        loadFriendRequests()
        loadOutgoingRequests()
        loadFriends()
        loadOrgInvites()
        loadKudos()
        loadTrophies()
      }
```

Replace with:

```jsx
      if (!isGuest) {
        loadPrivateMatchHistory()
        loadGlobalPoints()
        loadFollowCounts()
        loadKudos()
        loadTrophies()
      }
```

- [ ] **Step 5: Replace the friend/invite loaders and handlers with `loadFollowCounts`**

Find (this whole block, from `loadFriendRequests` through `handleDeclineOrgInvite` — every function this block defines is dead once Step 4 stops calling them and Step 8 removes the tabs that rendered their results):

```jsx
  const loadFriendRequests = async () => {
    try {
      setFriendRequests(await listIncomingFriendRequests())
    } catch (error) {
      console.error('Error loading friend requests:', error)
    }
  }

  const loadOutgoingRequests = async () => {
    try {
      setOutgoingRequests(await listOutgoingFriendRequests())
    } catch (error) {
      console.error('Error loading outgoing friend requests:', error)
    }
  }

  const handleCancelOutgoingRequest = async (requestId) => {
    setOutgoingRequestActing(requestId)
    try {
      await removeFriendRequest(requestId)
      setOutgoingRequests((reqs) => reqs.filter((r) => r.id !== requestId))
    } catch (error) {
      console.error('Error cancelling friend request:', error)
      alert(t('profile.error_cancel_friend_request'))
    } finally {
      setOutgoingRequestActing(null)
    }
  }

  const loadFriends = async () => {
    setFriendsLoading(true)
    try {
      setFriends(await listFriends())
    } catch (error) {
      console.error('Error loading friends:', error)
    } finally {
      setFriendsLoading(false)
    }
  }

  const handleAcceptFriendRequest = async (requestId) => {
    setFriendRequestActing(requestId)
    try {
      await acceptFriendRequest(requestId)
      setFriendRequests((reqs) => reqs.filter((r) => r.id !== requestId))
      loadFriends()
    } catch (error) {
      console.error('Error accepting friend request:', error)
      alert(t('profile.error_accept_friend_request'))
    } finally {
      setFriendRequestActing(null)
    }
  }

  const handleDeclineFriendRequest = async (requestId) => {
    setFriendRequestActing(requestId)
    try {
      await removeFriendRequest(requestId)
      setFriendRequests((reqs) => reqs.filter((r) => r.id !== requestId))
    } catch (error) {
      console.error('Error declining friend request:', error)
      alert(t('profile.error_decline_friend_request'))
    } finally {
      setFriendRequestActing(null)
    }
  }

  const loadOrgInvites = async () => {
    setOrgInvitesLoading(true)
    try {
      setOrgInvites(await listIncomingOrganizationInvites())
    } catch (error) {
      console.error('Error loading organization invites:', error)
    } finally {
      setOrgInvitesLoading(false)
    }
  }

  const handleAcceptOrgInvite = async (inviteId) => {
    setOrgInviteActing(inviteId)
    try {
      await acceptOrganizationInvite(inviteId)
      setOrgInvites((invs) => invs.filter((i) => i.id !== inviteId))
      await refreshMemberships()
    } catch (error) {
      console.error('Error accepting organization invite:', error)
      alert(t('profile.error_accept_org_invite'))
    } finally {
      setOrgInviteActing(null)
    }
  }

  const handleDeclineOrgInvite = async (inviteId) => {
    setOrgInviteActing(inviteId)
    try {
      await declineOrganizationInvite(inviteId)
      setOrgInvites((invs) => invs.filter((i) => i.id !== inviteId))
    } catch (error) {
      console.error('Error declining organization invite:', error)
      alert(t('profile.error_decline_org_invite'))
    } finally {
      setOrgInviteActing(null)
    }
  }
```

Replace with:

```jsx
  const loadFollowCounts = async () => {
    try {
      setFollowCounts(await getFollowCounts(profile.id))
    } catch (error) {
      console.error('Error loading follow counts:', error)
    }
  }
```

(`refreshMemberships` was only used by `handleAcceptOrgInvite` — leave the `useAuth()` destructure line untouched even though this one caller is gone; it's still exposed by the context for other consumers and removing it from the destructure is not required by this task.)

- [ ] **Step 6: Save `is_private` alongside the three visibility fields**

Find:

```jsx
      const updates = {
        name,
        preferred_side: preferredSide,
        nationality: nationality || null,
        birthday: birthday || null,
        gender,
        language,
        activity_visibility: activityVisibility,
        results_visibility: resultsVisibility,
        clubs_visibility: clubsVisibility,
      }
```

Replace with:

```jsx
      const updates = {
        name,
        preferred_side: preferredSide,
        nationality: nationality || null,
        birthday: birthday || null,
        gender,
        language,
        activity_visibility: activityVisibility,
        results_visibility: resultsVisibility,
        clubs_visibility: clubsVisibility,
        is_private: isPrivate,
      }
```

Find (the cancel-edit reset handler):

```jsx
                  onClick={() => {
                    setEditing(false)
                    setName(profile.name)
                    setBirthday(profile.birthday || '')
                    setGender(profile.gender || '')
                    setLanguage(profile.language || 'pt')
                    setActivityVisibility(profile.activity_visibility || 'public')
                    setResultsVisibility(profile.results_visibility || 'public')
                    setClubsVisibility(profile.clubs_visibility || 'public')
                    setPhone('')
                    setPhoneError('')
                  }}
```

Replace with:

```jsx
                  onClick={() => {
                    setEditing(false)
                    setName(profile.name)
                    setBirthday(profile.birthday || '')
                    setGender(profile.gender || '')
                    setLanguage(profile.language || 'pt')
                    setActivityVisibility(profile.activity_visibility || 'public')
                    setResultsVisibility(profile.results_visibility || 'public')
                    setClubsVisibility(profile.clubs_visibility || 'public')
                    setIsPrivate(profile.is_private || false)
                    setPhone('')
                    setPhoneError('')
                  }}
```

- [ ] **Step 7: Add the privacy toggle to the edit form**

Find:

```jsx
              <div className="pt-2 border-t border-line">
                <h4 className="text-sm font-extrabold text-ink-900 mt-4 mb-1">{t('profile.privacy_heading')}</h4>
                <p className="text-xs text-muted mb-3">
                  {t('profile.privacy_description')}
                </p>
                <div className="space-y-3">
                  <div>
                    <label className={inputLabel}>{t('profile.visibility_activity_label')}</label>
```

Replace with:

```jsx
              <div className="pt-2 border-t border-line">
                <h4 className="text-sm font-extrabold text-ink-900 mt-4 mb-1">{t('profile.privacy_heading')}</h4>
                <p className="text-xs text-muted mb-3">
                  {t('profile.privacy_description')}
                </p>
                <div className="mb-4">
                  <label className="flex items-center justify-between gap-3">
                    <span>
                      <span className={inputLabel}>{t('profile.privacy_is_private_label')}</span>
                      <span className="block text-xs text-muted -mt-1">{t('profile.privacy_is_private_hint')}</span>
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isPrivate}
                      onClick={() => setIsPrivate((v) => !v)}
                      className={`shrink-0 w-11 h-6 rounded-full transition-colors duration-fast relative ${isPrivate ? 'bg-lime-400' : 'bg-ink-200'}`}
                    >
                      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform duration-fast ${isPrivate ? 'translate-x-5' : 'translate-x-0.5'}`} />
                    </button>
                  </label>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className={inputLabel}>{t('profile.visibility_activity_label')}</label>
```

- [ ] **Step 8: Hero card — add tappable follower/following counts, and the modal**

Find (the end of the hero's `Jogos · % Vitórias · Títulos` row, followed by the XP panel comment — a unique anchor):

```jsx
          <div className="px-1">
            <p className="text-xl font-extrabold text-ink-900 tabular-nums leading-none">{stats?.mix_wins || 0}</p>
            <p className="mt-1 text-[11px] text-muted">{t('profile.card_titles')}</p>
          </div>
        </div>
      </div>

      {/* XP DE ATIVIDADE — painel separado, claro, sem iconografia de
```

Replace with:

```jsx
          <div className="px-1">
            <p className="text-xl font-extrabold text-ink-900 tabular-nums leading-none">{stats?.mix_wins || 0}</p>
            <p className="mt-1 text-[11px] text-muted">{t('profile.card_titles')}</p>
          </div>
        </div>

        {/* Seguidores/A seguir — tapável, abre o FollowListModal. Novo:
            o cartão do próprio perfil não mostrava nenhuma contagem até
            aqui (só o de PlayerDetails.jsx tinha friends_count). */}
        <div className="mt-3.5 pt-3.5 border-t border-line flex items-center justify-center gap-4 text-sm">
          <button type="button" onClick={() => setFollowListTab('followers')} className="font-extrabold text-ink-900">
            {followCounts.followers_count} <span className="font-normal text-muted">{t('profile.followers_count_other', { count: followCounts.followers_count })}</span>
          </button>
          <button type="button" onClick={() => setFollowListTab('following')} className="font-extrabold text-ink-900">
            {followCounts.following_count} <span className="font-normal text-muted">{t('profile.following_count')}</span>
          </button>
        </div>
      </div>

      {followListTab && (
        <FollowListModal userId={profile.id} initialTab={followListTab} onClose={() => setFollowListTab(null)} />
      )}

      {/* XP DE ATIVIDADE — painel separado, claro, sem iconografia de
```

- [ ] **Step 9: Remove the `amigos` and `convites` tab bodies**

Find (the entire `tab === 'amigos'` block through the entire `tab === 'convites'` block, up to but not including `tab === 'historico'`):

```jsx
      {tab === 'amigos' && (
        <>
        {/* Pedidos de amizade */}
        {friendRequests.length > 0 && (
          <div className="card space-y-3">
            <p className="text-sm font-extrabold text-ink-900">{t('profile.friend_requests_heading')}</p>
            {friendRequests.map((req) => (
              <div key={req.id} className="flex items-center gap-3">
                <Avatar name={req.requester_name} url={req.requester_avatar_url} size="w-10 h-10 text-sm" />
                <p className="flex-1 min-w-0 font-extrabold text-ink-900 text-sm truncate">{req.requester_name}</p>
                <button
                  onClick={() => handleAcceptFriendRequest(req.id)}
                  disabled={friendRequestActing === req.id}
                  aria-label={t('profile.accept_request_aria')}
                  className="w-9 h-9 shrink-0 rounded-full bg-lime-400 text-ink-900 flex items-center justify-center hover:bg-lime-600 transition-colors duration-fast disabled:opacity-40"
                >
                  <UserCheck size={16} />
                </button>
                <button
                  onClick={() => handleDeclineFriendRequest(req.id)}
                  disabled={friendRequestActing === req.id}
                  aria-label={t('profile.decline_request_aria')}
                  className="w-9 h-9 shrink-0 rounded-full bg-ink-50 text-ink-700 flex items-center justify-center hover:bg-ink-200 transition-colors duration-fast disabled:opacity-40"
                >
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Pedidos enviados — sent requests were previously invisible
            anywhere on the profile until the other person acted on them. */}
        {outgoingRequests.length > 0 && (
          <div className="card space-y-3">
            <p className="text-sm font-extrabold text-ink-900">{t('profile.sent_requests_heading')}</p>
            {outgoingRequests.map((req) => (
              <div key={req.id} className="flex items-center gap-3">
                <Avatar name={req.addressee_name} url={req.addressee_avatar_url} size="w-10 h-10 text-sm" />
                <p className="flex-1 min-w-0 font-extrabold text-ink-900 text-sm truncate">{req.addressee_name}</p>
                <span className="text-[11px] font-extrabold uppercase tracking-wide text-muted shrink-0">{t('profile.pending_badge')}</span>
                <button
                  onClick={() => handleCancelOutgoingRequest(req.id)}
                  disabled={outgoingRequestActing === req.id}
                  aria-label={t('profile.cancel_request_aria')}
                  className="w-9 h-9 shrink-0 rounded-full bg-ink-50 text-ink-700 flex items-center justify-center hover:bg-ink-200 transition-colors duration-fast disabled:opacity-40"
                >
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>
        )}

        {friendsLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-ink-50 border-t-ink-700"></div>
          </div>
        ) : friends.length === 0 ? (
          <EmptyState
            icon={Users}
            title={t('profile.no_friends_title')}
            subtitle={t('profile.no_friends_subtitle')}
          />
        ) : (
          <div className="card p-0 overflow-hidden divide-y divide-line">
            {friends.map((f) => (
              <Link
                key={f.id}
                to={`/jogador/${f.id}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors duration-fast hover:bg-ink-50"
              >
                <Avatar name={f.name} url={f.avatar_url} size="w-11 h-11 text-sm" />
                <p className="flex-1 min-w-0 font-extrabold text-ink-900 text-sm truncate">{f.name}</p>
              </Link>
            ))}
          </div>
        )}
        </>
      )}

      {tab === 'convites' && (
        orgInvitesLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-ink-50 border-t-ink-700"></div>
          </div>
        ) : orgInvites.length === 0 ? (
          <EmptyState
            icon={Users}
            title={t('profile.no_invites_title')}
            subtitle={t('profile.no_invites_subtitle')}
          />
        ) : (
          <div className="card space-y-3">
            {orgInvites.map((inv) => (
              <div key={inv.id} className="flex items-center gap-3">
                <Avatar name={inv.organization_name} url={inv.organization_logo_url} size="w-10 h-10 text-sm" />
                <div className="flex-1 min-w-0">
                  <p className="font-extrabold text-ink-900 text-sm truncate">{inv.organization_name}</p>
                  <p className="text-xs text-muted truncate">{t('profile.invited_by', { name: inv.invited_by_name })}</p>
                </div>
                <button
                  onClick={() => handleAcceptOrgInvite(inv.id)}
                  disabled={orgInviteActing === inv.id}
                  aria-label={t('profile.accept_invite_aria')}
                  className="w-9 h-9 shrink-0 rounded-full bg-lime-400 text-ink-900 flex items-center justify-center hover:bg-lime-600 transition-colors duration-fast disabled:opacity-40"
                >
                  <UserCheck size={16} />
                </button>
                <button
                  onClick={() => handleDeclineOrgInvite(inv.id)}
                  disabled={orgInviteActing === inv.id}
                  aria-label={t('profile.decline_invite_aria')}
                  className="w-9 h-9 shrink-0 rounded-full bg-ink-50 text-ink-700 flex items-center justify-center hover:bg-ink-200 transition-colors duration-fast disabled:opacity-40"
                >
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'historico' && (
```

Replace with just:

```jsx
      {tab === 'historico' && (
```

- [ ] **Step 10: Verify the build**

Run: `npm run build`
Expected: builds successfully — this also catches any now-unused import ESLint/build would flag (e.g. confirm `UserCheck` is still used elsewhere in the file before assuming it's safe to leave imported; if it's now unused, remove it from the `lucide-react` import line).

- [ ] **Step 11: Manual verification**

Same caveat as every migration-dependent task in this plan — needs Task 1's migration actually run. If confirmed live: open `/perfil`, confirm only "Perfil"/"Histórico" tabs show, confirm the new followers/following counts appear and open the modal, toggle "Conta privada" and save, confirm it persists on reload. If not live in this environment, verify by reading the diff instead — state clearly in the report which was done.

- [ ] **Step 12: Commit**

```bash
git add src/pages/Profile.jsx
git commit -m "feat: Profile.jsx follow counts + privacy toggle, remove amigos/convites tabs (Task 5)"
```

---

## Task 6: `PlayerDetails.jsx` — follow button (3 states), follow counts, mutual-follow gate

**Files:**
- Modify: `src/pages/PlayerDetails.jsx`

**Interfaces:**
- Consumes: `followPlayer`, `removeFollow` (Task 3), `FollowListModal` (Task 4), `get_player_profile`'s new `follow_status`/`follow_request_id`/`followers_count`/`following_count`/`is_mutual_follow` columns (Task 1).
- Produces: the follow button and `isHidden()` gate other pages/tests don't depend on — this is a leaf consumer.

- [ ] **Step 1: Update imports**

Find:

```jsx
import { sendFriendRequest, acceptFriendRequest, removeFriendRequest } from '../lib/friends'
```

Replace with:

```jsx
import { followPlayer, removeFollow } from '../lib/follows'
```

Find:

```jsx
import { PrimaryButton, EmptyState, Avatar, RatingBadge, PhotoViewerModal, AchievementCard } from '../components/ui'
```

Replace with:

```jsx
import { PrimaryButton, EmptyState, Avatar, RatingBadge, PhotoViewerModal, FollowListModal, AchievementCard } from '../components/ui'
```

- [ ] **Step 2: Add follow-list modal state**

Find:

```jsx
  const [friendActing, setFriendActing] = useState(false)
  const [showPhoto, setShowPhoto] = useState(false)
```

Replace with:

```jsx
  const [friendActing, setFriendActing] = useState(false)
  const [showPhoto, setShowPhoto] = useState(false)
  const [followListTab, setFollowListTab] = useState(null) // null = closed, else 'followers'|'following'
```

- [ ] **Step 3: Replace the three friend handlers with follow/unfollow, drop the accept handler**

Find:

```jsx
  // Patches local state instead of calling loadPlayer() — that sets
  // loading=true, which the top-level render guard turns into replacing
  // the whole page with a spinner just to flip one button.
  const handleSendRequest = async () => {
    setFriendActing(true)
    try {
      const status = await sendFriendRequest(id)
      setPlayer((p) => ({
        ...p,
        friendship_status: status === 'accepted' ? 'friends' : 'pending_sent',
        friends_count: status === 'accepted' ? (p.friends_count ?? 0) + 1 : p.friends_count,
      }))
    } catch (error) {
      console.error('Error sending friend request:', error)
      alert(t('playerdetails.friend_request_failed'))
    } finally {
      setFriendActing(false)
    }
  }

  const handleAcceptRequest = async () => {
    setFriendActing(true)
    try {
      await acceptFriendRequest(player.friendship_request_id)
      setPlayer((p) => ({ ...p, friendship_status: 'friends', friends_count: (p.friends_count ?? 0) + 1 }))
    } catch (error) {
      console.error('Error accepting friend request:', error)
      alert(t('playerdetails.accept_request_failed'))
    } finally {
      setFriendActing(false)
    }
  }

  const handleRemoveFriendship = async (confirmMessage) => {
    if (!confirm(confirmMessage)) return
    setFriendActing(true)
    try {
      await removeFriendRequest(player.friendship_request_id)
      setPlayer((p) => ({
        ...p,
        friendship_status: 'none',
        friendship_request_id: null,
        friends_count: p.friendship_status === 'friends' ? Math.max(0, (p.friends_count ?? 0) - 1) : p.friends_count,
      }))
    } catch (error) {
      console.error('Error removing friend request:', error)
      alert(t('playerdetails.update_failed'))
    } finally {
      setFriendActing(false)
    }
  }
```

Replace with:

```jsx
  // Patches local state instead of calling loadPlayer() — that sets
  // loading=true, which the top-level render guard turns into replacing
  // the whole page with a spinner just to flip one button.
  const handleFollow = async () => {
    setFriendActing(true)
    try {
      const status = await followPlayer(id)
      setPlayer((p) => ({
        ...p,
        follow_status: status === 'accepted' ? 'following' : 'pending',
        followers_count: status === 'accepted' ? (p.followers_count ?? 0) + 1 : p.followers_count,
      }))
    } catch (error) {
      console.error('Error following player:', error)
      alert(t('playerdetails.friend_request_failed'))
    } finally {
      setFriendActing(false)
    }
  }

  // Covers both unfollowing an accepted follow and cancelling your own
  // pending request — same row (player.follow_request_id) either way,
  // see get_player_profile's doc comment on that column.
  const handleRemoveFollow = async (confirmMessage) => {
    if (confirmMessage && !confirm(confirmMessage)) return
    setFriendActing(true)
    try {
      await removeFollow(player.follow_request_id)
      setPlayer((p) => ({
        ...p,
        follow_status: 'none',
        follow_request_id: null,
        followers_count: p.follow_status === 'following' ? Math.max(0, (p.followers_count ?? 0) - 1) : p.followers_count,
      }))
    } catch (error) {
      console.error('Error removing follow:', error)
      alert(t('playerdetails.update_failed'))
    } finally {
      setFriendActing(false)
    }
  }
```

- [ ] **Step 4: Update `isHidden()`**

Find:

```jsx
  // activity/clubs are never nulled for the owner, so this only ever fires
  // for someone else's profile — matches the same can_view_section rule
  // the backend enforces (public always visible; friends only if the
  // backend's own friendship_status says 'friends'; private never).
  const isHidden = (visibility) =>
    !player.my_profile && (visibility === 'private' || (visibility === 'friends' && player.friendship_status !== 'friends'))
```

Replace with:

```jsx
  // activity/clubs are never nulled for the owner, so this only ever fires
  // for someone else's profile — matches the same can_view_section rule
  // the backend enforces (public always visible; friends only if the
  // backend's own is_mutual_follow says true; private never).
  const isHidden = (visibility) =>
    !player.my_profile && (visibility === 'private' || (visibility === 'friends' && !player.is_mutual_follow))
```

- [ ] **Step 5: Follower/following count line — make it tappable, add the modal**

Find:

```jsx
            <p className="text-xs text-muted mt-0.5">
              {t('playerdetails.friends_count', { count: player.friends_count })}
            </p>
```

Replace with:

```jsx
            <p className="text-xs text-muted mt-0.5 flex gap-3">
              <button type="button" onClick={() => setFollowListTab('followers')} className="hover:text-ink-700">
                {t('playerdetails.followers_count', { count: player.followers_count })}
              </button>
              <button type="button" onClick={() => setFollowListTab('following')} className="hover:text-ink-700">
                {t('playerdetails.following_count', { count: player.following_count })}
              </button>
            </p>
```

Find (right after the closing `</div>` of the hero's top `flex items-start gap-4` row, before the `#globalRank` block — using the `{showPhoto && ...}` block as the unique anchor just above it):

```jsx
          {showPhoto && (
            <PhotoViewerModal url={player.avatar_url} alt={player.name} onClose={() => setShowPhoto(false)} />
          )}
```

Replace with:

```jsx
          {showPhoto && (
            <PhotoViewerModal url={player.avatar_url} alt={player.name} onClose={() => setShowPhoto(false)} />
          )}
          {followListTab && (
            <FollowListModal userId={player.id} initialTab={followListTab} onClose={() => setFollowListTab(null)} />
          )}
```

- [ ] **Step 6: Replace the 4-state follow button with the 3-state one**

Find:

```jsx
        {!player.my_profile && (
          <div className="mt-3">
            {player.friendship_status === 'friends' ? (
              <button
                onClick={() => handleRemoveFriendship(t('playerdetails.unfollow_confirm', { name: player.name }))}
                disabled={friendActing}
                className="inline-flex items-center gap-1.5 text-xs font-extrabold px-3.5 py-2 min-h-[36px] rounded-full bg-ink-50 text-ink-900 hover:bg-ink-200/60 transition-colors duration-fast disabled:opacity-40"
              >
                <UserCheck size={14} /> {t('playerdetails.unfollow_button')}
              </button>
            ) : player.friendship_status === 'pending_sent' ? (
              <button
                onClick={() => handleRemoveFriendship(t('playerdetails.cancel_request_confirm'))}
                disabled={friendActing}
                className="inline-flex items-center gap-1.5 text-xs font-extrabold px-3.5 py-2 min-h-[36px] rounded-full bg-ink-50 text-muted hover:bg-ink-200/60 transition-colors duration-fast disabled:opacity-40"
              >
                <Clock size={14} /> {t('playerdetails.request_sent')}
              </button>
            ) : player.friendship_status === 'pending_received' ? (
              <button
                onClick={handleAcceptRequest}
                disabled={friendActing}
                className="inline-flex items-center gap-1.5 text-xs font-extrabold px-3.5 py-2 min-h-[36px] rounded-full bg-lime-400 text-ink-900 hover:bg-lime-600 transition-colors duration-fast disabled:opacity-40"
              >
                <UserCheck size={14} /> {t('playerdetails.accept_request')}
              </button>
            ) : (
              <button
                onClick={handleSendRequest}
                disabled={friendActing}
                className="inline-flex items-center gap-1.5 text-xs font-extrabold px-3.5 py-2 min-h-[36px] rounded-full bg-lime-400 text-ink-900 hover:bg-lime-600 transition-colors duration-fast disabled:opacity-40"
              >
                <UserPlus size={14} /> {t('playerdetails.add_friend')}
              </button>
            )}
          </div>
        )}
```

Replace with:

```jsx
        {!player.my_profile && (
          <div className="mt-3">
            {player.follow_status === 'following' ? (
              <button
                onClick={() => handleRemoveFollow(t('playerdetails.unfollow_confirm', { name: player.name }))}
                disabled={friendActing}
                className="inline-flex items-center gap-1.5 text-xs font-extrabold px-3.5 py-2 min-h-[36px] rounded-full bg-ink-50 text-ink-900 hover:bg-ink-200/60 transition-colors duration-fast disabled:opacity-40"
              >
                <UserCheck size={14} /> {t('playerdetails.following_button')}
              </button>
            ) : player.follow_status === 'pending' ? (
              <button
                onClick={() => handleRemoveFollow()}
                disabled={friendActing}
                className="inline-flex items-center gap-1.5 text-xs font-extrabold px-3.5 py-2 min-h-[36px] rounded-full bg-ink-50 text-muted hover:bg-ink-200/60 transition-colors duration-fast disabled:opacity-40"
              >
                <Clock size={14} /> {t('playerdetails.requested_button')}
              </button>
            ) : (
              <button
                onClick={handleFollow}
                disabled={friendActing}
                className="inline-flex items-center gap-1.5 text-xs font-extrabold px-3.5 py-2 min-h-[36px] rounded-full bg-lime-400 text-ink-900 hover:bg-lime-600 transition-colors duration-fast disabled:opacity-40"
              >
                <UserPlus size={14} /> {t('playerdetails.follow_button')}
              </button>
            )}
          </div>
        )}
```

Cancelling a pending request (the middle branch) intentionally passes no `confirmMessage` to `handleRemoveFollow` — cancelling your own not-yet-accepted request isn't the destructive action unfollowing an established connection is (see Global Constraints).

- [ ] **Step 7: Verify the build**

Run: `npm run build`
Expected: builds successfully.

- [ ] **Step 8: Manual verification**

Same migration-dependent caveat as Task 5. If live: visit another player's `/jogador/:id`, confirm the button shows "Seguir," click it, confirm it flips to "A seguir" (public target) or "Pedido enviado" (private target), confirm the followers/following counts are tappable and open the modal, confirm a `friends`-visibility section unlocks once both directions are followed. If not live, verify by reading the diff — state which was done.

- [ ] **Step 9: Commit**

```bash
git add src/pages/PlayerDetails.jsx
git commit -m "feat: PlayerDetails.jsx follow button (3 states) + follow counts (Task 6)"
```

---

## Task 7: `Layout.jsx` bell — inline accept/decline for follow requests and org invites

**Files:**
- Modify: `src/components/Layout.jsx`

**Interfaces:**
- Consumes: `listIncomingFollowRequests`, `acceptFollowRequest`, `removeFollow` (Task 3).
- Produces: the bell dropdown's follow-request and org-invite rows become self-contained (accept/decline inline, no navigation).

- [ ] **Step 1: Update imports**

Find:

```jsx
import { listIncomingFriendRequests } from '../lib/friends'
import { listPendingMembershipRequestsForAdmin } from '../lib/organizations'
import { listIncomingOrganizationInvites } from '../lib/orgInvites'
```

Replace with:

```jsx
import { listIncomingFollowRequests, acceptFollowRequest, removeFollow } from '../lib/follows'
import { listPendingMembershipRequestsForAdmin } from '../lib/organizations'
import { listIncomingOrganizationInvites, acceptOrganizationInvite, declineOrganizationInvite } from '../lib/orgInvites'
```

(`acceptOrganizationInvite`/`declineOrganizationInvite` are new imports here — the bell needs them now that its org-invite row is inline instead of a link, per Step 4 below. `Users`/`Bell`/etc. icon imports are unchanged — `UserCheck`/`X` aren't currently imported in this file; add them alongside the existing `lucide-react` import in the next step.)

Find:

```jsx
import { Home, Users, Trophy, Settings, LogOut, HelpCircle, Phone, X, Bell } from 'lucide-react'
```

Replace with:

```jsx
import { Home, Users, Trophy, Settings, LogOut, HelpCircle, Phone, X, Bell, UserCheck } from 'lucide-react'
```

- [ ] **Step 2: Swap `friendRequests` state to follow requests, add acting state for both new inline actions**

Find:

```jsx
  const [friendRequests, setFriendRequests] = useState([])
  const [showNotifications, setShowNotifications] = useState(false)
  useEffect(() => {
    if (!profile?.id || isGuest) {
      setFriendRequests([])
      return
    }
    let cancelled = false
    listIncomingFriendRequests()
      .then((data) => {
        if (!cancelled) setFriendRequests(data)
      })
      .catch((error) => console.error('Error loading friend requests:', error))
    return () => {
      cancelled = true
    }
  }, [profile?.id, isGuest, location.pathname])
```

Replace with:

```jsx
  const [followRequests, setFollowRequests] = useState([])
  const [followRequestActing, setFollowRequestActing] = useState(null)
  const [showNotifications, setShowNotifications] = useState(false)
  useEffect(() => {
    if (!profile?.id || isGuest) {
      setFollowRequests([])
      return
    }
    let cancelled = false
    listIncomingFollowRequests()
      .then((data) => {
        if (!cancelled) setFollowRequests(data)
      })
      .catch((error) => console.error('Error loading follow requests:', error))
    return () => {
      cancelled = true
    }
  }, [profile?.id, isGuest, location.pathname])

  const handleAcceptFollowRequest = async (requestId) => {
    setFollowRequestActing(requestId)
    try {
      await acceptFollowRequest(requestId)
      setFollowRequests((reqs) => reqs.filter((r) => r.id !== requestId))
    } catch (error) {
      console.error('Error accepting follow request:', error)
    } finally {
      setFollowRequestActing(null)
    }
  }

  const handleDeclineFollowRequest = async (requestId) => {
    setFollowRequestActing(requestId)
    try {
      await removeFollow(requestId)
      setFollowRequests((reqs) => reqs.filter((r) => r.id !== requestId))
    } catch (error) {
      console.error('Error declining follow request:', error)
    } finally {
      setFollowRequestActing(null)
    }
  }
```

- [ ] **Step 3: Add inline accept/decline handlers for org invites, and acting state**

Find:

```jsx
  // Same refetch-on-route-change pattern as friendRequests above.
  const [orgInvites, setOrgInvites] = useState([])
  useEffect(() => {
    if (!profile?.id || isGuest) {
      setOrgInvites([])
      return
    }
    let cancelled = false
    listIncomingOrganizationInvites()
      .then((data) => {
        if (!cancelled) setOrgInvites(data)
      })
      .catch((error) => console.error('Error loading organization invites:', error))
    return () => {
      cancelled = true
    }
  }, [profile?.id, isGuest, location.pathname])
```

Replace with:

```jsx
  // Same refetch-on-route-change pattern as followRequests above.
  const [orgInvites, setOrgInvites] = useState([])
  const [orgInviteActing, setOrgInviteActing] = useState(null)
  useEffect(() => {
    if (!profile?.id || isGuest) {
      setOrgInvites([])
      return
    }
    let cancelled = false
    listIncomingOrganizationInvites()
      .then((data) => {
        if (!cancelled) setOrgInvites(data)
      })
      .catch((error) => console.error('Error loading organization invites:', error))
    return () => {
      cancelled = true
    }
  }, [profile?.id, isGuest, location.pathname])

  const handleAcceptOrgInvite = async (inviteId) => {
    setOrgInviteActing(inviteId)
    try {
      await acceptOrganizationInvite(inviteId)
      setOrgInvites((invs) => invs.filter((i) => i.id !== inviteId))
      await refreshMemberships()
    } catch (error) {
      console.error('Error accepting organization invite:', error)
    } finally {
      setOrgInviteActing(null)
    }
  }

  const handleDeclineOrgInvite = async (inviteId) => {
    setOrgInviteActing(inviteId)
    try {
      await declineOrganizationInvite(inviteId)
      setOrgInvites((invs) => invs.filter((i) => i.id !== inviteId))
    } catch (error) {
      console.error('Error declining organization invite:', error)
    } finally {
      setOrgInviteActing(null)
    }
  }
```

`refreshMemberships` needs to be in scope for `handleAcceptOrgInvite` above (`AuthContext` already exposes it — `Profile.jsx` already destructures it today) but this file's `useAuth()` call doesn't pull it in yet. Find:

```jsx
  const { signOut, profile, updateProfile, isAdminOfAny, isGuest } = useAuth()
```

Replace with:

```jsx
  const { signOut, profile, updateProfile, isAdminOfAny, isGuest, refreshMemberships } = useAuth()
```

- [ ] **Step 4: Fix the `notificationsTotal` sum**

Find:

```jsx
  const joinRequestsTotal = joinRequestsByOrg.reduce((sum, org) => sum + org.count, 0)
  const notificationsTotal = friendRequests.length + joinRequestsTotal + orgInvites.length
```

Replace with:

```jsx
  const joinRequestsTotal = joinRequestsByOrg.reduce((sum, org) => sum + org.count, 0)
  const notificationsTotal = followRequests.length + joinRequestsTotal + orgInvites.length
```

- [ ] **Step 5: Rewrite the dropdown body — drop the dead CTA, inline both row types**

Find:

```jsx
                    {notificationsTotal === 0 ? (
                      <div className="p-4 text-center">
                        <p className="text-sm text-muted mb-3">{t('layout.no_new_notifications')}</p>
                        <Link
                          to="/perfil?tab=amigos"
                          onClick={() => setShowNotifications(false)}
                          className="inline-flex items-center gap-1.5 text-xs font-extrabold px-3.5 py-2 rounded-full bg-ink-50 text-ink-700 hover:bg-ink-200 transition-colors duration-fast"
                        >
                          {t('layout.view_friends')}
                        </Link>
                      </div>
                    ) : (
                      <div className="max-h-80 overflow-y-auto divide-y divide-line">
                        {joinRequestsByOrg.map((org) => (
                          <Link
                            key={org.organizationId}
                            to={org.slug ? `/gerir/${org.slug}?tab=members` : '/gerir'}
                            onClick={() => setShowNotifications(false)}
                            className="flex items-center gap-3 px-4 py-3 transition-colors duration-fast hover:bg-ink-50"
                          >
                            <div className="w-9 h-9 rounded-full bg-ink-50 text-ink-700 flex items-center justify-center shrink-0">
                              <Users size={16} />
                            </div>
                            <p className="flex-1 min-w-0 text-sm text-ink-900">
                              {t('layout.join_request_count', { count: org.count })}{' '}
                              <span className="font-extrabold">{org.name}</span>
                            </p>
                            <span aria-hidden="true" className="w-2 h-2 rounded-full bg-lime-400 shrink-0" />
                          </Link>
                        ))}
                        {orgInvites.map((inv) => (
                          <Link
                            key={inv.id}
                            to="/perfil?tab=convites"
                            onClick={() => setShowNotifications(false)}
                            className="flex items-center gap-3 px-4 py-3 transition-colors duration-fast hover:bg-ink-50"
                          >
                            <Avatar name={inv.organization_name} url={inv.organization_logo_url} size="w-9 h-9 text-sm" />
                            <p className="flex-1 min-w-0 text-sm text-ink-900">
                              {t('layout.invited_to_join')} <span className="font-extrabold">{inv.organization_name}</span>
                            </p>
                            <span aria-hidden="true" className="w-2 h-2 rounded-full bg-lime-400 shrink-0" />
                          </Link>
                        ))}
                        {friendRequests.map((req) => (
                          <Link
                            key={req.id}
                            to="/perfil?tab=amigos"
                            onClick={() => setShowNotifications(false)}
                            className="flex items-center gap-3 px-4 py-3 transition-colors duration-fast hover:bg-ink-50"
                          >
                            <Avatar name={req.requester_name} url={req.requester_avatar_url} size="w-9 h-9 text-sm" />
                            <p className="flex-1 min-w-0 text-sm text-ink-900">
                              <span className="font-extrabold">{req.requester_name}</span> {t('layout.wants_to_be_friends')}
                            </p>
                            <span aria-hidden="true" className="w-2 h-2 rounded-full bg-lime-400 shrink-0" />
                          </Link>
                        ))}
                      </div>
                    )}
```

Replace with:

```jsx
                    {notificationsTotal === 0 ? (
                      <div className="p-4 text-center">
                        <p className="text-sm text-muted">{t('layout.no_new_notifications')}</p>
                      </div>
                    ) : (
                      <div className="max-h-80 overflow-y-auto divide-y divide-line">
                        {joinRequestsByOrg.map((org) => (
                          <Link
                            key={org.organizationId}
                            to={org.slug ? `/gerir/${org.slug}?tab=members` : '/gerir'}
                            onClick={() => setShowNotifications(false)}
                            className="flex items-center gap-3 px-4 py-3 transition-colors duration-fast hover:bg-ink-50"
                          >
                            <div className="w-9 h-9 rounded-full bg-ink-50 text-ink-700 flex items-center justify-center shrink-0">
                              <Users size={16} />
                            </div>
                            <p className="flex-1 min-w-0 text-sm text-ink-900">
                              {t('layout.join_request_count', { count: org.count })}{' '}
                              <span className="font-extrabold">{org.name}</span>
                            </p>
                            <span aria-hidden="true" className="w-2 h-2 rounded-full bg-lime-400 shrink-0" />
                          </Link>
                        ))}
                        {orgInvites.map((inv) => (
                          <div key={inv.id} className="flex items-center gap-3 px-4 py-3">
                            <Avatar name={inv.organization_name} url={inv.organization_logo_url} size="w-9 h-9 text-sm" />
                            <p className="flex-1 min-w-0 text-sm text-ink-900">
                              {t('layout.invited_to_join')} <span className="font-extrabold">{inv.organization_name}</span>
                            </p>
                            <button
                              onClick={() => handleAcceptOrgInvite(inv.id)}
                              disabled={orgInviteActing === inv.id}
                              aria-label={t('layout.accept_invite_aria')}
                              className="w-8 h-8 shrink-0 rounded-full bg-lime-400 text-ink-900 flex items-center justify-center hover:bg-lime-600 transition-colors duration-fast disabled:opacity-40"
                            >
                              <UserCheck size={14} />
                            </button>
                            <button
                              onClick={() => handleDeclineOrgInvite(inv.id)}
                              disabled={orgInviteActing === inv.id}
                              aria-label={t('layout.decline_invite_aria')}
                              className="w-8 h-8 shrink-0 rounded-full bg-ink-50 text-ink-700 flex items-center justify-center hover:bg-ink-200 transition-colors duration-fast disabled:opacity-40"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ))}
                        {followRequests.map((req) => (
                          <div key={req.id} className="flex items-center gap-3 px-4 py-3">
                            <Avatar name={req.follower_name} url={req.follower_avatar_url} size="w-9 h-9 text-sm" />
                            <p className="flex-1 min-w-0 text-sm text-ink-900">
                              <span className="font-extrabold">{req.follower_name}</span> {t('layout.follow_wants_to_follow')}
                            </p>
                            <button
                              onClick={() => handleAcceptFollowRequest(req.id)}
                              disabled={followRequestActing === req.id}
                              aria-label={t('layout.accept_follow_aria')}
                              className="w-8 h-8 shrink-0 rounded-full bg-lime-400 text-ink-900 flex items-center justify-center hover:bg-lime-600 transition-colors duration-fast disabled:opacity-40"
                            >
                              <UserCheck size={14} />
                            </button>
                            <button
                              onClick={() => handleDeclineFollowRequest(req.id)}
                              disabled={followRequestActing === req.id}
                              aria-label={t('layout.decline_follow_aria')}
                              className="w-8 h-8 shrink-0 rounded-full bg-ink-50 text-ink-700 flex items-center justify-center hover:bg-ink-200 transition-colors duration-fast disabled:opacity-40"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
```

- [ ] **Step 6: Verify the build**

Run: `npm run build`
Expected: builds successfully.

- [ ] **Step 7: Manual verification**

Same migration-dependent caveat. If live: from a second test account, send a follow request to a private test account; confirm it shows in the first account's bell with inline accept/decline that work without navigating away; confirm an org invite row behaves the same way. If not live, verify by reading the diff — state which was done.

- [ ] **Step 8: Commit**

```bash
git add src/components/Layout.jsx
git commit -m "feat: Layout.jsx bell — inline accept/decline for follow requests + org invites (Task 7)"
```

---

## Task 8: `Home.jsx` — mix-card "friend playing" badge switches to one-directional following

**Files:**
- Modify: `src/pages/Home.jsx`

**Interfaces:**
- Consumes: `listFollowing` (Task 3).
- Produces: `friendIds` (prop name unchanged — still a `Set` of ids, `MixCard`/`src/components/ui.jsx` needs no change) now sourced from one-directional following instead of mutual friendship. Confirmed with the human as the intended semantic (lower bar, matches the rest of this feature).

- [ ] **Step 1: Update the import**

Find:

```jsx
import { listFriends } from '../lib/friends'
```

Replace with:

```jsx
import { listFollowing } from '../lib/follows'
```

- [ ] **Step 2: Swap the RPC call, pass the viewer's own id**

Find:

```jsx
  useEffect(() => {
    if (!user) return
    let cancelled = false
    listFriends()
      .then((friends) => {
        if (!cancelled) setFriendIds(new Set(friends.map((f) => f.id)))
      })
      .catch((error) => {
        // Falhar aqui só custa o destaque de amigos nos cartões, por isso
        // fica no console e não chega ao ecrã — não vale partir a lista de
        // mixs por causa de um adorno.
        console.error('Error loading friends for mix cards:', error)
      })
    return () => { cancelled = true }
  }, [user])
```

Replace with:

```jsx
  useEffect(() => {
    if (!user) return
    let cancelled = false
    listFollowing(user.id)
      .then((following) => {
        if (!cancelled) setFriendIds(new Set(following.map((f) => f.id)))
      })
      .catch((error) => {
        // Falhar aqui só custa o destaque nos cartões, por isso fica no
        // console e não chega ao ecrã — não vale partir a lista de mixs
        // por causa de um adorno.
        console.error('Error loading following list for mix cards:', error)
      })
    return () => { cancelled = true }
  }, [user])
```

(`friendIds` the variable/state name, and the `MixCard` prop name, are left as-is — renaming them is cosmetic churn with no behavioral benefit and touches `src/components/ui.jsx`'s `MixCard` prop contract for no reason; only what populates the set changes.)

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: builds successfully.

- [ ] **Step 4: Manual verification**

Same migration-dependent caveat. If live: from account A, follow account B (one-directional, B doesn't follow back); confirm a mix B has joined shows the "friend" highlight on A's home screen despite the follow not being mutual. If not live, verify by reading the diff.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Home.jsx
git commit -m "feat: Home.jsx mix-card badge uses one-directional following (Task 8)"
```

---

## Task 9: Cleanup — delete `src/lib/friends.js`, full verification

**Files:**
- Delete: `src/lib/friends.js`

**Interfaces:**
- Consumes: nothing new — this task only runs once Tasks 5–8 have removed every import of `src/lib/friends.js` (`Profile.jsx`, `PlayerDetails.jsx`, `Layout.jsx`, `Home.jsx` — the four files `grep -r "lib/friends"` found at the start of this work).

- [ ] **Step 1: Confirm nothing still imports it**

Run: `grep -rn "lib/friends" src/` (or the project's equivalent search tool)
Expected: no matches. If any remain, that consumer was missed in Tasks 5–8 — fix it before deleting.

- [ ] **Step 2: Delete the file**

```bash
git rm src/lib/friends.js
```

- [ ] **Step 3: Full build + test verification**

Run: `npm run build`
Expected: builds successfully — a stray import anywhere would fail this.

Run: `npx vitest run`
Expected: PASS (this feature adds no new pure-logic test file, per this plan's Tech Stack note — this is a pure regression check that nothing else broke).

- [ ] **Step 4: Final manual verification pass**

If Task 1's migration is confirmed live in the test environment: walk the full flow end to end — public account instant follow, private account pending→accept, decline, cancel-my-own-pending, unfollow, mutual-follow unlocking a `friends`-visibility section on both `Profile.jsx`'s own view and `PlayerDetails.jsx`'s gated view, bell inline accept/decline for both row types, followers/following modal from both hero cards, `Home.jsx`'s mix-card badge. If not live, note explicitly in the report that this final pass is read-through-only pending the migration being run, and list exactly what a human should click through once it is.

- [ ] **Step 5: Commit**

`git rm` in Step 2 already stages the deletion — no separate `git add` needed.

```bash
git commit -m "chore: remove src/lib/friends.js, replaced by src/lib/follows.js (Task 9)"
```
