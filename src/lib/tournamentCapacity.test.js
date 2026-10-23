import { describe, it, expect } from 'vitest'
import {
  defaultMaxDuration, dayMinutes, dayCourtHours, groupRounds, optionRounds, categoryNeed,
  evaluateDay, evaluateTournament, maxTeamsFor, dayShortcuts, DAY_STATUS,
} from './tournamentCapacity'

const rules = { duration_max: 45, scoring: 'pro_set_9' }
const friday = { date: '2026-11-13', starts_at: '18:00', ends_at: '23:00', courts: 2 }
const cat = (code, slots, day = friday.date, extra = {}) => ({ code, slots, day, ...extra })

describe('duração máxima por omissão (FPP, Anexo XIX)', () => {
  it('ponto de ouro por omissão: pro set 45, 2 sets 65, 3 sets 100', () => {
    expect(defaultMaxDuration('pro_set_9')).toBe(45)
    expect(defaultMaxDuration('melhor_2_sets')).toBe(65)
    expect(defaultMaxDuration('melhor_3_sets')).toBe(100)
  })
  it('Star Point e vantagens demoram mais', () => {
    expect(defaultMaxDuration('pro_set_9', { deuce: 'star_point' })).toBe(50)
    expect(defaultMaxDuration('melhor_3_sets', { deuce: 'vantagens' })).toBe(120)
  })
  it('pro set com super tie-break aos 8-8: +5 min', () => {
    expect(defaultMaxDuration('pro_set_9', { tiebreak88: 'super_tiebreak' })).toBe(50)
    expect(defaultMaxDuration('melhor_2_sets', { tiebreak88: 'super_tiebreak' })).toBe(65)
  })
})

describe('tempo de campo do dia', () => {
  it('«2 campos · 18h às 23h · 10 h»', () => {
    expect(dayMinutes(friday)).toBe(300)
    expect(dayCourtHours(friday)).toBe(10)
  })
  it('fim igual ou antes do início é erro: 0 h', () => {
    expect(dayMinutes({ ...friday, ends_at: '18:00' })).toBeNull()
    expect(dayCourtHours({ ...friday, ends_at: '17:00' })).toBe(0)
  })
})

describe('quanto precisa cada categoria', () => {
  it('rondas de um grupo: n−1 se par, n se ímpar', () => {
    expect(groupRounds(4)).toBe(3)
    expect(groupRounds(5)).toBe(5)
  })
  it('3 duplas ou menos: um grupo só', () => {
    const need = categoryNeed(3, { maxDurationMin: 45 })
    expect(need.option.kind).toBe('grupo_unico')
    expect(need.matches).toBe(3)
    expect(need.guaranteed).toBe(2)
  })
  it('4 e 5 duplas: um grupo só, nunca «só eliminatória» (BA, 23 out)', () => {
    for (const n of [4, 5]) {
      const need = categoryNeed(n, { maxDurationMin: 45, availableHours: 20 })
      expect(need.option.kind).toBe('grupo_unico')
      expect(need.guaranteed).toBe(n - 1)
      expect(need.rounds).toBe(groupRounds(n))
    }
  })
  it('6 e 7 duplas: o grupo só compara-se com os outros formatos', () => {
    // Com tempo: o grupo de 6 dá 5 jogos garantidos, 2 grupos de 3 só 2.
    expect(categoryNeed(6, { maxDurationMin: 45, availableHours: 20 }).option.kind).toBe('grupo_unico')
    // Sem tempo para 15 jogos (11,25 h), ganha 2 grupos de 3.
    expect(categoryNeed(6, { maxDurationMin: 45, availableHours: 8 }).option.kind).toBe('grupos')
  })
  it('8 duplas ou mais: sem grupo só', () => {
    expect(categoryNeed(8, { maxDurationMin: 45, availableHours: 1000 }).option.kind).not.toBe('grupo_unico')
  })
  it('nunca recomenda «só eliminatória» quando há outra opção (mínimo 2 garantidos)', () => {
    const need = categoryNeed(8, { maxDurationMin: 45, availableHours: 100 })
    expect(need.option.kind).toBe('grupos')
    expect(need.guaranteed).toBeGreaterThanOrEqual(2)
  })
  it('horas arredondadas à hora acima: 13 jogos × 45 min = 9,75 → 10 h', () => {
    const need = categoryNeed(8, { maxDurationMin: 45, availableHours: 10 })
    expect(need.matches).toBe(13)
    expect(need.hours).toBe(10)
  })
  it('rondas = as do maior grupo + as do quadro', () => {
    const need = categoryNeed(16, { maxDurationMin: 45, availableHours: 1000 })
    expect(need.option.key).toBe('grupos-4x4-passam2')
    expect(need.rounds).toBe(3 + 3)
    expect(optionRounds(need.option)).toBe(6)
    expect(need.sequentialMinutes).toBe(270)
  })
})

describe('as duas verificações e a cor do dia', () => {
  it('verde: cabe e sobra 10 % ou mais', () => {
    const day = evaluateDay({ ...friday, courts: 4 }, [cat('M4', 8)], rules)
    expect(day.status).toBe(DAY_STATUS.verde)
    expect(day.courtHours).toBe(20)
    // Com 20 h, passam 2 de cada grupo: 12 + 3 jogos = 11,25 → 12 h.
    expect(day.categories[0].need.option.key).toBe('grupos-2x4-passam2')
    expect(day.hoursNeeded).toBe(12)
    expect(day.shortcuts).toEqual([])
  })
  it('âmbar: cabe mas sobra menos de 10 %', () => {
    const day = evaluateDay(friday, [cat('M4', 8)], rules)
    expect(day.status).toBe(DAY_STATUS.ambar)
    expect(day.spare).toBe(0)
  })
  it('vermelho por horas: faltam horas de campo, com o «Cabem até N» e os atalhos que resolvem', () => {
    const day = evaluateDay(friday, [cat('M4', 16)], rules)
    expect(day.status).toBe(DAY_STATUS.vermelho)
    expect(day.failing).toBe('horas')
    expect(day.missing).toBe(11)
    const n = day.categories[0].maxTeams
    expect(n).toBeGreaterThanOrEqual(4)
    expect(evaluateDay(friday, [cat('M4', n)], rules).status).not.toBe(DAY_STATUS.vermelho)
    expect(evaluateDay(friday, [cat('M4', n + 1)], rules).status).toBe(DAY_STATUS.vermelho)
    expect(day.shortcuts).toContainEqual({ kind: 'vagas', code: 'M4', teams: n })
    // Mais 1 campo (3 campos, 15 h) não chega para 21 h: não aparece.
    expect(day.shortcuts.some((s) => s.kind === 'campo')).toBe(false)
  })
  it('vermelho por fases (exemplo da BA): 4 campos das 18h às 21h dão 12 h, mas 5 rondas de 45 min não cabem em 3 h', () => {
    const day = evaluateDay({ ...friday, ends_at: '21:00', courts: 4 }, [cat('M3', 12)], rules)
    expect(day.courtHours).toBe(12)
    expect(day.hoursNeeded).toBeLessThanOrEqual(12)
    expect(day.sequentialMinutes).toBe(225)
    expect(day.status).toBe(DAY_STATUS.vermelho)
    expect(day.failing).toBe('fases')
    // Mais campos não encurtam as fases.
    expect(day.shortcuts.some((s) => s.kind === 'campo')).toBe(false)
    expect(day.shortcuts).toContainEqual({ kind: 'inicio', startsAt: '17:00' })
  })
  it('âmbar quando as fases passam com menos de uma ronda de folga', () => {
    // 4 grupos de 3, passa 1: 3 rondas + 2 do quadro = 5 rondas = 225 min em
    // 240. Passarem 2 (6 rondas, 270 min) já não caberia: não é escolhido.
    const day = evaluateDay({ ...friday, ends_at: '22:00', courts: 6 }, [cat('M3', 12)], rules)
    expect(day.sequentialMinutes).toBe(225)
    expect(day.status).toBe(DAY_STATUS.ambar)
  })
  it('«Mais 1 campo» só quando resolve', () => {
    const day = { ...friday, courts: 1 }
    const shortcuts = dayShortcuts(day, [cat('M4', 8)], rules)
    expect(shortcuts).toContainEqual({ kind: 'campo', courts: 2 })
  })
  it('«Começar às Xh»: a hora certa mais tarde que resolve, nunca antes das 8h', () => {
    const day = { ...friday, starts_at: '18:30' }
    const s = dayShortcuts(day, [cat('M4', 9)], rules).find((x) => x.kind === 'inicio')
    expect(s.startsAt).toBe('18:00')
    const never = dayShortcuts({ ...friday, courts: 1 }, [cat('M4', 64)], rules)
    expect(never.some((x) => x.kind === 'inicio')).toBe(false)
  })
  it('com duas categorias no dia, o «Cabem até N» de uma conta com a outra como está', () => {
    const cats = [cat('M4', 8), cat('M3', 4)]
    const big = { ...friday, courts: 4 }
    const alone = maxTeamsFor(big, [cat('M4', 8)], rules, 'M4')
    const shared = maxTeamsFor(big, cats, rules, 'M4')
    expect(shared).toBeLessThan(alone)
    const day = evaluateDay(big, cats, rules)
    expect(day.categories.map((c) => c.code)).toEqual(['M4', 'M3'])
    expect(day.hoursNeeded).toBe(day.categories[0].need.hours + day.categories[1].need.hours)
  })
  it('jogo do 3.º lugar conta como jogo, não como ronda', () => {
    const plain = categoryNeed(16, { maxDurationMin: 45, availableHours: 1000 })
    const third = categoryNeed(16, { maxDurationMin: 45, availableHours: 1000, thirdPlaceMatch: true })
    expect(third.matches).toBe(plain.matches + 1)
    expect(third.rounds).toBe(plain.rounds)
  })
})

describe('o torneio todo', () => {
  it('soma as vagas e as horas, e a cor é a do pior dia', () => {
    const saturday = { date: '2026-11-14', starts_at: '09:00', ends_at: '20:00', courts: 4 }
    const result = evaluateTournament([friday, saturday], [cat('M4', 16), cat('M3', 8, saturday.date), cat('F4', 8, null)], rules)
    expect(result.teams).toBe(32)
    expect(result.courtHours).toBe(10 + 44)
    expect(result.status).toBe(DAY_STATUS.vermelho)
    expect(result.worstDate).toBe(friday.date)
    expect(result.withoutDay).toEqual(['F4'])
    expect(result.days[1].status).toBe(DAY_STATUS.verde)
  })
  it('sem dias, não há cor', () => {
    expect(evaluateTournament([], [], rules).status).toBeNull()
  })
})
