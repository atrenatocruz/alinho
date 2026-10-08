import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.SUPABASE_URL = 'http://localhost:1'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'x'
process.env.PHONE_HASH_SECRET = 'x'
process.env.APP_URL = 'https://alinho.pt'

const { supabase } = await import('../src/supabase.js')
const { installFakeSupabase } = await import('./fakeSupabase.js')
const { checkGuestVoucherNotices } = await import('../src/voucherNotices.js')
const { _resetGroupStateForTests } = await import('../src/sync.js')

const NOW = Date.parse('2026-09-27T21:00:00Z')
const ago = (h) => new Date(NOW - h * 3600e3).toISOString()

let db
beforeEach(() => {
  db = {
    whatsapp_groups: [
      { organization_id: 'o', group_jid: 'm5@g.us', label: 'M5', levels: ['M5'] },
      { organization_id: 'o', group_jid: 'm3@g.us', label: 'M3', levels: ['M3'] },
    ],
    organizations: [{ id: 'o' }],
    games: [{ id: 'g1', organization_id: 'o', title: 'Mix M5 · Segunda', level: 'M5', status: 'finished' }],
    profiles: [
      { id: 'guest', name: 'Rui Tavares', email: 'guest-351911111111@whatsapp.alinho.pt', whatsapp_jid: '351911111111@s.whatsapp.net' },
      { id: 'guest2', name: 'Nuno Leal', email: 'guest-351922222222@whatsapp.alinho.pt', whatsapp_jid: null },
      { id: 'app', name: 'Ana Costa', email: 'ana@example.com', whatsapp_jid: '351933333333@s.whatsapp.net' },
    ],
    vouchers: [
      { id: 'v1', game_id: 'g1', user_id: 'guest', organization_id: 'o', created_at: ago(1), guest_notice_sent_at: null },
      { id: 'v2', game_id: 'g1', user_id: 'app', organization_id: 'o', created_at: ago(1), guest_notice_sent_at: null },
    ],
  }
  installFakeSupabase(supabase, db)
  _resetGroupStateForTests()
})

async function run() {
  const sent = []
  await checkGuestVoucherNotices({ sendText: async (jid, text, opts) => { sent.push({ jid, text, opts }) } }, { now: NOW })
  return sent
}

test('o convidado que ganhou é mencionado no grupo do mix, com o texto do Francisco', async () => {
  const sent = await run()
  assert.equal(sent.length, 1, 'só o grupo que vê o mix M5, e só o convidado')
  assert.equal(sent[0].jid, 'm5@g.us')
  assert.equal(sent[0].text, '🎁 @351911111111, ganhaste um voucher! Usa-o na receção. Queres ter ranking e guardar os próximos prémios? Cria conta em alinho.pt.')
  assert.deepEqual(sent[0].opts.mentions, ['351911111111@s.whatsapp.net'])
})

test('quem tem conta não recebe o aviso', async () => {
  const sent = await run()
  assert.ok(!sent.some((s) => s.text.includes('351933333333')))
  assert.equal(db.vouchers.find((v) => v.id === 'v2').guest_notice_sent_at, null)
})

test('uma vez só: a segunda volta não repete', async () => {
  await run()
  assert.ok(db.vouchers.find((v) => v.id === 'v1').guest_notice_sent_at)
  assert.equal((await run()).length, 0)
})

test('voucher antigo (mais de 48 h) não se anuncia', async () => {
  db.vouchers[0].created_at = ago(49)
  assert.equal((await run()).length, 0)
})

test('convidado sem WhatsApp ligado: vai pelo nome, sem menção', async () => {
  db.vouchers.push({ id: 'v3', game_id: 'g1', user_id: 'guest2', organization_id: 'o', created_at: ago(1), guest_notice_sent_at: null })
  const sent = await run()
  const nuno = sent.find((s) => s.text.startsWith('🎁 Nuno Leal,'))
  assert.ok(nuno)
  assert.deepEqual(nuno.opts.mentions, [])
})

test('voucher sem conta (user_id nulo) não estraga o aviso aos outros', async () => {
  db.vouchers.push({ id: 'v4', game_id: 'g1', user_id: null, guest_id: 'gg1', guest_name: 'Sem App', organization_id: 'o', created_at: ago(1), guest_notice_sent_at: null })
  // O PostgREST rejeita null em .in('id', [...]) (22P02): o fake regista os
  // ids pedidos a profiles para o teste poder afirmar que nenhum é nulo.
  const profileIds = []
  const realFrom = supabase.from.bind(supabase)
  supabase.from = (table) => {
    const q = realFrom(table)
    if (table !== 'profiles') return q
    const realIn = q.in.bind(q)
    q.in = (col, ids) => { if (col === 'id') profileIds.push(...ids); return realIn(col, ids) }
    return q
  }
  const sent = await run()
  assert.ok(profileIds.length > 0, 'a query a profiles aconteceu')
  assert.ok(!profileIds.includes(null) && !profileIds.includes(undefined), 'user_id nulo não vai para .in(id)')
  assert.equal(sent.length, 1)
  assert.ok(sent[0].text.includes('351911111111'))
  assert.equal(db.vouchers.find((v) => v.id === 'v4').guest_notice_sent_at, null)
})
