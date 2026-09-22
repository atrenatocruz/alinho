import { describe, it, expect } from 'vitest'
import { noticeError, activeNotices, noticeAge, expiryFrom, editedWords, NOTICE_MAX } from './tournamentNotices'

describe('noticeError', () => {
  it('aceita um aviso normal', () => expect(noticeError('M4 atrasado 20 min')).toBe(null))
  it('recusa vazio', () => {
    expect(noticeError('')).toBe('empty')
    expect(noticeError('   ')).toBe('empty')
    expect(noticeError(null)).toBe('empty')
  })
  it('recusa textos enormes — é um aviso, não um chat', () => {
    expect(noticeError('a'.repeat(NOTICE_MAX + 1))).toBe('too_long')
    expect(noticeError('a'.repeat(NOTICE_MAX))).toBe(null)
  })
})

describe('activeNotices', () => {
  const now = new Date('2026-10-10T15:00:00Z')
  const n = (id, created, expires) => ({ id, body: `aviso ${id}`, created_at: created, expires_at: expires })

  it('o mais recente fica em cima', () => {
    const rows = [n(1, '2026-10-10T10:00:00Z'), n(2, '2026-10-10T14:00:00Z')]
    expect(activeNotices(rows, now).map((x) => x.id)).toEqual([2, 1])
  })
  it('esconde os que já acabaram', () => {
    const rows = [n(1, '2026-10-10T10:00:00Z', '2026-10-10T14:00:00Z'), n(2, '2026-10-10T11:00:00Z')]
    expect(activeNotices(rows, now).map((x) => x.id)).toEqual([2])
  })
  it('sem fim, fica', () => {
    expect(activeNotices([n(1, '2026-10-10T10:00:00Z', null)], now)).toHaveLength(1)
  })
  it('sem avisos, lista vazia — e o ecrã não reserva espaço', () => {
    expect(activeNotices(null, now)).toEqual([])
    expect(activeNotices([], now)).toEqual([])
  })
  it('ignora linhas sem texto', () => {
    expect(activeNotices([{ id: 9, body: '', created_at: '2026-10-10T10:00:00Z' }], now)).toEqual([])
  })
})

describe('noticeAge', () => {
  const now = new Date('2026-10-10T15:00:00Z')
  it('agora mesmo', () => expect(noticeAge('2026-10-10T14:59:40Z', now).key).toBe('tnotices.age_now'))
  it('minutos', () => expect(noticeAge('2026-10-10T14:54:00Z', now)).toEqual({ key: 'tnotices.age_minutes', values: { count: 6 } }))
  it('horas', () => expect(noticeAge('2026-10-10T13:00:00Z', now)).toEqual({ key: 'tnotices.age_hours', values: { count: 2 } }))
  it('dias', () => expect(noticeAge('2026-10-08T15:00:00Z', now)).toEqual({ key: 'tnotices.age_days', values: { count: 2 } }))
  it('sem data, nada', () => expect(noticeAge(null, now)).toBe(null))
})

describe('expiryFrom', () => {
  const now = new Date('2026-10-10T14:00:00')
  it('sem fim', () => expect(expiryFrom('none', now)).toBe(null))
  it('uma hora', () => expect(new Date(expiryFrom('1h', now)).getHours()).toBe(15))
  it('três horas', () => expect(new Date(expiryFrom('3h', now)).getHours()).toBe(17))
  it('até ao fim do dia', () => {
    const end = new Date(expiryFrom('day', now))
    expect([end.getHours(), end.getMinutes()]).toEqual([23, 59])
  })
})

describe('editedWords', () => {
  const now = new Date('2026-10-10T18:00:00')
  it('sem edição, nada', () => expect(editedWords(null, now)).toBe(null))
  it('no mesmo dia, a hora', () => {
    expect(editedWords(new Date('2026-10-10T14:20:00'), now))
      .toEqual({ key: 'tnotices.edited_at', values: { time: '14h20' } })
  })
  it('hora certa sem minutos', () => {
    expect(editedWords(new Date('2026-10-10T14:00:00'), now).values.time).toBe('14h')
  })
  it('noutro dia, a data', () => {
    expect(editedWords(new Date('2026-10-09T14:20:00'), now).key).toBe('tnotices.edited_on')
  })
})
