// Horário semanal do professor (Trello #418). O professor escreve-o no Perfil
// → «O meu horário»; grava-se em teacher_availability (dia + início/fim), que
// o próprio já pode escrever pela RLS («Owner manages own availability»).
// Aqui só as contas puras: validar, ordenar e ler o horário de volta.
import { DAYS } from './teachers'

const DAY_VALUES = DAYS.map((d) => d.value)
const pad = (n) => String(n).padStart(2, '0')

// De 30 em 30 min, das 6:00 às 23:30 (o horário é "de relógio", Lisboa).
export const TIME_OPTIONS = Array.from({ length: 36 }, (_, i) => {
  const mins = 6 * 60 + i * 30
  return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`
})

// '09:00:00' → '09:00'
export const shortTime = (value) => String(value || '').slice(0, 5)

const toMinutes = (hhmm) => {
  const [h, m] = shortTime(hhmm).split(':').map(Number)
  return h * 60 + m
}

/** Linhas de teacher_availability → { segunda: [{ start, end }], … } por ordem de hora. */
export const scheduleFromRows = (rows = []) => {
  const byDay = Object.fromEntries(DAY_VALUES.map((d) => [d, []]))
  for (const r of rows) {
    if (!byDay[r.day_of_week]) continue
    byDay[r.day_of_week].push({ start: shortTime(r.start_time), end: shortTime(r.end_time) })
  }
  for (const d of DAY_VALUES) byDay[d].sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
  return byDay
}

/** { segunda: [...] } → linhas para gravar, ordenadas por dia e hora. */
export const rowsFromSchedule = (byDay = {}) =>
  DAY_VALUES.flatMap((day) => [...(byDay[day] || [])]
    .sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
    .map((s) => ({ day, start: s.start, end: s.end })))

/**
 * Problemas do horário, para o ecrã não deixar gravar:
 *  · 'order'   — acaba antes (ou à mesma hora) de começar;
 *  · 'overlap' — choca com outro intervalo do mesmo dia.
 * Devolve [{ day, index, kind }], com o índice na lista desse dia.
 */
export const scheduleProblems = (byDay = {}) => {
  const problems = []
  for (const day of DAY_VALUES) {
    const slots = byDay[day] || []
    slots.forEach((s, index) => {
      if (toMinutes(s.end) <= toMinutes(s.start)) {
        problems.push({ day, index, kind: 'order' })
        return
      }
      const clash = slots.some((o, j) => j !== index
        && toMinutes(o.end) > toMinutes(o.start)
        && toMinutes(s.start) < toMinutes(o.end) && toMinutes(o.start) < toMinutes(s.end))
      if (clash) problems.push({ day, index, kind: 'overlap' })
    })
  }
  return problems
}

/** '09:00' → '9:00' (como no desenho aprovado, «9:00–13:00»). */
export const compactTime = (hhmm) => shortTime(hhmm).replace(/^0(\d)/, '$1')

/**
 * Pode entrar este intervalo no dia? null = sim; 'order' = acaba antes de
 * começar; 'overlap' = choca com um que já lá está.
 */
export const slotProblem = (slots = [], slot) => {
  if (toMinutes(slot.end) <= toMinutes(slot.start)) return 'order'
  const clash = slots.some((o) => toMinutes(slot.start) < toMinutes(o.end) && toMinutes(o.start) < toMinutes(slot.end))
  return clash ? 'overlap' : null
}

/** Próximo intervalo a propor ao carregar em «+ Horas» num dia. */
export const nextSlot = (slots = []) => {
  if (slots.length === 0) return { start: '09:00', end: '13:00' }
  const lastEnd = Math.max(...slots.map((s) => toMinutes(s.end)))
  const start = Math.min(lastEnd + 60, toMinutes('22:30'))
  const end = Math.min(start + 180, toMinutes('23:30'))
  const fmt = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
  return { start: fmt(start), end: fmt(end) }
}

/**
 * O horário semanal a partir dos itens «free» de get_teacher_page (uma semana
 * de seg a dom): [{ weekday 1..7, start, end }], sem repetidos, por ordem.
 */
export const weeklyFromItems = (items = []) => {
  const seen = new Set()
  const out = []
  for (const it of items) {
    if (it.kind !== 'free') continue
    const s = new Date(it.starts_at)
    const e = new Date(it.ends_at)
    const start = `${pad(s.getHours())}:${pad(s.getMinutes())}`
    const end = `${pad(e.getHours())}:${pad(e.getMinutes())}`
    const key = `${it.weekday}|${start}|${end}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ weekday: it.weekday, start, end })
  }
  return out.sort((a, b) => a.weekday - b.weekday || toMinutes(a.start) - toMinutes(b.start))
}
