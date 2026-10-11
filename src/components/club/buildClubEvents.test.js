import { describe, it, expect } from 'vitest'
import { buildClubEvents } from './ClubSections'

const day = (offset, h = 20) => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  d.setHours(h, 0, 0, 0)
  return d
}
const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

describe('buildClubEvents — «O que vem aí» (QA, 11 out)', () => {
  it('não leva mixes de dias que já passaram, nem cancelados; os de hoje ficam', () => {
    const club = {
      open_games: [
        { id: 'velho', title: 'Fim QA sobe e desce', date: day(-5).toISOString(), status: 'in_progress' },
        { id: 'hoje', title: 'Mix de hoje', date: day(0, 0).toISOString(), status: 'in_progress' },
        { id: 'amanha', title: 'Mix de amanhã', date: day(1).toISOString() },
        { id: 'cancelado', title: 'Cancelado', date: day(2).toISOString(), status: 'cancelled' },
      ],
    }
    expect(buildClubEvents(club).map((e) => e.game.id)).toEqual(['hoje', 'amanha'])
  })

  it('não leva torneios cancelados, terminados ou que já acabaram', () => {
    const tours = [
      { id: 'canc', name: 'Ensaio Boavista', status: 'cancelado', starts_on: key(day(3)), ends_on: key(day(3)) },
      { id: 'term', name: 'Antigo', status: 'terminado', starts_on: key(day(-9)), ends_on: key(day(-8)) },
      { id: 'passou', name: 'Já acabou', status: 'a_decorrer', starts_on: key(day(-3)), ends_on: key(day(-2)) },
      { id: 'agora', name: 'A decorrer', status: 'a_decorrer', starts_on: key(day(-1)), ends_on: key(day(1)) },
      { id: 'futuro', name: 'Outono Open', status: 'inscricoes', starts_on: key(day(10)), ends_on: key(day(11)) },
    ]
    expect(buildClubEvents({ open_games: [] }, tours).map((e) => e.tournament.id)).toEqual(['agora', 'futuro'])
  })
})
