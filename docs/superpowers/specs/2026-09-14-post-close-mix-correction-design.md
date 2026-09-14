# Post-close mix result correction — design spec

Trello #257 (P0). "Corrigir resultado depois do jogo/mix já ter terminado."

Status: brainstormed and approved with Renato in a prior session; this
document records that decision for implementation. Split off from an
earlier card that covered correcting a score while a mix is still
`in_progress` — that half already shipped (`src/pages/GameDetails.jsx`,
the `canEditScores`/`editingMatchId` flow around line 2150, Trello #184).
This card is specifically about correcting a `matches` score **after**
`finalize_mix` has already run (`games.status = 'finished'`). Today
there is no way to do that — the only workaround anyone has found is
deleting and recreating the whole mix. Real incident: Ruben/Francisco,
2026-09-08, via WhatsApp.

## 1. Problem

`finalize_mix` writes to five places in one transaction: `matches`
(already scored before finalize), `games.status`/`winner_team_id`,
`player_stats` (club-scoped totals), `mix_player_stats` (per-mix
snapshot), `xp_events`/`profiles.xp`, `profiles.rating`/`rating_games`
(via `apply_mix_elo`), `achievements`/`player_achievements` (via
`check_and_award_trophies`), and — since 2026-09-14 — `vouchers`. A
wrong score discovered after finalize currently can't be fixed without
touching all of these by hand in the SQL editor, which is exactly the
kind of thing that shouldn't require SQL access.

## 2. Goals

- Let a club admin correct one `matches` row's score inside an
  already-`finished` mix, and have every downstream table that
  `finalize_mix` populated come back into a consistent state
  automatically.
- Make the one genuinely irreversible part of this (Elo, see §5.3)
  either safe to redo or explicitly skipped and explained — never
  silently wrong.
- Keep the UI change small: reuse the score-edit widget that already
  exists for the `in_progress` case, extended to also work when
  `finished`.

## 3. Non-goals / explicit scope boundaries

- **`private_matches` (jogos entre amigos) and `group_matches`
  (torneios) are out of scope.** `group_matches` already has its own
  post-close correction (`propose_group_match_correction` /
  `accept_group_match_correction`, `supabase/migration_group_matches.sql`
  + `supabase/migration_group_matches_review_fixes.sql`) built around a
  propose/peer-accept workflow, because a `group_matches` result can be
  submitted by a non-admin participant. This feature deliberately does
  **not** reuse that shape (see §4).
- **Americano-format mixes are out of scope.** `finalize_americano_mix`
  (`supabase/migration_americano_format.sql`) has no `p_winner_team_id`
  parameter and never sets `games.winner_team_id` — Americano scores
  individual players across rotating partners, not a fixed winning
  team. The "corrected match → new mix winner team" flow this design
  builds has no equivalent there. The correction RPC rejects any mix
  with `format = 'americano'` outright (discovered while reading
  `finalize_americano_mix`; not something Renato was asked about
  separately, since it falls straight out of "the `finalize_mix` RPC's
  own tables" framing already agreed).
- **No un-award of achievements** (formerly "trophies" — renamed
  2026-09-10, see §5.4) and **no un-redemption of a used voucher** —
  both are deliberate, see §5.4 and §5.5.
- **No correction-history / audit table.** The corrected `matches` row
  simply holds its new score; nothing records what the wrong score
  used to be, beyond Postgres's own WAL/backups. This mirrors both the
  existing `in_progress` correction (`handleSaveScore` already does a
  bare overwrite) and `group_matches`' correction (also a bare
  overwrite once accepted) — neither keeps history, so this doesn't
  introduce a new gap, it stays consistent with precedent. Worth
  reconsidering later if support/QA needs ever come up, but adding it
  now would be scope creep against an approved design.
- **One match per correction call.** If more than one match in the
  same finished mix is wrong, the admin corrects them one at a time
  (each call recomputes the mix's full standings from whatever
  `matches` rows exist at that moment, so sequential calls compose
  correctly — see §5.2).

## 4. Why a direct admin action, not propose/accept

`finalize_mix` already requires the caller to be a club admin
(`RAISE EXCEPTION 'Apenas admins podem finalizar um mix'`, current live
body: `supabase/migration_vouchers.sql` §4, confirmed most recent via
`git log` as of 2026-09-14 — newer than `migration_trophies.sql`).
Since only an admin could have produced the original result, a
correction needs no separate peer-approval step — unlike
`group_matches`, where a non-admin participant can submit a result and
so a non-admin-submitted result needs peer consensus to correct.
Renato explicitly chose "só admins" over "qualquer participante pode
propor, admin valida" specifically to avoid building that two-step
machinery here. This is a **direct, immediate** admin action: pick a
finished mix, correct one match's score, the system recomputes and
applies right away — gated by a frontend `confirm()` (this repo's
standing rule for irreversible actions, `CLAUDE.md` "Things that have
bitten people before") since this genuinely touches rating/points/XP,
but no server-side approval step.

## 5. Architecture

### 5.1 Components

| Component | Change |
|---|---|
| `supabase/migration_post_close_mix_correction.sql` (new) | One new `SECURITY DEFINER` RPC, `correct_finished_mix_match`. No new tables, no new columns — every table it touches already exists. |
| `src/pages/GameDetails.jsx` | Extend the existing score-correction UI (`editingMatchId`, `canEditScores`, the `ScoreEntry` block in the "rondas" tab) to also render for admins when `game.status === 'finished'`; new handler calls the RPC instead of the plain `matches` update, gated by `confirm()`, and surfaces the RPC's structured result. |
| `src/lib/mixLogic.js` | **No changes.** `standings()` is reused as-is (read-only, called against a locally-patched `matches` array — see §5.2). |
| i18n (`pt-PT` strings used by `GameDetails.jsx`) | New keys for the correction affordance, confirm prompt, and result summary — see §5.2 and §8. |

### 5.2 Client-side: computing `p_new_winner_team_id`

Mirroring how `finalize_mix` itself is called today (`handleFinalize`,
`GameDetails.jsx` line ~1226: `finalize_mix(p_game_id, p_winner_team_id)`
where `p_winner_team_id` is computed client-side by `currentWinnerTeamId`
and passed in explicitly — `games.winner_team_id` is never computed in
SQL), the correction RPC also takes an explicit
`p_new_winner_team_id UUID` parameter instead of recomputing the mix
winner in SQL.

`currentWinnerTeamId` (`GameDetails.jsx` line ~1122) is **not** a bare
call to `standings()` — it's format-aware: `sobe_desce` walks rounds
from the most recent backwards looking for a completed court-1 match
before falling back to `standings()`; other formats look for a
`phase === 'final'` match before falling back to `standings()`;
`americano` returns `null` (out of scope here anyway, §3). Reusing
"the same pattern" correctly means reusing this *exact* derivation —
not calling `standings()` alone, which would silently mis-detect the
winner for `sobe_desce` and elimination-bracket mixes.

Concretely, correcting a match works like this:

1. Admin opens the score editor on a finished mix's match (same
   `ScoreEntry` component, editable now that `game.status === 'finished'`
   is also allowed for admins — see §7).
2. On save, before calling the RPC, the client builds a **local**
   `matches` array: the current `matches` state with the one edited
   match's `score_a`/`score_b`/`winner_team_id` replaced by the new
   values (winner = higher score, same rule `handleSaveScore` already
   uses: `a > b ? match.team_a_id : match.team_b_id`).
3. It runs the *same* `currentWinnerTeamId`-style derivation (extract
   the existing IIFE at line 1122 into a small named helper,
   `computeMixWinnerTeamId(game, teams, matches)`, so both the live
   `currentWinnerTeamId` value and the correction flow call the same
   code — this is the one small refactor this feature needs) against
   that locally-patched array to get the new mix winner.
4. It calls `correct_finished_mix_match(p_match_id, p_new_score_a,
   p_new_score_b, p_new_winner_team_id)`.
5. On success, it reloads mix details (`loadGameDetails()`, same as
   every other mutation in this file) and shows the result summary
   (§8).

This keeps all standings math in one place (JS, tested, already
correct for every format) and the RPC free of duplicating it, per the
locked-in decision.

### 5.3 The RPC: `correct_finished_mix_match`

```
correct_finished_mix_match(
  p_match_id UUID,
  p_new_score_a INTEGER,
  p_new_score_b INTEGER,
  p_new_winner_team_id UUID,
  p_sets JSONB DEFAULT NULL
) RETURNS JSONB
```

`p_sets` mirrors `handleSaveScore`'s existing `finalScore.sets` —
present only for `melhor_2_sets`/`melhor_3_sets` mixes (via
`SetsScoreEntry`'s `onSave({ score_a, score_b, sets })`), `null` for
`pontos_simples`/`pro_set_9`. `match_sets` is a pure detail/display
table — nothing in `pcalc`, `apply_mix_elo`, or `apply_elo_pairing`
reads it, only `matches.score_a`/`score_b`/`winner_team_id` — so
handling it is a self-contained extra step (§5.3 step 2) with no
interaction with the rest of the correction logic.

Returns a small JSON summary the frontend uses to build the result
message (§8):

```json
{
  "new_winner_team_id": "uuid",
  "winner_changed": true,
  "elo_applied": false,
  "elo_skip_reason": "later_elo_event",
  "voucher_not_reverted": false
}
```

`elo_skip_reason` is `null` when `elo_applied` is `true`; otherwise one
of `"later_elo_event"` or `"untracked_participant"` (see the Elo step
below).
`voucher_not_reverted` is `true` only when `games.has_voucher` and the
old winning team's voucher had already been redeemed (§5.5).

**Body, step by step** (full `CREATE OR REPLACE FUNCTION`, built from
the actually-live source of every function it touches, is written at
implementation time per this repo's migration convention — the
sequence and every query shape below is final; verify at
implementation time which files currently define `finalize_mix` /
`apply_mix_elo` / `apply_elo_pairing` / `check_and_award_trophies`
have not been superseded again since 2026-09-14, the same way this
spec did via `git log`):

**1. Lock and validate.**

```sql
SELECT * INTO v_match FROM matches WHERE id = p_match_id FOR UPDATE;
-- not found → 'Jogo não encontrado'

SELECT * INTO v_game FROM games WHERE id = v_match.game_id FOR UPDATE;
-- not found → 'Mix não encontrado'

IF v_game.status <> 'finished' THEN
  RAISE EXCEPTION 'Este mix não está terminado — usa a correção normal de resultado';
END IF;
IF v_game.format = 'americano' THEN
  RAISE EXCEPTION 'A correção pós-fecho não está disponível para mixes Americano';
END IF;

-- admin check, identical shape to finalize_mix
IF NOT EXISTS (
  SELECT 1 FROM memberships
  WHERE organization_id = v_game.organization_id AND user_id = auth.uid() AND is_admin
) THEN
  RAISE EXCEPTION 'Apenas admins podem corrigir um resultado depois do mix terminado';
END IF;

IF p_new_score_a IS NULL OR p_new_score_b IS NULL OR p_new_score_a = p_new_score_b
   OR p_new_score_a < 0 OR p_new_score_b < 0 THEN
  RAISE EXCEPTION 'Resultado inválido';
END IF;
IF NOT EXISTS (SELECT 1 FROM teams WHERE id = p_new_winner_team_id AND game_id = v_game.id) THEN
  RAISE EXCEPTION 'Dupla vencedora inválida';
END IF;
```

Note this deliberately checks admin status directly — **not**
`isScorekeeper` (a UI-level convenience role for entering scores
during play, not a security boundary; only the admin check here is
what actually gates this, per `CLAUDE.md`'s "Security is RLS, not the
UI").

**2. Apply the corrected match.**

```sql
v_old_winner_team_id := v_game.winner_team_id;

UPDATE matches
SET score_a = p_new_score_a,
    score_b = p_new_score_b,
    winner_team_id = CASE WHEN p_new_score_a > p_new_score_b THEN v_match.team_a_id ELSE v_match.team_b_id END
WHERE id = p_match_id;

-- Same delete-then-insert handleSaveScore already uses for corrections
-- (idempotent, no per-set upsert logic needed) — only when the format
-- actually sends per-set rows.
IF p_sets IS NOT NULL THEN
  DELETE FROM match_sets WHERE match_id = p_match_id;
  INSERT INTO match_sets (match_id, set_number, score_a, score_b, is_super_tiebreak)
  SELECT p_match_id, ROW_NUMBER() OVER (), (s->>'score_a')::int, (s->>'score_b')::int,
         COALESCE((s->>'is_super_tiebreak')::boolean, FALSE)
  FROM jsonb_array_elements(p_sets) AS s;
END IF;

v_winner_changed := (p_new_winner_team_id IS DISTINCT FROM v_old_winner_team_id);
```

**3. Points and mix-participation XP — recompute-and-diff.**

Re-run `finalize_mix`'s own `pcalc` CTE shape, now reading the
just-updated `matches` and using `p_new_winner_team_id`, across
**every** player in the mix (not just the corrected match's four —
the mix-level winner can flip who `won_mix`, which reaches every
player in the mix, while `matches_played`/`matches_won` only actually
move for the two teams in the corrected match; running the full CTE
for everyone and letting unaffected rows diff to zero is simpler and
provably correct than trying to filter down first):

A CTE only scopes over the one statement it's attached to, and this
needs to feed two separate `UPDATE`s (`player_stats` then
`mix_player_stats`) — so, following the same idiom `apply_mix_elo`
already uses for its own per-mix working set (`CREATE TEMP TABLE
_elo_night ... ON COMMIT DROP`), materialize `pcalc` into a temp table
first:

```sql
CREATE TEMP TABLE IF NOT EXISTS _mix_pcalc (
  pid UUID PRIMARY KEY, played INT, wins INT, losses INT, won_mix BOOLEAN, pts INT
) ON COMMIT DROP;
TRUNCATE _mix_pcalc;

INSERT INTO _mix_pcalc
WITH mt AS (
  SELECT m.winner_team_id AS win_id, t.id AS team_id, t.player1_id, t.player2_id
  FROM matches m JOIN teams t ON t.id = m.team_a_id OR t.id = m.team_b_id
  WHERE m.game_id = v_game.id
),
pp AS (SELECT unnest(ARRAY[player1_id, player2_id]) AS pid, (team_id = win_id) AS won FROM mt),
agg AS (
  SELECT pid, COUNT(*) played, COUNT(*) FILTER (WHERE won) wins, COUNT(*) FILTER (WHERE NOT won) losses
  FROM pp WHERE pid IS NOT NULL GROUP BY pid
),
scored AS (
  SELECT a.pid, a.played, a.wins, a.losses,
         (a.pid IN (SELECT unnest(ARRAY[player1_id, player2_id]) FROM teams WHERE id = p_new_winner_team_id)) AS won_mix
  FROM agg a JOIN memberships mb ON mb.user_id = a.pid AND mb.organization_id = v_game.organization_id AND NOT mb.is_guest
)
SELECT pid, played, wins, losses, won_mix,
       (played * COALESCE((rules->>'point_per_match_played')::int, 0)
        + wins * COALESCE((rules->>'point_per_match_win')::int, 0)
        + COALESCE((rules->>'point_per_mix_participation')::int, 0)
        + CASE WHEN won_mix THEN COALESCE((rules->>'point_per_mix_win')::int, 0) ELSE 0 END) AS pts
FROM scored;

-- diff each row against the existing mix_player_stats row, apply the delta:
UPDATE player_stats ps
SET game_wins    = ps.game_wins    + (c.wins   - old.matches_won),
    game_losses  = ps.game_losses  + (c.losses - (old.matches_played - old.matches_won)),
    mix_wins     = ps.mix_wins     + (c.won_mix::int - old.mix_won::int),
    total_points = ps.total_points + (c.pts    - old.points_earned),
    updated_at   = NOW()
FROM _mix_pcalc c JOIN mix_player_stats old ON old.game_id = v_game.id AND old.user_id = c.pid
WHERE ps.user_id = c.pid AND ps.organization_id = v_game.organization_id;
-- mixes_played never changes — the correction doesn't add or remove a
-- match, only rescores one, so mixes_played (a "1 per mix played"
-- counter, not a match count) is unaffected.

UPDATE mix_player_stats mps
SET matches_played = c.played,
    matches_won    = c.wins,
    points_earned  = c.pts,
    mix_won        = c.won_mix
FROM _mix_pcalc c
WHERE mps.game_id = v_game.id AND mps.user_id = c.pid;
```

(`rules` loaded the same way `finalize_mix` does: `SELECT points_rules
FROM organizations WHERE id = v_game.organization_id`, same default
fallback JSON if null.)

**4. `mix_win` XP — insert/delete, not update-in-place.**

`xp_events` has `amount INTEGER NOT NULL CHECK (amount > 0)` — there is
no stored zero-amount row to "flip" between 0 and 30. `finalize_mix`'s
own `xp_rows` CTE only ever inserts a `mix_win` row for players
`WHERE won_mix` (losers get no `mix_win` row at all, not a 0-amount
one). So a flip in who won the mix is an **insert** for newly-winning
players and a **delete** for players who lost the win, not an
in-place amount update:

```sql
-- players who WERE on the old winning team, now aren't:
WITH losers_of_flip AS (
  SELECT unnest(ARRAY[player1_id, player2_id]) AS pid
  FROM teams WHERE id = v_old_winner_team_id
  EXCEPT
  SELECT unnest(ARRAY[player1_id, player2_id]) FROM teams WHERE id = p_new_winner_team_id
)
DELETE FROM xp_events
WHERE kind = 'mix_win' AND source_game_id = v_game.id
  AND user_id IN (SELECT pid FROM losers_of_flip WHERE pid IS NOT NULL);
-- subtract 30 * (rows deleted) from each affected profiles.xp

-- players who are NEWLY on the winning team:
WITH new_winners AS (
  SELECT unnest(ARRAY[player1_id, player2_id]) AS pid
  FROM teams WHERE id = p_new_winner_team_id
  EXCEPT
  SELECT unnest(ARRAY[player1_id, player2_id]) FROM teams WHERE id = v_old_winner_team_id
)
INSERT INTO xp_events (user_id, organization_id, kind, source_game_id, amount, occurred_at)
SELECT pid, v_game.organization_id, 'mix_win', v_game.id, 30, v_game.date
FROM new_winners WHERE pid IS NOT NULL
ON CONFLICT (user_id, kind, source_game_id) WHERE source_game_id IS NOT NULL DO NOTHING;
-- add 30 to each affected profiles.xp
```

Both sets are empty (no-op) when `v_winner_changed` is false. The
`ON CONFLICT DO NOTHING` guard on the insert is defensive (matches
`finalize_mix`'s own pattern) in case of a retried call after a
partial failure — see §6.

`mix_participation` (flat 20) and `mix_games` (`played * 5`) are
**not touched**: nobody's `played` count changes from a same-match-count
score correction, only who won which match.

**5. Elo — conditional revert + reapply.**

`apply_mix_elo` (current live body: `supabase/migration_elo_partner_shield.sql`,
confirmed most recent via `git log -1` across the four files that
define it, as of 2026-09-14 — re-verify at implementation time) does a
**cumulative, sequential** `UPDATE profiles SET rating = rating +
delta` across every player who had a match in the mix, including a
"mix win bonus" that's explicitly redistributed *from every other
participant's current rating* (`apply_mix_elo`'s bonus block: winners
and perfect-record players get a positive bonus; everyone else in the
same `_elo_night` set pays for it proportionally to their rating, so
the bonus nets to zero across the **whole** mix roster, not just the
corrected match's four players). Every later mix or private match's
Elo calculation depends on `profiles.rating` *at the time it ran*, not
on a historical snapshot — so reverting and reapplying is only
mathematically sound if **no later Elo-affecting event has happened
since, for anyone whose rating this mix touched.**

**Affected-player set.** Not "the corrected match's four
players" — the bonus redistribution above means Elo revert/reapply is
all-or-nothing across **every player who appears in any match of this
mix**, i.e.:

```sql
v_mix_players := ARRAY(
  SELECT DISTINCT unnest(ARRAY[t.player1_id, t.player2_id])
  FROM matches m
  JOIN teams t ON t.id = m.team_a_id OR t.id = m.team_b_id
  WHERE m.game_id = v_game.id
);
```

**Untracked-participant guard.** `mix_player_stats` rows are
only inserted for non-guest members (`finalize_mix`'s `scored` CTE
joins `memberships ... AND NOT mb.is_guest`), but `apply_mix_elo`
applies Elo to **every** player in the match, guest or not — it reads
straight from `matches`/`teams`/`profiles`, with no guest filter. Its
closing `UPDATE mix_player_stats ... WHERE mps.game_id = p_game_id AND
mps.user_id = n.pid` is an `UPDATE`, not an `UPSERT`, so a guest's Elo
delta is applied to `profiles.rating` but **never recorded anywhere**
— there is no `rating_delta` to revert for them. Reverting the
trackable players and then blindly re-running `apply_mix_elo` (which
touches guests again, on top of their still-unreverted original
delta) would double-apply a guest's contribution and corrupt the
bonus math for everyone else in the same `_elo_night` set. So:

```sql
IF EXISTS (
  SELECT 1 FROM unnest(v_mix_players) pid
  WHERE NOT EXISTS (
    SELECT 1 FROM mix_player_stats mps
    WHERE mps.game_id = v_game.id AND mps.user_id = pid AND mps.rating_delta IS NOT NULL
  )
) THEN
  v_elo_applied := FALSE;
  v_elo_skip_reason := 'untracked_participant';
END IF;
```

This also naturally covers "some slots can be guest/null" from a team
with an odd player count — `unnest` over a `NULL` array element is
filtered by `pid IS NOT NULL` implicitly wherever needed; a `NULL`
`pid` never matches a real `mix_player_stats.user_id` so it would
trip this guard too, which is the conservative/safe direction.

**Later-Elo-event guard**, run only if the untracked-participant guard
above didn't already disqualify the mix. For each player in `v_mix_players`, check whether
any Elo-affecting event recorded **after** this mix's `games.date`
exists for them:

```sql
CREATE OR REPLACE FUNCTION _has_later_elo_event(p_user_id UUID, p_after TIMESTAMPTZ, p_exclude_game_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM mix_player_stats mps
    JOIN games g ON g.id = mps.game_id
    WHERE mps.user_id = p_user_id
      AND mps.game_id <> p_exclude_game_id
      AND mps.rating_delta IS NOT NULL
      AND g.date > p_after
  )
  OR EXISTS (
    SELECT 1 FROM private_match_stats pms
    JOIN private_matches pm ON pm.id = pms.private_match_id
    WHERE pms.user_id = p_user_id
      AND pm.status = 'confirmed'
      AND pm.played_at > p_after
  );
$$;
```

Why this is sufficient and exact, verified by reading the current live
source of both write paths (§ — see `migration_vouchers.sql` for
`finalize_mix`/`apply_mix_elo`, `migration_private_match_ranked_consent.sql`
for `confirm_private_match`):

- `mix_player_stats.rating_delta` is only ever written by
  `apply_mix_elo`'s closing `UPDATE`, and only for a mix that actually
  ran `apply_mix_elo` — which `finalize_mix` calls unconditionally for
  every mix it finalizes. So "a `mix_player_stats` row with
  `rating_delta IS NOT NULL` and a later `games.date`" is exactly "a
  later mix whose Elo has already moved this player's rating." No
  extra `games.status = 'finished'` filter is needed: a
  `mix_player_stats` row for a game only exists once `finalize_mix`
  has run for it, and `finalize_mix` sets `games.status = 'finished'`
  in the same transaction.
- `private_match_stats` rows are only inserted inside
  `confirm_private_match`'s `IF v_all_ranked THEN` branch — i.e. only
  when the match was proposed ranked, every slot is a real app player
  (no guest names), and all four accepted with ranking — which is
  exactly when Elo was actually applied. So the existence of a
  `private_match_stats` row already implies "ranked and confirmed";
  the `pm.status = 'confirmed'` check is defensive/redundant but
  costs nothing and documents the intent.
- `mix_player_stats` has no `updated_at`/event timestamp of its own
  (confirmed: `schema.sql` — `id, game_id, user_id, organization_id,
  matches_played, matches_won, points_earned, mix_won, created_at` —
  `rating_delta`/`rating_after` were added later by
  `ALTER TABLE ... ADD COLUMN` in `migration_elo_rating.sql`, still no
  timestamp), which is why the check goes through `games.date` /
  `private_matches.played_at` instead — the *scheduled* time of the
  other event, which is the right "did this affect a rating state
  built on top of this mix's" comparison, not "when was it processed."

```sql
IF v_elo_skip_reason IS NULL THEN  -- untracked-participant guard didn't already disqualify it
  IF EXISTS (
    SELECT 1 FROM unnest(v_mix_players) pid
    WHERE _has_later_elo_event(pid, v_game.date, v_game.id)
  ) THEN
    v_elo_applied := FALSE;
    v_elo_skip_reason := 'later_elo_event';
  ELSE
    v_elo_applied := TRUE;
  END IF;
END IF;
```

**Revert + reapply**, only if `v_elo_applied`:

```sql
IF v_elo_applied THEN
  UPDATE profiles pr
  SET rating = GREATEST(0, COALESCE(pr.rating, 900) - mps.rating_delta)
  FROM mix_player_stats mps
  WHERE mps.game_id = v_game.id AND mps.user_id = pr.id AND mps.rating_delta IS NOT NULL;

  -- rating_games also incremented once per match played, by apply_elo_pairing,
  -- per player per match — apply_mix_elo will re-increment it identically on
  -- reapply (same matches, same per-player match count), so it nets out; no
  -- separate revert needed for rating_games.

  PERFORM apply_mix_elo(v_game.id, p_new_winner_team_id);
END IF;
```

`apply_mix_elo` itself recomputes and overwrites
`mix_player_stats.rating_delta`/`rating_after` for every player it
touches, so no separate cleanup of the old values is needed before the
call. `rating_games` (incremented once per match per player inside
`apply_elo_pairing`) is revert-neutral: the corrected mix still has
the same number of matches with the same participants per match — only
scores/winners change — so `apply_mix_elo` reapplying increments
`rating_games` by exactly the amount the (not-otherwise-reverted)
original run already added; nothing to undo there.

When `v_elo_applied` is false, `profiles.rating`,
`profiles.rating_games`, and `mix_player_stats.rating_delta`/
`rating_after` are all left completely untouched — this is the "skip
Elo entirely" branch, and everything else (winner, points, XP,
achievements, vouchers) still proceeds normally.

**6. Update `games.winner_team_id`.**

```sql
UPDATE games SET winner_team_id = p_new_winner_team_id, updated_at = NOW() WHERE id = v_game.id;
```

**7. Achievements — re-check, never revoke.**

```sql
PERFORM check_and_award_trophies(mps.user_id) FROM mix_player_stats mps WHERE mps.game_id = v_game.id;
```

Same call `finalize_mix` already makes, run for every player in the
mix (winners and losers — the corrected stats might newly cross a
threshold either way). `check_and_award_trophies` is the still-live
compat wrapper name kept by `migration_achievements_rename.sql`
(2026-09-10) around the actual current function,
`check_and_award_achievements`, over the now-renamed `achievements` /
`player_achievements` tables (`trophies`/`player_trophies` were
renamed that day — "troféus" was freed up for a future *real* trophy
shelf, per that migration's own comment). Calling the wrapper matches
`finalize_mix`'s own current call site, so this stays consistent with
the live code rather than reaching for the newer name on its own.
`check_and_award_achievements` is `ON CONFLICT (user_id,
achievement_key) DO NOTHING` and award-only — there is no un-award
path, and since multiple mixes can contribute toward the same
threshold-based achievement, there's no clean way to attribute "this
one came from this mix" even if revocation were wanted. Never touch
`player_achievements` beyond this call.

**8. Vouchers — only if `games.has_voucher` and the winner changed.**

```sql
IF v_game.has_voucher AND v_winner_changed THEN
  -- old winners: delete their voucher if unredeemed, note if not
  FOR pid IN SELECT unnest(ARRAY[player1_id, player2_id]) FROM teams WHERE id = v_old_winner_team_id LOOP
    CONTINUE WHEN pid IS NULL;
    SELECT status INTO v_voucher_status FROM vouchers WHERE game_id = v_game.id AND user_id = pid;
    IF v_voucher_status = 'por_usar' THEN
      DELETE FROM vouchers WHERE game_id = v_game.id AND user_id = pid;
    ELSIF v_voucher_status = 'usado' THEN
      v_voucher_not_reverted := TRUE;  -- surfaced to the admin, §8 (result summary)
    END IF;
  END LOOP;

  -- new winners: award, idempotent
  INSERT INTO vouchers (game_id, user_id, organization_id)
  SELECT v_game.id, pid, v_game.organization_id
  FROM (
    SELECT player1_id AS pid FROM teams WHERE id = p_new_winner_team_id
    UNION ALL SELECT player2_id FROM teams WHERE id = p_new_winner_team_id
  ) w
  WHERE pid IS NOT NULL
  ON CONFLICT (game_id, user_id) DO NOTHING;
END IF;
```

Exactly the policy locked in with Renato: an unredeemed voucher from
the old winner is deleted outright (nothing lost — it was never used);
an already-redeemed one is left alone (can't be un-redeemed — it may
have been scanned at a partner's till) but flagged in the result
summary; the new winners get fresh vouchers the same idempotent way
`finalize_mix` already awards them.

**9. Return the summary** (§5.3's JSON shape).

### 5.4 Achievements — see §5.3 step 7 (kept together with the Elo
section above for flow, cross-referenced here so this table of
contents-style walk-through doesn't skip it).

### 5.5 Vouchers — see §5.3 step 8, same note.

## 6. Error handling

- Every `RAISE EXCEPTION` above is a normal Postgres error surfaced to
  the client as `error.message` via `supabase.rpc(...)` — same pattern
  every other RPC call in this file already uses
  (`try { const { error } = await supabase.rpc(...); if (error) throw
  error } catch { setMixError(...) }`).
- The whole function runs as one transaction (default `plpgsql`
  function body) — either every step above commits or none do. A
  failure partway through (e.g. a constraint violation) rolls back
  cleanly; there's no partial-state risk to reason about beyond what
  Postgres already guarantees.
- `FOR UPDATE` locks on both the `matches` and `games` rows up front
  serialize concurrent correction attempts on the same match/mix — a
  second admin correcting the same match while the first is still
  in-flight blocks until the first transaction commits or rolls back,
  then re-reads the now-current state (rather than racing).
- A retried call after a network failure (the browser never learned
  whether the first call committed) is safe to just re-run: every
  write in the body is either an idempotent overwrite (`matches`,
  `mix_player_stats`, `games.winner_team_id`), an `ON CONFLICT DO
  NOTHING` insert (`xp_events` mix_win, `vouchers`), or a diff-based
  update that becomes a zero-delta no-op the second time
  (`player_stats`, `profiles.xp`, `profiles.rating` — since
  `v_old_winner_team_id` on the retry is now what the first call
  already set, `v_winner_changed` correctly comes back `false` if
  nothing further changed).

## 7. Frontend

Extend `GameDetails.jsx`'s existing correction affordance rather than
building a new one:

- `GameDetails.jsx` renders rounds in two mutually-exclusive places: an
  `in_progress`-only block (wrapped in `{game.status === 'in_progress'
  && (...)}`, opened around line 1878) containing the `canEditScores`
  at line ~2155 (`(isAdmin || isScorekeeper) && game.status ===
  'in_progress'`), and a separate `finishedTab === 'rondas'`-only block
  (line ~2297-2320) inside `{game.status === 'finished' && (...)}`.
  Because the first block never renders once the mix is finished, its
  `canEditScores` needs **no change** — only the second block needs new
  gating (admin-only, no scorekeeper — a UI convenience role, not a
  security boundary, so it shouldn't gain post-close power the
  RLS/RPC layer doesn't grant it either).
- The "rondas" tab's finished-mix match list (line ~2297-2320,
  currently hardcoded `editable = false` in practice since it only
  ever renders once `game.status === 'finished'`) gets the same
  `editingMatchId`/`startEditingScore`/`cancelEditingScore` treatment
  the `in_progress` block already has, so a finished mix's matches
  show the same pencil-icon "Corrigir resultado" affordance an admin
  already knows from the in-progress case.
- A new handler, `handleCorrectFinishedScore(match, finalScore)`,
  parallel to `handleSaveScore`: builds the locally-patched `matches`
  array, computes `p_new_winner_team_id` via
  `computeMixWinnerTeamId(game, teams, patchedMatches)` (§5.2), shows
  the `confirm()` gate with a message that names the match and new
  score, then calls `correct_finished_mix_match`, passing
  `finalScore.sets` straight through as `p_sets` exactly the way
  `handleSaveScore` already forwards it to the `match_sets`
  delete/insert (present only for `melhor_2_sets`/`melhor_3_sets`,
  `null`/omitted otherwise). On success, reloads (`loadGameDetails()`)
  and shows the result summary (§8 copy below). On error,
  `setMixError(error.message || t('gamedetails.error_correct_finished_score'))`
  — same pattern as every other mutation in this file.

## 8. Result summary copy (admin-facing) — DRAFT, tone review pending

Following `mark_voucher_used`'s error-handling pattern in `Profile.jsx`
(`confirm()` before the call, `alert()`-style reporting after), the
result summary after a successful correction is a single message built
from the RPC's JSON response:

- Winner unchanged: *"Resultado corrigido."*
- Winner changed: *"Resultado corrigido — o vencedor do mix passa a ser
  {nova dupla}."*
- Elo skipped (`later_elo_event`): append *"O rating (Elo) não foi
  ajustado, porque já há jogos mais recentes de pelo menos um dos
  jogadores — pede ao Renato para tratar à mão, se for preciso."*
- Elo skipped (`untracked_participant`): append *"O rating (Elo) não
  foi ajustado, porque um dos jogadores desta noite não tem histórico
  de Elo guardado para este mix — pede ao Renato para tratar à mão, se
  for preciso."*
- Voucher not reverted: append *"O vencedor anterior já usou o voucher
  deste mix — não foi revertido."*

This is a proportionate, single `alert()`-style composite message (this
codebase's existing pattern for RPC outcome reporting), not a new UI
surface — matches `PRODUCT.md`'s simplicity-first principle for a
pilot-scale product. **Exact final Portuguese copy is left for Renato
to review before implementation** — the strings above are a concrete
draft, not a placeholder, but tone/wording on player-facing-adjacent
admin messaging is worth a second pair of eyes given this repo's
pattern of iterating copy carefully elsewhere (see i18n work,
`docs/superpowers/specs/` for prior examples of copy going through
review).

## 9. Testing

No test runner/framework is set up for Postgres functions in this repo
(migrations are hand-verified in the Supabase SQL Editor — see the
"Manual verification" sections `migration_vouchers.sql` and
`migration_group_matches.sql` both already include). This migration
follows the same convention: a "Manual verification" section at the
bottom of `migration_post_close_mix_correction.sql`, covering at least:

1. **Happy path, winner unchanged:** finalize a mix, correct a losing
   team's already-lost match to a different (still-losing) score.
   Expect: `matches` row updated, `games.winner_team_id` unchanged,
   `player_stats`/`mix_player_stats` reflect the new per-match
   win/loss for the two teams in that match only, no `xp_events`
   change, Elo reverted-and-reapplied (assuming no later event),
   achievements re-checked, no voucher change (winner didn't change).
2. **Winner flips:** correct the deciding match so the mix winner
   changes. Expect: `games.winner_team_id` updates, both teams'
   `mix_player_stats.mix_won`/`points_earned` flip, `mix_win`
   `xp_events` rows move from old to new winners (with
   `profiles.xp` adjusted by ±30 per player), Elo reverted-and-reapplied
   (assuming no later event), and — for a `has_voucher = true` mix —
   the old winners' unredeemed vouchers are deleted and the new
   winners get fresh ones.
3. **Voucher already redeemed:** same as #2, but mark one old winner's
   voucher `usado` first. Expect that row untouched,
   `voucher_not_reverted: true` in the response, everything else same
   as #2.
4. **Elo skipped — later event:** correct a winner-flipping match, but
   first have one of the mix's players play and finalize a *later*
   mix (or confirm a later ranked private match). Expect
   `elo_applied: false`, `elo_skip_reason: 'later_elo_event'`,
   `profiles.rating`/`mix_player_stats.rating_delta` for every player
   in the corrected mix completely unchanged, while every other part
   of the correction (winner, points, XP, achievements, vouchers)
   still applies.
5. **Elo skipped — guest participant:** same as #4, but instead of a
   later event, have a guest (`memberships.is_guest = true`) among the
   mix's players. Expect `elo_skip_reason: 'untracked_participant'`,
   same "everything else still applies" behavior.
6. **Rejections:** call the RPC against an `in_progress` mix's match
   (expect the existing in-progress edit path to still be the only way
   to touch it — this RPC rejects with "ainda não está terminado"), a
   `pending`/`open`/`closed` mix's match (same rejection), an
   Americano mix's match (rejects with the Americano-specific
   message), and as a non-admin (rejects with the admin-only message).
7. **Idempotent retry:** call the RPC a second time with the exact
   same arguments right after a successful call. Expect every table
   to come back with the identical values as after the first call (no
   double-application of points/XP/vouchers), consistent with §6.
8. **Frontend, manual click-through:** as an admin, open a finished
   mix, use the new "Corrigir resultado" affordance on a match, confirm
   the `confirm()` dialog, and see the result summary message match
   what actually changed (§8). Confirm the affordance does **not**
   appear for a scorekeeper who isn't also an admin, and does not
   appear for a non-admin participant at all.
9. **Sets-format mix:** correct a match on a `melhor_2_sets` or
   `melhor_3_sets` finished mix through the frontend. Expect the old
   `match_sets` rows for that match replaced with the new ones (not
   merged/appended), and everything else behave as in #1/#2 depending
   on whether the winner flips.

## 10. Open questions for Renato (before implementation starts)

Everything substantive was already locked in during brainstorming.
What's left is narrow:

1. **Exact Portuguese copy for the result-summary messages (§8).** The
   draft strings are usable as-is, but tone/wording review is
   explicitly welcome before shipping — not a blocker to writing the
   implementation plan, just flagged so it doesn't ship unreviewed.
2. **`untracked_participant` as its own Elo-skip reason, distinct from
   `later_elo_event`.** This was *not* explicitly discussed in the
   prior brainstorming session — it fell out of reading `apply_mix_elo`
   closely (§5.3, "untracked-participant guard") and is a real correctness requirement (skipping
   Elo entirely whenever a guest played in the mix, to avoid
   double-applying their untracked delta), not an invented feature.
   The mechanism itself isn't optional, but if Renato would rather
   fold it into the same generic "Elo não foi ajustado" message
   instead of a distinguishable reason, that's a one-line copy change,
   not a design change.

Everything else in this document — the direct-admin-action shape, the
points/XP/Elo/achievements/voucher reversal policy, the RPC parameter
shape, the frontend reuse approach — reflects decisions already made
with Renato and is not re-opened here.
