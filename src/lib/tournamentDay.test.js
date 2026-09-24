import { describe, it, expect } from 'vitest'
import { dayKeyInTz, msUntilNextDay, hhmmInTz, TOURNAMENT_TZ } from './tournamentDay'

describe('dayKeyInTz — o dia como o servidor o conta', () => {
  it('00h30 de sabado em Almada e sabado, nao sexta', () => {
    // 23:30 UTC de sexta = 00:30 de sabado em Lisboa (UTC+1 em outubro).
    expect(dayKeyInTz(new Date('2026-10-09T23:30:00Z'))).toBe('2026-10-10')
  })

  it('23h30 de sexta em Almada ainda e sexta', () => {
    expect(dayKeyInTz(new Date('2026-10-09T22:30:00Z'))).toBe('2026-10-09')
  })

  it('no inverno, com Lisboa em UTC, a meia-noite bate certo', () => {
    expect(dayKeyInTz(new Date('2026-11-10T00:30:00Z'))).toBe('2026-11-10')
    expect(dayKeyInTz(new Date('2026-11-09T23:30:00Z'))).toBe('2026-11-09')
  })

  it('nao depende do fuso do aparelho de quem marca', () => {
    const instante = new Date('2026-10-09T23:30:00Z')
    expect(dayKeyInTz(instante, 'America/Sao_Paulo')).toBe('2026-10-09')
    expect(dayKeyInTz(instante, TOURNAMENT_TZ)).toBe('2026-10-10')
  })

  it('uma data que nao existe nao rebenta', () => {
    expect(dayKeyInTz(new Date('nao e uma data'))).toBe(null)
  })
})

describe('msUntilNextDay — o ecra vira o dia sozinho', () => {
  const minutos = (ms) => Math.round(ms / 60000)

  it('as 23h30 de Lisboa faltam 30 minutos', () => {
    expect(minutos(msUntilNextDay(new Date('2026-10-09T22:30:00Z')))).toBe(30)
  })

  it('logo depois da meia-noite falta quase um dia inteiro', () => {
    expect(minutos(msUntilNextDay(new Date('2026-10-09T23:01:00Z')))).toBe(24 * 60 - 1)
  })

  it('nunca devolve zero — nao entra em ciclo', () => {
    expect(msUntilNextDay(new Date('2026-10-09T22:59:59.500Z'))).toBeGreaterThanOrEqual(1000)
  })

  it('aguenta a noite em que os relogios mudam (25 out 2026, Lisboa recua 1h)', () => {
    // 23h00 de sabado em Lisboa (22:00Z): faltam 60 min ate ao dia 25.
    expect(minutos(msUntilNextDay(new Date('2026-10-24T22:00:00Z')))).toBe(60)
    // Ja no dia 25, a hora a mais nao faz o dia virar mais cedo.
    expect(dayKeyInTz(new Date('2026-10-25T01:30:00Z'))).toBe('2026-10-25')
  })
})

describe('hhmmInTz — a hora como está no pavilhão (#487)', () => {
  it('17:00 UTC em outubro são 18:00 em Lisboa', () => {
    expect(hhmmInTz('2026-10-09T17:00:00+00:00')).toBe('18:00')
  })

  it('não corta texto: aceita qualquer forma de instante', () => {
    expect(hhmmInTz('2026-10-09T18:00:00+01:00')).toBe('18:00')
    expect(hhmmInTz('2026-10-09T17:00:00.000Z')).toBe('18:00')
  })

  it('no inverno, Lisboa é UTC', () => {
    expect(hhmmInTz('2026-11-10T18:00:00Z')).toBe('18:00')
  })

  it('sem hora, ou hora estragada, não mostra nada', () => {
    expect(hhmmInTz(null)).toBe('')
    expect(hhmmInTz('não é hora')).toBe('')
  })
})
