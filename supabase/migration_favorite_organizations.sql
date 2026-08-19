-- ════════════════════════════════════════════════════════════════════════
-- Favorite clubs/groups: a heart toggle on "Clubes & Grupos" (member clubs
-- only) that makes that club's mixs float to the top of "Próximos jogos".
--
-- Reuses the existing "own membership" self-update pattern from
-- migration_fix_membership_level_update.sql (RLS matches the whole row,
-- a column-level GRANT narrows what can actually be touched) rather than
-- a new RPC — same shape, one more column.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE memberships ADD COLUMN is_favorite BOOLEAN NOT NULL DEFAULT FALSE;

GRANT UPDATE (is_favorite) ON memberships TO authenticated;
