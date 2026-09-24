import { describe, it, expect } from 'vitest'
import { cardsByCourt, unscheduledMatches, courtNames, proposeSchedule } from './scorePage'

const pair = (a, b) => ({ name: `${a} / ${b}`, players: [a, b] })
const m = (o) => ({ match_id: o.id, category_id: 'c1', stage: 'grupo', group_label: 'A', status: 'marcado', court: 'Campo 1', ...o })

describe('cardsByCourt — um cartão por campo', () => {
  it('um jogo «marcado» com as duas duplas já tem cartão (antes só «a_decorrer»)', () => {
    const [c] = cardsByCourt([m({ id: 'j1', scheduled_at: '2026-10-09T17:00:00Z', team_a: pair('Ana', 'Rui'), team_b: pair('Eva', 'Luz') })])
    expect(c.card.match_id).toBe('j1')
    expect(c.rest).toEqual([])
  })

  it('o que está a decorrer tem prioridade sobre o próximo', () => {
    const [c] = cardsByCourt([
      m({ id: 'j2', scheduled_at: '2026-10-09T18:00:00Z', team_a: pair('A', 'B'), team_b: pair('C', 'D') }),
      m({ id: 'j1', status: 'a_decorrer', scheduled_at: '2026-10-09T17:00:00Z', team_a: pair('E', 'F'), team_b: pair('G', 'H') }),
    ])
    expect(c.card.match_id).toBe('j1')
    expect(c.rest.map((x) => x.match_id)).toEqual(['j2'])
  })

  it('um jogo do quadro ainda sem duplas não tem cartão — fica no «a seguir»', () => {
    const [c] = cardsByCourt([
      m({ id: 'f', stage: 'F', scheduled_at: '2026-10-09T17:00:00Z', team_a: null, team_b: null }),
      m({ id: 'j', scheduled_at: '2026-10-09T18:00:00Z', team_a: pair('A', 'B'), team_b: pair('C', 'D') }),
    ])
    expect(c.card.match_id).toBe('j')
    expect(c.rest.map((x) => x.match_id)).toEqual(['f'])
  })

  it('cada campo tem o seu cartão', () => {
    const cards = cardsByCourt([
      m({ id: 'a', court: 'Campo 1', scheduled_at: '2026-10-09T17:00:00Z', team_a: pair('A', 'B'), team_b: pair('C', 'D') }),
      m({ id: 'b', court: 'Campo 2', scheduled_at: '2026-10-09T17:00:00Z', team_a: pair('E', 'F'), team_b: pair('G', 'H') }),
    ])
    expect(cards.map((c) => c.card.match_id)).toEqual(['a', 'b'])
  })
})

describe('unscheduledMatches — o que o sorteio deixou sem hora', () => {
  it('conta só os por jogar sem hora', () => {
    const list = [
      m({ id: 'a', scheduled_at: null }),
      m({ id: 'b', scheduled_at: '2026-10-09T17:00:00Z' }),
      m({ id: 'c', scheduled_at: null, status: 'terminado' }),
    ]
    expect(unscheduledMatches(list).map((x) => x.match_id)).toEqual(['a'])
  })
})

describe('proposeSchedule — propor as horas', () => {
  const days = [{ date: '2026-10-09', starts_at: '18:00:00', ends_at: '21:00:00', courts: 2 }]
  const courts = [{ name: 'Campo 1' }, { name: 'Campo 2' }]

  it('sem campos registados não propõe nada, e diz porquê', () => {
    const r = proposeSchedule({ matches: [m({ id: 'a' })], days, courts: [] })
    expect(r.noCourts).toBe(true)
    expect(r.slots).toEqual([])
  })

  it('põe os jogos nos campos e nas horas, no formato da save_match_schedule', () => {
    const r = proposeSchedule({
      days, courts,
      matches: [
        m({ id: 'a', team_a: pair('A', 'B'), team_b: pair('C', 'D') }),
        m({ id: 'b', team_a: pair('E', 'F'), team_b: pair('G', 'H') }),
      ],
    })
    expect(r.slots).toHaveLength(2)
    for (const s of r.slots) {
      expect(Object.keys(s).sort()).toEqual(['court', 'match_id', 'starts_at'])
      expect(['Campo 1', 'Campo 2']).toContain(s.court)
    }
    expect(r.left).toEqual([])
  })

  it('a mesma pessoa não fica em dois campos à mesma hora', () => {
    const r = proposeSchedule({
      days, courts,
      matches: [
        m({ id: 'a', category_id: 'c1', team_a: pair('Ana', 'B'), team_b: pair('C', 'D') }),
        m({ id: 'b', category_id: 'c2', team_a: pair('Ana', 'F'), team_b: pair('G', 'H') }),
      ],
    })
    const [x, y] = r.slots
    expect(x.starts_at).not.toBe(y.starts_at)
  })

  it('o que não cabe nos dias fica de fora e diz-se', () => {
    const cheio = Array.from({ length: 9 }, (_, i) => m({ id: `j${i}`, team_a: pair(`a${i}`, `b${i}`), team_b: pair(`c${i}`, `d${i}`) }))
    const r = proposeSchedule({ days, courts, matches: cheio })
    expect(r.slots).toHaveLength(6) // 3 horas × 2 campos
    expect(r.left).toHaveLength(3)
  })

  it('courtNames ignora campos sem nome', () => {
    expect(courtNames([{ name: 'Campo 1' }, {}, null])).toEqual(['Campo 1'])
  })
})
