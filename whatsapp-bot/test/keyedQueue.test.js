import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createKeyedQueue } from '../src/keyedQueue.js'

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

test('mesma chave: por ordem; chaves diferentes: em paralelo; um erro não pára a fila', async () => {
  const run = createKeyedQueue()
  const log = []
  const t0 = Date.now()
  await Promise.all([
    run('g1', async () => { await wait(40); log.push('g1-a') }),
    run('g1', async () => { throw new Error('falhou') }),
    run('g1', async () => { log.push('g1-c') }),
    run('g2', async () => { await wait(40); log.push('g2-a') }),
  ])
  assert.deepEqual(log.filter((x) => x.startsWith('g1')), ['g1-a', 'g1-c'])
  assert.ok(Date.now() - t0 < 75, 'g1 e g2 correram em paralelo')
})
