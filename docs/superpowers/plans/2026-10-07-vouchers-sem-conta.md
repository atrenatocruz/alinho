# Vouchers também para quem não tem conta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every winner of a mix with a voucher gets one — with or without an account — and the club's voucher list flags the ones without an account.

**Architecture:** One hand-run SQL migration adds `guest_id`/`guest_name` to `vouchers`, adds two SECURITY DEFINER helpers (`award_mix_vouchers`, `revoke_unused_mix_vouchers_of_guests`), patches the live bodies of every function that inserts vouchers so they call the helper, patches `juntar_convidado` to annul unused vouchers, and recreates `list_club_vouchers` with a `has_account` column. The React admin list shows a note when `has_account === false`.

**Tech Stack:** Supabase Postgres (plpgsql, hand-run migrations in the SQL Editor), Vite + React + Tailwind, vitest.

**Spec:** `docs/superpowers/specs/2026-10-07-vouchers-sem-conta-design.md` — read it first.

## Global Constraints

- Work on branch `dev`. Do not push to `main`. Do not push at all — the controller decides.
- Commit messages in Portuguese, **no Claude/Co-Authored-By attribution line** (Renato's rule).
- There is **no DB access from this machine** (no DB password, `.env` only has the anon key). You cannot run the migration. You write it; Renato runs it in the Supabase SQL Editor (dev `jnrdbfjjsxalisjauife` first, then prod). So the SQL must fail loudly (RAISE EXCEPTION) on anything unexpected instead of guessing.
- Repo pattern for changing existing functions: read the **live** body with `pg_get_functiondef`, `regexp_replace` exactly one piece, refuse if the piece doesn't appear exactly once, print «já estava» and skip if already patched. Never paste a full copy of an existing function from an old migration file — live bodies have drifted.
- Migration must be re-runnable (idempotent) and wrapped in `BEGIN; … COMMIT;`.
- Copy (pt): `Este jogador não está na app. Confirma quem é na receção antes de dar baixa.` · (en): `This player isn't on the app. Check who they are at reception before redeeming.`
- Annul reason (exact): `Criado sem conta: gerido pelo clube, não passa para a conta.`
- Tournaments do not award vouchers — do not touch tournament functions.
- No bot (`whatsapp-bot/`) changes.

## Review Focus

1. **Correction after finish, winner changes, a guest was in the old winning pair** → the guest's unused voucher is deleted, a used one stays. Pinned by verification query V4 in Task 1.
2. **Finalize runs twice / correction re-awards the same pair** → no duplicate guest vouchers (unique partial index + `ON CONFLICT DO NOTHING`). Pinned by V3.
3. **Frontend deployed before the migration runs** → `has_account` is absent (`undefined`) → no note, nothing breaks. Pinned by the `undefined` test in Task 2.
4. **No-account voucher in the admin list** must not show «Ainda não aceitou partilhar o contacto» (they can't share — they have no app); it shows the no-account note instead. Pinned by Task 2 Step 5 manual check + mock row.
5. **Live body of `finalize_mix` differs from the repo** (e.g. `AND voucher_eligible(pid)` present or absent) → the regex must match both shapes. The regex's `[^;]*` absorbs the eligibility filter; V2 confirms no function still calls `voucher_eligible` in a voucher insert.

---

### Task 1: Migration `supabase/migration_vouchers_para_todos.sql`

**Files:**
- Create: `supabase/migration_vouchers_para_todos.sql`

**Interfaces:**
- Produces (DB): `vouchers.guest_id UUID NULL`, `vouchers.guest_name TEXT NULL`, `vouchers.user_id` nullable; `award_mix_vouchers(uuid, uuid) RETURNS void`; `revoke_unused_mix_vouchers_of_guests(uuid, uuid) RETURNS void`; `list_club_vouchers(uuid)` returns the old columns **plus `has_account BOOLEAN` as the last column**: `(voucher_id, status, created_at, used_at, game_id, game_title, game_date, prize, player_name, contact_shared_at, email, phone, has_account)`.

Context you need (already verified by the planner):
- `vouchers` was created in `supabase/migration_vouchers.sql` with `user_id UUID NOT NULL REFERENCES profiles(id)`, `UNIQUE (game_id, user_id)`.
- `migration_vouchers_so_com_conta.sql` added status `'anulado'`, `annulled_at`, `annulled_reason`, `voucher_eligible(uuid)`, and patched `finalize_mix` / `correct_finished_mix_match` to `... WHERE pid IS NOT NULL AND voucher_eligible(pid)`.
- Guests without account: `game_guests(id, game_id, name, ...)`; `teams.player1_guest_id`, `teams.player2_guest_id` (from `migration_mix_guest_sem_conta.sql`). In a team each slot has exactly one of `playerN_id` / `playerN_guest_id`.
- Voucher inserts in live functions look like (finalize, `p_game_id`/`p_winner_team_id`; corrections use `v_game.id`/`p_new_winner_team_id`):
  ```sql
  INSERT INTO vouchers (game_id, user_id, organization_id)
  SELECT v_game.id, w.pid, v_game.organization_id
  FROM (
    SELECT player1_id AS pid FROM teams WHERE id = p_new_winner_team_id
    UNION ALL SELECT player2_id FROM teams WHERE id = p_new_winner_team_id
  ) w
  WHERE w.pid IS NOT NULL AND voucher_eligible(w.pid)
  ON CONFLICT (game_id, user_id) DO NOTHING;
  ```
  Functions known to contain it: `finalize_mix`, `correct_finished_mix_match`, and possibly `finalize_americano_mix`, `correct_finished_americano_match` (see `migration_correct_finished_americano.sql`). The migration discovers them from `pg_proc` instead of assuming.
- `juntar_convidado(p_convidado uuid, p_registada uuid)` (from `migration_537_confirmar_numero.sql`) contains the comment line `-- ── a) Tudo o que aponta para o convidado passa para a registada ──────` right before it moves FK rows. It may not exist in a given DB.
- Current `list_club_vouchers` is in `migration_vouchers_contacto_e_lista.sql` (lines ~ `CREATE OR REPLACE FUNCTION public.list_club_vouchers`), plus the `AND v.status <> 'anulado'` filter added by `so_com_conta`.

- [ ] **Step 1: Write the file header and preconditions**

```sql
-- ═════════════════════════════════════════════════════════════════════════
-- Vouchers para todos os vencedores do mix, com ou sem conta
--
-- PORQUÊ. Renato, 7 out (falado com o Francisco): o clube tem de ver TODOS
-- os vouchers, também de quem ganhou sem estar na app — senão nem sabe que
-- essa pessoa ganhou. Desfaz migration_vouchers_so_com_conta.sql (30 set).
-- Spec: docs/superpowers/specs/2026-10-07-vouchers-sem-conta-design.md
--
-- O QUE FAZ
--   1. vouchers: user_id passa a opcional; guest_id (game_guests) e
--      guest_name (o nome no momento do voucher).
--   2. award_mix_vouchers(jogo, dupla): voucher aos dois da dupla, com ou
--      sem conta. revoke_unused_mix_vouchers_of_guests(jogo, dupla): nas
--      correções, tira os por usar de convidados que deixaram de ganhar.
--   3. Cada função cujo corpo vivo faz INSERT INTO vouchers passa a chamar
--      award_mix_vouchers (sai o filtro voucher_eligible).
--   4. juntar_convidado (se existir): anula os vouchers por usar do
--      convidado antes de os passar — um voucher sem conta nunca chega a
--      uma conta.
--   5. list_club_vouchers: também quem não tem conta, e has_account.
--   Os anulados a 30 set ficam como estão. Os torneios continuam sem vouchers.
--
-- CORRER PRIMEIRO: migration_mix_guest_sem_conta.sql,
-- migration_vouchers_so_com_conta.sql, migration_finalize_mix_com_convidados.sql.
-- Pode-se correr mais do que uma vez.
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 0. Peças de que depende ──────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.game_guests') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'teams' AND column_name = 'player1_guest_id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'vouchers' AND column_name = 'annulled_reason')
     OR to_regprocedure('public.voucher_eligible(uuid)') IS NULL
     OR to_regprocedure('public.list_club_vouchers(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Faltam migrações anteriores (ver CORRER PRIMEIRO). Parar e ler.';
  END IF;
END $$;
```

- [ ] **Step 2: Columns, constraint, index**

```sql
-- ── 1. Colunas ───────────────────────────────────────────────────────────
ALTER TABLE vouchers ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS guest_id UUID REFERENCES game_guests(id) ON DELETE SET NULL;
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS guest_name TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vouchers_user_or_guest') THEN
    ALTER TABLE vouchers ADD CONSTRAINT vouchers_user_or_guest
      CHECK (user_id IS NOT NULL OR guest_name IS NOT NULL);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS vouchers_game_guest_key
  ON vouchers (game_id, guest_id) WHERE guest_id IS NOT NULL;
```

- [ ] **Step 3: The two helpers**

```sql
-- ── 2. Dar e tirar ───────────────────────────────────────────────────────
-- Quem chama já verificou games.has_voucher.
CREATE OR REPLACE FUNCTION public.award_mix_vouchers(p_game_id UUID, p_winner_team_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org UUID;
BEGIN
  SELECT organization_id INTO v_org FROM games WHERE id = p_game_id;

  -- Com perfil (conta ou perfil antigo sem conta): todos, sem filtro.
  INSERT INTO vouchers (game_id, user_id, organization_id)
  SELECT p_game_id, w.pid, v_org
    FROM teams t
    CROSS JOIN LATERAL (VALUES (t.player1_id), (t.player2_id)) AS w(pid)
   WHERE t.id = p_winner_team_id AND w.pid IS NOT NULL
  ON CONFLICT DO NOTHING;

  -- Convidados sem conta (game_guests): o nome fica guardado no voucher.
  INSERT INTO vouchers (game_id, guest_id, guest_name, organization_id)
  SELECT p_game_id, gg.id, gg.name, v_org
    FROM teams t
    CROSS JOIN LATERAL (VALUES (t.player1_guest_id), (t.player2_guest_id)) AS w(gid)
    JOIN game_guests gg ON gg.id = w.gid
   WHERE t.id = p_winner_team_id
  ON CONFLICT DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public.award_mix_vouchers(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- Correções: os convidados que deixaram de ganhar perdem o voucher POR USAR
-- (os com conta já são tratados pelo laço de cada correção).
CREATE OR REPLACE FUNCTION public.revoke_unused_mix_vouchers_of_guests(p_game_id UUID, p_winner_team_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM vouchers v
   WHERE v.game_id = p_game_id
     AND v.guest_id IS NOT NULL
     AND v.status = 'por_usar'
     AND v.guest_id NOT IN (
       SELECT w.gid
         FROM teams t
         CROSS JOIN LATERAL (VALUES (t.player1_guest_id), (t.player2_guest_id)) AS w(gid)
        WHERE t.id = p_winner_team_id AND w.gid IS NOT NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_unused_mix_vouchers_of_guests(UUID, UUID) FROM PUBLIC, anon, authenticated;
```

- [ ] **Step 4: Patch every live function that inserts vouchers**

```sql
-- ── 3. Quem dá vouchers passa a chamar award_mix_vouchers ────────────────
DO $$
DECLARE
  c_mau CONSTANT TEXT :=
    'INSERT INTO vouchers \(game_id, user_id, organization_id\)\s+SELECT (p_game_id|v_game\.id),[^;]*WHERE id = (p_[a-z_]+)[^;]*ON CONFLICT \(game_id, user_id\) DO NOTHING;';
  c_esperadas CONSTANT TEXT[] := ARRAY['finalize_mix', 'correct_finished_mix_match',
                                       'finalize_americano_mix', 'correct_finished_americano_match'];
  f      RECORD;
  v_def  TEXT;
  v_bom  TEXT;
  v_n    INTEGER;
  v_feitas TEXT[] := '{}';
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig, p.proname
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname NOT IN ('award_mix_vouchers', 'revoke_unused_mix_vouchers_of_guests')
       AND (p.prosrc ~ 'INSERT INTO vouchers' OR p.prosrc ~ 'award_mix_vouchers')
  LOOP
    IF NOT (f.proname = ANY (c_esperadas)) THEN
      RAISE EXCEPTION '% dá vouchers e esta migração não a conhece. Parar e ler.', f.sig;
    END IF;
    v_def := pg_get_functiondef(f.sig::regprocedure);
    IF v_def LIKE '%award_mix_vouchers%' THEN
      RAISE NOTICE '%: já estava', f.sig;
      v_feitas := v_feitas || f.proname::text;
      CONTINUE;
    END IF;
    v_n := (SELECT count(*) FROM regexp_matches(v_def, c_mau, 'g'));
    IF v_n <> 1 THEN
      RAISE EXCEPTION '%: o INSERT INTO vouchers aparece % vezes (esperado 1). Parar e ler.', f.sig, v_n;
    END IF;
    v_bom := CASE WHEN f.proname LIKE 'correct_%'
                  THEN 'PERFORM revoke_unused_mix_vouchers_of_guests(\1, \2);
    PERFORM award_mix_vouchers(\1, \2);'
                  ELSE 'PERFORM award_mix_vouchers(\1, \2);' END;
    EXECUTE regexp_replace(v_def, c_mau, v_bom);
    RAISE NOTICE '%: trocada', f.sig;
    v_feitas := v_feitas || f.proname::text;
  END LOOP;

  IF NOT ('finalize_mix' = ANY (v_feitas)) OR NOT ('correct_finished_mix_match' = ANY (v_feitas)) THEN
    RAISE EXCEPTION 'finalize_mix e correct_finished_mix_match tinham de estar entre as trocadas (%). Parar e ler.', v_feitas;
  END IF;
END $$;
```

Note for the implementer: Postgres ARE regex — `\s`, `[^;]*` and capture groups `\1`/`\2` in the replacement all work in `regexp_replace`. Every quantifier here is greedy on purpose (Postgres sets one greediness for the whole regex from its first quantifier — don't add a `*?`). `[^;]*` cannot cross the end of the INSERT statement because the statement contains no `;` before `DO NOTHING;`.

- [ ] **Step 5: Patch `juntar_convidado`**

```sql
-- ── 4. juntar_convidado: um voucher sem conta não passa para a conta ─────
DO $$
DECLARE
  c_mau CONSTANT TEXT := '(-- ── a\) Tudo o que aponta para o convidado)';
  c_bom CONSTANT TEXT := '-- Vouchers por usar do convidado: anulados, não passam (Renato, 7 out).
  UPDATE vouchers
     SET status = ''anulado'', annulled_at = NOW(),
         annulled_reason = ''Criado sem conta: gerido pelo clube, não passa para a conta.''
   WHERE user_id = p_convidado AND status = ''por_usar'';

  \1';
  v_def TEXT;
BEGIN
  IF to_regprocedure('public.juntar_convidado(uuid, uuid)') IS NULL THEN
    RAISE NOTICE 'juntar_convidado não existe: nada a trocar';
    RETURN;
  END IF;
  v_def := pg_get_functiondef('public.juntar_convidado(uuid, uuid)'::regprocedure);
  IF v_def LIKE '%gerido pelo clube%' THEN
    RAISE NOTICE 'juntar_convidado: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'juntar_convidado: o comentário «a) Tudo o que aponta…» não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE regexp_replace(v_def, c_mau, c_bom);
END $$;
```

(Note: the replacement's `\1` keeps the original comment text. `arquivo_537.desfazer` won't reactivate these vouchers — accepted in the spec.)

- [ ] **Step 6: Recreate `list_club_vouchers`**

```sql
-- ── 5. Lista do clube: também quem não tem conta ────────────────────────
-- Muda o tipo de retorno (has_account): DROP + CREATE, permissões repostas.
DROP FUNCTION public.list_club_vouchers(UUID);
CREATE FUNCTION public.list_club_vouchers(p_organization_id UUID)
RETURNS TABLE (
  voucher_id UUID, status TEXT, created_at TIMESTAMPTZ, used_at TIMESTAMPTZ,
  game_id UUID, game_title TEXT, game_date TIMESTAMPTZ, prize TEXT,
  player_name TEXT, contact_shared_at TIMESTAMPTZ, email TEXT, phone TEXT,
  has_account BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT v.id, v.status, v.created_at, v.used_at,
         g.id, g.title, g.date, g.prize,
         COALESCE(p.name, v.guest_name), v.contact_shared_at,
         -- o contacto só de quem aceitou partilhar com ESTE clube
         CASE WHEN v.contact_shared_at IS NOT NULL
               AND p.email NOT LIKE 'guest-%@whatsapp.alinho.pt'
               AND p.email NOT LIKE '%@invalid.alinho.pt'
              THEN p.email END,
         NULL::text,
         (v.user_id IS NOT NULL AND voucher_eligible(v.user_id))
    FROM vouchers v
    JOIN games g ON g.id = v.game_id
    LEFT JOIN profiles p ON p.id = v.user_id
   WHERE v.organization_id = p_organization_id
     AND v.status <> 'anulado'
     AND EXISTS (SELECT 1 FROM memberships m
                  WHERE m.organization_id = p_organization_id AND m.user_id = auth.uid() AND m.is_admin)
   ORDER BY v.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.list_club_vouchers(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_club_vouchers(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_club_vouchers(UUID) TO authenticated;

COMMIT;
```

Note: `voucher_eligible` had all privileges revoked from `authenticated`; that's fine — `list_club_vouchers` is SECURITY DEFINER and runs as its owner.

- [ ] **Step 7: Verification queries (as comments at the end of the file, for Renato to run on dev)**

```sql
-- Verificar depois de correr (dev primeiro):
-- V1  SELECT column_name, is_nullable FROM information_schema.columns
--      WHERE table_name = 'vouchers' AND column_name IN ('user_id', 'guest_id', 'guest_name');
--      -- user_id YES, guest_id YES, guest_name YES
-- V2  SELECT proname FROM pg_proc WHERE prosrc ~ 'award_mix_vouchers'
--        AND proname NOT IN ('award_mix_vouchers');
--      -- finalize_mix, correct_finished_mix_match (+ as do americano, se davam vouchers)
--     SELECT proname FROM pg_proc WHERE prosrc ~ 'INSERT INTO vouchers'
--        AND prosrc ~ 'voucher_eligible';   -- 0 linhas
-- V3  Num mix com voucher e um convidado sem conta na dupla vencedora,
--     depois de «Terminar»:
--     SELECT user_id, guest_id, guest_name, status FROM vouchers WHERE game_id = '<mix>';
--      -- 2 linhas: uma com user_id, outra com guest_id + guest_name
--     SELECT award_mix_vouchers('<mix>', '<dupla vencedora>');  -- outra vez
--     SELECT count(*) FROM vouchers WHERE game_id = '<mix>';    -- continua 2
-- V4  Corrigir o resultado para outra dupla (no ecrã) e:
--     SELECT user_id, guest_id, status FROM vouchers WHERE game_id = '<mix>';
--      -- o convidado da dupla antiga sumiu (se estava por usar); a nova tem os seus
-- V5  Como admin do clube, na app: Gerir clube → Vouchers mostra o convidado
--     com a nota «Este jogador não está na app…».
--     SELECT player_name, has_account FROM list_club_vouchers('<org>');  -- (no SQL Editor auth.uid() é nulo: 0 linhas; ver no ecrã)
```

- [ ] **Step 8: Self-check the file (no DB available)**

Read the whole file once top to bottom and confirm: every `DO $$` has a matching `END $$;`; every single quote inside the `c_bom` strings is doubled (`''anulado''`); `BEGIN;` at top and `COMMIT;` after Step 6; no `RAISE` uses `%` without a matching argument. If `psql` is on PATH you may run a pure syntax parse with no DB: skip it — there's no server; do not try to connect anywhere.

- [ ] **Step 9: Commit**

```bash
git add supabase/migration_vouchers_para_todos.sql
git commit -m "Vouchers para todos os vencedores do mix, com ou sem conta: migração (correr à mão)"
```

---

### Task 2: Admin list shows the no-account note

**Files:**
- Modify: `src/lib/vouchers.js` (add `voucherWithoutAccount`)
- Modify: `src/lib/vouchers.test.js`
- Modify: `src/components/vouchers/VouchersAdmin.jsx` (row around lines 98–125)
- Modify: `src/locales/pt.json`, `src/locales/en.json` (flat keys, next to `"vouchers.not_shared"`)
- Modify: `src/lib/devMockVouchers.js` (`ROWS`)

**Interfaces:**
- Consumes: `list_club_vouchers` rows from Task 1 — may or may not have `has_account` (frontend can ship before the migration runs).
- Produces: `export function voucherWithoutAccount(v): boolean` — true only when `v.has_account === false`.

- [ ] **Step 1: Write the failing test** — append to `src/lib/vouchers.test.js` (and add `voucherWithoutAccount` to the existing import line from `./vouchers`):

```js
describe('voucherWithoutAccount', () => {
  it('is true when the list says the player has no account', () => {
    expect(voucherWithoutAccount({ has_account: false })).toBe(true)
  })

  it('is false when the player has an account', () => {
    expect(voucherWithoutAccount({ has_account: true })).toBe(false)
  })

  it('is false before the migration runs (column missing)', () => {
    expect(voucherWithoutAccount({ player_name: 'Rita' })).toBe(false)
    expect(voucherWithoutAccount(null)).toBe(false)
  })
})
```

- [ ] **Step 2: Run it, expect failure**

Run: `npx vitest run src/lib/vouchers.test.js`
Expected: FAIL — `voucherWithoutAccount is not a function` (or import error).

- [ ] **Step 3: Implement** — in `src/lib/vouchers.js`, right after `listClubVouchers`:

```js
// Voucher de quem ganhou sem estar na app (Renato, 7 out). Só com a
// migration_vouchers_para_todos.sql a lista traz has_account; antes disso
// vem undefined e não se mostra nada.
export function voucherWithoutAccount(v) {
  return v?.has_account === false
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npx vitest run src/lib/vouchers.test.js`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Locales, UI, mock**

`src/locales/pt.json` — add after the `"vouchers.not_shared"` line:
```json
  "vouchers.no_account": "Este jogador não está na app. Confirma quem é na receção antes de dar baixa.",
```
`src/locales/en.json` — add after its `"vouchers.not_shared"` line:
```json
  "vouchers.no_account": "This player isn't on the app. Check who they are at reception before redeeming.",
```

`src/components/vouchers/VouchersAdmin.jsx`:
- add `voucherWithoutAccount` to the import from `'../../lib/vouchers'`;
- inside the `shown.map((v) => { … })`, add `const noAccount = voucherWithoutAccount(v)`;
- under the line `<p className="truncate text-xs text-muted">{[v.game_title, day(v.game_date)]…}</p>` add:
  ```jsx
  {noAccount && <p className="mt-1 text-xs text-warning">{t('vouchers.no_account')}</p>}
  ```
- change `{consent && (` (the contact section) to `{consent && !noAccount && (` — someone with no app can't share a contact, so «Ainda não aceitou partilhar o contacto» would be wrong for them.
- leave `canRedeem(v)` / «Dar baixa» untouched.

`src/lib/devMockVouchers.js` — add `has_account: true` to the three existing `ROWS` objects and append a fourth:
```js
  { voucher_id: 'v4', status: 'por_usar', created_at: '2026-09-29T21:00:00Z', used_at: null, game_id: 'g1', game_title: 'Mix de terça', game_date: '2026-09-29T19:00:00Z', prize: 'Uma bebida no bar', player_name: 'Zé (sem conta)', contact_shared_at: null, email: null, phone: null, has_account: false },
```
Also add one line to the header comment: `// v4 = vencedor sem conta (nota «não está na app», sem a parte do contacto).`

- [ ] **Step 6: Full test run + build**

Run: `npm test` → all pass. Run: `npm run build` → succeeds.

- [ ] **Step 7: Manual check in the browser (dev server)**

`npm run dev`, log in with the dev-only «Entrar como Admin», in devtools: `localStorage.mockClubVouchers = 'consent'`, reload, open Gerir clube → Vouchers. Expect: «Zé (sem conta)» shows the orange note, no contact section, «Dar baixa» button present; Rita/Tiago/Ana unchanged. Then `localStorage.mockClubVouchers = 'plain'` → no note on anyone (fallback path, no `has_account`). Remove the localStorage key afterwards. If you cannot drive a browser, say so in your report rather than claiming it was checked.

- [ ] **Step 8: Commit**

```bash
git add src/lib/vouchers.js src/lib/vouchers.test.js src/components/vouchers/VouchersAdmin.jsx src/locales/pt.json src/locales/en.json src/lib/devMockVouchers.js
git commit -m "Vouchers: a lista do clube avisa quando o vencedor não está na app"
```
