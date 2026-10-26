import { describe, it, expect } from 'vitest'
import { shouldSendWatchSession } from './watchSession'

const base = { installed: true, sentUserId: null, needsSession: false, userId: 'u1', lastFailure: null }

describe('shouldSendWatchSession', () => {
  it('sem relógio com a app instalada, não manda', () => {
    expect(shouldSendWatchSession({ ...base, installed: false })).toBe(false)
  })

  it('relógio instalado e nada mandado ainda: manda', () => {
    expect(shouldSendWatchSession(base)).toBe(true)
  })

  it('já mandada para o mesmo user e o relógio não pediu: não manda', () => {
    expect(shouldSendWatchSession({ ...base, sentUserId: 'u1' })).toBe(false)
  })

  it('mesmo user, mas o relógio pediu outra: manda', () => {
    expect(shouldSendWatchSession({ ...base, sentUserId: 'u1', needsSession: true })).toBe(true)
  })

  it('mandada para outro user: manda', () => {
    expect(shouldSendWatchSession({ ...base, sentUserId: 'u2' })).toBe(true)
  })

  it('sem user, não manda', () => {
    expect(shouldSendWatchSession({ ...base, userId: null })).toBe(false)
  })

  // lastFailure é o da conta de userId (syncWatchSession só passa 'no_email'
  // quando o guardado é deste user).
  it('a conta deste user não tem email (no_email): não volta a tentar', () => {
    expect(shouldSendWatchSession({ ...base, needsSession: true, lastFailure: 'no_email' })).toBe(false)
  })
})
