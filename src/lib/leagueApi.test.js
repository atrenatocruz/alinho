import { describe, it, expect, vi } from 'vitest'

const rpc = vi.fn()
vi.mock('./supabase', () => ({ supabase: { rpc: (...a) => rpc(...a) } }))
const api = await import('./leagueApi')

describe('leagueApi', () => {
  it('chama a RPC com os nomes de parâmetros do SQL', async () => {
    rpc.mockResolvedValueOnce({ data: { id: 'l1', slug: 'liga-x' }, error: null })
    const r = await api.createLeague({ kind: 'comunitaria', ownerOrgId: 'o1', name: 'Liga X', scope: 'local' })
    expect(r).toEqual({ id: 'l1', slug: 'liga-x' })
    expect(rpc).toHaveBeenCalledWith('create_league', {
      p_kind: 'comunitaria', p_owner_org_id: 'o1', p_name: 'Liga X', p_scope: 'local', p_district: null,
      p_season_label: null, p_description: null, p_applications_close_at: null, p_max_teams: null,
    })
  })
  it('lança o erro do servidor', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'cannot_confirm_own' } })
    await expect(api.confirmResult('e1')).rejects.toEqual({ message: 'cannot_confirm_own' })
  })
  it('a frase do erro vem de league.error_<código>', () => {
    const t = (k) => ({ 'league.error_cannot_confirm_own': 'Não podes confirmar o resultado que enviaste.' }[k] || k)
    expect(api.leagueErrorMessage(t, { message: 'ERROR: cannot_confirm_own' })).toBe('Não podes confirmar o resultado que enviaste.')
  })
})
