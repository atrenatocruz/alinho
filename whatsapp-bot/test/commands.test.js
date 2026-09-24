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
beforeEach(async () => {
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
  const { _clearOpenMixesCacheForTests } = await import('../src/roster.js')
  _clearOpenMixesCacheForTests()
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
  // Outro remetente: a pergunta de suplente do teste anterior fica pendente
  // (em memória, por remetente+grupo) para o Bernardo.
  const out = await say('in com bernardo', '351922222222')
  assert.match(out, /não há vagas para uma dupla|não cabe uma dupla/)
})

const sync = await import('../src/sync.js')

test('«In» faz no máximo 4 idas à BD', async () => {
  await say('in')
  assert.ok(calls.length <= 4, `foram ${calls.length}: ${calls.join(', ')}`)
})

test('«In» e «Out» pedem o repost logo', async (t) => {
  // Um namespace ESM não se pode simular; por isso o commands.js chama
  // através do objeto `repostHooks`, que se pode.
  const asked = []
  t.mock.method(sync.repostHooks, 'requestRepostForGame', (org, gameId, opts = {}) => asked.push([gameId, opts.promotedNames ?? []]))
  await say('in')
  assert.deepEqual(asked, [['m', []]])
  asked.length = 0
  await say('out')
  assert.deepEqual(asked, [['m', []]])
})

test('«Out» com suplentes: o repost já leva quem subiu (sem esperar pelo Realtime)', async (t) => {
  const asked = []
  t.mock.method(sync.repostHooks, 'requestRepostForGame', (org, gameId, opts = {}) => asked.push([gameId, opts.promotedNames ?? []]))
  db.profiles.push({ id: 's', name: 'Sofia Suplente', phone_hash: 'x', language: 'pt' })
  db.participants.push(
    { id: 'pa', game_id: 'm', user_id: 'a', status: 'confirmed', created_at: '2026-09-01T10:00:00Z' },
    { id: 'ps', game_id: 'm', user_id: 's', status: 'waitlisted', created_at: '2026-09-01T11:00:00Z' },
  )
  // O trigger promote_waitlist: ao sair alguém, o 1.º suplente passa a confirmado.
  db.afterDelete = (table) => {
    if (table !== 'participants') return
    const w = db.participants.find((p) => p.status === 'waitlisted')
    if (w) w.status = 'confirmed'
  }
  await say('out')
  assert.equal(asked.length, 1)
  assert.equal(asked[0][0], 'm')
  assert.deepEqual(asked[0][1].map((p) => [p.gameId, p.name]), [['m', 'Sofia Suplente']])
})
