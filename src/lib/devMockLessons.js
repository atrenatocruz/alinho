// Dev-only: dados fictícios das aulas com professores (Trello #49) para a
// sessão Admin(Dev) — ver devMockNetwork.js. Liga-se com
// localStorage.mockLessons = 'true'; mockLessonsEmpty = 'true' mostra os
// estados vazios. Os valores seguem os prints do desenho
// (design-handoff/2026-09-18-aulas-com-treinadores/prints 05, 06 e 08).

const on = () => localStorage.getItem('mockLessons') === 'true'
const empty = () => localStorage.getItem('mockLessonsEmpty') === 'true'

const TEACHERS = [
  {
    teacher_profile_id: 'tp-ana', user_id: 'u-ana', name: 'Ana Moreira', avatar_url: null, gender: 'feminino', rating: 1650,
    level_from: 6, level_to: 3, from_price: 15, open_series_count: 2, full_series_count: 0,
    free: { day: 0, start: '18:00', end: '21:00' },
  },
  {
    teacher_profile_id: 'tp-paulo', user_id: 'u-paulo', name: 'Paulo Reis', avatar_url: null, gender: 'masculino', rating: 1850,
    level_from: 5, level_to: 1, from_price: 20, open_series_count: 0, full_series_count: 3,
    free: { weekday: 6, start: '09:00', end: '13:00' },
  },
  {
    teacher_profile_id: 'tp-joana', user_id: 'u-joana', name: 'Joana Neves', avatar_url: null, gender: 'feminino', rating: 1450,
    level_from: 7, level_to: 7, from_price: 12, open_series_count: 0, full_series_count: 0, free: null,
  },
]

const isoWeekday = (d) => ((d.getDay() + 6) % 7) + 1
const at = (date, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number)
  const d = new Date(date)
  d.setHours(h, m, 0, 0)
  return d.toISOString()
}
const dayOffset = (n) => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + n)
  return d
}
const nextWeekday = (weekday) => {
  for (let i = 0; i < 7; i++) {
    const d = dayOffset(i)
    if (isoWeekday(d) === weekday) return d
  }
  return dayOffset(0)
}

const teacherRow = (tp) => {
  const { free, ...rest } = tp
  let next = { next_free_start: null, next_free_end: null }
  if (free) {
    const d = free.weekday ? nextWeekday(free.weekday) : dayOffset(free.day)
    next = { next_free_start: at(d, free.start), next_free_end: at(d, free.end) }
  }
  return { ...rest, ...next }
}

// Semana-tipo da Ana (1 = segunda): o que o print 06 mostra em "Esta semana"
// e o print 05 mostra dia a dia.
const ANA_WEEK = {
  1: [{ kind: 'busy', start: '09:00', end: '11:15' }, { kind: 'free', start: '18:00', end: '21:00' }],
  2: [{ kind: 'free', start: '09:00', end: '13:00' }, { kind: 'series', start: '19:00', end: '20:30', lesson_type: 'quad', taken: 2, capacity: 4, avg_rating: 1080, price_month: 60 }],
  3: [{ kind: 'busy', start: '10:00', end: '13:20' }],
  4: [{ kind: 'series', start: '17:00', end: '18:30', lesson_type: 'quad', taken: 3, capacity: 4, avg_rating: 1090, price_month: 60 }, { kind: 'free', start: '18:30', end: '21:00' }, { kind: 'busy', start: '21:00', end: '22:30' }],
  5: [{ kind: 'busy', start: '18:00', end: '20:00' }],
  6: [{ kind: 'free', start: '09:00', end: '13:00' }],
  7: [],
}

const weekItems = (fromIso, toIso) => {
  const from = new Date(fromIso)
  const to = new Date(toIso)
  const items = []
  for (const d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    for (const it of ANA_WEEK[isoWeekday(d)] || []) {
      const { start, end, ...rest } = it
      items.push({ ...rest, weekday: isoWeekday(d), starts_at: at(d, start), ends_at: at(d, end), avg_gender: 'masculino' })
    }
  }
  return items
}

const priceRow = (lesson_type, duration_minutes, peak, price_month, price_lesson) => ({
  id: `lp-${lesson_type}-${duration_minutes}-${peak}`, organization_id: '00000000-0000-0000-0000-0000000000aa',
  teacher_profile_id: null, lesson_type, duration_minutes, peak, price_month, price_lesson,
  valid_from: '2026-09-01', created_at: '2026-09-01T10:00:00Z',
})
// Print 06 (por aula, ponta) + print 08 (mês): fora de ponta ~10% abaixo.
const PEAK = [
  ['private', 60, 180, 40], ['private', 90, null, 55],
  ['duo', 60, null, 25], ['duo', 90, 110, 35],
  ['trio', 60, null, 20], ['trio', 90, 85, 28],
  ['quad', 60, null, 15], ['quad', 90, 60, 22], ['quad', 120, null, 28],
]
const PRICES = () => [
  ...PEAK.map(([t, d, m, l]) => priceRow(t, d, true, m, l)),
  ...PEAK.map(([t, d, m, l]) => priceRow(t, d, false, m == null ? null : Math.round(m * 0.9), Math.round(l * 0.9))),
  priceRow('trial', 60, true, null, 0), priceRow('trial', 60, false, null, 0),
]
const PEAK_HOURS = () => [
  ...[1, 2, 3, 4, 5].map((d) => ({ id: `ph-${d}`, day_of_week: d, start_time: '18:00', end_time: '22:00' })),
  ...[6, 7].map((d) => ({ id: `ph-${d}`, day_of_week: d, start_time: '09:00', end_time: '13:00' })),
]

export const LESSON_RPC_MOCKS = {
  list_club_teachers: () => (on() && !empty() ? TEACHERS.map(teacherRow) : []),
  get_teacher_page: (params) => {
    if (!on()) return null
    const base = TEACHERS.find((x) => x.teacher_profile_id === params?.p_teacher_profile_id) || TEACHERS[0]
    return {
      teacher: {
        ...teacherRow(base), contact: '914 555 666', zone: 'Almada',
        organization_id: '00000000-0000-0000-0000-0000000000aa', org_name: 'Smash Padel', org_slug: 'smash-padel', org_city: 'Almada',
      },
      prices: PRICES(),
      items: empty() ? [] : weekItems(params?.p_from, params?.p_to),
    }
  },
  set_lesson_prices: () => null,
  set_club_peak_hours: () => null,
  set_teacher_sort_order: () => null,
}

export const LESSON_TABLE_MOCKS = {
  lesson_prices: () => (on() && !empty() ? PRICES() : []),
  club_peak_hours: () => (on() && !empty() ? PEAK_HOURS() : []),
}
