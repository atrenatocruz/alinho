import { describe, it, expect } from 'vitest'
import { cardsByCourt, unscheduledMatches, courtNames, proposeSchedule } from './scorePage'
import { dayKeyInTz, hhmmInTz } from './tournamentDay'

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

  // Trello #502: o quadro grava-se com stage 'principal'/'3lugar' e a ronda
  // em `round_label`; cada categoria tem o seu dia e a sua hora de início.
  describe('eliminatória e o dia de cada categoria (#502)', () => {
    const dias = [
      { date: '2026-10-09', starts_at: '18:00:00', ends_at: '23:00:00', courts: 2 },
      { date: '2026-10-10', starts_at: '09:00:00', ends_at: '21:00:00', courts: 2 },
      { date: '2026-10-11', starts_at: '09:00:00', ends_at: '18:00:00', courts: 2 },
    ]
    const categories = [
      { id: 'X', day_date: '2026-10-10', start_time: '12:00:00' }, // meias + 3.º + final, sábado
      { id: 'Y', day_date: '2026-10-11', start_time: '09:00:00' }, // meia + final, domingo
    ]
    const ko = (id, category_id, stage, round_label, a, b) =>
      m({ id, category_id, stage, round_label, group_label: null, team_a: pair(`${a}1`, `${a}2`), team_b: pair(`${b}1`, `${b}2`) })
    const jogos = [
      ko('xF', 'X', 'principal', 'F', 'p', 'q'),
      ko('x3', 'X', '3lugar', '3P', 'r', 's'),
      ko('xS1', 'X', 'principal', 'SF', 'a', 'b'),
      ko('xS2', 'X', 'principal', 'SF', 'c', 'd'),
      ko('yF', 'Y', 'principal', 'F', 'e', 'f'),
      ko('yS', 'Y', 'principal', 'SF', 'g', 'h'),
    ]
    const RANK = { SF: 4, '3P': 5, F: 6 } // o mesmo que tournament_phase_rank
    const r = proposeSchedule({ days: dias, courts, categories, matches: jogos, durationMaxMin: 60 })
    const slot = Object.fromEntries(r.slots.map((s) => [s.match_id, s]))
    const hora = (id) => new Date(slot[id].starts_at).getTime()

    it('marca todos', () => {
      expect(r.left).toEqual([])
      expect(r.slots).toHaveLength(6)
    })

    it('cada categoria fica no seu dia e a partir da sua hora', () => {
      for (const id of ['xF', 'x3', 'xS1', 'xS2']) {
        expect(dayKeyInTz(slot[id].starts_at)).toBe('2026-10-10')
        expect(hhmmInTz(slot[id].starts_at) >= '12:00').toBe(true)
      }
      for (const id of ['yF', 'yS']) expect(dayKeyInTz(slot[id].starts_at)).toBe('2026-10-11')
    })

    it('a fase seguinte só começa depois de a anterior acabar — a regra que o servidor verifica', () => {
      const hour = 60 * 60000
      for (const a of jogos) {
        for (const b of jogos) {
          if (a.category_id !== b.category_id || RANK[a.round_label] >= RANK[b.round_label]) continue
          // a é de uma fase anterior a b: tem de acabar antes de b começar.
          expect(hora(a.match_id) + hour).toBeLessThanOrEqual(hora(b.match_id))
        }
      }
      expect(hora('xF')).toBeGreaterThan(hora('xS1'))
    })
  })

  it('courtNames ignora campos sem nome', () => {
    expect(courtNames([{ name: 'Campo 1' }, {}, null])).toEqual(['Campo 1'])
  })
})
