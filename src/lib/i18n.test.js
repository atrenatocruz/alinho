import { describe, it, expect } from 'vitest'
import i18n from './i18n'

describe('plural de Portugal', () => {
  it('zero vai para o plural', async () => {
    await i18n.changeLanguage('pt')
    expect(i18n.t('profile.followers_count', { count: 0 })).toBe('0 seguidores')
    expect(i18n.t('profile.followers_count', { count: 1 })).toBe('1 seguidor')
    expect(i18n.t('profile.followers_count', { count: 2 })).toBe('2 seguidores')
  })
})
