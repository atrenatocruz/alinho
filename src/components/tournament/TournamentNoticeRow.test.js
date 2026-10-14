import { describe, it, expect } from 'vitest'
import { championText, drawnText, finishedText, prizeText, timeChangedText } from './TournamentNoticeRow'

const t = (key, v) => ({ 'tournament.notice_prize_first': `1.º ${v?.prize}`, 'tournament.notice_prize_second': `2.º ${v?.prize}` }[key])

describe('prizeText', () => {
  it('só o 1.º: o prémio tal e qual', () => {
    expect(prizeText('150 €', null, t)).toBe('150 €')
  })
  it('os dois: 1.º e 2.º', () => {
    expect(prizeText('200 €', ' 80 € ', t)).toBe('1.º 200 € · 2.º 80 €')
  })
  it('só o 2.º: diz que é do 2.º', () => {
    expect(prizeText('', '80 €', t)).toBe('2.º 80 €')
  })
  it('nenhum: vazio', () => {
    expect(prizeText(null, '  ', t)).toBe('')
  })
})

describe('timeChangedText (13 out: a hora de uma categoria mudou)', () => {
  const tt = (key, v) => `A ${v.code} do ${v.tournament} mudou para ${v.when} (era ${v.was}).`
  it('mesmo dia: só a hora antiga', () => {
    expect(timeChangedText({ category_code: 'M4', tournament_name: 'Open', old_day: '2026-10-17', new_day: '2026-10-17', old_time: '12:00:00', new_time: '14:00:00' }, tt, 'pt'))
      .toBe('A M4 do Open mudou para sáb 17 out, 14:00 (era 12:00).')
  })
  it('outro dia: o dia e a hora antigos', () => {
    expect(timeChangedText({ category_code: 'M4', tournament_name: 'Open', old_day: '2026-10-16', new_day: '2026-10-17', old_time: '12:00:00', new_time: '12:00:00' }, tt, 'pt'))
      .toBe('A M4 do Open mudou para sáb 17 out, 12:00 (era sex 16 out, 12:00).')
  })
})

describe('drawnText e finishedText (14 out: sorteio e fim no sino)', () => {
  const tt = (key, v) => `${key}|${Object.values(v).join('|')}`
  it('com hora e campo, só com hora, e sem hora', () => {
    expect(drawnText({ category_code: 'M4', tournament_name: 'Open', first_match_at: '2026-10-17T09:00:00Z', court_name: 'Campo 2' }, tt, 'pt'))
      .toBe('tournament.notice_drawn_court|M4|Open|sáb 17 out, 10:00|Campo 2')
    expect(drawnText({ category_code: 'M4', tournament_name: 'Open', first_match_at: '2026-10-17T09:00:00Z' }, tt, 'pt')).toMatch(/^tournament\.notice_drawn\|/)
    expect(drawnText({ category_code: 'M4', tournament_name: 'Open', first_match_at: null }, tt, 'pt')).toBe('tournament.notice_drawn_no_time|M4|Open')
  })
  it('1.º, 2.º/3.º, fora do pódio com e sem campeões', () => {
    expect(finishedText({ final_position: 1 }, tt)).toMatch(/^tournament\.notice_finished_won/)
    expect(finishedText({ final_position: 3 }, tt)).toMatch(/^tournament\.notice_finished_place\|.*\|3$/)
    expect(finishedText({ final_position: null, champion_name: 'Os Lobos' }, tt)).toMatch(/^tournament\.notice_finished_champion/)
    expect(finishedText({}, tt)).toMatch(/^tournament\.notice_finished\|/)
  })
})

describe('championText (UX, 14 out)', () => {
  const tt = () => 'e'
  it('equipa com nome fica; dupla sem nome com os nomes curtos', () => {
    expect(championText('Os Lobos', tt)).toBe('Os Lobos')
    expect(championText('Ana Moreira / Rui Costa', tt)).toBe('Ana M. e Rui C.')
  })
})
