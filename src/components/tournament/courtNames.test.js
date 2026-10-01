import { describe, it, expect } from 'vitest'
import { courtNames } from './CreateTournamentForm'

// QA, 30 set: 2 campos por dia e só «Campo 1» escrito dava um torneio de
// um campo só, e o «Propor horas» punha tudo nele.
describe('nomes dos campos', () => {
  const days = [{ courts: 2 }, { courts: 3 }]
  it('completa até ao dia com mais campos', () => {
    expect(courtNames(['Campo 1 · KIA'], days)).toEqual(['Campo 1 · KIA', 'Campo 2', 'Campo 3'])
  })
  it('sem nomes escritos, põe os nomes base', () => {
    expect(courtNames([], [{ courts: 2 }])).toEqual(['Campo 1', 'Campo 2'])
  })
  it('não tira nomes a mais que a pessoa escreveu', () => {
    expect(courtNames(['A', 'B', 'C'], [{ courts: 2 }])).toEqual(['A', 'B', 'C'])
  })
})
