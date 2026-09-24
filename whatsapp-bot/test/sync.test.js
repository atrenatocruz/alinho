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
