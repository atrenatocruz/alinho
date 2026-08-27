import { supabase } from './supabase.js'
import { config } from './config.js'
import { getSettings } from './settings.js'
import { HELP_FOOTER } from './messages.js'

const CHECK_INTERVAL_MS = 5 * 60 * 1000

// Duplicated from roster.js/reminders.js rather than shared — this
// codebase already accepts that small duplication over a shared-utils
// file for a one-line helper (see the identical copy in both of those).
function firstNameLastInitial(fullName) {
  const parts = fullName.trim().split(/\s+/)
  if (parts.length === 1) return parts[0]
  return `${parts[0]} ${parts[parts.length - 1][0]}.`
}

function mentionToken(jid) {
  return `@${jid.split('@')[0]}`
}

function pairKey(a, b) {
  return [a, b].sort().join('|')
}

// Port of src/lib/mixLogic.js's formDuplas — same algorithm, adapted to
// work off raw ids (user_id/partner_id) instead of hydrated profile
// objects, since the bot doesn't need the extra fields the web app's
// version carries through for display.
function formDuplas(participants, pointsById, repeatPairKeys) {
  const duplas = []
  const solos = []
  for (const row of participants) {
    if (row.partner_id) duplas.push([row.user_id, row.partner_id])
    else solos.push(row.user_id)
  }

  const pointsOf = (id) => pointsById[id] ?? 0
  solos.sort((a, b) => pointsOf(b) - pointsOf(a))

  while (solos.length >= 2) {
    const a = solos.shift()
    let idx = solos.findIndex((candidate) => !repeatPairKeys.has(pairKey(a, candidate)))
    if (idx === -1) idx = 0 // everyone left is a repeat — accept the closest rather than leave a gap
    const b = solos.splice(idx, 1)[0]
    duplas.push([a, b])
  }

  return duplas.map(([p1, p2]) => ({
    player1_id: p1,
    player2_id: p2,
    seed_ranking: pointsOf(p1) + pointsOf(p2),
  }))
}

/**
 * Forms duplas and starts one due mix — same DB writes as handleStartMix in
 * GameDetails.jsx (insert teams, flip status to in_progress), then
 * announces the pairings to the WhatsApp group, tagging both players in
 * each dupla whose WhatsApp JID is already known.
 */
async function autoStartMix(game, { sendText }) {
  const { data: participants, error: pErr } = await supabase
    .from('participants')
    .select('user_id, partner_id')
    .eq('game_id', game.id)
    .eq('status', 'confirmed')
  if (pErr) throw new Error(`Failed to load participants for auto-start: ${pErr.message}`)

  const { data: rankings, error: rErr } = await supabase.rpc('get_global_rankings')
  if (rErr) throw new Error(`Failed to load rankings for auto-start: ${rErr.message}`)
  const pointsById = Object.fromEntries((rankings || []).map((r) => [r.user_id, Math.round(r.rating || 0)]))

  const { data: previousGames } = await supabase
    .from('games')
    .select('id')
    .eq('organization_id', game.organization_id)
    .lt('date', game.date)
    .order('date', { ascending: false })
    .limit(1)
  let repeatPairKeys = new Set()
  if (previousGames?.[0]) {
    const { data: previousTeams } = await supabase
      .from('teams')
      .select('player1_id, player2_id')
      .eq('game_id', previousGames[0].id)
    repeatPairKeys = new Set((previousTeams || []).map((t) => pairKey(t.player1_id, t.player2_id)))
  }

  const duplas = formDuplas(participants || [], pointsById, repeatPairKeys)
  if (duplas.length < 2) {
    // Not enough confirmed players yet — leave status alone, try again
    // next tick (mirrors "São precisas pelo menos 2 duplas" client-side).
    return
  }

  const { data: insertedTeams, error: teamsError } = await supabase
    .from('teams')
    .insert(duplas.map((d) => ({ game_id: game.id, ...d })))
    .select('id, player1_id, player2_id')
  if (teamsError) throw new Error(`Failed to insert teams for auto-start: ${teamsError.message}`)

  const { error: statusError } = await supabase.from('games').update({ status: 'in_progress' }).eq('id', game.id)
  if (statusError) throw new Error(`Failed to flip game to in_progress for auto-start: ${statusError.message}`)

  const settings = await getSettings()
  if (!settings.whatsapp_group_jid) return

  const profileIds = insertedTeams.flatMap((t) => [t.player1_id, t.player2_id])
  const { data: profiles } = await supabase.from('profiles').select('id, name, whatsapp_jid').in('id', profileIds)
  const profileById = new Map((profiles || []).map((p) => [p.id, p]))

  const mentions = []
  const label = (profile) => {
    if (profile?.whatsapp_jid) {
      mentions.push(profile.whatsapp_jid)
      return mentionToken(profile.whatsapp_jid)
    }
    return firstNameLastInitial(profile?.name || 'Jogador')
  }

  const lines = insertedTeams.map(
    (t, i) => `${i + 1}. ${label(profileById.get(t.player1_id))} 🤝 ${label(profileById.get(t.player2_id))}`
  )

  const text = `🤖 🎾 *Duplas formadas para o mix ${game.title}!*\n\n${lines.join('\n')}\n\nBoa sorte! 🏆${HELP_FOOTER}`
  await sendText(settings.whatsapp_group_jid, text, { mentions })
}

async function checkAutoStartMixes({ sendText }) {
  const { data: games, error } = await supabase
    .from('games')
    .select('*')
    .eq('organization_id', config.organizationId)
    .in('status', ['open', 'closed'])
    .not('auto_start_hours_before', 'is', null)
    .gt('date', new Date().toISOString())

  if (error) {
    console.error('Failed to check auto-start mixes:', error)
    return
  }

  const now = Date.now()
  const due = (games || []).filter(
    (g) => new Date(g.date).getTime() - now <= g.auto_start_hours_before * 3_600_000
  )

  for (const game of due) {
    await autoStartMix(game, { sendText }).catch((err) =>
      console.error(`Auto-start failed for game ${game.id}:`, err)
    )
  }
}

/** Starts the auto-start polling loop. Call once from index.js, same shape as startReminders. */
export function startAutoStart({ sendText }) {
  setInterval(() => {
    checkAutoStartMixes({ sendText }).catch((err) => console.error('Auto-start check failed:', err))
  }, CHECK_INTERVAL_MS)
}
