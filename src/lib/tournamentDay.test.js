import { describe, it, expect } from 'vitest'
import { dayKeyInTz, msUntilNextDay, hhmmInTz, TOURNAMENT_TZ, localInputToIso, isoToLocalInput } from './tournamentDay'

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

describe('prazo das inscrições com fuso (#487)', () => {
  // Hora de LISBOA, seja qual for o fuso da máquina ou do telemóvel: a hora
  // de um torneio é a do sítio do torneio. Por isso os valores são exactos.

  it('23:59 de verão em Lisboa é 22:59 UTC', () => {
    expect(localInputToIso('2026-10-05T23:59')).toBe('2026-10-05T22:59:00.000Z')
  })

  it('no inverno Lisboa está em UTC', () => {
    expect(localInputToIso('2026-12-10T21:00')).toBe('2026-12-10T21:00:00.000Z')
  })

  it('era este o erro: tratar a hora escrita como se fosse UTC', () => {
    expect(localInputToIso('2026-10-05T23:59')).not.toBe('2026-10-05T23:59:00.000Z')
  })

  it('ao editar mostra na hora de Lisboa o que veio da base de dados', () => {
    expect(isoToLocalInput('2026-10-05T22:59:00+00:00')).toBe('2026-10-05T23:59')
    // e o que a base de dados guardou mal antes da correção aparece como é:
    // 00:59 do dia seguinte — que é o que o organizador tem de ver para o acertar
    expect(isoToLocalInput('2026-10-05T23:59:00+00:00')).toBe('2026-10-06T00:59')
  })

  it('a mudança de hora: no dia em que os relógios atrasam, o fim do dia continua certo', () => {
    // 25 out 2026 às 23:00 em Lisboa já é inverno (UTC+0)
    expect(localInputToIso('2026-10-25T23:00')).toBe('2026-10-25T23:00:00.000Z')
    // e às 10:00 do dia anterior ainda é verão (UTC+1)
    expect(localInputToIso('2026-10-24T10:00')).toBe('2026-10-24T09:00:00.000Z')
  })

  it('ida e volta devolve o que se escreveu', () => {
    for (const v of ['2026-10-05T23:59', '2026-12-10T21:00', '2026-10-25T23:00']) {
      expect(isoToLocalInput(localInputToIso(v))).toBe(v)
    }
  })

  it('não depende do fuso da máquina: o relógio é o que se lhe passa', () => {
    // Se a conta usasse o fuso da máquina (Lisboa, onde estes testes correm),
    // com Nova Iorque dava o mesmo que com Lisboa. Não dá.
    expect(localInputToIso('2026-10-05T23:59', 'America/New_York')).toBe('2026-10-06T03:59:00.000Z')
    expect(isoToLocalInput('2026-10-06T03:59:00Z', 'America/New_York')).toBe('2026-10-05T23:59')
    expect(localInputToIso('2026-10-05T23:59', 'Asia/Tokyo')).toBe('2026-10-05T14:59:00.000Z')
  })

  it('vazio ou lixo fica vazio', () => {
    expect(localInputToIso('')).toBe(null)
    expect(localInputToIso('amanhã')).toBe(null)
    expect(isoToLocalInput(null)).toBe('')
    expect(isoToLocalInput('não é data')).toBe('')
  })
})
