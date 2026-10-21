import { describe, it, expect } from 'vitest'
import { startsAtEdge, lockDirection, neighbour, followOffset, shouldSwitch, BOUNCE_MAX } from './swipeTabs'

const PATHS = ['/', '/comunidade', '/rankings', '/perfil', '/gerir']

describe('deslizar entre os separadores do menu de baixo', () => {
  it('as bordas de 24 px ficam para o voltar do sistema', () => {
    expect(startsAtEdge(10, 375)).toBe(true)
    expect(startsAtEdge(360, 375)).toBe(true)
    expect(startsAtEdge(30, 375)).toBe(false)
  })

  it('só conta um gesto claramente para o lado', () => {
    expect(lockDirection(4, 3)).toBe(null)
    expect(lockDirection(40, 10)).toBe('h')
    expect(lockDirection(40, 25)).toBe('v')
    expect(lockDirection(5, 30)).toBe('v')
  })

  it('o vizinho segue a ordem do menu', () => {
    expect(neighbour(PATHS, '/rankings', -80)).toBe('/perfil')
    expect(neighbour(PATHS, '/rankings', 80)).toBe('/comunidade')
    expect(neighbour(PATHS, '/', 80)).toBe(null)
    expect(neighbour(PATHS, '/gerir', -80)).toBe(null)
    expect(neighbour(PATHS, '/jogo/1', -80)).toBe(null)
  })

  it('a página anda mais devagar do que o dedo e pára nos 25%', () => {
    expect(followOffset(-100, 400, true)).toBe(-50)
    expect(followOffset(-1000, 400, true)).toBe(-100)
  })

  it('nas pontas só há um ressalto de 12 px', () => {
    expect(Math.abs(followOffset(500, 400, false))).toBeLessThanOrEqual(BOUNCE_MAX)
    expect(followOffset(500, 400, false)).toBeGreaterThan(10)
  })

  it('muda só com 60 px para o lado e havendo para onde ir', () => {
    expect(shouldSwitch(-70, 10, true)).toBe(true)
    expect(shouldSwitch(-50, 0, true)).toBe(false)
    expect(shouldSwitch(-70, 40, true)).toBe(false)
    expect(shouldSwitch(-200, 0, false)).toBe(false)
  })
})
