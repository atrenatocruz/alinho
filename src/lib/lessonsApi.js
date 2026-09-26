// Aulas com professores (Trello #49) — leitura e escrita no Supabase.
// Contrato proposto em Alinho/design-handoff/2026-09-18-aulas-com-treinadores/
// PLANO-TECNICO.md (Fase 0, à espera do "sim" do Renato). Enquanto a
// migração não corre, as RPCs/tabelas não existem: quem chama trata
// errorKind(error) === 'not_ready' como "aulas ainda não disponíveis" e
// esconde a funcionalidade. Em localhost, localStorage.mockLessons = 'true'
// (com a sessão Admin(Dev)) devolve dados fictícios (devMockLessons.js).
import { supabase } from './supabase'

/** Separador Professores da página do clube, pela ordem do clube.
    Cada linha: teacher_profile_id, user_id, name, avatar_url, gender, rating,
    level_from, level_to (1..6, 7 = Iniciante; null = sem nível), from_price,
    next_free_start/next_free_end (ISO, próximo bloco livre nos 7 dias),
    open_series_count (turmas com lugar), full_series_count. */
export async function listClubTeachers(organizationId) {
  const { data, error } = await supabase.rpc('list_club_teachers', { p_organization_id: organizationId })
  if (error) throw error
  return data || []
}

/** Perfil público + disponibilidade de um professor entre duas datas.
    Devolve { teacher, prices, items } — items: { kind: 'series' | 'free' |
    'busy', starts_at, ends_at, lesson_type, taken, capacity, avg_rating,
    avg_gender, price_month, weekday } (ocupado vem sem detalhe). */
export async function getTeacherPage(teacherProfileId, fromIso, toIso) {
  const { data, error } = await supabase.rpc('get_teacher_page', {
    p_teacher_profile_id: teacherProfileId, p_from: fromIso, p_to: toIso,
  })
  if (error) throw error
  return data || null
}

/** Tabela de preços do clube (todas as revisões; o ecrã escolhe a que está
    em vigor com priceRowFor) e horas de ponta. */
export async function getClubLessonSettings(organizationId) {
  const [prices, peak] = await Promise.all([
    supabase.from('lesson_prices').select('*').eq('organization_id', organizationId).is('teacher_profile_id', null),
    supabase.from('club_peak_hours').select('*').eq('organization_id', organizationId),
  ])
  if (prices.error) throw prices.error
  if (peak.error) throw peak.error
  return { prices: prices.data || [], peakHours: peak.data || [] }
}

/** Grava uma revisão nova da tabela (em vigor a partir de hoje).
    rows: [{ lesson_type, duration_minutes, peak, price_month, price_lesson }] */
export async function saveClubLessonPrices(organizationId, rows) {
  const { error } = await supabase.rpc('set_lesson_prices', {
    p_organization_id: organizationId, p_teacher_profile_id: null, p_prices: rows,
  })
  if (error) throw error
}

/** Preços do próprio professor, sem clube (o Daniel, 26 set). */
export async function getTeacherLessonPrices(teacherProfileId) {
  const { data, error } = await supabase.from('lesson_prices').select('*').eq('teacher_profile_id', teacherProfileId)
  if (error) throw error
  return { prices: data || [], peakHours: [] }
}

/** A mesma revisão de tabela, mas do professor (set_lesson_prices deixa-o
    gravar com can_edit_lessons). */
export async function saveTeacherLessonPrices(teacherProfileId, rows) {
  const { error } = await supabase.rpc('set_lesson_prices', {
    p_organization_id: null, p_teacher_profile_id: teacherProfileId, p_prices: rows,
  })
  if (error) throw error
}

/** ranges: [{ day_of_week: 1..7, start_time: 'HH:MM', end_time: 'HH:MM' }] */
export async function saveClubPeakHours(organizationId, ranges) {
  const { error } = await supabase.rpc('set_club_peak_hours', { p_organization_id: organizationId, p_ranges: ranges })
  if (error) throw error
}

/** Ordem dos professores na página do clube. */
export async function saveTeacherOrder(organizationId, teacherProfileIds) {
  const { error } = await supabase.rpc('set_teacher_sort_order', {
    p_organization_id: organizationId, p_teacher_profile_ids: teacherProfileIds,
  })
  if (error) throw error
}

/** true quando a migração das aulas já correu (a tabela de preços existe). */
export async function lessonsAvailable() {
  const { error } = await supabase.from('lesson_prices').select('id').limit(1)
  return !error
}

// ── Fase 1b: turmas e inscrição ─────────────────────────────────────────

/** Turmas do clube (Gerir → Aulas → Turmas). Cada linha: series_id,
    teacher_profile_id, teacher_name, weekday (1..7), start_time 'HH:MM',
    duration_minutes, lesson_type, taken, capacity, price_month, level_from,
    level_to, gender_restriction, visibility, status, pending_requests. */
export async function listClubSeries(organizationId) {
  const { data, error } = await supabase.rpc('list_club_series', { p_organization_id: organizationId })
  if (error) throw error
  return data || []
}

/** Turma + alunos visíveis a quem pede (a privacidade é do servidor) +
    pedidos para entrar (só para quem gere). Devolve { series, students,
    hidden_count, avg_rating, requests }. */
export async function getSeriesRoster(seriesId) {
  const { data, error } = await supabase.rpc('get_series_roster', { p_series_id: seriesId })
  if (error) throw error
  return data
}

/** Cria uma turma. fields: teacher_profile_id, day_of_week, start_time,
    duration_minutes, lesson_type, price_peak, starts_on, level_from,
    level_to, gender_restriction, visibility, close_hours_before,
    accepts_trial, trial_free, announce_whatsapp. Devolve o id. */
export async function createLessonSeries(fields) {
  const { data, error } = await supabase.rpc('create_lesson_series', { p_fields: fields })
  if (error) throw error
  return data
}

/** O preço de uma turma (migration_lessons_7): price null = tabela;
    price sem until = «Outro preço» para sempre; com until = promoção. */
export async function setLessonSeriesPrice(seriesId, price, until) {
  const { error } = await supabase.rpc('set_lesson_series_price', { p_series_id: seriesId, p_price: price, p_until: until || null })
  if (error) throw error
}

/** Professor/clube aceita ou recusa um pedido para entrar na turma. */
export async function resolveEnrolment(enrolmentId, accept) {
  const { error } = await supabase.rpc('resolve_enrolment', { p_enrolment_id: enrolmentId, p_accept: accept })
  if (error) throw error
}

/** Aluno pede para entrar numa turma. */
export async function requestEnrolment(seriesId) {
  const { data, error } = await supabase.rpc('request_enrolment', { p_series_id: seriesId })
  if (error) throw error
  return data
}

/** Aluno retira o pedido ou cancela a inscrição (neste caso só conta no fim
    do mês — é o servidor que põe ends_on). */
export async function cancelEnrolment(enrolmentId) {
  const { error } = await supabase.rpc('cancel_enrolment', { p_enrolment_id: enrolmentId })
  if (error) throw error
}

/** Depois de o professor aceitar, o aluno confirma (ou desiste). */
export async function confirmEnrolment(enrolmentId, accept) {
  const { error } = await supabase.rpc(accept ? 'confirm_enrolment' : 'decline_enrolment', { p_enrolment_id: enrolmentId })
  if (error) throw error
}

// ── Fase 1c: dia a dia ──────────────────────────────────────────────────

/** As minhas aulas entre duas datas (uma por semana na turma), com o meu
    estado em cada uma. Linha: lesson_id, series_id, starts_at, ends_at,
    lesson_type, form, status, cancel_reason, cancel_note, teacher_name,
    teacher_profile_id, organization, price_month, price_per_person, taken,
    capacity, avg_rating, avg_gender, my_status, marked_by_name. */
export async function listMyLessons(fromIso, toIso) {
  const { data, error } = await supabase.rpc('list_my_lessons', { p_from: fromIso, p_to: toIso })
  if (error) throw error
  return data || []
}

/** Aulas em aberto que posso ver (visibilidade na base de dados), sem nomes
    de alunos e sem as completas. A distância filtra-se na Home. */
export async function listLessonEvents(fromIso, toIso) {
  const { data, error } = await supabase.rpc('list_lesson_events', { p_from: fromIso, p_to: toIso })
  if (error) throw error
  return data || []
}

/** "Não posso ir" (going = false) / "Afinal vou" (going = true), só nesse dia. */
export async function setLessonAttendance(lessonId, going) {
  const { error } = await supabase.rpc('set_lesson_attendance', { p_lesson_id: lessonId, p_going: going })
  if (error) throw error
}

/** Página da aula: { lesson, teacher, students (só os que posso ver),
    hidden_count, avg_rating, my_status, my_enrolment }. */
export async function getLesson(lessonId) {
  const { data, error } = await supabase.rpc('get_lesson', { p_lesson_id: lessonId })
  if (error) throw error
  return data
}

/** Professor/clube marca a falta de um aluno nessa aula ("ligou"). */
export async function markLessonAbsence(lessonId, userId, note) {
  const { error } = await supabase.rpc('mark_lesson_absence', { p_lesson_id: lessonId, p_user_id: userId, p_note: note || null })
  if (error) throw error
}

/** Cancelar só uma aula, com a razão (illness | holiday | other). */
export async function cancelLesson(lessonId, reason, note) {
  const { error } = await supabase.rpc('cancel_lesson', { p_lesson_id: lessonId, p_reason: reason, p_note: note || null })
  if (error) throw error
}

/** Cancelar um período (férias…) de uma turma. */
export async function cancelLessonPeriod(seriesId, fromIso, toIso, reason, note) {
  const { error } = await supabase.rpc('cancel_lesson_period', {
    p_series_id: seriesId, p_from: fromIso, p_to: toIso, p_reason: reason, p_note: note || null,
  })
  if (error) throw error
}

// ── Pedir aula (Trello #392, assunto 1; migration_lessons_3_requests.sql) ──

/** Tudo para o ecrã «Pedir aula», dos clubes todos do professor:
    { teacher, profiles: [{ teacher_profile_id, org_name, availability,
    peak_hours, prices }], busy: [{ starts_at, ends_at }], mine: [pedidos
    meus por fechar], i_have_whatsapp }. null com a marcação desligada. */
export async function getTeacherBooking(teacherProfileId) {
  const { data, error } = await supabase.rpc('get_teacher_booking', { p_teacher_profile_id: teacherProfileId })
  if (error) throw error
  return data || null
}

/** Envia o pedido. contactVia 'whatsapp' | 'email'; phone só com WhatsApp e
    só se a conta não estiver ligada ao WhatsApp (o servidor usa esse). */
export async function requestLesson({ teacherProfileId, startsAt, duration, type, contactVia, phone }) {
  const { data, error } = await supabase.rpc('request_lesson', {
    p_teacher_profile_id: teacherProfileId, p_starts_at: startsAt, p_duration: duration, p_type: type,
    p_contact_via: contactVia, p_phone: phone || null,
  })
  if (error) throw error
  return data
}

export async function cancelLessonRequest(id) {
  const { error } = await supabase.rpc('cancel_lesson_request', { p_id: id })
  if (error) throw error
}

// ── O professor responde (Trello #392, assunto 2; migration_lessons_4) ──

/** Pedidos que recebi como professor (todos os meus clubes), por responder
    primeiro. Cada um traz `contact_href` (wa.me / mailto) — o botão que o
    aluno escolheu; o número não vem escrito. */
export async function listMyTeacherRequests() {
  const { data, error } = await supabase.rpc('list_my_teacher_requests')
  if (error) throw error
  return data || []
}

/** Aceita o pedido tal como o aluno o fez: fica logo inscrito. */
export async function acceptLessonRequest(id) {
  const { data, error } = await supabase.rpc('accept_lesson_request', { p_id: id })
  if (error) throw error
  return data
}

export async function rejectLessonRequest(id) {
  const { error } = await supabase.rpc('reject_lesson_request', { p_id: id })
  if (error) throw error
}

/** «Já marquei» o campo com a receção do clube. */
export async function markLessonCourtBooked(id) {
  const { error } = await supabase.rpc('mark_lesson_court_booked', { p_id: id })
  if (error) throw error
}

/** Email (Edge Function send-email) — sempre um extra ao sino; se falhar,
    não se mostra erro nenhum. */
export function emailLessonRequest(type, requestId) {
  supabase.functions.invoke('send-email', { body: { type, request_id: requestId } })
    .catch((err) => console.error('Error sending lesson email:', err))
}

// ── Propor outra hora, dos dois lados (Trello #392; migration_lessons_5) ──

/** Professor ou aluno propõe outra hora; quem recebe é que aceita. */
export async function proposeLessonTime(id, startsAt) {
  const { error } = await supabase.rpc('propose_lesson_time', { p_id: id, p_starts_at: startsAt })
  if (error) throw error
}

/** Aceita a última proposta do outro lado: a aula fica marcada. */
export async function acceptLessonProposal(id) {
  const { data, error } = await supabase.rpc('accept_lesson_proposal', { p_id: id })
  if (error) throw error
  return data
}

// ── Juntar pedidos (Trello #392; migration_lessons_6_merge) ──

/** O professor propõe juntar pedidos numa aula. Só tem de aceitar o aluno a
    quem muda a hora, o preço ou o tipo; se ninguém, fica logo marcada. */
export async function proposeLessonMerge(requestIds, { startsAt, duration, type }) {
  const { data, error } = await supabase.rpc('propose_lesson_merge', {
    p_request_ids: requestIds, p_starts_at: startsAt, p_duration: duration, p_type: type,
  })
  if (error) throw error
  return data
}

export async function answerLessonMerge(mergeId, accept) {
  const { error } = await supabase.rpc('answer_lesson_merge', { p_merge_id: mergeId, p_accept: accept })
  if (error) throw error
}

export async function cancelLessonMerge(mergeId) {
  const { error } = await supabase.rpc('cancel_lesson_merge', { p_merge_id: mergeId })
  if (error) throw error
}
