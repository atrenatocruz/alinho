import { supabase } from './supabase.js'
import { loadGame, getOpenMixes, buildMixMessage, recordMixMessage } from './roster.js'
import { loadOpenSlotBatch, buildOpenSlotsMessage } from './openSlots.js'
import { getGroups, getGroupsForOrg, mixVisibleToGroup } from './groups.js'
import { helpFooter } from './messages.js'
import { t } from './locales.js'
import { startTimer } from './timing.js'

const DEBOUNCE_MS = 4000
const RECONCILE_INTERVAL_MS = 60 * 1000

// Multi-grupo: todo o estado de repost é POR GRUPO (um processo serve N
// grupos, possivelmente de clubes diferentes — ver groups.js). Desde o
// redesign de 2026-09-14, cada mix aberto é a SUA PRÓPRIA mensagem (deixou
// de haver uma única mensagem combinada) — por isso o estado por grupo
// agora rastreia um hash + messageId por mix (`mixes`), não um hash só.
//
// Também por grupo: debounceTimer/lastPostAt (debounce leading+trailing —
// o primeiro evento após janela calma posta já, os seguintes coalescem),
// pendingTagAll e pendingPromotedByGame (sticky através da coalescência).
const groupState = new Map() // groupJid -> state

// Guardados pelo startSync — o commands.js pede reposts por aqui.
let deps = null

/** Um «In»/«Out» acabou de gravar: pede o repost já, sem esperar pelo
 *  Realtime (que também vai chegar — o hash engole o repetido). Passa
 *  SEMPRE pela fila de 4 s por grupo, para uma rajada continuar a dar no
 *  máximo 2 mensagens. No «Out», quem chama diz quem subiu da lista de
 *  suplentes (`promotedNames`, como o handler Realtime) — senão o repost
 *  sairia antes do Realtime e perdia o «🎉 X subiu…». */
function requestRepostForGame(organizationId, gameId, { promotedNames = [] } = {}) {
  if (!deps) return
  scheduleRepostForOrg(deps.sendText, deps.getGroupMentions, organizationId, { gameIds: [gameId], promotedNames })
    .catch((err) => console.error('Failed to request repost:', err))
}
// Num objeto (e não um export solto) para os testes o poderem simular.
export const repostHooks = { requestRepostForGame }

/** Só para testes: um pedido de repost SEM pista (como o de uma edição do mix). */
export function scheduleRepostForOrgForTests(organizationId, opts = {}) {
  return scheduleRepostForOrg(deps.sendText, deps.getGroupMentions, organizationId, opts)
}

/** Só para testes: liga os deps sem abrir o Realtime nem os intervalos, e
 *  esquece o estado por grupo (hashes, filas) do teste anterior. */
export function startSyncForTests(d) {
  deps = d
  for (const st of groupState.values()) if (st.debounceTimer) clearTimeout(st.debounceTimer)
  groupState.clear()
}

function stateFor(groupJid) {
  let st = groupState.get(groupJid)
  if (!st) {
    st = {
      debounceTimer: null,
      lastPostAt: 0,
      mixes: new Map(), // gameId -> { hash, messageId }
      openSlotBatches: new Map(), // batchId -> { hash, messageId }
      pendingTagAll: false,
      pendingPromotedByGame: new Map(), // gameId -> { name, lang }
      pendingGameIds: new Set(), // mixes que mudaram desde o último repost (Tarefa 7)
      // Houve um pedido SEM pista (edição de um mix, reconciliação…) desde o
      // último repost: esse repost tem de recarregar tudo, mesmo que também
      // haja pistas (revisão final, 4).
      pendingAll: false,
    }
    groupState.set(groupJid, st)
  }
  return st
}

function hash(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0
  }
  return h
}

/**
 * One WhatsApp message per currently-open (and level-visible) mix in this
 * group — a fresh send whenever that mix's own content changed since the
 * last send (hash-deduped per mix, so an unrelated mix's roster changing
 * never resends this one). A mix that dropped out of the open list (closed,
 * cancelled, filled and completed) is simply stopped tracking; nothing is
 * sent for it here (see the design spec's open edge case on replying to a
 * since-closed mix's message — commands.js handles that at reply time).
 */
async function postGroupRoster(sendText, getGroupMentions, group, { tagAll = false, promotedByGameId = new Map(), gameIds = new Set() } = {}) {
  const timer = startTimer('repost')
  let sent = 0
  const visibleMixes = (await getOpenMixes(group.organizationId)).filter((mix) => mixVisibleToGroup(mix, group))
  const openMixes = visibleMixes.filter((mix) => mix.origin !== 'open_slot')
  const openSlotMixes = visibleMixes.filter((mix) => mix.origin === 'open_slot')
  const st = stateFor(group.groupJid)
  const total = openMixes.length
  // Só vale a pena carregar os mixes que mudaram SE a lista de abertos é a
  // mesma do último repost — senão a numeração 01/02 dos outros muda e têm
  // de ser todos refeitos.
  const idsKey = openMixes.map((m) => m.id).join(',')
  const narrow = gameIds.size > 0 && st.openIdsKey === idsKey
  st.openIdsKey = idsKey
  const toLoad = narrow ? openMixes.filter((m) => gameIds.has(m.id)) : openMixes
  const mixStates = await Promise.all(toLoad.map((mix) => loadGame(mix.id)))
  const indexOf = new Map(openMixes.map((m, i) => [m.id, i]))
  timer.mark('carregar')
  const mentions = tagAll && (total > 0 || openSlotMixes.length > 0) ? await getGroupMentions(group.groupJid) : null
  // At most one @all per flush, however many mixes' messages (or the open-
  // slot batch message) end up resent in it — shared across both loops
  // below so a brand-new mix and a brand-new open-slot batch in the same
  // flush don't each carry their own @all.
  let taggedThisFlush = false

  for (const state of mixStates) {
    const gameId = state.game.id
    const label = total > 1 ? String(indexOf.get(gameId) + 1).padStart(2, '0') : null

    // Hash only the base message, never the one-time promotion callout — a
    // later reconcile tick never carries a promo, so hashing the
    // promo-prefixed text would make that tick look "different" from an
    // otherwise-unchanged mix and re-send it minus the callout.
    const baseText = buildMixMessage(state, { label })
    const nextHash = hash(baseText)
    const prev = st.mixes.get(gameId)
    if (prev && prev.hash === nextHash) continue

    const promo = promotedByGameId.get(gameId)
    const promoText = promo ? `${t('promoted_to_confirmed', promo.lang ?? 'pt', { name: promo.name })}\n\n` : ''
    const text = promoText + baseText
    const shouldTagThis = tagAll && !taggedThisFlush
    const fullText = shouldTagThis ? `📢 @all\n\n${text}` : text

    const messageId = await sendText(group.groupJid, fullText, shouldTagThis ? { mentions } : {})
    sent++
    if (shouldTagThis) taggedThisFlush = true
    st.mixes.set(gameId, { hash: nextHash, messageId })
    if (messageId) recordMixMessage(messageId, gameId)
  }

  // Drop mixes no longer open, so a later reappearance (e.g. level filter
  // toggled off then back on) resends fresh instead of being swallowed as
  // "same as last post".
  const openIds = new Set(openMixes.map((m) => m.id))
  for (const gameId of st.mixes.keys()) {
    if (!openIds.has(gameId)) st.mixes.delete(gameId)
  }

  // Jogos em aberto: uma mensagem combinada por open_batch_id, nunca uma
  // por slot (ver openSlots.js).
  const batchIds = new Set(openSlotMixes.map((m) => m.open_batch_id).filter(Boolean))
  const seenBatchIds = new Set()
  for (const batchId of batchIds) {
    seenBatchIds.add(batchId)
    const batch = await loadOpenSlotBatch(batchId)
    if (batch.games.length === 0) continue
    const baseText = buildOpenSlotsMessage(batch)
    const nextHash = hash(baseText)
    const prev = st.openSlotBatches.get(batchId)
    if (prev && prev.hash === nextHash) continue

    const shouldTagThis = tagAll && !taggedThisFlush
    const fullText = shouldTagThis ? `📢 @all\n\n${baseText}` : baseText
    const messageId = await sendText(group.groupJid, fullText, shouldTagThis ? { mentions } : {})
    sent++
    if (shouldTagThis) taggedThisFlush = true
    st.openSlotBatches.set(batchId, { hash: nextHash, messageId })
  }

  for (const batchId of st.openSlotBatches.keys()) {
    if (!seenBatchIds.has(batchId)) st.openSlotBatches.delete(batchId)
  }
  timer.mark('enviar')
  timer.end({ group: group.groupJid, mixes: total, sent })
}

function flushRepost(sendText, getGroupMentions, group) {
  const st = stateFor(group.groupJid)
  const shouldTagAll = st.pendingTagAll
  const promotedByGameId = st.pendingPromotedByGame
  // Com um pedido «de tudo» pelo meio, não se passa pista nenhuma.
  const gameIds = st.pendingAll ? new Set() : st.pendingGameIds
  st.pendingTagAll = false
  st.pendingPromotedByGame = new Map()
  st.pendingGameIds = new Set()
  st.pendingAll = false
  postGroupRoster(sendText, getGroupMentions, group, { tagAll: shouldTagAll, promotedByGameId, gameIds }).catch((err) =>
    console.error(`Failed to repost roster to ${group.groupJid}:`, err)
  )
}

// Leading + trailing debounce, por grupo. Um join não tem resposta direta —
// o repost do roster É a confirmação — por isso o primeiro evento após uma
// janela calma posta imediatamente; os que chegarem dentro da janela
// coalescem num único repost final. Rajada de N joins custa no máximo 2
// mensagens por grupo, e o hash-dedupe engole envios sem alterações.
function scheduleGroupRepost(sendText, getGroupMentions, group, { tagAll = false, promotedNames = [], gameIds = [] } = {}) {
  const st = stateFor(group.groupJid)
  const hinted = gameIds.filter(Boolean)
  if (hinted.length === 0) st.pendingAll = true
  for (const id of hinted) st.pendingGameIds.add(id)
  st.pendingTagAll = st.pendingTagAll || tagAll
  // Each entry is { gameId, name, lang } — keyed by gameId so the callout
  // prefixes only that specific mix's message, not every open mix's.
  for (const p of promotedNames) st.pendingPromotedByGame.set(p.gameId, p)

  if (!st.debounceTimer && Date.now() - st.lastPostAt >= DEBOUNCE_MS) {
    st.lastPostAt = Date.now()
    flushRepost(sendText, getGroupMentions, group)
    return
  }

  if (st.debounceTimer) clearTimeout(st.debounceTimer)
  st.debounceTimer = setTimeout(() => {
    st.debounceTimer = null
    st.lastPostAt = Date.now()
    flushRepost(sendText, getGroupMentions, group)
  }, DEBOUNCE_MS)
}

/**
 * Agenda repost nos grupos certos: os do clube indicado, ou todos os
 * grupos servidos quando o clube não é determinável (p_org null). O
 * conteúdo é recalculado por grupo no momento do post, e o hash por grupo
 * transforma "grupo não afetado" num no-op — errar por excesso aqui custa
 * só queries, nunca mensagens repetidas.
 */
async function scheduleRepostForOrg(sendText, getGroupMentions, organizationId, opts = {}) {
  const groups = organizationId ? await getGroupsForOrg(organizationId) : await getGroups()
  for (const group of groups) {
    scheduleGroupRepost(sendText, getGroupMentions, group, opts)
  }
}

/** A que clube pertence este evento de participants? (a linha só tem game_id)
    A subscrição de participants é global ao projeto Supabase — dispara
    para clubes que este processo nem serve — por isso o lookup é cacheado
    (a org de um jogo nunca muda) e limitado. */
const gameOrgCache = new Map() // gameId -> organizationId
const GAME_ORG_CACHE_MAX = 500

async function orgIdForGame(gameId) {
  if (!gameId) return null
  if (gameOrgCache.has(gameId)) return gameOrgCache.get(gameId)

  const { data, error } = await supabase.from('games').select('organization_id').eq('id', gameId).single()
  if (error) {
    console.error('Failed to resolve organization for game event:', error)
    return null // caller decides the fallback
  }
  if (gameOrgCache.size >= GAME_ORG_CACHE_MAX) {
    gameOrgCache.delete(gameOrgCache.keys().next().value)
  }
  gameOrgCache.set(gameId, data.organization_id)
  return data.organization_id
}

/**
 * Aquece o hash de cada grupo em silêncio no arranque: calcula o roster
 * atual e guarda o hash SEM enviar nada. Sem isto, o hash começa vazio em
 * cada processo novo e o primeiro tick de reconciliação repostava o
 * roster inteiro a cada restart — spam no grupo sempre que o bot
 * reiniciava, sem qualquer mudança real. Custo aceite: uma mudança
 * ocorrida enquanto o bot esteve em baixo só é anunciada quando algo
 * voltar a mexer (o conteúdo em si nunca se perde — cada repost é
 * recalculado da BD).
 */
async function primeGroupHashes() {
  const groups = await getGroups()
  for (const group of groups) {
    try {
      const visibleMixes = (await getOpenMixes(group.organizationId)).filter((mix) => mixVisibleToGroup(mix, group))
      const openMixes = visibleMixes.filter((mix) => mix.origin !== 'open_slot')
      const openSlotMixes = visibleMixes.filter((mix) => mix.origin === 'open_slot')
      const mixStates = await Promise.all(openMixes.map((mix) => loadGame(mix.id)))
      const total = mixStates.length
      const st = stateFor(group.groupJid)
      for (let i = 0; i < mixStates.length; i++) {
        const state = mixStates[i]
        const label = total > 1 ? String(i + 1).padStart(2, '0') : null
        // No messageId — a reply to a message sent before this restart
        // can't be resolved via roster.js's map; it just falls back to
        // text-based matching in commands.js, same as an unknown stanzaId.
        st.mixes.set(state.game.id, { hash: hash(buildMixMessage(state, { label })), messageId: null })
      }

      const batchIds = new Set(openSlotMixes.map((m) => m.open_batch_id).filter(Boolean))
      for (const batchId of batchIds) {
        const batch = await loadOpenSlotBatch(batchId)
        if (batch.games.length === 0) continue
        st.openSlotBatches.set(batchId, { hash: hash(buildOpenSlotsMessage(batch)), messageId: null })
      }
    } catch (err) {
      console.error(`Failed to prime roster hash for ${group.groupJid}:`, err)
    }
  }
}

/** Wires Supabase Realtime so any game/participant change — from the app OR from the bot's own WhatsApp-driven writes, for ANY currently open mix of ANY served club — results in a fresh roster repost to every group that can see it. */
export function startSync({ sendText, getGroupMentions }) {
  deps = { sendText, getGroupMentions }
  primeGroupHashes().catch((err) => console.error('Failed to prime roster hashes:', err))

  supabase
    .channel('whatsapp-bot-games')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'games' }, async (payload) => {
      if (payload.new.status !== 'open') return
      // A brand-new mix — tag everyone in that club's groups so they notice.
      await scheduleRepostForOrg(sendText, getGroupMentions, payload.new.organization_id, { tagAll: true })
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games' }, async (payload) => {
      const orgId = payload.new.organization_id
      const groups = await getGroupsForOrg(orgId)
      if (groups.length === 0) return

      const wasCancelled = payload.old.status === 'cancelled'
      const justCancelled = payload.new.status === 'cancelled' && !wasCancelled
      const shouldAnnounceCancellation = justCancelled && payload.new.origin !== 'open_slot'
      if (shouldAnnounceCancellation) {
        // Broadcast — só aos grupos que viam este mix (filtro de nível). Jogos
        // em aberto ficam de fora: a mensagem combinada re-renderizada (abaixo)
        // já comunica a mudança de forma precisa, e este aviso genérico não diz
        // sequer qual horário foi cancelado (título é sempre "Jogo em Aberto").
        for (const group of groups) {
          if (!mixVisibleToGroup(payload.new, group)) continue
          try {
            const mentions = await getGroupMentions(group.groupJid)
            await sendText(
              group.groupJid,
              `${t('mix_cancelled', 'pt', { title: payload.new.title })}${helpFooter('pt')}`,
              { mentions }
            )
          } catch (err) {
            console.error(`Failed to announce cancellation to ${group.groupJid}:`, err)
          }
        }
      }
      // Refresh the combined view either way (drops the cancelled mix,
      // or reflects whatever else changed). The cancellation notice above
      // already tagged everyone, so don't double-tag on its follow-up
      // refresh — any other edit still tags.
      await scheduleRepostForOrg(sendText, getGroupMentions, orgId, { tagAll: !justCancelled })
    })
    .subscribe()

  supabase
    .channel('whatsapp-bot-participants')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'participants' }, async (payload) => {
      // A subscrição dispara para TODOS os clubes do projeto, não só os
      // servidos — se este processo não serve nenhum grupo, nem vale a
      // pena resolver a org.
      if ((await getGroups()).length === 0) return

      const orgId = await orgIdForGame(payload.new?.game_id ?? payload.old?.game_id)

      // A promotion is an UPDATE from waitlisted -> confirmed (the
      // check_game_promote trigger). `old` is available because
      // participants has REPLICA IDENTITY FULL (migration_whatsapp_bot.sql).
      const isPromotion =
        payload.eventType === 'UPDATE' &&
        payload.old?.status === 'waitlisted' &&
        payload.new?.status === 'confirmed'

      if (!isPromotion) {
        // Always recomputed fresh from the DB at post time, and the hash
        // check above skips a no-op send — no need to pre-filter which
        // mix this row belongs to. Someone joining/leaving isn't a
        // create/edit, so this never tags @all.
        await scheduleRepostForOrg(sendText, getGroupMentions, orgId, { gameIds: [payload.new?.game_id ?? payload.old?.game_id] })
        return
      }

      // O callout nomeia uma pessoa — se a org deste evento não resolveu
      // (falha transitória do lookup), o fallback "repost a todos os
      // grupos" mandaria o nome de um jogador para grupos de OUTROS
      // clubes. Nesse caso reposta-se sem o callout (o roster atualizado
      // já mostra a promoção; o nome só não é anunciado).
      if (orgId === null) {
        await scheduleRepostForOrg(sendText, getGroupMentions, null)
        return
      }

      const { data: promotedProfile } = await supabase
        .from('profiles')
        .select('name, language')
        .eq('id', payload.new.user_id)
        .single()

      await scheduleRepostForOrg(sendText, getGroupMentions, orgId, {
        gameIds: [payload.new.game_id],
        promotedNames: [
          { gameId: payload.new.game_id, name: promotedProfile?.name || 'Jogador', lang: promotedProfile?.language ?? 'pt' },
        ],
      })
    })
    .subscribe()

  // Safety net: catches any change missed during a transient Realtime
  // disconnect, without spamming (only reposts if a group's roster
  // actually differs from what was last sent there). Never tags @all —
  // it's not a new create/edit event, just catching up.
  setInterval(async () => {
    try {
      const groups = await getGroups()
      for (const group of groups) {
        await postGroupRoster(sendText, getGroupMentions, group).catch((err) =>
          console.error(`Reconciliation tick failed for ${group.groupJid}:`, err)
        )
      }
    } catch (err) {
      console.error('Reconciliation tick failed:', err)
    }
  }, RECONCILE_INTERVAL_MS)
}
