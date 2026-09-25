import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createParticipatingGroups } from '../src/participatingGroups.js'

const groups = { 'g1@g.us': { id: 'g1@g.us', subject: 'M3' }, 'g2@g.us': { id: 'g2@g.us', subject: 'M4' } }

test('com a ligação fechada não pede nada (era o «Connection Closed» no arranque)', async () => {
  let calls = 0
  const pg = createParticipatingGroups()
  const jids = await pg.get(async () => { calls++; return groups })
  assert.equal(jids, null)
  assert.equal(calls, 0)
})

test('pedidos ao mesmo tempo dão UM pedido ao WhatsApp (era o «rate-overlimit»)', async () => {
  let calls = 0
  const pg = createParticipatingGroups()
  pg.setOpen(true)
  const fetch = async () => { calls++; await new Promise((r) => setTimeout(r, 20)); return groups }
  const [listed, a, b] = await Promise.all([pg.refresh(fetch), pg.get(fetch), pg.get(fetch)])
  assert.equal(calls, 1)
  assert.deepEqual(Object.keys(listed), ['g1@g.us', 'g2@g.us'])
  assert.deepEqual([...a], ['g1@g.us', 'g2@g.us'])
  assert.deepEqual([...b], ['g1@g.us', 'g2@g.us'])
})

test('dentro do prazo usa a lista guardada', async () => {
  let calls = 0
  let t = 0
  const pg = createParticipatingGroups({ ttlMs: 1000, now: () => t })
  pg.setOpen(true)
  const fetch = async () => { calls++; return groups }
  await pg.get(fetch)
  t = 500
  await pg.get(fetch)
  assert.equal(calls, 1)
  t = 1500
  await pg.get(fetch)
  assert.equal(calls, 2)
})

test('depois de uma recusa do WhatsApp espera antes de voltar a pedir, e fica com a lista antiga', async () => {
  let calls = 0
  let t = 0
  let fail = false
  const pg = createParticipatingGroups({ ttlMs: 100, retryMs: 60_000, now: () => t })
  pg.setOpen(true)
  const fetch = async () => { calls++; if (fail) throw new Error('rate-overlimit'); return groups }
  await pg.get(fetch)                       // 1 — ok
  fail = true
  t = 200
  const stale = await pg.get(fetch)         // 2 — falha, fica com a antiga
  assert.deepEqual([...stale], ['g1@g.us', 'g2@g.us'])
  t = 30_000
  await pg.get(fetch)                       // não pede (à espera)
  assert.equal(calls, 2)
  fail = false
  t = 61_000
  await pg.get(fetch)                       // 3 — volta a pedir
  assert.equal(calls, 3)
})
