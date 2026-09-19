// Aulas com professores (Trello #49) — contas puras, sem Supabase.
// Fonte de verdade: Alinho/design-handoff/2026-09-18-aulas-com-treinadores/
// SPEC.md §3 e §7. O servidor guarda os valores finais (ex. o ajuste do 1.º
// mês na inscrição); isto serve para o ecrã mostrar o mesmo antes de gravar.
//
// Convenções: datas de calendário como 'YYYY-MM-DD' (hora local, Lisboa),
// horas como 'HH:MM', dia da semana 1..7 com 1 = segunda (como na base de
// dados: club_peak_hours / lesson_series).

/** Tipo de aula → lugares. */
export const LESSON_CAPACITY = { private: 1, duo: 2, trio: 3, quad: 4 }

/** Durações possíveis, em minutos. Não há aulas de 30 min (SPEC §3). */
export const LESSON_DURATIONS = [60, 90, 120]

const pad = (n) => String(n).padStart(2, '0')
const toIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const parseIso = (iso) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}
const minutesOf = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** Dia da semana 1..7 (1 = segunda) de uma Date local. */
export const isoWeekday = (date) => ((date.getDay() + 6) % 7) + 1

/** Datas ('YYYY-MM-DD') de um dia da semana num mês (month 1..12). */
export function weekdayDatesInMonth(year, month, weekday) {
  const out = []
  const d = new Date(year, month - 1, 1)
  while (d.getMonth() === month - 1) {
    if (isoWeekday(d) === weekday) out.push(toIso(d))
    d.setDate(d.getDate() + 1)
  }
  return out
}

/** Entrar a meio do mês (SPEC §3, regra 5): só nesse 1.º mês paga-se
    mensalidade × (aulas que faltam ÷ aulas do mês), contando os dias da
    turma no calendário a partir do dia em que entra (inclusive).
    60 €, 4 aulas no mês, faltam 2 → 30 €. Arredonda ao cêntimo. */
export function firstMonthAmount(monthlyPrice, weekday, startIso) {
  const start = parseIso(startIso)
  const all = weekdayDatesInMonth(start.getFullYear(), start.getMonth() + 1, weekday)
  const remaining = all.filter((iso) => iso >= startIso).length
  const total = all.length
  const amount = total === 0 ? 0 : Math.round((monthlyPrice * remaining * 100) / total) / 100
  return { amount, remaining, total, full: remaining === total }
}

/** Cancelar a turma só produz efeito no fim do mês (SPEC §3, regra 4):
    fica inscrito até ao último dia do mês em que cancela. */
export function enrolmentEndDate(cancelIso) {
  const d = parseIso(cancelIso)
  return toIso(new Date(d.getFullYear(), d.getMonth() + 1, 0))
}

/** Hora de ponta (SPEC §7): 'peak' se a aula cabe toda dentro de uma faixa
    de ponta desse dia, 'off' se não toca em nenhuma, 'mixed' se atravessa —
    nesse caso quem cria a aula escolhe o preço.
    peakHours: [{ day_of_week, start_time: 'HH:MM', end_time: 'HH:MM' }]. */
export function peakStatus(peakHours, weekday, startHHMM, durationMinutes) {
  const s = minutesOf(startHHMM)
  const e = s + durationMinutes
  const ranges = (peakHours || [])
    .filter((p) => Number(p.day_of_week) === weekday)
    .map((p) => [minutesOf(p.start_time), minutesOf(p.end_time)])
  if (ranges.some(([a, b]) => s >= a && e <= b)) return 'peak'
  const overlap = ranges.reduce((sum, [a, b]) => sum + Math.max(0, Math.min(e, b) - Math.max(s, a)), 0)
  return overlap === 0 ? 'off' : 'mixed'
}

/** Linha de preço em vigor (SPEC §7): a mais recente com valid_from <= data,
    primeiro a do próprio professor, senão a do clube. null se não houver.
    prices: linhas de lesson_prices. */
export function priceRowFor(prices, { teacherProfileId = null, lessonType, durationMinutes, peak, onIso }) {
  const candidates = (prices || []).filter((p) =>
    p.lesson_type === lessonType
    && Number(p.duration_minutes) === durationMinutes
    && Boolean(p.peak) === Boolean(peak)
    && p.valid_from <= onIso)
  const latest = (rows) => rows.sort((a, b) => (a.valid_from < b.valid_from ? 1 : -1))[0] || null
  const own = teacherProfileId ? latest(candidates.filter((p) => p.teacher_profile_id === teacherProfileId)) : null
  return own || latest(candidates.filter((p) => p.teacher_profile_id == null))
}

/** Durações que têm preço para um tipo (SPEC §6.1: "só aparecem durações com
    preço"). field: 'price_month' (turma) ou 'price_lesson' (aula). */
export function durationsWithPrice(prices, { teacherProfileId = null, lessonType, peak, onIso, field }) {
  return LESSON_DURATIONS.filter((durationMinutes) => {
    const row = priceRowFor(prices, { teacherProfileId, lessonType, durationMinutes, peak, onIso })
    return row != null && row[field] != null
  })
}

/** "desde 15 €" no separador Professores: o preço por aula mais baixo em
    vigor (qualquer tipo, duração e ponta/fora). null se não houver. */
export function lowestLessonPrice(prices, { teacherProfileId = null, onIso }) {
  let min = null
  for (const lessonType of Object.keys(LESSON_CAPACITY)) {
    for (const durationMinutes of LESSON_DURATIONS) {
      for (const peak of [true, false]) {
        const row = priceRowFor(prices, { teacherProfileId, lessonType, durationMinutes, peak, onIso })
        const v = row?.price_lesson
        if (v != null && (min == null || Number(v) < min)) min = Number(v)
      }
    }
  }
  return min
}

/** Quantas aulas de uma turma (dia da semana) caem entre duas datas,
    inclusive — para "3 ago – 17 ago · 6 aulas" ao cancelar um período. */
export function weekdayCountBetween(fromIso, toIso, weekday) {
  if (!fromIso || !toIso || toIso < fromIso) return 0
  let n = 0
  const d = parseIso(fromIso)
  const end = parseIso(toIso)
  while (d <= end) {
    if (isoWeekday(d) === weekday) n++
    d.setDate(d.getDate() + 1)
  }
  return n
}
