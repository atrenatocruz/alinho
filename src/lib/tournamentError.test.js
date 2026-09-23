import { describe, it, expect } from 'vitest'
import { errorCode, signupErrorMessage } from './tournamentError'

// O tradutor de mentira devolve a chave quando não conhece a frase, que é
// como o i18next se porta — é dessa diferença que o código vive.
const FRASES = {
  'tsignup.error_generic': 'Não foi possível. Tenta outra vez.',
  'tsignup.error_entry_on_waitlist': 'Esta dupla está em lista de espera.',
  'tsignup.error_player1_gender_required': 'Falta saber o género de quem se inscreveu.',
}
const t = (key) => FRASES[key] ?? key

describe('errorCode', () => {
  it('tira o código do fim da mensagem do Postgres', () => {
    expect(errorCode(new Error('entry_on_waitlist'))).toBe('entry_on_waitlist')
    expect(errorCode({ message: 'P0001: entry_not_found' })).toBe('entry_not_found')
  })

  it('não perde o algarismo do meio', () => {
    // Era aqui que falhava: `player1_gender_required` dava `_gender_required`,
    // uma chave que não existe, e a pessoa lia a frase genérica quando só lhe
    // faltava escolher o género.
    expect(errorCode('player1_gender_required')).toBe('player1_gender_required')
  })

  it('aguenta o que não tem código nenhum', () => {
    expect(errorCode(null)).toBe('')
    expect(errorCode(undefined)).toBe('')
    expect(errorCode({})).toBe('')
  })
})

describe('signupErrorMessage', () => {
  it('mostra a frase quando ela existe', () => {
    expect(signupErrorMessage(t, new Error('entry_on_waitlist'))).toBe('Esta dupla está em lista de espera.')
  })

  it('mostra a frase certa no caso com algarismo', () => {
    expect(signupErrorMessage(t, new Error('player1_gender_required')))
      .toBe('Falta saber o género de quem se inscreveu.')
  })

  it('cai na genérica quando não há frase — e nunca mostra o código em bruto', () => {
    const saida = signupErrorMessage(t, new Error('alguma_coisa_nova'))
    expect(saida).toBe('Não foi possível. Tenta outra vez.')
    expect(saida).not.toContain('alguma_coisa_nova')
  })

  it('cai na genérica com um erro do Postgres que não é nosso', () => {
    expect(signupErrorMessage(t, new Error('new row violates row-level security policy')))
      .toBe('Não foi possível. Tenta outra vez.')
  })
})
