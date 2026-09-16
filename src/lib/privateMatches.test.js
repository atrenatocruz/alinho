import { describe, it, expect } from 'vitest'
import { privateMatchActions } from './privateMatches'

// Jogo base: eu (me) na equipa B, criador na A.
const base = (extra = {}) => ({
  id: 'pm1',
  status: 'pending',
  team_a_player1_id: 'creator', team_a_player1_status: 'accepted_all',
  team_a_player2_id: 'mate', team_a_player2_status: 'accepted_all',
  team_b_player1_id: 'me', team_b_player1_status: 'pending',
  team_b_player2_id: 'other', team_b_player2_status: 'accepted_all',
  score_a: null, score_b: null, score_submitted_by: null,
  ...extra,
})

describe('privateMatchActions', () => {
  it('convite por responder aparece como "respond"', () => {
    expect(privateMatchActions([base()], 'me')).toEqual([{ kind: 'respond', match: base() }])
  })

  it('depois de responder já não pede resposta', () => {
    expect(privateMatchActions([base({ team_b_player1_status: 'accepted_all' })], 'me')).toEqual([])
  })

  it('resultado submetido pela outra equipa: pede para confirmar', () => {
    const m = base({ team_b_player1_status: 'accepted_all', score_a: 6, score_b: 4, score_submitted_by: 'creator' })
    expect(privateMatchActions([m], 'me').map((a) => a.kind)).toEqual(['confirm'])
  })

  it('resultado submetido pela minha equipa: não sou eu quem confirma', () => {
    const m = base({ team_b_player1_status: 'accepted_all', score_a: 6, score_b: 4, score_submitted_by: 'other' })
    expect(privateMatchActions([m], 'me')).toEqual([])
  })

  it('jogos já confirmados ou onde não estou não geram aviso', () => {
    expect(privateMatchActions([base({ status: 'confirmed' })], 'me')).toEqual([])
    expect(privateMatchActions([base()], 'stranger')).toEqual([])
    expect(privateMatchActions([base()], null)).toEqual([])
  })
})
