import { describe, it, expect } from 'vitest'
import { eventFromLeagueEncounter, leagueForYouItems } from './leagueAgenda'

const row = {
  id: 'e1', league_slug: 'liga-porto', league_name: 'Liga Alinho Porto', league_kind: 'alinho',
  category_gender: 'masculino', category_level: 4, round_number: 4, window_end: '2026-11-16',
  home_name: 'Serra Azul Padel', away_name: 'Maré Alta Padel', my_side: 'away',
  scheduled_at: '2026-11-08T17:00:00Z', venue: 'Campo 3', status: 'marcado', needs_my_answer: false,
}

describe('liga na Home', () => {
  it('um encontro marcado fica no dia dele, com hora', () => {
    const e = eventFromLeagueEncounter(row)
    expect(e).toMatchObject({ key: 'league:e1', kind: 'league', slug: 'liga-porto', hasTime: true, mine: true })
    expect(e.dayKey).toBe('2026-11-08')
  })
  it('sem data fica no último dia da jornada, sem hora', () => {
    const e = eventFromLeagueEncounter({ ...row, scheduled_at: null, status: 'por_marcar' })
    expect(e).toMatchObject({ dayKey: '2026-11-16', hasTime: false })
  })
  it('«Para ti»: confirmar resultados e ligas abertas para os meus clubes', () => {
    const t = (k, v) => `${k}${v ? JSON.stringify(v) : ''}`
    const items = leagueForYouItems({
      encounters: [{ ...row, status: 'submetido', needs_my_answer: true }],
      open_leagues: [{ slug: 'liga-lx', name: 'Liga Alinho Lisboa', my_club_name: 'Maré Alta Padel' }],
    }, t)
    expect(items.map((i) => i.key)).toEqual(['league-confirm:e1', 'league-open:liga-lx'])
    expect(items[0].to).toBe('/liga/liga-porto/encontro/e1')
  })
})
