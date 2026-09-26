import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.SUPABASE_URL = 'http://localhost:1'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'x'
process.env.PHONE_HASH_SECRET = 'x'

const { dueOrgs, postKey } = await import('../src/postSchedule.js')
const { supabase } = await import('../src/supabase.js')
const { installFakeSupabase } = await import('./fakeSupabase.js')
const { publishOrgCards, loadPostHours } = await import('../src/reminders.js')
const { _clearOpenMixesCacheForTests, gameIdForMessage } = await import('../src/roster.js')
const { _resetGroupStateForTests } = await import('../src/sync.js')

// ── Que clubes publicam agora (#553) ──────────────────────────────────────
const hoursByOrg = new Map([['a2n', [10, 14, 19]], ['smash', [10]], ['off', []]])

test('publica os clubes com esta hora, só nos primeiros 15 min', () => {
  assert.deepEqual(dueOrgs({ hoursByOrg, hour: 10, minute: 3, dayKey: '2026-09-27', sent: new Set() }), ['a2n', 'smash'])
  assert.deepEqual(dueOrgs({ hoursByOrg, hour: 14, minute: 0, dayKey: '2026-09-27', sent: new Set() }), ['a2n'])
  assert.deepEqual(dueOrgs({ hoursByOrg, hour: 14, minute: 20, dayKey: '2026-09-27', sent: new Set() }), [])
  assert.deepEqual(dueOrgs({ hoursByOrg, hour: 11, minute: 0, dayKey: '2026-09-27', sent: new Set() }), [])
})

test('não repete a mesma hora no mesmo dia', () => {
  const sent = new Set([postKey('a2n', '2026-09-27', 10)])
  assert.deepEqual(dueOrgs({ hoursByOrg, hour: 10, minute: 5, dayKey: '2026-09-27', sent }), ['smash'])
  assert.deepEqual(dueOrgs({ hoursByOrg, hour: 10, minute: 5, dayKey: '2026-09-28', sent }), ['a2n', 'smash'])
})

// ── Publicar os cartões ───────────────────────────────────────────────────
function setup() {
  const db = {
    whatsapp_groups: [{ organization_id: 'o', group_jid: 'g@g.us', label: 'x', levels: null }],
    organizations: [{ id: 'o', whatsapp_post_hours: [10, 19] }],
    profiles: [], memberships: [],
    participants: [{ id: 'p1', game_id: 'cheio', user_id: 'u1', partner_id: 'u2', status: 'confirmed', created_at: '1' },
      { id: 'p2', game_id: 'cheio', user_id: 'u3', partner_id: 'u4', status: 'confirmed', created_at: '2' }],
    games: [
      { id: 'vagas', organization_id: 'o', title: 'Mix com vagas', status: 'open', origin: 'manual',
        date: new Date(Date.now() + 864e5).toISOString(), num_courts: 1, max_players: 4, rotate_partners: false },
      { id: 'cheio', organization_id: 'o', title: 'Mix cheio', status: 'closed', origin: 'manual',
        date: new Date(Date.now() + 2 * 864e5).toISOString(), num_courts: 1, max_players: 4, rotate_partners: false },
    ],
  }
  installFakeSupabase(supabase, db)
  _clearOpenMixesCacheForTests()
  _resetGroupStateForTests()
  return db
}

test('publica o cartão completo de cada mix com vagas, com @all na 1.ª mensagem; responder «In» funciona', async () => {
  setup()
  const sent = []
  await publishOrgCards('o', {
    sendText: async (_g, text, opts = {}) => { sent.push({ text, opts }); return `id-${sent.length}` },
    getGroupMentions: async () => ['111@s.whatsapp.net', '222@s.whatsapp.net'],
  })
  assert.equal(sent.length, 1, 'o mix cheio não sai')
  assert.match(sent[0].text, /^📢 @all/)
  assert.match(sent[0].text, /Mix com vagas/)
  assert.match(sent[0].text, /\(vaga livre\)/)
  assert.deepEqual(sent[0].opts.mentions, ['111@s.whatsapp.net', '222@s.whatsapp.net'])
  assert.equal(gameIdForMessage('id-1'), 'vagas')
})

test('sem a migração (coluna em falta) fica a hora de sempre para todos', async () => {
  const db = setup()
  db.organizations = [{ id: 'o' }]
  const map = await loadPostHours(['o'])
  assert.deepEqual(map.get('o'), [10])
})
