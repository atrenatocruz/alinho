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
