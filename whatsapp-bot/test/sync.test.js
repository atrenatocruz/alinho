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
