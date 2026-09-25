import { supabase } from './supabase'

export const DAYS = [
  { value: 'segunda', labelKey: 'teachers.day_segunda' },
  { value: 'terca', labelKey: 'teachers.day_terca' },
  { value: 'quarta', labelKey: 'teachers.day_quarta' },
  { value: 'quinta', labelKey: 'teachers.day_quinta' },
  { value: 'sexta', labelKey: 'teachers.day_sexta' },
  { value: 'sabado', labelKey: 'teachers.day_sabado' },
  { value: 'domingo', labelKey: 'teachers.day_domingo' },
]

export const DAY_LABEL_KEY = Object.fromEntries(DAYS.map((d) => [d.value, d.labelKey]))

// RLS already scopes visibility: approved rows for orgs the caller belongs
// to, plus the caller's own row in any status, plus every row for an org
// the caller admins — so a plain select returns exactly what the viewer
// should see, no RPC needed.
export const listTeacherProfiles = async () => {
  const { data, error } = await supabase
    .from('teacher_profiles')
    .select('*, user:profiles!teacher_profiles_user_id_fkey(name, avatar_url), organization:organizations(name, slug), availability:teacher_availability(*)')
  if (error) throw error
  return data || []
}

// organizationId pode ser null (professor sem clube) e zone é opcional — as
// duas precisam de migration_teacher_profiles_open.sql; sem zona não se envia
// a coluna, para o pedido com clube continuar a funcionar antes disso.
export const requestTeacherProfile = async (organizationId, userId, contact, slots = [], zone = '') => {
  const { data, error } = await supabase
    .from('teacher_profiles')
    .insert([{
      organization_id: organizationId, user_id: userId, contact,
      ...(zone ? { zone } : {}),
      // Com clube fica à espera do clube (só depois da migração ter a coluna).
      ...(organizationId && zone !== undefined ? { club_status: 'pending' } : {}),
    }])
    .select()
    .single()
  if (error) throw error

  if (slots.length > 0) {
    const { error: slotsError } = await supabase
      .from('teacher_availability')
      .insert(slots.map((s) => ({ teacher_profile_id: data.id, day_of_week: s.day, start_time: s.start, end_time: s.end })))
    if (slotsError) throw slotsError
  }

  return data
}

// «O meu horário» (Trello #418): o próprio professor muda o contacto e a zona.
// A base de dados só lhe deixa escrever estas duas colunas (GRANT UPDATE
// (contact, zone)) e só na sua linha (policy «Owner can update own profile»).
export const updateTeacherContact = async (id, { contact, zone }) => {
  const { error } = await supabase
    .from('teacher_profiles')
    .update({ contact, zone: zone || null })
    .eq('id', id)
  if (error) throw error
}

// Troca o horário semanal inteiro (policy «Owner manages own availability»).
// Grava primeiro o novo e só depois apaga o antigo: se a gravação falhar, o
// professor não fica sem horário.
export const replaceTeacherAvailability = async (teacherProfileId, rows) => {
  const { data: old, error: readError } = await supabase
    .from('teacher_availability')
    .select('id')
    .eq('teacher_profile_id', teacherProfileId)
  if (readError) throw readError

  if (rows.length > 0) {
    const { error: insertError } = await supabase
      .from('teacher_availability')
      .insert(rows.map((r) => ({ teacher_profile_id: teacherProfileId, day_of_week: r.day, start_time: r.start, end_time: r.end })))
    if (insertError) throw insertError
  }

  const oldIds = (old || []).map((r) => r.id)
  if (oldIds.length > 0) {
    const { error: deleteError } = await supabase.from('teacher_availability').delete().in('id', oldIds)
    if (deleteError) throw deleteError
  }
}

export const withdrawTeacherProfile = async (id) => {
  const { error } = await supabase.from('teacher_profiles').delete().eq('id', id)
  if (error) throw error
}

// Professores à espera de o clube os aceitar (club_status, Francisco 16 set:
// a equipa Alinho confirma que é professor, o clube aceita-o no clube — só
// clubes, nunca grupos). Precisa de migration_teacher_profiles_open.sql.
export const listPendingClubTeachers = async (organizationId) => {
  const { data, error } = await supabase
    .from('teacher_profiles')
    .select('id, contact, zone, status, created_at, user:profiles!teacher_profiles_user_id_fkey(name, avatar_url)')
    .eq('organization_id', organizationId)
    .eq('club_status', 'pending')
  if (error) throw error
  return data || []
}

// makeAdmin (#550): ao aceitar, dar também papel de admin do clube. Só se
// manda quando é true, para a chamada de sempre continuar igual.
export const resolveTeacherClub = async (id, accept, makeAdmin = false) => {
  const { error } = await supabase.rpc('resolve_teacher_club', {
    p_id: id, p_accept: accept, ...(makeAdmin ? { p_make_admin: true } : {}),
  })
  if (error) throw error
}

// #550: o professor pode pedir QUALQUER clube da app, não só aqueles de que
// é membro. Procura por nome, sem acentos (migration_teacher_any_club.sql,
// Dev 3). Devolve [{ id, name, slug, location, group_logo_url }], máx. 20.
export const searchClubsForTeacher = async (query) => {
  const { data, error } = await supabase.rpc('search_clubs_for_teacher', { p_query: query || '' })
  if (error) throw error
  return data || []
}

// O clube só aparece ao lado do professor depois de o clube o aceitar. Antes
// da migração (club_status ainda não existe) mantém-se como era.
export const teacherClubName = (teacher) =>
  teacher?.organization && (teacher.club_status === undefined || teacher.club_status === 'accepted')
    ? teacher.organization.name
    : null

// Todos os pedidos pendentes, com ou sem clube — para o super admin no Gerir
// (quem aprova professores é sempre a equipa Alinho, Francisco 16 set). O RLS
// deixa um admin da plataforma ler todos (migration_teacher_profiles_open.sql).
export const listAllPendingTeacherRequests = async () => {
  const { data, error } = await supabase
    .from('teacher_profiles')
    .select('*, user:profiles!teacher_profiles_user_id_fkey(name, avatar_url), organization:organizations(name, slug)')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

export const approveTeacherProfile = async (id) => {
  const { error } = await supabase.rpc('approve_teacher_profile', { p_id: id })
  if (error) throw error
}

export const rejectTeacherProfile = async (id) => {
  const { error } = await supabase.rpc('reject_teacher_profile', { p_id: id })
  if (error) throw error
}
