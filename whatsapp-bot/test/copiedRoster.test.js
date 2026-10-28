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
const { parseCopiedRoster, parseReplyNames, cleanRosterName, extraNames, isSenderName } = await import('../src/copiedRoster.js')
const { _clearOpenMixesCacheForTests, recordMixMessage } = await import('../src/roster.js')

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

// ── Resposta ao cartão só com nomes (Renato, 28 out) ───────────────────────
async function replyToCard(text, pn, { stanzaId = 'card-1', quotedText = null } = {}) {
  const sent = []
  await handleGroupMessage(
    { groupJid: 'g@g.us', senderPn: `${pn}@s.whatsapp.net`, text, message: { pushName: null }, quotedStanzaId: stanzaId, quotedText, mentionedJids: [], mentionedPns: [] },
    { sendText: async (_g, t) => { sent.push(t) } },
  )
  return sent.join('\n')
}

test('lê nomes de uma resposta; conversa não', () => {
  assert.deepEqual(parseReplyNames('Bruno Ribeiro e Nuno Miguel'), ['Bruno Ribeiro', 'Nuno Miguel'])
  assert.deepEqual(parseReplyNames('Joana Lopes, Paulo da Silva'), ['Joana Lopes', 'Paulo da Silva'])
  assert.deepEqual(parseReplyNames('Bruno e Nuno'), ['Bruno', 'Nuno'])
  for (const chat of ['boa sorte', 'Boa Sorte', 'Fixe', 'Quem falta?', 'bruno ribeiro', 'In', 'Bom jogo a todos amanhã pessoal']) {
    assert.equal(parseReplyNames(chat), null, chat)
  }
})

test('responder ao cartão com dois nomes → inscreve os dois nesse mix', async () => {
  recordMixMessage('card-1', 'm')
  const out = await replyToCard('Joana Lopes e Paulo Henriques', '351911111111')
  assert.match(out, /Inscrevi Joana Lopes\./)
  assert.match(out, /Inscrevi Paulo Henriques como convidado\./)
  assert.deepEqual(enrolled(), ['a', 'b', 'd', undefined])
})

test('depois de um restart (mapa vazio) o link do cartão citado diz qual é o mix', async () => {
  const id = '0b8f3c1e-1111-4222-8333-944455556666'
  db.games[0].id = id
  db.participants.forEach((p) => { p.game_id = id })
  const out = await replyToCard('Joana Lopes', '351911111111', { stanzaId: 'desconhecido', quotedText: copiedList([]).replace('/jogo/m', '/m/0b8f3c1e') })
  assert.match(out, /Inscrevi Joana Lopes\./)
  assert.deepEqual(db.participants.filter((p) => p.game_id === id).map((p) => p.user_id), ['a', 'b', 'd'])
})

test('conversa em resposta ao cartão não inscreve ninguém', async () => {
  recordMixMessage('card-1', 'm')
  const out = await replyToCard('boa sorte malta', '351911111111')
  assert.equal(out, '')
  assert.deepEqual(enrolled(), ['a', 'b'])
})

test('nomes sem responder a um cartão → nada', async () => {
  const out = await replyToCard('Joana Lopes', '351911111111', { stanzaId: null })
  assert.equal(out, '')
  assert.deepEqual(enrolled(), ['a', 'b'])
})

// ── «In» no fim, e «In» com nomes de outros (A2N, 28 out) ───────────────────
test('«Bruno Ribeiro e Nuno Miguel in» a responder ao cartão → inscreve os dois', async () => {
  recordMixMessage('card-1', 'm')
  const out = await replyToCard('Joana Lopes e Paulo Henriques in', '351911111111')
  assert.match(out, /Inscrevi Joana Lopes\./)
  assert.match(out, /Inscrevi Paulo Henriques como convidado\./)
  assert.deepEqual(enrolled(), ['a', 'b', 'd', undefined])
})

test('«In» no fim sem citar nada, com maiúsculas, e um só mix aberto → inscreve-os', async () => {
  await post('Joana Lopes e Paulo Henriques in', '351911111111')
  assert.deepEqual(enrolled(), ['a', 'b', 'd', undefined])
})

test('«In Joana Lopes e Paulo Henriques» (nenhum é quem escreve) → os dois, não quem escreveu', async () => {
  recordMixMessage('card-1', 'm')
  await replyToCard('In Joana Lopes e Paulo Henriques', '351933333333')
  assert.deepEqual(enrolled(), ['a', 'b', 'd', undefined])
})

test('conversa a acabar em «in» sem nomes → nada', async () => {
  const out = await post('vou fazer o check in', '351911111111')
  assert.equal(out, '')
  assert.deepEqual(enrolled(), ['a', 'b'])
})

test('o próprio nome com «in» no fim → entra ele', async () => {
  await post('Martim Baptista in', '351933333333')
  assert.deepEqual(enrolled(), ['a', 'b', 'c'])
})
