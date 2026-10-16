import { describe, it, expect } from 'vitest'
import { emptyCreateProgress, nextCreateStep } from './leagueCreate'

describe('nextCreateStep', () => {
  it('começa por criar a liga', () => {
    expect(nextCreateStep(emptyCreateProgress())).toBe('create')
  })
  it('depois de criada, grava a categoria sem criar outra liga', () => {
    expect(nextCreateStep({ league: { id: 'l', slug: 's' }, categoryDone: false, published: false })).toBe('category')
  })
  it('com a categoria gravada, só falta publicar', () => {
    expect(nextCreateStep({ league: { id: 'l', slug: 's' }, categoryDone: true, published: false })).toBe('publish')
  })
  it('publicada, está feito', () => {
    expect(nextCreateStep({ league: { id: 'l', slug: 's' }, categoryDone: true, published: true })).toBe('done')
  })
});
