// O calendário do professor em semanas a sério (Francisco, 27 set;
// design-handoff/2026-09-27-horario-em-semana/SPEC-calendario-2.md, assunto 1).
// Contas puras: o que está livre, marcado, pedido ou já passou em cada dia,
// a partir do get_teacher_booking (horário semanal + teacher_busy).

const DAY_INDEX = { segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6, domingo: 7 }
const pad = (n) => String(n).padStart(2, '0')
export const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const toMin = (hhmm) => { const [h, m] = String(hhmm).slice(0, 5).split(':').map(Number); return h * 60 + m }
export const fmtMin = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
const isoWeekday = (d) => ((d.getDay() + 6) % 7) + 1

/** Os 7 dias (seg a dom) da semana que contém `now`, mais `offset` semanas. */
export const weekDays = (now = new Date(), offset = 0) => {
  const monday = new Date(now); monday.setHours(12, 0, 0, 0)
  monday.setDate(monday.getDate() - (isoWeekday(monday) - 1) + offset * 7)
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(monday.getDate() + i); return d })
}

const merge = (list) => {
  const sorted = [...list].sort((a, b) => a.start - b.start)
  const out = []
  for (const s of sorted) {
    const last = out[out.length - 1]
    if (last && s.start <= last.end && last.kind === s.kind && last.tp === s.tp) last.end = Math.max(last.end, s.end)
    else out.push({ ...s })
  }
  return out
}

/**
 * O dia `date` (Date): [{ start, end (minutos do dia), kind, tp, past }].
 * kind: 'free' (horário sem nada), 'lesson' (aula marcada), 'request' (pedido
 * por responder), 'closed' (o professor fechou — só onde havia horário).
 * Uma aula aceite também é um pedido aceite: conta como aula.
 * O que acaba antes de `now` fica com past = true (partido ao meio se preciso).
 */
export const daySegments = (date, profiles = [], busy = [], now = new Date()) => {
  const wd = isoWeekday(date)
  const day = isoDate(date)
  const free = merge(profiles.flatMap((p) => (p.availability || [])
    .filter((a) => DAY_INDEX[a.day_of_week] === wd)
    .map((a) => ({ start: toMin(a.start_time), end: toMin(a.end_time), kind: 'free', tp: p.teacher_profile_id }))))

  const dayStart = new Date(`${day}T00:00:00`)
  const clip = (b) => {
    const s = Math.max(0, Math.round((new Date(b.starts_at) - dayStart) / 60000))
    const e = Math.min(24 * 60, Math.round((new Date(b.ends_at) - dayStart) / 60000))
    return e > s ? { start: s, end: e } : null
  }
  const lessons = merge(busy.filter((b) => b.kind === 'lesson').map(clip).filter(Boolean).map((x) => ({ ...x, kind: 'lesson', tp: null })))
  const requests = merge(busy.filter((b) => b.kind === 'request').map(clip).filter(Boolean)
    .filter((r) => !lessons.some((l) => r.start >= l.start && r.end <= l.end))
    .map((x) => ({ ...x, kind: 'request', tp: null })))
  const taken = [...lessons, ...requests]
  const closedRaw = merge(busy.filter((b) => b.kind === 'closed').map(clip).filter(Boolean).map((x) => ({ ...x, kind: 'closed', tp: null })))
  const minus = (list, cuts) => list.flatMap((f) => cuts.reduce((pieces, b) => pieces.flatMap((p) => {
    if (b.end <= p.start || b.start >= p.end) return [p]
    const out = []
    if (b.start > p.start) out.push({ ...p, end: b.start })
    if (b.end < p.end) out.push({ ...p, start: b.end })
    return out
  }), [{ ...f }]))
  // Fechado: só onde havia horário, e por baixo do que já está marcado.
  const closed = minus(free.flatMap((f) => closedRaw
    .filter((c) => c.start < f.end && c.end > f.start)
    .map((c) => ({ start: Math.max(c.start, f.start), end: Math.min(c.end, f.end), kind: 'closed', tp: f.tp }))), taken)

  // O livre é o horário menos o que já está ocupado ou fechado.
  const freeLeft = minus(free, [...taken, ...closedRaw])

  // Já passou: o que acaba antes de agora; o que está a meio parte-se.
  const nowMin = day < isoDate(now) ? 24 * 60 : day > isoDate(now) ? -1 : now.getHours() * 60 + now.getMinutes()
  const out = []
  for (const s of [...freeLeft, ...closed, ...taken]) {
    if (s.end <= nowMin) out.push({ ...s, past: true })
    else if (s.start < nowMin) out.push({ ...s, end: nowMin, past: true }, { ...s, start: nowMin, past: false })
    else out.push({ ...s, past: false })
  }
  return out.filter((s) => s.end > s.start).sort((a, b) => a.start - b.start)
}

/** Até onde se marca: 3 meses (Francisco, 27 set). A última semana que o calendário mostra. */
export const MAX_DAYS_AHEAD = 92
export const maxWeekOffset = (now = new Date()) => {
  const last = new Date(now); last.setDate(last.getDate() + MAX_DAYS_AHEAD)
  const mondayNow = weekDays(now, 0)[0]
  return Math.floor((last - mondayNow) / (7 * 86400000))
}

/** Hora cheia antes do primeiro e depois do último bloco da semana; null sem blocos. */
export const weekHourRange = (days) => {
  const all = days.flat()
  if (all.length === 0) return null
  return { from: Math.floor(Math.min(...all.map((s) => s.start)) / 60), to: Math.ceil(Math.max(...all.map((s) => s.end)) / 60) }
}

/** Tocar num bloco livre: a hora ou a meia hora mais perto, dentro do bloco. */
export const pickTime = (segment, minute) => {
  const rounded = Math.round(minute / 30) * 30
  const latest = Math.max(segment.start, segment.end - 60)
  return fmtMin(Math.min(Math.max(rounded, Math.ceil(segment.start / 30) * 30), Math.floor(latest / 30) * 30))
}
