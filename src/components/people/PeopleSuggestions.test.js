import { describe, it, expect } from 'vitest'
import { reasonText } from './PeopleSuggestions'

const t = (k, v) => (v ? `${k}:${JSON.stringify(v)}` : k)

describe('reasonText', () => {
  it('jogaram juntos, com e sem contagem', () => {
    expect(reasonText(t, { reason: 'jogaram_juntos', reason_count: 5 })).toBe('suggest.played_together:{"count":5}')
    expect(reasonText(t, { reason: 'jogaram_juntos' })).toBe('suggest.played_together_some')
  })
  it('seguem-se e mesmo clube', () => {
    expect(reasonText(t, { reason: 'seguem_se' })).toBe('suggest.follow_each_other')
    expect(reasonText(t, { reason: 'mesmo_clube', org_name: 'Smash' })).toBe('suggest.same_club:{"name":"Smash"}')
    expect(reasonText(t, { reason: 'mesmo_clube' })).toBe('suggest.same_club_some')
  })
})
