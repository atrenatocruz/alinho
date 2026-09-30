import { test } from 'node:test'
import assert from 'node:assert/strict'
import { partnerFromTypedNames, isOnlySenderName } from '../src/partnerNames.js'

// Os casos do grupo de teste (30 set).
test('nome de quem escreve + parceiro, sem separador', () => {
  assert.equal(partnerFromTypedNames('Miguel Oliveira Marco Silva', ['Miguel Oliveira']), 'Marco Silva')
  assert.equal(partnerFromTypedNames('Paulo Duarte Miguel Almeida', [null, 'Paulo Duarte#12']), 'Miguel Almeida')
})

test('nome de quem escreve «e» / «+» / vírgula parceiro', () => {
  assert.equal(partnerFromTypedNames('Miguel Oliveira e Marco Silva', ['Miguel Oliveira']), 'Marco Silva')
  assert.equal(partnerFromTypedNames('Marco Silva + Miguel', ['Miguel Oliveira']), 'Marco Silva')
  assert.equal(partnerFromTypedNames('Miguel, Marco Silva', ['Miguel Oliveira']), 'Marco Silva')
})

test('só o parceiro', () => {
  assert.equal(partnerFromTypedNames('Marco Silva', ['Miguel Oliveira']), 'Marco Silva')
  assert.equal(partnerFromTypedNames('Marco', ['Miguel Oliveira']), 'Marco')
})

test('só o nome de quem escreve → null (entra sozinho)', () => {
  assert.equal(partnerFromTypedNames('Miguel Oliveira', ['Miguel Oliveira']), null)
  assert.equal(partnerFromTypedNames('miguel', ['Miguel Oliveira']), null)
  assert.ok(isOnlySenderName('miguel oliveira', ['Miguel Oliveira']))
})

test('primeiro nome igual ao de quem escreve não se come: «In Miguel Almeida» dito pelo Miguel Oliveira', () => {
  assert.equal(partnerFromTypedNames('Miguel Almeida', ['Miguel Oliveira']), 'Miguel Almeida')
  assert.equal(partnerFromTypedNames('Miguel Marco Silva', ['Miguel Oliveira']), 'Marco Silva')
})

test('não parece nomes → undefined (segue como antes)', () => {
  assert.equal(partnerFromTypedNames('01', ['Miguel']), undefined)
  assert.equal(partnerFromTypedNames('19h', ['Miguel']), undefined)
  assert.equal(partnerFromTypedNames('Paulo Duarte e Miguel Almeida', ['Rui Costa']), undefined)
  assert.equal(partnerFromTypedNames('um dois tres quatro cinco seis', ['Rui']), undefined)
})
