import { test } from 'node:test'
import assert from 'node:assert/strict'
process.env.SUPABASE_URL = 'http://localhost:1'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'x'
process.env.PHONE_HASH_SECRET = 'x'
const { supabase } = await import('../src/supabase.js')
const { installFakeSupabase } = await import('./fakeSupabase.js')
const { loadGame, buildMixMessage, rosterName } = await import('../src/roster.js')
const { t } = await import('../src/locales.js')

const mixDb = () => ({
  profiles: [
    { id: 'a', name: 'Ana Moreira', email: 'ana@exemplo.pt', language: 'pt', rating: 912.4 },
    { id: 'g', name: 'Paulo Henriques', email: 'guest-1@whatsapp.alinho.pt', language: 'pt' },
    { id: 'w', name: 'Rui Costa', email: 'guest-2@whatsapp.alinho.pt', language: 'pt' },
  ],
  participants: [
    { id: 'p1', game_id: 'm', user_id: 'a', partner_id: null, status: 'confirmed', created_at: '2026-09-27T10:00:00Z' },
    { id: 'p2', game_id: 'm', user_id: 'g', partner_id: null, status: 'confirmed', created_at: '2026-09-27T10:01:00Z' },
    { id: 'p3', game_id: 'm', user_id: 'w', partner_id: null, status: 'waitlisted', created_at: '2026-09-27T10:02:00Z' },
  ],
  games: [{ id: 'm', organization_id: 'o', title: 'Mix de domingo', status: 'open', origin: 'manual',
    date: new Date(Date.now() + 864e5).toISOString(), num_courts: 1, max_players: 4, rotate_partners: false }],
})

test('a lista do grupo: sem conta é só o nome, com conta e rating leva « (912)»', async () => {
  installFakeSupabase(supabase, mixDb())
  const state = await loadGame('m')
  const text = buildMixMessage(state)
  assert.match(text, /2\. 🎾 Paulo Henriques(?! \((convidado|\d+)\))/)
  assert.match(text, /1\. 🎾 Ana Moreira \(912\)/)
  assert.match(text, /Suplentes:\* Rui Costa(?! \((convidado|\d+)\))/)
})

test('rosterName: convidado nunca leva rating; conta sem rating fica só o nome', () => {
  assert.equal(rosterName({ name: 'Bernardo', guest: true, rating: 850 }), 'Bernardo')
  assert.equal(rosterName({ name: 'Ana', guest: false }), 'Ana')
  assert.equal(rosterName({ name: 'Rui', guest: false, rating: 1003.6 }), 'Rui (1004)')
})

test('a resposta a um convidado novo explica o modelo sem conta', () => {
  const text = t('guest_joined', 'pt', { name: 'Paulo Henriques', appUrl: 'https://alinho.pt' })
  assert.ok(text.startsWith('Olá Paulo Henriques! Entraste como *convidado*'))
  assert.match(text, /sem conta não tens ranking nem histórico/)
  assert.match(text, /regista-te em https:\/\/alinho\.pt/)
  assert.doesNotMatch(text, /para a tua conta/)
})
