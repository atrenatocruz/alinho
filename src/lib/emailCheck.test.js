import { describe, it, expect } from 'vitest'
import { emailProblem } from './emailCheck'

describe('emailProblem (erros do email em português simples, 13 out)', () => {
  it('vazio primeiro', () => {
    expect(emailProblem('')).toBe('empty')
    expect(emailProblem('   ')).toBe('empty')
    expect(emailProblem(null)).toBe('empty')
  })
  it('espaços antes do @', () => {
    expect(emailProblem('nome @gmail.com')).toBe('spaces')
    expect(emailProblem('no me')).toBe('spaces')
  })
  it('falta o @', () => {
    expect(emailProblem('nomegmail.com')).toBe('at')
    expect(emailProblem('@gmail.com')).toBe('at')
  })
  it('falta o fim, depois do @', () => {
    expect(emailProblem('nome@')).toBe('end')
    expect(emailProblem('nome@gmail')).toBe('end')
    expect(emailProblem('nome@gmail.')).toBe('end')
    expect(emailProblem('nome@@gmail.com')).toBe('end')
  })
  it('certo', () => {
    expect(emailProblem('nome@gmail.com')).toBeNull()
    expect(emailProblem(' nome@gmail.com ')).toBeNull()
    expect(emailProblem('ana.maria+padel@clube.pt')).toBeNull()
  })
})
