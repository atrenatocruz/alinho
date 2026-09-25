// «Pedir aula» (Trello #392, assunto 1; desenho aprovado 26 set). Contas
// puras do ecrã, a partir do que get_teacher_booking devolve: os dias dos
// próximos 14 dias em que o professor dá aulas (do horário semanal, #418),
// as durações com preço, as horas que cabem e as ocupadas, e o preço.
// O servidor (request_lesson) volta a verificar tudo.
import { DAYS } from './teachers'

const pad = (n) => String(n).padStart(2, '0')
const toMin = (hhmm) => { const [h, m] = String(hhmm).slice(0, 5).split(':').map(Number); return h * 60 + m }
const fmt = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
// 1 = segunda … 7 = domingo
const isoWeekday = (d) => ((d.getDay() + 6) % 7) + 1
const DAY_INDEX = Object.fromEntries(DAYS.map((d, i) => [d.value, i + 1]))

export const LESSON_TYPES = ['private', 'duo', 'trio', 'quad']
export const DURATIONS = [60, 90, 120]

/** Hora local (Lisboa) de um dia + 'HH:MM' → Date. */
export const localDateTime = (dateIso, hhmm) => new Date(`${dateIso}T${String(hhmm).slice(0, 5)}:00`)

/**
 * Os blocos dos próximos `days` dias (a começar hoje), um por bloco do horário
 * semanal de cada clube: [{ key, date, weekday, start, end, tp, orgName }],
 * por ordem de dia e hora. Hoje só conta se o bloco ainda não acabou.
 */
export const upcomingBlocks = (profiles = [], now = new Date(), days = 14) => {
  const out = []
  for (let i = 0; i < days; i++) {
    const d = new Date(now); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + i)
    const wd = isoWeekday(d)
    const date = isoDate(d)
    for (const p of profiles) {
      for (const a of p.availability || []) {
        if (DAY_INDEX[a.day_of_week] !== wd) continue
        const start = String(a.start_time).slice(0, 5)
        const end = String(a.end_time).slice(0, 5)
        if (i === 0 && localDateTime(date, end) <= now) continue
        out.push({ key: `${date}|${start}|${p.teacher_profile_id}`, date, weekday: wd, start, end, tp: p.teacher_profile_id, orgName: p.org_name || null })
      }
    }
  }
  return out.sort((a, b) => (a.date === b.date ? toMin(a.start) - toMin(b.start) : a.date < b.date ? -1 : 1))
}

/** Toca na hora de ponta do clube nesse dia? (como lesson_peak: «mixed» conta como ponta) */
export const isPeak = (peakHours = [], weekday, start, duration) => {
  const s = toMin(start); const e = s + duration
  return peakHours.some((r) => Number(r.day_of_week) === weekday && s < toMin(r.end_time) && e > toMin(r.start_time))
}

/** Preço por pessoa em vigor (primeiro o do professor, senão o do clube), ou null. */
export const lessonPrice = (prices = [], tp, type, duration, peak, dateIso) => {
  const rows = prices
    .filter((p) => p.lesson_type === type && Number(p.duration_minutes) === duration && !!p.peak === !!peak
      && String(p.valid_from || '0000') <= dateIso && p.price_lesson != null
      && (p.teacher_profile_id === tp || p.teacher_profile_id == null))
    .sort((a, b) => ((b.teacher_profile_id === tp) - (a.teacher_profile_id === tp)) || String(b.valid_from).localeCompare(String(a.valid_from)))
  return rows.length ? Number(rows[0].price_lesson) : null
}

/** Durações que cabem no bloco e têm algum preço. */
export const availableDurations = (block, profile) => {
  if (!block || !profile) return []
  const len = toMin(block.end) - toMin(block.start)
  return DURATIONS.filter((d) => d <= len && LESSON_TYPES.some((t) =>
    [true, false].some((peak) => lessonPrice(profile.prices, block.tp, t, d, peak, block.date) != null)))
}

/**
 * As horas de começo (de 30 em 30) que cabem no bloco com esta duração:
 * [{ time, taken }], e `taken` quando choca com algo ocupado. Mais `noFit`:
 * a primeira hora de 30 em 30 dentro do bloco que já não cabe (para o texto
 * «12:00 não cabe 1h30»).
 */
export const startOptions = (block, duration, busy = [], now = new Date()) => {
  if (!block || !duration) return { options: [], noFit: null }
  const s = toMin(block.start); const e = toMin(block.end)
  const options = []
  let noFit = null
  for (let m = s; m < e; m += 30) {
    if (m + duration > e) { noFit = noFit ?? fmt(m); continue }
    const from = localDateTime(block.date, fmt(m))
    if (from <= now) continue
    const to = new Date(from.getTime() + duration * 60000)
    const taken = busy.some((b) => new Date(b.starts_at) < to && new Date(b.ends_at) > from)
    options.push({ time: fmt(m), taken })
  }
  return { options, noFit }
}

/** '10:30' + 90 → '12:00' */
export const endTime = (start, duration) => fmt(toMin(start) + duration)
