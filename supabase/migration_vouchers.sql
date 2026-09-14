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

-- ── 1. has_voucher flag on games + game_recurrences ─────────────────────

ALTER TABLE games            ADD COLUMN IF NOT EXISTS has_voucher BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE game_recurrences ADD COLUMN IF NOT EXISTS has_voucher BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 2. vouchers table, indexes, RLS ──────────────────────────────────────

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
-- No INSERT/UPDATE/DELETE policies — only finalize_mix() (award, below)
-- and mark_voucher_used() (redeem, below) write this table.

-- ── 3. mark_voucher_used — redeem ────────────────────────────────────────

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

-- ── 4. finalize_mix — award step ─────────────────────────────────────────
-- Redefined wholesale (current live body: supabase/migration_trophies.sql,
-- confirmed most recent via git log as of this migration) with one new
-- block added after the trophies PERFORM and before END.

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

-- ── 5. process_due_game_recurrences — propagate has_voucher ──────────────
-- Redefined wholesale (current live body: supabase/migration_whatsapp_groups.sql,
-- confirmed most recent via git log as of this migration), has_voucher /
-- rec.has_voucher added next to prize / rec.prize.

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

-- ── 6. Manual verification (run once this migration is live) ────────────
-- These checks depend on a human pasting this file into a real Supabase
-- project's SQL Editor first — they cannot run as part of this file.
--
-- 1. Award: create/finalize a has_voucher=true mix, then:
-- SELECT game_id, user_id, status FROM vouchers WHERE game_id = '<the finalized game id>';
-- Expect: exactly 2 rows, user_id = the winning team's two players.
--
-- 2. Idempotency: re-run just the award block's INSERT manually with the
--    same game_id/winner_team_id — expect 0 rows affected (ON CONFLICT).
--
-- 3. Redeem, as the voucher's own owner (run with that user's session):
-- SELECT mark_voucher_used('<voucher id>');
-- SELECT status, used_at FROM vouchers WHERE id = '<voucher id>';
-- Expect: status = 'usado', used_at set.
--
-- 4. Redeem again — expect an exception ("Voucher não encontrado ou já usado").
--
-- 5. Redeem as a DIFFERENT authenticated user — expect the same exception
--    (their auth.uid() doesn't match user_id, so 0 rows match, NOT FOUND).
--
-- 6. RLS: as a non-winning participant of the same mix, or a member of a
--    different organization, SELECT * FROM vouchers WHERE id = '<voucher id>'
--    — expect 0 rows back (not an error — RLS silently filters).
--
-- 7. Recurrence propagation: create a recurring mix series with
--    has_voucher=true, confirm the pre-created next occurrence
--    (games row, status='pending') already has has_voucher=true, then
--    (or via a manual call to process_due_game_recurrences()) confirm a
--    further spawned occurrence also has has_voucher=true.
