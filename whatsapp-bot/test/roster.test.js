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
    { id: 'a', name: 'Ana Moreira', email: 'ana@exemplo.pt', language: 'pt' },
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

test('a lista do grupo marca quem entrou sem conta com « (convidado)»', async () => {
  installFakeSupabase(supabase, mixDb())
  const state = await loadGame('m')
  const text = buildMixMessage(state)
  assert.match(text, /2\. 🎾 Paulo Henriques \(convidado\)/)
  assert.match(text, /1\. 🎾 Ana Moreira(?! \(convidado\))/)
  assert.match(text, /Suplentes:\* Rui Costa \(convidado\)/)
})

test('o « (convidado)» não se repete se o nome já o traz', () => {
  assert.equal(rosterName({ name: 'Bernardo (convidado)', guest: true }), 'Bernardo (convidado)')
  assert.equal(rosterName({ name: 'Ana', guest: false }), 'Ana')
})

test('a resposta a um convidado novo é o texto do Francisco', () => {
  const text = t('guest_joined', 'pt', { name: 'Paulo Henriques' })
  assert.ok(text.startsWith('Olá Paulo Henriques! Acabaste de entrar num mix como *convidado*'))
  assert.match(text, /Regista-te em https:\/\/alinho\.pt e confirma o teu número de telefone/)
  assert.match(text, /\n\n⚠️ \*Não voltes a fazer In na app\* antes de confirmar o número/)
})
