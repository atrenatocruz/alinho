import { describe, it, expect } from 'vitest'
import { eventFromFriendInvite } from './friendInvites'

const invite = { match_id: 'm1', creator_name: 'Rita Figueira', scheduled_date: '2026-10-20', scheduled_time: '10:00:00', location: 'Clube Exemplo', people: 6 }
const detail = { match: {}, invitees: [
  { user_id: 'a', name: 'Rita', status: 'accepted' },
  { user_id: 'b', name: 'Tiago', status: 'accepted' },
  { user_id: 'c', name: 'Ana', status: 'pending' },
  { user_id: 'd', name: 'Zé', status: 'declined' },
] }

describe('eventFromFriendInvite', () => {
  it('por responder: convite', () => {
    const e = eventFromFriendInvite({ ...invite, my_status: 'pending' }, detail)
    expect(e.myState).toBe('invited')
    expect(e.raw.pending).toBe(1)
  })

  it('sem my_status (antes da função nova): convite, como antes', () => {
    expect(eventFromFriendInvite(invite, detail).myState).toBe('invited')
  })

  // QA e Dev 3, 13 out: depois do «Vou», sem equipas, o jogo fica na Home.
  it('aceite sem equipas: estou dentro', () => {
    const e = eventFromFriendInvite({ ...invite, my_status: 'accepted', is_creator: false }, detail)
    expect(e.myState).toBe('in')
    expect(e.raw.isCreator).toBe(false)
  })

  it('quem criou', () => {
    const e = eventFromFriendInvite({ ...invite, my_status: 'accepted', is_creator: true }, detail)
    expect(e.myState).toBe('in')
    expect(e.raw.isCreator).toBe(true)
  })
})
