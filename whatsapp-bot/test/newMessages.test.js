// Mensagens novas do robô (design-handoff/2026-10-01-mensagens-whatsapp):
// só nos clubes com organizations.whatsapp_new_messages ligado.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'

process.env.SUPABASE_URL = 'http://localhost:1'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'x'
process.env.PHONE_HASH_SECRET = 'segredo'
process.env.APP_URL = 'https://alinho.pt'

const { supabase } = await import('../src/supabase.js')
const { installFakeSupabase } = await import('./fakeSupabase.js')
const { handleGroupMessage, buildHelp, _clearPairRequestsForTests } = await import('../src/commands.js')
const { buildMixMessage, shortPlace, shortPrice, _clearOpenMixesCacheForTests } = await import('../src/roster.js')
const { buildOpenSlotsMessage } = await import('../src/openSlots.js')
const { buildTournamentMessage, buildLessonSeriesMessage } = await import('../src/eventPosts.js')
const { getGroupByJid, _clearGroupsCacheForTests } = await import('../src/groups.js')
const { t } = await import('../src/locales.js')

const hash = (d) => crypto.createHmac('sha256', 'segredo').update(d.slice(-9)).digest('hex')
// Terça, 6 out 2027, 22h30 em Lisboa (21h30 UTC).
const TUESDAY = '2027-10-05T21:30:00Z'

let db
function freshDb(newMessages) {
  db = {
    whatsapp_groups: [{ organization_id: 'o', group_jid: 'g@g.us', label: 'x', levels: null }],
    organizations: [{ id: 'o', whatsapp_new_messages: newMessages }],
    profiles: [
      { id: 'a', name: 'Bernardo Ramos', phone_hash: hash('911111111'), language: 'pt' },
      { id: 'b', name: 'Afonso Dias', phone_hash: hash('922222222'), language: 'pt' },
    ],
    memberships: [{ user_id: 'a', organization_id: 'o' }, { user_id: 'b', organization_id: 'o' }],
    participants: [], partner_invites: [], teams: [],
    games: [{ id: 'm', organization_id: 'o', title: 'Mix M4 · Terça', status: 'open', origin: 'manual',
      date: new Date(Date.now() + 864e5).toISOString(), num_courts: 1, max_players: 4,
      rotate_partners: false, allow_pair_signup: true }],
  }
  installFakeSupabase(supabase, db)
  _clearGroupsCacheForTests()
  _clearOpenMixesCacheForTests()
  _clearPairRequestsForTests()
}
beforeEach(() => freshDb(true))

async function say(text, pn = '351911111111') {
  const sent = []
  await handleGroupMessage(
    { groupJid: 'g@g.us', senderPn: `${pn}@s.whatsapp.net`, text, message: {}, quotedStanzaId: null, mentionedJids: [], mentionedPns: [] },
    { sendText: async (_g, text) => { sent.push(text) } },
  )
  return sent.join('\n')
}

const person = (name, extra = {}) => ({ name, rating: 1300, gender: 'masculino', guest: false, ...extra })
const state = (people, game = {}) => ({
  game: { id: '3f2a', title: 'Mix M4 · Terça', status: 'open', date: TUESDAY, num_courts: 2,
    location: 'A2N Padel Academy - Av. Vieira da Silva, 53, Corroios', price_per_player: 11,
    prize: 'cerveja ou água + voucher 1h30', allow_pair_signup: true, rotate_partners: false, ...game },
  people, capacity: 8, suplentes: [],
})

test('o interruptor do clube chega ao grupo; sem ele, mensagens de sempre', async () => {
  assert.equal((await getGroupByJid('g@g.us')).newMessages, true)
  freshDb(false)
  assert.equal((await getGroupByJid('g@g.us')).newMessages, false)
  // Sem a coluna (migração por correr) ou sem a linha do clube: as de sempre.
  freshDb(true)
  db.organizations = []
  _clearGroupsCacheForTests()
  assert.equal((await getGroupByJid('g@g.us')).newMessages, false)
})

test('o cartão novo: curto, a dupla numa linha, sem níveis nem calendário, e o /help só aqui', () => {
  const people = [person('Ana Costa', { pair: 1 }), person('Rui Lopes', { pair: 1 }), person('Marta Silva'), person('João Pires'), person('Tiago Reis')]
  const card = buildMixMessage(state(people), { label: '01', fresh: true })
  assert.equal(card, [
    '🎾 *Mix M4 · Terça* (01)',
    'Ter 5 out · 22h30 · A2N Padel Academy',
    '11 € · Prémio: cerveja ou água + voucher 1h30',
    '',
    '1–2. Ana Costa e Rui Lopes',
    '3. Marta Silva',
    '4. João Pires',
    '5. Tiago Reis',
    '6. —',
    '7. —',
    '8. —',
    '',
    'Faltam 3 para fechar o próximo campo.',
    '👉 Responde a esta mensagem com *In* para entrar ou *Out* para sair (ou escreve *In 01*).',
    'Em dupla: *In com* e o nome do parceiro.',
    'Dúvidas? Escreve */help*.',
    'alinho.pt/jogo/3f2a',
  ].join('\n'))
})

test('o cartão novo sem número, sem duplas e cheio', () => {
  const four = ['A', 'B', 'C', 'D'].map((n) => person(n))
  const card = buildMixMessage({ ...state(four, { allow_pair_signup: false }), capacity: 4 }, { fresh: true })
  assert.match(card, /^🎾 \*Mix M4 · Terça\*\n/)
  assert.doesNotMatch(card, /In 0|Em dupla|M4\)|\(M/)
  assert.match(card, /✅ Mix cheio\./)
  // O cartão antigo continua igual para os outros clubes.
  assert.match(buildMixMessage(state(four)), /📆 Adicionar ao calendário/)
})

test('morada curta e preço sem cêntimos quando é redondo', () => {
  assert.equal(shortPlace('A2N Padel Academy - Av. Vieira da Silva, 53'), 'A2N Padel Academy')
  assert.equal(shortPlace('Smash Padel Almada'), 'Smash Padel Almada')
  assert.equal(shortPrice(11), '11 €')
  assert.match(shortPrice(7.5), /^7,50\s€$/)
})

test('mix cheio, suplente e já inscrito: respostas novas, sem rodapé', async () => {
  assert.equal(await say('in'), '')
  assert.equal(await say('in'), '🤖 Já estás neste mix.')
  db.games[0].max_players = 1
  _clearOpenMixesCacheForTests()
  assert.equal(await say('in', '351922222222'), '🤖 O mix está cheio. Queres ficar como suplente? Responde *Sim*.')
  assert.equal(await say('sim', '351922222222'), '🤖 Ficaste como suplente. Se alguém sair, entras logo.')
})

test('um suplente sai com Out', async () => {
  db.participants.push(
    { id: 'p1', game_id: 'm', user_id: 'a', partner_id: null, status: 'confirmed', created_at: '2026-10-01T10:00:00Z' },
    { id: 'p2', game_id: 'm', user_id: 'b', partner_id: null, status: 'waitlisted', created_at: '2026-10-01T10:01:00Z' },
  )
  assert.equal(await say('out', '351922222222'), '🤖 Saíste da lista de suplentes.')
  assert.deepEqual(db.participants.map((p) => p.user_id), ['a'])
})

test('sem o interruptor, o suplente continua a ser mandado para a app', async () => {
  freshDb(false)
  db.participants.push({ id: 'p2', game_id: 'm', user_id: 'b', partner_id: null, status: 'waitlisted', created_at: '2026-10-01T10:01:00Z' })
  assert.match(await say('out', '351922222222'), /para sair, usa a app/)
  assert.equal(db.participants.length, 1)
})

test('vários mixes abertos: a pergunta curta, com as respostas possíveis', async () => {
  db.games.push({ ...db.games[0], id: 'm2', title: 'Mix M5 · Quarta', date: new Date(Date.now() + 2 * 864e5).toISOString() })
  const out = await say('in')
  assert.match(out, /^🤖 Há 2 mixes abertos\. Em qual queres entrar\?\n01 · Mix M4 · Terça · \w{3} \d+h(\d\d)?\n02 · Mix M5 · Quarta · /)
  assert.match(out, /\n\nResponde \*In 01\* ou \*In 02\*\.$/)
})

test('o /help muda conforme os mixes abertos', async () => {
  const one = await say('/help')
  assert.match(one, /^🤖 \*Como usar o robô\*\n\*In\* — entrar no mix\n\*Out\* — sair\n\*In com\* e o nome — entrar em dupla\n\*Sim\* — aceitar/)
  assert.doesNotMatch(one, /Vários mixes/)
  assert.match(one, /Tudo explicado em alinho\.pt\/instrucoes$/)
  const solo = { allow_pair_signup: false, rotate_partners: false, origin: 'manual', id: 'x' }
  const two = buildHelp([solo, { ...solo, id: 'y' }], 'pt')
  assert.doesNotMatch(two, /In com/)
  assert.match(two, /Vários mixes abertos\?/)
})

test('jogos em aberto: uma linha por jogo, com quem já está e sem níveis', () => {
  // Sábado, 10 jul 2027 (Lisboa = UTC+1 no verão).
  const game = (h, extra = {}) => ({ date: `2027-07-10T${h - 1}:00:00Z`, max_players: 4, num_courts: 1, price_per_player: 6, level: null, ...extra })
  const text = buildOpenSlotsMessage({ games: [
    { game: game(18, { level: 'M4' }), people: [person('Ana Costa'), person('João Pires')] },
    { game: game(20), people: [] },
  ] }, { fresh: true })
  assert.equal(text, [
    '🟡 *Jogos em aberto — sábado, 10 jul*',
    '18h · M4 · faltam 2 (Ana Costa, João Pires)',
    '20h · faltam 4',
    '6 € por jogador',
    '',
    '👉 Escreve *In* e a hora: *In 18*.',
  ].join('\n'))
})

test('torneio e turma, nas mensagens novas', () => {
  const tournament = buildTournamentMessage({
    tournament: { id: 't', name: 'Smash Cup by WFit', slug: 'smash-cup-by-wfit', location: 'Smash Padel Almada',
      starts_on: '2026-10-09', ends_on: '2026-10-11', entries_deadline: '2026-10-05T22:59:00Z' },
    openCodes: ['M3', 'MX4'],
  }, { fresh: true })
  assert.equal(tournament, [
    '🏆 *Smash Cup by WFit*',
    '9 a 11 out · Smash Padel Almada',
    'Categorias com vagas: M3, MX4',
    'Inscrições até seg 5 out, 23h59',
    '',
    '👉 Inscreve-te em alinho.pt/torneio/smash-cup-by-wfit',
  ].join('\n'))
  const lesson = buildLessonSeriesMessage({
    series: { teacher_profile_id: '8c1d', lesson_type: 'quad', day_of_week: 2, start_time: '19:00:00', duration_minutes: 60, level_from: 'M5', level_to: 'M4' },
    free: 2, teacherName: 'Diogo',
  }, { fresh: true })
  assert.equal(lesson, '🎓 *Turma a 4 com Diogo*\nTerças às 19h · nível M5 a M4\n2 lugares livres\n\n👉 Pede lugar em alinho.pt/professor/8c1d/disponibilidade')
})

test('as de convidado não mudam', () => {
  for (const key of ['guest_joined', 'guest_waitlisted', 'voucher_guest_won', 'not_found']) {
    assert.equal(t(key, 'pt', { name: 'Tiago', who: 'Tiago', appUrl: 'https://alinho.pt' }, true), t(key, 'pt', { name: 'Tiago', who: 'Tiago', appUrl: 'https://alinho.pt' }))
  }
  // Inglês: o texto novo em inglês; sem ele, o de sempre.
  assert.equal(t('already_joined', 'en', {}, true), "🤖 You're already in this mix.")
})
