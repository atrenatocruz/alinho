# Comunidade search fix + global "Jogo entre amigos" toggle

**Date**: 2026-08-03
**Status**: Approved

## Context

Two independent asks:

1. The Comunidade tab (player search) only exists on the unmerged branch
   `worktree-bottom-nav-reorganization`. Its search shows nothing until the
   user types ≥2 characters, and shows nothing (no empty state) on zero
   results — reads as broken, and there's no way to browse players without
   already knowing a name.
2. "Jogo entre amigos" (private matches) should be temporarily disable-able
   app-wide, with a toggle in the backoffice. No feature-flag mechanism
   exists in the codebase today.

## Part 1 — Merge `worktree-bottom-nav-reorganization` into `main`

The branch (5 commits: `5f05290`..`4915961`) is directly ahead of `main`'s
current HEAD (`f82b15b`) — a fast-forward merge, no conflicts. Brings in the
Comunidade page, `PlayerSearch` usage, reordered Rankings tabs, Clubes
placeholder, and the 5-item bottom nav.

## Part 2 — Comunidade: browse + search fix

**New RPC** `list_players(p_limit INTEGER DEFAULT 20)` (new file
`supabase/migration_community_browse_rpc.sql`), mirroring `search_players`'s
visibility rules (cross-club, excludes self, excludes `memberships.is_test`
accounts), ordered by `created_at DESC`, default limit 20:

```sql
CREATE OR REPLACE FUNCTION list_players(p_limit INTEGER DEFAULT 20)
RETURNS TABLE (id UUID, name TEXT, avatar_url TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.name, p.avatar_url
  FROM profiles p
  WHERE p.id <> auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM memberships m WHERE m.user_id = p.id AND m.is_test = true
    )
  ORDER BY p.created_at DESC
  LIMIT p_limit;
$$;
```

**Frontend**: `PlayerSearch.jsx` gets an opt-in `browseByDefault` prop. When
true and `query` is empty, it fetches `list_players` on mount and renders
those results in the same dropdown list (open by default in that case,
rather than gated on focus). `CreatePrivateMatch.jsx` doesn't pass the prop,
so opponent search there is unchanged. `Comunidade.jsx` passes
`browseByDefault`.

Also add an empty-state row ("Nenhum jogador encontrado") when a real search
(≥2 chars) returns zero results, so the UI gives feedback instead of just
not rendering anything.

## Part 3 — Global feature flag

New file `supabase/migration_feature_flags.sql`:

```sql
CREATE TABLE feature_flags (
  key TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES profiles(id)
);

INSERT INTO feature_flags (key, enabled) VALUES ('private_matches', true);

ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;

-- Not sensitive: any authenticated user can read every flag.
CREATE POLICY "feature_flags_select_authenticated" ON feature_flags
  FOR SELECT TO authenticated USING (true);

-- Global toggle, not org-scoped (private matches are explicitly
-- org-independent) — any admin of any club may flip it, same trust level
-- the app already grants org admins elsewhere. No platform-admin role
-- exists or is being introduced for this.
CREATE OR REPLACE FUNCTION admin_set_feature_flag(p_key TEXT, p_enabled BOOLEAN)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM memberships WHERE user_id = auth.uid() AND is_admin) THEN
    RAISE EXCEPTION 'Apenas admins podem alterar funcionalidades da app';
  END IF;

  UPDATE feature_flags
  SET enabled = p_enabled, updated_at = now(), updated_by = auth.uid()
  WHERE key = p_key;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Funcionalidade desconhecida: %', p_key;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION admin_set_feature_flag(TEXT, BOOLEAN) FROM public;
GRANT EXECUTE ON FUNCTION admin_set_feature_flag(TEXT, BOOLEAN) TO authenticated;
```

**Frontend**: `AuthContext.jsx` loads `feature_flags` once (alongside
profile/memberships) and exposes `isPrivateMatchesEnabled` on its context
value.

**Enforcement points**:
- `Home.jsx:169-177` — the "Jogo entre amigos" card is only rendered when
  `isPrivateMatchesEnabled`.
- `App.jsx` — the `/jogos-privados` and `/jogos-privados/novo` routes
  redirect to `/` when the flag is off (covers direct navigation/bookmarks).
  `/jogos-privados/:id/entrar` (join-by-link) also redirects, since claiming
  a slot is part of match creation.
- `create_private_match` and `claim_private_match_slot` RPCs check the flag
  and raise if disabled — defense in depth against direct RPC calls.

**Not changed**: `confirm_private_match`, `get_global_rankings`, and
`Profile.jsx`'s private-match history/points. Existing data and its
contribution to the ranking are unaffected — the flag only blocks creating
new matches / claiming new slots, per explicit decision to keep history
intact.

## Part 4 — Backoffice UI

`Admin.jsx` Settings tab gets a new "Funcionalidades da app" section (its
own block, separate from the per-org `handleUpdateSettings` form since this
write goes through `admin_set_feature_flag` instead of updating
`organizations`): a single checkbox/switch bound to the `private_matches`
flag, calling `admin_set_feature_flag('private_matches', enabled)` on
change and refreshing local state from the response.

## Non-goals

- No per-org scoping of the flag (private matches are explicitly
  org-independent in the schema).
- No new platform-admin role — reuses the existing per-org `is_admin`
  check, so any club admin can toggle it.
- No retroactive changes to ranking totals or match history when disabled.
