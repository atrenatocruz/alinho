import { describe, it, expect } from 'vitest'
import { eventMatches } from './homeSearchMatch'

const ev = (title, orgName, location) => ({ raw: { title, location }, orgName })

describe('eventMatches (Home, Trello #547)', () => {
  it('encontra pelo nome do evento, sem acentos nem maiúsculas', () => {
    expect(eventMatches(ev('+1 Mix de Segunda-feira', '+1 Grupo de Padel'), 'segunda')).toBe(true)
    expect(eventMatches(ev('Mix de Terça', null), 'terca')).toBe(true)
  })

  it('encontra pelo nome do clube/grupo e pelo sítio', () => {
    expect(eventMatches(ev('Mix m4', 'Smash Padel Almada'), 'smash')).toBe(true)
    expect(eventMatches(ev('Mix m4', 'Clube X', 'IPC Lisboa'), 'ipc')).toBe(true)
  })

  it('encontra pelo tipo: «mix» encontra um mix chamado «Viva»', () => {
    expect(eventMatches({ ...ev('Viva', 'Boavista FC'), kind: 'mix' }, 'mix')).toBe(true)
    expect(eventMatches({ ...ev('Outono Open', 'Clube Norte'), kind: 'tournament' }, 'torneio')).toBe(true)
    expect(eventMatches({ ...ev('Rita abriu', 'A2N'), kind: 'open' }, 'jogo em aberto')).toBe(true)
    expect(eventMatches({ ...ev('Viva', 'Boavista FC'), kind: 'mix' }, 'torneio')).toBe(false)
  })

  it('não encontra o que não está lá', () => {
    expect(eventMatches(ev('Mix de Quinta', 'Smash'), 'quarta')).toBe(false)
  })

  it('pesquisa vazia encontra tudo', () => {
    expect(eventMatches(ev('Mix', null), '  ')).toBe(true)
  })
})
