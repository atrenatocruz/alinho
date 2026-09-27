import { supabase } from './supabase.js'
import { config } from './config.js'
import { getGroups, getGroupsForOrg, getServedOrgIds, mixVisibleToGroup } from './groups.js'
import { getOpenMixes, loadGame, formatDateTime, buildMixMessage, recordMixMessage, labelableMixes, mixLabel } from './roster.js'
import { cardSentRecently, noteCardSent } from './sync.js'
import { dueMixes, postKey, slotFor, mixPostTimes } from './postSchedule.js'
import { loadTournamentsToPost, buildTournamentMessage, loadOpenSlotGames, loadLessonSeriesToPost, buildLessonSeriesMessage } from './eventPosts.js'
import { loadOpenSlotBatch, buildOpenSlotsMessage } from './openSlots.js'
import { helpFooter } from './messages.js'
import { t } from './locales.js'

const GAME_DAY_CHECK_INTERVAL_MS = 10 * 60 * 1000 // 10 min — fine grain relative to reminderHoursBefore
const POST_CHECK_INTERVAL_MS = 5 * 60 * 1000 // tem de cair nos primeiros 15 min de cada hora (postSchedule.js)
const MAX_CARDS_PER_POST = 5


// A WhatsApp mention token is "@<digits>" inline in the text, matched up
// against the real JID passed in `options.mentions` — WhatsApp then renders
// it as that contact's name/number client-side.
function mentionToken(jid) {
  return `@${jid.split('@')[0]}`
}

async function loadConfirmedParticipantProfiles(gameId) {
  const { data: rows, error } = await supabase
    .from('participants')
    .select('user_id, partner_id')
    .eq('game_id', gameId)
    .eq('status', 'confirmed')
  if (error) throw new Error(`Failed to load participants for reminder: ${error.message}`)

  const ids = new Set()
  for (const row of rows) {
    ids.add(row.user_id)
    if (row.partner_id) ids.add(row.partner_id)
  }
  if (ids.size === 0) return []

  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, name, whatsapp_jid, language')
    .in('id', Array.from(ids))
  if (profilesError) throw new Error(`Failed to load participant profiles for reminder: ${profilesError.message}`)
  return profiles
}

/**
 * Sends the "mix starts in a few hours" reminder for one game: one group
 * post @-mentioning every confirmed participant whose WhatsApp JID is
 * already known (see phone.js), falling back to their app name for anyone
 * who's never messaged the group, PLUS a best-effort individual DM to each
 * participant whose JID is known. Marks reminder_sent_at so this never
 * re-fires for the same mix.
 */
async function sendGameDayReminder(game, { sendText }) {
  const profiles = await loadConfirmedParticipantProfiles(game.id)
  const hoursLeft = Math.max(1, Math.round((new Date(game.date).getTime() - Date.now()) / 3_600_000))
  const locationLine = game.location ? `\n📍 ${game.location}` : ''
  const whenGroup = formatDateTime(game.date)

  const rosterMentions = []
  const rosterNames = profiles.map((p) => {
    if (p.whatsapp_jid) {
      rosterMentions.push(p.whatsapp_jid)
      return mentionToken(p.whatsapp_jid)
    }
    return p.name
  })

  // Group post — aos grupos do clube deste mix que o conseguem ver
  // (filtro de nível). Addressed to everyone at once, not one profile, so
  // it stays 'pt' (see locales.js scope note). The individual DM below is
  // the one that respects each participant's own language.
  const groups = (await getGroupsForOrg(game.organization_id)).filter((g) => mixVisibleToGroup(game, g))
  const groupLang = 'pt'
  const rosterLine = rosterNames.length > 0 ? t('reminder_roster_line', groupLang, { names: rosterNames.join(' ') }) : ''
  const groupText =
    t('reminder_group', groupLang, { title: game.title, hours: hoursLeft, when: whenGroup, location: locationLine, roster: rosterLine }) +
    helpFooter(groupLang)
  for (const group of groups) {
    try {
      await sendText(group.groupJid, groupText, { mentions: rosterMentions })
    } catch (err) {
      console.error(`Failed to post game-day reminder to ${group.groupJid}:`, err)
    }
  }

  for (const profile of profiles) {
    if (!profile.whatsapp_jid) continue
    const lang = profile.language ?? 'pt'
    const whenForProfile = formatDateTime(game.date, lang)
    const dmText = t('reminder_dm', lang, { title: game.title, hours: hoursLeft, when: whenForProfile, location: locationLine })
    try {
      await sendText(profile.whatsapp_jid, dmText)
    } catch (err) {
      // Best-effort — a failed DM (blocked number, stale JID, etc.) never
      // blocks the others or the group post above.
      console.error(`Failed to DM game-day reminder to ${profile.name}:`, err)
    }
  }

  const { error } = await supabase.from('games').update({ reminder_sent_at: new Date().toISOString() }).eq('id', game.id)
  if (error) console.error('Failed to mark reminder_sent_at:', error)
}

async function checkGameDayReminders({ sendText }) {
  const orgIds = await getServedOrgIds()
  if (orgIds.length === 0) return

  const windowEnd = new Date(Date.now() + config.reminderHoursBefore * 3_600_000).toISOString()
  const { data: games, error } = await supabase
    .from('games')
    .select('*')
    .in('organization_id', orgIds)
    .in('status', ['open', 'closed'])
    // Jogos em aberto (origin='open_slot') não são mixes: são horários que
    // alguém abriu à espera de gente. O bot anunciava-os ao grupo como
    // "o mix Jogo em Aberto começa daqui a 3h", mesmo com 0 inscritos.
    .neq('origin', 'open_slot')
    .is('reminder_sent_at', null)
    .gt('date', new Date().toISOString())
    .lte('date', windowEnd)

  if (error) {
    console.error('Failed to check game-day reminders:', error)
    return
  }

  for (const game of games || []) {
    await sendGameDayReminder(game, { sendText }).catch((err) =>
      console.error(`Failed to send game-day reminder for game ${game.id}:`, err)
    )
  }
}

/**
 * As horas de publicação de cada clube (#553). Sem a migração
 * (migration_whatsapp_post_hours.sql) a coluna não existe: fica a hora de
 * sempre (DAILY_DIGEST_HOUR) para todos, como antes.
 */
export async function loadPostHours(orgIds) {
  const fallback = () => new Map(orgIds.map((id) => [id, [config.dailyDigestHour]]))
  if (orgIds.length === 0) return new Map()
  const { data, error } = await supabase.from('organizations').select('id, whatsapp_post_hours').in('id', orgIds)
  if (error) {
    if (error.code !== '42703') console.error('Failed to load WhatsApp post hours:', error)
    return fallback()
  }
  return new Map((data || []).map((org) => [org.id, Array.isArray(org.whatsapp_post_hours) ? org.whatsapp_post_hours : [config.dailyDigestHour]]))
}

/**
 * Publica, em cada grupo de WhatsApp do clube, o cartão completo de cada mix
 * aberto que ainda tem vagas — o mesmo cartão do anúncio e do «mix» (#552),
 * com o número 01/02 igual; responder «In» a um cartão inscreve nesse mix.
 * @all em cada publicação (escolha do Renato), mas uma vez por grupo: só na
 * 1.ª mensagem. Anti-bloqueio: no máximo 5 cartões por grupo, e não se
 * repete um cartão que saiu no grupo há menos de 10 min.
 */
// `onlyMixIds`: só estes mixes (os que têm esta hora — cada mix tem as suas
// desde 27 set). Sem ele, todos os abertos, como antes.
export async function publishOrgCards(orgId, { sendText, getGroupMentions }, { onlyMixIds = null } = {}) {
  const groups = await getGroupsForOrg(orgId)
  for (const group of groups) {
    try {
      const openMixes = (await getOpenMixes(group.organizationId)).filter((mix) => mixVisibleToGroup(mix, group))
      const labelable = labelableMixes(openMixes)
      const states = await Promise.all(
        openMixes
          .filter((mix) => !onlyMixIds || onlyMixIds.has(mix.id))
          .filter((mix) => !cardSentRecently(group.groupJid, mix.id)).map((mix) => loadGame(mix.id))
      )
      const withSpots = states.filter(({ people, capacity }) => people.length < capacity).slice(0, MAX_CARDS_PER_POST)
      if (withSpots.length === 0) continue

      const mentions = await getGroupMentions(group.groupJid)
      for (let i = 0; i < withSpots.length; i++) {
        const state = withSpots[i]
        const card = buildMixMessage(state, { label: mixLabel(state.game, labelable) })
        const text = i === 0 ? `📢 @all\n\n${card}` : card
        const messageId = await sendText(group.groupJid, text, i === 0 ? { mentions } : {})
        recordMixMessage(messageId, state.game.id)
        noteCardSent(group.groupJid, state.game.id, card, messageId)
      }
    } catch (err) {
      // Um grupo com problemas (JID inválido, expulso do grupo…) nunca
      // impede a publicação nos restantes.
      console.error(`Failed to publish mixes to ${group.groupJid}:`, err)
    }
  }
}

// No date library in this project — reading the current wall-clock time in
// a specific timezone via toLocaleString's implicit re-parse is the
// pragmatic option over pulling in a dependency for a couple of fields.
function lisbonNow() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Lisbon' }))
  return {
    hour: d.getHours(),
    minute: d.getMinutes(),
    // Dia de Lisboa como chave — o ISO em UTC mudava de dia umas horas antes.
    dayKey: new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Lisbon' }),
  }
}

const sentPosts = new Set()

// Cada mix às suas horas (games.whatsapp_post_times), às horas certas e às
// meias horas; sem horas escolhidas, as do clube. Exportada para os testes.
export async function checkScheduledPosts({ sendText, getGroupMentions }, now = lisbonNow()) {
  const { hour, minute, dayKey } = now
  const slot = slotFor(hour, minute)
  if (!slot) return
  const orgIds = await getServedOrgIds()
  const hoursByOrg = await loadPostHours(orgIds)
  for (const orgId of orgIds) {
    try {
      const due = dueMixes({ mixes: await getOpenMixes(orgId), orgHours: hoursByOrg.get(orgId), slot, dayKey, sent: sentPosts })
      if (due.length === 0) continue
      for (const mix of due) sentPosts.add(postKey(mix.id, dayKey, slot))
      await publishOrgCards(orgId, { sendText, getGroupMentions }, { onlyMixIds: new Set(due.map((mix) => mix.id)) })
    } catch (err) {
      console.error(`Failed to publish scheduled mixes for org ${orgId}:`, err)
    }
  }
  await publishOtherEvents({ sendText, getGroupMentions }, { orgIds, hoursByOrg, slot, dayKey })
}

/** Uma mensagem em todos os grupos do clube, com @all (como os cartões dos mixes). */
async function sendToOrgGroups(orgId, text, { sendText, getGroupMentions }) {
  for (const group of await getGroupsForOrg(orgId)) {
    try {
      const mentions = await getGroupMentions(group.groupJid)
      await sendText(group.groupJid, `📢 @all\n\n${text}`, { mentions })
    } catch (err) {
      console.error(`Failed to publish event to ${group.groupJid}:`, err)
    }
  }
}

/**
 * Torneios, jogos em aberto e turmas às horas de cada um (design-handoff/
 * 2026-09-27-whatsapp-no-evento): as mesmas regras dos mixes — as horas do
 * evento, ou as do clube; uma vez por meia hora; só com vagas.
 */
async function publishOtherEvents(deps, { orgIds, hoursByOrg, slot, dayKey }) {
  const isDue = (event, key) => mixPostTimes(event, hoursByOrg.get(event.organization_id)).includes(slot) && !sentPosts.has(postKey(key, dayKey, slot))

  try {
    for (const item of await loadTournamentsToPost(orgIds)) {
      const key = `t:${item.tournament.id}`
      if (!isDue(item.tournament, key)) continue
      sentPosts.add(postKey(key, dayKey, slot))
      await sendToOrgGroups(item.tournament.organization_id, buildTournamentMessage(item), deps)
    }
  } catch (err) {
    console.error('Failed to publish scheduled tournaments:', err)
  }

  try {
    for (const item of await loadLessonSeriesToPost(orgIds)) {
      const key = `l:${item.series.id}`
      if (!isDue(item.series, key)) continue
      sentPosts.add(postKey(key, dayKey, slot))
      await sendToOrgGroups(item.series.organization_id, buildLessonSeriesMessage(item), deps)
    }
  } catch (err) {
    console.error('Failed to publish scheduled lesson series:', err)
  }

  // Jogos em aberto: uma mensagem por lote (open_batch_id), como sempre;
  // sai se algum jogo do lote tem esta hora e ainda há lugar num deles.
  try {
    const games = await loadOpenSlotGames(orgIds)
    const batches = new Map()
    for (const game of games) {
      if (!game.open_batch_id || !isDue(game, `os:${game.open_batch_id}`)) continue
      batches.set(game.open_batch_id, game.organization_id)
    }
    for (const [batchId, orgId] of batches) {
      sentPosts.add(postKey(`os:${batchId}`, dayKey, slot))
      const batch = await loadOpenSlotBatch(batchId)
      const hasSpot = batch.games.some(({ game, people }) => people.length < (game.max_players || game.num_courts * 4))
      if (!hasSpot) continue
      await sendToOrgGroups(orgId, buildOpenSlotsMessage(batch), deps)
    }
  } catch (err) {
    console.error('Failed to publish scheduled open slots:', err)
  }
}

/** Só para testes. */
export function _clearSentPostsForTests() { sentPosts.clear() }

/** Starts both reminder loops. Call once from index.js, same shape as startSync. */
export function startReminders({ sendText, getGroupMentions }) {
  setInterval(() => {
    checkGameDayReminders({ sendText }).catch((err) => console.error('Game-day reminder check failed:', err))
  }, GAME_DAY_CHECK_INTERVAL_MS)

  setInterval(() => {
    checkScheduledPosts({ sendText, getGroupMentions }).catch((err) => console.error('Scheduled posts check failed:', err))
  }, POST_CHECK_INTERVAL_MS)
}
