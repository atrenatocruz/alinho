# Profile Vouchers Wallet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a player see, on their own Profile page, the discount vouchers they've earned by winning mixes with a prize attached, and mark each one as redeemed.

**Architecture:** A per-mix `has_voucher` flag (mirroring the existing `prize` field's own shape on `games`/`game_recurrences`) drives everything. One migration file adds that flag, a new `vouchers` table (SELECT-only RLS, modeled on `player_trophies`), a voucher-award step inside the existing `finalize_mix()` RPC (scoped to the winning team's two players), and a new `mark_voucher_used()` RPC. `src/pages/GerirClube.jsx` gains a checkbox to set the flag. `src/pages/Profile.jsx` gains a third tab that reads `vouchers` directly (RLS-authorized, no new read RPC) and renders a small "wallet" stack of `VoucherCard`s (new, in `src/components/ui.jsx`), ordered by a new pure-logic helper in `src/lib/vouchers.js`.

**Tech Stack:** React + Vite + Supabase (Postgres + RLS + RPC), react-i18next, Tailwind. `src/lib/vouchers.js` is the one pure-logic module this feature adds and gets a real Vitest test file (`src/lib/vouchers.test.js`), matching how `src/lib/mixLogic.js`/`src/lib/xp.js` are the only kind of code in this repo with automated tests. Everything else (SQL, RPC, UI) is verified by `npm run build` + manual read-through + manual Supabase SQL Editor checks, matching how every other RPC-and-UI feature in this codebase (trophies, follows, kudos) has always been verified — there is no RLS/RPC/component test harness in this repo to plug into.

**Spec:** `docs/superpowers/specs/2026-09-14-profile-vouchers-wallet-design.md`

## Global Constraints

- A voucher is tied to a **mix** (`games.has_voucher`), never to a partner/affiliate catalog. Trello **#199** (affiliated clubs/partners) is out of scope and this plan introduces no coupling to it.
- Only the **two players of the winning team** of a `has_voucher = true` mix receive a voucher — never every participant.
- `vouchers` has exactly two states: `'por_usar'` / `'usado'`. No expiry column, no cron sweep, no `mark_voucher_unused`.
- All writes to `vouchers` go through `SECURITY DEFINER` functions (`finalize_mix()`'s award step, `mark_voucher_used()`). No client `INSERT`/`UPDATE`/`DELETE` policy is ever added to this table.
- `game_recurrences.has_voucher` propagates to every mix a recurrence spawns, exactly the same three places `prize` already does (see Task 1 Step 5, Task 4 Steps 2-3).
- Marking a voucher used is gated behind a `confirm()` dialog on the frontend before the RPC call — this repo's rule for irreversible actions (`CLAUDE.md`, "Things that have bitten people before").
- `src/locales/pt.json` is source of truth, written first in every i18n step; `src/locales/en.json` mirrors every key with an English translation in the same task.
- The migration file this plan produces is **not live** until a human pastes it into Supabase → SQL Editor → New query → Run. State that explicitly when Task 1 is reported done, and again in Task 7's final report — none of Tasks 2-6 can be functionally verified end-to-end against production until it has actually been run there.
- `finalize_mix()` and `process_due_game_recurrences()` are both redefined **wholesale** (`CREATE OR REPLACE FUNCTION`, full body) — Task 1 builds from the current live body of each (cited exactly, with the `git log` evidence for why that specific file is "current," in Task 1 Steps 4 and 6), not from `supabase/schema.sql`, which is a stale historical base that several later migrations have already diverged from.

---

## Task 1: Database migration — `has_voucher` columns, `vouchers` table, award + redeem RPCs

**Files:**
- Create: `supabase/migration_vouchers.sql`

**Interfaces:**
- Produces: columns `games.has_voucher BOOLEAN`, `game_recurrences.has_voucher BOOLEAN`; table `vouchers` (columns: `id`, `game_id`, `user_id`, `organization_id`, `status`, `created_at`, `used_at`); function `mark_voucher_used(p_voucher_id UUID) RETURNS VOID`; redefined `finalize_mix(p_game_id UUID, p_winner_team_id UUID)` (same signature, now also awards vouchers) and `process_due_game_recurrences()` (same signature, now also propagates `has_voucher`). Consumed by: Task 4 (`GerirClube.jsx` writes `has_voucher`), Task 6 (`Profile.jsx` reads `vouchers`, calls `mark_voucher_used`).

This task has no automated test — it's a hand-run SQL file, same as every other migration in `supabase/`. Verification is read-through plus (once actually run against a real Supabase project) manual SQL Editor checks, listed in Step 8.

- [ ] **Step 1: Write the migration's header disclaimer**

Create `supabase/migration_vouchers.sql` with this header:

```sql
-- ════════════════════════════════════════════════════════════════════════
-- Migration: Profile vouchers wallet (Trello #200). A per-mix opt-in
-- (games.has_voucher / game_recurrences.has_voucher, mirroring how prize
-- already works on both tables) — when a mix with the flag on is
-- finalized, the two players of the winning team each get a voucher row
-- (vouchers table), described by that mix's existing free-text `prize`
-- field. No partner/affiliate catalog — that's Trello #199, explicitly
-- out of scope and not depended on here.
--
-- No direct INSERT/UPDATE/DELETE policy on vouchers — awarding happens
-- inside finalize_mix() (SECURITY DEFINER, already admin-gated), redeeming
-- happens through the new mark_voucher_used() (SECURITY DEFINER). Only
-- two states exist: 'por_usar' / 'usado' — no expiry, no un-redeem.
--
-- NOT LIVE until run in Supabase → SQL Editor → New query → Run. A
-- migration file existing in this repo changes nothing on its own — the
-- checkbox in GerirClube.jsx, the voucher award inside finalize_mix, the
-- Profile "Vouchers" tab, and mark_voucher_used all depend on this having
-- actually been pasted in and executed there.
--
-- See docs/superpowers/specs/2026-09-14-profile-vouchers-wallet-design.md
-- for the full design and the reasoning behind each decision below.
-- ════════════════════════════════════════════════════════════════════════
```

- [ ] **Step 2: `has_voucher` columns**

Append:

```sql
ALTER TABLE games            ADD COLUMN IF NOT EXISTS has_voucher BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE game_recurrences ADD COLUMN IF NOT EXISTS has_voucher BOOLEAN NOT NULL DEFAULT FALSE;
```

- [ ] **Step 3: `vouchers` table, indexes, RLS**

Append:

```sql
CREATE TABLE IF NOT EXISTS vouchers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id         UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  status          TEXT NOT NULL DEFAULT 'por_usar' CHECK (status IN ('por_usar', 'usado')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  used_at         TIMESTAMPTZ,
  UNIQUE (game_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_vouchers_user ON vouchers (user_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_game ON vouchers (game_id);

ALTER TABLE vouchers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Own or org-mates vouchers" ON vouchers;
CREATE POLICY "Own or org-mates vouchers"
  ON vouchers FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR shares_org_with(user_id));
-- No INSERT/UPDATE/DELETE policies — only finalize_mix() (award, Step 5)
-- and mark_voucher_used() (redeem, Step 4) write this table.
```

- [ ] **Step 4: `mark_voucher_used` RPC**

Append:

```sql
CREATE OR REPLACE FUNCTION mark_voucher_used(p_voucher_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE vouchers
  SET status = 'usado', used_at = NOW()
  WHERE id = p_voucher_id
    AND user_id = auth.uid()
    AND status = 'por_usar';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Voucher não encontrado ou já usado';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION mark_voucher_used(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION mark_voucher_used(UUID) TO authenticated;
```

The `WHERE user_id = auth.uid() AND status = 'por_usar'` clause is the entire authorization + idempotency check — it can't be bypassed by calling the RPC directly (no other function or policy grants a path to update this table), and a second concurrent call on the same voucher finds zero rows and raises rather than racing to double-set `used_at`.

- [ ] **Step 5: Redefine `finalize_mix` — add the voucher award step**

`finalize_mix` is redefined wholesale on every migration that touches it. Its current live body is the one in `supabase/migration_trophies.sql` (lines 351-476) — confirmed via `git log -1 --format="%ad %s" -- supabase/migration_trophies.sql` as the most recently committed redefinition (2026-09-09, after `migration_xp_engagement.sql`'s earlier version). **Before running this step, re-run that same `git log` check across `supabase/migration_*.sql` for any newer `CREATE OR REPLACE FUNCTION finalize_mix` — if one exists, rebuild this step from that file's body instead, applying the same one-block addition below.**

Append the full redefinition, identical to the live body except for the new `IF (SELECT has_voucher ...)` block inserted directly after the existing trophies `PERFORM` and before `END;`:

```sql
CREATE OR REPLACE FUNCTION finalize_mix(p_game_id UUID, p_winner_team_id UUID)
RETURNS void AS $$
DECLARE
  rules JSONB;
  v_org_id UUID;
  v_game_date TIMESTAMPTZ;
BEGIN
  SELECT organization_id, date INTO v_org_id, v_game_date FROM games WHERE id = p_game_id;

  IF NOT EXISTS (
    SELECT 1 FROM memberships
    WHERE organization_id = v_org_id AND user_id = auth.uid() AND is_admin
  ) THEN
    RAISE EXCEPTION 'Apenas admins podem finalizar um mix';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM games WHERE id = p_game_id AND status = 'in_progress') THEN
    RAISE EXCEPTION 'O mix não está a decorrer';
  END IF;

  IF EXISTS (SELECT 1 FROM matches WHERE game_id = p_game_id AND winner_team_id IS NULL) THEN
    RAISE EXCEPTION 'Há jogos sem resultado registado';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM teams WHERE id = p_winner_team_id AND game_id = p_game_id) THEN
    RAISE EXCEPTION 'Dupla vencedora inválida';
  END IF;

  SELECT points_rules INTO rules FROM organizations WHERE id = v_org_id;
  IF rules IS NULL THEN
    rules := '{"point_per_match_played": 1, "point_per_match_win": 3, "point_per_mix_participation": 2, "point_per_mix_win": 10}'::jsonb;
  END IF;

  WITH mt AS (
    SELECT m.winner_team_id AS win_id, t.id AS team_id, t.player1_id, t.player2_id
    FROM matches m
    JOIN teams t ON t.id = m.team_a_id OR t.id = m.team_b_id
    WHERE m.game_id = p_game_id
  ),
  pp AS (
    SELECT unnest(ARRAY[player1_id, player2_id]) AS pid,
           (team_id = win_id) AS won
    FROM mt
  ),
  agg AS (
    SELECT pid,
           COUNT(*) AS played,
           COUNT(*) FILTER (WHERE won) AS wins,
           COUNT(*) FILTER (WHERE NOT won) AS losses
    FROM pp
    WHERE pid IS NOT NULL
    GROUP BY pid
  ),
  scored AS (
    SELECT a.pid, a.played, a.wins, a.losses,
           (a.pid IN (
             SELECT unnest(ARRAY[player1_id, player2_id]) FROM teams WHERE id = p_winner_team_id
           )) AS won_mix
    FROM agg a
    JOIN memberships mb ON mb.user_id = a.pid AND mb.organization_id = v_org_id AND NOT mb.is_guest
  ),
  pcalc AS (
    SELECT pid, played, wins, losses, won_mix,
           (played * COALESCE((rules->>'point_per_match_played')::int, 0)
            + wins * COALESCE((rules->>'point_per_match_win')::int, 0)
            + COALESCE((rules->>'point_per_mix_participation')::int, 0)
            + CASE WHEN won_mix THEN COALESCE((rules->>'point_per_mix_win')::int, 0) ELSE 0 END
           ) AS pts
    FROM scored
  ),
  ins_player_stats AS (
    INSERT INTO player_stats (user_id, organization_id, game_wins, game_losses, mix_wins, mixes_played, total_points)
    SELECT pid, v_org_id, wins, losses, CASE WHEN won_mix THEN 1 ELSE 0 END, 1, pts
    FROM pcalc
    ON CONFLICT (user_id, organization_id) DO UPDATE
    SET game_wins    = player_stats.game_wins    + EXCLUDED.game_wins,
        game_losses  = player_stats.game_losses  + EXCLUDED.game_losses,
        mix_wins     = player_stats.mix_wins     + EXCLUDED.mix_wins,
        mixes_played = player_stats.mixes_played + EXCLUDED.mixes_played,
        total_points = player_stats.total_points + EXCLUDED.total_points,
        updated_at   = NOW()
    RETURNING 1
  ),
  ins_mix_stats AS (
    INSERT INTO mix_player_stats (game_id, user_id, organization_id, matches_played, matches_won, points_earned, mix_won)
    SELECT p_game_id, pid, v_org_id, played, wins, pts, won_mix
    FROM pcalc
    ON CONFLICT (game_id, user_id) DO UPDATE
    SET matches_played = EXCLUDED.matches_played,
        matches_won    = EXCLUDED.matches_won,
        points_earned  = EXCLUDED.points_earned,
        mix_won        = EXCLUDED.mix_won
    RETURNING 1
  ),
  xp_rows AS (
    SELECT pid, 'mix_participation'::text AS kind, 20 AS amount FROM pcalc
    UNION ALL
    SELECT pid, 'mix_games', played * 5 FROM pcalc WHERE played > 0
    UNION ALL
    SELECT pid, 'mix_win', 30 FROM pcalc WHERE won_mix
  ),
  ins_xp AS (
    INSERT INTO xp_events (user_id, organization_id, kind, source_game_id, amount, occurred_at)
    SELECT pid, v_org_id, kind, p_game_id, amount, v_game_date
    FROM xp_rows
    ON CONFLICT (user_id, kind, source_game_id) WHERE source_game_id IS NOT NULL DO NOTHING
    RETURNING user_id, amount
  )
  UPDATE profiles p
  SET xp = p.xp + s.total,
      last_played_at = GREATEST(COALESCE(p.last_played_at, v_game_date), v_game_date)
  FROM (SELECT user_id, SUM(amount) AS total FROM ins_xp GROUP BY user_id) s
  WHERE p.id = s.user_id;

  PERFORM apply_mix_elo(p_game_id, p_winner_team_id);

  UPDATE games
  SET status = 'finished', winner_team_id = p_winner_team_id, updated_at = NOW()
  WHERE id = p_game_id;

  -- Troféus: estado já todo escrito (stats, XP, Elo) — verificar todos os
  -- jogadores do mix.
  PERFORM check_and_award_trophies(mps.user_id)
  FROM mix_player_stats mps WHERE mps.game_id = p_game_id;

  -- Vouchers (Trello #200): só a dupla vencedora, só se o mix tiver
  -- has_voucher=true. Idempotente via UNIQUE(game_id, user_id).
  IF (SELECT has_voucher FROM games WHERE id = p_game_id) THEN
    INSERT INTO vouchers (game_id, user_id, organization_id)
    SELECT p_game_id, pid, v_org_id
    FROM (
      SELECT player1_id AS pid FROM teams WHERE id = p_winner_team_id
      UNION ALL
      SELECT player2_id FROM teams WHERE id = p_winner_team_id
    ) winners
    WHERE pid IS NOT NULL
    ON CONFLICT (game_id, user_id) DO NOTHING;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
```

- [ ] **Step 6: Redefine `process_due_game_recurrences` — propagate `has_voucher`**

Same "current live body" rule as Step 5. `process_due_game_recurrences()`'s current live body is the one in `supabase/migration_whatsapp_groups.sql` (lines 53-114) — confirmed via `git log -1 --format="%ad %s" -- supabase/migration_whatsapp_groups.sql` as the most recent redefinition (2026-09-08), **not** the copy in `supabase/schema.sql`, which predates the `gender_restriction`/`auto_start_hours_before`/`level` columns this body already includes and would silently drop them if used as the base. **Before running this step, re-run the same `git log` check for any newer `CREATE OR REPLACE FUNCTION process_due_game_recurrences` — rebuild from that instead if one exists.**

Append the full redefinition, identical to the live body except `has_voucher`/`rec.has_voucher` added to the `INSERT INTO games` column and value lists, next to `prize`/`rec.prize`:

```sql
CREATE OR REPLACE FUNCTION process_due_game_recurrences()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec RECORD;
  v_new_date TIMESTAMPTZ;
BEGIN
  FOR rec IN
    SELECT g.id AS pending_game_id, g.date AS pending_date, gr.*
    FROM games g
    JOIN game_recurrences gr ON gr.id = g.recurrence_id
    WHERE g.status = 'pending' AND g.launch_at <= now() AND gr.is_active = true
    FOR UPDATE OF g SKIP LOCKED
  LOOP
    IF EXISTS (
      SELECT 1 FROM games
      WHERE recurrence_id = rec.id AND status IN ('open', 'closed', 'in_progress')
    ) THEN
      CONTINUE;
    END IF;

    UPDATE games SET status = 'open', updated_at = now(), launch_at = NULL WHERE id = rec.pending_game_id;

    v_new_date := (
      (rec.pending_date AT TIME ZONE 'Europe/Lisbon') + (CASE rec.frequency
            WHEN 'daily'   THEN interval '1 day'
            WHEN 'weekly'  THEN interval '1 week'
            WHEN 'monthly' THEN interval '1 month'
            WHEN 'yearly'  THEN interval '1 year'
          END)
    ) AT TIME ZONE 'Europe/Lisbon';

    IF (rec.ends_type = 'on_date' AND v_new_date > rec.ends_on)
       OR (rec.ends_type = 'after_occurrences' AND rec.occurrences_created >= rec.ends_after_occurrences) THEN
      UPDATE game_recurrences SET is_active = false, updated_at = now() WHERE id = rec.id;
      CONTINUE;
    END IF;

    INSERT INTO games (
      organization_id, title, date, location, price_per_player, prize, has_voucher,
      num_courts, max_players, court_time_minutes, game_time_minutes, format,
      gender_restriction, auto_start_hours_before, level,
      status, created_by, recurrence_id, is_recurrence_origin, launch_at
    )
    VALUES (
      rec.organization_id, rec.title, v_new_date, rec.location, rec.price_per_player, rec.prize, rec.has_voucher,
      rec.num_courts, rec.num_courts * 4, rec.court_time_minutes, rec.game_time_minutes, rec.format,
      rec.gender_restriction, rec.auto_start_hours_before, rec.level,
      'pending', rec.created_by, rec.id, false,
      v_new_date - make_interval(secs => rec.mix_offset_seconds)
    )
    ON CONFLICT (recurrence_id, date) WHERE recurrence_id IS NOT NULL DO NOTHING;

    UPDATE game_recurrences
    SET occurrences_created = occurrences_created + 1, updated_at = now()
    WHERE id = rec.id;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION process_due_game_recurrences() FROM public;
```

- [ ] **Step 7: Read-through self-check**

Re-read the full file top to bottom. Confirm: every `CREATE TABLE`/`ALTER TABLE`/`CREATE INDEX` uses `IF NOT EXISTS`; the `CREATE POLICY` is preceded by a matching `DROP POLICY IF EXISTS`; both `CREATE OR REPLACE FUNCTION` bodies are complete (no truncation) and match their cited source files exactly outside of the documented one-block/one-column additions; `mark_voucher_used` has both a `REVOKE` and a `GRANT`.

- [ ] **Step 8: Document manual verification (for once this migration is actually run)**

These checks can't run now — they depend on a human pasting this file into a real Supabase project's SQL Editor first. Record them here so Task 7's final report can point back to this exact list:

```sql
-- 1. Award: create/finalize a has_voucher=true mix, then:
SELECT game_id, user_id, status FROM vouchers WHERE game_id = '<the finalized game id>';
-- Expect: exactly 2 rows, user_id = the winning team's two players.

-- 2. Idempotency: re-run just the award block's INSERT manually with the
--    same game_id/winner_team_id — expect 0 rows affected (ON CONFLICT).

-- 3. Redeem, as the voucher's own owner (run with that user's session):
SELECT mark_voucher_used('<voucher id>');
SELECT status, used_at FROM vouchers WHERE id = '<voucher id>';
-- Expect: status = 'usado', used_at set.

-- 4. Redeem again — expect an exception ("Voucher não encontrado ou já usado").

-- 5. Redeem as a DIFFERENT authenticated user — expect the same exception
--    (their auth.uid() doesn't match user_id, so 0 rows match, NOT FOUND).

-- 6. RLS: as a non-winning participant of the same mix, or a member of a
--    different organization, SELECT * FROM vouchers WHERE id = '<voucher id>'
--    — expect 0 rows back (not an error — RLS silently filters).

-- 7. Recurrence propagation: create a recurring mix series with
--    has_voucher=true, confirm the pre-created next occurrence
--    (games row, status='pending') already has has_voucher=true, then
--    (or via a manual call to process_due_game_recurrences()) confirm a
--    further spawned occurrence also has has_voucher=true.
```

- [ ] **Step 9: Commit**

```bash
git add supabase/migration_vouchers.sql
git commit -m "$(cat <<'EOF'
feat: vouchers table + award/redeem RPCs (Trello #200)

New per-mix has_voucher flag; winning team gets a voucher on
finalize_mix; mark_voucher_used lets the owner redeem it. NOT LIVE
until run in Supabase SQL Editor.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011x8RPEBrD2mrnXhyJytueW
EOF
)"
```

---

## Task 2: i18n keys — `profile.*` and `gerirclube.*` voucher strings

**Files:**
- Modify: `src/locales/pt.json`
- Modify: `src/locales/en.json`

**Interfaces:**
- Produces: `profile.tab_vouchers`, `profile.vouchers_empty_title`, `profile.vouchers_empty_subtitle`, `profile.voucher_status_por_usar`, `profile.voucher_status_usado`, `profile.voucher_mark_used_action`, `profile.voucher_mark_used_confirm`, `profile.voucher_used_at`, `profile.voucher_error_mark_used`, `gerirclube.has_voucher_label`, `gerirclube.has_voucher_hint`. Consumed by Tasks 4-6.

- [ ] **Step 1: Add keys to `pt.json`**

Find (the existing `prize_placeholder` line):

```json
  "gerirclube.prize_placeholder": "ex: Vouchers para os vencedores",
```

Replace with (adds the two `gerirclube.*` keys right after it):

```json
  "gerirclube.prize_placeholder": "ex: Vouchers para os vencedores",
  "gerirclube.has_voucher_label": "Tem voucher",
  "gerirclube.has_voucher_hint": "Os dois jogadores da dupla vencedora recebem um voucher com o texto do prémio acima.",
```

Find (the existing `tab_history` line):

```json
  "profile.tab_history": "Histórico",
```

Replace with (adds `tab_vouchers` right after it):

```json
  "profile.tab_history": "Histórico",
  "profile.tab_vouchers": "Vouchers",
  "profile.vouchers_empty_title": "Ainda sem vouchers",
  "profile.vouchers_empty_subtitle": "Vouchers ganhos ao vencer mixes com prémio aparecem aqui.",
  "profile.voucher_status_por_usar": "Por usar",
  "profile.voucher_status_usado": "Usado",
  "profile.voucher_mark_used_action": "Marcar como usado",
  "profile.voucher_mark_used_confirm": "Marcar este voucher como usado? Não é possível desfazer.",
  "profile.voucher_used_at": "Usado a {{date}}",
  "profile.voucher_error_mark_used": "Não foi possível marcar o voucher como usado.",
```

- [ ] **Step 2: Add the same keys to `en.json`**

Find:

```json
  "gerirclube.prize_placeholder": "e.g. Vouchers for the winners",
```

Replace with:

```json
  "gerirclube.prize_placeholder": "e.g. Vouchers for the winners",
  "gerirclube.has_voucher_label": "Has voucher",
  "gerirclube.has_voucher_hint": "Both players of the winning team each receive a voucher with the prize text above.",
```

Find:

```json
  "profile.tab_history": "History",
```

Replace with:

```json
  "profile.tab_history": "History",
  "profile.tab_vouchers": "Vouchers",
  "profile.vouchers_empty_title": "No vouchers yet",
  "profile.vouchers_empty_subtitle": "Vouchers won by winning mixes with a prize show up here.",
  "profile.voucher_status_por_usar": "Unused",
  "profile.voucher_status_usado": "Used",
  "profile.voucher_mark_used_action": "Mark as used",
  "profile.voucher_mark_used_confirm": "Mark this voucher as used? This can't be undone.",
  "profile.voucher_used_at": "Used on {{date}}",
  "profile.voucher_error_mark_used": "Couldn't mark the voucher as used.",
```

- [ ] **Step 3: Verify both files are still valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/locales/pt.json', 'utf8')); JSON.parse(require('fs').readFileSync('src/locales/en.json', 'utf8')); console.log('OK')"`
Expected: `OK` printed, no exception.

- [ ] **Step 4: Commit**

```bash
git add src/locales/pt.json src/locales/en.json
git commit -m "$(cat <<'EOF'
feat: i18n keys for the vouchers wallet (Trello #200)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011x8RPEBrD2mrnXhyJytueW
EOF
)"
```

---

## Task 3: `src/lib/vouchers.js` — pure wallet-ordering helper (TDD)

**Files:**
- Create: `src/lib/vouchers.js`
- Test: `src/lib/vouchers.test.js`

**Interfaces:**
- Produces: `sortVouchersForWallet(vouchers: Array<{status: string, created_at: string}>) => Array` — new array, `'por_usar'` entries before `'usado'`, newest `created_at` first within each group, input array never mutated. Consumed by Task 6 (`Profile.jsx`).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/vouchers.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { sortVouchersForWallet } from './vouchers'

describe('sortVouchersForWallet', () => {
  it('sorts por_usar vouchers before usado ones', () => {
    const input = [
      { id: 'a', status: 'usado', created_at: '2026-09-01T00:00:00Z' },
      { id: 'b', status: 'por_usar', created_at: '2026-09-01T00:00:00Z' },
    ]
    const result = sortVouchersForWallet(input)
    expect(result.map((v) => v.id)).toEqual(['b', 'a'])
  })

  it('within the same status, sorts newest created_at first', () => {
    const input = [
      { id: 'old', status: 'por_usar', created_at: '2026-09-01T00:00:00Z' },
      { id: 'new', status: 'por_usar', created_at: '2026-09-10T00:00:00Z' },
    ]
    const result = sortVouchersForWallet(input)
    expect(result.map((v) => v.id)).toEqual(['new', 'old'])
  })

  it('combines both rules: por_usar group newest-first, then usado group newest-first', () => {
    const input = [
      { id: 'usado-old', status: 'usado', created_at: '2026-08-01T00:00:00Z' },
      { id: 'por_usar-old', status: 'por_usar', created_at: '2026-09-01T00:00:00Z' },
      { id: 'usado-new', status: 'usado', created_at: '2026-09-05T00:00:00Z' },
      { id: 'por_usar-new', status: 'por_usar', created_at: '2026-09-10T00:00:00Z' },
    ]
    const result = sortVouchersForWallet(input)
    expect(result.map((v) => v.id)).toEqual(['por_usar-new', 'por_usar-old', 'usado-new', 'usado-old'])
  })

  it('does not mutate the input array', () => {
    const input = [
      { id: 'a', status: 'usado', created_at: '2026-09-01T00:00:00Z' },
      { id: 'b', status: 'por_usar', created_at: '2026-09-02T00:00:00Z' },
    ]
    const inputCopy = [...input]
    sortVouchersForWallet(input)
    expect(input).toEqual(inputCopy)
  })

  it('returns an empty array for empty input', () => {
    expect(sortVouchersForWallet([])).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/vouchers.test.js`
Expected: FAIL — `src/lib/vouchers.js` does not exist / `sortVouchersForWallet` is not exported.

- [ ] **Step 3: Implement `src/lib/vouchers.js`**

```js
// Ordering for the Profile page's "wallet" stack of voucher cards:
// unused vouchers are more actionable than used ones, so they sort first;
// within each group, the most recently awarded voucher sorts first.
export function sortVouchersForWallet(vouchers) {
  const rank = (v) => (v.status === 'por_usar' ? 0 : 1)
  return [...vouchers].sort((a, b) => rank(a) - rank(b) || new Date(b.created_at) - new Date(a.created_at))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/vouchers.test.js`
Expected: PASS, all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/vouchers.js src/lib/vouchers.test.js
git commit -m "$(cat <<'EOF'
feat: sortVouchersForWallet helper for the Profile vouchers tab (Trello #200)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011x8RPEBrD2mrnXhyJytueW
EOF
)"
```

---

## Task 4: `GerirClube.jsx` — "tem voucher" checkbox + `has_voucher` plumbing

**Files:**
- Modify: `src/pages/GerirClube.jsx`

**Interfaces:**
- Consumes: `gerirclube.has_voucher_label`, `gerirclube.has_voucher_hint` (Task 2).
- Produces: `gameForm.has_voucher` (boolean, defaults `false`), flowing into every `games`/`game_recurrences` insert/update this file makes.

- [ ] **Step 1: Add `has_voucher` to `gameForm`'s initial state**

Find (this file's `gameForm` initial-state object, the block containing `prize`):

```jsx
  latitude: null,
  longitude: null,
  price_per_player: '',
  prize: '',
  num_courts: 1,
```

Replace with:

```jsx
  latitude: null,
  longitude: null,
  price_per_player: '',
  prize: '',
  has_voucher: false,
  num_courts: 1,
```

(This alone is sufficient for the standalone/first-in-series mix: both the create and update submit handlers spread `...gameFields` — everything in `gameForm` except `recurrence` and `pool_size` — directly into the `games` insert/update payload, so `has_voucher` rides along automatically, exactly like `prize` already does.)

- [ ] **Step 2: Add `has_voucher` to `recurrenceSnapshotAndRule`**

Find:

```jsx
  const recurrenceSnapshotAndRule = (game, recurrence) => ({
    frequency: recurrence.frequency,
    ends_type: recurrence.endsType,
    ends_on: recurrence.endsType === 'on_date' ? new Date(`${recurrence.endsOn}T23:59:59`).toISOString() : null,
    ends_after_occurrences: recurrence.endsType === 'after_occurrences' ? parseInt(recurrence.endsAfterOccurrences, 10) : null,
    title: game.title,
    location: game.location,
    price_per_player: game.price_per_player,
    prize: game.prize,
    num_courts: game.num_courts,
```

Replace with:

```jsx
  const recurrenceSnapshotAndRule = (game, recurrence) => ({
    frequency: recurrence.frequency,
    ends_type: recurrence.endsType,
    ends_on: recurrence.endsType === 'on_date' ? new Date(`${recurrence.endsOn}T23:59:59`).toISOString() : null,
    ends_after_occurrences: recurrence.endsType === 'after_occurrences' ? parseInt(recurrence.endsAfterOccurrences, 10) : null,
    title: game.title,
    location: game.location,
    price_per_player: game.price_per_player,
    prize: game.prize,
    has_voucher: game.has_voucher,
    num_courts: game.num_courts,
```

- [ ] **Step 3: Add `has_voucher` to the client-side "pre-create next occurrence" insert**

Find:

```jsx
    const { error: pendingError } = await supabase
      .from('games')
      .insert([{
        organization_id: currentOrganizationId,
        title: game.title,
        date: nextDate.toISOString(),
        location: game.location,
        price_per_player: game.price_per_player,
        prize: game.prize,
        num_courts: game.num_courts,
```

Replace with:

```jsx
    const { error: pendingError } = await supabase
      .from('games')
      .insert([{
        organization_id: currentOrganizationId,
        title: game.title,
        date: nextDate.toISOString(),
        location: game.location,
        price_per_player: game.price_per_player,
        prize: game.prize,
        has_voucher: game.has_voucher,
        num_courts: game.num_courts,
```

- [ ] **Step 4: Add the checkbox next to the `prize` field**

Find:

```jsx
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {t('gerirclube.prize_label')}
                      </label>
                      <input
                        type="text"
                        value={gameForm.prize}
                        onChange={(e) => setGameForm({ ...gameForm, prize: e.target.value })}
                        className="input-field"
                        placeholder={t('gerirclube.prize_placeholder')}
                      />
                    </div>
```

Replace with:

```jsx
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {t('gerirclube.prize_label')}
                      </label>
                      <input
                        type="text"
                        value={gameForm.prize}
                        onChange={(e) => setGameForm({ ...gameForm, prize: e.target.value })}
                        className="input-field"
                        placeholder={t('gerirclube.prize_placeholder')}
                      />
                      <label className="flex items-center gap-3 cursor-pointer mt-3">
                        <input
                          type="checkbox"
                          checked={gameForm.has_voucher}
                          onChange={(e) => setGameForm({ ...gameForm, has_voucher: e.target.checked })}
                          className="w-5 h-5"
                        />
                        <span className="text-sm text-ink-900">{t('gerirclube.has_voucher_label')}</span>
                      </label>
                      {gameForm.has_voucher && (
                        <p className="text-[11px] text-muted mt-1">{t('gerirclube.has_voucher_hint')}</p>
                      )}
                    </div>
```

- [ ] **Step 5: Populate `has_voucher` when opening the edit form for an existing game**

Find:

```jsx
      location: game.location || '',
      latitude: game.latitude ?? null,
      longitude: game.longitude ?? null,
      price_per_player: game.price_per_player ?? '',
      prize: game.prize || '',
      num_courts: game.num_courts || 1,
```

Replace with:

```jsx
      location: game.location || '',
      latitude: game.latitude ?? null,
      longitude: game.longitude ?? null,
      price_per_player: game.price_per_player ?? '',
      prize: game.prize || '',
      has_voucher: game.has_voucher || false,
      num_courts: game.num_courts || 1,
```

- [ ] **Step 6: Build verification**

Run: `npm run build`
Expected: builds successfully.

- [ ] **Step 7: Commit**

```bash
git add src/pages/GerirClube.jsx
git commit -m "$(cat <<'EOF'
feat: "tem voucher" checkbox on mix creation/edit (Trello #200)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011x8RPEBrD2mrnXhyJytueW
EOF
)"
```

---

## Task 5: `VoucherCard` component (`src/components/ui.jsx`)

**Files:**
- Modify: `src/components/ui.jsx`

**Interfaces:**
- Produces: `VoucherCard({ prizeText, gameTitle, gameDate, organizationName, status, usedAtLabel, onMarkUsed })` — presentational, no data fetching. `status` is `'por_usar'` or `'usado'`; `gameDate` and `usedAtLabel` arrive already formatted by the caller. Consumed by Task 6 (`Profile.jsx`).

- [ ] **Step 1: Add `VoucherCard`, exported right after `AchievementCard`**

Find (the end of `AchievementCard`, immediately before the `PhotoViewerModal` section comment):

```jsx
      </div>
    </div>
  )
}

/* ─── PhotoViewerModal ───────────────────────────────────────────────────
```

Replace with:

```jsx
      </div>
    </div>
  )
}

/* ─── VoucherCard ─────────────────────────────────────────────────────────
   A voucher won for finishing a has_voucher mix as the winning team.
   Presentational only — gameDate/usedAtLabel arrive pre-formatted from the
   caller (Profile.jsx already has a formatMixDate-style helper for mix
   dates; reuse it, and the same formatting for usedAt), so this component
   needs i18n only for its own status/action labels. Visual grammar
   mirrors AchievementCard: rounded card, border/fill driven by state, a
   status pill — 'por_usar' gets the brand lime accent and an action;
   'usado' is grayed out and inert. */
export function VoucherCard({ prizeText, gameTitle, gameDate, organizationName, status, usedAtLabel, onMarkUsed }) {
  const { t } = useTranslation()
  const used = status === 'usado'
  return (
    <div className={`rounded-2xl border-2 p-4 bg-surface ${used ? 'border-ink-100 opacity-70' : 'border-lime-400 shadow-card'}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-mono font-extrabold uppercase tracking-wide text-muted truncate">{organizationName}</p>
        <span className={`px-1.5 py-px rounded-full text-[9px] font-mono font-extrabold uppercase tracking-wide ${used ? 'bg-ink-50 text-muted' : 'bg-lime-100 text-lime-700'}`}>
          {t(`profile.voucher_status_${status}`)}
        </span>
      </div>
      <p className="mt-1 text-sm font-extrabold text-ink-900">{gameTitle}</p>
      <p className="text-[11px] text-muted">{gameDate}</p>
      <p className="mt-2 text-sm text-ink-900 leading-snug">{prizeText}</p>
      {!used && (
        <button onClick={onMarkUsed} className="mt-3 text-[12px] font-extrabold text-lime-700 press">
          {t('profile.voucher_mark_used_action')}
        </button>
      )}
      {used && <p className="mt-3 text-[10px] text-ink-200">{t('profile.voucher_used_at', { date: usedAtLabel })}</p>}
    </div>
  )
}

/* ─── PhotoViewerModal ───────────────────────────────────────────────────
```

`useTranslation` is already imported at the top of this file (line 4); no new import needed for this step.

- [ ] **Step 2: Build verification**

Run: `npm run build`
Expected: builds successfully (an unused-export warning is fine — `Profile.jsx` starts importing `VoucherCard` in Task 6).

- [ ] **Step 3: Commit**

```bash
git add src/components/ui.jsx
git commit -m "$(cat <<'EOF'
feat: VoucherCard component (Trello #200)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011x8RPEBrD2mrnXhyJytueW
EOF
)"
```

---

## Task 6: `Profile.jsx` — "Vouchers" tab, wallet stack, mark-used flow

**Files:**
- Modify: `src/pages/Profile.jsx`

**Interfaces:**
- Consumes: `VoucherCard` (Task 5), `sortVouchersForWallet` (Task 3), `profile.tab_vouchers` / `profile.vouchers_empty_title` / `profile.vouchers_empty_subtitle` / `profile.voucher_mark_used_confirm` / `profile.voucher_error_mark_used` / `profile.voucher_used_at` (Task 2), `mark_voucher_used` RPC (Task 1).
- Produces: third Profile tab (`key: 'vouchers'`), reading `vouchers` (RLS-scoped to the signed-in user) and rendering the stacked wallet.

- [ ] **Step 1: Add `Ticket` to this file's lucide-react import**

Find:

```jsx
import { User, Award, Trophy, LineChart, LogOut, Camera, HelpCircle, ThumbsUp, Trash2, Users, ChevronRight, ArrowLeft, Eye, X } from 'lucide-react'
```

Replace with:

```jsx
import { User, Award, Trophy, LineChart, LogOut, Camera, HelpCircle, ThumbsUp, Trash2, Users, ChevronRight, ArrowLeft, Eye, X, Ticket } from 'lucide-react'
```

- [ ] **Step 2: Import `VoucherCard` and `sortVouchersForWallet`**

Find:

```jsx
import { PrimaryButton, GuestBadge, DateField, Avatar, Select, EmptyState, RatingBadge, PhotoViewerModal, FollowListModal, AchievementCard } from '../components/ui'
```

Replace with:

```jsx
import { PrimaryButton, GuestBadge, DateField, Avatar, Select, EmptyState, RatingBadge, PhotoViewerModal, FollowListModal, AchievementCard, VoucherCard } from '../components/ui'
```

Find:

```jsx
import { formatDate as formatDateLib } from '../lib/formatDate'
```

Replace with:

```jsx
import { formatDate as formatDateLib } from '../lib/formatDate'
import { sortVouchersForWallet } from '../lib/vouchers'
```

- [ ] **Step 3: Add the `vouchers` tab to `TABS`**

Find:

```jsx
const TABS = [
  { key: 'perfil', labelKey: 'profile.tab_profile' },
  { key: 'historico', labelKey: 'profile.tab_history' },
]
```

Replace with:

```jsx
const TABS = [
  { key: 'perfil', labelKey: 'profile.tab_profile' },
  { key: 'historico', labelKey: 'profile.tab_history' },
  { key: 'vouchers', labelKey: 'profile.tab_vouchers' },
]
```

- [ ] **Step 4: Add `vouchers`/`vouchersLoading` state**

Find:

```jsx
  const [mixHistory, setMixHistory] = useState([])
  const [mixHistoryLoading, setMixHistoryLoading] = useState(true)
```

Replace with:

```jsx
  const [mixHistory, setMixHistory] = useState([])
  const [mixHistoryLoading, setMixHistoryLoading] = useState(true)
  const [vouchers, setVouchers] = useState([])
  const [vouchersLoading, setVouchersLoading] = useState(true)
```

- [ ] **Step 5: Load vouchers eagerly on mount, alongside `loadMixHistory`**

Find:

```jsx
      if (!isGuest) {
        loadMixHistory()
        loadPrivateMatchHistory()
        loadGlobalPoints()
        loadFollowCounts()
        loadKudos()
        loadTrophies()
      }
```

Replace with:

```jsx
      if (!isGuest) {
        loadMixHistory()
        loadPrivateMatchHistory()
        loadGlobalPoints()
        loadFollowCounts()
        loadKudos()
        loadTrophies()
        loadVouchers()
      }
```

- [ ] **Step 6: Add the `loadVouchers` and `handleMarkVoucherUsed` functions**

Find (the start of `loadMixHistory`, to insert the new functions directly before it — keeping the "loaders defined in the same order they're called" convention this file already follows):

```jsx
  const loadMixHistory = async () => {
```

Replace with:

```jsx
  const loadVouchers = async () => {
    setVouchersLoading(true)
    try {
      const { data, error } = await supabase
        .from('vouchers')
        .select('id, status, used_at, created_at, game:games (id, title, date, prize, organization:organizations (name))')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      setVouchers(data || [])
    } catch (error) {
      // Treated the same as "no vouchers" — covers both a genuinely empty
      // wallet and migration_vouchers.sql not having been run yet in this
      // environment (relation "vouchers" does not exist), matching how
      // player_trophies already fails soft when its own migration is missing.
      console.error('Error loading vouchers:', error)
      setVouchers([])
    } finally {
      setVouchersLoading(false)
    }
  }

  const handleMarkVoucherUsed = async (voucherId) => {
    if (!confirm(t('profile.voucher_mark_used_confirm'))) return
    const { error } = await supabase.rpc('mark_voucher_used', { p_voucher_id: voucherId })
    if (error) {
      console.error('Error marking voucher used:', error)
      alert(t('profile.voucher_error_mark_used'))
      return
    }
    setVouchers((prev) => prev.map((v) => (
      v.id === voucherId ? { ...v, status: 'usado', used_at: new Date().toISOString() } : v
    )))
  }

  const loadMixHistory = async () => {
```

- [ ] **Step 7: Render the "Vouchers" tab**

Find (the end of the `historico` tab block — its closing `</>` and `)}`, right before the outer content wrapper closes):

```jsx
            )}
          </div>
        )}
        </>
      )}
    </div>
  )
}
```

Replace with:

```jsx
            )}
          </div>
        )}
        </>
      )}

      {tab === 'vouchers' && (
        !vouchersLoading && (
          vouchers.length === 0 ? (
            <EmptyState
              icon={Ticket}
              title={t('profile.vouchers_empty_title')}
              subtitle={t('profile.vouchers_empty_subtitle')}
            />
          ) : (
            <div className="pt-1">
              {sortVouchersForWallet(vouchers).map((v, i, arr) => (
                <div
                  key={v.id}
                  style={{ marginTop: i === 0 ? 0 : -16, zIndex: arr.length - i, position: 'relative' }}
                >
                  <VoucherCard
                    prizeText={v.game?.prize || ''}
                    gameTitle={v.game?.title || ''}
                    gameDate={v.game?.date ? formatDateLib(v.game.date, i18n.language, { day: '2-digit', month: 'short', year: 'numeric' }) : ''}
                    organizationName={v.game?.organization?.name || ''}
                    status={v.status}
                    usedAtLabel={v.used_at ? formatDateLib(v.used_at, i18n.language, { day: '2-digit', month: 'short', year: 'numeric' }) : ''}
                    onMarkUsed={() => handleMarkVoucherUsed(v.id)}
                  />
                </div>
              ))}
            </div>
          )
        )
      )}
    </div>
  )
}
```

`i18n` is already destructured from `useTranslation()` at the top of this component (`const { t, i18n } = useTranslation()`), and `formatDateLib` is already imported — both reused here rather than adding anything new.

- [ ] **Step 8: Build verification**

Run: `npm run build`
Expected: builds successfully.

- [ ] **Step 9: Commit**

```bash
git add src/pages/Profile.jsx
git commit -m "$(cat <<'EOF'
feat: Profile "Vouchers" tab — wallet-style list + mark-as-used (Trello #200)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011x8RPEBrD2mrnXhyJytueW
EOF
)"
```

---

## Task 7: Final verification pass

**Files:** none (verification only — no changes expected; if any of these checks fail, fix in the relevant earlier task's files and re-commit there, don't patch around it here).

- [ ] **Step 1: Grep for stray references**

Run: `grep -rn "has_voucher\|mark_voucher_used\|sortVouchersForWallet\|VoucherCard" src/ supabase/migration_vouchers.sql`
Expected: matches only in the files this plan touched (Tasks 1, 3, 4, 5, 6) — `supabase/migration_vouchers.sql`, `src/lib/vouchers.js`, `src/lib/vouchers.test.js`, `src/pages/GerirClube.jsx`, `src/components/ui.jsx`, `src/pages/Profile.jsx`. No stray partial edits elsewhere.

- [ ] **Step 2: Full build + test verification**

Run: `npm run build`
Expected: builds successfully.

Run: `npx vitest run`
Expected: PASS, including the 5 new `src/lib/vouchers.test.js` cases from Task 3 — this is otherwise a pure regression check that nothing else in the repo's existing pure-logic test suite broke.

- [ ] **Step 3: Manual verification pass**

If Task 1's migration has been confirmed run against the environment being tested: walk the flow end to end using the `import.meta.env.DEV` "Entrar como Admin" shortcut — create a mix with "tem voucher" checked and a `prize` filled in, play it out, finalize it as the winning team, open that winning player's Profile → Vouchers tab, confirm the card renders with the right prize text/mix title/date/club name and a `por_usar` pill, tap "marcar como usado", confirm the `confirm()` dialog appears and cancelling leaves the card unchanged, confirm accepting flips it to the `usado` visual state without a reload. Also check: empty state for a player with zero vouchers; wallet stack visual ordering and overlap with 3+ mixed-status vouchers; mobile viewport (~400px) — text doesn't overflow, the "marcar como usado" button stays reachable on every card. Run through Task 1 Step 8's SQL checks too if there's SQL Editor access in this environment.

If the migration has **not** been confirmed run yet in the environment being tested: state that explicitly in the report, note that Steps 1-2 of this task (grep + build + vitest) are still fully valid since they don't touch a live database, and list exactly the manual pass above as what's still pending once a human runs `supabase/migration_vouchers.sql` in Supabase → SQL Editor.

- [ ] **Step 4: Report**

No commit in this task (nothing changed). Summarize in the final report: which of Steps 1-3 passed, and — regardless of outcome — restate explicitly that `supabase/migration_vouchers.sql` is not live in production until a human runs it in the Supabase SQL Editor, since that's true independent of anything this task can verify locally.
