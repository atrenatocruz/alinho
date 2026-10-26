import { describe, it, expect, vi, beforeEach } from 'vitest'

const { WatchGames, invoke, getSession } = vi.hoisted(() => ({
  WatchGames: {
    watchSessionStatus: vi.fn(),
    sendWatchSession: vi.fn(),
    clearWatchSession: vi.fn(),
  },
  invoke: vi.fn(),
  getSession: vi.fn(),
}))
vi.mock('./watchGames', () => ({ WatchGames, hasWatchGames: true }))
vi.mock('./supabase', () => ({
  supabaseUrl: 'https://x.supabase.co',
  supabase: { functions: { invoke }, auth: { getSession } },
}))

import { shouldSendWatchSession, syncWatchSession, clearWatchSession } from './watchSession'

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

describe('syncWatchSession e clearWatchSession', () => {
  const fresh = { access_token: 'a', refresh_token: 'r', expires_at: 1, user_id: 'u1' }

  beforeEach(() => {
    vi.clearAllMocks()
    WatchGames.watchSessionStatus.mockResolvedValue({ installed: true, sentUserId: null, needsSession: true })
    WatchGames.sendWatchSession.mockResolvedValue()
    WatchGames.clearWatchSession.mockResolvedValue()
    getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } })
  })

  it('sem sair da conta: manda a sessão ao relógio', async () => {
    invoke.mockResolvedValue({ data: fresh, error: null })
    await syncWatchSession('u1')
    expect(WatchGames.sendWatchSession).toHaveBeenCalledTimes(1)
  })

  it('saiu da conta enquanto se pedia a sessão: não a manda', async () => {
    let answer
    invoke.mockReturnValue(new Promise(r => { answer = r }))
    const sync = syncWatchSession('u1')
    await vi.waitFor(() => expect(invoke).toHaveBeenCalled())
    await clearWatchSession()
    answer({ data: fresh, error: null })
    await sync
    expect(WatchGames.clearWatchSession).toHaveBeenCalledTimes(1)
    expect(WatchGames.sendWatchSession).not.toHaveBeenCalled()
  })

  it('saiu e voltou a entrar a meio: o pedido velho não manda, corre um novo', async () => {
    let answer
    invoke.mockReturnValueOnce(new Promise(r => { answer = r }))
    invoke.mockResolvedValue({ data: fresh, error: null })
    const old = syncWatchSession('u1')
    await vi.waitFor(() => expect(invoke).toHaveBeenCalled())
    await clearWatchSession()
    const again = syncWatchSession('u1')
    answer({ data: fresh, error: null })
    await old
    await again
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(WatchGames.sendWatchSession).toHaveBeenCalledTimes(1)
  })

  it('email por confirmar não fica guardado: a seguir tenta outra vez', async () => {
    const err = { message: 'x', context: { json: async () => ({ error: 'email_unconfirmed' }) } }
    invoke.mockResolvedValueOnce({ data: null, error: err })
    invoke.mockResolvedValueOnce({ data: fresh, error: null })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await syncWatchSession('u1')
    await syncWatchSession('u1')
    spy.mockRestore()
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(WatchGames.sendWatchSession).toHaveBeenCalledTimes(1)
  })
})
