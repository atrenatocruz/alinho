import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startTimer } from '../src/timing.js'

test('escreve uma linha JSON com o total e os passos', async (t) => {
  const lines = []
  t.mock.method(console, 'log', (l) => lines.push(l))
  const timer = startTimer('cmd:in')
  timer.mark('perfil')
  await new Promise((r) => setTimeout(r, 15))
  timer.mark('insert')
  const total = timer.end({ group: 'g' })
  assert.equal(lines.length, 1)
  const row = JSON.parse(lines[0])
  assert.equal(row.timing, 'cmd:in')
  assert.equal(row.group, 'g')
  assert.ok(row.steps.insert >= 10)
  assert.equal(row.total_ms, total)
})
