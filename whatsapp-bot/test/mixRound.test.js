// As mensagens das duplas dizem os jogos da Ronda 1, iguais aos da app (#791).
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

process.env.SUPABASE_URL = 'http://localhost:1'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'x'
process.env.PHONE_HASH_SECRET = 'x'

const { supabase } = await import('../src/supabase.js')
const { installFakeSupabase } = await import('./fakeSupabase.js')
const { seedCourts, roundRobinRound, round1Matches, gamesLines, teamNames } = await import('../src/mixRound.js')
const { autoStartMix } = await import('../src/autostart.js')
const { announceUpdatedDuplas } = await import('../src/mixNotices.js')
const { _clearGroupsCacheForTests } = await import('../src/groups.js')

// As contas verdadeiras da app, lidas do ficheiro dela: se alguém mudar a
// regra lá e não mudar aqui, estes testes falham.
const appSource = fs.readFileSync(new URL('../../src/lib/mixLogic.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const appFunction = (name) => appSource.match(new RegExp(`export function ${name}\\([\\s\\S]*?\\n}\\n`))[0]
const app = await import(`data:text/javascript,${encodeURIComponent(appFunction('seedCourts') + appFunction('roundRobinRound'))}`)

// A escolha do handleStartRound1 (GameDetails.jsx), com as funções da app.
const orderedTeamIds = (list) => [...list].sort((a, b) => (b.seed_ranking ?? 0) - (a.seed_ranking ?? 0)).map((team) => team.id)
const appRound1 = (game, ts) => ((game.format || 'sobe_desce') === 'sobe_desce'
  ? app.seedCourts(ts, game.num_courts || 1, { reverse: !!game.seed_reverse })
  : app.roundRobinRound(orderedTeamIds(ts), game.num_courts || 1, 0))

const seeds = (...values) => values.map((seed_ranking, i) => ({ id: `t${i + 1}`, seed_ranking }))

test('as contas do robô são iguais às da app, em todos os modos, campos e empates', () => {
  const games = [
    { format: 'sobe_desce' }, { format: null }, { format: 'sobe_desce', seed_reverse: true }, { format: 'todos_contra_todos' },
  ]
  for (const base of games) {
    for (let num_courts = 1; num_courts <= 4; num_courts++) {
      for (let n = 2; n <= 10; n++) {
        const game = { ...base, num_courts }
        for (const ts of [
          seeds(...Array.from({ length: n }, (_, i) => 3000 - i * 100)),
          seeds(...Array.from({ length: n }, () => 1100)),
          seeds(...Array.from({ length: n }, (_, i) => 2000 - (i % 2) * 300)),
          seeds(...Array.from({ length: n }, (_, i) => (i % 3 ? null : 1500))),
        ]) assert.deepEqual(round1Matches(game, ts), appRound1(game, ts), JSON.stringify({ game, ts }))
      }
    }
  }
  assert.deepEqual(seedCourts(seeds(4, 3, 2, 1), 2), app.seedCourts(seeds(4, 3, 2, 1), 2))
  assert.deepEqual(roundRobinRound(['a', 'b', 'c', 'd'], 2, 1), app.roundRobinRound(['a', 'b', 'c', 'd'], 2, 1))
})

const person = (id) => ({ id, name: id.toUpperCase(), whatsapp_jid: `${id}@s.whatsapp.net` })
const team = (id, a, b, seed_ranking, extra = {}) => ({ id, game_id: 'm', player1_id: a, player2_id: b, seed_ranking, created_at: '2026-11-09T18:00:00Z', ...extra })
const GAME = { id: 'm', organization_id: 'o', title: 'Mix', status: 'open', date: '2026-11-09T21:00:00Z', num_courts: 2, max_players: 8, format: 'sobe_desce', seed_reverse: false, rotate_partners: false, pairing_mode: 'por_nivel', auto_start_hours_before: 3, level: null }

let db
function freshDb({ newMessages = true, game = {}, teams = [] } = {}) {
  db = {
    whatsapp_groups: [{ organization_id: 'o', group_jid: 'g@g.us', label: 'x', levels: null }],
    organizations: [{ id: 'o', whatsapp_group_jid: null, whatsapp_new_messages: newMessages }],
    profiles: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map(person),
    games: [{ ...GAME, ...game }], participants: [], game_guests: [], teams, matches: [],
  }
  installFakeSupabase(supabase, db)
  _clearGroupsCacheForTests()
  return db.games[0]
}
const signUps = (ids) => ids.map((id) => ({ game_id: 'm', user_id: id, partner_id: null, guest_id: null, partner_guest_id: null, status: 'confirmed' }))

async function start(game) {
  const sent = []
  await autoStartMix(game, { sendText: async (_g, text, opts) => { sent.push({ text, mentions: opts.mentions }) } })
  return sent
}
const NAMES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => [`@${id}`, id.toUpperCase()])
const plain = (text) => NAMES.reduce((s, [at, name]) => s.replaceAll(at, name), text)
const fourTeams = () => [team('t1', 'g', 'h', 1000), team('t2', 'a', 'b', 4000), team('t3', 'e', 'f', 2000), team('t4', 'c', 'd', 3000)]
beforeEach(() => freshDb())

test('Sobe e desce: as duas mais fortes no campo 1, marcando toda a gente', async () => {
  const game = freshDb({ teams: fourTeams() })
  db.participants = signUps(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
  const [{ text, mentions }] = await start(game)
  assert.equal(plain(text), '🎾 *Duplas do Mix*\nRonda 1\nCampo 1: A e B contra C e D\nCampo 2: E e F contra G e H\nBom jogo!')
  assert.equal(new Set(mentions).size, 8)
  assert.equal(mentions.length, 8)
})

test('modelo antigo: os mesmos jogos, com o rodapé de sempre', async () => {
  const game = freshDb({ newMessages: false, teams: fourTeams() })
  db.participants = signUps(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
  const [{ text }] = await start(game)
  assert.ok(plain(text).includes('Ronda 1\nCampo 1: A e B contra C e D\nCampo 2: E e F contra G e H\n\nBoa sorte!'), text)
  assert.ok(text.includes('/help'))
})

test('Escalada: as mais fortes começam no último campo', async () => {
  const game = freshDb({ game: { seed_reverse: true }, teams: fourTeams() })
  db.participants = signUps(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
  const [{ text }] = await start(game)
  assert.ok(plain(text).includes('Campo 1: E e F contra G e H\nCampo 2: A e B contra C e D'), text)
})

test('Todos contra todos: a mais forte contra a mais fraca', async () => {
  const game = freshDb({ game: { format: 'todos_contra_todos' }, teams: fourTeams() })
  db.participants = signUps(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
  const [{ text }] = await start(game)
  assert.ok(plain(text).includes('Campo 1: A e B contra G e H\nCampo 2: C e D contra E e F'), text)
})

test('duplas formadas pelo robô também saem por pontos, não pela ordem de formação', async () => {
  const game = freshDb()
  // Dois inscritos já em dupla (entram primeiro na formação), mas com poucos
  // pontos: pela ordem de formação jogavam no campo 1.
  db.participants = [
    { game_id: 'm', user_id: 'g', partner_id: 'h', guest_id: null, partner_guest_id: null, status: 'confirmed' },
    ...signUps(['a', 'b', 'c', 'd', 'e', 'f']),
  ]
  const points = { a: 2000, b: 1900, c: 1800, d: 1700, e: 1600, f: 1500, g: 100, h: 100 }
  supabase.rpc = async () => ({ data: Object.entries(points).map(([user_id, rating]) => ({ user_id, rating })), error: null })
  const [{ text }] = await start(game)
  // Os sozinhos juntam-se por pontos: A e B, C e D, E e F. A dupla G e H fica no fim.
  assert.equal(plain(text), '🎾 *Duplas do Mix*\nRonda 1\nCampo 1: A e B contra C e D\nCampo 2: E e F contra G e H\nBom jogo!')
  assert.equal(db.games[0].status, 'in_progress')
  assert.equal(db.teams.length, 4)
})

test('com os mesmos pontos, desempata como o ecrã do mix: primeiro quem foi criada antes, depois o id', async () => {
  const teams = [
    team('z', 'g', 'h', 2000, { created_at: '2026-11-09T18:00:00Z' }),
    team('b', 'e', 'f', 2000),
    team('a', 'c', 'd', 2000),
    team('y', 'a', 'b', 2000, { created_at: '2026-11-09T17:00:00Z' }),
  ]
  const game = freshDb({ teams })
  db.participants = signUps(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
  const [{ text }] = await start(game)
  assert.ok(plain(text).includes('Campo 1: A e B contra C e D\nCampo 2: E e F contra G e H'), text)
})

test('mais duplas do que lugares: as que ficam de fora aparecem à parte, sem campo, e são marcadas', async () => {
  const six = [...fourTeams(), team('t5', 'i', 'j', 500)]
  const game = freshDb({ game: { max_players: 10 }, teams: six })
  db.participants = signUps(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'])
  const [{ text, mentions }] = await start(game)
  assert.ok(text.includes('\n\nDescansa: @i e @j\nBom jogo!'), text)
  assert.equal(mentions.length, 10)
})

test('um convidado sem conta aparece pelo nome, sem @', async () => {
  const teams = [...fourTeams().slice(0, 3), { ...team('t4', 'c', null, 3000), player2_guest_id: 'guest' }]
  const game = freshDb({ teams })
  db.game_guests = [{ id: 'guest', game_id: 'm', name: 'Convidado', whatsapp_jid: null }]
  db.participants = signUps(['a', 'b', 'c', 'e', 'f', 'g', 'h', 'x'])
  const [{ text }] = await start(game)
  assert.ok(plain(text).includes('Campo 1: A e B contra C e Convidado'), text)
})

async function updated(game, changed) {
  const sent = []
  await announceUpdatedDuplas(game, new Set(changed), { sendText: async (_g, text, opts) => { sent.push({ text, mentions: opts.mentions }) } })
  return sent
}

test('duplas atualizadas antes da Ronda 1: os mesmos jogos, marcando só quem mudou', async () => {
  const game = freshDb({ game: { status: 'in_progress', seed_reverse: true }, teams: fourTeams() })
  const [{ text, mentions }] = await updated(game, ['a'])
  assert.equal(text, '🔄 *As duplas do Mix mudaram*\nRonda 1\nCampo 1: E e F contra G e H\nCampo 2: @a e B contra C e D')
  assert.deepEqual(mentions, ['a@s.whatsapp.net'])
})

test('duplas atualizadas com jogos gravados: anuncia os jogos que lá estão, da ronda mais recente', async () => {
  const game = freshDb({ game: { status: 'in_progress' }, teams: fourTeams() })
  db.matches = [
    { game_id: 'm', round_number: 1, court_number: 1, team_a_id: 't2', team_b_id: 't4' },
    { game_id: 'm', round_number: 1, court_number: 2, team_a_id: 't3', team_b_id: 't1' },
    { game_id: 'm', round_number: 2, court_number: 1, team_a_id: 't2', team_b_id: 't3' },
    { game_id: 'm', round_number: 2, court_number: 2, team_a_id: 't4', team_b_id: 't1' },
  ]
  const [{ text }] = await updated(game, [])
  assert.equal(text, '🔄 *As duplas do Mix mudaram*\nRonda 2\nCampo 1: A e B contra E e F\nCampo 2: C e D contra G e H')
})

test('modos sem jogos previsíveis (Americano): continua a lista de sempre', async () => {
  const game = freshDb({ game: { status: 'in_progress', format: 'americano' }, teams: fourTeams() })
  const [{ text }] = await updated(game, [])
  assert.equal(text, '🔄 *As duplas do Mix mudaram*\n1. A e B\n2. C e D\n3. E e F\n4. G e H')
})

test('o texto dos jogos: várias duplas de fora, separadas por vírgula', () => {
  const ts = seeds(5, 4, 3, 2).map((t, i) => ({ ...t, n: i }))
  const names = teamNames(ts, (t) => [`A${t.n}`, `B${t.n}`])
  const text = gamesLines({ teams: ts, roundNumber: 1, matches: seedCourts(ts, 1) }, names)
  assert.equal(text, 'Ronda 1\nCampo 1: A0 e B0 contra A1 e B1\n\nDescansam: A2 e B2, A3 e B3')
})
