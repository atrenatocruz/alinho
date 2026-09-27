import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.SUPABASE_URL = 'http://localhost:1'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'x'
process.env.PHONE_HASH_SECRET = 'x'
process.env.APP_URL = 'https://alinho.pt'

const { supabase } = await import('../src/supabase.js')
const { installFakeSupabase } = await import('./fakeSupabase.js')
const { checkScheduledPosts, _clearSentPostsForTests } = await import('../src/reminders.js')
const { buildTournamentMessage, buildLessonSeriesMessage } = await import('../src/eventPosts.js')
const { _clearOpenMixesCacheForTests } = await import('../src/roster.js')
const { _resetGroupStateForTests } = await import('../src/sync.js')

const future = (days) => new Date(Date.now() + days * 864e5).toISOString()
const dateIn = (days) => future(days).slice(0, 10)

let db
beforeEach(() => {
  db = {
    whatsapp_groups: [{ organization_id: 'o', group_jid: 'g@g.us', label: 'x', levels: null }],
    organizations: [{ id: 'o', whatsapp_post_hours: [10] }],
    profiles: [{ id: 'prof', name: 'Rita Sousa' }],
    memberships: [], participants: [], games: [],
    feature_flags: [{ key: 'lessons', enabled: true }],
    tournaments: [
      { id: 't1', organization_id: 'o', name: 'Smash Cup by WFit', slug: 'smash-cup-by-wfit', location: 'Smash Padel Almada',
        starts_on: dateIn(10), ends_on: dateIn(12), entries_deadline: future(5), status: 'inscricoes', is_public: true, whatsapp_post_times: ['18:30:00'] },
      { id: 't-priv', organization_id: 'o', name: 'Privado', slug: 'privado', starts_on: dateIn(10), ends_on: dateIn(10),
        entries_deadline: null, status: 'inscricoes', is_public: false, whatsapp_post_times: ['18:30:00'] },
    ],
    tournament_categories: [
      { id: 'c-cheia', tournament_id: 't1', code: 'M5', slots: 1, status: 'inscricoes', position: 1 },
      { id: 'c-livre', tournament_id: 't1', code: 'MX4', slots: 8, status: 'inscricoes', position: 2 },
      { id: 'c-priv', tournament_id: 't-priv', code: 'F3', slots: 8, status: 'inscricoes', position: 1 },
    ],
    tournament_entries: [
      { id: 'e1', category_id: 'c-cheia', status: 'validada' },
      { id: 'e2', category_id: 'c-livre', status: 'suplente' },
    ],
    lesson_series: [
      { id: 's1', organization_id: 'o', teacher_profile_id: 'tp1', day_of_week: 2, start_time: '19:00:00', duration_minutes: 90,
        lesson_type: 'quad', level_from: 4, level_to: 3, visibility: 'public', status: 'active', ends_on: null,
        announce_whatsapp: true, whatsapp_post_times: ['18:30:00'] },
      { id: 's-sem', organization_id: 'o', teacher_profile_id: 'tp1', day_of_week: 3, start_time: '10:00:00', duration_minutes: 60,
        lesson_type: 'duo', visibility: 'public', status: 'active', ends_on: null, announce_whatsapp: false, whatsapp_post_times: ['18:30:00'] },
    ],
    lesson_enrolments: [
      { id: 'le1', series_id: 's1', status: 'confirmed' },
      { id: 'le2', series_id: 's1', status: 'leaving' },
      { id: 'le3', series_id: 's1', status: 'withdrawn' },
    ],
    teacher_profiles: [{ id: 'tp1', user_id: 'prof' }],
  }
  installFakeSupabase(supabase, db)
  _clearOpenMixesCacheForTests()
  _resetGroupStateForTests()
  _clearSentPostsForTests()
})

async function run(hour, minute) {
  const sent = []
  await checkScheduledPosts(
    { sendText: async (_g, text) => { sent.push(text); return `id-${sent.length}` }, getGroupMentions: async () => [] },
    { hour, minute, dayKey: '2026-09-27' },
  )
  return sent
}

test('às 18:30 saem o torneio e a turma com essa hora — com o link, e não o privado', async () => {
  const sent = await run(18, 32)
  const tournament = sent.find((x) => x.includes('Smash Cup'))
  assert.ok(tournament, 'o torneio sai')
  assert.match(tournament, /^📢 @all/)
  assert.match(tournament, /Categorias com vagas: MX4/, 'o M5 está cheio; o suplente não ocupa lugar')
  assert.doesNotMatch(tournament, /M5/)
  assert.match(tournament, /https:\/\/alinho\.pt\/torneio\/smash-cup-by-wfit/)
  assert.ok(!sent.some((x) => x.includes('Privado')), 'o privado não se anuncia')
  const lesson = sent.find((x) => x.includes('Turma a 4'))
  assert.ok(lesson, 'a turma sai')
  assert.match(lesson, /com Rita Sousa/)
  assert.match(lesson, /2 lugares livres/, '4 lugares, 1 confirmado e 1 a sair até ao fim do mês')
  assert.match(lesson, /\/professor\/tp1\/disponibilidade/)
  assert.ok(!sent.some((x) => x.includes('Turma a 2')), 'sem «Anunciar no WhatsApp» não sai')
  assert.equal(sent.length, 2)
})

test('não repete na mesma meia hora, e fora das horas não sai nada', async () => {
  assert.equal((await run(18, 31)).length, 2)
  assert.equal((await run(18, 40)).length, 0)
  assert.equal((await run(12, 0)).length, 0)
})

test('com as aulas desligadas, as turmas não saem', async () => {
  db.feature_flags[0].enabled = false
  const sent = await run(18, 31)
  assert.ok(!sent.some((x) => x.includes('Turma')))
  assert.equal(sent.length, 1)
})

test('sem horas escolhidas, o torneio sai às horas do clube', async () => {
  db.tournaments[0].whatsapp_post_times = null
  assert.ok(!(await run(18, 31)).some((x) => x.includes('Smash Cup')))
  assert.ok((await run(10, 1)).some((x) => x.includes('Smash Cup')))
})

test('os cartões, por extenso', () => {
  const t = buildTournamentMessage({ tournament: { name: 'Smash Cup', slug: 's', starts_on: '2026-10-09', ends_on: '2026-10-11', location: 'Almada', entries_deadline: '2026-10-05T22:59:00Z' }, openCodes: ['M5', 'MX4'] })
  assert.match(t, /📅 sex 9 out a dom 11 out/)
  assert.match(t, /Inscrições até seg 5 out, 23:59/)
  const l = buildLessonSeriesMessage({ series: { lesson_type: 'duo', day_of_week: 6, start_time: '09:00:00', duration_minutes: 60, teacher_profile_id: 'tp' }, free: 1, teacherName: null })
  assert.match(l, /Turma a 2\*/)
  assert.match(l, /ao sábado, 09:00 \(1h\)/)
  assert.match(l, /1 lugar livre/)
})
