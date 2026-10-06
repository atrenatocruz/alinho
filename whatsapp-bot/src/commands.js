import { supabase } from './supabase.js'
import { getGroupByJid, mixVisibleToGroup } from './groups.js'
import { loadGame, getOpenMixes, formatDateTime, weekdayKeyPt, mixLocalParts, gameIdForMessage, labelableMixes, mixLabel, buildMixMessage, recordMixMessage, shortWeekday, shortHour, shortLink } from './roster.js'
import { resolveProfileByPhoneJid, guestIdentity, ensureMembership, hashPhone } from './phone.js'
import { parseCopiedRoster, extraNames, isSenderName, normName, nameMatches as copiedNameMatches } from './copiedRoster.js'
import { config } from './config.js'
import { helpText, helpFooter } from './messages.js'
import { t } from './locales.js'
import { startTimer } from './timing.js'
import { partnerFromTypedNames, isOnlySenderName } from './partnerNames.js'
import { rememberName, seenName, usablePushName, notePlaceholder, renameDefaultPartner, renamePlaceholderFor } from './seenNames.js'
import { repostHooks, noteCardSent, cardUnchangedRecently } from './sync.js'

function stripAccents(str) {
  return str.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

const IN_WORDS = ['in', 'dentro', 'estou dentro', 'to dentro', 'tou dentro', 'alinho']
const OUT_WORDS = ['out', 'fora', 'estou fora', 'saio']
const HELP_WORDS = ['/help', 'help', 'ajuda', '/ajuda']
// Com e sem barra: o /help sempre aceitou as duas, e «/mix» é o que as
// pessoas escrevem por analogia (Renato, 24 set).
const MIX_LIST_WORDS = ['mix', 'mixes', 'mixs', '/mix', '/mixes', '/mixs']
// Longest first: "estou dentro" must win over "in" when both could start
// matching the same text — matters for the glued (no-space) parse below.
const ACTION_WORDS = [...IN_WORDS, ...OUT_WORDS].sort((a, b) => b.length - a.length)
const WEEKDAY_KEYS = ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo']
// Níveis dos mixes: M (masculino), F (feminino) e MX (misto), de 1 a 6 —
// «In mx4», «In f3» (Renato, 26 set; sem N, decisão do Francisco —
// migration_niveis_mx.sql). Em minúsculas, porque o texto já chega normalizado.
const LEVEL_TOKEN = /^(mx|m|f)[1-6]$/

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
    LEVEL_TOKEN.test(rest) ||
    /^\d{1,2}h\d{0,2}$/.test(rest) ||
    /^\d{1,2}:\d{2}$/.test(rest) ||
    /^\d{1,2}\/\d{1,2}$/.test(rest)
  )
}

const SUPLENTE_CONFIRM_TTL_MS = 10 * 60 * 1000

/** O trigger das vagas (migration_mix_capacity_guard.sql) recusa com a
 *  mensagem exata `game_full` quando outra pessoa apanhou a última vaga
 *  um instante antes. */
const isGameFull = (error) => /(^|\W)game_full$/.test(String(error?.message || '').trim())

// Tracks a question the bot asked sender X (out_pair menu, pair with someone
// not on the app) so their very next message is interpreted as that answer
// instead of a fresh command. (The old "queres entrar como suplente?" is
// gone since 6 Oct: a full mix now waitlists straight away.) In-memory only, keyed by sender+group —
// lost on bot restart, which is an acceptable trade-off since restarts
// are rare and the worst case is the person just retries "in".
const pendingSuplenteConfirmations = new Map()

// Pedidos de dupla à espera de resposta (Francisco, 27 set: «Prefiro que
// tenha de aceitar. Senão qualquer pessoa pode aceitar.»). Quem escreve
// «In com X», com o X inscrito sozinho, entra sozinho e o robô pergunta ao X;
// só o X (pelo número, com as contas do mesmo número) aceita com «Sim». Em
// memória: um reinício do robô deixa cair os pedidos, e os dois ficam
// inscritos sozinhos — o mesmo que um «Não».
const pairRequests = new Map() // `${groupJid}|${gameId}|${requesterId}` → pedido

/** Só para testes. */
export function _clearPairRequestsForTests() { pairRequests.clear() }

/** «Sim» / «Não» (com ou sem @) — a resposta a um pedido de dupla. */
function parsePairAnswer(text) {
  const n = stripAccents(String(text || '').trim().toLowerCase()).replace(/@\S+/g, ' ').replace(/[!.]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (['sim', 'aceito', 'sim aceito'].includes(n)) return 'yes'
  if (['nao', 'nao aceito'].includes(n)) return 'no'
  return null
}

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

/**
 * Separa, do texto depois do «In», o que diz QUAL mix («01», «segunda m4»)
 * do que diz COM QUEM («com João», ou uma menção @). A menção chega no texto
 * como «@351…» (ou os dígitos do LID) — sai do identificador, e quem é vem
 * de `mentionedPns`. Ex.: «in 01 com joao silva» → rest «01», nome «joao
 * silva»; «in @3519…» → rest null, com menção.
 */
function splitPartner(rest) {
  if (!rest) return { rest: null, partnerName: null }
  let r = rest.replace(/@\S+/g, ' ')
  let partnerName = null
  const m = r.match(/(?:^|\s)com\s+(.+)$/)
  if (m) {
    partnerName = m[1].replace(/\s+/g, ' ').trim() || null
    r = r.slice(0, m.index)
  } else {
    r = r.replace(/(?:^|\s)com\s*$/, ' ')
  }
  r = r.replace(/\s+/g, ' ').trim()
  return { rest: r || null, partnerName }
}

/** «joao silva» → «Joao Silva»: o texto chega em minúsculas (parseCommand normaliza). */
function titleCase(text) {
  return text.replace(/(^|\s)(\p{L})/gu, (_, sp, c) => sp + c.toUpperCase())
}

/** Todas as palavras escritas aparecem no nome (sem acentos, pelo início de cada palavra do nome). */
function nameMatches(fullName, query) {
  const words = stripAccents((fullName || '').toLowerCase()).split(/\s+/).filter(Boolean)
  return query.split(' ').every((q) => words.some((w) => w.startsWith(q)))
}

/** Esta conta é de quem escreveu? Com duas contas com o mesmo número
 *  (convidado do bot + conta registada), qualquer uma conta — phone.js,
 *  aliasIds. */
const isMine = (profile, id) => id != null && (id === profile?.id || (profile?.aliasIds ?? []).includes(id))

// A MESMA pergunta, ao nível da linha de participants, cobrindo também os
// convidados sem conta (a identidade deles é o hash do número — o `myHash`
// de quem escreve compara-se com o da inscrição). Uma conta também apanha a
// SUA linha-convidado (feita antes de se registar): mesma pessoa, mesmo
// número.
const rowOwnerIsMine = (identity, myHash, row) =>
  isMine(identity, row.user_id) || (row.guestPhoneHash != null && row.guestPhoneHash === myHash)
const rowPartnerIsMine = (identity, myHash, row) =>
  isMine(identity, row.partner_id) || (row.partnerGuestPhoneHash != null && row.partnerGuestPhoneHash === myHash)
const rowIsMine = (identity, myHash, row) =>
  rowOwnerIsMine(identity, myHash, row) || rowPartnerIsMine(identity, myHash, row)

const OPEN_STATUSES = new Set(['open', 'closed'])

// `fresh` (mensagens novas, 1 out): «01 · Mix M4 · Ter 22h30», sem a morada.
function formatMixLine(mix, lang, label, fresh = false) {
  if (fresh) return `${label ? `${label} · ` : '🎾 '}${mix.title} · ${shortWeekday(mix.date)} ${shortHour(mix.date)}`
  const location = mix.location ? `, ${mix.location}` : ''
  const idPart = label ? `🔢 *${label}*` : '🎾'
  return `${idPart} — ${mix.title}, ${formatDateTime(mix.date, lang)}${location}`
}

/** Formats `matches` (a subset of `allOpenMixes`) for a disambiguation reply — labels come from each mix's position in the FULL open list (excluding jogos em aberto, which are never numbered — see mixLabel), so they match what's printed on that mix's own WhatsApp message. */
function formatMixListForReply(matches, allOpenMixes, lang, fresh = false) {
  const labelable = labelableMixes(allOpenMixes)
  return matches.map((mix) => formatMixLine(mix, lang, mixLabel(mix, labelable), fresh)).join('\n')
}

/** As variáveis da pergunta «em qual mix?»: a lista, quantos são e, nas
 *  mensagens novas, as respostas possíveis («*In 01* ou *In 02*»). */
function disambiguateVars(matches, allOpenMixes, lang, fresh) {
  const labelable = labelableMixes(allOpenMixes)
  const labels = matches.map((mix) => mixLabel(mix, labelable)).filter(Boolean).map((label) => `*In ${label}*`)
  const options = labels.length > 1 ? `${labels.slice(0, -1).join(', ')} ${t('or', lang, {}, true)} ${labels[labels.length - 1]}` : labels[0] || '*In*'
  return { list: formatMixListForReply(matches, allOpenMixes, lang, fresh), count: matches.length, options }
}

/** O /help das mensagens novas (Francisco, 1 out): curto e conforme os mixes
 *  abertos do grupo — a linha da dupla só se algum aceita duplas, a dos
 *  números só com 2 ou mais abertos. In, Out e Sim sempre. */
export function buildHelp(openMixes, lang) {
  const numbered = labelableMixes(openMixes)
  const lines = [t('help_title', lang, {}, true), t('help_in', lang, {}, true), t('help_out', lang, {}, true)]
  if (openMixes.some((mix) => mix.allow_pair_signup && !mix.rotate_partners)) lines.push(t('help_pair', lang, {}, true))
  lines.push(t('help_yes', lang, {}, true))
  if (numbered.length >= 2) lines.push(t('help_numbers', lang, {}, true))
  lines.push('')
  lines.push(t('help_more', lang, { link: shortLink('/instrucoes') }, true))
  return lines.join('\n')
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

  if (LEVEL_TOKEN.test(token) && mix.level && mix.level.toLowerCase() === token) return true

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
  if (mix.title && token.length >= 3 && stripAccents(mix.title.toLowerCase()).includes(token)) return true

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
  const labelable = labelableMixes(openMixes)
  let anyStructuredHit = false

  const matched = openMixes.filter((mix) => {
    const label = mixLabel(mix, labelable)
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
 * a live question pending (see `pendingSuplenteConfirmations`) — if so,
 * this message is treated as the answer, not a fresh command. Otherwise, only acts on exact
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
// Mede cada comando (timing.js): uma linha de log por comando, só para os
// que passaram o filtro (a conversa normal do grupo não escreve nada).
export async function handleGroupMessage(payload, deps) {
  const ctx = { timer: startTimer('cmd'), action: null }
  // O nome de quem escreve, para quando for mencionado («In @Gonçalo»):
  // só memória, a conversa normal do grupo continua sem ir à BD.
  const pushName = payload.message?.pushName
  rememberName(payload.senderPn, pushName)
  rememberName(payload.senderJid, pushName)
  await renamePlaceholderFor(payload.senderPn, pushName)
  try {
    return await handleGroupMessageInner(payload, deps, ctx)
  } finally {
    if (ctx.action) ctx.timer.end({ action: ctx.action, group: payload.groupJid })
  }
}

async function handleGroupMessageInner({ groupJid, senderPn, text, message, key, quotedStanzaId, mentionedJids = [], mentionedPns = [] }, { sendText, sendReaction }, ctx) {
  const timer = ctx.timer

  // «Confirmar 482917» no grupo (Ruben, 1 out): valida o número sem SMS —
  // aqui o robô é um contacto conhecido (publica as listas todos os dias),
  // ao contrário de uma DM a um número estranho. O código de 6 dígitos
  // continua obrigatório: liga a sessão da app ao telemóvel, e vindo do
  // número errado não faz nada (por isso ser visível no grupo é inócuo).
  // Única resposta: reação ✅ — o bot não conversa (Renato, 28 set).
  const confirmMatch = stripAccents(text.trim().toLowerCase()).match(/^\/?(confirmar|validar|registar)\s+(\d{6})$/)
  if (confirmMatch) {
    ctx.action = 'confirmar_numero'
    if (!senderPn) return
    const { data, error } = await supabase.rpc('confirm_phone_from_whatsapp', {
      p_phone_hash: hashPhone(senderPn.split('@')[0]),
      p_code: confirmMatch[2],
    })
    if (error) {
      console.error('Confirmar número no grupo falhou:', error)
      return
    }
    // Código errado/expirado: silêncio — a app diz «ainda não chegou».
    if (data?.ok && sendReaction && key) {
      await sendReaction(groupJid, key, '✅').catch((err) => console.error('Falha a reagir ao Confirmar:', err))
    }
    return
  }
  // Gate on hardcoded, in-memory checks first — normal group chatter never
  // matches either of these, so it never touches the DB (the group lookup
  // used to run unconditionally here, costing every message a query).
  const pending = getPendingConfirmation(senderPn, groupJid)
  let parsed = parseCommand(text)
  // Cópia da lista do robô com nomes a mais (Francisco, 27 set): trata-se
  // como um «In» — de quem enviou, ou das pessoas que acrescentou.
  const copied = !pending && !parsed ? parseCopiedRoster(text) : null
  if (copied) parsed = { action: 'in', rest: null, glued: false }
  // Uma resposta a um pedido de dupla deste grupo (só se houver algum:
  // a conversa normal nunca vai à base de dados).
  const pairAnswer = !parsed && [...pairRequests.values()].some((r) => r.groupJid === groupJid) ? parsePairAnswer(text) : null
  if (!pending && !parsed && !pairAnswer) return
  // Declarado já aqui: o «Sim» a um parceiro sem conta (lá em baixo, no
  // pending) pode voltar ao caminho do «In com …» (confirmPairWithUnregistered).
  let partnerRequest = null
  ctx.action = copied ? 'copied_list' : pairAnswer && !pending ? 'pair_answer' : (parsed?.action ?? 'pending')

  // Multi-grupo: o grupo de onde a mensagem veio determina o clube (e o
  // filtro de nível) de TUDO o resto deste handler. Grupo não mapeado em
  // whatsapp_groups → silêncio, como o gate antigo de JID único.
  const group = await getGroupByJid(groupJid)
  timer.mark('grupo')
  if (!group) return
  const organizationId = group.organizationId
  // Mensagens novas do robô (interruptor do clube, groups.js): textos novos
  // e sem o rodapé do /help nas respostas.
  const fresh = Boolean(group.newMessages)

  // Resolved once, up front, and reused for the rest of this handler — every
  // reply below is addressed to this one sender specifically (unlike the
  // group broadcasts in roster.js/sync.js/reminders.js/autostart.js), so it
  // always uses their own profiles.language. An unresolved sender (not
  // found, or a fresh guest about to be created) falls back to 'pt'.
  // Quem escreveu e que mixes estão abertos não dependem um do outro — em
  // paralelo. Os mixes só se usam mais abaixo; o erro fica para lá.
  const openMixesPromise = getOpenMixes(organizationId)
  openMixesPromise.catch(() => {})
  const resolvedProfile = await resolveProfileByPhoneJid(senderPn, organizationId)
  timer.mark('perfil')
  const lang = resolvedProfile?.language ?? 'pt'
  // O hash do número de quem escreve — a identidade de um convidado sem
  // conta, e a ponte entre uma conta e a linha-convidado que ela possa ter
  // deixado antes de existir (rowOwnerIsMine).
  const myHash = hashPhone(senderPn.split('@')[0])
  // Convidado que ficou com o nome por defeito («Parceiro de Macedo») e
  // agora escreve: passa a ter o nome do WhatsApp.
  if (await renameDefaultPartner(resolvedProfile, message?.pushName)) resolvedProfile.name = usablePushName(message.pushName)

  // Quote the sender's own message so a reply is unambiguous even when
  // several people send commands close together. Every reply also points
  // back to /help, except the help listing itself.
  const reply = (key, vars) =>
    sendText(groupJid, fresh ? t(key, lang, vars, true) : `${t(key, lang, vars)}${helpFooter(lang)}`, { quoted: message })

  // Only called on an actual join attempt (not "out", not disambiguation).
  // Conta = email (Ruben, 30 set): um número desconhecido NÃO ganha conta —
  // entra como convidado sem conta (game_guests), com o nudge para se
  // registar (histórico/ranking só com conta).
  async function requireProfileOrCreateGuest(profile, senderPnForGuest) {
    // #537: já tem conta (número confirmado) mas não é deste clube → passa a
    // membro com a conta dele, em vez de entrar como convidado.
    if (profile?.notMember) {
      try {
        await ensureMembership(profile.id, organizationId)
        return { profile: { ...profile, notMember: false }, isNewGuest: false }
      } catch (err) {
        console.error('Failed to add registered member:', err)
        await reply('not_found', { appUrl: config.appUrl })
        return { profile: null, isNewGuest: false }
      }
    }
    if (profile) return { profile, isNewGuest: false }
    return { profile: guestIdentity(senderPnForGuest, usablePushName(message?.pushName)), isNewGuest: true }
  }

  /** Garante a linha do convidado deste jogo (upsert pelo número: o mesmo
   *  número nunca duplica; o nome atualiza-se para o do WhatsApp) e
   *  inscreve-a. Devolve o erro do INSERT de participants (para os
   *  tratamentos de mix cheio/duplicado dos chamadores), lançando nos
   *  restantes. */
  async function insertGuestParticipant(gameId, identity, status) {
    const { data: g, error: guestError } = await supabase
      .from('game_guests')
      .upsert(
        { game_id: gameId, name: identity.name, phone_hash: identity.phoneHash, whatsapp_jid: identity.jid },
        { onConflict: 'game_id,phone_hash' }
      )
      .select('id')
      .single()
    if (guestError) throw new Error(`Failed to upsert game guest: ${guestError.message}`)
    const { error } = await supabase
      .from('participants')
      .insert([{ game_id: gameId, guest_id: g.id, status, joined_alone: true }])
    if (error) {
      // Linha órfã só se o convidado não estava já inscrito (23505 = já está).
      if (error.code !== '23505') await deleteGuestIfOrphan(g.id)
      return error
    }
    return null
  }

  /** Apaga uma linha de game_guests só se nada a referencia — o upsert
   *  pode ter REUTILIZADO uma linha existente (mesmo número), e apagá-la
   *  às cegas no caminho de erro levava atrás inscrições de outros
   *  (CASCADE no guest_id, SET NULL no partner_guest_id). */
  async function deleteGuestIfOrphan(guestId) {
    const { data } = await supabase
      .from('participants')
      .select('id')
      .or(`guest_id.eq.${guestId},partner_guest_id.eq.${guestId}`)
      .limit(1)
    if (!data?.length) await supabase.from('game_guests').delete().eq('id', guestId)
  }

  /** Convidado só por nome (parceiro «com Fulano», lista copiada): sem
   *  número, sem «Out» pelo bot — só o admin o tira. */
  async function createNamedGameGuest(gameId, name) {
    const { data: g, error } = await supabase
      .from('game_guests')
      .insert({ game_id: gameId, name: name.trim() })
      .select('id')
      .single()
    if (error) throw new Error(`Failed to create named game guest: ${error.message}`)
    return g.id
  }

  if (pairAnswer && resolvedProfile && await answerPairRequest(pairAnswer)) return

  if (pending) {
    const normalized = stripAccents(text.trim().toLowerCase())
    const key = pendingKey(senderPn, groupJid)

    if (pending.kind === 'out_pair') {
      const choice = { 1: 'pair', dupla: 'pair', 2: 'me', eu: 'me', 'so eu': 'me', 'so tu': 'me', 3: 'partner', parceiro: 'partner' }[normalized]
      if (choice) {
        pendingSuplenteConfirmations.delete(key)
        await confirmOutPair(pending, choice)
        return
      }
      if (!pending.reprompted) {
        pending.reprompted = true
        await reply('out_pair_reprompt')
        return
      }
      pendingSuplenteConfirmations.delete(key)
    }

    if (normalized === 'sim' && pending.kind === 'pair_unregistered') {
      pendingSuplenteConfirmations.delete(key)
      await confirmPairWithUnregistered(pending)
      return
    }
    if (normalized === 'nao' && pending.kind === 'pair_unregistered') {
      pendingSuplenteConfirmations.delete(key)
      await reply('partner_offer_declined')
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
  const { action, glued } = parsed
  let { rest } = parsed

  // «In com João» / «In @João» — entrar já em dupla (A2N, 24 set). Só para
  // «in»; num «out» o parceiro não interessa.
  // «Out dupla» / «Out @parceiro» (Renato, 25 set): quem sai de uma dupla.
  // A palavra e a menção saem do identificador do mix («out 01 dupla»).
  let outRequest = null
  if (action === 'out' && rest !== null) {
    const r = rest.replace(/@\S+/g, ' ')
    const wantsPair = /(^|\s)dupla(\s|$)/.test(r)
    if (wantsPair) outRequest = { kind: 'pair' }
    else if (mentionedJids.length > 0) outRequest = { kind: 'mention', pns: mentionedPns }
    if (outRequest) rest = r.replace(/(^|\s)dupla(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim() || null
  }

  if (action === 'in') {
    const split = splitPartner(rest)
    if (split.partnerName || mentionedJids.length > 0) {
      // O nome como a pessoa o escreveu (com acentos e maiúsculas) — para as
      // respostas e para o perfil de convidado; a procura usa o normalizado.
      const typed = text.replace(/@\S+/g, ' ').match(/(?:^|\s)com\s+(.+)$/i)?.[1]?.replace(/\s+/g, ' ').trim()
      partnerRequest = { name: split.partnerName, typedName: typed || null, mentionedPns }
      rest = split.rest
    }
  }

  if (action === 'help') {
    if (!fresh) {
      await sendText(groupJid, helpText(lang), { quoted: message })
      return
    }
    // Conforme os mixes abertos que este grupo vê.
    const visible = await openMixesPromise.then((mixes) => mixes.filter((mix) => mixVisibleToGroup(mix, group)), () => [])
    await sendText(groupJid, buildHelp(visible, lang), { quoted: message })
    return
  }

  // resolvedProfile was already fetched once, up front, alongside lang.
  // Só os mixes do clube deste grupo, filtrados pelo nível do grupo — um
  // "In" aqui nunca pode inscrever alguém num mix que o grupo não vê.
  const openMixes = (await openMixesPromise).filter((mix) => mixVisibleToGroup(mix, group))
  timer.mark('mixes')
  if (openMixes.length === 0) {
    // Uma lista copiada sem mix aberto é conversa: não se responde.
    if (copied) return
    await reply('no_open_mixes')
    return
  }
  if (copied) {
    await handleCopiedList(copied, openMixes)
    return
  }

  // Nomes depois do «In» sem o «com» (grupo de teste, 30 set): «In Miguel
  // Oliveira Marco Silva», «In Miguel Oliveira e Marco Silva», «In Marco
  // Silva». Se o texto não diz que mix (ou se responde ao cartão, onde o
  // texto não conta para o mix), lê-se como nomes: o de quem escreveu sai,
  // o que sobra é o parceiro (partnerNames.js). E «In Miguel Oliveira com
  // Marco Silva» — o nome de quem escreveu antes do «com» não é um mix.
  if (action === 'in' && rest && !glued) {
    const repliedToCard = quotedStanzaId ? Boolean(gameIdForMessage(quotedStanzaId)) : false
    const namesAMix = !repliedToCard && matchOpenMixesByText(openMixes, rest, { glued }).matched.length > 0
    if (!namesAMix) {
      const senderNames = [resolvedProfile?.name, message?.pushName]
      if (partnerRequest) {
        if (isOnlySenderName(rest, senderNames)) rest = null
      } else {
        // O texto como foi escrito (acentos, maiúsculas): as últimas palavras.
        const typed = text.trim().replace(/\s+/g, ' ').split(' ').slice(-rest.split(' ').length).join(' ')
        const partner = partnerFromTypedNames(typed, senderNames)
        if (partner !== undefined) {
          rest = null
          if (partner) partnerRequest = { name: stripAccents(partner.toLowerCase()), typedName: partner, mentionedPns: [] }
        }
      }
    }
  }

  // #552 — «mix» mostra o cartão completo de cada mix aberto (o mesmo do
  // anúncio: vagas numeradas, inscritos, «Escreve In»), e responder «In» a
  // um cartão inscreve nesse mix. Sempre um cartão por mix: a lista curta
  // «saíram há pouco» do anti-bloqueio escondia quem está inscrito e caiu
  // (Ruben, 3 out). Única exceção: um cartão igualzinho ao que saiu há
  // menos de 5 min não se repete — mudou alguma coisa (um In, uma vaga),
  // volta a sair.
  if (action === 'mix') {
    const labelable = labelableMixes(openMixes)
    const states = await Promise.all(openMixes.map((mix) => loadGame(mix.id)))
    let sentCards = 0
    for (const state of states) {
      // O MESMO formato que os reposts/lembretes usam (fresh segue o
      // interruptor do clube) — senão o hash do noteCardSent não bate com
      // o que a reconciliação calcula e ela manda o cartão outra vez no
      // outro formato: era o duplicado que o Ruben viu a 3 out.
      const text = buildMixMessage(state, { label: mixLabel(state.game, labelable), fresh: group.newMessages })
      if (cardUnchangedRecently(groupJid, state.game.id, text)) continue
      const messageId = await sendText(groupJid, text)
      recordMixMessage(messageId, state.game.id)
      noteCardSent(groupJid, state.game.id, text, messageId)
      sentCards++
    }
    // Tudo recente e sem alterações: nada para reenviar. A reação 👆 diz
    // «os cartões estão mesmo aqui em cima» sem encher o grupo de texto —
    // sem ela parecia que o robô não tinha ouvido (Ruben, 3 out).
    if (sentCards === 0 && sendReaction && key) {
      await sendReaction(groupJid, key, '👆').catch((err) => console.error('Falha a reagir ao «mix»:', err))
    }
    return
  }

  /**
   * Quem é o parceiro pedido: pela menção (número → perfil do clube, ou um
   * convidado novo, como o bot já faz com quem escreve «In» sem conta), ou
   * pelo nome, entre os membros do clube. Devolve { partner, isNewGuest } ou
   * null depois de já ter respondido ao grupo a dizer porquê.
   */
  const shownName = () => titleCase(partnerRequest.typedName || partnerRequest.name)

  /** Os membros do clube com este nome (tirando quem escreveu): o igual, se só houver um, senão os parecidos. */
  async function membersNamed(profile, name) {
    const { data: rows, error } = await supabase
      .from('memberships')
      .select('user_id, profile:profiles!inner(id, name)')
      .eq('organization_id', organizationId)
    if (error) throw new Error(`Failed to load members for partner lookup: ${error.message}`)
    const query = stripAccents(name.toLowerCase()).replace(/\s+/g, ' ').trim()
    const people = rows.map((r) => ({ id: r.user_id, name: r.profile.name })).filter((x) => !isMine(profile, x.id))
    const exact = people.filter((x) => stripAccents((x.name || '').toLowerCase()) === query)
    return exact.length === 1 ? exact : people.filter((x) => nameMatches(x.name, query))
  }

  async function resolvePartner(profile, game = null, { addToRowId = null } = {}) {
    if ((partnerRequest.mentionedPns || []).length > 1) {
      await reply('partner_one_mention')
      return null
    }
    const pn = (partnerRequest.mentionedPns || [])[0]
    if (pn) {
      const found = await resolveProfileByPhoneJid(pn, organizationId)
      if (found?.notMember) {
        // #537: o parceiro tem conta (número confirmado) mas não é deste
        // clube — passa a membro, como quem escreve (requireProfileOrCreateGuest).
        await ensureMembership(found.id, organizationId)
        return { partner: { ...found, notMember: false }, isNewGuest: false }
      }
      if (found) return { partner: found, isNewGuest: false }
      // Número sem conta: o parceiro entra como convidado sem conta
      // (game_guests), com o número — o «Out» dele funciona e, se criar
      // conta e confirmar o número, a inscrição é adotada. O nome: o
      // escrito («In @João com João Silva»), o do WhatsApp se a pessoa já
      // escreveu no grupo, ou por defeito.
      const known = partnerRequest.name ? shownName() : seenName(pn)
      const guestName = known || t('partner_guest_default_name', lang, { name: profile.name })
      const partner = guestIdentity(pn, guestName)
      // Sem nome conhecido: quando esta pessoa escrever no grupo, o nome
      // por defeito dá lugar ao do WhatsApp (seenNames.js).
      if (!known) notePlaceholder(pn, { phoneHash: partner.phoneHash, name: partner.name })
      return { partner, isNewGuest: true }
    }
    if (!partnerRequest.name) {
      // Houve menção, mas o WhatsApp não deu o número (grupo com LID).
      await reply('partner_mention_unreadable')
      return null
    }
    const matches = await membersNamed(profile, partnerRequest.name)
    if (matches.length === 1) return { partner: matches[0], isNewGuest: false }
    if (matches.length === 0) {
      // Pode ser alguém que não está na app nem no grupo (não dá para o
      // mencionar). Em vez de parar aqui, pergunta-se — «Sim» faz o mesmo
      // que o «Não está na app?» da app (partnerInvite.js). A pergunta
      // evita criar uma pessoa nova por um nome mal escrito.
      const name = shownName()
      if (game && name.length >= 2 && name.length <= 60) {
        pendingSuplenteConfirmations.set(pendingKey(senderPn, groupJid), {
          kind: 'pair_unregistered',
          gameId: game.id,
          addToRowId,
          name,
          expiresAt: Date.now() + SUPLENTE_CONFIRM_TTL_MS,
          reprompted: false,
        })
        await reply('partner_offer_unregistered', { name })
        return null
      }
      await reply('partner_not_found', { name })
      return null
    }
    const list = matches.slice(0, 6).map((x) => `• ${x.name}`).join('\n')
    await reply('partner_ambiguous', { name: shownName(), list, example: matches[0].name })
    return null
  }

  /**
   * Pede ao parceiro (inscrito sozinho) que aceite a dupla. Quem pediu já
   * está inscrito sozinho. O robô menciona o parceiro, se souber o número.
   */
  async function askPairRequest(game, requester, partner) {
    let pn = (partnerRequest?.mentionedPns || [])[0] || null
    if (!pn) {
      const { data } = await supabase.from('profiles').select('whatsapp_jid').eq('id', partner.id)
      pn = data?.[0]?.whatsapp_jid || null
    }
    const who = pn ? `@${String(pn).split('@')[0]}` : partner.name
    const ask = t('pair_request_ask', lang, { partner: who, requester: requester.name }, fresh)
    const messageId = await sendText(groupJid, fresh ? ask : `${ask}${helpFooter(lang)}`, { mentions: pn ? [pn] : [] })
    pairRequests.set(`${groupJid}|${game.id}|${requester.id}`, {
      groupJid, gameId: game.id, requesterId: requester.id, requesterName: requester.name,
      partnerId: partner.id, partnerName: partner.name, messageId: messageId || null, createdAt: Date.now(),
    })
  }

  /**
   * «Sim» / «Não» de quem recebeu um pedido de dupla. Só conta se quem
   * responde for o parceiro pedido (isMine: o número, com as contas do
   * mesmo número). Devolve true se a mensagem era mesmo uma resposta.
   */
  async function answerPairRequest(answer) {
    let mine = [...pairRequests.values()].filter((r) => r.groupJid === groupJid && isMine(resolvedProfile, r.partnerId))
    if (mine.length === 0) return false
    if (quotedStanzaId && mine.some((r) => r.messageId === quotedStanzaId)) mine = mine.filter((r) => r.messageId === quotedStanzaId)
    else if (mentionedPns.length > 0) {
      const ids = []
      for (const pn of mentionedPns) {
        const found = await resolveProfileByPhoneJid(pn, organizationId)
        if (found) ids.push(found.id, ...(found.aliasIds || []))
      }
      const byMention = mine.filter((r) => ids.includes(r.requesterId))
      if (byMention.length > 0) mine = byMention
    }
    if (mine.length > 1) {
      await reply('pair_request_which')
      return true
    }
    const req = mine[0]
    const key = `${req.groupJid}|${req.gameId}|${req.requesterId}`
    pairRequests.delete(key)
    if (answer === 'no') {
      await reply('pair_request_declined', { partner: req.partnerName, requester: req.requesterName })
      return true
    }

    // Vale até o mix começar ou as duplas serem sorteadas, e com os dois
    // ainda inscritos sozinhos.
    const { game, rows } = await loadGame(req.gameId)
    const { data: drawn } = await supabase.from('teams').select('id').eq('game_id', req.gameId)
    // «Sozinho» = sem parceiro NENHUM — nem conta nem convidado (senão um
    // «Sim» tardio cancelava a linha de quem entretanto juntou um convidado
    // e o gc apagava-o do jogo).
    const requesterRow = rows.find((r) => r.status === 'confirmed' && r.user_id === req.requesterId && !r.partner_id && !r.partner_guest_id)
    const partnerRow = rows.find((r) => r.status === 'confirmed' && isMine(resolvedProfile, r.user_id) && !r.partner_id && !r.partner_guest_id)
    if (!OPEN_STATUSES.has(game.status) || new Date(game.date).getTime() <= Date.now() || (drawn || []).length > 0 || !requesterRow || !partnerRow) {
      await reply('pair_request_expired')
      return true
    }

    // Juntar sem deixar entrar um suplente pelo meio: a inscrição de quem
    // pediu fica 'cancelled' (um UPDATE não promove ninguém — só o DELETE
    // corre o promote_waitlist), a do parceiro ganha o partner_id, e só então
    // se apaga a de quem pediu (com a dupla já a ocupar os dois lugares).
    const { error: freeError } = await supabase.from('participants').update({ status: 'cancelled' }).eq('id', requesterRow.id)
    if (freeError) throw new Error(`Failed to free requester row: ${freeError.message}`)
    const { error: joinError } = await supabase
      .from('participants')
      .update({ partner_id: req.requesterId, joined_alone: false })
      .eq('id', partnerRow.id)
    if (joinError) {
      await supabase.from('participants').update({ status: 'confirmed' }).eq('id', requesterRow.id)
      if (isGameFull(joinError)) {
        await reply('pair_request_expired')
        return true
      }
      throw new Error(`Failed to form requested pair: ${joinError.message}`)
    }
    const { error: delError } = await supabase.from('participants').delete().eq('id', requesterRow.id)
    if (delError) console.error('Failed to remove the requester row after pairing:', delError)
    repostHooks.requestRepostForGame(organizationId, req.gameId)
    await reply('pair_request_accepted', { partner: req.partnerName, requester: req.requesterName })
    return true
  }

  // «Sim» à pergunta «inscrever a dupla com quem não está na app?». Entre a
  // pergunta e a resposta passaram até 10 minutos: volta-se a verificar o mix
  // e as vagas antes de criar a conta por reclamar e o convite.
  async function confirmPairWithUnregistered(pending) {
    const { game, people, capacity, rows } = await loadGame(pending.gameId)
    if (!OPEN_STATUSES.has(game.status) || new Date(game.date).getTime() <= Date.now()) {
      await reply('mix_no_longer_available')
      return
    }
    if (game.rotate_partners) {
      await reply('partner_not_fixed_pairs')
      return
    }
    if (!game.allow_pair_signup) {
      await reply('pair_signup_off')
      return
    }
    const adding = Boolean(pending.addToRowId)
    const { profile, isNewGuest } = await requireProfileOrCreateGuest(resolvedProfile, senderPn)
    if (!profile) return
    // Quem não tem conta não inicia duplas (o pedido/aceitação e a gestão
    // na app precisam de conta) — entra sozinho ou o parceiro escreve ele.
    if (profile.guest) {
      await reply('guest_pair_need_account', { appUrl: config.appUrl })
      return
    }
    const own = adding ? rows.find((row) => row.id === pending.addToRowId) : null
    if (adding) {
      // A inscrição sozinha tem de continuar lá, ser desta pessoa (por
      // conta OU pelo hash — pode ser a linha-convidado de antes da conta)
      // e sem parceiro.
      if (!own || own.status !== 'confirmed' || own.partner_id || own.partner_guest_id || !rowOwnerIsMine(profile, myHash, own)) {
        await reply('mix_no_longer_available')
        return
      }
    } else if (rows.some((row) => rowIsMine(profile, myHash, row))) {
      await reply('already_joined')
      return
    }
    // Entre a pergunta e o «Sim» a pessoa pode ter entrado no clube (30 set:
    // o Paulo deu «In» enquanto o Mike respondia, e ficaram dois «Paulo
    // Duarte»). Se agora há um membro com esse nome, segue o «In com …» normal.
    if ((await membersNamed(profile, pending.name)).length === 1) {
      partnerRequest = { name: stripAccents(pending.name.toLowerCase()), typedName: pending.name, mentionedPns: [] }
      if (adding) await addPartnerToRow({ game, people, capacity, profile, row: own, existingRows: rows })
      else await joinAsPair({ game, people, capacity, profile, isNewGuest, existingRows: rows })
      return
    }
    const needed = adding ? 1 : 2
    if (capacity - people.length < needed) {
      await reply(adding ? 'mix_full_add_partner' : capacity - people.length <= 0 ? 'mix_full_pair' : 'mix_one_spot_pair')
      return
    }
    // Convidado sem conta, só com o nome — substitui o convite por link
    // (partner_invites/#339) no bot: sem conta por reclamar, sem token
    // (decisão Ruben, 30 set). Se a pessoa criar conta e confirmar o número
    // não há adoção automática (não temos o número dela) — o admin troca na
    // app se for preciso.
    let guestId
    try {
      guestId = await createNamedGameGuest(game.id, pending.name)
    } catch (err) {
      console.error('Failed to create named guest partner:', err)
      await reply('partner_not_found_app', { appUrl: config.appUrl })
      return
    }
    const { error: pairError } = adding
      ? await supabase
          .from('participants')
          .update({ partner_guest_id: guestId, joined_alone: false })
          .eq('id', pending.addToRowId)
      : await supabase
          .from('participants')
          .insert([{ game_id: game.id, user_id: profile.id, partner_guest_id: guestId, status: 'confirmed', joined_alone: false }])
    if (pairError) {
      await supabase.from('game_guests').delete().eq('id', guestId)
      if (isGameFull(pairError)) {
        await reply(adding ? 'mix_full_add_partner' : 'mix_full_pair')
        return
      }
      if (pairError.code === '23505') {
        await reply('already_joined')
        return
      }
      throw new Error(`Failed to join with named guest partner: ${pairError.message}`)
    }
    repostHooks.requestRepostForGame(organizationId, game.id)
    await reply('pair_partner_guest_created', { partner: pending.name, appUrl: config.appUrl })
  }

  /**
   * #554 — quem já deu «In» sozinho junta o parceiro depois, sem sair: a
   * inscrição que já existe ganha o partner_id, e mantém o lugar na lista.
   * As regras do «In com …» (duplas fixas, «Inscrição em dupla», parceiro
   * que não é a própria pessoa nem já está inscrito, sem conta → convidado)
   * — mas só precisa de UMA vaga, a do parceiro. O trigger das vagas
   * (participants_capacity_guard) volta a contar: a linha cresce.
   */
  async function addPartnerToRow({ game, people, capacity, profile, row, existingRows }) {
    if (game.rotate_partners) {
      await reply('partner_not_fixed_pairs')
      return
    }
    if (!game.allow_pair_signup) {
      await reply('pair_signup_off')
      return
    }
    if (capacity - people.length < 1) {
      await reply('mix_full_add_partner')
      return
    }
    const resolved = await resolvePartner(profile, game, { addToRowId: row.id })
    if (!resolved) return
    const { partner, isNewGuest: partnerIsNewGuest } = resolved
    if (isMine(profile, partner.id) || (partner.guest && partner.phoneHash === myHash)) {
      await reply('partner_is_you')
      return
    }
    if (partner.guest) {
      // Convidado (com número, via menção) já inscrito neste jogo?
      if (existingRows.some((r) => r.guestPhoneHash === partner.phoneHash || r.partnerGuestPhoneHash === partner.phoneHash)) {
        await reply('partner_already_in', { name: partner.name })
        return
      }
      const insertError = await attachGuestPartner(game.id, row.id, partner)
      timer.mark('gravar')
      if (insertError) {
        if (isGameFull(insertError)) {
          await reply('mix_full_add_partner')
          return
        }
        throw new Error(`Failed to add guest partner: ${insertError.message}`)
      }
      repostHooks.requestRepostForGame(organizationId, game.id)
      await reply('pair_partner_guest_created', { partner: partner.name, appUrl: config.appUrl })
      return
    }
    const partnerSolo = existingRows.find((r) => r.status === 'confirmed' && r.user_id === partner.id && !r.partner_id && !r.partner_guest_id)
    if (partnerSolo) {
      await askPairRequest(game, profile, partner)
      return
    }
    if (existingRows.some((r) => r.user_id === partner.id || r.partner_id === partner.id)) {
      await reply('partner_already_in', { name: partner.name })
      return
    }
    const { error } = await supabase
      .from('participants')
      .update({ partner_id: partner.id, joined_alone: false })
      .eq('id', row.id)
    timer.mark('gravar')
    if (error) {
      if (isGameFull(error)) {
        await reply('mix_full_add_partner')
        return
      }
      throw new Error(`Failed to add partner: ${error.message}`)
    }
    // A lista publicada de novo, já com a dupla, é a confirmação.
    repostHooks.requestRepostForGame(organizationId, game.id)
    if (partnerIsNewGuest) {
      await reply('pair_partner_guest_created', { partner: partner.name, appUrl: config.appUrl })
    }
  }

  /** Junta um parceiro-convidado (com número) a uma inscrição existente. */
  async function attachGuestPartner(gameId, rowId, partner) {
    const { data: g, error: guestError } = await supabase
      .from('game_guests')
      .upsert(
        { game_id: gameId, name: partner.name, phone_hash: partner.phoneHash, whatsapp_jid: partner.jid },
        { onConflict: 'game_id,phone_hash' }
      )
      .select('id')
      .single()
    if (guestError) throw new Error(`Failed to upsert guest partner: ${guestError.message}`)
    const { error } = await supabase
      .from('participants')
      .update({ partner_guest_id: g.id, joined_alone: false })
      .eq('id', rowId)
    if (error) await deleteGuestIfOrphan(g.id)
    return error
  }

  /** Dupla nova: quem escreveu (conta) + parceiro-convidado (com número). */
  async function insertPairWithGuestPartner(gameId, profile, partner) {
    const { data: g, error: guestError } = await supabase
      .from('game_guests')
      .upsert(
        { game_id: gameId, name: partner.name, phone_hash: partner.phoneHash, whatsapp_jid: partner.jid },
        { onConflict: 'game_id,phone_hash' }
      )
      .select('id')
      .single()
    if (guestError) throw new Error(`Failed to upsert guest partner: ${guestError.message}`)
    const { error } = await supabase
      .from('participants')
      .insert([{ game_id: gameId, user_id: profile.id, partner_guest_id: g.id, status: 'confirmed', joined_alone: false }])
    if (error) await deleteGuestIfOrphan(g.id)
    return error
  }

  // Entrar em dupla: as mesmas regras da app (GameDetails, «Entrar com
  // parceiro»): só em duplas fixas, uma linha em participants com o
  // partner_id, e a dupla ocupa dois lugares. Sem lista de suplentes para
  // duplas — a app também não a tem.
  async function joinAsPair({ game, people, capacity, profile, isNewGuest, existingRows }) {
    if (game.rotate_partners) {
      await reply('partner_not_fixed_pairs')
      return
    }
    // «Inscrição em dupla» do mix (migration_mix_pair_signup.sql): sem «Sim»
    // não se entra em dupla, como na app. Antes de a migração correr a coluna
    // não existe — e aí também é «Não», que é o que se decidiu para os mixes
    // de antes.
    if (!game.allow_pair_signup) {
      await reply('pair_signup_off')
      return
    }
    const left = capacity - people.length
    if (left <= 0) {
      await reply('mix_full_pair')
      return
    }
    const resolved = await resolvePartner(profile, game)
    if (!resolved) return
    const { partner, isNewGuest: partnerIsNewGuest } = resolved
    if (isMine(profile, partner.id) || (partner.guest && partner.phoneHash === myHash)) {
      await reply('partner_is_you')
      return
    }
    if (partner.guest) {
      if (existingRows.some((r) => r.guestPhoneHash === partner.phoneHash || r.partnerGuestPhoneHash === partner.phoneHash)) {
        await reply('partner_already_in', { name: partner.name })
        return
      }
      if (left < 2) {
        await reply('mix_one_spot_pair')
        return
      }
      const insertError = await insertPairWithGuestPartner(game.id, profile, partner)
      timer.mark('gravar')
      if (insertError) {
        if (insertError.code === '23505') {
          await reply('already_joined')
          return
        }
        if (isGameFull(insertError)) {
          await reply('mix_full_pair')
          return
        }
        throw new Error(`Failed to insert pair with guest partner: ${insertError.message}`)
      }
      repostHooks.requestRepostForGame(organizationId, game.id)
      await reply('pair_partner_guest_created', { partner: partner.name, appUrl: config.appUrl })
      return
    }
    // O parceiro já está inscrito (A2N, M4, 27 set: «in com Diogo» com o
    // Diogo já dentro dava «já está inscrito» e o Bernardo ficava de fora).
    // Sozinho → quem escreveu entra na inscrição dele e ficam em dupla, sem
    // o Diogo perder o lugar; só precisa de 1 vaga. Já em dupla → diz com
    // quem, e que pode entrar sozinho.
    const partnerRow = existingRows.find((row) => row.status === 'confirmed' && (row.user_id === partner.id || row.partner_id === partner.id))
    if (partnerRow) {
      if (partnerRow.partner_id || partnerRow.partner_guest_id) {
        const otherId = partnerRow.user_id === partner.id
          ? (partnerRow.partner_id ?? partnerRow.partner_guest_id)
          : (partnerRow.user_id ?? partnerRow.guest_id)
        const other = people.find((p) => p.id === otherId)?.name || '?'
        await reply('partner_in_pair', { name: partner.name, other })
        return
      }
      // O X tem de aceitar (Francisco, 27 set). Quem escreveu entra já
      // sozinho, para não perder a vaga, e o robô pergunta ao X.
      const { error } = await supabase
        .from('participants')
        .insert([{ game_id: game.id, user_id: profile.id, status: 'confirmed', joined_alone: true }])
      timer.mark('gravar')
      if (error) {
        if (error.code === '23505') {
          await reply('already_joined')
          return
        }
        if (isGameFull(error)) {
          await reply('mix_full_pair')
          return
        }
        throw new Error(`Failed to insert requester: ${error.message}`)
      }
      repostHooks.requestRepostForGame(organizationId, game.id)
      await askPairRequest(game, profile, partner)
      if (isNewGuest) await reply('guest_joined', { name: profile.name, appUrl: config.appUrl })
      return
    }
    if (existingRows.some((row) => row.user_id === partner.id || row.partner_id === partner.id)) {
      await reply('partner_already_in', { name: partner.name })
      return
    }
    if (left < 2) {
      await reply('mix_one_spot_pair')
      return
    }
    const { error: insertError } = await supabase
      .from('participants')
      .insert([{ game_id: game.id, user_id: profile.id, partner_id: partner.id, status: 'confirmed', joined_alone: false }])
    if (insertError) {
      if (insertError.code === '23505') {
        await reply('already_joined')
        return
      }
      if (isGameFull(insertError)) {
        await reply('mix_full_pair')
        return
      }
      throw new Error(`Failed to insert pair participant: ${insertError.message}`)
    }
    repostHooks.requestRepostForGame(organizationId, game.id)
    // Como no «In» sozinho: a lista publicada de novo é a confirmação. Só se
    // responde quando alguém acabou de ganhar um perfil de convidado.
    if (partnerIsNewGuest) {
      await reply('pair_partner_guest_created', { partner: partner.name, appUrl: config.appUrl })
    } else if (isNewGuest) {
      await reply('guest_joined', { name: profile.name, appUrl: config.appUrl })
    }
  }

  /**
   * Sair de uma dupla (Renato, 25 set). `choice`: 'pair' (saem os dois), 'me'
   * (sai quem escreveu, o outro fica sozinho) ou 'partner' (sai o outro).
   * Sem escolha: vem do «Out dupla» / «Out @parceiro», ou pergunta-se 1/2/3.
   *
   * Tirar UMA pessoa não apaga a linha — encolhe-a — e o promote_waitlist só
   * corre sozinho num DELETE; por isso chama-se aqui (também reabre o mix).
   * Se quem fica seria um parceiro que ainda não entrou na app (convite por
   * link), sai a dupla toda: não fica um lugar só com um convite.
   */
  async function leavePair({ game, pairRow, profile, rows, suplentes, choice = null }) {
    // De que lado da linha estou (titular ou parceiro) — por conta OU pelo
    // hash do número (a minha linha-convidado de antes de ter conta).
    const iAmOwner = rowOwnerIsMine(profile, myHash, pairRow)
    const mySide = iAmOwner
      ? { user: pairRow.user_id, guest: pairRow.guest_id }
      : { user: pairRow.partner_id, guest: pairRow.partner_guest_id }
    const otherSide = iAmOwner
      ? { user: pairRow.partner_id, guest: pairRow.partner_guest_id }
      : { user: pairRow.user_id, guest: pairRow.guest_id }

    // O outro: conta (profiles) ou convidado sem conta (dados já na linha).
    let other
    if (otherSide.guest) {
      other = {
        id: otherSide.guest,
        name: (iAmOwner ? pairRow.partnerGuestName : pairRow.guestName) || '?',
        guest: true,
        phoneHash: iAmOwner ? pairRow.partnerGuestPhoneHash : pairRow.guestPhoneHash,
        claim_pending: false,
      }
    } else {
      const { data: others } = await supabase.from('profiles').select('id, name, claim_pending').eq('id', otherSide.user)
      other = others?.[0] ?? { id: otherSide.user, name: '?', claim_pending: false }
    }

    if (!choice && outRequest?.kind === 'pair') choice = 'pair'
    if (!choice && outRequest?.kind === 'mention') {
      const pns = (outRequest.pns || []).filter(Boolean)
      if (outRequest.pns.length > 1) {
        await reply('partner_one_mention')
        return
      }
      // Primeiro pelo número (também funciona quando o mencionado é um
      // convidado sem conta — não há perfil para resolver).
      const mentionedHash = pns.length === 1 ? hashPhone(pns[0].split('@')[0]) : null
      if (mentionedHash && mentionedHash === myHash) choice = 'me'
      else if (mentionedHash && other.guest && other.phoneHash && mentionedHash === other.phoneHash) choice = 'partner'
      else {
        const mentioned = pns.length === 1 ? await resolveProfileByPhoneJid(pns[0], organizationId) : null
        if (!mentioned) {
          await reply('out_mention_unreadable')
          return
        }
        if (isMine(profile, mentioned.id)) choice = 'me'
        else if (mentioned.id === otherSide.user) choice = 'partner'
        else {
          await reply('out_not_your_partner', { name: mentioned.name })
          return
        }
      }
    }
    if (!choice) {
      pendingSuplenteConfirmations.set(pendingKey(senderPn, groupJid), {
        kind: 'out_pair', gameId: game.id, rowId: pairRow.id,
        expiresAt: Date.now() + SUPLENTE_CONFIRM_TTL_MS, reprompted: false,
      })
      await reply('out_pair_menu', { partner: other.name })
      return
    }

    // Sai a dupla inteira quando é pedido — ou quando quem ficaria não pode
    // gerir o lugar sozinho: um convite por reclamar (legado #339) ou um
    // convidado só por nome (sem número, o bot não o reconhece num «Out»).
    if (choice === 'pair' || (choice === 'me' && (other.claim_pending || (other.guest && !other.phoneHash)))) {
      const { error } = await supabase.from('participants').delete().eq('id', pairRow.id)
      timer.mark('gravar')
      if (error) throw new Error(`Failed to remove pair: ${error.message}`)
      await repostAfterLeave(game, rows, suplentes)
      if (choice === 'me') await reply('out_pair_whole_unclaimed', { partner: other.name })
      return
    }

    // Fica um: o lado que não sai (conta ou convidado), na mesma linha —
    // mantém a posição na lista.
    const staying = choice === 'me' ? otherSide : mySide
    const leaving = choice === 'me' ? mySide : otherSide
    const { error } = await supabase
      .from('participants')
      .update({
        user_id: staying.user ?? null,
        guest_id: staying.guest ?? null,
        partner_id: null,
        partner_guest_id: null,
        joined_alone: true,
      })
      .eq('id', pairRow.id)
    timer.mark('gravar')
    if (error) throw new Error(`Failed to shrink pair: ${error.message}`)
    // Quem saiu era convidado → a linha dele em game_guests já não serve.
    if (leaving.guest) await deleteGuestIfOrphan(leaving.guest)
    // O convite por link de quem saiu deixa de ter lugar (legado #339).
    if (choice === 'partner' && other.claim_pending) {
      await supabase.from('partner_invites').delete().eq('participant_id', pairRow.id)
    }
    const { error: promoteError } = await supabase.rpc('promote_waitlist', { p_game_id: game.id })
    // Ex.: o 1.º suplente é uma dupla e só abriu uma vaga — o trigger das
    // vagas recusa; a saída já está feita, fica só sem promoção.
    if (promoteError) console.error('promote_waitlist after pair shrink failed:', promoteError.message)
    await repostAfterLeave(game, rows, suplentes)
    await reply(choice === 'me' ? 'out_pair_done_me' : 'out_pair_done_partner', { partner: other.name, title: game.title })
  }

  // Resposta ao menu 1/2/3: o mix e a dupla podem ter mudado nos minutos da
  // pergunta — volta-se a carregar e a confirmar.
  async function confirmOutPair(pending, choice) {
    const profile = resolvedProfile ?? guestIdentity(senderPn, usablePushName(message?.pushName))
    const { game, rows, suplentes } = await loadGame(pending.gameId)
    const pairRow = rows.find((row) => row.id === pending.rowId && row.status === 'confirmed'
      && (row.partner_id || row.partner_guest_id) && rowIsMine(profile, myHash, row))
    if (!OPEN_STATUSES.has(game.status) || new Date(game.date).getTime() <= Date.now() || !pairRow) {
      await reply('mix_no_longer_available')
      return
    }
    await leavePair({ game, pairRow, profile, rows, suplentes, choice })
  }

  /** «In» num mix cheio: entra logo na lista de suplentes (já não pergunta «Sim/Não»). */
  async function joinWaitlist(gameId, profile, isNewGuest) {
    const insertError = profile.guest
      ? await insertGuestParticipant(gameId, profile, 'waitlisted')
      : (await supabase
          .from('participants')
          .insert([{ game_id: gameId, user_id: profile.id, status: 'waitlisted', joined_alone: true }])).error
    if (insertError) {
      if (insertError.code === '23505') {
        await reply('already_waitlisted')
        return
      }
      throw new Error(`Failed to insert waitlisted participant: ${insertError.message}`)
    }
    repostHooks.requestRepostForGame(organizationId, gameId)
    if (isNewGuest) {
      await reply('guest_waitlisted', { name: profile.name, appUrl: config.appUrl })
    } else {
      await reply('waitlisted')
    }
  }

  // Joins/leaves a specific, already-resolved mix — the same logic
  // regardless of how that mix got picked (explicit code, the only-one-open
  // shortcut, or being the one mix the sender is in for a bare "out").
  async function actOnGame(mixRow, profile) {
    const { game, people, capacity, rows, suplentes } = await loadGame(mixRow.id)
    timer.mark('mix')
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
    } else if (!profile) {
      // «Out» de quem não tem conta: a identidade é o número — se houver
      // uma inscrição-convidado dele, sai; senão cai no «not_joined».
      profile = guestIdentity(senderPn, usablePushName(message?.pushName))
    }
    if (!profile) return

    // Os inscritos já vieram com o loadGame — sem outra ida à BD.
    const existingRows = rows

    const ownConfirmedRow = existingRows.find((row) => rowOwnerIsMine(profile, myHash, row) && row.status === 'confirmed')
    const ownWaitlistRow = existingRows.find((row) => rowOwnerIsMine(profile, myHash, row) && row.status === 'waitlisted')
    const asPartnerRow = existingRows.find((row) => rowPartnerIsMine(profile, myHash, row))

    if (action === 'in') {
      // Sem conta não se iniciam duplas (o pedido/aceitação precisa de
      // conta) — entra sozinho, ou o parceiro escreve ele próprio.
      if (profile.guest && partnerRequest) {
        await reply('guest_pair_need_account', { appUrl: config.appUrl })
        return
      }
      // #554: já inscrito sozinho e agora «In com …» → junta o parceiro à
      // inscrição que já tem, em vez de «Já estás inscrito».
      if (ownConfirmedRow && !ownConfirmedRow.partner_id && !ownConfirmedRow.partner_guest_id && partnerRequest) {
        await addPartnerToRow({ game, people, capacity, profile, row: ownConfirmedRow, existingRows })
        return
      }
      if (ownConfirmedRow || asPartnerRow) {
        await reply('already_joined')
        return
      }
      if (ownWaitlistRow) {
        await reply('already_waitlisted')
        return
      }
      if (partnerRequest) {
        await joinAsPair({ game, people, capacity, profile, isNewGuest, existingRows })
        return
      }
      // Mix cheio: fica logo como suplente, sem perguntar (Renato, 6 out).
      if (people.length >= capacity) {
        await joinWaitlist(game.id, profile, isNewGuest)
        return
      }

      const insertError = profile.guest
        ? await insertGuestParticipant(game.id, profile, 'confirmed')
        : (await supabase
            .from('participants')
            .insert([{ game_id: game.id, user_id: profile.id, status: 'confirmed', joined_alone: true }])).error
      timer.mark('gravar')

      if (insertError) {
        if (insertError.code === '23505') {
          await reply('already_joined')
          return
        }
        if (isGameFull(insertError)) {
          await joinWaitlist(game.id, profile, isNewGuest)
          return
        }
        throw new Error(`Failed to insert participant: ${insertError.message}`)
      }
      // Pede o repost já, sem esperar pelo Realtime (sync.js, pela fila de 4 s).
      repostHooks.requestRepostForGame(organizationId, game.id)
      // A regular join gets no reply — the participants INSERT triggers a
      // roster repost via sync.js, and that repost IS the confirmation. A
      // brand-new guest still needs an explicit nudge, though: a bare
      // roster repost wouldn't explain what just happened or that signing
      // up unlocks their history/friends/rewards (Trello #19).
      if (isNewGuest) {
        await reply('guest_joined', { name: profile.name, appUrl: config.appUrl })
      }
      return { joined: true, isNewGuest, name: profile.name }
    }

    // action === 'out'
    const pairRow = existingRows.find((row) => row.status === 'confirmed' && (row.partner_id || row.partner_guest_id)
      && rowIsMine(profile, myHash, row))
    if (pairRow) {
      await leavePair({ game, pairRow, profile, rows, suplentes })
      return
    }
    if (outRequest?.kind === 'mention') {
      await reply('out_not_in_pair')
      return
    }
    if (asPartnerRow) {
      await reply('partner_joined_use_app')
      return
    }
    if (ownWaitlistRow) {
      // Mensagens novas (1 out): o suplente sai pelo WhatsApp, em vez de
      // ser mandado para a app.
      if (!fresh) {
        await reply('waitlisted_use_app')
        return
      }
      const { error: leaveError } = await supabase.from('participants').delete().eq('id', ownWaitlistRow.id)
      timer.mark('gravar')
      if (leaveError) throw new Error(`Failed to remove waitlisted participant: ${leaveError.message}`)
      await reply('waitlist_left')
      // O cartão mostra os suplentes: volta a sair sem este.
      repostHooks.requestRepostForGame(organizationId, game.id)
      return
    }
    if (!ownConfirmedRow) {
      await reply('not_joined')
      return
    }

    const { error: deleteError } = await supabase.from('participants').delete().eq('id', ownConfirmedRow.id)
    timer.mark('gravar')
    if (deleteError) throw new Error(`Failed to remove participant: ${deleteError.message}`)
    // Sem resposta: a lista publicada de novo é a confirmação.
    await repostAfterLeave(game, rows, suplentes)
  }

  /**
   * Lista do robô copiada e publicada com nomes a mais (Francisco, 27 set).
   * O mix é o do grupo; com vários abertos, o que a cópia mostra (link,
   * número ou título). Cada nome a mais, dentro das vagas:
   *   · é quem enviou → «In» por ele, com as regras do «In» normal;
   *   · é alguém do clube (nome igual, ou o único parecido) → inscreve-o;
   *   · há mais do que um parecido → não adivinha, diz quais;
   *   · ninguém → convidado criado pelo nome (conta por reclamar).
   * Sem nomes a mais: ignora.
   */
  async function handleCopiedList(copied, openMixes) {
    const labelable = labelableMixes(openMixes)
    let mix = copied.gameId ? openMixes.find((m) => m.id === copied.gameId) : null
    if (!mix && copied.label) mix = openMixes.find((m) => mixLabel(m, labelable) === copied.label)
    if (!mix && copied.title) mix = openMixes.find((m) => normName(m.title) === normName(copied.title))
    if (!mix && openMixes.length === 1) mix = openMixes[0]
    if (!mix) return

    const state = await loadGame(mix.id)
    if (!OPEN_STATUSES.has(state.game.status) || new Date(state.game.date).getTime() <= Date.now()) return
    const extras = extraNames(copied.names, [...state.people, ...state.suplentes].map((p) => p.name))
    if (extras.length === 0) return

    const senderNames = [resolvedProfile?.name, message?.pushName]
    let members = null
    let spots = state.capacity - state.people.length
    const enrolledIds = new Set(state.rows.flatMap((r) => [r.user_id, r.partner_id]).filter(Boolean))
    const full = []
    for (const extra of extras) {
      if (isSenderName(extra, senderNames)) {
        const result = await actOnGame(mix, resolvedProfile)
        if (result?.joined) {
          spots -= 1
          if (!result.isNewGuest) await reply('copied_list_joined', { name: result.name })
        }
        continue
      }
      if (spots <= 0) { full.push(extra); continue }
      if (!members) {
        const { data, error } = await supabase
          .from('memberships')
          .select('user_id, profile:profiles!inner(id, name)')
          .eq('organization_id', organizationId)
        if (error) throw new Error(`Failed to load members for copied list: ${error.message}`)
        members = data.map((r) => ({ id: r.user_id, name: r.profile.name })).filter((x) => !enrolledIds.has(x.id))
      }
      const exact = members.filter((x) => normName(x.name) === normName(extra))
      const matches = exact.length === 1 ? exact : members.filter((x) => copiedNameMatches(x.name, extra))
      if (matches.length > 1) {
        await reply('copied_list_ambiguous', { name: extra, list: matches.slice(0, 6).map((x) => `• ${x.name}`).join('\n') })
        continue
      }
      let who = matches[0] ?? null
      let guestRowId = null
      if (!who) {
        // Ninguém do clube com este nome → convidado sem conta, só por nome
        // (substitui a antiga conta por reclamar — decisão Ruben, 30 set).
        guestRowId = await createNamedGameGuest(mix.id, extra)
        who = { id: null, name: extra }
      }
      const { error: insertError } = await supabase
        .from('participants')
        .insert([guestRowId
          ? { game_id: mix.id, guest_id: guestRowId, status: 'confirmed', joined_alone: true }
          : { game_id: mix.id, user_id: who.id, status: 'confirmed', joined_alone: true }])
      if (insertError) {
        if (guestRowId) await supabase.from('game_guests').delete().eq('id', guestRowId)
        if (isGameFull(insertError)) { spots = 0; full.push(extra); continue }
        if (insertError.code === '23505') continue
        throw new Error(`Failed to insert copied-list participant: ${insertError.message}`)
      }
      spots -= 1
      if (who.id) {
        enrolledIds.add(who.id)
        members = members.filter((x) => x.id !== who.id)
      }
      repostHooks.requestRepostForGame(organizationId, mix.id)
      await reply(guestRowId ? 'copied_list_added_guest' : 'copied_list_added_member', { name: who.name })
    }
    if (full.length > 0) await reply('copied_list_full', { names: full.join(', ') })
  }

  /**
   * Depois de alguém sair: pede o repost já, sem esperar pelo Realtime (que
   * às vezes chega tarde, e aí só a reconciliação de 60 s repostava). Para
   * não perder o «🎉 X subiu da lista de suplentes», vê-se aqui quem o
   * promote_waitlist promoveu: os suplentes de antes que agora estão
   * confirmados. `rows`/`suplentes` são os do loadGame de ANTES da saída.
   */
  async function repostAfterLeave(game, rows, suplentes) {
    const waitlistedBefore = rows.filter((row) => row.status === 'waitlisted')
    let promotedNames = []
    if (waitlistedBefore.length > 0) {
      const { data: after, error: afterError } = await supabase
        .from('participants')
        .select('id, status')
        .in('id', waitlistedBefore.map((row) => row.id))
      if (afterError) {
        console.error('Failed to check promotions after leaving:', afterError)
      } else {
        const nowConfirmed = new Set(after.filter((row) => row.status === 'confirmed').map((row) => row.id))
        promotedNames = waitlistedBefore
          .map((row, i) => (nowConfirmed.has(row.id) ? { gameId: game.id, name: suplentes[i]?.name || 'Jogador', lang: suplentes[i]?.language ?? 'pt' } : null))
          .filter(Boolean)
      }
    }
    repostHooks.requestRepostForGame(organizationId, game.id, { promotedNames })
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

  // Only take this shortcut when no identifier was typed — otherwise a
  // sender naming a specific (possibly already-closed) mix while exactly
  // one happens to be open would get silently redirected to it instead of
  // the "not found" reply step 2 below would give (Trello #253 review).
  if (openMixes.length === 1 && !rest) {
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
      await reply(
        action === 'in' ? (partnerRequest ? 'disambiguate_in_pair' : 'disambiguate_in') : 'disambiguate_out',
        disambiguateVars(matched, openMixes, lang, fresh)
      )
      return
    }
    await reply('mix_identifier_not_found')
    return
  }

  // As inscrições de quem escreve nos mixes abertos — por conta ou pelo
  // hash do número (inscrições-convidado).
  async function myGameIds(identity, { withWaitlist = false } = {}) {
    const { data: rows, error } = await supabase
      .from('participants')
      .select('game_id, user_id, partner_id, guest:game_guests!participants_guest_id_fkey(phone_hash), partner_guest:game_guests!participants_partner_guest_id_fkey(phone_hash)')
      .in('game_id', openMixes.map((m) => m.id))
      .in('status', withWaitlist ? ['confirmed', 'waitlisted'] : ['confirmed'])
    if (error) throw new Error(`Failed to check existing participants: ${error.message}`)
    return new Set(
      rows
        .filter((row) =>
          isMine(identity, row.user_id) || isMine(identity, row.partner_id) ||
          row.guest?.phone_hash === myHash || row.partner_guest?.phone_hash === myHash)
        .map((row) => row.game_id)
    )
  }

  // 3) Bare "in"/"out", no identifier, no (resolvable) reply.
  if (action === 'in') {
    // Already joined every open mix but one? A bare "in" then means "the
    // one I'm missing" — no need to ask (Francisco, 2026-09-14). Também
    // para convidados sem conta: as inscrições deles contam pelo número.
    const memberGameIds = await myGameIds(resolvedProfile)
    let candidates = openMixes
    const notJoined = openMixes.filter((m) => !memberGameIds.has(m.id))
    if (notJoined.length === 1) {
      await actOnGame(notJoined[0], resolvedProfile)
      return
    }
    if (notJoined.length > 0) candidates = notJoined
    // Already in ALL open mixes: nothing left to auto-resolve to, so
    // fall through and show the full list — asking is the least-wrong
    // option there.
    await reply(partnerRequest ? 'disambiguate_in_pair' : 'disambiguate_in', disambiguateVars(candidates, openMixes, lang, fresh))
    return
  }

  // action === 'out': sem conta, a identidade é o número — as
  // inscrições-convidado dele contam como dele.
  const profile = resolvedProfile ?? guestIdentity(senderPn, usablePushName(message?.pushName))

  // Nas mensagens novas, um suplente também pode sair com Out.
  const memberGameIds = await myGameIds(profile, { withWaitlist: fresh })
  const memberMixes = openMixes.filter((m) => memberGameIds.has(m.id))

  if (memberMixes.length === 0) {
    await reply('not_in_any_open_mix')
    return
  }
  if (memberMixes.length > 1) {
    await reply('disambiguate_out', disambiguateVars(memberMixes, openMixes, lang, fresh))
    return
  }

  await actOnGame(memberMixes[0], profile)
}
