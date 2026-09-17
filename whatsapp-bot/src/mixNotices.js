import { supabase } from './supabase.js'
import { getGroupsForOrg, getServedOrgIds, mixVisibleToGroup } from './groups.js'
import { formatDateTime } from './roster.js'
import { helpFooter } from './messages.js'
import { t } from './locales.js'

// Avisos de mix (Trello #292, supabase/migration_mix_notices.sql): quando o
// admin adiciona, tira ou refaz duplas num mix já começado, a app regista
// um aviso por jogador afetado. Este ciclo manda-os por WhatsApp:
//   • mensagem privada a cada jogador com WhatsApp ligado, na língua dele;
//   • a lista nova de duplas aos grupos do clube que veem este mix, a marcar
//     só quem mudou — senão o grupo ficava com as duplas antigas.
// Espera QUIET_MS depois da ÚLTIMA mudança do mix e manda tudo de uma vez:
// três mudanças seguidas dão uma mensagem, e o que o admin desfez antes
// disso já foi limpo pela base de dados (notify_mix_changes junta avisos).

const CHECK_INTERVAL_MS = 60 * 1000
const QUIET_MS = 2 * 60 * 1000
const KINDS = ['mix_joined', 'mix_removed', 'mix_partner_changed']

function mentionToken(jid) {
  return `@${jid.split('@')[0]}`
}

export function noticeText(notice, lang) {
  const d = notice.data || {}
  const when = d.game_date ? formatDateTime(d.game_date, lang) : ''
  const partner = d.partner_name
    ? t('mix_notice_partner', lang, { name: d.partner_name })
    : t('mix_notice_no_partner', lang)
  return t(notice.kind.replace('mix_', 'mix_notice_'), lang, { title: d.game_title || '', when, partner })
}

async function announceUpdatedDuplas(game, changedIds, { sendText }) {
  const groups = (await getGroupsForOrg(game.organization_id)).filter((g) => mixVisibleToGroup(game, g))
  if (groups.length === 0) return

  const { data: teams, error } = await supabase
    .from('teams')
    .select('player1_id, player2_id, seed_ranking')
    .eq('game_id', game.id)
    .order('seed_ranking', { ascending: false })
  if (error) throw new Error(`Failed to load teams for updated pairings: ${error.message}`)
  if (!teams?.length) return

  const ids = teams.flatMap((team) => [team.player1_id, team.player2_id])
  const { data: profiles } = await supabase.from('profiles').select('id, name, whatsapp_jid').in('id', ids)
  const byId = new Map((profiles || []).map((p) => [p.id, p]))

  // Só se marca (@) quem mudou — marcar o mix inteiro outra vez seria barulho.
  const mentions = []
  const label = (id) => {
    const p = byId.get(id)
    if (changedIds.has(id) && p?.whatsapp_jid) {
      mentions.push(p.whatsapp_jid)
      return mentionToken(p.whatsapp_jid)
    }
    return p?.name || 'Jogador'
  }
  const lines = teams.map((team, i) => `${i + 1}. ${label(team.player1_id)} 🤝 ${label(team.player2_id)}`)

  // Mensagem para o grupo inteiro — fica em 'pt' (ver nota em locales.js).
  const text = t('duplas_updated', 'pt', { title: game.title, lines: lines.join('\n') }) + helpFooter('pt')
  for (const group of groups) {
    try {
      await sendText(group.groupJid, text, { mentions })
    } catch (err) {
      console.error(`Failed to announce updated pairings to ${group.groupJid}:`, err)
    }
  }
}

async function processGame(game, notices, { sendText }) {
  // Reclama os avisos antes de mandar: se houver dois processos do bot a
  // servir o mesmo clube, só um fica com cada aviso.
  const { data: claimed, error } = await supabase
    .from('notifications')
    .update({ bot_processed_at: new Date().toISOString() })
    .in('id', notices.map((n) => n.id))
    .is('bot_processed_at', null)
    .select('id')
  if (error) throw new Error(`Failed to claim mix notices: ${error.message}`)
  const claimedIds = new Set((claimed || []).map((row) => row.id))
  const mine = notices.filter((n) => claimedIds.has(n.id))
  if (mine.length === 0) return

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, name, whatsapp_jid, language')
    .in('id', mine.map((n) => n.user_id))
  const profileById = new Map((profiles || []).map((p) => [p.id, p]))

  for (const notice of mine) {
    const profile = profileById.get(notice.user_id)
    if (!profile?.whatsapp_jid) continue
    try {
      await sendText(profile.whatsapp_jid, noticeText(notice, profile.language ?? 'pt'))
    } catch (err) {
      // Best-effort, como os lembretes: uma DM falhada não trava as outras.
      console.error(`Failed to DM mix notice to ${profile.name}:`, err)
    }
  }

  if (game.status === 'in_progress') {
    const changedIds = new Set(mine.filter((n) => n.kind !== 'mix_removed').map((n) => n.user_id))
    await announceUpdatedDuplas(game, changedIds, { sendText })
  }
}

async function checkMixNotices({ sendText }) {
  const orgIds = await getServedOrgIds()
  if (orgIds.length === 0) return

  const { data: notices, error } = await supabase
    .from('notifications')
    .select('id, user_id, kind, game_id, data, created_at, game:games!inner(*)')
    .is('bot_processed_at', null)
    .in('kind', KINDS)
    .in('game.organization_id', orgIds)
    .order('created_at', { ascending: true })
  if (error) {
    // Antes de a migração correr a tabela não existe — silêncio.
    if (error.code !== '42P01' && error.code !== 'PGRST205') console.error('Failed to check mix notices:', error)
    return
  }

  const byGame = new Map()
  for (const notice of notices || []) {
    if (!byGame.has(notice.game_id)) byGame.set(notice.game_id, { game: notice.game, notices: [] })
    byGame.get(notice.game_id).notices.push(notice)
  }

  const now = Date.now()
  for (const { game, notices: gameNotices } of byGame.values()) {
    const last = Math.max(...gameNotices.map((n) => new Date(n.created_at).getTime()))
    if (now - last < QUIET_MS) continue // o admin ainda pode estar a mexer
    await processGame(game, gameNotices, { sendText }).catch((err) =>
      console.error(`Mix notices failed for game ${game.id}:`, err)
    )
  }
}

/** Starts the mix-notices loop. Call once from index.js, same shape as startAutoStart. */
export function startMixNotices({ sendText }) {
  setInterval(() => {
    checkMixNotices({ sendText }).catch((err) => console.error('Mix notices check failed:', err))
  }, CHECK_INTERVAL_MS)
}
