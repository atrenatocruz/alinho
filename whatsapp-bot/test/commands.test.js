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

export async function say(text, pn = '351911111111', mentionPns = []) {
  const sent = []
  await handleGroupMessage(
    { groupJid: 'g@g.us', senderPn: `${pn}@s.whatsapp.net`, text, message: {}, quotedStanzaId: null,
      mentionedJids: mentionPns.map((p) => `${p}@s.whatsapp.net`), mentionedPns: mentionPns.map((p) => `${p}@s.whatsapp.net`) },
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

// ── Sair de uma dupla (Renato, 25 set) ────────────────────────────────────
// Bernardo (a, 911…) inscreveu a dupla com Afonso (b, 922…).
function pairIn() {
  db.profiles.push({ id: 'c', name: 'Carlos Mendes', phone_hash: hash('933333333'), language: 'pt' })
  db.memberships.push({ user_id: 'c', organization_id: 'o' })
  db.participants.push({ id: 'row', game_id: 'm', user_id: 'a', partner_id: 'b', status: 'confirmed', joined_alone: false, created_at: '2026-09-01T10:00:00Z' })
}
const row = () => db.participants.find((p) => p.id === 'row')

test('«Out dupla» (dito pelo parceiro) tira a dupla toda', async () => {
  pairIn()
  await say('out dupla', '351922222222')
  assert.equal(row(), undefined)
})

test('«Out @parceiro» tira só o parceiro; quem escreveu fica sozinho', async () => {
  pairIn()
  const out = await say('out @afonso', '351911111111', ['351922222222'])
  assert.deepEqual([row().user_id, row().partner_id], ['a', null])
  assert.match(out, /Afonso Dias/)
  assert.deepEqual(db.rpcCalls?.map((c) => c[0]), ['promote_waitlist'])
})

test('o parceiro convidado também pode tirar quem o inscreveu («Out @Bernardo»)', async () => {
  pairIn()
  await say('out @bernardo', '351922222222', ['351911111111'])
  assert.deepEqual([row().user_id, row().partner_id], ['b', null])
})

test('«Out @alguém» que não é o parceiro: não mexe e explica', async () => {
  pairIn()
  const out = await say('out @carlos', '351911111111', ['351933333333'])
  assert.deepEqual([row().user_id, row().partner_id], ['a', 'b'])
  assert.match(out, /não está na tua dupla/)
})

test('«Out» sozinho em dupla pergunta 1/2/3; «2» = só tu', async () => {
  pairIn()
  const menu = await say('out')
  assert.match(menu, /1\. Dupla[\s\S]*2\. Só tu[\s\S]*3\. /)
  assert.deepEqual([row().user_id, row().partner_id], ['a', 'b'])
  await say('2')
  assert.deepEqual([row().user_id, row().partner_id], ['b', null])
})

test('«Out» → «3» tira o parceiro; «Out» → «1» tira a dupla; resposta inválida pede outra vez', async () => {
  pairIn()
  await say('out')
  assert.match(await say('talvez'), /1.*2.*3/)
  await say('3')
  assert.deepEqual([row().user_id, row().partner_id], ['a', null])
  db.participants.find((p) => p.id === 'row').partner_id = 'b'
  await say('out')
  await say('1')
  assert.equal(row(), undefined)
})

test('parceiro que ainda não entrou na app: «só tu» tira a dupla toda e explica', async () => {
  pairIn()
  db.profiles.find((p) => p.id === 'b').claim_pending = true
  await say('out')
  const out = await say('2')
  assert.equal(row(), undefined)
  assert.match(out, /ainda não entrou na app/)
})

test('a mensagem do mix explica como sair em dupla, só quando há duplas inscritas', async () => {
  const { buildMixMessage } = await import('../src/roster.js')
  const game = { id: 'm', title: 'Mix', date: new Date(Date.now() + 864e5).toISOString(), num_courts: 1, status: 'open', rotate_partners: false, allow_pair_signup: true }
  const solo = buildMixMessage({ game, people: [{ name: 'A', pair: null }], capacity: 4, suplentes: [] })
  const pair = buildMixMessage({ game, people: [{ name: 'A', pair: 1 }, { name: 'B', pair: 1 }], capacity: 4, suplentes: [] })
  assert.doesNotMatch(solo, /Out dupla/)
  assert.match(pair, /Out dupla/)
  assert.match(pair, /Out @parceiro/)
})

test('com vários mixes abertos, «Out 01 dupla» tira a dupla do mix 01', async () => {
  pairIn()
  db.games.push({ id: 'm2', organization_id: 'o', title: 'Outro', status: 'open', origin: 'manual',
    date: new Date(Date.now() + 2 * 864e5).toISOString(), num_courts: 1, max_players: 4, rotate_partners: false, allow_pair_signup: true })
  await say('out 01 dupla', '351922222222')
  assert.equal(row(), undefined)
})

// ── #537 (ramo bugs-537-bot) ──────────────────────────────────────────────
test('duas contas com o mesmo telemóvel no clube: o «In» usa a registada, não o convidado', async () => {
  db.profiles.push({ id: 'g', name: 'Bernardo (convidado)', email: 'guest-1@whatsapp.alinho.pt', phone_hash: hash('911111111'), language: 'pt' })
  db.memberships.push({ user_id: 'g', organization_id: 'o', is_guest: true })
  db.profiles.find((p) => p.id === 'a').phone_verified_at = '2026-09-25T10:00:00Z'
  await say('in')
  assert.deepEqual(db.participants.map((p) => p.user_id), ['a'])
})

test('conta registada (número confirmado) fora do clube: o «In» torna-a membro, sem criar convidado', async () => {
  db.profiles.push({ id: 'r', name: 'Rita Registada', email: 'rita@mail.pt', phone_hash: hash('966666666'), phone_verified_at: '2026-09-25T10:00:00Z', language: 'pt' })
  await say('in', '351966666666')
  assert.deepEqual(db.participants.map((p) => p.user_id), ['r'])
  assert.ok(db.memberships.some((m) => m.user_id === 'r' && m.organization_id === 'o'))
  assert.equal(db.profiles.filter((p) => /whatsapp\.alinho\.pt/.test(p.email || '')).length, 0)
})

test('«In @parceiro» com conta registada fora do clube: o parceiro também passa a membro', async () => {
  db.profiles.push({ id: 'r', name: 'Rita Registada', email: 'rita@mail.pt', phone_hash: hash('966666666'), phone_verified_at: '2026-09-25T10:00:00Z', language: 'pt' })
  await say('in @rita', '351911111111', ['351966666666'])
  assert.deepEqual(db.participants.map((p) => [p.user_id, p.partner_id]), [['a', 'r']])
  assert.ok(db.memberships.some((m) => m.user_id === 'r' && m.organization_id === 'o'), 'a Rita tem de ficar membro do clube')
})

// ── Níveis novos: F (feminino), N (sem sexo), MX (misto) — Renato, 26 set ──
function levelMixes() {
  db.games = [
    { id: 'gm', organization_id: 'o', title: 'Mix A', status: 'open', origin: 'manual', level: 'M4',
      date: new Date(Date.now() + 1 * 864e5).toISOString(), num_courts: 1, max_players: 4, rotate_partners: false },
    { id: 'gx', organization_id: 'o', title: 'Mix B', status: 'open', origin: 'manual', level: 'MX4',
      date: new Date(Date.now() + 2 * 864e5).toISOString(), num_courts: 1, max_players: 4, rotate_partners: false },
    { id: 'gf', organization_id: 'o', title: 'Mix C', status: 'open', origin: 'manual', level: 'F3',
      date: new Date(Date.now() + 3 * 864e5).toISOString(), num_courts: 1, max_players: 4, rotate_partners: false },
    { id: 'gn', organization_id: 'o', title: 'Mix D', status: 'open', origin: 'manual', level: 'N2',
      date: new Date(Date.now() + 4 * 864e5).toISOString(), num_courts: 1, max_players: 4, rotate_partners: false },
  ]
}

for (const [text, gameId] of [['in mx4', 'gx'], ['in m4', 'gm'], ['in f3', 'gf'], ['in n2', 'gn'], ['inmx4', 'gx'], ['in F3', 'gf']]) {
  test(`«${text}» entra no mix com esse nível`, async () => {
    levelMixes()
    await say(text)
    assert.deepEqual(db.participants.map((p) => p.game_id), [gameId])
  })
}

test('o filtro de nível do grupo aceita os níveis novos e não liga a maiúsculas', async () => {
  const { mixVisibleToGroup } = await import('../src/groups.js')
  const group = { levels: ['MX4', 'N2'] }
  assert.equal(mixVisibleToGroup({ level: 'MX4' }, group), true)
  assert.equal(mixVisibleToGroup({ level: 'mx4' }, group), true)
  assert.equal(mixVisibleToGroup({ level: 'N2' }, group), true)
  assert.equal(mixVisibleToGroup({ level: 'M4' }, group), false)
  assert.equal(mixVisibleToGroup({ level: 'F3' }, { levels: ['f3'] }), true)
})

// ── Duas contas com o mesmo número (caso do Leandro, 26 set) ───────────────
// O convidado do bot (g) está inscrito; a conta registada (a) é a escolhida.
function twoAccounts() {
  db.profiles.push({ id: 'g', name: 'Bernardo (convidado)', email: 'guest-1@whatsapp.alinho.pt', phone_hash: hash('911111111'), language: 'pt' })
  db.memberships.push({ user_id: 'g', organization_id: 'o', is_guest: true })
}

test('«Out» encontra a inscrição feita com o convidado do mesmo número', async () => {
  twoAccounts()
  db.participants.push({ id: 'pg', game_id: 'm', user_id: 'g', status: 'confirmed', created_at: '2026-09-25T22:17:00Z' })
  const out = await say('out')
  assert.doesNotMatch(out, /Não estás inscrito/)
  assert.equal(db.participants.length, 0)
})

test('«In» não inscreve outra vez quem já está com o convidado do mesmo número', async () => {
  twoAccounts()
  db.participants.push({ id: 'pg', game_id: 'm', user_id: 'g', status: 'confirmed', created_at: '2026-09-25T22:17:00Z' })
  const out = await say('in')
  assert.match(out, /Já estás inscrito/)
  assert.equal(db.participants.length, 1)
})

test('dupla inscrita com o convidado: «Out» abre o menu e «3» deixa o convidado sozinho', async () => {
  twoAccounts()
  db.participants.push({ id: 'row', game_id: 'm', user_id: 'g', partner_id: 'b', status: 'confirmed', created_at: '2026-09-25T22:17:00Z' })
  assert.match(await say('out'), /1\. Dupla/)
  await say('3')
  assert.deepEqual([row().user_id, row().partner_id], ['g', null])
})

// ── #554: juntar o parceiro a quem já deu «In» sozinho ────────────────────
function soloIn({ full = false } = {}) {
  db.participants.push({ id: 'solo', game_id: 'm', user_id: 'a', partner_id: null, status: 'confirmed', joined_alone: true, created_at: '2026-09-25T15:54:00Z' })
  if (full) {
    for (const [id, u] of [['x1', 'u1'], ['x2', 'u2'], ['x3', 'u3']]) {
      db.participants.push({ id, game_id: 'm', user_id: u, status: 'confirmed', created_at: '2026-09-25T16:00:00Z' })
    }
  }
}
const solo = () => db.participants.find((p) => p.id === 'solo')

test('#554 «In com» já inscrito sozinho junta o parceiro na mesma linha (mantém o lugar)', async () => {
  soloIn()
  const out = await say('in com afonso')
  assert.doesNotMatch(out, /Já estás inscrito/)
  assert.deepEqual([solo().partner_id, solo().joined_alone, solo().created_at], ['b', false, '2026-09-25T15:54:00Z'])
  assert.equal(db.participants.length, 1)
})

test('#554 mix cheio: recusa com mensagem clara e fica como estava', async () => {
  soloIn({ full: true })
  const out = await say('in com afonso')
  assert.match(out, /não há vaga para o teu parceiro/)
  assert.equal(solo().partner_id, null)
})

test('#554 parceiro já inscrito: recusa', async () => {
  soloIn()
  db.participants.push({ id: 'pb', game_id: 'm', user_id: 'b', status: 'confirmed', created_at: '2026-09-25T16:00:00Z' })
  const out = await say('in com afonso')
  assert.match(out, /já está inscrito/)
  assert.equal(solo().partner_id, null)
})

test('#554 mix sem «Inscrição em dupla»: recusa', async () => {
  soloIn()
  db.games[0].allow_pair_signup = false
  const out = await say('in com afonso')
  assert.match(out, /só de inscrição individual/)
  assert.equal(solo().partner_id, null)
})

test('#554 parceiro que não está na app: «Sim» junta-o à inscrição que já existe, com link', async () => {
  soloIn()
  assert.match(await say('in com rui costa'), /Queres inscrever a dupla/)
  const out = await say('sim')
  assert.match(out, /convite\//)
  assert.equal(db.participants.length, 1)
  assert.ok(solo().partner_id, 'o parceiro fica na linha que já existia')
  assert.equal(db.partner_invites[0].participant_id, 'solo')
})

// ── #552: «mix» mostra o cartão completo de cada mix aberto ────────────────
async function sayWithIds(text, quotedStanzaId = null, pn = '351911111111') {
  const sent = []
  let n = 0
  await handleGroupMessage(
    { groupJid: 'g@g.us', senderPn: `${pn}@s.whatsapp.net`, text, message: {}, quotedStanzaId },
    { sendText: async (_g, t) => { sent.push({ id: `card-${Date.now()}-${++n}`, text: t }); return sent.at(-1).id } },
  )
  return sent
}
function threeMixes() {
  db.games = ['m1', 'm2', 'm3'].map((id, i) => ({
    id, organization_id: 'o', title: `Mix ${id}`, status: 'open', origin: 'manual',
    date: new Date(Date.now() + (i + 1) * 864e5).toISOString(), num_courts: 1, max_players: 4, rotate_partners: false,
  }))
}

test('#552 «mix» com 1 mix aberto: envia o cartão completo', async () => {
  sync._resetGroupStateForTests()
  const sent = await sayWithIds('mix')
  assert.equal(sent.length, 1)
  assert.match(sent[0].text, /\*Mix\*/)
  assert.match(sent[0].text, /\(vaga livre\)/)
})

test('#552 «mix» com 3 mixes: 3 cartões numerados; «mix» repetido logo a seguir só dá a lista curta', async () => {
  sync._resetGroupStateForTests()
  threeMixes()
  const first = await sayWithIds('mix')
  assert.equal(first.length, 3)
  assert.match(first[0].text, /Nº: 01/)
  assert.match(first[2].text, /Nº: 03/)
  const again = await sayWithIds('/mix')
  assert.equal(again.length, 1)
  assert.match(again[0].text, /saíram há pouco/)
  assert.doesNotMatch(again[0].text, /\(vaga livre\)/)
})

test('#552 responder «In» a um cartão do «mix» inscreve nesse mix', async () => {
  sync._resetGroupStateForTests()
  threeMixes()
  const cards = await sayWithIds('mix')
  await sayWithIds('in', cards[1].id)
  assert.deepEqual(db.participants.map((p) => p.game_id), ['m2'])
})
