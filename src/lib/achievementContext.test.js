import { describe, it, expect } from 'vitest'
import { achievementContext, achievementDay, achievementEventPath, achievementMonth, andWord } from './achievements'

describe('achievementContext (quando e com quem)', () => {
  it('sem context (a função de sempre): null', () => {
    expect(achievementContext({ achievement_key: 'bis' })).toBe(null)
  })
  it('parceiro com conta e privado: sem link; convidado: sem link', () => {
    const a = achievementContext({ context: 'jogo', event_on: '2026-10-14', partner_id: 'p1', partner_name: 'Tiago Sousa', partner_linkable: false })
    expect(a.partner).toEqual({ id: 'p1', name: 'Tiago Sousa', linkable: false })
    const b = achievementContext({ context: 'jogo', partner_id: null, partner_name: 'Ricardo Delca' })
    expect(b.partner.linkable).toBe(false)
  })
  it('a dupla vencida vem como lista', () => {
    const a = achievementContext({ context: 'jogo', beaten: [{ id: 'a', name: 'Ana Lopes', linkable: true }] })
    expect(a.beaten).toHaveLength(1)
  })
  it('quem apagou a conta: nome null e sem link, pela ordem da base', () => {
    const a = achievementContext({ context: 'jogo', partner_id: 'p9', partner_name: null, partner_linkable: false,
      beaten: [{ id: null, name: null, linkable: false }, { id: 'b', name: 'Rui Matos', linkable: true }] })
    expect(a.partner).toEqual({ id: 'p9', name: null, linkable: false })
    expect(a.beaten.map((p) => p.name)).toEqual([null, 'Rui Matos'])
  })
})

describe('achievementDay', () => {
  const now = new Date(2026, 9, 22)
  it('do ano corrente: «14 out»; de outro ano: com o ano', () => {
    expect(achievementDay('2026-10-14', 'pt-PT', now)).toBe('14 out')
    expect(achievementDay('2025-10-14', 'pt-PT', now)).toBe('14 out 2025')
  })
})

describe('achievementEventPath', () => {
  it('mix, torneio e amigos têm página; grupo não', () => {
    expect(achievementEventPath({ eventKind: 'mix', eventId: 'g' })).toBe('/jogo/g')
    expect(achievementEventPath({ eventKind: 'torneio', eventId: 't' })).toBe('/torneio/t')
    expect(achievementEventPath({ eventKind: 'amigos', eventId: 'm' })).toBe('/jogos-privados/sessao/m')
    expect(achievementEventPath({ eventKind: 'grupo', eventId: 'x' })).toBe(null)
  })
})

describe('andWord', () => {
  const t = () => 'y'
  it('em espanhol, «e» antes de I/Hi; «y» nos outros casos', () => {
    expect(andWord(t, 'es', 'Inés')).toBe('e')
    expect(andWord(t, 'es', 'Hilario')).toBe('e')
    expect(andWord(t, 'es', 'Hierro')).toBe('y')
    expect(andWord(t, 'es', 'Pedro')).toBe('y')
    expect(andWord(() => 'e', 'pt-PT', 'Inês')).toBe('e')
  })
})

describe('achievementMonth', () => {
  it('o mês do Pódio do Mês, por extenso', () => {
    expect(achievementMonth('2026-11-30', 'pt-PT')).toBe('novembro')
    expect(achievementMonth(null, 'pt-PT')).toBe('')
  })
})
