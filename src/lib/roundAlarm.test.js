import { describe, it, expect, beforeEach } from 'vitest'
import { buildRoundSamples, loadAlarmPrefs, saveAlarmPrefs, ALARM_SECONDS } from './roundAlarm'

const RATE = 1000

describe('buildRoundSamples', () => {
  const total = 10
  const warn = 4
  const data = buildRoundSamples(total, warn, RATE)
  const at = (sec) => data[Math.floor(sec * RATE)]
  const loudIn = (from, to) => data.slice(Math.floor(from * RATE), Math.floor(to * RATE)).some((v) => v !== 128)

  it('dura a ronda mais o alarme', () => {
    expect(data.length).toBe((total + ALARM_SECONDS) * RATE)
  })
  it('o fundo é silêncio a sério', () => {
    expect(loudIn(0, total - warn)).toBe(false)
    expect(at(1)).toBe(128)
  })
  it('o aviso toca a `warn` segundos do fim', () => {
    expect(loudIn(total - warn, total - warn + 1.2)).toBe(true)
    expect(loudIn(total - warn + 1.3, total)).toBe(false)
  })
  it('o alarme toca no fim', () => {
    expect(loudIn(total, total + ALARM_SECONDS)).toBe(true)
  })
  it('sem aviso se o que falta for menos do que o aviso', () => {
    const d = buildRoundSamples(3, 60, RATE)
    expect(d.slice(0, 3 * RATE).every((v) => v === 128)).toBe(true)
  })
})

describe('as preferências (só neste telemóvel)', () => {
  const store = {}
  beforeEach(() => {
    globalThis.localStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v) },
      removeItem: (k) => { delete store[k] },
    }
    for (const k of Object.keys(store)) delete store[k]
  })
  it('no mix vem ligado, no resto desligado, com aviso de 1 min (Francisco, 27 set)', () => {
    expect(loadAlarmPrefs(true)).toEqual({ on: true, warn: 60 })
    expect(loadAlarmPrefs()).toEqual({ on: false, warn: 60 })
  })
  it('quem mexeu no interruptor fica com a sua escolha', () => {
    saveAlarmPrefs({ on: false, warn: 60 })
    expect(loadAlarmPrefs(true).on).toBe(false)
    saveAlarmPrefs({ on: true, warn: 60 })
    expect(loadAlarmPrefs(false).on).toBe(true)
  })
  it('lembra-se do aviso', () => {
    saveAlarmPrefs({ on: true, warn: 30 })
    expect(loadAlarmPrefs()).toEqual({ on: true, warn: 30 })
  })
  it('um aviso que não existe volta a 1 min', () => {
    saveAlarmPrefs({ on: true, warn: 45 })
    expect(loadAlarmPrefs().warn).toBe(60)
  })
})
