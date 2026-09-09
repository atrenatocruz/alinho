import { supabase } from './supabase.js'
import { loadGame, getOpenMixes, buildCombinedRosterMessage } from './roster.js'
import { getGroups, getGroupsForOrg, mixVisibleToGroup } from './groups.js'
import { helpFooter } from './messages.js'
import { t } from './locales.js'

const DEBOUNCE_MS = 4000
const RECONCILE_INTERVAL_MS = 60 * 1000

// Multi-grupo: todo o estado de repost é POR GRUPO (um processo serve N
// grupos, possivelmente de clubes diferentes — ver groups.js). Cada grupo
// recebe UMA mensagem combinada cobrindo os mixes abertos do SEU clube,
// filtrados pelo seu filtro de nível.
//
// Por grupo: debounceTimer/lastPostAt (debounce leading+trailing — o
// primeiro evento após janela calma posta já, os seguintes coalescem),
// lastPostedHash (dedupe de no-ops), pendingTagAll e pendingPromotedNames
// (sticky através da coalescência, como no modelo antigo de grupo único).
const groupState = new Map() // groupJid -> state

function stateFor(groupJid) {
  let st = groupState.get(groupJid)
  if (!st) {
    st = {
      debounceTimer: null,
      lastPostAt: 0,
      lastPostedHash: null,
      pendingTagAll: false,
      pendingPromotedNames: [],
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

async function postGroupRoster(sendText, getGroupMentions, group, { tagAll = false, promotedNames = [] } = {}) {
  const openMixes = (await getOpenMixes(group.organizationId)).filter((mix) => mixVisibleToGroup(mix, group))
  const mixStates = await Promise.all(openMixes.map((mix) => loadGame(mix.id)))
  const baseText = buildCombinedRosterMessage(mixStates)
  const st = stateFor(group.groupJid)
  if (!baseText) {
    // Nada aberto para este grupo — nada a enviar, mas limpa o hash: se o
    // mesmo roster voltar a ficar visível (ex.: nível do mix editado para
    // fora do filtro e revertido), tem de ser reenviado, não engolido
    // como "igual ao último post".
    st.lastPostedHash = null
    return
  }
  // Hash only the base roster, never the one-time promotion callout — a
  // later reconcile tick never carries promotedNames, so hashing the
  // promo-prefixed text would make that tick look "different" from an
  // otherwise-unchanged roster and re-send it minus the callout.
  const nextHash = hash(baseText)
  if (nextHash === st.lastPostedHash) return

  const text = promotedNames.length > 0
    ? buildCombinedRosterMessage(mixStates, { promotedNames })
    : baseText

  if (tagAll) {
    const mentions = await getGroupMentions(group.groupJid)
    await sendText(group.groupJid, `📢 @all\n\n${text}`, { mentions })
  } else {
    await sendText(group.groupJid, text)
  }
  st.lastPostedHash = nextHash
}

function flushRepost(sendText, getGroupMentions, group) {
  const st = stateFor(group.groupJid)
  const shouldTagAll = st.pendingTagAll
  const namesToAnnounce = st.pendingPromotedNames
  st.pendingTagAll = false
  st.pendingPromotedNames = []
  postGroupRoster(sendText, getGroupMentions, group, { tagAll: shouldTagAll, promotedNames: namesToAnnounce }).catch(
    (err) => console.error(`Failed to repost roster to ${group.groupJid}:`, err)
  )
}

// Leading + trailing debounce, por grupo. Um join não tem resposta direta —
// o repost do roster É a confirmação — por isso o primeiro evento após uma
// janela calma posta imediatamente; os que chegarem dentro da janela
// coalescem num único repost final. Rajada de N joins custa no máximo 2
// mensagens por grupo, e o hash-dedupe engole envios sem alterações.
function scheduleGroupRepost(sendText, getGroupMentions, group, { tagAll = false, promotedNames = [] } = {}) {
  const st = stateFor(group.groupJid)
  st.pendingTagAll = st.pendingTagAll || tagAll
  st.pendingPromotedNames = st.pendingPromotedNames.concat(promotedNames)

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
      const openMixes = (await getOpenMixes(group.organizationId)).filter((mix) => mixVisibleToGroup(mix, group))
      const mixStates = await Promise.all(openMixes.map((mix) => loadGame(mix.id)))
      const baseText = buildCombinedRosterMessage(mixStates)
      stateFor(group.groupJid).lastPostedHash = baseText ? hash(baseText) : null
    } catch (err) {
      console.error(`Failed to prime roster hash for ${group.groupJid}:`, err)
    }
  }
}

/** Wires Supabase Realtime so any game/participant change — from the app OR from the bot's own WhatsApp-driven writes, for ANY currently open mix of ANY served club — results in a fresh roster repost to every group that can see it. */
export function startSync({ sendText, getGroupMentions }) {
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
      if (justCancelled) {
        // Broadcast — só aos grupos que viam este mix (filtro de nível).
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
        await scheduleRepostForOrg(sendText, getGroupMentions, orgId)
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
        promotedNames: [{ name: promotedProfile?.name || 'Jogador', lang: promotedProfile?.language ?? 'pt' }],
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
