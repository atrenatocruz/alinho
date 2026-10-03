import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.SUPABASE_URL = 'http://localhost:1'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'x'
process.env.PHONE_HASH_SECRET = 'x'

const { dueMixes, postKey, slotFor, mixPostTimes } = await import('../src/postSchedule.js')
const { supabase } = await import('../src/supabase.js')
const { installFakeSupabase } = await import('./fakeSupabase.js')
const { publishOrgCards, loadPostHours, checkScheduledPosts, _clearSentPostsForTests } = await import('../src/reminders.js')
const { _clearOpenMixesCacheForTests, gameIdForMessage } = await import('../src/roster.js')
const { _resetGroupStateForTests } = await import('../src/sync.js')

// ── Que mixes saem agora (horas por evento, 27 set) ───────────────────────
test('a janela: 15 min depois da hora certa e da meia hora', () => {
  assert.equal(slotFor(10, 3), '10:00')
  assert.equal(slotFor(18, 31), '18:30')
  assert.equal(slotFor(10, 20), null)
  assert.equal(slotFor(10, 50), null)
})

test('cada mix às suas horas; sem horas escolhidas, as do clube; [] = nunca', () => {
  const mixes = [
    { id: 'proprias', whatsapp_post_times: ['09:30:00', '18:30:00'] },
    { id: 'clube', whatsapp_post_times: null },
    { id: 'sem', whatsapp_post_times: [] },
  ]
  assert.deepEqual(mixPostTimes(mixes[0], [10]), ['09:30', '18:30'])
  const at = (slot) => dueMixes({ mixes, orgHours: [10, 18], slot, dayKey: '2026-09-27', sent: new Set() }).map((m) => m.id)
  assert.deepEqual(at('18:30'), ['proprias'])
  assert.deepEqual(at('10:00'), ['clube'])
  assert.deepEqual(at('18:00'), ['clube'])
  assert.deepEqual(at('12:00'), [])
})

test('não repete a mesma meia hora no mesmo dia', () => {
  const mixes = [{ id: 'm', whatsapp_post_times: ['10:00'] }]
  const sent = new Set([postKey('m', '2026-09-27', '10:00')])
  assert.deepEqual(dueMixes({ mixes, orgHours: [], slot: '10:00', dayKey: '2026-09-27', sent }), [])
  assert.equal(dueMixes({ mixes, orgHours: [], slot: '10:00', dayKey: '2026-09-28', sent }).length, 1)
})

// ── Publicar os cartões ───────────────────────────────────────────────────
function setup() {
  const db = {
    whatsapp_groups: [{ organization_id: 'o', group_jid: 'g@g.us', label: 'x', levels: null }],
    organizations: [{ id: 'o', whatsapp_post_hours: [10, 19] }],
    profiles: [], memberships: [],
    // Os outros eventos (torneios, turmas) — sem nenhum aqui.
    tournaments: [], tournament_categories: [], tournament_entries: [], lesson_series: [], lesson_enrolments: [], teacher_profiles: [], feature_flags: [],
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
  assert.match(sent[0].text, /3\. —/)
  assert.deepEqual(sent[0].opts.mentions, ['111@s.whatsapp.net', '222@s.whatsapp.net'])
  assert.equal(gameIdForMessage('id-1'), 'vagas')
})

test('sem a migração (coluna em falta) fica a hora de sempre para todos', async () => {
  const db = setup()
  db.organizations = [{ id: 'o' }]
  const map = await loadPostHours(['o'])
  assert.deepEqual(map.get('o'), [10])
})


test('às 18:30 só sai o mix que tem essa hora — o outro fica com as do clube', async () => {
  const db = setup()
  db.games[1] = { ...db.games[1], status: 'open', id: 'outro', title: 'Outro mix', whatsapp_post_times: null }
  db.games[0] = { ...db.games[0], whatsapp_post_times: ['18:30:00'] }
  db.participants = []
  _clearSentPostsForTests()
  const sent = []
  const deps = { sendText: async (_g, text) => { sent.push(text); return `id-${sent.length}` }, getGroupMentions: async () => [] }
  await checkScheduledPosts(deps, { hour: 18, minute: 31, dayKey: '2026-09-27' })
  assert.equal(sent.length, 1)
  assert.match(sent[0], /Mix com vagas/)
  await checkScheduledPosts(deps, { hour: 18, minute: 35, dayKey: '2026-09-27' })
  assert.equal(sent.length, 1, 'não repete na mesma meia hora')
  await checkScheduledPosts(deps, { hour: 19, minute: 2, dayKey: '2026-09-27' })
  assert.equal(sent.length, 2, 'às 19:00 sai o outro, com as horas do clube')
  assert.match(sent[1], /Outro mix/)
})
