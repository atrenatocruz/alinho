import { describe, it, expect } from 'vitest'
import {
  daySlots, totalSlots, scheduleMatches, canPlace, longestRun,
  findConflicts, proposeEarlier, walkoverAllowedAt, arriveAt,
  SCHEDULE_DEFAULTS,
} from './tournamentSchedule'

const dia = (date, start, end, courts) => ({ date, start, end, courts })
const at = (hhmm, date = '2026-10-10') => new Date(`${date}T${hhmm}:00`)
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

const jogo = (id, players, extra = {}) => ({
  id, categoryId: 'M5', stage: 'grupo', groupId: 'A', players, ...extra,
})

const marcado = (id, players, hora, court = 'c1', extra = {}) => ({
  ...jogo(id, players, extra),
  court,
  startsAt: at(hora),
  endsAt: new Date(at(hora).getTime() + 60 * 60000),
})

describe('horas disponíveis', () => {
  it('parte o dia em jogos de 60 min por campo', () => {
    const slots = daySlots(dia('2026-10-10', '09:00', '12:00', ['c1', 'c2']))
    expect(slots).toHaveLength(6) // 3 horas × 2 campos
    expect(hhmm(slots[0].startsAt)).toBe('09:00')
    expect(hhmm(slots[slots.length - 1].startsAt)).toBe('11:00')
  })

  it('com jogos de 30 min cabem o dobro', () => {
    expect(daySlots(dia('2026-10-10', '09:00', '12:00', ['c1']), 30)).toHaveLength(6)
  })

  it('soma os lugares dos três dias do Smash Cup', () => {
    const dias = [
      dia('2026-10-09', '18:00', '23:00', ['c1', 'c2', 'c3', 'c4']), // 5 h × 4 = 20
      dia('2026-10-10', '09:00', '21:00', ['c1', 'c2', 'c3', 'c4']), // 12 h × 4 = 48
      dia('2026-10-11', '09:00', '18:00', ['c1', 'c2', 'c3']),       // 9 h × 3 = 27
    ]
    expect(totalSlots(dias)).toBe(95)
  })
})

describe('marcar os jogos', () => {
  const dias = [dia('2026-10-10', '10:00', '20:00', ['c1', 'c2'])]

  it('marca todos os jogos de um grupo de 4 sem repetir campo à mesma hora', () => {
    const jogos = [
      jogo('g1', ['a1', 'a2', 'b1', 'b2']),
      jogo('g2', ['c1p', 'c2p', 'd1', 'd2']),
      jogo('g3', ['a1', 'a2', 'c1p', 'c2p']),
      jogo('g4', ['b1', 'b2', 'd1', 'd2']),
      jogo('g5', ['a1', 'a2', 'd1', 'd2']),
      jogo('g6', ['b1', 'b2', 'c1p', 'c2p']),
    ]
    const { scheduled, unscheduled } = scheduleMatches(jogos, dias)
    expect(unscheduled).toHaveLength(0)
    expect(findConflicts(scheduled)).toHaveLength(0)
  })

  it('nunca marca a mesma pessoa em dois jogos à mesma hora, mesmo em categorias diferentes', () => {
    const jogos = [
      jogo('m1', ['rui', 'pedro']),
      { ...jogo('m2', ['rui', 'marta']), categoryId: 'MX4' },
    ]
    const { scheduled } = scheduleMatches(jogos, dias)
    const [a, b] = scheduled
    expect(a.startsAt).not.toEqual(b.startsAt)
    expect(findConflicts(scheduled)).toHaveLength(0)
  })

  it('nunca dá 3 jogos seguidos à mesma pessoa (o caso do print 10)', () => {
    const jogos = [
      jogo('j1', ['rui', 'p1']),
      { ...jogo('j2', ['rui', 'p2']), categoryId: 'MX4' },
      { ...jogo('j3', ['rui', 'p3']), categoryId: 'F4' },
    ]
    const { scheduled } = scheduleMatches(jogos, dias)
    const doRui = scheduled.filter((m) => m.players.includes('rui')).sort((a, b) => a.startsAt - b.startsAt)
    expect(doRui).toHaveLength(3)
    expect(longestRun(doRui)).toBeLessThanOrEqual(2)
    // O terceiro fica com uma hora de descanso pelo meio.
    expect(hhmm(doRui[2].startsAt)).toBe('13:00')
  })

  it('a fase seguinte só começa depois de acabada a anterior', () => {
    const jogos = [
      jogo('grupo1', ['a1', 'a2', 'b1', 'b2']),
      jogo('grupo2', ['c1p', 'c2p', 'd1', 'd2']),
      { ...jogo('qf1', ['a1', 'a2', 'c1p', 'c2p']), stage: 'QF', groupId: null },
    ]
    const { scheduled } = scheduleMatches(jogos, dias)
    const ultimoGrupo = Math.max(...scheduled.filter((m) => m.stage === 'grupo').map((m) => m.endsAt.getTime()))
    const quartos = scheduled.find((m) => m.stage === 'QF')
    expect(quartos.startsAt.getTime()).toBeGreaterThanOrEqual(ultimoGrupo)
  })

  it('diz quais ficaram por marcar quando não há horas que cheguem', () => {
    const curto = [dia('2026-10-10', '10:00', '12:00', ['c1'])] // 2 lugares
    const jogos = [jogo('x1', ['a']), jogo('x2', ['b']), jogo('x3', ['c'])]
    const { scheduled, unscheduled } = scheduleMatches(jogos, curto)
    expect(scheduled).toHaveLength(2)
    expect(unscheduled.map((m) => m.id)).toEqual(['x3'])
  })
})

describe('choques num horário feito à mão', () => {
  it('apanha o campo ocupado e as duas pessoas à mesma hora', () => {
    const scheduled = [
      marcado('a', ['rui', 'pedro'], '10:00', 'c1'),
      marcado('b', ['rui', 'marta'], '10:00', 'c1'),
    ]
    const kinds = findConflicts(scheduled).map((p) => p.kind).sort()
    expect(kinds).toEqual(['campo_ocupado', 'dois_jogos_a_mesma_hora'])
  })

  it('apanha os 3 jogos seguidos do Rui (10:00, 11:00, 12:00)', () => {
    const scheduled = [
      marcado('a', ['rui'], '10:00', 'c1'),
      marcado('b', ['rui'], '11:00', 'c1'),
      marcado('c', ['rui'], '12:00', 'c1'),
    ]
    const problema = findConflicts(scheduled).find((p) => p.kind === 'jogos_seguidos')
    expect(problema).toMatchObject({ player: 'rui', count: 3 })
  })

  it('dois jogos seguidos são permitidos', () => {
    const scheduled = [
      marcado('a', ['rui'], '10:00', 'c1'),
      marcado('b', ['rui'], '11:00', 'c1'),
    ]
    expect(findConflicts(scheduled)).toHaveLength(0)
  })

  it('canPlace recusa pôr alguém a jogar em dois sítios à mesma hora', () => {
    const scheduled = [marcado('a', ['rui'], '10:00', 'c1')]
    const candidato = { ...jogo('b', ['rui']), court: 'c2', startsAt: at('10:00'), endsAt: at('11:00') }
    expect(canPlace(candidato, scheduled)).toBe(false)
  })
})

describe('antecipar quando um campo fica livre mais cedo (print 10)', () => {
  // Campo 3 livre às 15:35; os jogos seguintes estão às 16:00, 17:00 e 18:00.
  const scheduled = [
    marcado('q1', ['barros', 'costa'], '16:00', 'c3', { stage: 'QF', categoryId: 'M5', groupId: null }),
    marcado('s1', ['tapia', 'barao'], '17:00', 'c3', { stage: 'SF', categoryId: 'F4', groupId: null }),
    marcado('q2', ['silva', 'lopes'], '18:00', 'c3', { stage: 'QF', categoryId: 'MX4', groupId: null }),
  ]

  it('propõe puxar os três jogos para trás, com o aviso mínimo cumprido', () => {
    const { moves, blocked } = proposeEarlier(scheduled, {
      court: 'c3', freeAt: at('15:35'), now: at('15:00'),
    })
    expect(blocked).toHaveLength(0)
    expect(moves.map((m) => hhmm(m.to))).toEqual(['15:35', '16:35', '17:35'])
    expect(moves[0].minutesEarlier).toBe(25)
    expect(moves[0].playersNotifiedNow).toBe(35) // faltam 35 min; mínimo 30
  })

  it('recusa quando o aviso é menor do que 30 min', () => {
    const { moves, blocked } = proposeEarlier(scheduled, {
      court: 'c3', freeAt: at('15:35'), now: at('15:20'), // só 15 min de aviso
    })
    expect(moves).toHaveLength(0)
    expect(blocked[0]).toMatchObject({ id: 'q1', reason: 'aviso_curto', noticeMin: 15 })
  })

  it('"começar já" salta o aviso mínimo, mas só para o primeiro jogo', () => {
    const { moves, blocked } = proposeEarlier(scheduled, {
      court: 'c3', freeAt: at('15:35'), now: at('15:20'), startNow: true,
    })
    expect(moves.map((m) => m.id)).toEqual(['q1', 's1', 'q2'])
    expect(hhmm(moves[0].to)).toBe('15:35')
    expect(blocked).toHaveLength(0)
  })

  it('não antecipa se isso puser alguém a jogar em dois sítios ao mesmo tempo', () => {
    const comChoque = [
      ...scheduled,
      // O Silva está a jogar no Campo 1 das 17:00 às 18:00 (o caso do Pedro
      // Lima no print 10: quem joga em duas categorias trava a antecipação).
      marcado('mx1', ['silva', 'pedro'], '17:00', 'c1', { categoryId: 'MX4', groupId: null, stage: 'QF' }),
    ]
    const { moves, blocked } = proposeEarlier(comChoque, {
      court: 'c3', freeAt: at('15:35'), now: at('15:00'),
    })
    // O jogo do Silva no Campo 3 subiria para as 17:35 e apanhava-o ainda
    // dentro do jogo do Campo 1.
    expect(blocked.some((b) => b.id === 'q2' && b.reason === 'choque')).toBe(true)
    expect(moves.every((m) => m.id !== 'q2')).toBe(true)
  })
})

describe('textos do cartão', () => {
  it('a falta só se pode marcar 10 min depois da hora', () => {
    expect(hhmm(walkoverAllowedAt(at('13:00')))).toBe('13:10')
  })

  it('pede para chegar 20 min antes', () => {
    expect(hhmm(arriveAt(at('13:00')))).toBe('12:40')
  })

  it('os valores são os pré-definidos do desenho', () => {
    expect(SCHEDULE_DEFAULTS).toMatchObject({
      durationMaxMin: 60, maxConsecutive: 2, minNoticeMin: 30, arriveBeforeMin: 20, toleranceMin: 10,
    })
  })
})
