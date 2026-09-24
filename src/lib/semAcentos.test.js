import { describe, it, expect } from 'vitest'
import { semAcentos, contemTexto } from './semAcentos'

describe('semAcentos', () => {
  it('tira acentos e cedilhas e passa a minúsculas', () => {
    expect(semAcentos('Tiago Gonçalves')).toBe('tiago goncalves')
    expect(semAcentos('JOÃO Ávila Ñúñez')).toBe('joao avila nunez')
  })

  it('aguenta vazio e null', () => {
    expect(semAcentos('')).toBe('')
    expect(semAcentos(null)).toBe('')
    expect(semAcentos(undefined)).toBe('')
  })
})

describe('contemTexto', () => {
  it('«goncalves» encontra «Gonçalves»', () => {
    expect(contemTexto('Tiago Gonçalves', 'goncalves')).toBe(true)
    expect(contemTexto('Tiago Gonçalves', 'Tiago Goncalves')).toBe(true)
  })

  it('«joao» encontra «João» e o contrário também', () => {
    expect(contemTexto('João Silva', 'joao')).toBe(true)
    expect(contemTexto('Joao Silva', 'João')).toBe(true)
  })

  it('ignora maiúsculas e espaços à volta da pesquisa', () => {
    expect(contemTexto('Ana Moreira', '  MOREIRA ')).toBe(true)
  })

  it('não encontra o que não está lá', () => {
    expect(contemTexto('Ana Moreira', 'gonçalves')).toBe(false)
  })

  it('pesquisa vazia encontra tudo', () => {
    expect(contemTexto('Ana Moreira', '')).toBe(true)
  })
})
