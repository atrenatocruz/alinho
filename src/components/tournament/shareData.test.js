import { describe, expect, it } from 'vitest'
import { bigScore, podiumShare, pairShort, recordOf, recordWords, setsWords, shortName, suggestedText } from './shareData'

const t = (k, v = {}) => `${k}|${Object.entries(v).map(([a, b]) => `${a}=${b}`).join(',')}`

describe('cartões de partilha do torneio', () => {
  it('apelido abreviado', () => {
    expect(shortName('Rita Figueira')).toBe('Rita F.')
    expect(shortName('Ana Maria Marques')).toBe('Ana M.')
    expect(shortName('Rui')).toBe('Rui')
    expect(shortName('Admin (Dev)')).toBe('Admin D.')
    expect(pairShort({ players: ['Rita Figueira', 'Tiago Lopes'] })).toBe('Rita F. / Tiago L.')
  })
  it('quem esconde os resultados não aparece pelo nome', () => {
    expect(pairShort({ players: ['Rita Figueira'], hides_results: true }, 'Dupla M4')).toBe('Dupla M4')
  })
  it('vitórias no torneio: «3 de 4», e % só com 5 ou mais jogos', () => {
    const ms = [1, 2, 3, 4].map((i) => ({ entry_a_id: 'e1', entry_b_id: `x${i}`, winner_entry_id: i === 2 ? `x${i}` : 'e1' }))
    expect(recordOf(ms, 'e1')).toEqual({ won: 3, played: 4 })
    expect(recordWords({ won: 3, played: 4 }, t)).toBe('tshare.record|won=3,played=4')
    expect(recordWords({ won: 4, played: 5 }, t)).toBe('tshare.record_pct|pct=80')
  })
  it('sets e resultado do lado de quem partilha', () => {
    const m = { score_a: 1, score_b: 2, sets: [{ score_a: 4, score_b: 6 }, { score_a: 6, score_b: 3 }, { score_a: 7, score_b: 10 }] }
    expect(setsWords(m, false)).toBe('6-4 · 3-6 · 10-7')
    expect(bigScore(m, 'b')).toBe(2)
    expect(setsWords({ score_a: 9, score_b: 7 }, true)).toBe('9-7')
  })
  it('o texto: na final, o do 1.º ou do 2.º lugar', () => {
    expect(suggestedText('result', { round: 'F', didWin: true }, t)).toMatch(/^tshare\.text_podium_1/)
    expect(suggestedText('result', { round: 'QF', didWin: false }, t)).toMatch(/^tshare\.text_lost_knockout/)
    expect(suggestedText('podium', { place: 5, won: 0 }, t)).toMatch(/^tshare\.text_place_no_wins/)
  })
})

describe('pódio', () => {
  it('o 3.º aparece quando existe, com a Muralha de Bronze', () => {
    const team = (a, b) => ({ name: `${a} / ${b}`, players: [a, b] })
    const results = {
      categories: [{ code: 'MX4', champion: team('Marta Silva', 'Tiago Lopes'), runner_up: team('Francisco Barros', 'Marta Silva'), third: team('Nuno Reis', 'Ana Moreira') }],
      my: { category_code: 'MX4', final_position: 3, matches: 4, matches_won: 2 },
    }
    const built = podiumShare({ tournament: { name: 'Smash Cup' }, results, myName: 'Ana Moreira', t, lang: 'pt' })
    expect(built.data.rows.map((r) => [r.place, r.title, r.mine])).toEqual([
      [1, 'tshare.title_1|', false], [2, 'tshare.title_2|', false], [3, 'tshare.title_3|', true],
    ])
    expect(built.data.rows[2].pair).toBe('Nuno R. / Ana M.')
  })
})

