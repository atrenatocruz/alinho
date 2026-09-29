import { describe, it, expect } from 'vitest'
import { prizeText } from './TournamentNoticeRow'

const t = (key, v) => ({ 'tournament.notice_prize_first': `1.º ${v?.prize}`, 'tournament.notice_prize_second': `2.º ${v?.prize}` }[key])

describe('prizeText', () => {
  it('só o 1.º: o prémio tal e qual', () => {
    expect(prizeText('150 €', null, t)).toBe('150 €')
  })
  it('os dois: 1.º e 2.º', () => {
    expect(prizeText('200 €', ' 80 € ', t)).toBe('1.º 200 € · 2.º 80 €')
  })
  it('só o 2.º: diz que é do 2.º', () => {
    expect(prizeText('', '80 €', t)).toBe('2.º 80 €')
  })
  it('nenhum: vazio', () => {
    expect(prizeText(null, '  ', t)).toBe('')
  })
})
