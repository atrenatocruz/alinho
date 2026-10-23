import { describe, it, expect } from 'vitest'
import {
  CATEGORY_COLORS, categoryColors, dayMatches, dayMatchCounts, matchDays, timetableGrid,
  nowRowIndex, myDayMatches,
} from './tournamentTimetable'

// Horas em UTC, como chegam da base de dados. Em novembro Lisboa = UTC.
const m = (id, category_id, at, court_name, extra = {}) => ({
  id, category_id, scheduled_at: at, court_name, stage: 'grupo', round: null,
  entry_a_id: `${id}a`, entry_b_id: `${id}b`, ...extra,
})
const day = '2026-11-13'
const matches = [
  m('j3', 'M3', '2026-11-13T18:45:00+00:00', 'Campo 1'),
  m('j1', 'M4', '2026-11-13T18:00:00+00:00', 'Campo 2'),
  m('j2', 'M3', '2026-11-13T18:00:00+00:00', 'Campo 1'),
  m('j4', 'M4', '2026-11-14T09:00:00+00:00', 'Campo 1'),
  m('j5', 'M4', null, null),
  m('j6', 'M4', '2026-11-13T23:30:00+00:00', null),
]

describe('cor de cada categoria', () => {
  it('pela ordem das categorias, e volta ao princípio depois da sexta', () => {
    const cats = Array.from({ length: 7 }, (_, i) => ({ id: `c${i}`, code: `C${i}`, position: 6 - i }))
    const colors = categoryColors(cats)
    expect(colors.c6).toBe(CATEGORY_COLORS[0])
    expect(colors.c1).toBe(CATEGORY_COLORS[5])
    expect(colors.c0).toBe(CATEGORY_COLORS[0])
  })
})

describe('jogos do dia, de todas as categorias', () => {
  it('pela hora e depois pelo campo; sem hora fica de fora', () => {
    expect(dayMatches(matches, day, { courts: ['Campo 1', 'Campo 2'] }).map((x) => x.id)).toEqual(['j2', 'j1', 'j3', 'j6'])
  })
  it('só de uma categoria', () => {
    expect(dayMatches(matches, day, { categoryId: 'M4' }).map((x) => x.id)).toEqual(['j1', 'j6'])
  })
  it('«Todas · n» e o número de cada categoria', () => {
    expect(dayMatchCounts(matches, day)).toEqual({ all: 4, M3: 2, M4: 2 })
  })
  it('os dias com jogos, por ordem', () => {
    expect(matchDays(matches)).toEqual(['2026-11-13', '2026-11-14'])
  })
  it('o dia é o de Portugal: 23h30 UTC de 31 jul já é 1 ago em Lisboa', () => {
    const summer = [m('v', 'M4', '2026-07-31T23:30:00+00:00', 'Campo 1')]
    expect(matchDays(summer)).toEqual(['2026-08-01'])
  })
})

describe('grelha hora × campo', () => {
  it('uma linha por hora de início, uma coluna por campo; sem campo vai à parte', () => {
    const grid = timetableGrid(matches, day, { courts: ['Campo 1', 'Campo 2', 'Campo 3'] })
    expect(grid.courts).toEqual(['Campo 1', 'Campo 2', 'Campo 3'])
    expect(grid.rows.map((r) => r.time)).toEqual(['18:00', '18:45'])
    expect(grid.rows[0].cells['Campo 1'].id).toBe('j2')
    expect(grid.rows[0].cells['Campo 2'].id).toBe('j1')
    expect(grid.rows[1].cells['Campo 2']).toBeUndefined()
    expect(grid.unplaced.map((x) => x.id)).toEqual(['j6'])
  })
  it('um campo que só aparece nos jogos vai para o fim', () => {
    const grid = timetableGrid([m('x', 'M4', '2026-11-13T18:00:00Z', 'Central')], day, { courts: ['Campo 1'] })
    expect(grid.courts).toEqual(['Campo 1', 'Central'])
  })
  it('linha «AGORA»: antes da primeira linha que ainda não começou; só no dia de hoje', () => {
    const { rows } = timetableGrid(matches, day)
    expect(nowRowIndex(rows, day, { now: new Date('2026-11-13T18:20:00Z') })).toBe(1)
    expect(nowRowIndex(rows, day, { now: new Date('2026-11-13T20:00:00Z') })).toBe(2)
    expect(nowRowIndex(rows, day, { now: new Date('2026-11-14T10:00:00Z') })).toBeNull()
  })
})

describe('os teus jogos hoje', () => {
  it('os jogos do dia das minhas duplas, em todas as categorias, com o adversário', () => {
    const mine = myDayMatches(matches, day, ['j1a', 'j3b'])
    expect(mine.map((x) => x.id)).toEqual(['j1', 'j3'])
    expect(mine[1].my_entry_id).toBe('j3b')
    expect(mine[1].opponent_entry_id).toBe('j3a')
  })
  it('sem inscrições, vazio (o bloco não aparece)', () => {
    expect(myDayMatches(matches, day, [])).toEqual([])
  })
})
