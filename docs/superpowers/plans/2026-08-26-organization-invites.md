# Organization Invites (search + link) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a club admin invite a specific app user to their club (search by name, invite requires acceptance) and share a link that joins someone directly on login/signup.

**Architecture:** A new `organization_invites` table + 3 SECURITY DEFINER RPCs (mirroring the existing `friend_requests` accept/decline pattern) power the search-invite flow. The invite-link flow reuses the `join_organization` RPC and `?org=<slug>` mechanism that already exists end-to-end — only a "copy link" button and one guard-condition fix are new there.

**Tech Stack:** React (Vite), Supabase (Postgres + RLS, SECURITY DEFINER RPCs), no ORM, no automated test runner.

**Spec:** `docs/superpowers/specs/2026-08-26-organization-invites-design.md`

## Global Constraints

- **No automated test suite in this repo** (no test runner in `package.json`, confirmed against README.md's dev instructions). "Test" steps below mean: `npx vite build --mode development` from the repo root to catch syntax/import errors, plus a manual QA pass in the browser using the dev-only "Entrar como Admin" login shortcut (`import.meta.env.DEV`-gated, see `src/pages/Login.jsx`) — never remove that gate.
- **SQL migrations are not live until run manually** in Supabase → SQL Editor. Every task that adds a `supabase/migration_*.sql` file must say so explicitly and must NOT be treated as "done" for behavioral purposes until it's confirmed run.
- **Reuse `is_org_admin(organization_id)`** for the admin check inside new RPCs — do not inline a fresh `EXISTS (SELECT 1 FROM memberships ...)` check (existing repo debt to not add to, per `CLAUDE.md`).
- **Portuguese (pt-PT) UI copy**, matching the existing tone in `GerirClube.jsx`/`Profile.jsx` (e.g. "Convidar jogador", "Convite enviado").
- Branch off `main`, not `dev`.

---

### Task 1: `organization_invites` table, RLS, and RPCs

**Files:**
- Create: `supabase/migration_organization_invites.sql`

**Interfaces:**
- Produces: table `organization_invites(id, organization_id, invited_user_id, invited_by, status, created_at)`; RPCs `invite_to_organization(p_organization_id UUID, p_user_id UUID) RETURNS TEXT`, `accept_organization_invite(p_invite_id UUID) RETURNS VOID`, `list_incoming_organization_invites() RETURNS TABLE(id UUID, organization_id UUID, organization_name TEXT, organization_logo_url TEXT, invited_by_name TEXT, created_at TIMESTAMPTZ)`.
- Consumes: existing `is_org_admin(UUID) RETURNS BOOLEAN` helper, existing `memberships`/`organizations`/`profiles` tables, `uuid_generate_v4()` (already used by `friend_requests`).

- [ ] **Step 1: Write the migration file**

```sql
-- ════════════════════════════════════════════════════════════════════════
-- Migration: organization_invites — admin-initiated club invites (search
-- in GerirClube.jsx → Membros). Same accept-required pattern as
-- friend_requests: no direct INSERT policy, sending goes through
-- invite_to_organization (SECURITY DEFINER), declining/cancelling is a
-- plain client-side DELETE covered by RLS.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE organization_invites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invited_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  invited_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
  UNIQUE (organization_id, invited_user_id)
);
ALTER TABLE organization_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Invitee or org admin can view invites"
  ON organization_invites FOR SELECT TO authenticated
  USING (auth.uid() = invited_user_id OR is_org_admin(organization_id));

CREATE POLICY "Invitee or org admin can delete invites"
  ON organization_invites FOR DELETE TO authenticated
  USING (auth.uid() = invited_user_id OR is_org_admin(organization_id));

-- invite_to_organization — admin-only, idempotent: resending to someone
-- already pending just returns 'pending'; re-inviting after a decline
-- reopens the same row (avoids a UNIQUE-constraint error on re-invite).
CREATE FUNCTION invite_to_organization(p_organization_id UUID, p_user_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_existing_status TEXT;
BEGIN
  IF NOT is_org_admin(p_organization_id) THEN
    RAISE EXCEPTION 'Apenas admins podem convidar membros';
  END IF;

  IF EXISTS (
    SELECT 1 FROM memberships
    WHERE organization_id = p_organization_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Este jogador já é membro do clube';
  END IF;

  SELECT status INTO v_existing_status
  FROM organization_invites
  WHERE organization_id = p_organization_id AND invited_user_id = p_user_id;

  IF v_existing_status = 'pending' THEN
    RETURN 'pending';
  END IF;

  IF v_existing_status IS NULL THEN
    INSERT INTO organization_invites (organization_id, invited_user_id, invited_by)
    VALUES (p_organization_id, p_user_id, auth.uid());
  ELSE
    UPDATE organization_invites
    SET status = 'pending', invited_by = auth.uid(), created_at = TIMEZONE('utc', NOW())
    WHERE organization_id = p_organization_id AND invited_user_id = p_user_id;
  END IF;

  RETURN 'pending';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION invite_to_organization(UUID, UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION invite_to_organization(UUID, UUID) TO authenticated;

-- accept_organization_invite — the invitee only, and only while pending.
CREATE FUNCTION accept_organization_invite(p_invite_id UUID)
RETURNS VOID AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT organization_id INTO v_org_id
  FROM organization_invites
  WHERE id = p_invite_id AND invited_user_id = auth.uid() AND status = 'pending';

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Convite não encontrado ou já resolvido';
  END IF;

  INSERT INTO memberships (user_id, organization_id)
  VALUES (auth.uid(), v_org_id)
  ON CONFLICT (user_id, organization_id) DO NOTHING;

  UPDATE organization_invites SET status = 'accepted' WHERE id = p_invite_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION accept_organization_invite(UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION accept_organization_invite(UUID) TO authenticated;

-- list_incoming_organization_invites — pending invites addressed to me,
-- for Perfil.jsx's "Convites" tab and the notifications bell.
CREATE FUNCTION list_incoming_organization_invites()
RETURNS TABLE (
  id UUID,
  organization_id UUID,
  organization_name TEXT,
  organization_logo_url TEXT,
  invited_by_name TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT oi.id, o.id, o.name, o.group_logo_url, p.name, oi.created_at
  FROM organization_invites oi
  JOIN organizations o ON o.id = oi.organization_id
  JOIN profiles p ON p.id = oi.invited_by
  WHERE oi.invited_user_id = auth.uid() AND oi.status = 'pending'
  ORDER BY oi.created_at DESC;
$$;

REVOKE ALL ON FUNCTION list_incoming_organization_invites() FROM public;
GRANT EXECUTE ON FUNCTION list_incoming_organization_invites() TO authenticated;
```

- [ ] **Step 2: Run the migration in Supabase**

Open Supabase → SQL Editor → New query, paste the whole file, Run. Confirm no errors.

- [ ] **Step 3: Smoke-test the RPCs directly in the SQL Editor**

As a real logged-in-equivalent test is only possible from the app (RPCs use `auth.uid()`), just confirm the objects exist:

```sql
SELECT proname FROM pg_proc WHERE proname IN
  ('invite_to_organization', 'accept_organization_invite', 'list_incoming_organization_invites');
```

Expected: 3 rows. Full behavioral verification happens in Tasks 3–4 once the UI can call these.

- [ ] **Step 4: Commit**

```bash
git add supabase/migration_organization_invites.sql
git commit -m "feat: add organization_invites table and invite/accept RPCs"
```

---

### Task 2: Client-side wrapper — `src/lib/orgInvites.js`

**Files:**
- Create: `src/lib/orgInvites.js`

**Interfaces:**
- Consumes: `supabase` client from `./supabase` (same import used by every other `src/lib/*.js` file, e.g. `src/lib/friends.js`); RPCs from Task 1.
- Produces: `inviteToOrganization(organizationId, userId) => Promise<string>` (returns the invite's status, `'pending'`), `acceptOrganizationInvite(inviteId) => Promise<void>`, `declineOrganizationInvite(inviteId) => Promise<void>`, `listIncomingOrganizationInvites() => Promise<Array<{id, organization_id, organization_name, organization_logo_url, invited_by_name, created_at}>>`. These four names are used verbatim by Tasks 3–5.

- [ ] **Step 1: Write the file**

```js
import { supabase } from './supabase'

export const inviteToOrganization = async (organizationId, userId) => {
  const { data, error } = await supabase.rpc('invite_to_organization', {
    p_organization_id: organizationId,
    p_user_id: userId,
  })
  if (error) throw error
  return data
}

export const acceptOrganizationInvite = async (inviteId) => {
  const { error } = await supabase.rpc('accept_organization_invite', { p_invite_id: inviteId })
  if (error) throw error
}

// Same DELETE-covers-both-cases trick as removeFriendRequest (src/lib/friends.js):
// RLS lets either the invitee or the org admin delete a row, so this one
// function covers both "decline" and "admin cancels a sent invite".
export const declineOrganizationInvite = async (inviteId) => {
  const { error } = await supabase.from('organization_invites').delete().eq('id', inviteId)
  if (error) throw error
}

export const listIncomingOrganizationInvites = async () => {
  const { data, error } = await supabase.rpc('list_incoming_organization_invites')
  if (error) throw error
  return data || []
}
```

- [ ] **Step 2: Verify it builds**

Run: `npx vite build --mode development`
Expected: succeeds (this file isn't imported anywhere yet, so this just checks syntax).

- [ ] **Step 3: Commit**

```bash
git add src/lib/orgInvites.js
git commit -m "feat: add client wrapper for organization invites"
```

---

### Task 3: GerirClube.jsx — invite card in the Membros tab

**Files:**
- Modify: `src/pages/GerirClube.jsx:3` (icon import), `:9` (component import — new import line), `:108` (state), `:322` (new handlers after `handleRejectRequest`), `:1521-1527` (new card before "Total de membros")

**Interfaces:**
- Consumes: `PlayerSearch` from `../components/PlayerSearch` (props: `label`, `searchFn`, `excludeIds`, `onSelect` — see `src/components/PlayerSearch.jsx`, already used the same way in `src/pages/Gerir.jsx`); `searchPlayers` from `../lib/privateMatches`; `inviteToOrganization` from `../lib/orgInvites` (Task 2); existing `org` (has `.id`, `.slug`) and `members` (array of `{id, name, ...}`) state already in this file.
- Produces: nothing consumed elsewhere.

- [ ] **Step 1: Add imports**

In `src/pages/GerirClube.jsx`, change line 3:

```js
import { Plus, Calendar, Users, Trash2, Edit2, Check, X, UserX, Repeat, Clock, ArrowLeft, Camera, Settings, Copy } from 'lucide-react'
```

Add two new import lines after line 11 (`import { groupGamesBySeries } from '../lib/recurrenceGrouping'`):

```js
import PlayerSearch from '../components/PlayerSearch'
import { searchPlayers } from '../lib/privateMatches'
import { inviteToOrganization } from '../lib/orgInvites'
```

- [ ] **Step 2: Add state**

Right after line 108 (`const [members, setMembers] = useState([])`), add:

```js
  const [linkCopied, setLinkCopied] = useState(false)
```

- [ ] **Step 3: Add handlers**

Right after the existing `handleRejectRequest` function (ends at line 331 with a closing `}`), add:

```js
  const handleInvitePlayer = async (player) => {
    try {
      const status = await inviteToOrganization(org.id, player.id)
      alert(status === 'pending' ? `Convite enviado a ${player.name}.` : `${player.name} já tinha um convite pendente.`)
    } catch (error) {
      console.error('Error inviting player:', error)
      alert(error.message?.includes('já é membro') ? `${player.name} já é membro deste clube.` : 'Não foi possível enviar o convite.')
    }
  }

  const handleCopyInviteLink = async () => {
    const link = `${window.location.origin}/login?org=${org.slug}`
    try {
      await navigator.clipboard.writeText(link)
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 2000)
    } catch (error) {
      console.error('Error copying invite link:', error)
      alert('Não foi possível copiar o link.')
    }
  }
```

- [ ] **Step 4: Add the invite card to the Membros tab**

Find (currently at line 1521-1527):

```jsx
          {activeTab === 'members' && (
            <div className="space-y-3">
              <div className="card bg-blue-50">
                <p className="text-gray-700">
                  <strong>Total de membros:</strong> {members.length}
                </p>
              </div>
```

Replace with:

```jsx
          {activeTab === 'members' && (
            <div className="space-y-3">
              <div className="card space-y-4">
                <div>
                  <h3 className="text-sm font-extrabold text-ink-900 mb-2">Convidar jogador</h3>
                  <PlayerSearch
                    label="Pesquisar por nome..."
                    searchFn={searchPlayers}
                    excludeIds={members.map((m) => m.id)}
                    onSelect={handleInvitePlayer}
                  />
                </div>
                <div className="pt-3 border-t border-line">
                  <button
                    type="button"
                    onClick={handleCopyInviteLink}
                    className="w-full flex items-center justify-center gap-2 text-sm font-extrabold px-4 py-2.5 rounded-ctrl bg-ink-50 text-ink-700 hover:bg-ink-200 transition-colors duration-fast"
                  >
                    <Copy size={16} />
                    {linkCopied ? 'Link copiado!' : 'Copiar link de convite'}
                  </button>
                </div>
              </div>

              <div className="card bg-blue-50">
                <p className="text-gray-700">
                  <strong>Total de membros:</strong> {members.length}
                </p>
              </div>
```

- [ ] **Step 5: Verify it builds**

Run: `npx vite build --mode development`
Expected: succeeds.

- [ ] **Step 6: Manual QA**

Run `npm run dev`, open the app, use the dev-only "Entrar como Admin" shortcut on `/login`, navigate to a club you admin → Membros tab. Confirm:
- The search box appears and typing 2+ characters searches players (may show "Nenhum jogador encontrado" if there's no matching test data — that's fine, it confirms the component renders and queries).
- "Copiar link de convite" shows a browser clipboard-permission prompt or copies silently, and the button label flips to "Link copiado!" for ~2s.
- Paste the copied link somewhere to confirm it looks like `http://localhost:5173/login?org=<slug>`.

- [ ] **Step 7: Commit**

```bash
git add src/pages/GerirClube.jsx
git commit -m "feat: add search-invite and copy-link card to GerirClube Membros tab"
```

---

### Task 4: Profile.jsx — "Convites" tab

**Files:**
- Modify: `src/pages/Profile.jsx:9` (import), `:13-17` (TABS), `:26` (destructure `refreshMemberships`), `:57-60` (state), `:80-84` (useEffect wiring), after `:130` (new handlers after `handleDeclineFriendRequest`), `:731-732` (new tab JSX before the `historico` tab)

**Interfaces:**
- Consumes: `acceptOrganizationInvite`, `declineOrganizationInvite`, `listIncomingOrganizationInvites` from `../lib/orgInvites` (Task 2); `refreshMemberships` from `useAuth()` (already exposed by `src/contexts/AuthContext.jsx`, confirmed in its context value list).
- Produces: nothing consumed elsewhere.

- [ ] **Step 1: Add import**

In `src/pages/Profile.jsx`, after line 9 (`import { listIncomingFriendRequests, acceptFriendRequest, removeFriendRequest, listFriends } from '../lib/friends'`), add:

```js
import { listIncomingOrganizationInvites, acceptOrganizationInvite, declineOrganizationInvite } from '../lib/orgInvites'
```

- [ ] **Step 2: Add the tab**

Change lines 13-17:

```js
const TABS = [
  { key: 'perfil', label: 'Perfil' },
  { key: 'amigos', label: 'Amigos' },
  { key: 'convites', label: 'Convites' },
  { key: 'historico', label: 'Histórico' },
]
```

- [ ] **Step 3: Pull in `refreshMemberships`**

Change line 26 from:

```js
  const { profile, updateProfile, currentOrganizationId, isGuest, signOut } = useAuth()
```

to:

```js
  const { profile, updateProfile, currentOrganizationId, isGuest, signOut, refreshMemberships } = useAuth()
```

- [ ] **Step 4: Add state**

Right after line 60 (`const [friendsLoading, setFriendsLoading] = useState(true)`), add:

```js
  const [orgInvites, setOrgInvites] = useState([])
  const [orgInvitesLoading, setOrgInvitesLoading] = useState(true)
  const [orgInviteActing, setOrgInviteActing] = useState(null)
```

- [ ] **Step 5: Load invites alongside friend requests**

In the `useEffect` at lines 63-84, inside the `if (!isGuest) { ... }` block that currently reads:

```js
      if (!isGuest) {
        loadPrivateMatchHistory()
        loadGlobalPoints()
        loadFriendRequests()
        loadFriends()
      }
```

change to:

```js
      if (!isGuest) {
        loadPrivateMatchHistory()
        loadGlobalPoints()
        loadFriendRequests()
        loadFriends()
        loadOrgInvites()
      }
```

- [ ] **Step 6: Add `loadOrgInvites` and the accept/decline handlers**

Right after the existing `handleDeclineFriendRequest` function (ends at line 130 with a closing `}`), add:

```js
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
      alert('Não foi possível aceitar o convite. Tenta novamente.')
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
      alert('Não foi possível recusar o convite. Tenta novamente.')
    } finally {
      setOrgInviteActing(null)
    }
  }
```

- [ ] **Step 7: Add the tab content**

Find the boundary between the `amigos` tab block and the `historico` tab block (currently lines 731-733):

```jsx
      )}

      {tab === 'historico' && (
```

Insert a new `convites` block between them:

```jsx
      )}

      {tab === 'convites' && (
        orgInvitesLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-ink-50 border-t-ink-700"></div>
          </div>
        ) : orgInvites.length === 0 ? (
          <EmptyState
            icon={Users}
            title="Sem convites pendentes"
            subtitle="Convites de admins de clube para te juntares aparecem aqui."
          />
        ) : (
          <div className="card space-y-3">
            {orgInvites.map((inv) => (
              <div key={inv.id} className="flex items-center gap-3">
                <Avatar name={inv.organization_name} url={inv.organization_logo_url} size="w-10 h-10 text-sm" />
                <div className="flex-1 min-w-0">
                  <p className="font-extrabold text-ink-900 text-sm truncate">{inv.organization_name}</p>
                  <p className="text-xs text-muted truncate">Convidado por {inv.invited_by_name}</p>
                </div>
                <button
                  onClick={() => handleAcceptOrgInvite(inv.id)}
                  disabled={orgInviteActing === inv.id}
                  aria-label="Aceitar convite"
                  className="w-9 h-9 shrink-0 rounded-full bg-lime-400 text-ink-900 flex items-center justify-center hover:bg-lime-600 transition-colors duration-fast disabled:opacity-40"
                >
                  <UserCheck size={16} />
                </button>
                <button
                  onClick={() => handleDeclineOrgInvite(inv.id)}
                  disabled={orgInviteActing === inv.id}
                  aria-label="Recusar convite"
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

`UserCheck`, `X`, `Users`, `Avatar`, `EmptyState` are all already imported in this file (line 3 and line 10) — no new icon imports needed.

- [ ] **Step 8: Verify it builds**

Run: `npx vite build --mode development`
Expected: succeeds.

- [ ] **Step 9: Manual QA (needs two accounts)**

This flow needs an inviter and an invitee, so it can't be fully exercised with just the dev admin shortcut (which is a single fixed mock account). Two options: (a) use the dev admin shortcut as the inviting admin, invite a real second test account by name, then log into that second account (real login) and check `/perfil?tab=convites`; or (b) do it directly in Supabase — call `invite_to_organization` via the SQL Editor with two real user ids, then check the tab as that second user. Confirm: the invite appears with the right club name/logo and inviter name, Aceitar adds the club to that user's `/gerir` list (or wherever memberships show), Recusar removes the row and does not create a membership.

- [ ] **Step 10: Commit**

```bash
git add src/pages/Profile.jsx
git commit -m "feat: add Convites tab to Profile for accepting club invites"
```

---

### Task 5: Layout.jsx — notifications bell shows org invites

**Files:**
- Modify: `src/components/Layout.jsx:8-9` (import), after `:159` (new effect after the `friendRequests` effect), `:183` (notificationsTotal), `:274-307` (dropdown list)

**Interfaces:**
- Consumes: `listIncomingOrganizationInvites` from `../lib/orgInvites` (Task 2).
- Produces: nothing consumed elsewhere.

- [ ] **Step 1: Add import**

After line 9 (`import { listPendingMembershipRequestsForAdmin } from '../lib/organizations'`), add:

```js
import { listIncomingOrganizationInvites } from '../lib/orgInvites'
```

- [ ] **Step 2: Add state + effect**

Right after the `friendRequests` effect block (ends at line 159 with `}, [profile?.id, isGuest, location.pathname])`), add:

```js
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

- [ ] **Step 3: Include invites in the total**

Change line 183 from:

```js
  const notificationsTotal = friendRequests.length + joinRequestsTotal
```

to:

```js
  const notificationsTotal = friendRequests.length + joinRequestsTotal + orgInvites.length
```

- [ ] **Step 4: Add a dropdown section**

In the dropdown list (currently lines 274-307), right after the `joinRequestsByOrg.map(...)` block and before `friendRequests.map(...)`, insert:

```jsx
                        {orgInvites.map((inv) => (
                          <Link
                            key={inv.id}
                            to="/perfil?tab=convites"
                            onClick={() => setShowNotifications(false)}
                            className="flex items-center gap-3 px-4 py-3 transition-colors duration-fast hover:bg-ink-50"
                          >
                            <Avatar name={inv.organization_name} url={inv.organization_logo_url} size="w-9 h-9 text-sm" />
                            <p className="flex-1 min-w-0 text-sm text-ink-900">
                              Convite para entrar em <span className="font-extrabold">{inv.organization_name}</span>
                            </p>
                            <span aria-hidden="true" className="w-2 h-2 rounded-full bg-lime-400 shrink-0" />
                          </Link>
                        ))}
```

- [ ] **Step 5: Verify it builds**

Run: `npx vite build --mode development`
Expected: succeeds.

- [ ] **Step 6: Manual QA**

With a pending invite present for the logged-in test account (created in Task 4's QA), open any page, click the bell — confirm the badge count includes it and the dropdown shows the new row, and clicking it navigates to `/perfil?tab=convites`.

- [ ] **Step 7: Commit**

```bash
git add src/components/Layout.jsx
git commit -m "feat: show pending organization invites in the notifications bell"
```

---

### Task 6: Home.jsx — invite links work for already-logged-in members of other clubs

**Files:**
- Modify: `src/pages/Home.jsx:42-53`

**Interfaces:**
- Consumes: existing `joinOrganization` (from `useAuth()`), `currentOrganizationId` (from `useAuth()`) — both already destructured at line 19 of this file, unchanged by this task.

- [ ] **Step 1: Widen the auto-join condition**

Find (currently lines 42-53):

```js
  // Invite links carry ?org=<slug>, but that's normally only consumed by
  // the /login page — someone who's already signed in (with no club yet)
  // gets redirected straight past /login to here without it ever being
  // read. Pick it up here too, so an invite link works for an existing,
  // club-less session, not just a fresh signup.
  useEffect(() => {
    const orgSlug = searchParams.get('org')
    if (orgSlug && !currentOrganizationId) {
      handleJoin(orgSlug)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
```

Replace with:

```js
  // Invite links carry ?org=<slug>, but that's normally only consumed by
  // the /login page — someone who's already signed in gets redirected
  // straight past /login to here without it ever being read. Pick it up
  // here too, so an invite link works for any existing session, not just
  // a fresh signup — join_organization is idempotent and doesn't change
  // which club is currently selected, so it's safe even for someone
  // who's already a member elsewhere.
  useEffect(() => {
    const orgSlug = searchParams.get('org')
    if (orgSlug) {
      handleJoin(orgSlug)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
```

- [ ] **Step 2: Verify it builds**

Run: `npx vite build --mode development`
Expected: succeeds.

- [ ] **Step 3: Manual QA**

While logged in (dev admin shortcut or a real account) and already a member of at least one club, navigate to `/?org=<slug-of-a-different-club>`. Confirm no error banner appears and the new club shows up under `/gerir` (or wherever the app lists your admin/member clubs) shortly after.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Home.jsx
git commit -m "fix: invite links now auto-join even when already a member elsewhere"
```

---

## Self-Review Notes

- **Spec coverage:** "Convite por pesquisa" → Tasks 1–4. "Link de convite" → Task 3 (UI) + existing infra (no new backend). "Fix relacionado" (Home.jsx guard) → Task 6. "Fora de âmbito" items (broader search, bulk invites, link expiry, WhatsApp notification) are intentionally not tasked.
- **Type/name consistency checked:** `inviteToOrganization`/`acceptOrganizationInvite`/`declineOrganizationInvite`/`listIncomingOrganizationInvites` (Task 2) are the exact names used in Tasks 3–5. RPC names/params match between Task 1's SQL and Task 2's `.rpc(...)` calls. `organization_name`/`organization_logo_url`/`invited_by_name`/`organization_id` field names match between Task 1's `RETURNS TABLE` and Tasks 4–5's JSX.
- **No placeholders:** every step has literal code, not a description of code.
