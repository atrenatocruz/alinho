import { describe, it, expect, vi, afterEach } from 'vitest'
import { describeError, errorKind, errorCode } from './errors'

// t de teste: devolve a chave e as variáveis, para os testes não dependerem do texto.
const texts = {
  'x.error_create': 'Erro ao criar jogo: ',
  'x.error_join': 'Não foi possível entrar. Tenta novamente.',
  'errors.generic': 'Algo correu mal.',
  'errors.try_again': 'Tenta outra vez.',
}
const t = (key, vars) => (texts[key] ?? key) + (vars?.code ? `[${vars.code}]` : '')

afterEach(() => vi.unstubAllGlobals())

describe('errorKind', () => {
  it('reconhece os tipos principais', () => {
    expect(errorKind(new TypeError('Failed to fetch'))).toBe('offline')
    expect(errorKind({ code: 'PGRST301', message: 'JWT expired' })).toBe('session')
    expect(errorKind({ code: '42501', message: 'new row violates row-level security policy for table "games"' })).toBe('permission')
    expect(errorKind({ code: '23505', message: 'duplicate key value violates unique constraint' })).toBe('duplicate')
    expect(errorKind({ code: 'PGRST202', message: 'Could not find the function public.x in the schema cache' })).toBe('not_ready')
    expect(errorKind({ code: 'P0001', message: 'Não és membro deste grupo' })).toBe('business')
    expect(errorKind({ message: 'Invalid login credentials', status: 400 })).toBe('invalid_login')
    expect(errorKind({ message: 'weird', code: '23503' })).toBe('unknown')
  })

  it('sem rede no browser conta como offline', () => {
    vi.stubGlobal('navigator', { onLine: false })
    expect(errorKind({ code: 'P0001', message: 'Qualquer' })).toBe('offline')
  })
})

describe('describeError', () => {
  it('regra da app em português aparece tal como está', () => {
    expect(describeError(t, { code: 'P0001', message: 'Não és membro deste grupo' }, 'x.error_create')).toBe('Não és membro deste grupo.')
  })

  it('tipos conhecidos usam a frase própria, sem código', () => {
    expect(describeError(t, { code: '42501', message: 'row-level security' }, 'x.error_create')).toBe('errors.permission')
    expect(describeError(t, new TypeError('Failed to fetch'), 'x.error_create')).toBe('errors.offline')
  })

  it('erro desconhecido: frase da ação sem ":" + tenta outra vez + código', () => {
    expect(describeError(t, { code: '23503', message: 'insert or update violates foreign key' }, 'x.error_create'))
      .toBe('Erro ao criar jogo. Tenta outra vez. errors.send_code[23503]')
  })

  it('não repete "tenta" quando a frase já o diz, e sem código não acrescenta nada', () => {
    expect(describeError(t, new Error('boom'), 'x.error_join')).toBe('Não foi possível entrar. Tenta novamente.')
  })

  it('nunca mostra o texto técnico em inglês', () => {
    const msg = describeError(t, { code: 'XX000', message: 'internal error at line 42' }, 'x.error_create')
    expect(msg).not.toMatch(/internal error/)
  })

  it('sem chave usa a frase geral', () => {
    expect(describeError(t, new Error('boom'))).toBe('Algo correu mal. Tenta outra vez.')
    expect(errorCode({ status: 500 })).toBe('HTTP 500')
  })
})
