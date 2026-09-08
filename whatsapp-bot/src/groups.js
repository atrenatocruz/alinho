import { supabase } from './supabase.js'
import { config } from './config.js'

/**
 * Multi-grupo/multi-clube (spec 2026-09-08): o mapa grupo→clube vem da
 * tabela `whatsapp_groups` — cada grupo WhatsApp em que a conta do bot
 * está pertence a um clube e, opcionalmente, a um filtro de níveis. O
 * routing é por mensagem: o JID do grupo determina o organizationId de
 * tudo o que o handler faz.
 *
 * Fallback legacy: se a tabela ainda não existir na BD (migração por
 * correr) ou estiver vazia, e houver ORGANIZATION_ID no ambiente,
 * sintetiza um único grupo a partir de organizations.whatsapp_group_jid —
 * o comportamento antigo, para o deploy do bot e a migração poderem ir em
 * qualquer ordem.
 */
const CACHE_TTL_MS = 60_000
let cached = null
let cachedAt = 0

// Injetado por index.js a partir de wa.js: devolve o Set de JIDs de grupo
// em que a conta WhatsApp DESTE processo está (ou null = desconhecido →
// não filtrar). Com vários bots (números diferentes) sobre a mesma BD,
// cada processo só serve a interseção da tabela com os grupos da sua
// conta — sem isto, todos tentariam postar/lembrar/auto-arrancar em
// todos os grupos da tabela.
let participatingJidsProvider = null
let warnedSkippedGroups = false

export function setParticipatingJidsProvider(fn) {
  participatingJidsProvider = fn
}

async function filterToParticipating(groups) {
  if (!participatingJidsProvider || groups.length === 0) return groups
  const jids = await participatingJidsProvider()
  if (!jids) return groups // desconhecido (reconexão) — fail-open
  const served = groups.filter((g) => jids.has(g.groupJid))
  if (!warnedSkippedGroups && served.length < groups.length) {
    warnedSkippedGroups = true
    const skipped = groups.filter((g) => !jids.has(g.groupJid)).map((g) => g.groupJid)
    console.warn(
      `A ignorar ${skipped.length} grupo(s) de whatsapp_groups em que esta conta não está (${skipped.join(', ')}) — servidos por outro bot, ou JID errado.`
    )
  }
  return served
}
// Avisar UMA vez por estado problemático — sem isto, um bot mal
// configurado arranca, liga ao WhatsApp e não faz rigorosamente nada,
// com zero pistas nos logs (o ORGANIZATION_ID deixou de ser obrigatório
// no arranque, por isso o aviso tem de vir daqui).
let warnedNoGroups = false
let warnedLegacyMode = false

async function legacyFallback() {
  if (!config.organizationId) {
    if (!warnedNoGroups) {
      warnedNoGroups = true
      console.error(
        'whatsapp_groups está vazia/inexistente e ORGANIZATION_ID não está definido — este bot não serve NENHUM grupo. ' +
          'Regista os grupos na tabela whatsapp_groups (ver supabase/migration_whatsapp_groups.sql) ou define ORGANIZATION_ID para o modo legacy.'
      )
    }
    return []
  }
  if (!warnedLegacyMode) {
    warnedLegacyMode = true
    console.warn(
      'A servir em modo legacy (organizations.whatsapp_group_jid + ORGANIZATION_ID) — a tabela whatsapp_groups não existe ou está vazia.'
    )
  }
  const { data, error } = await supabase
    .from('organizations')
    .select('id, whatsapp_group_jid')
    .eq('id', config.organizationId)
    .single()
  if (error) {
    console.error('Failed to load legacy organization for group fallback:', error)
    return []
  }
  if (!data?.whatsapp_group_jid) return []
  return [{ organizationId: data.id, groupJid: data.whatsapp_group_jid, label: 'legacy', levels: null }]
}

async function loadGroups() {
  const { data, error } = await supabase
    .from('whatsapp_groups')
    .select('organization_id, group_jid, label, levels')
  // 42P01 = undefined_table: migração ainda não correu nesta BD.
  if (error) {
    if (error.code === '42P01') return legacyFallback()
    throw new Error(`Failed to load whatsapp_groups: ${error.message}`)
  }
  if ((data?.length ?? 0) === 0) return legacyFallback()
  return data.map((row) => ({
    organizationId: row.organization_id,
    groupJid: row.group_jid,
    label: row.label,
    levels: row.levels,
  }))
}

/** Todos os grupos servidos por este processo (cache 60 s): as linhas de
    whatsapp_groups cuja conta WhatsApp deste processo está mesmo no grupo. */
export async function getGroups() {
  if (cached && Date.now() - cachedAt < CACHE_TTL_MS) return cached
  cached = await filterToParticipating(await loadGroups())
  cachedAt = Date.now()
  return cached
}

/** O grupo de onde veio uma mensagem, ou null (grupo não configurado → ignorar). */
export async function getGroupByJid(groupJid) {
  const groups = await getGroups()
  return groups.find((g) => g.groupJid === groupJid) ?? null
}

export async function getGroupsForOrg(organizationId) {
  const groups = await getGroups()
  return groups.filter((g) => g.organizationId === organizationId)
}

/** Clubes servidos por este processo (deduplicado). */
export async function getServedOrgIds() {
  const groups = await getGroups()
  return [...new Set(groups.map((g) => g.organizationId))]
}

/**
 * Regra de visibilidade grupo→nível: grupo sem filtro vê tudo; mix sem
 * nível aparece em todos os grupos do clube; caso contrário o nível do
 * mix tem de estar no filtro do grupo.
 */
export function mixVisibleToGroup(game, group) {
  if (!group.levels || group.levels.length === 0) return true
  if (!game.level) return true
  return group.levels.includes(game.level)
}
