import { supabase } from './supabase.js'
import { getGroupsForOrg, getServedOrgIds, mixVisibleToGroup } from './groups.js'
import { helpFooter } from './messages.js'
import { t } from './locales.js'

const CHECK_INTERVAL_MS = 5 * 60 * 1000

// Duplicated from roster.js/reminders.js rather than shared — this
// codebase already accepts that small duplication over a shared-utils
// file for a one-line helper (see the identical copy in both of those).

function mentionToken(jid) {
  return `@${jid.split('@')[0]}`
}

function pairKey(a, b) {
  return [a, b].sort().join('|')
}

// Port of src/lib/mixLogic.js's formDuplas (modo «por nível») — o mesmo
// algoritmo, sobre ids (user_id/partner_id) em vez de perfis.
//
// Até 28 set a escolha aqui era seguida, sem recuar: cada um levava o mais
// próximo em pontos que não fosse repetição, e os dois últimos ficavam
// juntos mesmo que já tivessem jogado juntos (idx = 0). No mix +1 de 28 set
// saiu assim Aurélio + Diogo Alexandre, dupla do mix de 21 set, quando havia
// uma escolha sem repetições (a que a app faz). Agora é a mesma busca da
// app: sem repetir pares dos últimos 4 mixes, com o lado preferido como
// segunda ordem (primeiro zero duplas do mesmo lado, depois uma…), e a
// recuar sempre que uma escolha deixa o resto sem saída. Só quando é mesmo
// impossível não repetir é que volta à escolha seguida — e diz quais.
const SEARCH_STEPS = 200000

/** Tenta 0 duplas do mesmo lado, depois 1, depois 2… e fica com a primeira
    que completa a lista. null = as repetições não deixam. */
function fewestSameSide(searchOnce, maxPairs) {
  for (let allowance = 0; allowance <= maxPairs; allowance++) {
    const result = searchOnce(allowance, { steps: SEARCH_STEPS })
    if (result) return result
  }
  return null
}

function matchWithoutRepeats(remaining, repeatPairKeys, sidesFit, sameSideLeft, budget) {
  if (remaining.length <= 1) return []
  if (budget.steps-- <= 0) return null
  const [a, ...rest] = remaining
  const tiers = sameSideLeft > 0 ? [true, false] : [true]
  for (const wantFit of tiers) {
    for (let i = 0; i < rest.length; i++) {
      const b = rest[i]
      if (repeatPairKeys.has(pairKey(a, b))) continue
      if (sidesFit(a, b) !== wantFit) continue
      const others = [...rest.slice(0, i), ...rest.slice(i + 1)]
      const completion = matchWithoutRepeats(others, repeatPairKeys, sidesFit, wantFit ? sameSideLeft : sameSideLeft - 1, budget)
      if (completion) return [[a, b], ...completion]
    }
  }
  return null
}

export function formDuplas(participants, pointsById, repeatPairKeys, sideById = {}) {
  const duplas = []
  const solos = []
  for (const row of participants) {
    if (row.partner_id) duplas.push([row.user_id, row.partner_id])
    else solos.push(row.user_id)
  }

  const pointsOf = (id) => pointsById[id] ?? 0
  const sideOf = (id) => (sideById[id] === 'left' || sideById[id] === 'right' ? sideById[id] : 'both')
  const sidesFit = (x, y) => sideOf(x) === 'both' || sideOf(y) === 'both' || sideOf(x) !== sideOf(y)
  solos.sort((a, b) => pointsOf(b) - pointsOf(a))

  const forcedRepeats = []
  let soloPairs = fewestSameSide(
    (allowance, budget) => matchWithoutRepeats(solos, repeatPairKeys, sidesFit, allowance, budget),
    Math.floor(solos.length / 2),
  )
  if (!soloPairs) {
    // Impossível sem repetir: a escolha seguida de antes, e fica registado.
    soloPairs = []
    const remaining = [...solos]
    while (remaining.length >= 2) {
      const a = remaining.shift()
      let idx = remaining.findIndex((candidate) => !repeatPairKeys.has(pairKey(a, candidate)) && sidesFit(a, candidate))
      if (idx === -1) idx = remaining.findIndex((candidate) => !repeatPairKeys.has(pairKey(a, candidate)))
      if (idx === -1) idx = 0
      const b = remaining.splice(idx, 1)[0]
      if (repeatPairKeys.has(pairKey(a, b))) forcedRepeats.push([a, b])
      soloPairs.push([a, b])
    }
  }
  duplas.push(...soloPairs)

  const rows = duplas.map(([p1, p2]) => ({
    player1_id: p1,
    player2_id: p2,
    seed_ranking: pointsOf(p1) + pointsOf(p2),
  }))
  // Para o log (e para os testes): quem repetiu por não haver alternativa.
  rows.forcedRepeats = forcedRepeats
  return rows
}

// O bot só sabe conduzir o que consegue formar: duplas fixas em "Sobe e
// desce" ou "Todos contra todos", por nível. Não sabe Americano (troca de
// parceiro a cada ronda), Grupos + Eliminatórias (fase de grupos e quadro),
// "Trocam a cada ronda", nem os modos Equilibrado/Aleatório — se começasse
// um destes sozinho, formava duplas pelas regras erradas e o admin ficava
// com um mix a decorrer que não pediu. Nestes casos não arranca: o mix
// espera pelo admin, que o começa na app.
function botConsegueComecar(game) {
  const formato = game.format || 'sobe_desce'
  if (!['sobe_desce', 'todos_contra_todos'].includes(formato)) return false
  if (game.rotate_partners) return false
  if (game.pairing_mode && game.pairing_mode !== 'por_nivel') return false
  return true
}

/**
 * Forms duplas and starts one due mix — same DB writes as handleStartMix in
 * GameDetails.jsx (insert teams, flip status to in_progress), then
 * announces the pairings to the WhatsApp group, tagging both players in
 * each dupla whose WhatsApp JID is already known.
 */
async function autoStartMix(game, { sendText }) {
  if (!botConsegueComecar(game)) {
    console.log(`Auto-start ignorado (formato que o bot não conduz) para o mix ${game.id}`)
    return
  }

  const { data: participants, error: pErr } = await supabase
    .from('participants')
    .select('user_id, partner_id')
    .eq('game_id', game.id)
    .eq('status', 'confirmed')
  if (pErr) throw new Error(`Failed to load participants for auto-start: ${pErr.message}`)

  // Only auto-start once every court is actually full — auto_start_hours_before
  // is the earliest the bot starts checking, not a guarantee to start
  // regardless of headcount. Firing on time alone left a mix with free
  // slots stuck in_progress, with no way for late sign-ups to join and no
  // way to cleanly undo it short of an admin "Parar Mix" (Trello #293).
  // Leave status alone and retry on the next poll.
  const capacity = game.max_players || (game.num_courts || 1) * 4
  const peopleCount = (participants || []).reduce((n, p) => n + 1 + (p.partner_id ? 1 : 0), 0)
  if (peopleCount < capacity) return

  const { data: rankings, error: rErr } = await supabase.rpc('get_global_rankings')
  if (rErr) throw new Error(`Failed to load rankings for auto-start: ${rErr.message}`)
  const pointsById = Object.fromEntries((rankings || []).map((r) => [r.user_id, Math.round(r.rating || 0)]))

  // Os últimos QUATRO mixes, como em GameDetails.jsx (loadRepeatPairKeys) —
  // a regra do Francisco é não repetir pares durante pelo menos 4 mixes.
  // Este bloco olhava só para o mix anterior, por isso um mix começado pelo
  // bot repetia pares que o mesmo mix começado na app teria evitado: no mix
  // de 21 set, 3 das 6 duplas já tinham jogado juntas nos 4 anteriores.
  const { data: previousGames } = await supabase
    .from('games')
    .select('id')
    .eq('organization_id', game.organization_id)
    .lt('date', game.date)
    .order('date', { ascending: false })
    .limit(4)
  let repeatPairKeys = new Set()
  if (previousGames?.length) {
    const { data: previousTeams } = await supabase
      .from('teams')
      .select('player1_id, player2_id')
      .in('game_id', previousGames.map((g) => g.id))
    repeatPairKeys = new Set((previousTeams || []).map((team) => pairKey(team.player1_id, team.player2_id)))
  }

  // O lado preferido de cada um, para não formar duplas do mesmo lado.
  const soloIds = (participants || []).filter((p) => !p.partner_id).map((p) => p.user_id)
  let sideById = {}
  if (soloIds.length) {
    const { data: sideRows, error: sideErr } = await supabase
      .from('profiles')
      .select('id, preferred_side')
      .in('id', soloIds)
    if (sideErr) throw new Error(`Failed to load preferred sides for auto-start: ${sideErr.message}`)
    sideById = Object.fromEntries((sideRows || []).map((r) => [r.id, r.preferred_side || 'both']))
  }

  const duplas = formDuplas(participants || [], pointsById, repeatPairKeys, sideById)
  if (duplas.forcedRepeats.length) {
    console.warn(`Auto-start do mix ${game.id}: ${duplas.forcedRepeats.length} dupla(s) repetida(s) por não haver alternativa`)
  }
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

  // Aos grupos do clube deste mix que o conseguem ver (filtro de nível).
  const groups = (await getGroupsForOrg(game.organization_id)).filter((g) => mixVisibleToGroup(game, g))
  if (groups.length === 0) return

  // `language` selected for consistency with every other `.from('profiles')`
  // call in this bot (see Task 19) — unused below since the pairings
  // announcement is one shared broadcast to the whole group, not a message
  // for any single player, so it stays 'pt' (see locales.js scope note).
  const profileIds = insertedTeams.flatMap((team) => [team.player1_id, team.player2_id])
  const { data: profiles } = await supabase.from('profiles').select('id, name, whatsapp_jid, language').in('id', profileIds)
  const profileById = new Map((profiles || []).map((p) => [p.id, p]))

  const mentions = []
  const label = (profile) => {
    if (profile?.whatsapp_jid) {
      mentions.push(profile.whatsapp_jid)
      return mentionToken(profile.whatsapp_jid)
    }
    return profile?.name || 'Jogador'
  }

  const lines = insertedTeams.map(
    (team, i) => `${i + 1}. ${label(profileById.get(team.player1_id))} 🤝 ${label(profileById.get(team.player2_id))}`
  )

  // Pairings announcement — a shared broadcast to the whole group, stays
  // 'pt' (see locales.js scope note).
  const announceLang = 'pt'
  const text = t('duplas_formed', announceLang, { title: game.title, lines: lines.join('\n') }) + helpFooter(announceLang)
  for (const group of groups) {
    try {
      await sendText(group.groupJid, text, { mentions })
    } catch (err) {
      console.error(`Failed to announce pairings to ${group.groupJid}:`, err)
    }
  }
}

async function checkAutoStartMixes({ sendText }) {
  const orgIds = await getServedOrgIds()
  if (orgIds.length === 0) return

  const { data: games, error } = await supabase
    .from('games')
    .select('*')
    .in('organization_id', orgIds)
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
