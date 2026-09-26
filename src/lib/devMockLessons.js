// Dev-only: dados fictícios das aulas com professores (Trello #49) para a
// sessão Admin(Dev) — ver devMockNetwork.js. Liga-se com
// localStorage.mockLessons = 'true'; mockLessonsEmpty = 'true' mostra os
// estados vazios. Os valores seguem os prints do desenho
// (design-handoff/2026-09-18-aulas-com-treinadores/prints 05, 06 e 08).

const on = () => localStorage.getItem('mockLessons') === 'true'
const empty = () => localStorage.getItem('mockLessonsEmpty') === 'true'
// mockLessonMyStatus = 'requested' | 'accepted' | 'confirmed' — estado do
// aluno nas turmas da Ana, para ver os cartões de cada fase da inscrição.
const myStatus = () => localStorage.getItem('mockLessonMyStatus') || null

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
  2: [{ kind: 'free', start: '09:00', end: '13:00' }, { kind: 'series', series_id: 'ser-ter', start: '19:00', end: '20:30', lesson_type: 'quad', taken: 2, capacity: 4, avg_rating: 1080, price_month: 60 }],
  3: [{ kind: 'busy', start: '10:00', end: '13:20' }],
  4: [{ kind: 'series', series_id: 'ser-qui', start: '17:00', end: '18:30', lesson_type: 'quad', taken: 3, capacity: 4, avg_rating: 1090, price_month: 60 }, { kind: 'free', start: '18:30', end: '21:00' }, { kind: 'busy', start: '21:00', end: '22:30' }],
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
      items.push({ ...rest, weekday: isoWeekday(d), starts_at: at(d, start), ends_at: at(d, end), avg_gender: 'masculino', my_status: rest.kind === 'series' ? myStatus() : null, my_enrolment_id: rest.kind === 'series' && myStatus() ? 'en-me' : null })
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

const SERIES = [
  { series_id: 'ser-ter', teacher_profile_id: 'tp-ana', teacher_name: 'Ana Moreira', weekday: 2, start_time: '19:00', duration_minutes: 90, lesson_type: 'quad', taken: 2, capacity: 4, price_month: 60, level_from: 6, level_to: 4, gender_restriction: 'misto', visibility: 'public', status: 'active', pending_requests: 2 },
  { series_id: 'ser-qui', teacher_profile_id: 'tp-ana', teacher_name: 'Ana Moreira', weekday: 4, start_time: '17:00', duration_minutes: 90, lesson_type: 'quad', taken: 3, capacity: 4, price_month: 60, level_from: 6, level_to: 4, gender_restriction: 'misto', visibility: 'public', status: 'active', pending_requests: 0 },
  { series_id: 'ser-sab', teacher_profile_id: 'tp-paulo', teacher_name: 'Paulo Reis', weekday: 6, start_time: '10:00', duration_minutes: 90, lesson_type: 'trio', taken: 3, capacity: 3, price_month: 85, level_from: 3, level_to: 1, gender_restriction: 'masculino', visibility: 'club', status: 'active', pending_requests: 0 },
  { series_id: 'ser-new', teacher_profile_id: 'tp-joana', teacher_name: 'Joana Neves', weekday: 3, start_time: '18:00', duration_minutes: 60, lesson_type: 'quad', taken: 0, capacity: 4, price_month: 50, level_from: 7, level_to: 7, gender_restriction: 'misto', visibility: 'public', status: 'pending_teacher', pending_requests: 0 },
]
const hoursAgo = (h) => new Date(Date.now() - h * 3600000).toISOString()
const ROSTER = {
  'ser-ter': {
    students: [
      { enrolment_id: 'en-1', user_id: 'u-fb', name: 'Francisco Barros', avatar_url: null, rating: 1080, gender: 'masculino', status: 'confirmed' },
      { enrolment_id: 'en-2', user_id: 'u-ms', name: 'Marta Silva', avatar_url: null, rating: 1050, gender: 'feminino', status: 'confirmed' },
    ],
    requests: [
      { enrolment_id: 'en-3', user_id: 'u-js', name: 'João Silva', avatar_url: null, rating: 1100, gender: 'masculino', requested_at: hoursAgo(2) },
      { enrolment_id: 'en-4', user_id: 'u-rn', name: 'Rita Nunes', avatar_url: null, rating: 1020, gender: 'feminino', requested_at: hoursAgo(1) },
    ],
  },
}

// Home (Fase 1c): as minhas aulas nos próximos dias, com os estados do
// print 04 (inscrito, confirmada, não vais, a decidir, pedido, cancelada).
const SMASH = { id: 'co-1', name: 'Smash Padel', kind: 'club', group_logo_url: null, latitude: 38.7223, longitude: -9.1393 }
const lessonRow = (id, day, start, end, over) => {
  const d = dayOffset(day)
  return {
    lesson_id: id, series_id: null, starts_at: at(d, start), ends_at: at(d, end), lesson_type: 'quad', form: 'class',
    status: 'open', cancel_reason: null, cancel_note: null, teacher_name: 'Ana Moreira', teacher_profile_id: 'tp-ana',
    organization: SMASH, price_month: 60, price_per_person: 22, taken: 2, capacity: 4, avg_rating: 1080, avg_gender: 'masculino',
    my_status: 'confirmed', marked_by_name: null, weekday: isoWeekday(d), ...over,
  }
}
const MY_LESSONS = () => [
  lessonRow('les-1', 1, '19:00', '20:30', { series_id: 'ser-ter' }),
  lessonRow('les-2', 0, '21:00', '22:00', { form: 'single', lesson_type: 'private', teacher_name: 'Tiago Lopes', teacher_profile_id: 'tp-tiago', organization: null, price_per_person: 40, taken: 1, capacity: 1, status: 'confirmed', avg_rating: null }),
  lessonRow('les-3', 1, '11:30', '12:30', { form: 'single', lesson_type: 'duo', price_per_person: 25, taken: 1, capacity: 2, my_status: 'requested', avg_rating: null }),
  lessonRow('les-4', 2, '19:00', '20:30', { series_id: 'ser-qui', taken: 3, my_status: 'not_going', marked_by_name: null }),
  lessonRow('les-5', 2, '20:00', '21:00', { form: 'single', lesson_type: 'quad', price_per_person: 22, status: 'deciding', taken: 2 }),
  lessonRow('les-6', 7, '19:00', '20:30', { series_id: 'ser-ter', status: 'cancelled', cancel_reason: 'holiday', cancel_note: 'Voltamos na semana seguinte.' }),
]
const OPEN_LESSONS = () => [
  lessonRow('les-o1', 1, '10:00', '11:30', { form: 'single', lesson_type: 'trio', price_per_person: 28, taken: 2, capacity: 3, my_status: null }),
]

export const LESSON_RPC_MOCKS = {
  list_my_lessons: () => (on() && !empty() ? MY_LESSONS() : []),
  list_lesson_events: () => (on() && !empty() ? OPEN_LESSONS() : []),
  set_lesson_attendance: () => null,
  get_lesson: (params) => {
    const row = [...MY_LESSONS(), ...OPEN_LESSONS()].find((x) => x.lesson_id === params?.p_lesson_id) || MY_LESSONS()[0]
    const hidden = localStorage.getItem('mockLessonHidden') === 'true'
    return {
      lesson: { ...row, court: 'Campo 3', location: 'Smash Padel Almada', level_from: 6, level_to: 4, close_at: at(dayOffset(-1), '19:00') },
      teacher: { teacher_profile_id: row.teacher_profile_id, name: row.teacher_name, contact: '914 555 666' },
      students: hidden
        ? [{ user_id: 'u-rc', name: 'Rui Costa', avatar_url: null, rating: 1100, gender: 'masculino', is_me: false, friend: true }]
        : [
          { user_id: 'me', name: 'Francisco Barros', avatar_url: null, rating: 1080, gender: 'masculino', is_me: true, set_level: true },
          { user_id: 'u-rc', name: 'Rui Costa', avatar_url: null, rating: 1100, gender: 'masculino', is_me: false },
        ],
      hidden_count: hidden ? 3 : 0,
      avg_rating: row.avg_rating,
      my_status: hidden ? null : row.my_status,
      my_enrolment_id: row.series_id && !hidden ? 'en-me' : null,
    }
  },
  list_club_series: () => (on() && !empty() ? SERIES : []),
  get_series_roster: (params) => {
    const series = SERIES.find((x) => x.series_id === params?.p_series_id) || SERIES[0]
    const r = ROSTER[series.series_id] || { students: [], requests: [] }
    const next = nextWeekday(series.weekday)
    const [h, m] = series.start_time.split(':')
    const attendees = [
      ...r.students.map((st) => ({ user_id: st.user_id, name: st.name, rating: st.rating, gender: st.gender, role: 'class', status: 'confirmed' })),
      ...(r.students.length ? [
        { user_id: 'u-rc', name: 'Rui Costa', rating: 1100, gender: 'masculino', role: 'class', status: 'absent', marked_by_name: 'Ana', marked_note: 'ligou' },
      ] : []),
    ]
    return {
      series, students: r.students, requests: r.requests, hidden_count: 0, avg_rating: 1080,
      next_lesson: { lesson_id: `les-next-${series.series_id}`, starts_at: at(next, `${h}:${m}`), attendees },
    }
  },
  create_lesson_series: () => 'ser-created',
  resolve_enrolment: () => null,
  mark_lesson_absence: () => null,
  cancel_lesson: () => null,
  cancel_lesson_period: () => null,
  request_enrolment: () => ({ enrolment_id: 'en-new', status: 'requested' }),
  cancel_enrolment: () => null,
  confirm_enrolment: () => null,
  decline_enrolment: () => null,
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
      // Página do professor (#418, assunto 4): localStorage.mockTeacherPage =
      // 'noclub' (sem clube, contacto por email) | 'me' (o próprio professor).
      ...(localStorage.getItem('mockTeacherPage') === 'noclub' ? {
        teacher: { ...teacherRow(base), name: 'Tiago Lopes', gender: 'masculino', contact: 'tiago.lopes@mail.pt', zone: 'Cascais',
          organization_id: null, org_name: null, org_slug: null, org_city: null },
      } : {}),
      ...(localStorage.getItem('mockTeacherPage') === 'me' ? {
        teacher: { ...teacherRow(base), user_id: '00000000-0000-0000-0000-000000000000', contact: '914 555 666', zone: 'Almada',
          organization_id: '00000000-0000-0000-0000-0000000000aa', org_name: 'Smash Padel', org_slug: 'smash-padel', org_city: 'Almada' },
      } : {}),
    }
  },
  // «Pedir aula» (#392, entrega 2). localStorage.mockBookingSent = 'whatsapp'
  // | 'email' — já há um pedido meu por responder a este professor.
  get_teacher_booking: () => {
    if (!on()) return null
    const d = new Date(); d.setDate(d.getDate() + ((2 - d.getDay() + 7) % 7 || 7)); d.setHours(10, 30, 0, 0)
    const sent = localStorage.getItem('mockBookingSent')
    const out = {
      teacher: { user_id: 'u-tiago', name: 'Tiago Lopes', gender: 'masculino', avatar_url: null },
      profiles: [
        { teacher_profile_id: 'tp-ana', organization_id: 'o1', org_name: 'Clube Exemplo',
          availability: [{ day_of_week: 'terca', start_time: '09:00:00', end_time: '13:00:00' },
            { day_of_week: 'sabado', start_time: '09:00:00', end_time: '12:00:00' }],
          peak_hours: [{ day_of_week: 2, start_time: '18:00:00', end_time: '22:00:00' }], prices: PRICES() },
        { teacher_profile_id: 'tp-2', organization_id: 'o2', org_name: 'Clube Ex. 2',
          availability: [{ day_of_week: 'quinta', start_time: '18:00:00', end_time: '21:00:00' }],
          peak_hours: [], prices: PRICES().map((p) => ({ ...p, teacher_profile_id: null })) },
      ],
      busy: [{ starts_at: new Date(d.getTime() - 30 * 60000).toISOString(), ends_at: new Date(d.getTime() + 30 * 60000).toISOString(), kind: 'request' }],
      mine: sent ? [{ id: 'rq-1', teacher_profile_id: 'tp-ana', starts_at: d.toISOString(), duration_minutes: 90,
        lesson_type: 'duo', price_per_person: 35, contact_via: ['proposal', 'merge'].includes(sent) ? 'whatsapp' : sent, status: 'pending', org_name: 'Clube Exemplo',
        // localStorage.mockBookingSent = 'proposal' — o professor propôs outra hora.
        ...(sent === 'merge' ? { merge: { id: 'mg-1', starts_at: new Date(d.getTime() + 30 * 60000).toISOString(), duration_minutes: 60,
          lesson_type: 'duo', price_per_person: 23, status: 'pending' }, merge_answer: 'pending' } : {}),
        ...(sent === 'proposal' ? { proposed_by: 'teacher', proposed_starts_at: new Date(d.getTime() + 2 * 86400000 + 7.5 * 3600000).toISOString(), original_starts_at: d.toISOString() } : {}) }] : [],
      i_have_whatsapp: localStorage.getItem('mockHasWhatsapp') === 'true',
    }
    // localStorage.mockBookingEmpty = 'schedule' | 'prices' — o professor ainda
    // não pôs o horário, ou pôs o horário mas não os preços.
    const empty = localStorage.getItem('mockBookingEmpty')
    if (empty === 'schedule') out.profiles = out.profiles.map((p) => ({ ...p, availability: [] }))
    if (empty === 'prices') out.profiles = out.profiles.map((p) => ({ ...p, prices: [] }))
    return out
  },
  request_lesson: () => 'rq-new',
  // O professor responde (#392, entrega 3). localStorage.mockTeacherRequests =
  // 'two' (dois pedidos que chocam) | 'accepted' (+ uma aula aceite sem campo).
  list_my_teacher_requests: () => {
    const mode = localStorage.getItem('mockTeacherRequests')
    if (!mode) return []
    const d = new Date(); d.setDate(d.getDate() + ((2 - d.getDay() + 7) % 7 || 7)); d.setHours(10, 30, 0, 0)
    const at = (h, m) => { const x = new Date(d); x.setHours(h, m, 0, 0); return x.toISOString() }
    const ago = (mins) => new Date(Date.now() - mins * 60000).toISOString()
    const pending = [
      { id: 'rq-a', teacher_profile_id: 'tp-ana', status: 'pending', created_at: ago(120), starts_at: at(10, 30), duration_minutes: 90,
        lesson_type: 'duo', price_per_person: 35, org_name: 'Clube Exemplo', lesson_id: null, court_booked_at: null,
        student: { user_id: 'u-ana', name: 'Ana Silva', gender: 'feminino', rating: 1450 }, contact_via: 'whatsapp', contact_href: 'https://wa.me/351912345678' },
      { id: 'rq-r', teacher_profile_id: 'tp-ana', status: 'pending', created_at: ago(60), starts_at: at(11, 0), duration_minutes: 60,
        lesson_type: 'private', price_per_person: 40, org_name: 'Clube Exemplo', lesson_id: null, court_booked_at: null,
        student: { user_id: 'u-rui', name: 'Rui Costa', gender: 'masculino', rating: 1500 }, contact_via: 'email', contact_href: 'mailto:rui@example.com' },
    ]
    if (mode === 'merged') {
      const merge = { id: 'mg-1', starts_at: at(11, 0), duration_minutes: 60, lesson_type: 'duo', price_per_person: 23, status: 'pending' }
      return [{ ...pending[0], merge, merge_answer: 'pending' }, { ...pending[1], merge, merge_answer: 'accepted' }]
    }
    if (mode === 'proposals') {
      return [
        { ...pending[0], proposed_by: 'student', proposed_starts_at: at(12, 0), original_starts_at: pending[0].starts_at },
        { ...pending[1], proposed_by: 'teacher', proposed_starts_at: at(17, 0), original_starts_at: pending[1].starts_at },
      ]
    }
    if (mode === 'accepted') {
      return [pending[1], { ...pending[0], status: 'accepted', lesson_id: 'les-new' }]
    }
    return pending
  },
  accept_lesson_request: () => 'les-new',
  accept_lesson_proposal: () => 'les-new',
  propose_lesson_time: () => null,
  propose_lesson_merge: () => 'mg-1',
  answer_lesson_merge: () => null,
  cancel_lesson_merge: () => null,
  reject_lesson_request: () => null,
  mark_lesson_court_booked: () => null,
  cancel_lesson_request: () => null,
  set_lesson_prices: () => null,
  set_teacher_availability: () => null,
  set_club_peak_hours: () => null,
  set_teacher_sort_order: () => null,
}

export const LESSON_TABLE_MOCKS = {
  // Com teacher_profile_id: «Os meus preços» do professor sem clube (26 set);
  // localStorage.mockBookingEmpty = 'prices' mostra a tabela ainda vazia.
  lesson_prices: (url = '') => {
    const own = url.match(/teacher_profile_id=eq\.([^&]+)/)
    if (own) {
      return localStorage.getItem('mockBookingEmpty') === 'prices' ? []
        : PRICES().filter((r) => !r.peak).map((r) => ({ ...r, organization_id: null, teacher_profile_id: own[1] }))
    }
    return on() && !empty() ? PRICES() : []
  },
  club_peak_hours: () => (on() && !empty() ? PEAK_HOURS() : []),
}

// Avisos das aulas no sino (localStorage.mockLessonNotices = 'true').
export const LESSON_NOTICES = () => (localStorage.getItem('mockLessonNotices') === 'request' ? [
  { id: 'ln-r1', kind: 'lesson_request_new', game_id: null, created_at: new Date().toISOString(),
    data: { student_name: 'Ana Silva', starts_at: at(dayOffset(3), '10:30'), lesson_type: 'duo', org_name: 'Clube Exemplo' } },
  { id: 'ln-r2', kind: 'lesson_needs_court', game_id: null, created_at: new Date().toISOString(),
    data: { teacher_name: 'Tiago Lopes', student_name: 'Ana Silva', starts_at: at(dayOffset(3), '10:30'), org_name: 'Clube Exemplo' } },
] : localStorage.getItem('mockLessonNotices') === 'true' ? [
  { id: 'ln1', kind: 'lesson_enrolment_accepted', game_id: null, created_at: new Date().toISOString(),
    data: { teacher_name: 'Ana Moreira', teacher_profile_id: 'tp-ana', series_label: 'Turma a 4 de terças' } },
  { id: 'ln2', kind: 'lesson_cancelled', game_id: null, created_at: new Date().toISOString(),
    data: { teacher_name: 'Ana Moreira', lesson_id: 'les-6', lesson_date: at(dayOffset(7), '19:00'), reason: 'holiday' } },
  { id: 'ln3', kind: 'lesson_enrolment_request', game_id: null, created_at: new Date().toISOString(),
    data: { student_name: 'João Silva', series_label: 'Turma a 4 de terças', org_slug: 'dev-org' } },
  { id: 'ln4', kind: 'lesson_student_not_going', game_id: null, created_at: new Date().toISOString(),
    data: { student_name: 'Rui Costa', lesson_id: 'les-4', lesson_date: at(dayOffset(2), '19:00') } },
] : [])
