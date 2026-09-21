import { describe, it, expect } from 'vitest'
import { formatWords, categoryWhen, slotsWords, tournamentUrl, shareMessage } from './tournamentPublic'

describe('formatWords', () => {
  it('sem formato escolhido não inventa', () => {
    expect(formatWords({}).key).toBe('tpublic.format_unknown')
    expect(formatWords({ format: null }).key).toBe('tpublic.format_unknown')
  })
  it('grupos e quantos passam', () => {
    expect(formatWords({ format: { groups: 4, qualifiers_per_group: 2 } }))
      .toEqual({ key: 'tpublic.format_groups', values: { groups: 4, qualifiers: 2 } })
  })
  it('passa só o primeiro por omissão', () => {
    expect(formatWords({ format: { groups: 3 } }).values.qualifiers).toBe(1)
  })
  it('só eliminatória', () => {
    expect(formatWords({ format: { knockout_size: 16 } }))
      .toEqual({ key: 'tpublic.format_knockout', values: { teams: 16 } })
  })
})

describe('categoryWhen', () => {
  it('sem dia marcado não diz nada', () => expect(categoryWhen({})).toBe(null))
  it('dia com hora certa', () => {
    expect(categoryWhen({ day_date: '2026-10-10', start_time: '12:00' }))
      .toEqual({ day: 'Sábado', hour: '12h' })
  })
  it('dia com meia hora', () => {
    expect(categoryWhen({ day_date: '2026-10-10', start_time: '18:30' }).hour).toBe('18h30')
  })
  it('dia sem hora', () => {
    expect(categoryWhen({ day_date: '2026-10-11' })).toBe('Domingo')
  })
})

describe('slotsWords', () => {
  it('vagas a sobrar', () => {
    expect(slotsWords({ slots: 16, entry_count: 10 }))
      .toEqual({ key: 'tsignup.category_slots', values: { count: 6 } })
  })
  it('cheia', () => {
    expect(slotsWords({ slots: 16, entry_count: 16 }).key).toBe('tsignup.category_full')
  })
  it('sem lotação, sem linha', () => expect(slotsWords({ slots: null })).toBe(null))
})

describe('partilha', () => {
  const tour = { slug: 'smash-cup', name: 'Smash Cup by WFit', club_name: 'Smash Padel', starts_on: '2026-10-09', ends_on: '2026-10-11' }
  it('endereço curto e legível', () => {
    expect(tournamentUrl(tour, 'https://alinho.pt')).toBe('https://alinho.pt/torneio/smash-cup')
  })
  it('mensagem com nome, datas, clube e link', () => {
    expect(shareMessage(tour, 'https://alinho.pt'))
      .toBe('Smash Cup by WFit\n09–11 · Smash Padel\nhttps://alinho.pt/torneio/smash-cup')
  })
  it('torneio de um dia só', () => {
    expect(shareMessage({ ...tour, ends_on: '2026-10-09' }, 'https://alinho.pt').split('\n')[1])
      .toBe('09 · Smash Padel')
  })
})
