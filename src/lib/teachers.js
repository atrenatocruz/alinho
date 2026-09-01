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

export const requestTeacherProfile = async (organizationId, userId, contact, slots) => {
  const { data, error } = await supabase
    .from('teacher_profiles')
    .insert([{ organization_id: organizationId, user_id: userId, contact }])
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

export const withdrawTeacherProfile = async (id) => {
  const { error } = await supabase.from('teacher_profiles').delete().eq('id', id)
  if (error) throw error
}

export const listPendingTeacherRequests = async (organizationId) => {
  const { data, error } = await supabase
    .from('teacher_profiles')
    .select('id, contact, created_at, user:profiles!teacher_profiles_user_id_fkey(name, avatar_url), availability:teacher_availability(*)')
    .eq('organization_id', organizationId)
    .eq('status', 'pending')
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
