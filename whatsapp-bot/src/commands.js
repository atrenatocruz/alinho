import { supabase } from './supabase.js'
import { getSettings } from './settings.js'
import { loadGame, getOpenMixes, formatDateTime } from './roster.js'
import { resolveProfileByPhoneJid, createGuestProfile } from './phone.js'
import { config } from './config.js'
import { helpText, helpFooter } from './messages.js'
import { t } from './locales.js'

function stripAccents(str) {
  return str.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

const IN_WORDS = ['in', 'dentro', 'estou dentro', 'to dentro', 'tou dentro', 'alinho']
const OUT_WORDS = ['out', 'fora', 'estou fora', 'saio']
const HELP_WORDS = ['/help', 'help', 'ajuda', '/ajuda']

const SUPLENTE_CONFIRM_TTL_MS = 10 * 60 * 1000

// Tracks "we asked sender X whether they want to join mix Y as a
// suplente" so their very next message is interpreted as that answer
// instead of a fresh command. In-memory only, keyed by sender+group —
// lost on bot restart, which is an acceptable trade-off since restarts
// are rare and the worst case is the person just retries "in".
const pendingSuplenteConfirmations = new Map()

function pendingKey(senderPn, groupJid) {
  return `${senderPn}:${groupJid}`
}

function getPendingConfirmation(senderPn, groupJid) {
  const key = pendingKey(senderPn, groupJid)
  const entry = pendingSuplenteConfirmations.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    pendingSuplenteConfirmations.delete(key)
    return null
  }
  return entry
}

/**
 * Parses one message into { action, code } or null (silently ignored —
 * covers all normal group chatter). `code`, when present, is a trailing
 * 4-digit mix code (e.g. "in 1234", "alinho 1234") used to pick a specific
 * mix when several are open at once; it's optional otherwise.
 */
function parseCommand(text) {
  const normalized = stripAccents(text.trim().toLowerCase())

  if (HELP_WORDS.includes(normalized)) return { action: 'help', code: null }
  if (IN_WORDS.includes(normalized)) return { action: 'in', code: null }
  if (OUT_WORDS.includes(normalized)) return { action: 'out', code: null }

  const match = normalized.match(/^(.+) (\d{4})$/)
  if (match) {
    const [, word, code] = match
    if (IN_WORDS.includes(word)) return { action: 'in', code }
    if (OUT_WORDS.includes(word)) return { action: 'out', code }
  }
  return null
}

const OPEN_STATUSES = new Set(['open', 'closed'])

function formatMixLine(mix, lang) {
  const location = mix.location ? `, ${mix.location}` : ''
  return `🆔 *${mix.short_code}* — ${mix.title}, ${formatDateTime(mix.date, lang)}${location}`
}

/**
 * Handles one incoming group message. First checks whether the sender has
 * a live "queres entrar como suplente?" question pending (see
 * `pendingSuplenteConfirmations`) — if so, this message is treated as the
 * Sim/Não answer, not a fresh command. Otherwise, only acts on exact
 * "in"/"out"/"help" text, optionally followed by a 4-digit mix code (see
 * parseCommand); everything else — including all normal group chatter —
 * is silently ignored.
 *
 * Successful joins/leaves don't get an explicit reply here: they write to
 * `participants`, which sync.js's Realtime subscription picks up and turns
 * into a fresh roster repost for that specific mix — that repost IS the
 * confirmation, matching the reference bot's behavior. Only rejections and
 * disambiguation prompts reply directly.
 */
export async function handleGroupMessage({ groupJid, senderPn, text, message }, { sendText }) {
  // Gate on hardcoded, in-memory checks first — normal group chatter never
  // matches either of these, so it never touches the DB (getSettings used
  // to run unconditionally here, costing every message a query).
  const pending = getPendingConfirmation(senderPn, groupJid)
  const parsed = parseCommand(text)
  if (!pending && !parsed) return

  const settings = await getSettings()
  if (!settings.whatsapp_group_jid || groupJid !== settings.whatsapp_group_jid) return

  // Resolved once, up front, and reused for the rest of this handler — every
  // reply below is addressed to this one sender specifically (unlike the
  // group broadcasts in roster.js/sync.js/reminders.js/autostart.js), so it
  // always uses their own profiles.language. An unresolved sender (not
  // found, or a fresh guest about to be created) falls back to 'pt'.
  const resolvedProfile = await resolveProfileByPhoneJid(senderPn)
  const lang = resolvedProfile?.language ?? 'pt'

  // Quote the sender's own message so a reply is unambiguous even when
  // several people send commands close together. Every reply also points
  // back to /help, except the help listing itself.
  const reply = (key, vars) => sendText(groupJid, `${t(key, lang, vars)}${helpFooter(lang)}`, { quoted: message })

  // Same check a plain resolveProfileByPhoneJid result needs before use
  // (e.g. fetched in parallel with getOpenMixes below) — avoids a redundant query.
  async function requireProfile(profile) {
    if (!profile) await reply('not_found', { appUrl: config.appUrl })
    return profile
  }

  // Only called on an actual join attempt (not "out", not disambiguation) —
  // a WhatsApp-only person becomes a real (is_guest) profile+membership right
  // then, so they can play without registering first, while still being
  // nudged to sign up for their history/friends/rewards (Trello #19).
  async function requireProfileOrCreateGuest(profile, senderPnForGuest) {
    if (profile) return { profile, isNewGuest: false }
    try {
      const created = await createGuestProfile(senderPnForGuest, message?.pushName)
      return { profile: created, isNewGuest: true }
    } catch (err) {
      console.error('Failed to create guest profile:', err)
      await reply('not_found', { appUrl: config.appUrl })
      return { profile: null, isNewGuest: false }
    }
  }

  if (pending) {
    const normalized = stripAccents(text.trim().toLowerCase())
    const key = pendingKey(senderPn, groupJid)

    if (normalized === 'sim') {
      pendingSuplenteConfirmations.delete(key)

      const { game } = await loadGame(pending.gameId)
      const gameIsFuture = new Date(game.date).getTime() > Date.now()
      if (!OPEN_STATUSES.has(game.status) || !gameIsFuture) {
        await reply('mix_no_longer_available')
        return
      }

      const { profile, isNewGuest } = await requireProfileOrCreateGuest(resolvedProfile, senderPn)
      if (!profile) return

      const { error: insertError } = await supabase
        .from('participants')
        .insert([{ game_id: pending.gameId, user_id: profile.id, status: 'waitlisted', joined_alone: true }])

      if (insertError) {
        if (insertError.code === '23505') {
          await reply('already_waitlisted')
          return
        }
        throw new Error(`Failed to insert waitlisted participant: ${insertError.message}`)
      }
      if (isNewGuest) {
        await reply('guest_waitlisted', { name: profile.name, appUrl: config.appUrl })
      } else {
        await reply('waitlisted')
      }
      return
    }

    if (normalized === 'nao') {
      pendingSuplenteConfirmations.delete(key)
      await reply('waitlist_declined')
      return
    }

    if (!pending.reprompted) {
      pending.reprompted = true
      await reply('did_not_understand_yes_no')
      return
    }
    // Already reprompted once for this pending question — stop nagging
    // and fall through to normal command parsing below (this might be a
    // genuine command, not a stray reply).
  }

  if (!parsed) return
  const { action, code } = parsed

  if (action === 'help') {
    await sendText(groupJid, helpText(lang), { quoted: message })
    return
  }

  // resolvedProfile was already fetched once, up front, alongside lang.
  const openMixes = await getOpenMixes()
  if (openMixes.length === 0) {
    await reply('no_open_mixes')
    return
  }

  // Joins/leaves a specific, already-resolved mix — the same logic
  // regardless of how that mix got picked (explicit code, the only-one-open
  // shortcut, or being the one mix the sender is in for a bare "out").
  async function actOnGame(mixRow, profile) {
    const { game, people, capacity } = await loadGame(mixRow.id)
    const gameIsFuture = new Date(game.date).getTime() > Date.now()

    if (!OPEN_STATUSES.has(game.status) || !gameIsFuture) {
      if (action === 'in') {
        await reply('no_open_mixes')
      } else {
        await reply('mix_already_started_out')
      }
      return
    }

    let isNewGuest = false
    if (action === 'in') {
      ;({ profile, isNewGuest } = await requireProfileOrCreateGuest(profile, senderPn))
    } else {
      profile = await requireProfile(profile)
    }
    if (!profile) return

    const { data: existingRows, error: existingError } = await supabase
      .from('participants')
      .select('id, user_id, partner_id, status')
      .eq('game_id', game.id)
      .in('status', ['confirmed', 'waitlisted'])

    if (existingError) throw new Error(`Failed to check existing participants: ${existingError.message}`)

    const ownConfirmedRow = existingRows.find((row) => row.user_id === profile.id && row.status === 'confirmed')
    const ownWaitlistRow = existingRows.find((row) => row.user_id === profile.id && row.status === 'waitlisted')
    const asPartnerRow = existingRows.find((row) => row.partner_id === profile.id)

    if (action === 'in') {
      if (ownConfirmedRow || asPartnerRow) {
        await reply('already_joined')
        return
      }
      if (ownWaitlistRow) {
        await reply('already_waitlisted')
        return
      }
      if (people.length >= capacity) {
        pendingSuplenteConfirmations.set(pendingKey(senderPn, groupJid), {
          gameId: game.id,
          expiresAt: Date.now() + SUPLENTE_CONFIRM_TTL_MS,
          reprompted: false,
        })
        await reply('mix_full_offer_waitlist')
        return
      }

      const { error: insertError } = await supabase
        .from('participants')
        .insert([{ game_id: game.id, user_id: profile.id, status: 'confirmed', joined_alone: true }])

      if (insertError) {
        if (insertError.code === '23505') {
          await reply('already_joined')
          return
        }
        throw new Error(`Failed to insert participant: ${insertError.message}`)
      }
      // A regular join gets no reply — the participants INSERT triggers a
      // roster repost via sync.js, and that repost IS the confirmation. A
      // brand-new guest still needs an explicit nudge, though: a bare
      // roster repost wouldn't explain what just happened or that signing
      // up unlocks their history/friends/rewards (Trello #19).
      if (isNewGuest) {
        await reply('guest_joined', { name: profile.name, appUrl: config.appUrl })
      }
      return
    }

    // action === 'out'
    if (asPartnerRow) {
      await reply('partner_joined_use_app')
      return
    }
    if (ownWaitlistRow) {
      await reply('waitlisted_use_app')
      return
    }
    if (!ownConfirmedRow) {
      await reply('not_joined')
      return
    }

    const { error: deleteError } = await supabase.from('participants').delete().eq('id', ownConfirmedRow.id)
    if (deleteError) throw new Error(`Failed to remove participant: ${deleteError.message}`)
    // No reply — the participants DELETE triggers a roster repost via sync.js.
  }

  if (code) {
    const game = openMixes.find((m) => m.short_code === code)
    if (!game) {
      await reply('mix_code_not_found', { code })
      return
    }
    await actOnGame(game, resolvedProfile)
    return
  }

  if (openMixes.length === 1) {
    await actOnGame(openMixes[0], resolvedProfile)
    return
  }

  // 2+ open mixes, no code given — disambiguate.
  if (action === 'in') {
    const list = openMixes.map((mix) => formatMixLine(mix, lang)).join('\n')
    await reply('disambiguate_in', { list, code: openMixes[0].short_code })
    return
  }

  // action === 'out': check the sender first so an unknown sender still
  // gets the existing rejection instead of a confusing "which mix?" prompt.
  const profile = await requireProfile(resolvedProfile)
  if (!profile) return

  const { data: rows, error } = await supabase
    .from('participants')
    .select('game_id, user_id, partner_id')
    .in('game_id', openMixes.map((m) => m.id))
    .eq('status', 'confirmed')

  if (error) throw new Error(`Failed to check existing participants: ${error.message}`)

  const memberGameIds = new Set(
    rows.filter((row) => row.user_id === profile.id || row.partner_id === profile.id).map((row) => row.game_id)
  )
  const memberMixes = openMixes.filter((m) => memberGameIds.has(m.id))

  if (memberMixes.length === 0) {
    await reply('not_in_any_open_mix')
    return
  }
  if (memberMixes.length > 1) {
    const list = memberMixes.map((mix) => formatMixLine(mix, lang)).join('\n')
    await reply('disambiguate_out', { list, code: memberMixes[0].short_code })
    return
  }

  await actOnGame(memberMixes[0], profile)
}
