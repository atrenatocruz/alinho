// Os outros eventos nos lembretes do WhatsApp (design-handoff/
// 2026-09-27-whatsapp-no-evento, aprovado pelo Francisco): às horas de cada
// um (whatsapp_post_times; sem horas escolhidas, as do clube), enquanto houver
// vagas, o robô volta a publicar nos grupos do clube:
//   · os TORNEIOS — um cartão com o link para a inscrição na app (no
//     WhatsApp não há «In» para torneios);
//   · os JOGOS EM ABERTO — a mesma mensagem combinada de sempre (openSlots.js),
//     onde o «In 18» continua a inscrever.
//   · as TURMAS — com o link para a página do professor, onde se pede para
//     entrar (regras do Dev 4, 27 set).
import { supabase } from './supabase.js'
import { config } from './config.js'
import { helpFooter } from './messages.js'
import { shortLink } from './roster.js'

const LOCALE = 'pt-PT'
const TAKEN_ENTRY_STATUSES = ['convite', 'sem_parceiro', 'por_validar', 'validada', 'selecionada']
const TZ = 'Europe/Lisbon'

/**
 * Os torneios com inscrições abertas e vagas, destes clubes: status
 * 'inscricoes', públicos (um privado não se anuncia), prazo ainda por passar,
 * e pelo menos uma categoria aberta com lugar (slots vazio = sem limite).
 * Devolve [{ tournament, openCodes }].
 */
export async function loadTournamentsToPost(orgIds, now = new Date()) {
  if (orgIds.length === 0) return []
  const { data: tournaments, error } = await supabase
    .from('tournaments')
    .select('id, organization_id, name, slug, location, starts_on, ends_on, entries_deadline, status, is_public, whatsapp_post_times')
    .in('organization_id', orgIds)
    .eq('status', 'inscricoes')
    .eq('is_public', true)
  if (error) {
    // Antes das migrações (coluna ou tabela em falta): sem torneios, como antes.
    if (!['42703', '42P01', 'PGRST205'].includes(error.code)) console.error('Failed to load tournaments to post:', error)
    return []
  }
  const open = (tournaments || []).filter((t) => !t.entries_deadline || new Date(t.entries_deadline) > now)
  if (open.length === 0) return []

  const { data: categories, error: catError } = await supabase
    .from('tournament_categories')
    .select('id, tournament_id, code, slots, status, position')
    .in('tournament_id', open.map((t) => t.id))
    .eq('status', 'inscricoes')
    .order('position', { ascending: true })
  if (catError) {
    console.error('Failed to load tournament categories to post:', catError)
    return []
  }
  const catIds = (categories || []).map((c) => c.id)
  let entries = []
  if (catIds.length > 0) {
    const { data, error: entError } = await supabase
      .from('tournament_entries')
      .select('category_id, status')
      .in('category_id', catIds)
      // Os que ocupam lugar, como na app (tournament_taken_slots, Dev 1):
      // os suplentes e quem desistiu não.
      .in('status', TAKEN_ENTRY_STATUSES)
    if (entError) {
      console.error('Failed to load tournament entries to post:', entError)
      return []
    }
    entries = data || []
  }
  const taken = new Map()
  for (const e of entries) taken.set(e.category_id, (taken.get(e.category_id) || 0) + 1)

  return open
    .map((tournament) => ({
      tournament,
      openCodes: (categories || [])
        .filter((c) => c.tournament_id === tournament.id && (c.slots == null || (taken.get(c.id) || 0) < c.slots))
        .map((c) => c.code),
    }))
    .filter((x) => x.openCodes.length > 0)
}

// «sex 9 out» — dia da semana curto, sem ponto.
function shortDay(date) {
  const wd = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', timeZone: TZ }).format(date).replace('.', '').slice(0, 3)
  const month = new Intl.DateTimeFormat(LOCALE, { month: 'short', timeZone: TZ }).format(date).replace('.', '')
  return `${wd} ${new Intl.DateTimeFormat(LOCALE, { day: 'numeric', timeZone: TZ }).format(date)} ${month}`
}
// As datas do torneio vêm como DATE ('2026-10-09'): o meio-dia evita que o
// fuso as empurre para a véspera.
const dateOnly = (d) => new Date(`${d}T12:00:00Z`)

/** O cartão do torneio: nome, dias, sítio, categorias com vagas, prazo e o link. */
export function buildTournamentMessage({ tournament, openCodes }, { fresh = false } = {}) {
  if (fresh) return buildTournamentMessageNew({ tournament, openCodes })
  const lines = [`🏆 *${tournament.name}*`]
  const from = shortDay(dateOnly(tournament.starts_on))
  const to = tournament.ends_on && tournament.ends_on !== tournament.starts_on ? shortDay(dateOnly(tournament.ends_on)) : null
  lines.push(`📅 ${to ? `${from} a ${to}` : from}`)
  if (tournament.location) lines.push(`📍 ${tournament.location}`)
  lines.push(`🎾 Categorias com vagas: ${openCodes.join(', ')}`)
  if (tournament.entries_deadline) {
    const d = new Date(tournament.entries_deadline)
    const time = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', timeZone: TZ }).format(d)
    lines.push(`⏳ Inscrições até ${shortDay(d)}, ${time}`)
  }
  lines.push('')
  lines.push(`👉 Inscreve-te na app: ${config.appUrl}/torneio/${tournament.slug || tournament.id}`)
  return lines.join('\n') + helpFooter('pt')
}

// «23h59», «19h».
function hourOf(date) {
  const [h, m] = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ }).format(date).split(':')
  return m === '00' ? `${Number(h)}h` : `${Number(h)}h${m}`
}

// «9 a 11 out», «30 set a 2 out», «9 out».
function dayRange(startsOn, endsOn) {
  const day = (d) => new Intl.DateTimeFormat(LOCALE, { day: 'numeric', timeZone: TZ }).format(d)
  const month = (d) => new Intl.DateTimeFormat(LOCALE, { month: 'short', timeZone: TZ }).format(d).replace('.', '')
  const from = dateOnly(startsOn)
  if (!endsOn || endsOn === startsOn) return `${day(from)} ${month(from)}`
  const to = dateOnly(endsOn)
  return month(from) === month(to) ? `${day(from)} a ${day(to)} ${month(to)}` : `${day(from)} ${month(from)} a ${day(to)} ${month(to)}`
}

/** Mensagens novas (design-handoff/2026-10-01-mensagens-whatsapp): sem os
 *  emojis repetidos, o link curto e sem o rodapé do /help. */
function buildTournamentMessageNew({ tournament, openCodes }) {
  const lines = [`🏆 *${tournament.name}*`]
  lines.push(`${dayRange(tournament.starts_on, tournament.ends_on)}${tournament.location ? ` · ${tournament.location}` : ''}`)
  lines.push(`Categorias com vagas: ${openCodes.join(', ')}`)
  if (tournament.entries_deadline) {
    const d = new Date(tournament.entries_deadline)
    lines.push(`Inscrições até ${shortDay(d)}, ${hourOf(d)}`)
  }
  lines.push('')
  lines.push(`👉 Inscreve-te em ${shortLink(`/torneio/${tournament.slug || tournament.id}`)}`)
  return lines.join('\n')
}

/** Os jogos em aberto destes clubes com inscrições abertas (para as horas de cada um). */
export async function loadOpenSlotGames(orgIds, now = new Date()) {
  if (orgIds.length === 0) return []
  const { data, error } = await supabase
    .from('games')
    .select('id, organization_id, open_batch_id, status, date, max_players, num_courts, whatsapp_post_times, origin')
    .in('organization_id', orgIds)
    .eq('origin', 'open_slot')
    .eq('status', 'open')
    .gt('date', now.toISOString())
  if (error) {
    console.error('Failed to load open slots to post:', error)
    return []
  }
  return data || []
}

// ── Turmas ────────────────────────────────────────────────────────────────
const LESSON_CAPACITY = { private: 1, duo: 2, trio: 3, quad: 4 }
const SERIES_TYPE = { private: 'Turma privada', duo: 'Turma a 2', trio: 'Turma a 3', quad: 'Turma a 4' }
const WEEKDAY = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'] // day_of_week 1 = segunda
const TAKEN_ENROLMENTS = ['accepted', 'confirmed', 'leaving'] // 'leaving' ocupa até ao fim do mês

/** As aulas estão ligadas? (feature_flags.lessons, lida a cada vez — muda sem reiniciar o robô) */
async function lessonsEnabled() {
  const { data, error } = await supabase.from('feature_flags').select('key, enabled').eq('key', 'lessons')
  if (error) return false
  return data?.[0]?.enabled === true
}

/**
 * As turmas a anunciar destes clubes (Dev 4, 27 set): announce_whatsapp,
 * 'active', 'public' ou 'club', ainda a decorrer, com a bandeira das aulas
 * ligada, e com lugar livre. Devolve [{ series, free, teacherName }].
 */
export async function loadLessonSeriesToPost(orgIds, now = new Date()) {
  if (orgIds.length === 0 || !(await lessonsEnabled())) return []
  const { data: series, error } = await supabase
    .from('lesson_series')
    .select('id, organization_id, teacher_profile_id, day_of_week, start_time, duration_minutes, lesson_type, level_from, level_to, visibility, status, ends_on, announce_whatsapp, whatsapp_post_times')
    .in('organization_id', orgIds)
    .eq('status', 'active')
    .eq('announce_whatsapp', true)
    .in('visibility', ['public', 'club'])
  if (error) {
    if (!['42703', '42P01', 'PGRST205'].includes(error.code)) console.error('Failed to load lesson series to post:', error)
    return []
  }
  const today = now.toLocaleDateString('en-CA', { timeZone: TZ })
  const running = (series || []).filter((s) => !s.ends_on || s.ends_on >= today)
  if (running.length === 0) return []

  const { data: enrolments, error: enrError } = await supabase
    .from('lesson_enrolments')
    .select('series_id, status')
    .in('series_id', running.map((s) => s.id))
    .in('status', TAKEN_ENROLMENTS)
  if (enrError) {
    console.error('Failed to load lesson enrolments to post:', enrError)
    return []
  }
  const taken = new Map()
  for (const e of enrolments || []) taken.set(e.series_id, (taken.get(e.series_id) || 0) + 1)

  const teacherIds = [...new Set(running.map((s) => s.teacher_profile_id))]
  const { data: teachers } = await supabase
    .from('teacher_profiles')
    .select('id, user:profiles!teacher_profiles_user_id_fkey(name)')
    .in('id', teacherIds)
  const teacherName = new Map((teachers || []).map((tp) => [tp.id, tp.user?.name || null]))

  return running
    .map((s) => ({ series: s, free: (LESSON_CAPACITY[s.lesson_type] || 0) - (taken.get(s.id) || 0), teacherName: teacherName.get(s.teacher_profile_id) || null }))
    .filter((x) => x.free > 0)
}

/** O cartão da turma: tipo e professor, dia e hora, nível, lugares e o link. */
export function buildLessonSeriesMessage({ series, free, teacherName }, { fresh = false } = {}) {
  if (fresh) return buildLessonSeriesMessageNew({ series, free, teacherName })
  const type = SERIES_TYPE[series.lesson_type] || 'Turma'
  const lines = [`🎓 *${type}${teacherName ? ` com ${teacherName}` : ''}*`]
  const day = WEEKDAY[(series.day_of_week || 1) - 1]
  const time = String(series.start_time || '').slice(0, 5)
  const h = Math.floor((series.duration_minutes || 60) / 60)
  const m = (series.duration_minutes || 60) % 60
  lines.push(`📅 Todas as semanas, ${day === 'sábado' || day === 'domingo' ? 'ao' : 'à'} ${day}, ${time} (${m ? `${h}h${m}` : `${h}h`})`)
  if (series.level_from || series.level_to) {
    const lv = series.level_from && series.level_to && series.level_from !== series.level_to
      ? `${series.level_from} a ${series.level_to}` : String(series.level_from || series.level_to)
    lines.push(`🎾 Nível ${lv}`)
  }
  lines.push(`🙋 ${free === 1 ? '1 lugar livre' : `${free} lugares livres`}`)
  lines.push('')
  lines.push(`👉 Pede para entrar na app: ${config.appUrl}/professor/${series.teacher_profile_id}/disponibilidade`)
  return lines.join('\n') + helpFooter('pt')
}

const WEEKDAY_PLURAL = ['Segundas', 'Terças', 'Quartas', 'Quintas', 'Sextas', 'Sábados', 'Domingos']

/** Mensagens novas: «Terças às 19h · nível M5 a M4», sem a hora repetida
 *  e sem o rodapé do /help. */
function buildLessonSeriesMessageNew({ series, free, teacherName }) {
  const type = SERIES_TYPE[series.lesson_type] || 'Turma'
  const lines = [`🎓 *${type}${teacherName ? ` com ${teacherName}` : ''}*`]
  const [h, m] = String(series.start_time || '').split(':')
  const time = !h ? '' : m && m !== '00' ? `${Number(h)}h${m}` : `${Number(h)}h`
  const when = `${WEEKDAY_PLURAL[(series.day_of_week || 1) - 1]}${time ? ` às ${time}` : ''}`
  if (series.level_from || series.level_to) {
    const lv = series.level_from && series.level_to && series.level_from !== series.level_to
      ? `${series.level_from} a ${series.level_to}` : String(series.level_from || series.level_to)
    lines.push(`${when} · nível ${lv}`)
  } else {
    lines.push(when)
  }
  lines.push(free === 1 ? '1 lugar livre' : `${free} lugares livres`)
  lines.push('')
  lines.push(`👉 Pede lugar em ${shortLink(`/professor/${series.teacher_profile_id}/disponibilidade`)}`)
  return lines.join('\n')
}
