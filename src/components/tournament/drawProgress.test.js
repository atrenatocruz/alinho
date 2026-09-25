import { describe, it, expect } from 'vitest'
import { drawProgress, statusKey } from './drawProgress'

const cat = (code, status) => ({ id: code, code, status })

describe('sorteio categoria a categoria (#560)', () => {
  it('uma sorteada e outras por sortear: está a meio', () => {
    const p = drawProgress([cat('M4', 'sorteada'), cat('M5', 'fechada'), cat('F3', 'inscricoes')])
    expect(p).toMatchObject({ total: 3, drawn: 1, partial: true })
    expect(p.toDraw.map((c) => c.code)).toEqual(['M5'])
    expect(p.open.map((c) => c.code)).toEqual(['F3'])
    expect(statusKey('sorteado', p)).toBe('tournament.status_sorteado_partial')
  })

  it('todas sorteadas (ou a decorrer): sorteio feito', () => {
    const p = drawProgress([cat('M4', 'sorteada'), cat('M5', 'a_decorrer'), cat('F3', 'terminada')])
    expect(p).toMatchObject({ drawn: 3, partial: false })
    expect(p.toDraw).toEqual([])
    expect(statusKey('sorteado', p)).toBe('tournament.status_sorteado')
  })

  it('nenhuma sorteada: não está a meio', () => {
    const p = drawProgress([cat('M4', 'fechada'), cat('M5', 'fechada')])
    expect(p.partial).toBe(false)
    expect(p.toDraw).toHaveLength(2)
    expect(statusKey('fechado', p)).toBe('tournament.status_fechado')
  })

  it('sem categorias não parte', () => {
    expect(drawProgress(undefined)).toMatchObject({ total: 0, drawn: 0, partial: false })
  })
})
