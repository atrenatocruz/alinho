import { supabase } from './supabase.js'
import { getGroupByJid, mixVisibleToGroup } from './groups.js'
import { loadGame, getOpenMixes, formatDateTime, weekdayKeyPt, mixLocalParts, gameIdForMessage } from './roster.js'
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
const MIX_LIST_WORDS = ['mix', 'mixes']
// Longest first: "estou dentro" must win over "in" when both could start
// matching the same text — matters for the glued (no-space) parse below.
const ACTION_WORDS = [...IN_WORDS, ...OUT_WORDS].sort((a, b) => b.length - a.length)
const WEEKDAY_KEYS = ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo']

// Shape-only check, no DB access yet — just enough to tell "in7291"/"in01"
// (a real identifier glued on) apart from "interessante"/"inscrevi-me"
// (ordinary chat that happens to start with an action word). Whether the
// identifier actually matches an open mix is decided later, once the
// caller has the mix list, by matchOpenMixesByText/mixMatchesToken — this
// only gates whether parseCommand treats the glued form as a command at all.
function looksLikeIdentifier(rest) {
  return (
    /^\d{1,4}$/.test(rest) ||
    WEEKDAY_KEYS.includes(rest) ||
    /^m[1-6]$/.test(rest) ||
    /^\d{1,2}h\d{0,2}$/.test(rest) ||
    /^\d{1,2}:\d{2}$/.test(rest) ||
    /^\d{1,2}\/\d{1,2}$/.test(rest)
  )
}

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
 * Parses one message into { action, rest, glued } or null (silently
 * ignored — covers all normal group chatter). `action` is 'help', 'mix'
 * (list open mixes, join nothing), 'in', or 'out'. `rest`, when present, is
 * the leftover text after the action word — an identifier (or several,
 * space-separated) used to pick a mix when several are open at once, e.g.
 * "01", "segunda m4", "19h". `glued` is true when there was no space
 * between the action word and `rest` (see the no-space form below).
 */
function parseCommand(text) {
  const normalized = stripAccents(text.trim().toLowerCase()).replace(/\s+/g, ' ')

  if (HELP_WORDS.includes(normalized)) return { action: 'help', rest: null, glued: false }
  if (MIX_LIST_WORDS.includes(normalized)) return { action: 'mix', rest: null, glued: false }
  if (IN_WORDS.includes(normalized)) return { action: 'in', rest: null, glued: false }
  if (OUT_WORDS.includes(normalized)) return { action: 'out', rest: null, glued: false }

  for (const word of ACTION_WORDS) {
    const action = IN_WORDS.includes(word) ? 'in' : 'out'

    // Spaced form: "in 01", "in segunda m4" — a real space is a strong
    // enough signal to also allow a free-text (partial title/location)
    // fallback later, see matchOpenMixesByText.
    if (normalized.startsWith(`${word} `)) {
      const rest = normalized.slice(word.length + 1).trim()
      if (rest) return { action, rest, glued: false }
    }

    // Glued form: "in01", "insegunda", "alinhom4" — the identifier typed
    // straight after the action word with no space (confirmed real bug,
    // Francisco 2026-09-14: someone wrote "in7291" and the bot silently
    // ignored it). Only exact structured identifiers are tried for this
    // form — no free-text fallback — since treating any word that happens
    // to start with "in" as a command would misfire on normal group chat
    // ("interessante", "inscrevi-me").
    if (normalized.startsWith(word) && normalized.length > word.length && normalized[word.length] !== ' ') {
      const rest = normalized.slice(word.length).trim()
      if (rest && looksLikeIdentifier(rest)) return { action, rest, glued: true }
    }
  }
  return null
}

const OPEN_STATUSES = new Set(['open', 'closed'])

function formatMixLine(mix, lang, label) {
  const location = mix.location ? `, ${mix.location}` : ''
  const idPart = label ? `🔢 *${label}*` : '🎾'
  return `${idPart} — ${mix.title}, ${formatDateTime(mix.date, lang)}${location}`
}

/** Formats `matches` (a subset of `allOpenMixes`) for a disambiguation reply — labels come from each mix's position in the FULL open list, not the filtered subset, so they match what's printed on that mix's own WhatsApp message. */
function formatMixListForReply(matches, allOpenMixes, lang) {
  const total = allOpenMixes.length
  return matches
    .map((mix) => {
      const idx = allOpenMixes.findIndex((m) => m.id === mix.id)
      const label = total > 1 ? String(idx + 1).padStart(2, '0') : null
      return formatMixLine(mix, lang, label)
    })
    .join('\n')
}

/** Does this one identifier token single out `mix`? `label` is that mix's own "01"/"02" (null when it's the only mix open — nothing to number). Independent checks, not mutually exclusive — a token can validly hit more than one field of the same mix. */
function mixMatchesToken(mix, token, label) {
  if (label && token === label) return true

  if (/^\d+$/.test(token)) {
    // Bare digits, no leading zero required — "2" should still hit label "02".
    if (label && token.length <= 2 && String(Number(token)).padStart(2, '0') === label) return true
    // Legacy 4-digit short_code — kept working silently for anyone with
    // muscle memory from before this redesign, though it's no longer
    // printed anywhere.
    if (token.length === 4 && mix.short_code === token) return true
  }

  if (WEEKDAY_KEYS.includes(token) && weekdayKeyPt(mix.date) === token) return true

  if (/^m[1-6]$/.test(token) && mix.level && mix.level.toLowerCase() === token) return true

  const hhmm = token.match(/^(\d{1,2})h(\d{0,2})$/) || token.match(/^(\d{1,2}):(\d{2})$/)
  if (hhmm) {
    const hour = Number(hhmm[1])
    const minute = hhmm[2] ? Number(hhmm[2]) : null
    const local = mixLocalParts(mix.date)
    if (local.hour === hour && (minute === null || local.minute === minute)) return true
  } else if (/^\d{1,2}$/.test(token)) {
    // A bare 1-2 digit number that isn't this mix's label — try it as a
    // bare hour ("in segunda 21" — Ruben, 2026-09-14).
    const n = Number(token)
    if (n >= 0 && n <= 23 && mixLocalParts(mix.date).hour === n) return true
  }

  const dm = token.match(/^(\d{1,2})\/(\d{1,2})$/)
  if (dm) {
    const local = mixLocalParts(mix.date)
    if (local.day === Number(dm[1]) && local.month === Number(dm[2])) return true
  }

  if (mix.location && token.length >= 3 && stripAccents(mix.location.toLowerCase()).includes(token)) return true

  return false
}

/**
 * Resolves free-form identifier text (one or more space-separated tokens,
 * e.g. "segunda m4") against the currently open mixes. A mix qualifies only
 * if EVERY token matches at least one of its fields (Ruben, 2026-09-14: "in
 * segunda m4" should combine both, not just the first it recognizes).
 *
 * If not a single token was recognized as a structured identifier on any
 * mix, `rest` is instead tried as one partial-title/location phrase
 * (Francisco's original idea) — but only for the spaced form (`glued:
 * false`); the glued form never falls back to free text, to avoid
 * misfiring on ordinary chat that happens to start with an action word.
 */
function matchOpenMixesByText(openMixes, rest, { glued }) {
  const tokens = rest.split(' ').filter(Boolean)
  let anyStructuredHit = false

  const matched = openMixes.filter((mix, i) => {
    const label = openMixes.length > 1 ? String(i + 1).padStart(2, '0') : null
    return tokens.every((token) => {
      const hit = mixMatchesToken(mix, token, label)
      if (hit) anyStructuredHit = true
      return hit
    })
  })

  if (anyStructuredHit || glued) return { matched }

  const phrase = rest.trim()
  return {
    matched: openMixes.filter(
      (mix) =>
        stripAccents(mix.title.toLowerCase()).includes(phrase) ||
        (mix.location && stripAccents(mix.location.toLowerCase()).includes(phrase))
    ),
  }
}

/**
 * Handles one incoming group message. First checks whether the sender has
 * a live "queres entrar como suplente?" question pending (see
 * `pendingSuplenteConfirmations`) — if so, this message is treated as the
 * Sim/Não answer, not a fresh command. Otherwise, only acts on exact
 * "in"/"out"/"help"/"mix" text, optionally followed by identifier text used
 * to pick a mix when several are open (see parseCommand); everything else
 * — including all normal group chatter — is silently ignored.
 *
 * When several mixes are open, which one a bare "In"/"Out" refers to is
 * resolved in this order (2026-09-14 redesign, see the design spec):
 *   1. Replying to that mix's own WhatsApp message (native reply/quote).
 *   2. Explicit identifier text after the action word (number, weekday,
 *      time, level, location, or several combined — see
 *      matchOpenMixesByText).
 *   3. A bare action word with nothing else: if there's only one open mix,
 *      or the sender is already in every open mix but one, resolves
 *      straight to it; otherwise the bot asks which.
 *
 * Successful joins/leaves don't get an explicit reply here: they write to
 * `participants`, which sync.js's Realtime subscription picks up and turns
 * into a fresh roster repost for that specific mix — that repost IS the
 * confirmation, matching the reference bot's behavior. Only rejections and
 * disambiguation prompts reply directly.
 */
export async function handleGroupMessage({ groupJid, senderPn, text, message, quotedStanzaId }, { sendText }) {
  // Gate on hardcoded, in-memory checks first — normal group chatter never
  // matches either of these, so it never touches the DB (the group lookup
  // used to run unconditionally here, costing every message a query).
  const pending = getPendingConfirmation(senderPn, groupJid)
  const parsed = parseCommand(text)
  if (!pending && !parsed) return

  // Multi-grupo: o grupo de onde a mensagem veio determina o clube (e o
  // filtro de nível) de TUDO o resto deste handler. Grupo não mapeado em
  // whatsapp_groups → silêncio, como o gate antigo de JID único.
  const group = await getGroupByJid(groupJid)
  if (!group) return
  const organizationId = group.organizationId

  // Resolved once, up front, and reused for the rest of this handler — every
  // reply below is addressed to this one sender specifically (unlike the
  // group broadcasts in roster.js/sync.js/reminders.js/autostart.js), so it
  // always uses their own profiles.language. An unresolved sender (not
  // found, or a fresh guest about to be created) falls back to 'pt'.
  const resolvedProfile = await resolveProfileByPhoneJid(senderPn, organizationId)
  const lang = resolvedProfile?.language ?? 'pt'

  // Quote the sender's own message so a reply is unambiguous even when
  // several people send commands close together. Every reply also points
  // back to /help, except the help listing itself.
  const reply = (key, vars) => sendText(groupJid, `${t(key, lang, vars)}${helpFooter(lang)}`, { quoted: message })

  // Same check a plain resolveProfileByPhoneJid result needs before use —
  // avoids a redundant query.
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
      const created = await createGuestProfile(senderPnForGuest, message?.pushName, organizationId)
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
  const { action, rest, glued } = parsed

  if (action === 'help') {
    await sendText(groupJid, helpText(lang), { quoted: message })
    return
  }

  // resolvedProfile was already fetched once, up front, alongside lang.
  // Só os mixes do clube deste grupo, filtrados pelo nível do grupo — um
  // "In" aqui nunca pode inscrever alguém num mix que o grupo não vê.
  const openMixes = (await getOpenMixes(organizationId)).filter((mix) => mixVisibleToGroup(mix, group))
  if (openMixes.length === 0) {
    await reply('no_open_mixes')
    return
  }

  if (action === 'mix') {
    const list = formatMixListForReply(openMixes, openMixes, lang)
    await reply('mix_list', { count: openMixes.length, list })
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

  // 1) Replying to a specific mix's own message beats any identifier text
  // — that's the whole point of using the reply.
  if (quotedStanzaId) {
    const gameId = gameIdForMessage(quotedStanzaId)
    if (gameId) {
      const game = openMixes.find((m) => m.id === gameId)
      if (game) {
        await actOnGame(game, resolvedProfile)
        return
      }
      // The message being replied to exists in our map, but its mix isn't
      // open/visible to this group anymore (closed, cancelled, or filled
      // and completed) — say so plainly instead of silently falling
      // through to a confusing generic prompt.
      await reply('mix_no_longer_available')
      return
    }
    // Unknown stanzaId (bot restarted since that message, or a reply to
    // something else entirely) — degrade to normal text parsing below.
  }

  if (openMixes.length === 1) {
    await actOnGame(openMixes[0], resolvedProfile)
    return
  }

  // 2) Explicit identifier text after the action word ("in 01", "in segunda
  // m4", "in7291"...).
  if (rest) {
    const { matched } = matchOpenMixesByText(openMixes, rest, { glued })
    if (matched.length === 1) {
      await actOnGame(matched[0], resolvedProfile)
      return
    }
    if (matched.length > 1) {
      const list = formatMixListForReply(matched, openMixes, lang)
      await reply(action === 'in' ? 'disambiguate_in' : 'disambiguate_out', { list })
      return
    }
    await reply('mix_identifier_not_found')
    return
  }

  // 3) Bare "in"/"out", no identifier, no (resolvable) reply.
  if (action === 'in') {
    // Already joined every open mix but one? A bare "in" then means "the
    // one I'm missing" — no need to ask (Francisco, 2026-09-14).
    let candidates = openMixes
    if (resolvedProfile) {
      const { data: rows, error } = await supabase
        .from('participants')
        .select('game_id, user_id, partner_id')
        .in('game_id', openMixes.map((m) => m.id))
        .eq('status', 'confirmed')
      if (error) throw new Error(`Failed to check existing participants: ${error.message}`)
      const memberGameIds = new Set(
        rows.filter((row) => row.user_id === resolvedProfile.id || row.partner_id === resolvedProfile.id).map((row) => row.game_id)
      )
      const notJoined = openMixes.filter((m) => !memberGameIds.has(m.id))
      if (notJoined.length === 1) {
        await actOnGame(notJoined[0], resolvedProfile)
        return
      }
      if (notJoined.length > 0) candidates = notJoined
      // Already in ALL open mixes: nothing left to auto-resolve to, so
      // fall through and show the full list — asking is the least-wrong
      // option there.
    }
    const list = formatMixListForReply(candidates, openMixes, lang)
    await reply('disambiguate_in', { list })
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
    const list = formatMixListForReply(memberMixes, openMixes, lang)
    await reply('disambiguate_out', { list })
    return
  }

  await actOnGame(memberMixes[0], profile)
}
