import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'

process.env.SUPABASE_URL = 'http://localhost:1'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'x'
process.env.PHONE_HASH_SECRET = 'segredo'
process.env.APP_URL = 'https://alinho.pt'

const { supabase } = await import('../src/supabase.js')
const { installFakeSupabase } = await import('./fakeSupabase.js')
const { handleGroupMessage } = await import('../src/commands.js')
const { parseCopiedRoster, cleanRosterName, extraNames, isSenderName } = await import('../src/copiedRoster.js')
const { _clearOpenMixesCacheForTests } = await import('../src/roster.js')

// A lista como o robô a publica (roster.js), com uma linha acrescentada à mão.
const copiedList = (extraLines) => [
  '🎾 *Mix M5 de segunda*',
  '📅 segunda-feira, 28 de setembro · 20:00',
  '🏟️ 2 campo(s) · 8 vagas',
  '🔒 0/2 campos fechados · Faltam 2 para fechar o próximo campo',
  '',
  '1. 🎾 Bernardo Ramos (M5)',
  '2. 🎾 Afonso Dias (M5) (1)',
  ...extraLines,
  '',
  '_(1), (2)… = inscritos em dupla_',
  '🙋 Escreve *In* ou *Alinho* para entrares, *Out* ou *Fora* para saíres',
  '🔗 https://alinho.pt/jogo/m',
].join('\n')

test('lê a cópia da lista: nomes sem banda, dupla nem vagas livres', () => {
  const parsed = parseCopiedRoster(copiedList(['3. 🎾 Martim Baptista (M5)', '4. 🎾 (vaga livre)']))
  assert.deepEqual(parsed.names, ['Bernardo Ramos', 'Afonso Dias', 'Martim Baptista'])
  // O link do cartão diz qual é o mix (ids da base de dados são uuid).
  assert.equal(parseCopiedRoster(copiedList([]).replace('/jogo/m', '/jogo/0b8f3c1e-1111-4222-8333-944455556666')).gameId, '0b8f3c1e-1111-4222-8333-944455556666')
  // O link curto (9 out): só o começo do id.
  assert.equal(parseCopiedRoster(copiedList([]).replace('/jogo/m', '/m/0B8F3C1E')).gameId, '0b8f3c1e')
  assert.equal(parsed.title, 'Mix M5 de segunda')
  assert.equal(cleanRosterName('Paulo Henriques (N6) (convidado) (2)'), 'Paulo Henriques')
})

test('conversa normal ou uma só linha numerada não é uma lista', () => {
  assert.equal(parseCopiedRoster('1. 🎾 Martim\nvamos jogar?'), null)
  assert.equal(parseCopiedRoster('Escreve In ou Alinho, pessoal'), null)
})

test('nomes a mais e nomes parecidos', () => {
  assert.deepEqual(extraNames(['Ana', 'Rui Costa'], ['ana', 'Beatriz']), ['Rui Costa'])
  assert.ok(isSenderName('Martim Baptista', ['Martim Baptista Silva', null]))
  assert.ok(isSenderName('Martim Baptista', [null, 'Martim']))
  assert.ok(!isSenderName('Joana Lopes', ['Martim Baptista', 'Martim']))
})

const hash = (d) => crypto.createHmac('sha256', 'segredo').update(d.slice(-9)).digest('hex')
let db
beforeEach(() => {
  db = {
    whatsapp_groups: [{ organization_id: 'o', group_jid: 'g@g.us', label: 'x', levels: null }],
    profiles: [
      { id: 'a', name: 'Bernardo Ramos', phone_hash: hash('911111111'), language: 'pt' },
      { id: 'b', name: 'Afonso Dias', phone_hash: hash('922222222'), language: 'pt' },
      { id: 'c', name: 'Martim Baptista', phone_hash: hash('933333333'), language: 'pt' },
      { id: 'd', name: 'Joana Lopes', phone_hash: hash('944444444'), language: 'pt' },
    ],
    memberships: ['a', 'b', 'c', 'd'].map((id) => ({ user_id: id, organization_id: 'o' })),
    participants: [
      { id: 'p1', game_id: 'm', user_id: 'a', partner_id: null, status: 'confirmed', created_at: '2026-09-27T10:00:00Z' },
      { id: 'p2', game_id: 'm', user_id: 'b', partner_id: null, status: 'confirmed', created_at: '2026-09-27T10:01:00Z' },
    ],
    partner_invites: [],
    games: [{ id: 'm', organization_id: 'o', title: 'Mix M5 de segunda', status: 'open', origin: 'manual',
      date: new Date(Date.now() + 864e5).toISOString(), num_courts: 2, max_players: 8,
      rotate_partners: false, allow_pair_signup: true }],
  }
  installFakeSupabase(supabase, db)
  _clearOpenMixesCacheForTests()
})

async function post(text, pn, pushName = null) {
  const sent = []
  await handleGroupMessage(
    { groupJid: 'g@g.us', senderPn: `${pn}@s.whatsapp.net`, text, message: { pushName }, quotedStanzaId: null, mentionedJids: [], mentionedPns: [] },
    { sendText: async (_g, t) => { sent.push(t) } },
  )
  return sent.join('\n')
}
const enrolled = () => db.participants.filter((p) => p.game_id === 'm').map((p) => p.user_id)

test('o Martim cola a lista com o nome dele → fica inscrito', async () => {
  const out = await post(copiedList(['3. 🎾 Martim Baptista (M5)']), '351933333333')
  assert.deepEqual(enrolled(), ['a', 'b', 'c'])
  assert.match(out, /✅ Inscrevi-te, Martim Baptista\. Para a próxima basta escrever In\./)
})

test('alguém cola a lista com o nome de outra pessoa do clube → inscreve essa pessoa', async () => {
  const out = await post(copiedList(['3. 🎾 Joana Lopes']), '351911111111')
  assert.deepEqual(enrolled(), ['a', 'b', 'd'])
  assert.match(out, /✅ Inscrevi Joana Lopes\. Para o tirar, pede ao admin\./)
})

test('nome de quem não está no clube → convidado sem conta (game_guests)', async () => {
  const out = await post(copiedList(['3. 🎾 Paulo Henriques']), '351911111111')
  assert.match(out, /✅ Inscrevi Paulo Henriques como convidado\./)
  const guest = db.game_guests.find((g) => g.name === 'Paulo Henriques')
  assert.ok(guest, 'linha em game_guests')
  assert.ok(!db.profiles.some((p) => p.name === 'Paulo Henriques'), 'não se cria conta nenhuma')
  assert.deepEqual(enrolled(), ['a', 'b', undefined])
  assert.ok(db.participants.some((p) => p.guest_id === guest.id && p.status === 'confirmed'))
})

test('dois nomes a mais → inscreve os dois pela mesma regra', async () => {
  await post(copiedList(['3. 🎾 Martim Baptista (M5)', '4. 🎾 Joana Lopes']), '351933333333')
  assert.deepEqual(enrolled(), ['a', 'b', 'c', 'd'])
})

test('a lista sem nomes a mais → o robô não diz nada', async () => {
  const out = await post(copiedList([]), '351933333333')
  assert.equal(out, '')
  assert.deepEqual(enrolled(), ['a', 'b'])
})
