import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.SUPABASE_URL = 'http://localhost:1'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'x'
process.env.PHONE_HASH_SECRET = 'x'

const { formDuplas } = await import('../src/autostart.js')

const key = (a, b) => [a, b].sort().join('|')

// O mix +1 de 28 set, com as mesmas contas (nomes trocados por letras):
// 12 sozinhos, os pontos e os lados de cada um, e as duplas dos 4 mixes
// anteriores que estavam no grupo.
const points = { r: 1231, c: 1100, f: 978, rd: 954, g: 953, t: 948, dj: 945, rm: 901, n: 900, j: 856, a: 843, da: 833 }
const sides = { r: 'right', f: 'left', rm: 'left', da: 'right' }
const people = Object.keys(points).map((id) => ({ user_id: id, partner_id: null }))
const repeats = new Set([key('f', 'j'), key('r', 'f'), key('f', 't'), key('g', 't'), key('g', 'j'), key('da', 'a')])

test('28 set: sem repetir o par Aurélio + Diogo Alexandre, havendo alternativa', () => {
  const rows = formDuplas(people, points, repeats, sides)
  const pairs = rows.map((r) => key(r.player1_id, r.player2_id))
  assert.equal(rows.length, 6)
  assert.equal(rows.forcedRepeats.length, 0)
  for (const p of pairs) assert.ok(!repeats.has(p), `repetiu ${p}`)
  // A mesma escolha da app: só mudam as duas últimas duplas.
  assert.ok(pairs.includes(key('n', 'a')))
  assert.ok(pairs.includes(key('j', 'da')))
  assert.ok(pairs.includes(key('r', 'c')))
})

test('ninguém fica de fora e ninguém joga duas vezes', () => {
  const rows = formDuplas(people, points, repeats, sides)
  const ids = rows.flatMap((r) => [r.player1_id, r.player2_id]).sort()
  assert.deepEqual(ids, Object.keys(points).sort())
})

test('só repete quando não há outra maneira, e diz quais', () => {
  const four = ['a', 'b', 'c', 'd'].map((id) => ({ user_id: id, partner_id: null }))
  const all = new Set([key('a', 'b'), key('a', 'c'), key('a', 'd')])
  const rows = formDuplas(four, { a: 4, b: 3, c: 2, d: 1 }, all, {})
  assert.equal(rows.length, 2)
  assert.equal(rows.forcedRepeats.length, 1)
})

test('quem se inscreveu em dupla fica junto', () => {
  const rows = formDuplas([
    { user_id: 'x', partner_id: 'y' },
    { user_id: 'a', partner_id: null }, { user_id: 'b', partner_id: null },
  ], {}, new Set(), {})
  assert.ok(rows.some((r) => key(r.player1_id, r.player2_id) === key('x', 'y')))
})

test('dois do mesmo lado só quando não há alternativa', () => {
  const four = [{ user_id: 'l1', partner_id: null }, { user_id: 'l2', partner_id: null }, { user_id: 'r1', partner_id: null }, { user_id: 'r2', partner_id: null }]
  const rows = formDuplas(four, { l1: 4, l2: 3, r1: 2, r2: 1 }, new Set(), { l1: 'left', l2: 'left', r1: 'right', r2: 'right' })
  for (const r of rows) assert.notEqual(r.player1_id[0], r.player2_id[0], 'juntou dois do mesmo lado')
})

// A regra da série (Francisco, 28 set): «é no mesmo mix, não no mesmo grupo».
const { supabase } = await import('../src/supabase.js')
const { installFakeSupabase } = await import('./fakeSupabase.js')
const { loadRepeatPairKeys } = await import('../src/autostart.js')

const day = (d) => `2026-${d}T20:00:00+00:00`
function seriesDb() {
  // Segundas (série S) e quintas (série Q) no mesmo grupo, e um mix solto.
  const games = [
    { id: 's1', organization_id: 'o', recurrence_id: 'S', date: day('08-31') },
    { id: 's2', organization_id: 'o', recurrence_id: 'S', date: day('09-07') },
    { id: 's3', organization_id: 'o', recurrence_id: 'S', date: day('09-14') },
    { id: 's4', organization_id: 'o', recurrence_id: 'S', date: day('09-21') },
    { id: 'q1', organization_id: 'o', recurrence_id: 'Q', date: day('09-17') },
    { id: 'q2', organization_id: 'o', recurrence_id: 'Q', date: day('09-24') },
    { id: 'x1', organization_id: 'o', recurrence_id: null, date: day('09-25') },
    { id: 's0', organization_id: 'o', recurrence_id: 'S', date: day('08-24') },
  ]
  const teams = [
    { game_id: 's1', player1_id: 'f', player2_id: 'rd' },
    { game_id: 's4', player1_id: 'a', player2_id: 'da' },
    { game_id: 'q2', player1_id: 'f', player2_id: 'c' },
    { game_id: 'x1', player1_id: 'n', player2_id: 'j' },
    { game_id: 's0', player1_id: 'old', player2_id: 'pair' },
  ]
  return { games, teams, profiles: [] }
}

test('série: conta só os 4 mixes anteriores da mesma série', async () => {
  installFakeSupabase(supabase, seriesDb())
  const keys = await loadRepeatPairKeys({ id: 'today', organization_id: 'o', recurrence_id: 'S', date: day('09-28') })
  assert.ok(keys.has(key('f', 'rd')), '31 ago é da série e está nos 4 anteriores')
  assert.ok(keys.has(key('a', 'da')))
  assert.ok(!keys.has(key('f', 'c')), 'a quinta é outra série')
  assert.ok(!keys.has(key('n', 'j')), 'o mix solto não conta para a série')
  assert.ok(!keys.has(key('old', 'pair')), 'o 5.º para trás já não conta')
})

test('mix que não se repete: os 4 anteriores do grupo, como antes', async () => {
  installFakeSupabase(supabase, seriesDb())
  const keys = await loadRepeatPairKeys({ id: 'solto', organization_id: 'o', recurrence_id: null, date: day('09-26') })
  // Os 4 do grupo antes de 26 set: x1 (25), q2 (24), s4 (21), q1 (17).
  assert.ok(keys.has(key('n', 'j')))
  assert.ok(keys.has(key('f', 'c')))
  assert.ok(keys.has(key('a', 'da')))
  assert.ok(!keys.has(key('f', 'rd')))
})

// 2 out (Francisco): com duplas já sorteadas à mão, o arranque automático
// começa com essas em vez de sortear outras por cima (ficavam a dobrar).
test('duplas já sorteadas: usa-as; com um lugar vazio, espera', async () => {
  const { drawnTeamsToUse } = await import('../src/autostart.js')
  const full = [
    { id: 't1', player1_id: 'a', player2_id: 'b', player1_guest_id: null, player2_guest_id: null },
    { id: 't2', player1_id: 'c', player2_id: null, player1_guest_id: null, player2_guest_id: 'g' },
  ]
  assert.equal(drawnTeamsToUse([]), null)
  assert.equal(drawnTeamsToUse(null), null)
  assert.deepEqual(drawnTeamsToUse(full), full)
  assert.equal(drawnTeamsToUse([full[0]]), 'wait')
  assert.equal(drawnTeamsToUse([full[0], { ...full[1], player2_guest_id: null }]), 'wait')
})
