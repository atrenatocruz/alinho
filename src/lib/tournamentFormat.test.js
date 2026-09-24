import { describe, it, expect } from 'vitest'
import {
  groupSizes, possibleGroupCounts, groupMatchCount, groupStageMatchCount,
  guaranteedMatches, nextPowerOfTwo, knockoutMatchCount, knockoutRounds,
  courtHours, availableCourtHours, formatOptions, recommendFormat,
  pickSeeds, drawGroups, groupRoundRobin, groupStandings, headToHeadWins,
  bestOfPosition, buildFirstRound, noSameGroupClash, seededRandom,
  TIEBREAK_DEFAULT,
} from './tournamentFormat'

const teams = (n, points = null) => Array.from({ length: n }, (_, i) => ({
  id: `t${i + 1}`,
  name: `Dupla ${i + 1}`,
  points: points ? points[i] : (n - i) * 100,
}))

describe('divisão em grupos', () => {
  it('reparte tão igual quanto possível — 18 em 4 grupos dá 5+5+4+4 (exemplo do desenho)', () => {
    expect(groupSizes(18, 4)).toEqual([5, 5, 4, 4])
  })

  it('16 duplas em 4 grupos dá 4 grupos de 4 (exemplo do assistente)', () => {
    expect(groupSizes(16, 4)).toEqual([4, 4, 4, 4])
  })

  it('só aceita grupos de 3 a 7 duplas e prefere grupos todos iguais', () => {
    // 18 duplas dividem-se certinho em 3 grupos de 6 ou 6 grupos de 3.
    expect(possibleGroupCounts(18)).toEqual([3, 6])
    // 16 duplas: 4 grupos de 4 (2 grupos de 8 ficam de fora pela regra 3–7).
    expect(possibleGroupCounts(16)).toEqual([4])
    // Com o máximo em 8, já aparece a opção do print 09.
    expect(possibleGroupCounts(16, { max: 8 })).toEqual([2, 4])
    // 11 duplas não dão grupos iguais dentro de 3–7: usa tamanhos desiguais.
    expect(possibleGroupCounts(11)).toEqual([2, 3])
    expect(groupSizes(11, 3)).toEqual([4, 4, 3])
  })

  it('um grupo só não tapa as divisões com mais grupos (Trello #455)', () => {
    // «1 grupo de 7» é uma divisão igual e apagava «2 grupos de 4+3», que é o
    // que um torneio faz — a categoria ficava sem opção de grupos nenhuma e
    // só lhe sobrava «só eliminatória», que o sorteio não sabia fazer.
    expect(possibleGroupCounts(7)).toEqual([2])
    expect(groupSizes(7, 2)).toEqual([4, 3])
    expect(possibleGroupCounts(6)).toEqual([2])
    // 3, 4 e 5 duplas não dão dois grupos dentro de 3–7 (dariam grupos de 2):
    // fica o grupo único, e por isso a app oferece «só eliminatória».
    expect(possibleGroupCounts(3)).toEqual([1])
    expect(possibleGroupCounts(4)).toEqual([1])
    expect(possibleGroupCounts(5)).toEqual([1])
  })
})

describe('as opções que uma categoria pequena recebe (Trello #455)', () => {
  it('7 duplas têm uma opção com grupos, além da eliminatória', () => {
    const opcoes = formatOptions(7)
    const comGrupos = opcoes.filter((o) => o.kind === 'grupos')
    expect(comGrupos.length).toBeGreaterThan(0)
    expect(comGrupos[0].sizes).toEqual([4, 3])
    expect(opcoes.some((o) => o.kind === 'eliminatoria')).toBe(true)
  })

  it('3, 4 e 5 duplas só têm «só eliminatória» — e é por isso que ela tem de sortear', () => {
    for (const n of [3, 4, 5]) {
      expect(formatOptions(n).map((o) => o.kind)).toEqual(['eliminatoria'])
    }
  })
})

describe('contas de jogos e tempo', () => {
  it('um grupo de n duplas tem n×(n−1)/2 jogos', () => {
    expect(groupMatchCount(4)).toBe(6)
    expect(groupMatchCount(5)).toBe(10)
    expect(groupMatchCount(8)).toBe(28)
  })

  it('16 duplas em 4 grupos de 4: 24 jogos de grupo e 3 garantidos (cartão #364)', () => {
    const sizes = groupSizes(16, 4)
    expect(groupStageMatchCount(sizes)).toBe(24)
    expect(guaranteedMatches(sizes)).toBe(3)
  })

  it('com grupos desiguais, garantido é o do grupo mais pequeno', () => {
    expect(guaranteedMatches([5, 5, 4, 4])).toBe(3)
  })

  it('a eliminatória tem participantes − 1 jogos', () => {
    expect(knockoutMatchCount(8)).toBe(7)
    expect(knockoutMatchCount(16)).toBe(15)
  })

  it('conta as rondas pela potência de 2 seguinte (12 apurados = 4 rondas)', () => {
    expect(nextPowerOfTwo(12)).toBe(16)
    expect(knockoutRounds(8)).toBe(3)
    expect(knockoutRounds(12)).toBe(4)
  })

  it('tempo de campo = jogos × duração máxima', () => {
    expect(courtHours(31, 60)).toBe(31)
    expect(courtHours(24, 30)).toBe(12)
  })

  it('soma o tempo disponível de todos os dias (exemplo do print: 95 h)', () => {
    const dias = [
      { hours: 5, courts: 4 },  // sex 18:00–23:00, 4 campos = 20 h
      { hours: 12, courts: 4 }, // sáb 09:00–21:00, 4 campos = 48 h
      { hours: 9, courts: 3 },  // dom 09:00–18:00, 3 campos = 27 h
    ]
    expect(availableCourtHours(dias)).toBe(95)
  })
})

describe('opções de formato (print 09, 16 duplas)', () => {
  const options = formatOptions(16, { maxDurationMin: 60, availableHours: 95 })
  const byKey = (key) => options.find((o) => o.key === key)

  it('4 grupos de 4 → quartos: 31 jogos, 3 garantidos, 31 h, 4 fases', () => {
    const o = byKey('grupos-4x4-passam2')
    expect(o.matches).toBe(31)      // 24 de grupo + 7 da eliminatória de 8
    expect(o.guaranteed).toBe(3)
    expect(o.hours).toBe(31)
    expect(o.phases).toBe(4)        // grupos + quartos + meias + final
  })

  it('4 grupos de 4 → meias: 27 jogos, 27 h, 3 fases', () => {
    const o = byKey('grupos-4x4-passam1')
    expect(o.matches).toBe(27)      // 24 + 3
    expect(o.hours).toBe(27)
    expect(o.phases).toBe(3)
  })

  it('só eliminatória: 15 jogos, 1 garantido, 15 h, 4 fases', () => {
    const o = byKey('eliminatoria')
    expect(o.matches).toBe(15)
    expect(o.guaranteed).toBe(1)
    expect(o.hours).toBe(15)
    expect(o.phases).toBe(4)
  })

  it('2 grupos de 8 → meias (só com o máximo em 8): 59 jogos, 7 garantidos, não cabe em 45 h', () => {
    const o = formatOptions(16, { maxDurationMin: 60, availableHours: 45, max: 8 })
      .find((x) => x.key === 'grupos-2x8-passam2')
    expect(o.matches).toBe(59)      // 56 de grupo + 3 (4 apurados = meias)
    expect(o.guaranteed).toBe(7)
    expect(o.fits).toBe(false)
  })

  it('recomenda «4 grupos de 4 → quartos», como no print 09', () => {
    expect(recommendFormat(options).key).toBe('grupos-4x4-passam2')
    // Empate nos garantidos desfaz-se pela opção que leva mais duplas à
    // eliminatória: quartos (passam 2) em vez de meias (passa 1).
    expect(recommendFormat(options).guaranteed).toBe(3)
  })

  it('quando nada cabe, devolve a opção mais curta em vez de nada', () => {
    const semTempo = formatOptions(16, { maxDurationMin: 60, availableHours: 5 })
    const escolhida = recommendFormat(semTempo)
    expect(escolhida.fits).toBe(false)
    expect(escolhida.key).toBe('eliminatoria')
  })

  it('o quadro secundário acrescenta jogos e horas', () => {
    const semSecundario = formatOptions(16, { availableHours: 95 }).find((o) => o.key === 'grupos-4x4-passam2')
    const comSecundario = formatOptions(16, { availableHours: 95, secondaryBracket: true }).find((o) => o.key === 'grupos-4x4-passam2')
    expect(comSecundario.matches).toBe(semSecundario.matches + 7) // 8 duplas no secundário
  })
})

describe('sorteio', () => {
  it('põe uma cabeça de série por grupo, pelos pontos', () => {
    const all = teams(16)
    const sizes = groupSizes(16, 4)
    const seeds = pickSeeds(all, 4)
    expect(seeds.map((t) => t.id)).toEqual(['t1', 't2', 't3', 't4'])

    const groups = drawGroups(all, sizes, { seed: 7 })
    expect(groups.map((g) => g.teams[0].id)).toEqual(['t1', 't2', 't3', 't4'])
    expect(groups.map((g) => g.teams.length)).toEqual([4, 4, 4, 4])
  })

  it('respeita grupos de tamanhos diferentes (18 duplas)', () => {
    const groups = drawGroups(teams(18), groupSizes(18, 4), { seed: 3 })
    expect(groups.map((g) => g.teams.length)).toEqual([5, 5, 4, 4])
    const ids = groups.flatMap((g) => g.teams.map((t) => t.id))
    expect(new Set(ids).size).toBe(18) // ninguém repetido, ninguém a faltar
  })

  it('a mesma semente dá o mesmo sorteio; outra semente muda', () => {
    const all = teams(16)
    const sizes = groupSizes(16, 4)
    const a = drawGroups(all, sizes, { seed: 42 }).map((g) => g.teams.map((t) => t.id).join())
    const b = drawGroups(all, sizes, { seed: 42 }).map((g) => g.teams.map((t) => t.id).join())
    const c = drawGroups(all, sizes, { seed: 43 }).map((g) => g.teams.map((t) => t.id).join())
    expect(a).toEqual(b)
    expect(a).not.toEqual(c)
  })

  it('o admin pode trocar as cabeças de série antes de sortear', () => {
    const all = teams(12)
    const escolhidas = [all[5], all[6], all[7]] // nada a ver com os pontos
    const groups = drawGroups(all, groupSizes(12, 3), { seeds: escolhidas, seed: 1 })
    expect(groups.map((g) => g.teams[0].id)).toEqual(['t6', 't7', 't8'])
  })

  it('o calendário de um grupo é todos contra todos', () => {
    const jogos = groupRoundRobin(teams(4))
    expect(jogos).toHaveLength(6)
    const pares = jogos.map((m) => [m.a.id, m.b.id].sort().join('-'))
    expect(new Set(pares).size).toBe(6)
  })

  it('o gerador com semente é estável', () => {
    const r1 = seededRandom(9)
    const r2 = seededRandom(9)
    expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()])
  })
})

describe('classificação do grupo', () => {
  // A=t1, B=t2, C=t3, D=t4
  const jogos = [
    { a: 't1', b: 't2', scoreA: 9, scoreB: 6 },
    { a: 't1', b: 't3', scoreA: 9, scoreB: 7 },
    { a: 't1', b: 't4', scoreA: 9, scoreB: 2 },
    { a: 't2', b: 't3', scoreA: 9, scoreB: 5 },
    { a: 't2', b: 't4', scoreA: 9, scoreB: 4 },
    { a: 't3', b: 't4', scoreA: 9, scoreB: 3 },
  ]

  it('ordena por vitórias e conta jogos ganhos e perdidos', () => {
    const tabela = groupStandings(['t1', 't2', 't3', 't4'], jogos)
    expect(tabela.map((r) => r.id)).toEqual(['t1', 't2', 't3', 't4'])
    expect(tabela[0]).toMatchObject({ played: 3, wins: 3, gamesWon: 27, diff: 12, position: 1 })
  })

  it('empate a dois desfaz-se pelo confronto direto, antes da diferença', () => {
    // t1 e t2 com 2 vitórias; t2 ganhou a t1, mas t1 tem melhor diferença.
    const empate = [
      { a: 't1', b: 't2', scoreA: 4, scoreB: 9 },
      { a: 't1', b: 't3', scoreA: 9, scoreB: 0 },
      { a: 't1', b: 't4', scoreA: 9, scoreB: 0 },
      { a: 't2', b: 't3', scoreA: 9, scoreB: 7 },
      { a: 't2', b: 't4', scoreA: 9, scoreB: 8 },
      { a: 't3', b: 't4', scoreA: 9, scoreB: 5 },
    ]
    const tabela = groupStandings(['t1', 't2', 't3', 't4'], empate)
    expect(tabela.map((r) => r.id).slice(0, 2)).toEqual(['t2', 't1'])
  })

  it('empate a três: o confronto direto conta só entre as empatadas', () => {
    // t1, t2 e t3 com 2V cada (ciclo), t4 sem vitórias.
    const ciclo = [
      { a: 't1', b: 't2', scoreA: 9, scoreB: 7 },
      { a: 't2', b: 't3', scoreA: 9, scoreB: 7 },
      { a: 't3', b: 't1', scoreA: 9, scoreB: 7 },
      { a: 't1', b: 't4', scoreA: 9, scoreB: 0 },
      { a: 't2', b: 't4', scoreA: 9, scoreB: 3 },
      { a: 't3', b: 't4', scoreA: 9, scoreB: 6 },
    ]
    const tabela = groupStandings(['t1', 't2', 't3', 't4'], ciclo)
    // Entre elas está 1V-1V-1V: passa-se ao critério seguinte (diferença).
    expect(tabela.map((r) => r.id)).toEqual(['t1', 't2', 't3', 't4'])
    expect(tabela[3].id).toBe('t4')
    // E o confronto direto entre as três é mesmo 1 vitória para cada.
    expect(headToHeadWins('t1', ['t1', 't2', 't3'], ciclo)).toBe(1)
    expect(headToHeadWins('t4', ['t1', 't2', 't3'], ciclo)).toBe(0)
  })

  it('a ordem dos critérios é um parâmetro (o Smash pode querer outra)', () => {
    const semConfronto = ['vitorias', 'diferenca_jogos', 'jogos_ganhos']
    // t1 e t2 com 2 vitórias: o t2 ganhou o confronto direto por 9-8, mas o
    // t1 tem muito melhor diferença de jogos.
    const empate = [
      { a: 't1', b: 't2', scoreA: 8, scoreB: 9 },
      { a: 't1', b: 't3', scoreA: 9, scoreB: 0 },
      { a: 't1', b: 't4', scoreA: 9, scoreB: 0 },
      { a: 't2', b: 't3', scoreA: 8, scoreB: 9 },
      { a: 't2', b: 't4', scoreA: 9, scoreB: 0 },
      { a: 't3', b: 't4', scoreA: 7, scoreB: 9 },
    ]
    const comConfronto = groupStandings(['t1', 't2', 't3', 't4'], empate, { tiebreak: TIEBREAK_DEFAULT })
    const semEle = groupStandings(['t1', 't2', 't3', 't4'], empate, { tiebreak: semConfronto })
    expect(comConfronto[0].id).toBe('t2') // ganhou o confronto direto
    expect(semEle[0].id).toBe('t1')       // melhor diferença de jogos
  })

  it('jogos por jogar não contam', () => {
    const porJogar = [{ a: 't1', b: 't2', scoreA: null, scoreB: null }]
    const tabela = groupStandings(['t1', 't2'], porJogar)
    expect(tabela.every((r) => r.played === 0)).toBe(true)
  })

  // Trello #484 — o caso do Renato. A, B e C com 2 vitórias em ciclo
  // (A>C, C>B, B>A, todos 6-4) e todos ganham ao D; o A ganha ao D por mais.
  // A diferença de jogos separa o A; B e C continuam empatados (+3 cada).
  // Entre DUAS, volta-se ao confronto direto: C ganhou a B, logo C é 2.º.
  it('empate a três: quando um critério separa uma dupla, as que ficam voltam ao confronto direto entre elas (#484)', () => {
    const renato = [
      { a: 't1', b: 't3', scoreA: 6, scoreB: 4 }, // A > C
      { a: 't3', b: 't2', scoreA: 6, scoreB: 4 }, // C > B
      { a: 't2', b: 't1', scoreA: 6, scoreB: 4 }, // B > A
      { a: 't1', b: 't4', scoreA: 6, scoreB: 0 }, // A ganha ao D por mais
      { a: 't2', b: 't4', scoreA: 6, scoreB: 3 },
      { a: 't3', b: 't4', scoreA: 6, scoreB: 3 },
    ]
    // A ordem de entrada põe B antes de C — só o confronto direto os troca.
    const tabela = groupStandings(['t1', 't2', 't3', 't4'], renato)
    expect(tabela.map((r) => r.id)).toEqual(['t1', 't3', 't2', 't4'])
  })

  // Trello #484 — desistência a meio com o resultado empatado (3-3): quem
  // ganha é quem ficou em campo, não «o B por defeito».
  it('desistência com o resultado empatado: ganha quem ficou, pelo vencedor do jogo (#484)', () => {
    const desistencia = [
      { a: 't1', b: 't2', scoreA: 3, scoreB: 3, winner: 'a' },
    ]
    const tabela = groupStandings(['t1', 't2'], desistencia)
    expect(tabela[0]).toMatchObject({ id: 't1', wins: 1, played: 1 })
    expect(tabela[1]).toMatchObject({ id: 't2', wins: 0, losses: 1 })
    // E o confronto direto também lê o vencedor, não o resultado.
    expect(headToHeadWins('t1', ['t1', 't2'], desistencia)).toBe(1)
    expect(headToHeadWins('t2', ['t1', 't2'], desistencia)).toBe(0)
  })

  it('falta de comparência sem resultado escrito conta como jogo jogado e ganho (#484)', () => {
    const falta = [{ a: 't1', b: 't2', scoreA: null, scoreB: null, winner: 'b' }]
    const tabela = groupStandings(['t1', 't2'], falta)
    expect(tabela[0]).toMatchObject({ id: 't2', wins: 1, played: 1 })
    expect(tabela[1]).toMatchObject({ id: 't1', losses: 1, played: 1 })
  })
})

describe('melhores terceiros', () => {
  it('compara terceiros de grupos de tamanhos diferentes ignorando o último do grupo maior', () => {
    // Grupo A com 5 duplas, grupo B com 4. Sem o ajuste, o 3.º do grupo A
    // levava vantagem por ter jogado (e ganho) mais um jogo.
    const grupoA = {
      number: 1,
      teamIds: ['a1', 'a2', 'a3', 'a4', 'a5'],
      matches: [
        { a: 'a1', b: 'a2', scoreA: 9, scoreB: 5 }, { a: 'a1', b: 'a3', scoreA: 9, scoreB: 6 },
        { a: 'a1', b: 'a4', scoreA: 9, scoreB: 1 }, { a: 'a1', b: 'a5', scoreA: 9, scoreB: 0 },
        { a: 'a2', b: 'a3', scoreA: 9, scoreB: 7 }, { a: 'a2', b: 'a4', scoreA: 9, scoreB: 2 },
        { a: 'a2', b: 'a5', scoreA: 9, scoreB: 1 }, { a: 'a3', b: 'a4', scoreA: 9, scoreB: 4 },
        { a: 'a3', b: 'a5', scoreA: 9, scoreB: 0 }, { a: 'a4', b: 'a5', scoreA: 9, scoreB: 6 },
      ],
    }
    const grupoB = {
      number: 2,
      teamIds: ['b1', 'b2', 'b3', 'b4'],
      matches: [
        { a: 'b1', b: 'b2', scoreA: 9, scoreB: 4 }, { a: 'b1', b: 'b3', scoreA: 9, scoreB: 3 },
        { a: 'b1', b: 'b4', scoreA: 9, scoreB: 2 }, { a: 'b2', b: 'b3', scoreA: 9, scoreB: 8 },
        { a: 'b2', b: 'b4', scoreA: 9, scoreB: 5 }, { a: 'b3', b: 'b4', scoreA: 9, scoreB: 1 },
      ],
    }
    const terceiros = bestOfPosition([grupoA, grupoB], 3)
    expect(terceiros).toHaveLength(2)
    expect(terceiros.map((r) => r.id).sort()).toEqual(['a3', 'b3'])
    // Os dois ficam com 1 vitória: comparam-se em pé de igualdade.
    expect(terceiros.every((r) => r.wins === 1)).toBe(true)
  })
})

describe('quadro', () => {
  const apurados = (groups, positions) =>
    groups.flatMap((g) => positions.map((p) => ({ id: `${g}${p}`, group: g, position: p })))

  it('cruza grupos: nenhum jogo da 1.ª ronda junta duas duplas do mesmo grupo', () => {
    const { matches, exempt, bracketSize } = buildFirstRound(apurados(['A', 'B', 'C', 'D'], [1, 2]))
    expect(bracketSize).toBe(8)
    expect(exempt).toHaveLength(0)
    expect(matches).toHaveLength(4)
    expect(noSameGroupClash(matches)).toBe(true)
  })

  it('com 6 grupos e 2 apurados, 4 lugares sobram e os melhores primeiros ficam isentos', () => {
    const { matches, exempt, bracketSize } = buildFirstRound(apurados(['A', 'B', 'C', 'D', 'E', 'F'], [1, 2]))
    expect(bracketSize).toBe(16)
    expect(exempt).toHaveLength(4)
    expect(exempt.every((t) => t.position === 1)).toBe(true)
    expect(noSameGroupClash(matches)).toBe(true)
    // 12 apurados − 4 isentos = 8 duplas a jogar a 1.ª ronda
    expect(matches).toHaveLength(4)
  })

  it('com 3 apurados por grupo continua a evitar o mesmo grupo', () => {
    const { matches } = buildFirstRound(apurados(['A', 'B', 'C', 'D'], [1, 2, 3]))
    expect(noSameGroupClash(matches)).toBe(true)
  })
})
