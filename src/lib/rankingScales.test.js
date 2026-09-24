import { describe, it, expect } from 'vitest'
import { applyScale, scaleOf, rankedCount, defaultScale, positionOf, SCALES } from './rankingScales'

// Já na ordem do ranking global (melhor primeiro).
const rows = [
  // O caso que estava no topo em produção: 1900 declarados, zero jogos.
  { user_id: 'n1', name: 'Nuno', gender: 'masculino', ranked: true, rating_games: 0 },
  { user_id: 'm1', name: 'Rui', gender: 'masculino', ranked: true, rating_games: 20 },
  { user_id: 'f1', name: 'Ana', gender: 'feminino', ranked: true, rating_games: 5 },
  { user_id: 'm2', name: 'Bruno', gender: 'masculino', ranked: true, rating_games: 3 },
  { user_id: 'x1', name: 'Zé', gender: null, ranked: true, rating_games: 12 },
  { user_id: 'f2', name: 'Carla', gender: 'feminino', ranked: true, rating_games: 1 },
  { user_id: 'm3', name: 'Abel', gender: 'masculino', ranked: false, rating_games: 0 },
]

describe('rankingScales', () => {
  it('só há listas para homens e mulheres, mais a de toda a gente', () => {
    expect(SCALES).toEqual(['masculino', 'feminino', 'all'])
  })

  it('sem género definido não tem lista própria', () => {
    expect(scaleOf(null)).toBe('none')
    expect(scaleOf('outro')).toBe('none')
    expect(scaleOf('feminino')).toBe('feminino')
    // e a página abre em "Todos" para essa pessoa, não numa lista vazia
    expect(defaultScale(null)).toBe('all')
    expect(defaultScale('masculino')).toBe('masculino')
  })

  it('quem nunca jogou não tem lugar, mesmo com o nível mais alto declarado', () => {
    const m = applyScale(rows, 'masculino')
    expect(m.map((r) => [r.user_id, r.position])).toEqual([['m1', 1], ['m2', 2]])
    expect(m.find((r) => r.user_id === 'n1')).toBeUndefined()
  })

  it('Masculino e Feminino mostram só quem tem lugar, contado lá dentro', () => {
    const f = applyScale(rows, 'feminino')
    expect(f.map((r) => [r.user_id, r.position])).toEqual([['f1', 1], ['f2', 2]])
  })

  it('"Todos" mostra toda a gente — sem género, sem jogos e sem nível incluídos', () => {
    const all = applyScale(rows, 'all')
    expect(all.map((r) => r.name)).toEqual(['Abel', 'Ana', 'Bruno', 'Carla', 'Nuno', 'Rui', 'Zé'])
    expect(all.find((r) => r.user_id === 'f2')).toMatchObject({ scale: 'feminino', position: 2 })
  })

  it('quem não tem lugar diz porquê', () => {
    const all = applyScale(rows, 'all')
    const why = (id) => all.find((r) => r.user_id === id).reason
    expect(why('m1')).toBeNull()
    expect(why('n1')).toBe('no_games')
    expect(why('x1')).toBe('no_gender')
    expect(why('m3')).toBe('no_level')
  })

  it('as linhas de um mês contam como jogadas, mesmo sem contagem de jogos', () => {
    const monthly = [
      { user_id: 'a', name: 'A', gender: 'masculino', ranked: true, played: true },
      { user_id: 'b', name: 'B', gender: 'masculino', ranked: true, played: true },
    ]
    expect(applyScale(monthly, 'masculino').map((r) => r.position)).toEqual([1, 2])
  })

  it('se a lista não trouxer a contagem de jogos, usa os mixes jogados — não esvazia o ranking', () => {
    // A versão antiga da get_global_rankings (a que o alinho-dev tinha a 24 set).
    const antiga = [
      { user_id: 'a', name: 'A', gender: 'masculino', ranked: true, mixes_played: 4 },
      { user_id: 'b', name: 'B', gender: 'masculino', ranked: true, mixes_played: 0 },
    ]
    expect(applyScale(antiga, 'masculino').map((r) => r.user_id)).toEqual(['a'])
  })

  it('conta quem tem lugar numa escala', () => {
    expect(rankedCount(rows, 'masculino')).toBe(2)
    expect(rankedCount(rows, 'feminino')).toBe(2)
    expect(rankedCount(rows, 'none')).toBe(0)
  })

  it('o lugar de uma pessoa é o mesmo que a página do ranking mostra', () => {
    expect(positionOf(rows, 'm2')).toBe(2)
    expect(positionOf(rows, 'f1')).toBe(1)
    expect(positionOf(rows, 'n1')).toBeNull()
    expect(positionOf(rows, 'ninguem')).toBeNull()
  })
})
