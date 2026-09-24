import { describe, it, expect } from 'vitest'
import {
  TOURNAMENT_STATUS, canDelete, categoryCode, courtHours, levelFromRating,
  nextStatus, previousStatus, stepProblem, totalCourtHours, totalSlots, pricePerPlayer, localInputToIso, isoToLocalInput } from './tournaments'

const day = (o) => ({ date: '2026-10-09', starts_at: '18:00', ends_at: '23:00', courts: 4, ...o })

describe('horas de campo (print 07, passo 2)', () => {
  it('conta (fim − início) × campos', () => {
    expect(courtHours(day())).toBe(20)                                   // sex 18-23, 4 campos
    expect(courtHours(day({ starts_at: '09:00', ends_at: '21:00' }))).toBe(48) // sáb, 4 campos
    expect(courtHours(day({ starts_at: '09:00', ends_at: '18:00', courts: 3 }))).toBe(27)
  })
  it('o total dos três dias do desenho dá 95 h', () => {
    expect(totalCourtHours([
      day(),
      day({ starts_at: '09:00', ends_at: '21:00' }),
      day({ starts_at: '09:00', ends_at: '18:00', courts: 3 }),
    ])).toBe(95)
  })
  it('horas ao contrário ou sem campos não contam', () => {
    expect(courtHours(day({ starts_at: '21:00', ends_at: '09:00' }))).toBe(0)
    expect(courtHours(day({ courts: 0 }))).toBe(0)
    expect(courtHours({})).toBe(0)
  })
})

describe('categorias', () => {
  it('o código segue o género e o nível', () => {
    expect(categoryCode('masculino', 5)).toBe('M5')
    expect(categoryCode('feminino', 3)).toBe('F3')
    expect(categoryCode('misto', 4)).toBe('MX4')
  })
  it('soma as vagas de todas as categorias', () => {
    expect(totalSlots([{ slots: 16 }, { slots: 24 }, { slots: '12' }])).toBe(52)
    expect(totalSlots([])).toBe(0)
  })
  it('propõe o nível a partir dos pontos', () => {
    expect(levelFromRating(1900)).toBe(1)
    expect(levelFromRating(1100)).toBe(5)
    expect(levelFromRating(600)).toBe(7)
  })
})

describe('estados do torneio', () => {
  it('avança até às inscrições fechadas e não mais', () => {
    expect(TOURNAMENT_STATUS[0]).toBe('rascunho')
    expect(nextStatus('rascunho')).toBe('inscricoes')
    expect(nextStatus('inscricoes')).toBe('fechado')
    expect(nextStatus('fechado')).toBe(null)
    expect(nextStatus('sorteado')).toBe(null)
  })
  it('dá para voltar atrás antes do sorteio', () => {
    expect(previousStatus('inscricoes')).toBe('rascunho')
    expect(previousStatus('fechado')).toBe('inscricoes')
    expect(previousStatus('sorteado')).toBe(null)
  })
  it('só se apaga um rascunho sem inscritos', () => {
    expect(canDelete({ status: 'rascunho', entry_count: 0 })).toBe(true)
    expect(canDelete({ status: 'rascunho', entry_count: 2 })).toBe(false)
    expect(canDelete({ status: 'inscricoes', entry_count: 0 })).toBe(false)
  })
})

describe('o que falta em cada passo', () => {
  const draft = {
    name: 'Smash Open 2026',
    days: [day({ date: '2026-10-09' }), day({ date: '2026-10-10' })],
    entries_close_at: '2026-10-05T23:59',
    draw_at: '2026-10-07',
    categories: [{ code: 'M5', slots: 16, day: '2026-10-09' }],
  }

  // A ordem mudou a 23 set («#342»): 1 Pessoas · 2 Quando · 3 Onde joga.
  it('deixa avançar quando está tudo preenchido', () => {
    expect(stepProblem(1, draft)).toBe(null)
    expect(stepProblem(2, draft)).toBe(null)
    expect(stepProblem(3, draft)).toBe(null)
  })

  it('passo 1 · Pessoas: o nome e as categorias', () => {
    expect(stepProblem(1, { ...draft, name: '  ' })).toBe('name')
    expect(stepProblem(1, { ...draft, categories: [] })).toBe('categories')
    expect(stepProblem(1, { ...draft, categories: [{ code: 'M5', slots: 1 }] })).toBe('slots')
  })

  it('passo 1 já não pede dias nem prazos — isso é o passo 2', () => {
    // Antes as categorias eram o 3.º passo e os dias o 1.º. Se isto voltar a
    // falhar, é porque alguém repôs a ordem velha.
    expect(stepProblem(1, { ...draft, days: [] })).toBe(null)
    expect(stepProblem(1, { ...draft, entries_close_at: '' })).toBe(null)
  })

  it('passo 2 · Quando: os dias e os prazos', () => {
    expect(stepProblem(2, { ...draft, days: [] })).toBe('days')
    expect(stepProblem(2, { ...draft, entries_close_at: '' })).toBe('deadline')
  })

  it('não deixa as inscrições fecharem depois de o torneio começar', () => {
    expect(stepProblem(2, { ...draft, entries_close_at: '2026-10-10T23:59' })).toBe('deadline_after_start')
    expect(stepProblem(2, { ...draft, draw_at: '2026-10-11' })).toBe('draw_after_start')
  })

  it('passo 3 · Onde joga: horas, campos, e o dia de cada categoria', () => {
    expect(stepProblem(3, { ...draft, days: [day({ courts: 0 })] })).toBe('hours')
    expect(stepProblem(3, { ...draft, days: [day({ starts_at: '23:00', ends_at: '09:00' })] })).toBe('hours_order')
    // A categoria vem do passo 1 sem dia: é aqui, onde os dias existem, que
    // se apanha — senão ficava fora do horário sem ninguém dar por isso.
    expect(stepProblem(3, { ...draft, categories: [{ code: 'M5', slots: 16 }] })).toBe('category_without_day')
  })
})

describe('pricePerPlayer', () => {
  it('parte o preço da dupla ao meio', () => {
    expect(pricePerPlayer(50, 'pt-PT')).toBe('25')
  })

  it('usa a vírgula em português e o ponto em inglês', () => {
    // Era isto que saía errado: «12.50 €» num ecrã em português.
    expect(pricePerPlayer(25, 'pt-PT')).toBe('12,50')
    expect(pricePerPlayer(25, 'en-GB')).toBe('12.50')
  })

  it('não põe casas decimais quando não são precisas', () => {
    expect(pricePerPlayer(30, 'pt-PT')).toBe('15')
  })

  it('aguenta o campo vazio sem escrever disparates', () => {
    expect(pricePerPlayer('', 'pt-PT')).toBe('0')
    expect(pricePerPlayer(undefined, 'pt-PT')).toBe('')
  })
})

describe('prazo das inscrições com fuso (#487)', () => {
  it('a hora escrita no ecrã é hora local, não UTC', () => {
    // O instante tem de ser o mesmo que 5 out 23:59 na hora de quem escreve,
    // seja qual for o fuso da máquina onde o teste corre.
    const esperado = new Date(2026, 9, 5, 23, 59).toISOString()
    expect(localInputToIso('2026-10-05T23:59')).toBe(esperado)
  })

  it('não é o mesmo que tratar a hora como UTC — era esse o erro', () => {
    const comoUtc = new Date('2026-10-05T23:59:00Z').toISOString()
    const offsetMin = new Date(2026, 9, 5, 23, 59).getTimezoneOffset()
    if (offsetMin !== 0) expect(localInputToIso('2026-10-05T23:59')).not.toBe(comoUtc)
  })

  it('ida e volta devolve o que se escreveu', () => {
    expect(isoToLocalInput(localInputToIso('2026-10-05T23:59'))).toBe('2026-10-05T23:59')
    // uma data de inverno (sem hora de verão), para cobrir o outro desvio
    expect(isoToLocalInput(localInputToIso('2026-12-10T21:00'))).toBe('2026-12-10T21:00')
  })

  it('ao editar, mostra na hora local o que veio da base de dados', () => {
    const guardado = new Date(2026, 9, 5, 23, 59).toISOString()
    expect(isoToLocalInput(guardado)).toBe('2026-10-05T23:59')
  })

  it('vazio fica vazio', () => {
    expect(localInputToIso('')).toBe(null)
    expect(isoToLocalInput(null)).toBe('')
    expect(isoToLocalInput('não é data')).toBe('')
  })
})
