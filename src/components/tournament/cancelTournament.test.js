import { describe, it, expect } from 'vitest'
import { canCancel, cancelCopy } from './cancelTournament'

const t = (key, v) => `${key}|${v?.count ?? v?.name ?? ''}`

// Francisco, 1 out: «eu quero poder cancelar sempre, mesmo com inscritos ou não».
describe('cancelar o torneio', () => {
  it('cancela-se em todos os estados até terminar', () => {
    for (const status of ['rascunho', 'inscricoes', 'fechado', 'sorteado', 'a_decorrer']) expect(canCancel({ status })).toBe(true)
    expect(canCancel({ status: 'terminado' })).toBe(false)
    expect(canCancel({ status: 'cancelado' })).toBe(false)
  })
  it('a frase segue o momento', () => {
    expect(cancelCopy({ status: 'inscricoes', entry_count: 0 }, t).key).toBe('empty')
    expect(cancelCopy({ status: 'inscricoes', entry_count: 12 }, t).key).toBe('entries')
    expect(cancelCopy({ status: 'a_decorrer', entry_count: 12 }, t).key).toBe('live')
    expect(cancelCopy({ status: 'sorteado', entry_count: 12 }, t).message).toBe('tournament.cancel.message_live|12')
  })
})

describe('eliminar só sem nenhuma inscrição, mesmo desistida (UX, 1 out)', () => {
  it('com desistidas, cancela e não elimina', () => {
    expect(cancelCopy({ status: 'inscricoes', entry_count: 0 }, t, true).key).toBe('withdrawn')
    expect(cancelCopy({ status: 'inscricoes', entry_count: 0 }, t, false).key).toBe('empty')
  })
})
