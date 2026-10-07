# Robô com número de reserva automático — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dois números do robô nos grupos, só um a falar de cada vez; se o ativo for banido ou cair, o outro assume sozinho em segundos — e um limitador de envios que baixa o risco de ban.

**Architecture:** Um "lease" numa tabela do Supabase decide qual dos dois processos (principal/reserva) está ativo; o ativo renova-o a cada 20 s e liberta-o ao levar 403. Tudo o que envia ou mexe na BD passa por `isActive()`. Um `sendGuard` à volta do `sendText` espaça os envios, faz rampa depois de ligar e segura as mensagens de baixa prioridade (lembretes, avisos) em horas calmas e acima dos tetos.

**Tech Stack:** Node 22 (ESM), `@whiskeysockets/baileys` 6.7.9, `@supabase/supabase-js` (service role), testes com `node:test`; app Vite/React com Vitest; Postgres (migração manual no SQL Editor).

**Spec:** `docs/superpowers/specs/2026-10-06-bot-numero-reserva-design.md`

## Global Constraints

- Lease: validade **90 s**, renovação a cada **20 s**, margem local **10 s** (o ativo cala-se aos 80 s sem renovar).
- Sem retorno automático ao principal: quem tem o lease fica com ele até cair.
- Limites: **30 mensagens/hora**; teto diário `BOT_DAILY_CAP` (por defeito **200**; **60** nos primeiros **10 dias** depois de `BOT_NUMBER_SINCE`).
- Espaço entre envios: **1,5–4 s** aleatórios; nos primeiros **60 s** depois de ligar, no mínimo **6 s**.
- Horas calmas: **00:00–07:30 Europe/Lisbon** — só para baixa prioridade.
- Baixa prioridade = lembretes e publicações agendadas (`reminders.js`), `mixNotices.js`, `voucherNotices.js`, anúncio de troca de número. Tudo o resto (respostas a comandos, reposts do `sync.js`, arranque automático) passa sempre, só com o espaçamento.
- Sem a tabela `bot_lease` (migração por correr), o robô fica **sempre ativo** e regista um aviso — comportamento de hoje.
- Sem dependências npm novas. Sem `baileys-antiban`.
- Commits sem linha de atribuição ao Claude (regra da equipa). Trabalho em `dev`.
- Texto do anúncio de troca (pt): `🤖 O robô passou a responder por este número. Continua tudo igual: *In*, *Out* e *mix*.` (en): `🤖 The bot now answers from this number. Everything works the same: *In*, *Out* and *mix*.`

## Review Focus

- **BD em baixo com o ativo ligado ao WhatsApp** → o ativo tem de se calar aos 80 s, e a reserva só assume aos 90 s (sem os dois a falar). Teste no Task 2.
- **Os dois processos arrancam ao mesmo tempo** (deploy, reboot do EC2) → só um fica ativo; o `claim` é atómico na BD. Teste no Task 1 (SQL manual) e Task 2 (fake RPC atómico).
- **O principal volta depois de a reserva assumir** → continua calado, sem anúncio. Teste no Task 2.
- **Tique de lembrete saltado por horas calmas/teto** → o lembrete sai no tique seguinte permitido, não se perde nem duplica. Verificação no Task 5.
- **Mensagem de grupo que chega ao processo calado** → ignorada, sem resposta, sem escrita na BD; mas um código de confirmação em privado é tratado pelos dois. Teste no Task 4.

---

## Estrutura de ficheiros

| Ficheiro | Responsabilidade |
|---|---|
| `supabase/migration_bot_lease.sql` (novo) | Tabela `bot_lease` + RPCs `claim_bot_lease`, `release_bot_lease`, `get_active_bot_number` |
| `whatsapp-bot/src/lease.js` (novo) | Quem está ativo: reclamar/renovar/libertar o lease, validade local, `onChange` |
| `whatsapp-bot/src/sendGuard.js` (novo) | Espaçamento, rampa, tetos, horas calmas |
| `whatsapp-bot/src/alerts.js` (novo) | Aviso no Slack por webhook (opcional) |
| `whatsapp-bot/src/config.js` | Variáveis novas |
| `whatsapp-bot/src/wa.js` | `sendText`/`sendReaction` passam pelo guard e pelo `isActive`; 403/logout → `onFatal` |
| `whatsapp-bot/src/index.js` | Liga tudo: lease, guard, alertas, gates, anúncio de troca |
| `whatsapp-bot/src/sync.js`, `reminders.js`, `autostart.js`, `mixNotices.js`, `voucherNotices.js` | `if (!canRun()) return` no início de cada tique |
| `whatsapp-bot/src/locales.js` | Texto do anúncio |
| `src/lib/contacts.js`, `src/pages/Landing.jsx`, `src/pages/Plans.jsx` | Número do robô vem do RPC, com recurso ao fixo |
| `whatsapp-bot/README.md` | Operação: emparelhar a reserva, voltar ao principal à mão |

---

### Task 1: Migração `bot_lease`

**Files:**
- Create: `supabase/migration_bot_lease.sql`

**Interfaces:**
- Produces: `claim_bot_lease(p_pool text, p_holder text, p_phone text, p_ttl_seconds int) → jsonb {granted boolean, expires_at timestamptz, previous_holder text}`; `release_bot_lease(p_pool text, p_holder text) → void`; `get_active_bot_number(p_pool text default 'prod') → text`.

- [ ] **Step 1: Escrever a migração**

```sql
-- Robô com número de reserva (spec 2026-10-06-bot-numero-reserva-design.md).
-- Só um processo do robô fala de cada vez: o que tem o lease válido.
-- Correr no SQL Editor do Supabase (dev e prod) ANTES do robô novo.

CREATE TABLE IF NOT EXISTS bot_lease (
  pool TEXT PRIMARY KEY,
  holder TEXT NOT NULL,
  phone TEXT NOT NULL,
  renewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- RLS ligada e sem políticas: nenhum cliente (anon/authenticated) lê nem
-- escreve. Só o service role do robô, e só pelos RPCs abaixo.
ALTER TABLE bot_lease ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION claim_bot_lease(p_pool TEXT, p_holder TEXT, p_phone TEXT, p_ttl_seconds INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev TEXT;
  v_row bot_lease;
BEGIN
  SELECT holder INTO v_prev FROM bot_lease WHERE pool = p_pool FOR UPDATE;

  INSERT INTO bot_lease (pool, holder, phone, renewed_at, expires_at)
  VALUES (p_pool, p_holder, p_phone, now(), now() + make_interval(secs => p_ttl_seconds))
  ON CONFLICT (pool) DO UPDATE
    SET holder = EXCLUDED.holder, phone = EXCLUDED.phone,
        renewed_at = EXCLUDED.renewed_at, expires_at = EXCLUDED.expires_at
    WHERE bot_lease.holder = EXCLUDED.holder OR bot_lease.expires_at < now()
  RETURNING * INTO v_row;

  IF v_row.pool IS NULL THEN
    RETURN jsonb_build_object('granted', false, 'expires_at', NULL, 'previous_holder', v_prev);
  END IF;
  RETURN jsonb_build_object('granted', true, 'expires_at', v_row.expires_at, 'previous_holder', v_prev);
END;
$$;

CREATE OR REPLACE FUNCTION release_bot_lease(p_pool TEXT, p_holder TEXT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE bot_lease SET expires_at = now() - interval '1 second'
  WHERE pool = p_pool AND holder = p_holder;
$$;

-- O número do robô já é público (está na página Planos). Devolve só o
-- número, e só se o lease estiver válido.
CREATE OR REPLACE FUNCTION get_active_bot_number(p_pool TEXT DEFAULT 'prod')
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT phone FROM bot_lease WHERE pool = p_pool AND expires_at > now();
$$;

REVOKE ALL ON FUNCTION claim_bot_lease(TEXT, TEXT, TEXT, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION release_bot_lease(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_bot_lease(TEXT, TEXT, TEXT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION release_bot_lease(TEXT, TEXT) TO service_role;
REVOKE ALL ON FUNCTION get_active_bot_number(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_active_bot_number(TEXT) TO anon, authenticated;
```

- [ ] **Step 2: Correr no Supabase de DEV e verificar à mão**

No SQL Editor do projeto de dev:

```sql
SELECT claim_bot_lease('t', 'a', '351900000001', 90);  -- granted true, previous_holder null
SELECT claim_bot_lease('t', 'b', '351900000002', 90);  -- granted false, previous_holder 'a'
SELECT claim_bot_lease('t', 'a', '351900000001', 90);  -- granted true (renovação)
SELECT release_bot_lease('t', 'a');
SELECT claim_bot_lease('t', 'b', '351900000002', 90);  -- granted true, previous_holder 'a'
SELECT get_active_bot_number('t');                     -- '351900000002'
DELETE FROM bot_lease WHERE pool = 't';
```

E, com a chave anon (ex.: consola do browser na app de dev): `supabase.from('bot_lease').select()` → 0 linhas; `supabase.rpc('claim_bot_lease', {...})` → erro de permissão.

- [ ] **Step 3: Commit**

```bash
git add supabase/migration_bot_lease.sql
git commit -m "Robô de reserva: migração bot_lease (lease de quem fala)"
```

---

### Task 2: `lease.js` — quem está ativo

**Files:**
- Create: `whatsapp-bot/src/lease.js`
- Test: `whatsapp-bot/test/lease.test.js`

**Interfaces:**
- Consumes: RPCs do Task 1 (via uma função `rpc(name, args) → Promise<{data, error}>`).
- Produces:
  ```js
  createLease({ rpc, pool, holder, phone, ttlMs = 90_000, renewMs = 20_000, marginMs = 10_000,
                now = Date.now, setIntervalFn = setInterval, clearIntervalFn = clearInterval,
                onChange = () => {}, log = console })
    → { start(): Promise<void>, stop(): void, tick(): Promise<void>,
        isActive(): boolean, release(): Promise<void> }
  // onChange({ active: boolean, previousHolder: string|null })
  ```

- [ ] **Step 1: Escrever os testes**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLease } from '../src/lease.js'

// RPC falso e atómico, como a função SQL: um lease por pool, com o mesmo relógio.
function fakeDb(clock) {
  const rows = new Map()
  let down = false
  const rpc = async (name, args) => {
    if (down) return { data: null, error: { message: 'fetch failed' } }
    if (name === 'claim_bot_lease') {
      const cur = rows.get(args.p_pool)
      const prev = cur?.holder ?? null
      if (!cur || cur.holder === args.p_holder || cur.expiresAt < clock.t) {
        rows.set(args.p_pool, { holder: args.p_holder, expiresAt: clock.t + args.p_ttl_seconds * 1000 })
        return { data: { granted: true, expires_at: null, previous_holder: prev }, error: null }
      }
      return { data: { granted: false, expires_at: null, previous_holder: prev }, error: null }
    }
    if (name === 'release_bot_lease') {
      const cur = rows.get(args.p_pool)
      if (cur?.holder === args.p_holder) cur.expiresAt = clock.t - 1000
      return { data: null, error: null }
    }
    throw new Error(name)
  }
  return { rpc, setDown: (v) => { down = v } }
}

const mk = (db, clock, holder, changes = []) => createLease({
  rpc: db.rpc, pool: 'prod', holder, phone: holder, now: () => clock.t,
  setIntervalFn: () => 0, clearIntervalFn: () => {}, onChange: (c) => changes.push(c), log: { warn() {}, error() {}, info() {} },
})

test('só um fica ativo; o segundo fica calado', async () => {
  const clock = { t: 0 }; const db = fakeDb(clock)
  const a = mk(db, clock, 'principal'); const b = mk(db, clock, 'reserva')
  await a.tick(); await b.tick()
  assert.equal(a.isActive(), true)
  assert.equal(b.isActive(), false)
})

test('a reserva assume quando o principal deixa de renovar', async () => {
  const clock = { t: 0 }; const db = fakeDb(clock)
  const changes = []
  const a = mk(db, clock, 'principal'); const b = mk(db, clock, 'reserva', changes)
  await a.tick(); await b.tick()
  clock.t = 91_000
  await b.tick()
  assert.equal(b.isActive(), true)
  assert.deepEqual(changes.at(-1), { active: true, previousHolder: 'principal' })
})

test('release (403) passa o lease logo no tique seguinte da reserva', async () => {
  const clock = { t: 0 }; const db = fakeDb(clock)
  const a = mk(db, clock, 'principal'); const b = mk(db, clock, 'reserva')
  await a.tick(); await b.tick()
  await a.release()
  assert.equal(a.isActive(), false)
  clock.t = 20_000
  await b.tick()
  assert.equal(b.isActive(), true)
})

test('sem BD, o ativo cala-se aos 80 s, antes de a reserva poder assumir', async () => {
  const clock = { t: 0 }; const db = fakeDb(clock)
  const a = mk(db, clock, 'principal')
  await a.tick()
  db.setDown(true)
  clock.t = 79_000; await a.tick()
  assert.equal(a.isActive(), true)
  clock.t = 80_001
  assert.equal(a.isActive(), false)
})

test('o principal volta e fica calado (sem flapping)', async () => {
  const clock = { t: 0 }; const db = fakeDb(clock)
  const changesA = []
  const a = mk(db, clock, 'principal', changesA); const b = mk(db, clock, 'reserva')
  await a.tick(); await a.release()
  await b.tick()
  clock.t = 20_000; await a.tick(); await b.tick()
  clock.t = 40_000; await a.tick(); await b.tick()
  assert.equal(a.isActive(), false)
  assert.equal(b.isActive(), true)
})

test('sem a tabela (migração por correr), fica sempre ativo', async () => {
  const lease = createLease({
    rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }),
    pool: 'prod', holder: 'principal', phone: 'x', now: () => 0,
    setIntervalFn: () => 0, clearIntervalFn: () => {}, log: { warn() {}, error() {}, info() {} },
  })
  await lease.tick()
  assert.equal(lease.isActive(), true)
})
```

- [ ] **Step 2: Correr e ver falhar**

Run: `cd whatsapp-bot && node --test test/lease.test.js`
Expected: FAIL — `Cannot find module '../src/lease.js'`.

- [ ] **Step 3: Implementar**

```js
// Quem fala: o processo com o lease válido na tabela bot_lease
// (migration_bot_lease.sql, spec 2026-10-06-bot-numero-reserva-design.md).
// O ativo renova a cada 20 s (validade 90 s) e cala-se SOZINHO 10 s antes
// de a validade acabar se não conseguir renovar — assim, mesmo com a BD em
// baixo, nunca há dois números a falar ao mesmo tempo.

const MISSING = new Set(['PGRST202', '42883', '42P01'])

export function createLease({
  rpc, pool, holder, phone,
  ttlMs = 90_000, renewMs = 20_000, marginMs = 10_000,
  now = Date.now, setIntervalFn = setInterval, clearIntervalFn = clearInterval,
  onChange = () => {}, log = console,
}) {
  let activeUntil = 0 // hora local até à qual podemos falar
  let alwaysOn = false // sem migração: comportamento de hoje
  let wasActive = false
  let timer = null

  const isActive = () => alwaysOn || now() < activeUntil

  function report(previousHolder) {
    const active = isActive()
    if (active !== wasActive) {
      wasActive = active
      onChange({ active, previousHolder })
    }
  }

  async function tick() {
    const startedAt = now()
    const { data, error } = await rpc('claim_bot_lease', {
      p_pool: pool, p_holder: holder, p_phone: phone, p_ttl_seconds: Math.round(ttlMs / 1000),
    })
    if (error) {
      if (MISSING.has(error.code)) {
        if (!alwaysOn) log.warn('bot_lease não existe (migration_bot_lease.sql por correr) — fico sempre ativo.')
        alwaysOn = true
      } else {
        log.error({ error }, 'Falha a renovar o lease — calo-me quando a validade local acabar.')
      }
      report(null)
      return
    }
    alwaysOn = false
    activeUntil = data?.granted ? startedAt + ttlMs - marginMs : 0
    report(data?.previous_holder ?? null)
  }

  async function release() {
    activeUntil = 0
    alwaysOn = false
    report(null)
    const { error } = await rpc('release_bot_lease', { p_pool: pool, p_holder: holder })
    if (error) log.error({ error }, 'Falha a libertar o lease — a reserva assume quando expirar.')
  }

  return {
    isActive,
    tick,
    release,
    async start() {
      await tick()
      timer = setIntervalFn(() => { tick().catch((err) => log.error({ err }, 'Lease tick failed')) }, renewMs)
    },
    stop() { if (timer) clearIntervalFn(timer); timer = null },
  }
}
```

Nota: o teste «sem BD, cala-se aos 80 s» verifica `isActive()` sem tique — o `isActive` compara com o relógio, por isso não depende do intervalo.

- [ ] **Step 4: Correr e ver passar**

Run: `cd whatsapp-bot && node --test test/lease.test.js`
Expected: 6 testes PASS.

- [ ] **Step 5: Commit**

```bash
git add whatsapp-bot/src/lease.js whatsapp-bot/test/lease.test.js
git commit -m "Robô de reserva: lease.js decide qual processo fala"
```

---

### Task 3: `sendGuard.js` — ritmo de envio

**Files:**
- Create: `whatsapp-bot/src/sendGuard.js`
- Test: `whatsapp-bot/test/sendGuard.test.js`

**Interfaces:**
- Produces:
  ```js
  createSendGuard({ now = Date.now, random = Math.random, sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
                    hourlyCap = 30, dailyCap = 200, warmupDailyCap = 60, numberSince = null /* 'YYYY-MM-DD' */,
                    warmupDays = 10, quietStart = '00:00', quietEnd = '07:30', timeZone = 'Europe/Lisbon' })
    → { beforeSend(): Promise<void>, noteSent(): void, noteConnected(): void, allowLowPriority(): boolean }
  ```

- [ ] **Step 1: Escrever os testes**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSendGuard } from '../src/sendGuard.js'

// 2026-10-06 12:00 em Lisboa = 11:00 UTC (horário de verão).
const NOON = Date.parse('2026-10-06T11:00:00Z')

function guard(opts = {}) {
  const clock = { t: opts.t ?? NOON }
  const slept = []
  const g = createSendGuard({
    now: () => clock.t, random: () => 0.5,
    sleep: async (ms) => { slept.push(ms); clock.t += ms },
    numberSince: '2026-01-01', ...opts,
  })
  return { g, clock, slept }
}

test('espaça envios seguidos entre 1,5 e 4 s', async () => {
  const { g, slept } = guard()
  await g.beforeSend(); g.noteSent()
  await g.beforeSend(); g.noteSent()
  assert.equal(slept.length, 1)
  assert.ok(slept[0] >= 1500 && slept[0] <= 4000)
})

test('nos 60 s depois de ligar, pelo menos 6 s entre envios', async () => {
  const { g, slept } = guard()
  g.noteConnected()
  await g.beforeSend(); g.noteSent()
  await g.beforeSend(); g.noteSent()
  assert.ok(slept.at(-1) >= 6000)
})

test('horas calmas: baixa prioridade não, de dia sim', () => {
  assert.equal(guard({ t: Date.parse('2026-10-06T01:00:00Z') }).g.allowLowPriority(), false) // 02:00 Lisboa
  assert.equal(guard({ t: Date.parse('2026-10-06T06:31:00Z') }).g.allowLowPriority(), true)  // 07:31 Lisboa
  assert.equal(guard().g.allowLowPriority(), true)
})

test('acima de 30 por hora, a baixa prioridade espera', () => {
  const { g } = guard()
  for (let i = 0; i < 30; i++) g.noteSent()
  assert.equal(g.allowLowPriority(), false)
})

test('número novo: teto diário de 60 nos primeiros 10 dias', () => {
  const { g } = guard({ numberSince: '2026-10-03' })
  for (let i = 0; i < 60; i++) g.noteSent()
  assert.equal(g.allowLowPriority(), false)
})

test('a contagem por hora esquece envios com mais de 1 h', () => {
  const { g, clock } = guard()
  for (let i = 0; i < 30; i++) g.noteSent()
  clock.t += 61 * 60 * 1000
  assert.equal(g.allowLowPriority(), true)
})
```

- [ ] **Step 2: Correr e ver falhar**

Run: `cd whatsapp-bot && node --test test/sendGuard.test.js`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

```js
// Ritmo de envio do robô (spec 2026-10-06-bot-numero-reserva-design.md):
// nada sai em rajada, a seguir a ligar vai devagar, e o que é de baixa
// prioridade (lembretes, avisos) espera pelas horas de dia e fica abaixo
// dos tetos. Respostas a comandos e reposts nunca são seguradas — só
// espaçadas.

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

const minutesOf = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }

export function createSendGuard({
  now = Date.now, random = Math.random, sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  hourlyCap = 30, dailyCap = 200, warmupDailyCap = 60, numberSince = null, warmupDays = 10,
  quietStart = '00:00', quietEnd = '07:30', timeZone = 'Europe/Lisbon',
} = {}) {
  const sent = [] // horas dos envios das últimas 24 h
  let lastSentAt = 0
  let connectedAt = 0
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

  const prune = () => { const cut = now() - DAY; while (sent.length && sent[0] < cut) sent.shift() }
  const lastHour = () => sent.filter((t) => t > now() - HOUR).length
  const cap = () => {
    if (!numberSince) return dailyCap
    const ageDays = (now() - Date.parse(`${numberSince}T00:00:00Z`)) / DAY
    return ageDays < warmupDays ? Math.min(warmupDailyCap, dailyCap) : dailyCap
  }
  const inQuietHours = () => {
    const [h, m] = fmt.format(new Date(now())).split(':').map(Number)
    const cur = h * 60 + m
    const s = minutesOf(quietStart); const e = minutesOf(quietEnd)
    return s <= e ? cur >= s && cur < e : cur >= s || cur < e
  }

  return {
    async beforeSend() {
      if (!lastSentAt) return
      const warming = connectedAt && now() - connectedAt < 60_000
      const gap = warming ? 6000 : 1500 + random() * 2500
      const wait = lastSentAt + gap - now()
      if (wait > 0) await sleep(wait)
    },
    noteSent() { lastSentAt = now(); sent.push(lastSentAt); prune() },
    noteConnected() { connectedAt = now() },
    allowLowPriority() {
      prune()
      return !inQuietHours() && lastHour() < hourlyCap && sent.length < cap()
    },
  }
}
```

- [ ] **Step 4: Correr e ver passar**

Run: `cd whatsapp-bot && node --test test/sendGuard.test.js`
Expected: 6 testes PASS.

- [ ] **Step 5: Commit**

```bash
git add whatsapp-bot/src/sendGuard.js whatsapp-bot/test/sendGuard.test.js
git commit -m "Robô: sendGuard — espaçamento, rampa ao ligar, tetos e horas calmas"
```

---

### Task 4: Ligar tudo — config, wa.js, index.js, alertas

**Files:**
- Create: `whatsapp-bot/src/alerts.js`
- Modify: `whatsapp-bot/src/config.js`, `whatsapp-bot/src/wa.js` (bloco `connection.update` e o objeto devolvido), `whatsapp-bot/src/index.js`
- Test: `whatsapp-bot/test/activeGate.test.js`

**Interfaces:**
- Consumes: `createLease` (Task 2), `createSendGuard` (Task 3).
- Produces:
  - `connectWhatsApp({ onGroupMessage, onDirectMessage, isActive = () => true, guard = null, onFatal = () => {}, onOpen = () => {} })` — `sendText`/`sendReaction` devolvem `null` sem enviar se `!isActive()`; `onFatal(reason)` com `'forbidden'` ou `'loggedOut'`; `onOpen({ phone })` ao ligar.
  - `sendAlert(text) → Promise<void>` em `alerts.js`.
  - `gateGroupMessage(isActive, handler) → (payload) => void` exportado de `index.js`? Não — fica em `whatsapp-bot/src/activeGate.js` para ser testável:
    `export const gate = (isActive, fn) => (...args) => (isActive() ? fn(...args) : undefined)`.

- [ ] **Step 1: Teste do gate**

`whatsapp-bot/test/activeGate.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gate } from '../src/activeGate.js'

test('calado: o handler não corre', () => {
  let ran = 0
  gate(() => false, () => { ran++ })({})
  assert.equal(ran, 0)
})

test('ativo: o handler corre com os mesmos argumentos', () => {
  let got = null
  gate(() => true, (p) => { got = p })({ text: 'in' })
  assert.deepEqual(got, { text: 'in' })
})
```

Run: `cd whatsapp-bot && node --test test/activeGate.test.js` → FAIL (módulo não existe).

- [ ] **Step 2: `activeGate.js`**

```js
// Só o processo ativo (lease.js) trata mensagens de grupo e corre tarefas.
export const gate = (isActive, fn) => (...args) => (isActive() ? fn(...args) : undefined)
```

Run outra vez → PASS.

- [ ] **Step 3: `alerts.js`**

```js
import { config } from './config.js'

// Aviso para a equipa (Slack, webhook de entrada). Sem a variável, só log.
export async function sendAlert(text) {
  console.warn(`[ALERTA] ${text}`)
  if (!config.slackAlertWebhookUrl) return
  try {
    await fetch(config.slackAlertWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `🤖 Robô (${config.botInstance}): ${text}` }),
    })
  } catch (err) {
    console.error('Falha a enviar o alerta para o Slack:', err)
  }
}
```

- [ ] **Step 4: `config.js` — acrescentar ao objeto `config`**

```js
  // Robô de reserva (spec 2026-10-06): 'principal' ou 'reserva'. Cada um
  // com o seu número e a sua AUTH_DIR (dois contentores no mesmo EC2).
  botInstance: process.env.BOT_INSTANCE || 'principal',
  // O pool do lease: 'prod' em produção, 'dev' no robô de QA.
  leasePool: process.env.LEASE_POOL || 'prod',
  // Desde quando este número é o do robô (YYYY-MM-DD) — nos primeiros 10
  // dias o teto diário é mais baixo.
  botNumberSince: process.env.BOT_NUMBER_SINCE || null,
  botDailyCap: Number(process.env.BOT_DAILY_CAP) || 200,
  slackAlertWebhookUrl: process.env.SLACK_ALERT_WEBHOOK_URL || null,
```

- [ ] **Step 5: `wa.js`**

Assinatura: `export async function connectWhatsApp({ onGroupMessage, onDirectMessage, isActive = () => true, guard = null, onFatal = () => {}, onOpen = () => {} })`.

No `connection === 'open'`, logo a seguir a `reconnectAttempts = 0`:

```js
        guard?.noteConnected()
        onOpen({ phone: String(sock.user?.id || '').split(':')[0].split('@')[0] || null })
```

No ramo `loggedOut`, antes do `return`: `onFatal('loggedOut')`. No ramo `forbidden`, antes do `return`: `onFatal('forbidden')`.

No objeto devolvido, substituir `sendText` e `sendReaction`:

```js
    sendText: async (groupJid, text, options = {}) => {
      if (!sock) throw new Error('WhatsApp socket not connected yet')
      // Rede de segurança: o processo calado nunca fala (lease.js).
      if (!isActive()) { logger.warn({ groupJid }, 'Não sou o robô ativo — mensagem não enviada.'); return null }
      await guard?.beforeSend()
      const content = { text, ...(options.mentions ? { mentions: options.mentions } : {}) }
      const sent = await sock.sendMessage(groupJid, content, options.quoted ? { quoted: options.quoted } : undefined)
      guard?.noteSent()
      return sent?.key?.id ?? null
    },
    sendReaction: async (groupJid, messageKey, emoji) => {
      if (!sock) throw new Error('WhatsApp socket not connected yet')
      if (!isActive()) return
      await guard?.beforeSend()
      await sock.sendMessage(groupJid, { react: { text: emoji, key: messageKey } })
      guard?.noteSent()
    },
```

- [ ] **Step 6: `index.js`**

Antes do `connectWhatsApp`:

```js
import { supabase } from './supabase.js'
import { createLease } from './lease.js'
import { createSendGuard } from './sendGuard.js'
import { sendAlert } from './alerts.js'
import { gate } from './activeGate.js'
import { t } from './locales.js'
import { getGroups } from './groups.js'
import { primeGroupHashes } from './sync.js'

  const guard = createSendGuard({ dailyCap: config.botDailyCap, numberSince: config.botNumberSince })
  let myPhone = null
  let announceOnActive = null // previousHolder a anunciar quando o socket estiver aberto
  const lease = createLease({
    rpc: (name, args) => supabase.rpc(name, args),
    pool: config.leasePool,
    holder: config.botInstance,
    phone: () => myPhone, // ver nota abaixo
    onChange: ({ active, previousHolder }) => {
      console.log(`Lease: ${active ? 'ATIVO' : 'calado'} (antes: ${previousHolder ?? '—'})`)
      if (active && previousHolder && previousHolder !== config.botInstance) {
        sendAlert(`assumi os grupos (o ${previousHolder} deixou de responder).`)
        takeOver().catch((err) => console.error('Takeover failed:', err))
      }
      if (!active && previousHolder === null) sendAlert('deixei de ser o robô ativo.')
    },
  })
  const isActive = () => lease.isActive()
```

Nota sobre `phone`: o `lease.js` do Task 2 recebe `phone` como string. Mudar no Task 2 para aceitar string **ou** função: no `tick`, `p_phone: typeof phone === 'function' ? phone() : phone`, e não reclamar enquanto for `null` (`if (!p_phone) { report(null); return }`). Acrescentar este teste ao `lease.test.js`:

```js
test('sem número ainda (socket por abrir), não reclama', async () => {
  const clock = { t: 0 }; const db = fakeDb(clock)
  const a = createLease({ rpc: db.rpc, pool: 'prod', holder: 'a', phone: () => null, now: () => clock.t,
    setIntervalFn: () => 0, clearIntervalFn: () => {}, log: { warn() {}, error() {}, info() {} } })
  await a.tick()
  assert.equal(a.isActive(), false)
})
```

Na chamada ao `connectWhatsApp`:

```js
  const { sendText, sendReaction, getGroupMentions, getParticipatingGroupJids } = await connectWhatsApp({
    isActive,
    guard,
    onOpen: ({ phone }) => {
      myPhone = phone
      lease.tick().catch((err) => console.error('Lease tick failed:', err))
    },
    onFatal: (reason) => {
      sendAlert(reason === 'forbidden'
        ? 'o WhatsApp recusou este número (403 — banido?). Larguei o lease; a reserva deve assumir.'
        : 'sessão terminada (logged out). Larguei o lease; é preciso re-emparelhar.')
      lease.release().catch((err) => console.error('Lease release failed:', err))
    },
    onGroupMessage: gate(isActive, (payload) => {
      enqueue(payload.groupJid, () => handleGroupMessage(payload, { sendText, sendReaction }))
    }),
    // Os códigos de confirmação do número tratam-se nos DOIS processos: não
    // enviam nada, só gravam na BD.
    onDirectMessage: (payload) => {
      enqueue(`dm:${payload.chatJid}`, () => handleDirectMessage(payload, { sendText }))
    },
  })
  await lease.start()
```

E a função de troca (dentro de `main`, depois de `sendText` existir):

```js
  // A reserva acabou de assumir: regista os cartões que já estão nos grupos
  // (sem os reenviar) e diz uma vez por grupo que o robô mudou de número.
  async function takeOver() {
    await primeGroupHashes()
    for (const group of await getGroups()) {
      if (!guard.allowLowPriority()) break // de noite ou acima do teto: fica sem anúncio
      await sendText(group.groupJid, t('bot_number_changed', group.lang ?? 'pt'))
    }
  }
```

Passar `isActive` e a regra de baixa prioridade às tarefas (o Task 5 usa-os):

```js
  const canRun = isActive
  const canRunLow = () => isActive() && guard.allowLowPriority()
  startSync({ sendText, getGroupMentions, canRun })
  startReminders({ sendText, getGroupMentions, canRun: canRunLow })
  startAutoStart({ sendText, canRun })
  startMixNotices({ sendText, canRun: canRunLow })
  startGuestVoucherNotices({ sendText, canRun: canRunLow })
```

Exportar `primeGroupHashes` em `sync.js` (hoje é `async function primeGroupHashes()` sem `export`): pôr `export`.

Se `getGroups()` não devolver `lang` por grupo, usar `'pt'` (o `?? 'pt'` acima já cobre).

- [ ] **Step 7: Correr toda a bateria**

Run: `cd whatsapp-bot && npm test`
Expected: tudo PASS menos o já conhecido «In faz no máximo 4 idas à BD» (falha antes deste trabalho — ver commit `a82f5a9`). Nenhuma falha nova.

- [ ] **Step 8: Commit**

```bash
git add whatsapp-bot/src/activeGate.js whatsapp-bot/src/alerts.js whatsapp-bot/src/config.js whatsapp-bot/src/wa.js whatsapp-bot/src/index.js whatsapp-bot/src/lease.js whatsapp-bot/src/sync.js whatsapp-bot/test/activeGate.test.js whatsapp-bot/test/lease.test.js
git commit -m "Robô de reserva: só o processo com o lease fala; 403 larga o lease e avisa no Slack"
```

---

### Task 5: Tarefas agendadas respeitam o lease e as horas calmas

**Files:**
- Modify: `whatsapp-bot/src/sync.js` (`startSync`, `requestRepostForGame`, tique de reconciliação), `reminders.js:299-307`, `autostart.js:361-365`, `mixNotices.js:125-129`, `voucherNotices.js:89-93`, `locales.js`
- Test: `whatsapp-bot/test/sync.test.js` (acrescentar), `whatsapp-bot/test/voucherNotices.test.js` (acrescentar)

**Interfaces:**
- Consumes: `canRun: () => boolean` passado pelo `index.js` (Task 4). Por defeito `() => true` em todas (os testes antigos não mudam).

- [ ] **Step 1: Teste — o sync calado não reposta**

Em `whatsapp-bot/test/sync.test.js`, seguindo o padrão dos testes que já lá estão (`startSyncForTests`), acrescentar:

```js
test('processo calado: requestRepostForGame não envia nada', async () => {
  const sent = []
  startSyncForTests({ sendText: async (_g, text) => { sent.push(text); return 'id' }, getGroupMentions: async () => [], canRun: () => false })
  repostHooks.requestRepostForGame('o', 'm')
  await new Promise((r) => setTimeout(r, 4500))
  assert.deepEqual(sent, [])
})
```

(Se o ficheiro importar os nomes de outra forma, usar os mesmos imports que os testes vizinhos. Se a espera de 4,5 s for lenta demais, usar o `mock.timers` de `node:test` como os testes vizinhos fazem, se o fazem.)

Run: `cd whatsapp-bot && node --test test/sync.test.js` → FAIL (envia).

- [ ] **Step 2: Gates no `sync.js`**

`deps` passa a guardar `canRun`:

```js
export function startSync({ sendText, getGroupMentions, canRun = () => true }) {
  deps = { sendText, getGroupMentions, canRun }
```

e `startSyncForTests(d)` já guarda `d` inteiro. No início de `requestRepostForGame`:

```js
  if (!deps || !(deps.canRun ?? (() => true))()) return
```

Em cada handler do canal Realtime e no tique de reconciliação, primeira linha:

```js
      if (!canRun()) return
```

- [ ] **Step 3: Gates nas outras tarefas**

`reminders.js`:

```js
export function startReminders({ sendText, getGroupMentions, canRun = () => true }) {
  setInterval(() => {
    if (!canRun()) return
    checkGameDayReminders({ sendText }).catch((err) => console.error('Game-day reminder check failed:', err))
  }, GAME_DAY_CHECK_INTERVAL_MS)

  setInterval(() => {
    if (!canRun()) return
    checkScheduledPosts({ sendText, getGroupMentions }).catch((err) => console.error('Scheduled posts check failed:', err))
  }, POST_CHECK_INTERVAL_MS)
}
```

O mesmo padrão (`canRun = () => true` na assinatura, `if (!canRun()) return` na 1.ª linha do callback) em `startAutoStart`, `startMixNotices`, `startGuestVoucherNotices`.

- [ ] **Step 4: Verificar que um tique saltado não perde nem duplica**

Para cada uma — `checkGameDayReminders`, `checkScheduledPosts`, `checkMixNotices`, `checkGuestVoucherNotices` — ler a função e confirmar que decide o que enviar pelo estado na BD (ex.: «ainda não enviado» + «já passou a hora»), e não por «estamos exatamente na janela deste tique». Anotar o resultado num comentário curto por cima do `if (!canRun()) return`, por exemplo:

```js
    // Saltar um tique é seguro: o lembrete fica por enviar na BD e sai no seguinte.
```

Se alguma usar uma janela estreita que um salto de horas calmas faria perder (ex.: lembrete «3 h antes» de um mix às 08:00 cairia às 05:00), deixá-la com `canRun: isActive` (só o lease, sem horas calmas) no `index.js` e dizê-lo no comentário. Nos `voucherNotices.test.js` acrescentar:

```js
test('calado: startGuestVoucherNotices não consulta a BD', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  calls.length = 0
  startGuestVoucherNotices({ sendText: async () => 'id', canRun: () => false })
  t.mock.timers.tick(10 * 60 * 1000)
  assert.equal(calls.length, 0)
})
```

(usar os imports `calls`/fake que o ficheiro já usa).

- [ ] **Step 5: Texto do anúncio em `locales.js`**

No dicionário pt (antigo) e no en (antigo), junto das outras mensagens:

```js
  bot_number_changed: '🤖 O robô passou a responder por este número. Continua tudo igual: *In*, *Out* e *mix*.',
```

```js
  bot_number_changed: '🤖 The bot now answers from this number. Everything works the same: *In*, *Out* and *mix*.',
```

- [ ] **Step 6: Bateria completa**

Run: `cd whatsapp-bot && npm test`
Expected: tudo PASS menos o já conhecido «In faz no máximo 4 idas à BD».

- [ ] **Step 7: Commit**

```bash
git add whatsapp-bot/src/sync.js whatsapp-bot/src/reminders.js whatsapp-bot/src/autostart.js whatsapp-bot/src/mixNotices.js whatsapp-bot/src/voucherNotices.js whatsapp-bot/src/locales.js whatsapp-bot/test/sync.test.js whatsapp-bot/test/voucherNotices.test.js
git commit -m "Robô: tarefas agendadas só no processo ativo; lembretes respeitam horas calmas e tetos"
```

---

### Task 6: A app mostra o número ativo

**Files:**
- Modify: `src/lib/contacts.js`, `src/lib/contacts.test.js`, `src/pages/Landing.jsx:319`, `src/pages/Plans.jsx:43`

**Interfaces:**
- Produces: `useBotNumber() → string` (hook React; começa no número fixo e troca para o do RPC quando chega); `whatsappContactLink(text, number = WHATSAPP_NUMBER)`.

- [ ] **Step 1: Teste**

Em `src/lib/contacts.test.js` acrescentar:

```js
it('whatsappContactLink aceita outro número', () => {
  expect(whatsappContactLink('Olá', '351900000002')).toBe('https://wa.me/351900000002?text=Ol%C3%A1')
})
```

Run: `npx vitest run src/lib/contacts.test.js` → FAIL.

- [ ] **Step 2: `contacts.js`**

```js
export const whatsappContactLink = (text, number = WHATSAPP_NUMBER) =>
  `https://wa.me/${number}${text ? `?text=${encodeURIComponent(text)}` : ''}`
```

E, no mesmo ficheiro, o hook (o pool vem de `VITE_BOT_LEASE_POOL`, por defeito `'prod'`; em dev pôr `dev` no `.env`):

```js
import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// Robô de reserva (spec 2026-10-06): o número que está a responder agora.
// Começa no fixo; se o RPC falhar ou ainda não houver lease, fica o fixo.
let cachedBotNumber = null
export function useBotNumber() {
  const [number, setNumber] = useState(cachedBotNumber || WHATSAPP_NUMBER)
  useEffect(() => {
    if (cachedBotNumber) return undefined
    let alive = true
    supabase.rpc('get_active_bot_number', { p_pool: import.meta.env.VITE_BOT_LEASE_POOL || 'prod' })
      .then(({ data }) => { if (alive && data) { cachedBotNumber = data; setNumber(data) } })
      .catch(() => {})
    return () => { alive = false }
  }, [])
  return number
}
```

(Confirmar o caminho do cliente Supabase usado pelos outros ficheiros de `src/lib` — `./supabase` ou `../lib/supabase` — e usar o mesmo.)

- [ ] **Step 3: `Landing.jsx` e `Plans.jsx`**

Em cada um: importar `useBotNumber`, `const botNumber = useBotNumber()` no componente, e `whatsappContactLink(t('plans.whatsapp_text'), botNumber)`.

- [ ] **Step 4: Testes e build**

Run: `npx vitest run src/lib && npm run build`
Expected: PASS e build OK.

- [ ] **Step 5: Commit**

```bash
git add src/lib/contacts.js src/lib/contacts.test.js src/pages/Landing.jsx src/pages/Plans.jsx
git commit -m "App: o contacto do robô usa o número que está ativo"
```

---

### Task 7: Operação — README e ensaio em dev

**Files:**
- Modify: `whatsapp-bot/README.md`

- [ ] **Step 1: Secção nova no README — «Número de reserva»**

Conteúdo (em pt, curto):

```markdown
## Número de reserva (desde 6 out 2026)

Correm dois robôs no mesmo EC2, em dois contentores, cada um com o seu
número e a sua pasta de sessão. Só um
fala de cada vez (tabela `bot_lease`). Se o ativo for banido (403) ou cair,
o outro assume em ≤ 20 s e diz uma vez em cada grupo que o robô mudou de
número.

Variáveis: `BOT_INSTANCE` (`principal` | `reserva`), `LEASE_POOL` (`prod` |
`dev`), `BOT_NUMBER_SINCE` (YYYY-MM-DD), `BOT_DAILY_CAP`,
`SLACK_ALERT_WEBHOOK_URL`, e a `AUTH_DIR` própria de cada um.

Pré-requisitos: `supabase/migration_bot_lease.sql` corrida; o número de
reserva já está em TODOS os grupos da tabela `whatsapp_groups`.

Ver quem está ativo:
    SELECT holder, phone, expires_at FROM bot_lease;

Voltar ao principal à mão (com os dois ligados):
    UPDATE bot_lease SET expires_at = now() - interval '1 second' WHERE pool = 'prod';
    -- e parar a reserva uns segundos (docker stop), para o principal reclamar primeiro.
```

- [ ] **Step 2: Ensaio em dev**

Correr `migration_bot_lease.sql` no Supabase de dev. Dois números de teste num grupo de QA registado em `whatsapp_groups` (dev). Dois processos locais (`BOT_INSTANCE=principal AUTH_DIR=./auth-a` e `BOT_INSTANCE=reserva AUTH_DIR=./auth-b`, ambos `LEASE_POOL=dev`). Verificar, por esta ordem:

1. «In» no grupo → só um número responde/reposta.
2. `docker stop`/Ctrl+C no ativo → em ≤ 90 s o outro diz «🤖 O robô passou a responder por este número…» e responde ao «In» seguinte.
3. Voltar a ligar o primeiro → continua calado.
4. Código de confirmação enviado em privado ao número calado → confirma na app.

- [ ] **Step 3: Commit**

```bash
git add whatsapp-bot/README.md
git commit -m "README do robô: número de reserva, variáveis e como voltar ao principal"
```

---

### Task 8: Menos links repetidos nos cartões (precisa de decisão da equipa)

**Files:**
- Modify: `whatsapp-bot/src/roster.js:384-386`
- Test: `whatsapp-bot/test/roster.test.js`

Hoje cada cartão do formato antigo leva dois links: `🔗 alinho.pt/jogo/<id>` e
`📆 Adicionar ao calendário: <supabase>.supabase.co/functions/v1/game-ics?id=…`.
O mesmo par de domínios repete-se em todos os cartões de todos os grupos,
que é um dos sinais de spam da pesquisa. O formato novo (`buildMixMessageNew`)
já não tem o calendário.

**Decisão a pedir ao Francisco/Renato antes de implementar:** (a) tirar o link
do calendário do formato antigo (fica só o do jogo); ou (b) manter os dois.
Se for (a):

- [ ] **Step 1: Teste** em `roster.test.js`:

```js
test('formato antigo: só o link do jogo, sem o do calendário', () => {
  const text = buildMixMessage(state(four))
  assert.match(text, /🔗 /)
  assert.doesNotMatch(text, /Adicionar ao calendário|game-ics/)
})
```

(usar os helpers `state`/`person` que o ficheiro já usa; se não existirem lá, copiar os de `newMessages.test.js`.)

Atualizar também o teste de `newMessages.test.js` que faz `assert.match(buildMixMessage(state(four)), /📆 Adicionar ao calendário/)` — passa a `doesNotMatch`.

- [ ] **Step 2:** apagar a linha 386 (`📆 Adicionar ao calendário…`) e o `if` à volta, se ficar vazio.
- [ ] **Step 3:** `cd whatsapp-bot && npm test` → PASS (menos o já conhecido).
- [ ] **Step 4: Commit** — `git commit -m "Robô: cartões sem o link do calendário (menos links repetidos)"`

---

## Depois do código (equipa, fora do repo)

1. SIM português físico para a reserva; WhatsApp num telemóvel real, nome «Alinho 🤖» e foto; uso normal 7–10 dias.
2. Admins adicionam o número de reserva a cada grupo, com uma linha a explicar.
3. No EC2, 2.º contentor para a reserva (mesma imagem, outra pasta de sessão):
   `docker run -d --name alinho-wa-bot-reserva --restart unless-stopped --env-file .env -e BOT_INSTANCE=reserva -e AUTH_DIR=/app/baileys-auth -e PORT=8081 -v $(pwd)/baileys-auth-reserva:/app/baileys-auth alinho-wa-bot`
   e emparelhar o número de reserva pelo QR (`docker logs -f alinho-wa-bot-reserva`).
   O contentor principal passa a ter `-e BOT_INSTANCE=principal`.
4. Correr `migration_bot_lease.sql` em produção; depois deploy dos dois robôs.
5. Webhook do Slack para os alertas (#dev-updates ou canal próprio).
6. Pedir revisão do 351931386496 na app; se voltar, aquece e fica como próxima reserva.
