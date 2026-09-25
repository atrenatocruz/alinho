import { describe, it, expect } from 'vitest'
import {
  seedOrder, qualifierLabels, buildBracketSkeleton, buildDrawPayload, buildKnockoutPayload,
  bracketRounds, byDayAndTime, standingsOf, qualifiersPerGroup, qualifiedFromGroups,
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

  // Trello #484 — as duas regras do quadro, em todos os formatos com grupos
  // que a app oferece (2 a 8 grupos, passam 1 ou 2).
  const grupoDe = (texto) => texto.slice(texto.indexOf('Grupo'))
  const primeiraRonda = (bracket) => {
    const nome = bracket[0]?.round
    return bracket.filter((m) => m.round === nome && m.source_a.includes('Grupo') && m.source_b.includes('Grupo'))
  }
  // Metade do quadro onde cai cada lugar: pela posição na 1.ª ronda, ou,
  // para os isentos, pela posição na 2.ª.
  // Quantos jogos tem cada ronda num quadro cheio — a 1.ª ronda pode ter
  // menos (os isentos não jogam), mas os números dos jogos contam como se
  // estivessem todos.
  const jogosNaRonda = { R32: 16, R16: 8, QF: 4, SF: 2, F: 1 }
  const metades = (bracket) => {
    const onde = new Map()
    const rondas = [...new Set(bracket.map((m) => m.round))]
    for (const [r, nome] of rondas.entries()) {
      const jogos = bracket.filter((m) => m.round === nome)
      const total = jogosNaRonda[nome]
      if (total < 2) break
      for (const m of jogos) {
        const metade = m.slot <= total / 2 ? 'cima' : 'baixo'
        for (const s of [m.source_a, m.source_b]) {
          if (s.includes('Grupo') && !onde.has(s)) onde.set(s, metade)
        }
      }
      if (r > 1) break
    }
    return onde
  }

  it('3 grupos, passam 2: o 1.º e o 2.º do mesmo grupo nunca jogam na 1.ª ronda (#484)', () => {
    const bracket = buildBracketSkeleton(grupos(3), 2)
    for (const m of primeiraRonda(bracket)) {
      expect(grupoDe(m.source_a)).not.toBe(grupoDe(m.source_b))
    }
  })

  it('4 grupos, passam 2: o 1.º e o 2.º do mesmo grupo ficam em metades opostas (#484)', () => {
    const onde = metades(buildBracketSkeleton(grupos(4), 2))
    for (const g of ['A', 'B', 'C', 'D']) {
      expect(onde.get(`1.º do Grupo ${g}`)).toBeDefined()
      expect(onde.get(`1.º do Grupo ${g}`)).not.toBe(onde.get(`2.º do Grupo ${g}`))
    }
  })

  it('em todos os formatos com grupos, as duas regras valem ao mesmo tempo (#484)', () => {
    for (let n = 2; n <= 8; n++) {
      for (const passam of [1, 2]) {
        const bracket = buildBracketSkeleton(grupos(n), passam)
        if (!bracket.length) continue
        for (const m of primeiraRonda(bracket)) {
          expect(grupoDe(m.source_a), `${n} grupos, passam ${passam}`).not.toBe(grupoDe(m.source_b))
        }
        if (passam === 2) {
          const onde = metades(bracket)
          for (let g = 0; g < n; g++) {
            const letra = String.fromCharCode(65 + g)
            expect(onde.get(`1.º do Grupo ${letra}`), `${n} grupos: metade do 1.º do ${letra}`)
              .not.toBe(onde.get(`2.º do Grupo ${letra}`))
          }
        }
        // Todos os apurados aparecem uma e uma só vez.
        const lugares = bracket.flatMap((m) => [m.source_a, m.source_b]).filter((s) => s.includes('Grupo'))
        expect(new Set(lugares).size, `${n} grupos, passam ${passam}`).toBe(n * passam)
        expect(lugares).toHaveLength(n * passam)
      }
    }
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

  it('o calendário conta o dia e a hora em Portugal, venha o aparelho de onde vier', () => {
    // 23:30 em UTC a 9 out = 00:30 de sábado, 10 out, em Lisboa (verão).
    const dias = byDayAndTime([{ id: 'a', scheduled_at: '2026-10-09T23:30:00.000Z', court_name: 'Campo 1' }])
    expect(dias[0].date).toBe('2026-10-10')
    expect(dias[0].slots[0].time).toBe('00:30')
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

  it('um jogo a decorrer, com resultado já escrito, ainda não conta para a tabela (#484)', () => {
    const group = { id: 'g1', teams: ['a', 'b'] }
    const aDecorrer = [
      { stage: 'grupo', group_id: 'g1', entry_a_id: 'a', entry_b_id: 'b', score_a: 3, score_b: 1, status: 'a_decorrer' },
    ]
    expect(standingsOf(group, aDecorrer).every((r) => r.played === 0)).toBe(true)
  })

  it('desistência com o resultado empatado: a tabela lê o vencedor gravado (#484)', () => {
    const group = { id: 'g1', teams: ['a', 'b'] }
    const desistencia = [
      { stage: 'grupo', group_id: 'g1', entry_a_id: 'a', entry_b_id: 'b', score_a: 3, score_b: 3,
        status: 'desistencia', winner_entry_id: 'a' },
    ]
    expect(standingsOf(group, desistencia)[0]).toMatchObject({ id: 'a', wins: 1 })
  })
})

describe('quem passa dos grupos para o quadro (#484)', () => {
  const gruposComJogos = () => {
    const groups = [
      { id: 'gA', number: 1, name: 'Grupo A', teams: ['a1', 'a2', 'a3'] },
      { id: 'gB', number: 2, name: 'Grupo B', teams: ['b1', 'b2', 'b3'] },
    ]
    const jogo = (g, x, y, sx, sy) => ({
      stage: 'grupo', group_id: g, entry_a_id: x, entry_b_id: y, score_a: sx, score_b: sy,
      status: 'terminado', winner_entry_id: sx > sy ? x : y,
    })
    const matches = [
      jogo('gA', 'a1', 'a2', 6, 2), jogo('gA', 'a1', 'a3', 6, 3), jogo('gA', 'a2', 'a3', 6, 4),
      jogo('gB', 'b3', 'b1', 6, 1), jogo('gB', 'b3', 'b2', 6, 2), jogo('gB', 'b1', 'b2', 6, 5),
    ]
    return { groups, matches }
  }

  it('dá os lugares com o mesmo texto do sorteio e a dupla certa em cada um', () => {
    const { groups, matches } = gruposComJogos()
    const r = qualifiedFromGroups(groups, matches, 2)
    expect(r.ready).toBe(true)
    expect(r.pending).toBe(0)
    expect(r.qualified.map((q) => [q.label, q.entry_id])).toEqual([
      ['1.º do Grupo A', 'a1'], ['2.º do Grupo A', 'a2'],
      ['1.º do Grupo B', 'b3'], ['2.º do Grupo B', 'b1'],
    ])
    // Os mesmos textos que o sorteio gravou no quadro.
    const doSorteio = new Set(qualifierLabels(groups, 2).map((l) => l.label))
    for (const q of r.qualified) expect(doSorteio.has(q.label)).toBe(true)
  })

  it('com jogos de grupo por acabar, não está pronto e diz quantos faltam', () => {
    const { groups, matches } = gruposComJogos()
    matches[5] = { ...matches[5], status: 'marcado', winner_entry_id: null, score_a: null, score_b: null }
    const r = qualifiedFromGroups(groups, matches, 2)
    expect(r.ready).toBe(false)
    expect(r.pending).toBe(1)
  })

  it('sem empates por resolver, a lista de empates vem vazia', () => {
    const { groups, matches } = gruposComJogos()
    expect(qualifiedFromGroups(groups, matches, 2).ties).toEqual([])
  })

  // Três em ciclo com o mesmo resultado em todos os jogos: nenhum critério
  // os separa, e é o organizador que decide (#484).
  const ciclo = (g, [x, y, z]) => {
    const jogo = (a, b) => ({
      stage: 'grupo', group_id: g, entry_a_id: a, entry_b_id: b, score_a: 6, score_b: 3,
      status: 'terminado', winner_entry_id: a,
    })
    return [jogo(x, y), jogo(y, z), jogo(z, x)]
  }

  it('um empate total que decide quem passa aparece, com os lugares que estão em jogo', () => {
    const groups = [{ id: 'gA', number: 1, name: 'Grupo A', teams: ['a1', 'a2', 'a3'] }]
    const r = qualifiedFromGroups(groups, ciclo('gA', ['a1', 'a2', 'a3']), 2)
    expect(r.ties).toHaveLength(1)
    expect(r.ties[0].group).toBe(1)
    expect(r.ties[0].groupName).toBe('Grupo A')
    expect([...r.ties[0].entry_ids].sort()).toEqual(['a1', 'a2', 'a3'])
    expect(r.ties[0].positions).toEqual([1, 3])
    // Os lugares continuam preenchidos («se ficasse assim»).
    expect(r.qualified).toHaveLength(2)
  })

  it('um empate só entre quem já não passa não aparece', () => {
    const groups = [{ id: 'gA', number: 1, name: 'Grupo A', teams: ['a1', 'a2', 'a3', 'a4'] }]
    const ganha = (b) => ({
      stage: 'grupo', group_id: 'gA', entry_a_id: 'a1', entry_b_id: b, score_a: 6, score_b: 0,
      status: 'terminado', winner_entry_id: 'a1',
    })
    const matches = [ganha('a2'), ganha('a3'), ganha('a4'), ...ciclo('gA', ['a2', 'a3', 'a4'])]
    // Passa 1: o empate é do 2.º ao 4.º, ninguém dele passa.
    expect(qualifiedFromGroups(groups, matches, 1).ties).toEqual([])
    // Passam 2: o mesmo empate decide o 2.º lugar.
    const r = qualifiedFromGroups(groups, matches, 2)
    expect(r.ties).toHaveLength(1)
    expect(r.ties[0].positions).toEqual([2, 4])
    expect(r.qualified[0].entry_id).toBe('a1')
  })
})

describe('peças dos separadores (continuação)', () => {

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

describe('o 3.º lugar não pode ficar pendurado', () => {
  // Com 3 apurados há 3 duplas num quadro de 4: o melhor primeiro vai direto
  // à final e joga-se UMA meia-final. Pedir o 3.º/4.º lugar aí deixava no
  // quadro um jogo à espera do «perdedor da 1.ª meia-final» — uma meia que
  // não existe — e que não havia como fechar. Acontece com 3 grupos a passar
  // 1, que é uma opção real a partir de 9 duplas.
  it('3 grupos a passar 1: uma só meia-final, logo sem jogo de 3.º lugar', () => {
    expect(buildBracketSkeleton(grupos(3), 1).filter((m) => m.round === 'SF')).toHaveLength(1)
    const p = buildDrawPayload(duplas(9), { groupCount: 3, perGroup: 1, thirdPlace: true })
    expect(p.bracket.filter((m) => m.round === 'SF')).toHaveLength(1)
    expect(p.third_place).toBe(false)
  })

  it('11 duplas em 3 grupos a passar 1 — o caso que a app oferece a sério', () => {
    const p = buildDrawPayload(duplas(11), { groupCount: 3, perGroup: 1, thirdPlace: true })
    expect(p.third_place).toBe(false)
  })

  it('com as duas meias-finais, o 3.º lugar continua a existir', () => {
    // 4 grupos a passar 2 (o formato do desenho) e 4 grupos a passar 1.
    expect(buildDrawPayload(duplas(16), { groupCount: 4, perGroup: 2, thirdPlace: true }).third_place).toBe(true)
    expect(buildDrawPayload(duplas(16), { groupCount: 4, perGroup: 1, thirdPlace: true }).third_place).toBe(true)
    // E continua a não aparecer quando o organizador não o pediu.
    expect(buildDrawPayload(duplas(16), { groupCount: 4, perGroup: 2 }).third_place).toBe(false)
  })
})
