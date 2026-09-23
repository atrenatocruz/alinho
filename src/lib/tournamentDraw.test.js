import { describe, it, expect } from 'vitest'
import {
  seedOrder, qualifierLabels, buildBracketSkeleton, buildDrawPayload, buildKnockoutPayload,
  bracketRounds, byDayAndTime, standingsOf, qualifiersPerGroup,
} from './tournamentDraw'

const grupos = (n) => Array.from({ length: n }, (_, i) => ({
  number: i + 1, name: `Grupo ${String.fromCharCode(65 + i)}`,
}))

const duplas = (n) => Array.from({ length: n }, (_, i) => ({
  id: `e${i + 1}`, name: `Dupla ${i + 1}`, points: 2000 - i * 10,
}))

describe('ordem do quadro', () => {
  it('o 1.º e o 2.º só se encontram na final', () => {
    // Lidos dois a dois, são os jogos da 1.ª ronda: 1-4 e 2-3 num quadro de
    // quatro. O 1.º e o 2.º ficam em metades opostas.
    expect(seedOrder(2)).toEqual([1, 2])
    expect(seedOrder(4)).toEqual([1, 4, 2, 3])
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6])
  })

  it('o melhor apanha sempre o pior da ronda, em qualquer tamanho', () => {
    for (const size of [2, 4, 8, 16, 32]) {
      const order = seedOrder(size)
      expect(order).toHaveLength(size)
      expect(new Set(order).size).toBe(size)
      // Cada jogo da 1.ª ronda soma sempre o mesmo: 1+size, 2+(size-1)…
      for (let i = 0; i < size; i += 2) {
        expect(order[i] + order[i + 1]).toBe(size + 1)
      }
    }
  })
})

describe('os lugares que saem dos grupos', () => {
  it('primeiro todos os 1.os, depois todos os 2.os', () => {
    const labels = qualifierLabels(grupos(4), 2).map((l) => l.label)
    expect(labels).toEqual([
      '1.º do Grupo A', '1.º do Grupo B', '1.º do Grupo C', '1.º do Grupo D',
      '2.º do Grupo A', '2.º do Grupo B', '2.º do Grupo C', '2.º do Grupo D',
    ])
  })
})

describe('quadro vazio, em texto', () => {
  it('4 grupos, passam 2: quartos, meias e final — 7 jogos', () => {
    const bracket = buildBracketSkeleton(grupos(4), 2)
    expect(bracket).toHaveLength(7)
    expect(bracket.filter((m) => m.round === 'QF')).toHaveLength(4)
    expect(bracket.filter((m) => m.round === 'SF')).toHaveLength(2)
    expect(bracket.filter((m) => m.round === 'F')).toHaveLength(1)
  })

  it('o 1.º do A nunca apanha o 2.º do A na primeira ronda', () => {
    const qf = buildBracketSkeleton(grupos(4), 2).filter((m) => m.round === 'QF')
    for (const m of qf) {
      const grupoA = m.source_a.slice(m.source_a.indexOf('Grupo'))
      const grupoB = m.source_b.slice(m.source_b.indexOf('Grupo'))
      expect(grupoA).not.toBe(grupoB)
    }
  })

  it('o 1.º do A e o 1.º do B ficam em metades opostas (só se encontram na final)', () => {
    const qf = buildBracketSkeleton(grupos(4), 2).filter((m) => m.round === 'QF')
    const onde = (texto) => qf.findIndex((m) => m.source_a === texto || m.source_b === texto)
    const metade = (i) => (i < 2 ? 'cima' : 'baixo')
    expect(metade(onde('1.º do Grupo A'))).not.toBe(metade(onde('1.º do Grupo B')))
  })

  it('as rondas seguintes dizem de onde vem cada dupla', () => {
    const bracket = buildBracketSkeleton(grupos(4), 2)
    const meia1 = bracket.find((m) => m.round === 'SF' && m.slot === 1)
    expect(meia1.source_a).toBe('Vencedor dos quartos 1')
    expect(meia1.source_b).toBe('Vencedor dos quartos 2')
    const final = bracket.find((m) => m.round === 'F')
    expect(final.source_a).toBe('Vencedor das meias 1')
    expect(final.source_b).toBe('Vencedor das meias 2')
  })

  it('4 grupos, passa 1: meias e final — 3 jogos', () => {
    const bracket = buildBracketSkeleton(grupos(4), 1)
    expect(bracket).toHaveLength(3)
    expect(bracket.filter((m) => m.round === 'SF')).toHaveLength(2)
  })

  it('com lugares a mais, os melhores ficam isentos e aparecem já na ronda seguinte', () => {
    // 3 grupos, passam 2 = 6 apurados num quadro de 8: 2 isentos.
    const bracket = buildBracketSkeleton(grupos(3), 2)
    const qf = bracket.filter((m) => m.round === 'QF')
    expect(qf).toHaveLength(2) // dois jogos, não quatro
    const sf = bracket.filter((m) => m.round === 'SF')
    const isentos = sf.flatMap((m) => [m.source_a, m.source_b]).filter((s) => s.startsWith('1.º'))
    expect(isentos).toEqual(['1.º do Grupo A', '1.º do Grupo B'])
  })

  it('menos de duas duplas não faz quadro nenhum', () => {
    expect(buildBracketSkeleton(grupos(1), 1)).toEqual([])
  })
})

describe('o que vai para o servidor', () => {
  const payload = buildDrawPayload(duplas(16), { groupCount: 4, perGroup: 2, thirdPlace: true })

  it('16 duplas em 4 grupos de 4, sem ninguém a faltar nem repetido', () => {
    expect(payload.groups).toHaveLength(4)
    const todas = payload.groups.flatMap((g) => g.teams)
    expect(todas).toHaveLength(16)
    expect(new Set(todas).size).toBe(16)
  })

  it('24 jogos de grupo — todos contra todos dentro de cada grupo', () => {
    expect(payload.group_matches).toHaveLength(24)
    expect(payload.group_matches.every((m) => m.a && m.b && m.a !== m.b)).toBe(true)
  })

  it('as 4 cabeças de série são as 4 de mais pontos, uma por grupo', () => {
    expect(payload.seeds).toEqual(['e1', 'e2', 'e3', 'e4'])
    for (const id of payload.seeds) {
      const grupo = payload.groups.filter((g) => g.teams.includes(id))
      expect(grupo).toHaveLength(1)
    }
    const numeros = payload.seeds.map((id) => payload.groups.findIndex((g) => g.teams.includes(id)))
    expect(new Set(numeros).size).toBe(4)
  })

  it('o admin pode trocar as cabeças de série à mão', () => {
    const escolhidas = [duplas(16)[5], duplas(16)[6], duplas(16)[7], duplas(16)[8]]
    const meu = buildDrawPayload(duplas(16), { groupCount: 4, seeds: escolhidas })
    expect(meu.seeds).toEqual(['e6', 'e7', 'e8', 'e9'])
  })

  it('o mesmo sorteio repetido dá o mesmo resultado; outro número dá outro', () => {
    const a = buildDrawPayload(duplas(16), { groupCount: 4, seed: 7 })
    const b = buildDrawPayload(duplas(16), { groupCount: 4, seed: 7 })
    const c = buildDrawPayload(duplas(16), { groupCount: 4, seed: 8 })
    expect(a.groups).toEqual(b.groups)
    expect(a.groups).not.toEqual(c.groups)
  })

  it('leva o 3.º e 4.º lugar quando o admin o liga', () => {
    expect(payload.third_place).toBe(true)
    expect(buildDrawPayload(duplas(16), { groupCount: 4 }).third_place).toBe(false)
  })

  it('18 duplas em 4 grupos dão 5+5+4+4, como no desenho', () => {
    const p = buildDrawPayload(duplas(18), { groupCount: 4 })
    expect(p.groups.map((g) => g.teams.length)).toEqual([5, 5, 4, 4])
  })
})

describe('peças dos separadores', () => {
  it('as rondas do quadro saem pela ordem certa, com o 3.º lugar no fim', () => {
    const matches = [
      { id: '1', stage: 'principal', round: 'F', bracket_slot: 1 },
      { id: '2', stage: 'principal', round: 'QF', bracket_slot: 2 },
      { id: '3', stage: 'principal', round: 'QF', bracket_slot: 1 },
      { id: '4', stage: '3lugar', round: '3P', bracket_slot: 1 },
    ]
    const rounds = bracketRounds(matches)
    expect(rounds.map((r) => r.round)).toEqual(['QF', 'F', '3P'])
    expect(rounds[0].matches.map((m) => m.id)).toEqual(['3', '2'])
  })

  it('o calendário agrupa por dia e por hora, e deixa de fora quem não tem hora', () => {
    const dias = byDayAndTime([
      { id: 'a', scheduled_at: '2026-10-10T09:00:00.000Z', court_name: 'Campo 2' },
      { id: 'b', scheduled_at: '2026-10-10T09:00:00.000Z', court_name: 'Campo 1' },
      { id: 'c', scheduled_at: '2026-10-11T10:00:00.000Z', court_name: 'Campo 1' },
      { id: 'd', scheduled_at: null, court_name: null },
    ])
    expect(dias).toHaveLength(2)
    expect(dias[0].slots[0].matches.map((m) => m.court_name)).toEqual(['Campo 1', 'Campo 2'])
  })

  it('a classificação de um grupo usa o desempate do plano', () => {
    const group = { id: 'g1', teams: ['a', 'b', 'c'] }
    const matches = [
      { stage: 'grupo', group_id: 'g1', entry_a_id: 'a', entry_b_id: 'b', score_a: 9, score_b: 6 },
      { stage: 'grupo', group_id: 'g1', entry_a_id: 'b', entry_b_id: 'c', score_a: 9, score_b: 2 },
      { stage: 'grupo', group_id: 'g1', entry_a_id: 'a', entry_b_id: 'c', score_a: 9, score_b: 8 },
    ]
    expect(standingsOf(group, matches).map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('sem formato guardado, passam 2 por grupo', () => {
    expect(qualifiersPerGroup(null)).toBe(2)
    expect(qualifiersPerGroup({ format: { qualifiers_per_group: 1 } })).toBe(1)
  })
})

describe('buildKnockoutPayload — só eliminatória (Trello #455)', () => {
  it('3 duplas: a 1.ª fica isenta e espera na final', () => {
    const p = buildKnockoutPayload(duplas(3))
    expect(p.groups).toEqual([])
    const sf = p.bracket.filter((m) => m.round === 'SF')
    expect(sf).toHaveLength(1)
    expect([sf[0].a, sf[0].b].sort()).toEqual(['e2', 'e3'])
    const final = p.bracket.find((m) => m.round === 'F')
    expect(final.a).toBe('e1')
    expect(final.b).toBeNull()
    expect(final.source_b).toMatch(/Vencedor das meias/)
    expect(p.third_place).toBe(false)
  })

  it('4 duplas: 1.ª contra 4.ª e 2.ª contra 3.ª, sem isentos', () => {
    const p = buildKnockoutPayload(duplas(4), { thirdPlace: true })
    const sf = p.bracket.filter((m) => m.round === 'SF')
    expect(sf.map((m) => [m.a, m.b])).toEqual([['e1', 'e4'], ['e2', 'e3']])
    expect(p.bracket.find((m) => m.round === 'F').a).toBeNull()
    expect(p.third_place).toBe(true)
  })

  it('5 e 7 duplas: todas entram, cada uma uma só vez na 1.ª ronda ou isenta', () => {
    for (const n of [5, 7]) {
      const p = buildKnockoutPayload(duplas(n))
      const ids = p.bracket.flatMap((m) => [m.a, m.b]).filter(Boolean)
      expect(new Set(ids).size).toBe(ids.length)
      expect(ids.sort()).toEqual(duplas(n).map((d) => d.id).sort())
      expect(p.bracket.filter((m) => m.round === 'QF')).toHaveLength(n - 4)
    }
  })

  it('menos de 2 duplas não dá quadro', () => {
    expect(buildKnockoutPayload(duplas(1))).toBeNull()
  })
})
