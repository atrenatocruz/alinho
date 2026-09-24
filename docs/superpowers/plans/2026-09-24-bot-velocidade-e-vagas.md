# Bot mais rápido + mix que não passa das vagas — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Objetivo:** (A) impedir que um mix fique com mais inscritos do que vagas quando duas pessoas apanham a última ao mesmo tempo (app + bot, ou bot + bot); (B) encurtar o tempo entre um «In» no WhatsApp e a lista atualizada aparecer no grupo.

**Arquitetura:** (A) um trigger `BEFORE INSERT OR UPDATE` em `participants` que tranca a linha do mix (`FOR UPDATE`) e volta a contar — o mesmo padrão do `tournament_entries_guard` de hoje; bot e app traduzem o erro `game_full`. (B) no bot: medir cada passo; filas por grupo em vez de uma fila global; menos idas em série à base de dados; o «In» pede o repost logo em vez de esperar pelo Realtime; o repost só recarrega o mix que mudou.

**Tech stack:** PostgreSQL (Supabase), Node 20 ESM + Baileys (`whatsapp-bot/`), React (`src/`), `node:test` (novo no bot, sem dependências), Vitest (app).

**Spec:** não há documento — a decisão está na conversa de 24 set (Renato): «quero as duas», depois da análise do caminho de um «In» (≈ 8–9 idas à BD em série + espera do Realtime + debounce de 4 s) e da falha das vagas (`check_game_full` só fecha o mix *depois* de encher). As duas proteções do ponto 4 (só no «In»; sempre pela fila de 4 s) foram acordadas nessa conversa.

## Global Constraints

- Nada vai para `main` antes de a migração correr em produção (CLAUDE.md). O bot não tem CI: **redeploy manual no EC2**.
- Migrações: ficheiro novo `supabase/migration_*.sql`, pode correr duas vezes, testado num Postgres local antes (como `migration_tournaments_integridade.sql`).
- Nunca reescrever corpos de funções que produção muda à mão (#465, #496): triggers novos ou remendo ao corpo vivo.
- O repost continua a passar **sempre** pela fila de 4 s por grupo (`scheduleGroupRepost`) — nunca enviar direto (spam/limites do WhatsApp).
- O repost imediato é **só para o «In»** (e «Sim» de suplente/dupla). O «Out» continua a esperar pelo Realtime, senão perde-se «🎉 X subiu da lista de suplentes!».
- Textos novos em pt **e** en (`src/locales/*.json`, `whatsapp-bot/src/locales.js`).
- Commits sem linha de atribuição ao Claude (memória do Renato).

## Review Focus

1. **Suplente promovido quando alguém sai** — o `promote_waitlist` passa `waitlisted → confirmed` dentro do DELETE; o trigger novo corre aí e tem de deixar passar (há vaga porque alguém saiu). Teste na Tarefa 1.
2. **Admin a inscrever acima das vagas no Gerir** — é decisão do admin; o trigger deixa passar admins do clube. Teste na Tarefa 1.
3. **Mix com mais campos** (`check_game_capacity_increase` promove suplentes) — a contagem usa a lotação nova. Teste na Tarefa 1.
4. **Rajada de «In» quando um mix abre** — continua a sair no máximo 2 mensagens por grupo. Teste na Tarefa 6.
5. **Mix que abre ou fecha entre dois reposts** — a numeração 01/02 dos outros mixes muda; o repost «só do mix que mudou» tem de cair no repost completo. Teste na Tarefa 7.

---

## Mapa de ficheiros

| Ficheiro | O quê |
|---|---|
| `supabase/migration_mix_capacity_guard.sql` (novo) | trigger `participants_capacity_guard` |
| `supabase/tests/participants_capacity_guard.sql` (novo) | casos para correr num Postgres local |
| `src/pages/GameDetails.jsx` | `game_full` → texto próprio nos três caminhos de inscrição |
| `src/locales/pt.json`, `en.json` | `gamedetails.error_game_full` |
| `whatsapp-bot/src/commands.js` | `game_full` no bot; menos idas em série; pede repost no «In» |
| `whatsapp-bot/src/partnerInvite.js` | erro `game_full` com código próprio |
| `whatsapp-bot/src/timing.js` (novo) | medir passos e escrever uma linha de log |
| `whatsapp-bot/src/keyedQueue.js` (novo) | fila por chave (grupo) |
| `whatsapp-bot/src/index.js` | fila por grupo |
| `whatsapp-bot/src/roster.js` | `loadGame` numa ida à BD, devolve `rows` |
| `whatsapp-bot/src/sync.js` | `requestRepostForGame`; repost só dos mixes indicados |
| `whatsapp-bot/test/*.test.js` (novo) | testes `node:test` + Supabase em memória |
| `whatsapp-bot/package.json` | `"test": "node --test test/"` |

---

### Task 1: Trigger de vagas em `participants`

**Ficheiros:**
- Criar: `supabase/migration_mix_capacity_guard.sql`
- Criar: `supabase/tests/participants_capacity_guard.sql`

**Interfaces:**
- Produz: erro Postgres `P0001` com mensagem exatamente `game_full` quando uma inscrição confirmada não cabe. Tarefas 2 e 3 dependem desta string.

- [ ] **Passo 1: Escrever os casos de teste** (`supabase/tests/participants_capacity_guard.sql`)

```sql
-- Correr num Postgres local descartável:
--   psql -d <bd_vazia> -f supabase/tests/participants_capacity_guard.sql
-- Cria tabelas mínimas, corre a migração e imprime OK/ERRO por caso.
\set VERBOSITY terse
CREATE ROLE anon; CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('t.uid', true), '')::uuid $$;
CREATE FUNCTION is_org_admin(p uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT current_setting('t.admin', true) = 'on' $$;
CREATE TABLE games (id uuid PRIMARY KEY, organization_id uuid, status text, max_players int, num_courts int);
CREATE TABLE participants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), game_id uuid, user_id uuid, partner_id uuid,
  status text, created_at timestamptz DEFAULT now());
\i supabase/migration_mix_capacity_guard.sql

CREATE FUNCTION t_(label text, stmt text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN EXECUTE stmt; RETURN 'OK    ' || label; EXCEPTION WHEN OTHERS THEN RETURN 'ERRO  ' || label || ' -> ' || SQLERRM; END $f$;

-- mix de 4 vagas, aberto
INSERT INTO games VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000aa', 'open', 4, 1);
SELECT set_config('t.uid', '00000000-0000-0000-0000-0000000000b1', false), set_config('t.admin', 'off', false);
SELECT t_('dupla (2/4)', $q$INSERT INTO participants(game_id,user_id,partner_id,status) VALUES ('00000000-0000-0000-0000-000000000001', gen_random_uuid(), gen_random_uuid(), 'confirmed')$q$);
SELECT t_('sozinho (3/4)', $q$INSERT INTO participants(id,game_id,user_id,status) VALUES ('00000000-0000-0000-0000-0000000000c3','00000000-0000-0000-0000-000000000001', gen_random_uuid(), 'confirmed')$q$);
SELECT t_('dupla quando só há 1 vaga [deve recusar]', $q$INSERT INTO participants(game_id,user_id,partner_id,status) VALUES ('00000000-0000-0000-0000-000000000001', gen_random_uuid(), gen_random_uuid(), 'confirmed')$q$);
SELECT t_('sozinho (4/4)', $q$INSERT INTO participants(game_id,user_id,status) VALUES ('00000000-0000-0000-0000-000000000001', gen_random_uuid(), 'confirmed')$q$);
SELECT t_('5.º sozinho [deve recusar]', $q$INSERT INTO participants(game_id,user_id,status) VALUES ('00000000-0000-0000-0000-000000000001', gen_random_uuid(), 'confirmed')$q$);
SELECT t_('suplente com o mix cheio', $q$INSERT INTO participants(id,game_id,user_id,status) VALUES ('00000000-0000-0000-0000-0000000000c9','00000000-0000-0000-0000-000000000001', gen_random_uuid(), 'waitlisted')$q$);
SELECT t_('promover suplente sem vaga [deve recusar]', $q$UPDATE participants SET status='confirmed' WHERE id='00000000-0000-0000-0000-0000000000c9'$q$);
SELECT t_('sair (o 3.º)', $q$DELETE FROM participants WHERE id='00000000-0000-0000-0000-0000000000c3'$q$);
SELECT t_('promover suplente depois de alguém sair (Review Focus 1)', $q$UPDATE participants SET status='confirmed' WHERE id='00000000-0000-0000-0000-0000000000c9'$q$);
SELECT t_('juntar parceiro com o mix cheio [deve recusar]', $q$UPDATE participants SET partner_id=gen_random_uuid() WHERE id='00000000-0000-0000-0000-0000000000c9'$q$);
SELECT set_config('t.admin', 'on', false);
SELECT t_('admin inscreve acima das vagas (Review Focus 2)', $q$INSERT INTO participants(game_id,user_id,status) VALUES ('00000000-0000-0000-0000-000000000001', gen_random_uuid(), 'confirmed')$q$);
SELECT set_config('t.admin', 'off', false), set_config('t.uid', '', false);
SELECT t_('bot (sem sessão) acima das vagas [deve recusar]', $q$INSERT INTO participants(game_id,user_id,status) VALUES ('00000000-0000-0000-0000-000000000001', gen_random_uuid(), 'confirmed')$q$);
UPDATE games SET max_players = 8, num_courts = 2 WHERE id = '00000000-0000-0000-0000-000000000001';
SELECT t_('mais um campo: cabe (Review Focus 3)', $q$INSERT INTO participants(game_id,user_id,status) VALUES ('00000000-0000-0000-0000-000000000001', gen_random_uuid(), 'confirmed')$q$);
UPDATE games SET status = 'in_progress' WHERE id = '00000000-0000-0000-0000-000000000001';
SELECT t_('mix a decorrer: o trigger não se mete', $q$INSERT INTO participants(game_id,user_id,partner_id,status) VALUES ('00000000-0000-0000-0000-000000000001', gen_random_uuid(), gen_random_uuid(), 'confirmed')$q$);
```

- [ ] **Passo 2: Correr e ver falhar** (a migração ainda não existe)

```bash
export PATH="/c/Program Files/PostgreSQL/18/bin:$PATH"
initdb -D /tmp/pgcap -U postgres -A trust >/dev/null && pg_ctl -D /tmp/pgcap -o "-p 54330" start && sleep 3
createdb -p 54330 -U postgres capt
psql -p 54330 -U postgres -d capt -q -tA -f supabase/tests/participants_capacity_guard.sql
```
Esperado: erro `could not open file "supabase/migration_mix_capacity_guard.sql"`.

- [ ] **Passo 3: Escrever a migração** (`supabase/migration_mix_capacity_guard.sql`)

```sql
-- ═════════════════════════════════════════════════════════════════════════
-- MIX: NINGUÉM ENTRA ACIMA DAS VAGAS, MESMO AO MESMO TEMPO
-- (Renato, 24 set 2026). Pode-se correr outra vez sem estragar.
--
-- A falha: a app e o bot fazem «conto as vagas → há lugar → inscrevo». Dois
-- «In» (ou um «In» e um «Entrar» na app) na última vaga contam os dois 7/8
-- e inscrevem os dois → 9/8. O `check_game_full` só FECHA o mix depois.
--
-- A regra: antes de uma inscrição confirmada, tranca-se a linha do mix
-- (FOR UPDATE — quem vier a seguir espera) e volta-se a contar. Não cabe →
-- `game_full`. A app mostra «o mix acabou de encher»; o bot oferece suplente.
--
-- Fica de fora: admins do clube (inscrever acima das vagas no Gerir é uma
-- decisão deles), mixes que já não estão `open`/`closed`, suplentes
-- (`waitlisted` não ocupa vaga). O bot NÃO fica de fora (usa service-role,
-- auth.uid() nulo) — é precisamente um dos lados da corrida.
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION participants_capacity_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cap    INTEGER;
  v_status TEXT;
  v_org    UUID;
  v_taken  INTEGER;
BEGIN
  IF NEW.status <> 'confirmed' THEN RETURN NEW; END IF;
  -- Já confirmada e o tamanho não muda (mesmo parceiro, ou troca de um
  -- parceiro por outro): não ocupa mais nada.
  IF TG_OP = 'UPDATE' AND OLD.status = 'confirmed'
     AND (OLD.partner_id IS NULL) = (NEW.partner_id IS NULL) THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(max_players, num_courts * 4), status, organization_id
    INTO v_cap, v_status, v_org
    FROM games WHERE id = NEW.game_id FOR UPDATE;
  IF v_status NOT IN ('open', 'closed') THEN RETURN NEW; END IF;
  IF auth.uid() IS NOT NULL AND is_org_admin(v_org) THEN RETURN NEW; END IF;

  SELECT COALESCE(SUM(1 + CASE WHEN partner_id IS NOT NULL THEN 1 ELSE 0 END), 0)
    INTO v_taken
    FROM participants
   WHERE game_id = NEW.game_id AND status = 'confirmed' AND id <> NEW.id;
  IF v_taken + (CASE WHEN NEW.partner_id IS NOT NULL THEN 2 ELSE 1 END) > v_cap THEN  -- ver ledger: na implementação é v_size
    RAISE EXCEPTION 'game_full';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION participants_capacity_guard() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS participants_capacity_guard ON participants;
CREATE TRIGGER participants_capacity_guard
  BEFORE INSERT OR UPDATE OF status, partner_id ON participants
  FOR EACH ROW EXECUTE FUNCTION participants_capacity_guard();

-- PARA VER DEPOIS (só leitura): mixes abertos que JÁ estão acima das vagas
-- (o trigger não os mexe — só recusa daqui para a frente):
--   SELECT g.id, g.title, COALESCE(g.max_players, g.num_courts * 4) AS cap,
--          SUM(1 + CASE WHEN p.partner_id IS NOT NULL THEN 1 ELSE 0 END) AS ocupados
--     FROM games g JOIN participants p ON p.game_id = g.id AND p.status = 'confirmed'
--    WHERE g.status IN ('open', 'closed')
--    GROUP BY g.id HAVING SUM(1 + CASE WHEN p.partner_id IS NOT NULL THEN 1 ELSE 0 END) > COALESCE(g.max_players, g.num_courts * 4);
```

- [ ] **Passo 4: Correr outra vez e confirmar** (numa BD limpa)

```bash
dropdb -p 54330 -U postgres capt; createdb -p 54330 -U postgres capt
psql -p 54330 -U postgres -d capt -q -tA -f supabase/tests/participants_capacity_guard.sql | grep -E "^(OK|ERRO)"
psql -p 54330 -U postgres -d capt -q -f supabase/migration_mix_capacity_guard.sql   # 2.ª vez: sem erros
pg_ctl -D /tmp/pgcap stop
```
Esperado: `ERRO … -> game_full` exatamente nas 5 linhas marcadas «[deve recusar]»; `OK` em todas as outras.

- [ ] **Passo 5: Commit**

```bash
git add supabase/migration_mix_capacity_guard.sql supabase/tests/participants_capacity_guard.sql
git commit -m "fix(mix): trigger impede inscrições acima das vagas quando duas chegam ao mesmo tempo"
```

---

### Task 2: A app diz «o mix acabou de encher»

**Ficheiros:**
- Modificar: `src/pages/GameDetails.jsx` (`handleJoinAlone` ~l.395, `handleJoinPartner` ~l.436, `handleJoinWithPartner` ~l.458)
- Modificar: `src/locales/pt.json`, `src/locales/en.json`

**Interfaces:**
- Consome: erro `game_full` (Tarefa 1). `errorCode` de `src/lib/errors.js` (já exportado) devolve `'game_full'` para uma mensagem que termina em `game_full`.

- [ ] **Passo 1: Confirmar todos os sítios que inscrevem num mix**

```bash
grep -rn "from('participants')" src --include=*.jsx --include=*.js | grep -n "insert" 
```
Esperado: os três de `GameDetails.jsx` (+ `AddPlayerSheet`, que é admin e o trigger deixa passar). Se aparecer outro caminho de jogador, aplicar-lhe o Passo 3.

- [ ] **Passo 2: Textos** — em `pt.json`, a seguir a `"gamedetails.error_join_generic"`:

```json
  "gamedetails.error_game_full": "O mix acabou de encher — alguém apanhou a última vaga. Podes entrar como suplente.",
```
Em `en.json`:
```json
  "gamedetails.error_game_full": "The mix just filled up — someone took the last spot. You can join as a substitute.",
```
(`gamedetails.partner_error_game_full` já existe: «Já não há lugar para os dois neste mix.»)

- [ ] **Passo 3: Traduzir o erro** — em `GameDetails.jsx`, importar `errorCode` (ao lado de `describeError`) e, no `catch` de `handleJoinAlone` e de `handleJoinWithPartner`, trocar:

```jsx
      setJoinError(describeError(t, error, 'gamedetails.error_join_generic'))
```
por:
```jsx
      // O trigger das vagas (migration_mix_capacity_guard.sql) recusa quem
      // chega à última vaga um instante depois de outra pessoa.
      setJoinError(errorCode(error) === 'game_full'
        ? t('gamedetails.error_game_full')
        : describeError(t, error, 'gamedetails.error_join_generic'))
      loadGameDetails()
```
`handleJoinPartner` já resolve `gamedetails.partner_error_${error.message}` → `partner_error_game_full`; não mexer.

- [ ] **Passo 4: Testes e build**

```bash
npx vitest run && npm run build
```
Esperado: todos verdes, build sem erros.

- [ ] **Passo 5: Commit**

```bash
git add src/pages/GameDetails.jsx src/locales/pt.json src/locales/en.json
git commit -m "fix(mix): a app diz que o mix acabou de encher quando o trigger das vagas recusa"
```

---

### Task 3: Testes no bot + o bot trata `game_full`

**Ficheiros:**
- Modificar: `whatsapp-bot/package.json`
- Criar: `whatsapp-bot/test/fakeSupabase.js`, `whatsapp-bot/test/commands.test.js`
- Modificar: `whatsapp-bot/src/commands.js`, `whatsapp-bot/src/partnerInvite.js`

**Interfaces:**
- Produz: `test/fakeSupabase.js` → `export function installFakeSupabase(supabase, db)` que substitui `supabase.from`/`supabase.auth.admin`/`supabase.rpc` por uma BD em memória, e `export const calls` (array com o nome de cada tabela por ida à BD) — usado nas Tarefas 5 e 6. `db.failInsert = { table, code, message }` faz o próximo insert nessa tabela falhar.
- Consome: `game_full` (Tarefa 1).

- [ ] **Passo 1: Script de testes** — em `whatsapp-bot/package.json`:

```json
  "scripts": {
    "start": "node src/index.js",
    "test": "node --test test/"
  },
```

- [ ] **Passo 2: Supabase em memória** (`whatsapp-bot/test/fakeSupabase.js`)

```js
// Supabase em memória para os testes do bot: só o que o bot usa
// (select/insert/upsert/update/delete, eq/neq/in/gt, order/limit,
// single/maybeSingle, embeds «x:profiles!fk(...)»). `calls` regista uma
// entrada por ida à BD — é assim que se mede «quantas idas por comando».
import crypto from 'node:crypto'

export const calls = []

export function installFakeSupabase(supabase, db) {
  const embed = (row, select) => {
    const out = { ...row }
    const re = /(\w+):profiles(?:!(\w+))?\s*\(/g
    let m
    while ((m = re.exec(select))) {
      const alias = m[1]
      const col = m[2]?.includes('partner') ? 'partner_id' : 'user_id'
      out[alias] = db.profiles.find((p) => p.id === row[col]) ?? null
    }
    return out
  }
  function builder(table) {
    const q = { filters: [], op: 'select', select: '*' }
    const get = (r, c) => c.split('.').reduce((o, k) => o?.[k], r)
    const exec = () => {
      calls.push(table)
      if (q.op === 'insert' || q.op === 'upsert') {
        if (db.failInsert?.table === table) {
          const { code, message } = db.failInsert
          db.failInsert = null
          return { data: null, error: { code, message } }
        }
        const out = []
        for (const r of q.rows) {
          const row = { id: r.id || crypto.randomUUID(), created_at: new Date().toISOString(), ...r }
          if (q.op === 'upsert') db[table] = db[table].filter((x) => x.id !== row.id)
          db[table].push(row)
          out.push(row)
        }
        return { data: q.single ? out[0] : out, error: null }
      }
      if (q.op === 'delete') {
        db[table] = db[table].filter((row) => !q.filters.every((f) => f(row)))
        return { data: null, error: null }
      }
      if (q.op === 'update') {
        for (const row of db[table].filter((r) => q.filters.every((f) => f(r)))) Object.assign(row, q.patch)
        return { data: null, error: null }
      }
      let rows = db[table].map((r) => embed(r, q.select))
      for (const f of q.filters) rows = rows.filter(f)
      if (q.single) return rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: 'not found' } }
      if (q.maybe) return { data: rows[0] ?? null, error: null }
      return { data: rows, error: null }
    }
    const api = {
      select: (s = '*') => { if (q.op === 'select') q.select = s; return api },
      insert: (r) => { q.op = 'insert'; q.rows = [].concat(r); return api },
      upsert: (r) => { q.op = 'upsert'; q.rows = [].concat(r); return api },
      update: (patch) => { q.op = 'update'; q.patch = patch; return api },
      delete: () => { q.op = 'delete'; return api },
      eq: (c, v) => { q.filters.push((r) => get(r, c) === v); return api },
      neq: (c, v) => { q.filters.push((r) => get(r, c) !== v); return api },
      in: (c, v) => { q.filters.push((r) => v.includes(get(r, c))); return api },
      gt: (c, v) => { q.filters.push((r) => get(r, c) > v); return api },
      order: () => api,
      limit: () => api,
      single: () => { q.single = true; return api },
      maybeSingle: () => { q.maybe = true; return api },
      then: (res, rej) => Promise.resolve(exec()).then(res, rej),
    }
    return api
  }
  supabase.from = builder
  supabase.rpc = async () => ({ data: [], error: null })
  supabase.auth.admin.createUser = async ({ user_metadata }) => ({ data: { user: { id: 'u-' + crypto.randomUUID().slice(0, 8), user_metadata } }, error: null })
  supabase.auth.admin.deleteUser = async () => ({})
}
```

- [ ] **Passo 3: Teste que falha** (`whatsapp-bot/test/commands.test.js`)

```js
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'

process.env.SUPABASE_URL = 'http://localhost:1'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'x'
process.env.PHONE_HASH_SECRET = 'segredo'
process.env.APP_URL = 'https://alinho.pt'

const { supabase } = await import('../src/supabase.js')
const { installFakeSupabase, calls } = await import('./fakeSupabase.js')
const { handleGroupMessage } = await import('../src/commands.js')

const hash = (d) => crypto.createHmac('sha256', 'segredo').update(d.slice(-9)).digest('hex')
export let db
beforeEach(() => {
  db = {
    whatsapp_groups: [{ organization_id: 'o', group_jid: 'g@g.us', label: 'x', levels: null }],
    profiles: [
      { id: 'a', name: 'Bernardo Ramos', phone_hash: hash('911111111'), language: 'pt' },
      { id: 'b', name: 'Afonso Dias', phone_hash: hash('922222222'), language: 'pt' },
    ],
    memberships: [{ user_id: 'a', organization_id: 'o' }, { user_id: 'b', organization_id: 'o' }],
    participants: [], partner_invites: [],
    games: [{ id: 'm', organization_id: 'o', title: 'Mix', status: 'open', origin: 'manual',
      date: new Date(Date.now() + 864e5).toISOString(), num_courts: 1, max_players: 4,
      rotate_partners: false, allow_pair_signup: true }],
  }
  installFakeSupabase(supabase, db)
  calls.length = 0
})

export async function say(text, pn = '351911111111') {
  const sent = []
  await handleGroupMessage(
    { groupJid: 'g@g.us', senderPn: `${pn}@s.whatsapp.net`, text, message: {}, quotedStanzaId: null },
    { sendText: async (_g, t) => { sent.push(t) } },
  )
  return sent.join('\n')
}

test('«In» sozinho inscreve', async () => {
  assert.equal(await say('in'), '')
  assert.deepEqual(db.participants.map((p) => [p.user_id, p.status]), [['a', 'confirmed']])
})

test('«In» recusado pelo trigger das vagas → oferece suplente', async () => {
  db.failInsert = { table: 'participants', code: 'P0001', message: 'game_full' }
  const out = await say('in')
  assert.match(out, /Queres entrar como suplente/)
})

test('«In com» recusado pelo trigger das vagas → diz que não cabe a dupla', async () => {
  db.failInsert = { table: 'participants', code: 'P0001', message: 'game_full' }
  const out = await say('in com afonso')
  assert.match(out, /não há vagas para uma dupla|não cabe uma dupla/)
})
```
Os testes importam `../src/groups.js` indiretamente; `getGroups` filtra pelos grupos em que a conta está e, sem provider, não filtra (fail-open) — não é preciso mexer.

- [ ] **Passo 4: Correr e ver falhar**

```bash
cd whatsapp-bot && npm test
```
Esperado: o 1.º passa; o 2.º e o 3.º falham (hoje o bot lança `Failed to insert participant: game_full`).

- [ ] **Passo 5: Tratar `game_full` em `commands.js`**

Junto aos outros helpers do topo:
```js
/** O trigger das vagas (migration_mix_capacity_guard.sql) recusa com a
 *  mensagem exata `game_full` quando outra pessoa apanhou a última vaga
 *  um instante antes. */
const isGameFull = (error) => /(^|\W)game_full$/.test(String(error?.message || '').trim())
```
No «In» sozinho (`actOnGame`), no `if (insertError)`, antes do `throw`:
```js
        if (isGameFull(insertError)) {
          pendingSuplenteConfirmations.set(pendingKey(senderPn, groupJid), {
            gameId: game.id, expiresAt: Date.now() + SUPLENTE_CONFIRM_TTL_MS, reprompted: false,
          })
          await reply('mix_full_offer_waitlist')
          return
        }
```
Em `joinAsPair`, no `if (insertError)`, antes do `throw`:
```js
      if (isGameFull(insertError)) {
        await reply('mix_full_pair')
        return
      }
```
Em `confirmPairWithUnregistered`, no `catch` do `joinWithUnregisteredPartner`:
```js
    } catch (err) {
      if (isGameFull(err)) {
        await reply('mix_full_pair')
        return
      }
      console.error('Failed to join with unregistered partner:', err)
```
E em `partnerInvite.js`, no insert de `participants`, trocar `throw new Error(\`participant: ${joinError.message}\`)` por `throw new Error(joinError.message)` (a mensagem tem de acabar em `game_full` para o `isGameFull`).

- [ ] **Passo 6: Correr e ver passar**

```bash
cd whatsapp-bot && npm test
```
Esperado: 3 testes a passar.

- [ ] **Passo 7: Commit**

```bash
git add whatsapp-bot/package.json whatsapp-bot/test whatsapp-bot/src/commands.js whatsapp-bot/src/partnerInvite.js
git commit -m "test(bot): testes com node:test e Supabase em memória; o bot trata game_full (oferece suplente / diz que a dupla não cabe)"
```

---

### Task 4: Medir — uma linha de log por comando e por repost

**Ficheiros:**
- Criar: `whatsapp-bot/src/timing.js`, `whatsapp-bot/test/timing.test.js`
- Modificar: `whatsapp-bot/src/commands.js`, `whatsapp-bot/src/sync.js`

**Interfaces:**
- Produz: `startTimer(label: string) → { mark(step: string): void, end(extra?: object): number }`. `end` escreve **uma** linha JSON: `{"timing":"<label>","total_ms":N,"steps":{"<step>":ms,...},...extra}`.

- [ ] **Passo 1: Teste que falha** (`whatsapp-bot/test/timing.test.js`)

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startTimer } from '../src/timing.js'

test('escreve uma linha JSON com o total e os passos', async (t) => {
  const lines = []
  t.mock.method(console, 'log', (l) => lines.push(l))
  const timer = startTimer('cmd:in')
  timer.mark('perfil')
  await new Promise((r) => setTimeout(r, 15))
  timer.mark('insert')
  const total = timer.end({ group: 'g' })
  assert.equal(lines.length, 1)
  const row = JSON.parse(lines[0])
  assert.equal(row.timing, 'cmd:in')
  assert.equal(row.group, 'g')
  assert.ok(row.steps.insert >= 10)
  assert.equal(row.total_ms, total)
})
```

- [ ] **Passo 2: Correr e ver falhar** — `cd whatsapp-bot && npm test` → `Cannot find module '../src/timing.js'`.

- [ ] **Passo 3: Implementar** (`whatsapp-bot/src/timing.js`)

```js
// Quanto demora cada passo de um comando ou repost — uma linha JSON por
// medição, para se ler no `docker logs` e comparar antes/depois
// (plano 2026-09-24-bot-velocidade-e-vagas).
export function startTimer(label) {
  const t0 = performance.now()
  let last = t0
  const steps = {}
  return {
    mark(step) {
      const now = performance.now()
      steps[step] = Math.round(now - last)
      last = now
    },
    end(extra = {}) {
      const total = Math.round(performance.now() - t0)
      console.log(JSON.stringify({ timing: label, total_ms: total, steps, ...extra }))
      return total
    },
  }
}
```

- [ ] **Passo 4: Ver passar** — `npm test`.

- [ ] **Passo 5: Instrumentar** — em `commands.js`, `import { startTimer } from './timing.js'`; em `handleGroupMessage`, logo depois de `if (!pending && !parsed) return`:
```js
  const timer = startTimer(`cmd:${parsed?.action ?? 'pending'}`)
```
`timer.mark('grupo')` depois de `getGroupByJid`, `timer.mark('perfil')` depois de `resolveProfileByPhoneJid`, `timer.mark('mixes')` depois de `getOpenMixes`, e em `actOnGame` `timer.mark('mix')` depois de `loadGame` e `timer.mark('gravar')` depois do insert/delete. Envolver o corpo que vem a seguir ao gate num `try { … } finally { timer.end({ group: groupJid }) }`.
Em `sync.js`, no início de `postGroupRoster`: `const timer = startTimer('repost')`; `timer.mark('carregar')` depois do `Promise.all(... loadGame ...)`; no fim `timer.end({ group: group.groupJid, sent: <n.º de sendText feitos> })` (contar com uma variável `let sent = 0` incrementada a cada `sendText`).

- [ ] **Passo 6: `npm test`** — todos verdes.

- [ ] **Passo 7: Commit**

```bash
git add whatsapp-bot/src/timing.js whatsapp-bot/test/timing.test.js whatsapp-bot/src/commands.js whatsapp-bot/src/sync.js
git commit -m "feat(bot): uma linha de log com o tempo de cada passo por comando e por repost"
```

> **Opcional mas recomendado:** fazer redeploy só com as Tarefas 3–4 e deixar correr umas horas, para ter o «antes» nos logs (`docker logs <bot> | grep '"timing"'`).

---

### Task 5: Uma fila por grupo em vez de uma fila global

**Ficheiros:**
- Criar: `whatsapp-bot/src/keyedQueue.js`, `whatsapp-bot/test/keyedQueue.test.js`
- Modificar: `whatsapp-bot/src/index.js`

**Interfaces:**
- Produz: `createKeyedQueue() → (key: string, task: () => Promise<void>) => Promise<void>`. Tarefas com a mesma chave correm uma a uma, por ordem; chaves diferentes correm em paralelo. Uma tarefa que falha não pára as seguintes.

Porquê: hoje `index.js` encadeia **todas** as mensagens de **todos** os grupos numa só `messageQueue`. Um «In» no grupo M5 espera que acabe o do grupo M3 (e o de outro clube). Dentro do mesmo grupo a ordem tem de se manter (perguntas «Sim/Não» pendentes, duas pessoas no mesmo mix).

- [ ] **Passo 1: Teste que falha** (`whatsapp-bot/test/keyedQueue.test.js`)

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createKeyedQueue } from '../src/keyedQueue.js'

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

test('mesma chave: por ordem; chaves diferentes: em paralelo; um erro não pára a fila', async () => {
  const run = createKeyedQueue()
  const log = []
  const t0 = Date.now()
  await Promise.all([
    run('g1', async () => { await wait(40); log.push('g1-a') }),
    run('g1', async () => { throw new Error('falhou') }),
    run('g1', async () => { log.push('g1-c') }),
    run('g2', async () => { await wait(40); log.push('g2-a') }),
  ])
  assert.deepEqual(log.filter((x) => x.startsWith('g1')), ['g1-a', 'g1-c'])
  assert.ok(Date.now() - t0 < 75, 'g1 e g2 correram em paralelo')
})
```

- [ ] **Passo 2: Ver falhar** — `npm test` → módulo não existe.

- [ ] **Passo 3: Implementar** (`whatsapp-bot/src/keyedQueue.js`)

```js
// Fila por chave: o bot trata as mensagens de CADA grupo uma a uma (a ordem
// importa — perguntas Sim/Não pendentes, duas pessoas no mesmo mix), mas
// grupos diferentes deixam de esperar uns pelos outros.
export function createKeyedQueue() {
  const tails = new Map()
  return (key, task) => {
    const prev = tails.get(key) ?? Promise.resolve()
    const next = prev.then(task).catch((err) => console.error(`Queue task failed (${key}):`, err))
    tails.set(key, next)
    next.then(() => { if (tails.get(key) === next) tails.delete(key) })
    return next
  }
}
```

- [ ] **Passo 4: Ver passar** — `npm test`.

- [ ] **Passo 5: Usar em `index.js`** — trocar:
```js
  let messageQueue = Promise.resolve()

  const { sendText, getGroupMentions, getParticipatingGroupJids } = await connectWhatsApp({
    onGroupMessage: (payload) => {
      messageQueue = messageQueue.then(() =>
        handleGroupMessage(payload, { sendText }).catch((err) => {
          console.error('Failed to handle group message:', err)
        })
      )
    },
  })
```
por:
```js
  // Uma fila por grupo (keyedQueue.js): por ordem dentro do grupo, em
  // paralelo entre grupos.
  const enqueue = createKeyedQueue()

  const { sendText, getGroupMentions, getParticipatingGroupJids } = await connectWhatsApp({
    onGroupMessage: (payload) => {
      enqueue(payload.groupJid, () => handleGroupMessage(payload, { sendText }))
    },
  })
```
e `import { createKeyedQueue } from './keyedQueue.js'`.

- [ ] **Passo 6: `npm test` + `node --check src/index.js`**.

- [ ] **Passo 7: Commit**

```bash
git add whatsapp-bot/src/keyedQueue.js whatsapp-bot/test/keyedQueue.test.js whatsapp-bot/src/index.js
git commit -m "perf(bot): uma fila por grupo — grupos diferentes deixam de esperar uns pelos outros"
```

---

### Task 6: Menos idas em série à BD + o «In» pede o repost logo

**Ficheiros:**
- Modificar: `whatsapp-bot/src/roster.js` (`loadGame`), `whatsapp-bot/src/commands.js`, `whatsapp-bot/src/sync.js`
- Test: `whatsapp-bot/test/commands.test.js`, criar `whatsapp-bot/test/sync.test.js`

**Interfaces:**
- `loadGame(gameId)` passa a devolver também `rows: Array<{ id, user_id, partner_id, status }>` (confirmados + suplentes). Os campos de antes (`game, people, capacity, suplentes`) ficam iguais.
- Produz em `sync.js`: `export function requestRepostForGame(organizationId: string, gameId: string): void` — agenda o repost nos grupos do clube **pela mesma fila de 4 s** (`scheduleGroupRepost`), com o `gameId` como pista (usado na Tarefa 7). Não faz nada antes de `startSync` correr.

- [ ] **Passo 1: Testes que falham** — acrescentar a `test/commands.test.js`:

```js
const sync = await import('../src/sync.js')

test('«In» faz no máximo 4 idas à BD', async () => {
  await say('in')
  assert.ok(calls.length <= 4, `foram ${calls.length}: ${calls.join(', ')}`)
})

test('«In» pede o repost logo; «Out» não', async (t) => {
  // Um namespace ESM não se pode simular; por isso o commands.js chama
  // através do objeto `repostHooks`, que se pode.
  const asked = []
  t.mock.method(sync.repostHooks, 'requestRepostForGame', (org, gameId) => asked.push(gameId))
  await say('in')
  assert.deepEqual(asked, ['m'])
  asked.length = 0
  await say('out')
  assert.deepEqual(asked, [])
})
```
E em `beforeEach` de `commands.test.js`, depois de `installFakeSupabase`, limpar a cache dos mixes abertos (5 s), que senão passa de um teste para o outro:
```js
  const { _clearOpenMixesCacheForTests } = await import('../src/roster.js')
  _clearOpenMixesCacheForTests()
```
(o `beforeEach` passa a `async`). Em `roster.js`, a seguir ao `openMixesCache`:
```js
/** Só para testes. */
export function _clearOpenMixesCacheForTests() { openMixesCache.clear() }
```

Criar `test/sync.test.js` (Review Focus 4 — rajada):
```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
process.env.SUPABASE_URL = 'http://localhost:1'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'x'
process.env.PHONE_HASH_SECRET = 'x'
const { supabase } = await import('../src/supabase.js')
const { installFakeSupabase } = await import('./fakeSupabase.js')
const { startSyncForTests, repostHooks } = await import('../src/sync.js')

test('rajada de 6 «In» em 1 s → no máximo 2 mensagens no grupo', async () => {
  const db = {
    whatsapp_groups: [{ organization_id: 'o', group_jid: 'g@g.us', label: 'x', levels: null }],
    profiles: [], memberships: [], participants: [],
    games: [{ id: 'm', organization_id: 'o', title: 'Mix', status: 'open', origin: 'manual',
      date: new Date(Date.now() + 864e5).toISOString(), num_courts: 2, max_players: 8, rotate_partners: false }],
  }
  installFakeSupabase(supabase, db)
  const sent = []
  startSyncForTests({ sendText: async (_g, t) => { sent.push(t); return 'id' }, getGroupMentions: async () => [] })
  for (let i = 0; i < 6; i++) {
    db.participants.push({ id: 'p' + i, game_id: 'm', user_id: 'u' + i, status: 'confirmed', created_at: new Date().toISOString() })
    repostHooks.requestRepostForGame('o', 'm')
    await new Promise((r) => setTimeout(r, 150))
  }
  await new Promise((r) => setTimeout(r, 4500))
  assert.ok(sent.length <= 2, `foram ${sent.length} mensagens`)
})
```

- [ ] **Passo 2: Ver falhar** — `npm test` (hoje: ~9 idas; `requestRepostForGame`/`startSyncForTests` não existem).

- [ ] **Passo 3: `loadGame` numa ida só** — em `roster.js`, trocar o `Promise.all` de três consultas + a consulta de perfis por:

```js
export async function loadGame(gameId) {
  const PROFILE = 'id, name, language, rating, gender'
  const participantsSelect = (profile) =>
    `id, user_id, partner_id, status, created_at, user:profiles!participants_user_id_fkey(${profile}), partner:profiles!participants_partner_id_fkey(${profile})`
  const fetchRows = (profile) =>
    supabase
      .from('participants')
      .select(participantsSelect(profile))
      .eq('game_id', gameId)
      .in('status', ['confirmed', 'waitlisted'])
      // Ordem de inscrição (como o GameDetails) — sem ORDER BY o Postgres
      // devolve pela ordem física, que muda quando uma linha é atualizada.
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })

  // Jogo e inscritos (já com os perfis, numa só consulta) em paralelo:
  // uma ida à BD em vez de duas seguidas.
  let [gameResult, rowsResult] = await Promise.all([
    supabase.from('games').select('*').eq('id', gameId).single(),
    fetchRows(PROFILE),
  ])
  // 42703: a migração do Elo ainda não correu — nomes sem banda.
  if (rowsResult.error?.code === '42703') rowsResult = await fetchRows('id, name, language')

  const { data: game, error: gameError } = gameResult
  if (gameError) throw new Error(`Failed to load game ${gameId}: ${gameError.message}`)
  const { data: all, error: rowsError } = rowsResult
  if (rowsError) throw new Error(`Failed to load participants for game ${gameId}: ${rowsError.message}`)

  const FALLBACK_PERSON = { name: 'Jogador', rating: null, gender: null }
  const confirmed = all.filter((r) => r.status === 'confirmed')
  const people = []
  // Quem entrou em dupla leva o número da dupla (1, 2, …) — o «(1)» à frente
  // dos dois nomes (A2N, 24 set). Quem entrou sozinho não leva nada.
  let pairNumber = 0
  for (const row of confirmed) {
    const pair = row.partner_id ? ++pairNumber : null
    people.push({ ...(row.user || FALLBACK_PERSON), pair })
    if (row.partner_id) people.push({ ...(row.partner || FALLBACK_PERSON), pair })
  }
  const suplentes = all.filter((r) => r.status === 'waitlisted').map((r) => r.user || FALLBACK_PERSON)
  const rows = all.map(({ id, user_id, partner_id, status }) => ({ id, user_id, partner_id, status }))
  const capacity = game.max_players || game.num_courts * 4
  return { game, people, capacity, suplentes, rows }
}
```

- [ ] **Passo 4: `commands.js` — perfil e mixes em paralelo; reaproveitar `rows`**

Onde hoje está `const resolvedProfile = await resolveProfileByPhoneJid(senderPn, organizationId)`:
```js
  // Quem escreveu e que mixes estão abertos não dependem um do outro — em
  // paralelo. Os mixes só se usam mais abaixo; o erro fica para lá.
  const openMixesPromise = getOpenMixes(organizationId)
  openMixesPromise.catch(() => {})
  const resolvedProfile = await resolveProfileByPhoneJid(senderPn, organizationId)
```
e mais abaixo `const openMixes = (await openMixesPromise).filter((mix) => mixVisibleToGroup(mix, group))`.

Em `actOnGame`: `const { game, people, capacity, rows } = await loadGame(mixRow.id)` e trocar a consulta `existingRows` inteira por:
```js
    // Os inscritos já vieram com o loadGame — sem outra ida à BD.
    const existingRows = rows
```
Em `confirmPairWithUnregistered`, igual: usar `rows` do `loadGame` em vez da consulta a `participants`.

- [ ] **Passo 5: `sync.js` — `requestRepostForGame` pela mesma fila**

No topo de `sync.js`:
```js
// Guardados pelo startSync — o commands.js pede reposts por aqui.
let deps = null

/** O «In» acabou de gravar: pede o repost já, sem esperar pelo Realtime
 *  (que também vai chegar — o hash engole o repetido). Passa SEMPRE pela
 *  fila de 4 s por grupo, para uma rajada continuar a dar no máximo 2
 *  mensagens. Não usar no «Out»: o Realtime é que sabe de promoções de
 *  suplentes, e um repost antes dele perde o «🎉 X subiu…». */
function requestRepostForGame(organizationId, gameId) {
  if (!deps) return
  scheduleRepostForOrg(deps.sendText, deps.getGroupMentions, organizationId, { gameIds: [gameId] })
    .catch((err) => console.error('Failed to request repost:', err))
}
export const repostHooks = { requestRepostForGame }
```
Em `startSync({ sendText, getGroupMentions })`, primeira linha: `deps = { sendText, getGroupMentions }`. E para os testes:
```js
/** Só para testes: liga os deps sem abrir o Realtime nem os intervalos, e
 *  esquece o estado por grupo (hashes, filas) do teste anterior. */
export function startSyncForTests(d) {
  deps = d
  for (const st of groupState.values()) if (st.debounceTimer) clearTimeout(st.debounceTimer)
  groupState.clear()
}
```
`scheduleGroupRepost` passa a aceitar `gameIds = []` e junta-os em `st.pendingGameIds` (um `Set`, criado em `stateFor`); `flushRepost` passa-os a `postGroupRoster` e limpa (Tarefa 7 usa-os; aqui ainda só se guardam).

Em `commands.js`, `import { repostHooks } from './sync.js'` e, a seguir a cada gravação com sucesso de uma **entrada** — «In» sozinho, `joinAsPair`, «Sim» de suplente, `confirmPairWithUnregistered`:
```js
    repostHooks.requestRepostForGame(organizationId, game.id)
```
(no «Sim» de suplente o id é `pending.gameId`). **Não** no «Out».

- [ ] **Passo 6: `npm test`** — todos verdes (incluindo «≤ 4 idas», «Out não pede» e «rajada ≤ 2 mensagens»).

- [ ] **Passo 7: Commit**

```bash
git add whatsapp-bot/src whatsapp-bot/test
git commit -m "perf(bot): loadGame numa ida à BD, perfil e mixes em paralelo, e o «In» pede o repost sem esperar pelo Realtime (pela fila de 4 s)"
```

---

### Task 7: O repost só recarrega o mix que mudou

**Ficheiros:**
- Modificar: `whatsapp-bot/src/sync.js` (`postGroupRoster`, `flushRepost`, o handler Realtime de `participants`)
- Test: `whatsapp-bot/test/sync.test.js`

**Interfaces:**
- Consome: `st.pendingGameIds` (Tarefa 6). `postGroupRoster(..., { gameIds: Set<string> })` — vazio = recarrega todos (como hoje).

- [ ] **Passo 1: Testes que falham** — acrescentar a `test/sync.test.js`:

```js
const { calls } = await import('./fakeSupabase.js')
const { _clearOpenMixesCacheForTests } = await import('../src/roster.js')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const mix = (id, hoursAhead) => ({ id, organization_id: 'o', title: 'Mix ' + id, status: 'open', origin: 'manual',
  date: new Date(Date.now() + hoursAhead * 3600e3).toISOString(), num_courts: 1, max_players: 4, rotate_partners: false })

function setup(games) {
  const db = {
    whatsapp_groups: [{ organization_id: 'o', group_jid: 'g@g.us', label: 'x', levels: null }],
    profiles: [], memberships: [], participants: [], games,
  }
  installFakeSupabase(supabase, db)
  _clearOpenMixesCacheForTests()
  const sent = []
  startSyncForTests({ sendText: async (_g, t) => { sent.push(t); return 'id' }, getGroupMentions: async () => [] })
  return { db, sent }
}

test('com pista, só carrega o mix indicado', async () => {
  const { db } = setup([mix('m1', 24), mix('m2', 48)])
  repostHooks.requestRepostForGame('o', 'm1')          // 1.º: fixa a lista (carrega os dois)
  await wait(4500)
  db.participants.push({ id: 'p1', game_id: 'm1', user_id: 'u1', status: 'confirmed', created_at: new Date().toISOString() })
  _clearOpenMixesCacheForTests()
  calls.length = 0
  repostHooks.requestRepostForGame('o', 'm1')          // 2.º: mesma lista → só o m1
  await wait(4500)
  assert.equal(calls.filter((c) => c === 'participants').length, 1)
})

test('se a lista de mixes abertos mudou, recarrega todos (Review Focus 5)', async () => {
  const { db, sent } = setup([mix('m1', 24), mix('m2', 48)])
  repostHooks.requestRepostForGame('o', 'm1')
  await wait(4500)
  db.games.push(mix('m0', 12))                          // abre um mix ANTES dos outros → numeração muda
  _clearOpenMixesCacheForTests()
  sent.length = 0
  repostHooks.requestRepostForGame('o', 'm1')
  await wait(4500)
  assert.ok(sent.some((m) => m.includes('*Mix m0*') && m.includes('🔢 Nº: 01')), 'o mix novo passa a ser o 01')
  assert.ok(sent.some((m) => m.includes('*Mix m1*') && m.includes('🔢 Nº: 02')), 'o m1 passa a 02')
  assert.ok(sent.length === 3, `devia reenviar os 3 (numeração nova), foram ${sent.length}`)
})
```

- [ ] **Passo 2: Ver falhar** — `npm test` (hoje carrega sempre todos).

- [ ] **Passo 3: Implementar** — em `postGroupRoster`, trocar:
```js
  const mixStates = await Promise.all(openMixes.map((mix) => loadGame(mix.id)))
  const st = stateFor(group.groupJid)
  const total = mixStates.length
```
por:
```js
  const st = stateFor(group.groupJid)
  const total = openMixes.length
  // Só vale a pena carregar os mixes que mudaram SE a lista de abertos é a
  // mesma do último repost — senão a numeração 01/02 dos outros muda e têm
  // de ser todos refeitos.
  const idsKey = openMixes.map((m) => m.id).join(',')
  const narrow = gameIds.size > 0 && st.openIdsKey === idsKey
  st.openIdsKey = idsKey
  const toLoad = narrow ? openMixes.filter((m) => gameIds.has(m.id)) : openMixes
  const mixStates = await Promise.all(toLoad.map((mix) => loadGame(mix.id)))
  const indexOf = new Map(openMixes.map((m, i) => [m.id, i]))
```
no ciclo, `const label = total > 1 ? String(indexOf.get(gameId) + 1).padStart(2, '0') : null`; e o bloco «Drop mixes no longer open» passa a usar os ids de `openMixes` (não de `mixStates`):
```js
  const openIds = new Set(openMixes.map((m) => m.id))
  for (const gameId of st.mixes.keys()) {
    if (!openIds.has(gameId)) st.mixes.delete(gameId)
  }
```
Assinatura: `postGroupRoster(sendText, getGroupMentions, group, { tagAll = false, promotedByGameId = new Map(), gameIds = new Set() } = {})`. Em `flushRepost`: `const gameIds = st.pendingGameIds; st.pendingGameIds = new Set()` e passar `{ tagAll, promotedByGameId, gameIds }`. No handler Realtime de `participants`, passar `gameIds: [payload.new?.game_id ?? payload.old?.game_id]` nos dois `scheduleRepostForOrg`. O intervalo de reconciliação e o `primeGroupHashes` continuam sem pista (carregam tudo).

- [ ] **Passo 4: `npm test`** — todos verdes.

- [ ] **Passo 5: Commit**

```bash
git add whatsapp-bot/src/sync.js whatsapp-bot/test/sync.test.js
git commit -m "perf(bot): o repost só recarrega o mix que mudou, a não ser que a lista de mixes abertos tenha mudado"
```

---

### Task 8: Pôr no ar e comparar

- [ ] **Passo 1:** Renato corre `supabase/migration_mix_capacity_guard.sql` em produção (depois a consulta «PARA VER DEPOIS» do fim do ficheiro, para ver se há mixes abertos já acima das vagas).
- [ ] **Passo 2:** push `dev` → `main` (só com a migração corrida — a app das Tarefas 2 não depende dela, mas o texto só aparece com ela).
- [ ] **Passo 3:** redeploy do bot no EC2.
- [ ] **Passo 4:** num grupo de teste, 5 «In»/«Out»; `docker logs <bot> --since 10m | grep '"timing"'` e comparar `total_ms` do `cmd:in` e do `repost` com o «antes» (se houver).
- [ ] **Passo 5:** mensagem no #dev-updates com os números antes/depois.
- [ ] **Passo 6 (Renato, fora do código):** confirmar a região do EC2 (consola AWS) e a do Supabase (Settings → General → Region); se forem diferentes, é o próximo passo. E no CloudWatch, `CPUCreditBalance` da instância.
