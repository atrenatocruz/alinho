import { describe, it, expect } from 'vitest'
import { imageProblem, normalizeCode } from './partnerAdmin'

describe('página de quem gere um parceiro', () => {
  it('o código aceita minúsculas e espaços', () => {
    expect(normalizeCode('  rm-7k2 p9 ')).toBe('RM-7K2P9')
    expect(normalizeCode(null)).toBe('')
  })

  it('as imagens: jpeg, png ou webp até 5 MB', () => {
    expect(imageProblem({ type: 'image/jpeg', size: 1000 })).toBe(null)
    expect(imageProblem({ type: 'image/webp', size: 5 * 1024 * 1024 })).toBe(null)
    expect(imageProblem({ type: 'image/gif', size: 1000 })).toBe('bad_type')
    expect(imageProblem({ type: 'image/png', size: 5 * 1024 * 1024 + 1 })).toBe('too_big')
    expect(imageProblem(null)).toBe('bad_type')
  })
})

describe('o código ao balcão', () => {
  it('compara sem espaços nem hífenes', async () => {
    const { codeKey } = await import('./partnerAdmin')
    expect(codeKey('RM Q3U5XJ')).toBe(codeKey('RM-Q3U5XJ'))
    expect(codeKey('rmq3u5xj')).toBe('RMQ3U5XJ')
  })
})
