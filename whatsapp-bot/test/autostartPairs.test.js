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
