import { describe, it, expect, vi } from 'vitest'
vi.mock('./supabase', () => ({ supabase: {} }))
import { QUESTIONS, toggleAnswer, isAnswered, mergePickWithCatalog } from './raquete'

const q = (key) => QUESTIONS.find((x) => x.key === key)

it('11 perguntas, na ordem da spec', () => {
  expect(QUESTIONS.map((x) => x.key)).toEqual(['frequency', 'style', 'strengths', 'struggle', 'pain', 'feel', 'center', 'wants', 'shape', 'budget', 'brands'])
})

describe('toggleAnswer', () => {
  it('«Não» nas dores limpa as outras, e outra limpa «Não»', () => {
    let a = toggleAnswer({}, q('pain'), 'cotovelo')
    a = toggleAnswer(a, q('pain'), 'nao')
    expect(a.pain).toEqual(['nao'])
    expect(toggleAnswer(a, q('pain'), 'pulso').pain).toEqual(['pulso'])
  })
  it('multi alterna; single substitui', () => {
    const a = toggleAnswer(toggleAnswer({}, q('strengths'), 'voleios'), q('strengths'), 'voleios')
    expect(a.strengths).toEqual([])
    expect(toggleAnswer({ budget: 'lt80' }, q('budget'), '80_150').budget).toBe('80_150')
  })
})

it('marcas é opcional', () => expect(isAnswered({}, q('brands'))).toBe(true))
it('multi vazia não está respondida', () => expect(isAnswered({ strengths: [] }, q('strengths'))).toBe(false))

describe('mergePickWithCatalog', () => {
  const pick = { best_id: 'b', picks: [{ id: 'a', why: 'x' }, { id: 'b', why: 'y' }, { id: 'c', why: 'z' }] }
  const rackets = [{ store_id: 'a', available: true, price: 100 }, { store_id: 'b', available: false, price: 90 }]
  it('melhor primeiro; esgotada e desaparecida marcadas; preço de hoje', () => {
    const m = mergePickWithCatalog(pick, rackets)
    expect(m.map((x) => [x.id, x.best, x.soldOut])).toEqual([['b', true, true], ['a', false, false], ['c', false, true]])
    expect(m[1].racket.price).toBe(100)
    expect(m[2].racket).toBeNull()
  })
})
