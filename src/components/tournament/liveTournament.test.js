import { describe, expect, it } from 'vitest'
import { lastResultText, liveTournamentCard, liveTournamentLink, winnerScore } from './liveTournament'

const WORDS = {
  'livetour.phase_groups': 'Grupos',
  'tournament.draw.round_QF': 'Quartos',
  'tournament.draw.round_F': 'Final',
  'livetour.last': 'Último:',
}
const t = (k, v = {}) => {
  if (WORDS[k]) return WORDS[k]
  if (k === 'livetour.tag') return `Torneio · ${v.phase}`
  if (k === 'livetour.matches_live') return `${v.count} jogos a decorrer`
  if (k === 'livetour.hidden_pair') return `Dupla ${v.n}`
  return k
}

const row = {
  kind: 'tournament', slug: 'smash-open', tournament_id: 't1', name: 'Smash Open 2026', org_name: 'Clube Exemplo',
  category_code: 'M4', stage: 'knockout', round: 'QF', matches_live: 4,
  last_result: { a_name: 'Serra / Mota', b_name: 'Lima / Pinto', score: '6-4', a_won: true },
}

describe('«A decorrer agora» — cartão do torneio', () => {
  it('o cartão do desenho: fase, categoria, jogos a decorrer e o último resultado', () => {
    expect(liveTournamentCard(row, t)).toEqual({
      tag: 'Torneio · quartos',
      title: 'Smash Open 2026',
      meta: 'M4 · 4 jogos a decorrer',
      leadLabel: 'Último:',
      lead: 'Serra / Mota 6–4',
      to: '/torneio/smash-open?cat=M4&tab=all_games&sec=draw',
    })
  })
  it('nos grupos, a fase é «grupos» e o toque leva à secção dos grupos', () => {
    const c = liveTournamentCard({ ...row, stage: 'groups', round: null }, t)
    expect(c.tag).toBe('Torneio · grupos')
    expect(c.to).toBe('/torneio/smash-open?cat=M4&tab=all_games&sec=groups')
  })
  it('o resultado aparece do lado de quem ganhou', () => {
    expect(winnerScore('4-6 6-3 8-10', false)).toBe('6–4 3–6 10–8')
    expect(lastResultText({ ...row.last_result, score: '4-6', a_won: false }, t)).toBe('Lima / Pinto 6–4')
  })
  it('quem esconde os resultados aparece como «Dupla N»', () => {
    expect(lastResultText({ a_name: null, a_hidden: true, a_number: 3, b_name: 'Lima / Pinto', score: '6-2', a_won: true }, t)).toBe('Dupla 3 6–2')
  })
  it('sem jogo acabado, não há «Último»; sem jogos a decorrer, mostra o clube', () => {
    const c = liveTournamentCard({ ...row, matches_live: 0, last_result: null }, t)
    expect(c.lead).toBe('')
    expect(c.leadLabel).toBe('')
    expect(c.meta).toBe('M4 · Clube Exemplo')
  })
  it('sem endereço curto, usa o id', () => {
    expect(liveTournamentLink({ tournament_id: 't9', stage: 'groups' })).toBe('/torneio/t9?tab=all_games&sec=groups')
  })
})
