# Platform admin: create new tenants from the app

## Context

Creating a new club (organization) is currently 100% manual: a direct SQL `INSERT` into `organizations`, then a second manual `INSERT` into `memberships` to give someone the first `is_admin` row — there's no in-app path at all, and no concept of a platform-level role above per-club admin. This was fine while onboarding was "2-5 clients by hand," but now that clubs are being created more regularly, it's worth a proper in-app flow.

This is deliberately small in scope: a way to create a club and assign its first admin from the app, gated behind a new, manually-granted `is_platform_admin` flag. It does not add any UI to manage or revoke that flag — same manual-SQL philosophy that already governs who gets to create clubs today.

## Schema

```sql
ALTER TABLE profiles ADD COLUMN is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE;
```
Granted only via direct SQL, same as club creation is today. `AuthContext` already fetches `profiles.*` on login, so `profile.is_platform_admin` is available client-side with no new query.

## RPCs

**`create_organization(p_name TEXT, p_slug TEXT, p_admin_user_id UUID) RETURNS UUID`** — `SECURITY DEFINER`, guarded by `is_platform_admin`. Creates the org and its first admin membership atomically, so a club can never exist with nobody able to manage it:
```sql
CREATE OR REPLACE FUNCTION create_organization(p_name TEXT, p_slug TEXT, p_admin_user_id UUID)
RETURNS UUID AS $$
DECLARE
  v_org_id UUID;
BEGIN
  IF NOT (SELECT is_platform_admin FROM profiles WHERE id = auth.uid()) THEN
    RAISE EXCEPTION 'Apenas super admins podem criar clubes';
  END IF;

  INSERT INTO organizations (name, slug) VALUES (p_name, p_slug)
  RETURNING id INTO v_org_id;

  INSERT INTO memberships (user_id, organization_id, is_admin)
  VALUES (p_admin_user_id, v_org_id, true);

  RETURN v_org_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION create_organization(TEXT, TEXT, UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION create_organization(TEXT, TEXT, UUID) TO authenticated;
```
A duplicate `slug` fails on the existing `organizations.slug` UNIQUE constraint — the frontend just needs to surface that error legibly, no new validation logic needed server-side.

**`search_any_player(p_query TEXT) RETURNS TABLE (id UUID, name TEXT, avatar_url TEXT)`** — same shape as the existing `search_players`, but without its "shares an org with you, or org is global" restriction, since the platform admin needs to find and appoint literally any registered person as the first admin of a brand-new club they don't yet share anything with. Guarded by `is_platform_admin` instead of being open to every authenticated user:
```sql
CREATE OR REPLACE FUNCTION search_any_player(p_query TEXT)
RETURNS TABLE (id UUID, name TEXT, avatar_url TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (SELECT is_platform_admin FROM profiles WHERE id = auth.uid()) THEN
    RAISE EXCEPTION 'Apenas super admins podem pesquisar todos os jogadores';
  END IF;

  RETURN QUERY
  SELECT p.id, p.name, p.avatar_url
  FROM profiles p
  WHERE length(trim(p_query)) >= 2
    AND p.name ILIKE '%' || trim(p_query) || '%'
  ORDER BY p.name
  LIMIT 10;
END;
$$;

REVOKE EXECUTE ON FUNCTION search_any_player(TEXT) FROM anon, public;
GRANT EXECUTE ON FUNCTION search_any_player(TEXT) TO authenticated;
```

## Frontend

In `Gerir.jsx`: when `profile.is_platform_admin`, a **"Criar novo clube"** button appears above the list of clubs the caller already administers (shown even when that list is empty — the two states aren't related). Opens a small form: **Nome**, **Slug**, and a player-search field (reusing the existing `PlayerSearch` component, pointed at `search_any_player` instead of `search_players`) to pick the first admin. Submitting calls `create_organization`, then navigates straight to `/gerir/<slug>` of the new club.

Slug field: lowercase, letters/digits/hyphens only, client-side sanitized as the admin types (mirrors what a URL slug needs) — real uniqueness is still enforced server-side by the constraint; client-side is just to avoid an obviously-doomed submit (e.g. spaces, accents).

## Error handling

- Duplicate slug → `create_organization` fails on the DB constraint; the RPC error message is generic (Postgres unique-violation text), so the frontend catches it and shows "Já existe um clube com este identificador — escolhe outro" rather than the raw Postgres error.
- No admin selected → submit button stays disabled until a player is picked from the search results, same pattern as `CreatePrivateMatch`'s partner picker.
- Caller isn't actually `is_platform_admin` (stale client state, or someone hits the RPC directly) → both RPCs raise and refuse; the "Criar novo clube" button simply doesn't render for anyone without the flag, so this is a defense-in-depth backstop, not a reachable UI path.

## Testing

No automated test suite in this project — manual verification, matching every other migration:

**SQL (manual, Supabase SQL editor):**
- Set `is_platform_admin = true` on a test profile; confirm `create_organization` succeeds and produces both the `organizations` row and the `memberships` row (`is_admin = true`) for the chosen user.
- Call `create_organization` as a non-platform-admin profile; confirm it raises.
- Call it twice with the same slug; confirm the second call fails on the unique constraint.
- Call `search_any_player` as a non-platform-admin; confirm it raises. As a platform admin, confirm it returns a person who shares no org with the caller (the exact case `search_players` would have hidden).

**Frontend (manual, in-browser):**
- As a platform admin, confirm "Criar novo clube" appears in `/gerir`; as a normal admin, confirm it doesn't.
- Create a club, assign an existing player as its admin, confirm redirect to `/gerir/<new-slug>` and that the assigned person now sees/administers it.
- Try a duplicate slug, confirm the friendly error message.
