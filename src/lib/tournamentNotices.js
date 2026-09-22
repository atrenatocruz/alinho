import { supabase } from './supabase'

/* Avisos do organizador (Trello #366, «Torneio 6/6»).

   Um escreve, todos leem, NINGUÉM responde — sem moderação, sem bloquear,
   sem denunciar. É a primeira peça do chat do evento (SPEC §4.11).

   Onde aparece: acima de tudo na página do torneio, também para quem não
   tem conta, e na Home de quem está inscrito. **Sem aviso não fica espaço
   reservado nenhum** — é a regra que mais se nota no desenho.

   A leitura já vem pronta do `get_tournament_page` (campo `notices`, da
   vista pública do Dev 3). O que falta são as três funções que escrevem:
   pedidas ao Dev 3, com estes nomes (a base de dados dos torneios é dele,
   regra de 21 set em Alinho/CLAUDE.md). Enquanto não existirem, os ecrãs
   mostram-se mas não gravam. */

export const NOTICE_MAX = 280

export function noticeError(body) {
  const clean = (body || '').trim()
  if (!clean) return 'empty'
  if (clean.length > NOTICE_MAX) return 'too_long'
  return null
}

/* Um aviso pode ter fim ("campo 3 molhado, a secar"): passado o fim,
   desaparece sozinho. O mais recente fica em cima. */
export function activeNotices(notices, now = new Date()) {
  return (notices || [])
    .filter((n) => n && n.body)
    .filter((n) => !n.expires_at || new Date(n.expires_at) > now)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
}

/* "agora", "há 6 min", "há 2 h", e daí para cima a data. Devolve a chave
   de tradução e os números — quem traduz é o ecrã. */
export function noticeAge(createdAt, now = new Date()) {
  if (!createdAt) return null
  const minutes = Math.floor((now - new Date(createdAt)) / 60000)
  if (minutes < 1) return { key: 'tnotices.age_now', values: {} }
  if (minutes < 60) return { key: 'tnotices.age_minutes', values: { count: minutes } }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return { key: 'tnotices.age_hours', values: { count: hours } }
  return { key: 'tnotices.age_days', values: { count: Math.floor(hours / 24) } }
}

// ── Chamadas (funções pedidas ao Dev 3) ─────────────────────────────────

const missing = (error) => error?.code === 'PGRST202'

export async function publishNotice({ tournamentId, body, alsoWhatsapp = false, expiresAt = null }) {
  const { data, error } = await supabase.rpc('publish_tournament_notice', {
    p_tournament_id: tournamentId,
    p_body: (body || '').trim(),
    p_also_whatsapp: alsoWhatsapp,
    p_expires_at: expiresAt,
  })
  if (error) throw new Error(missing(error) ? 'not_ready' : error.message)
  return data
}

export async function updateNotice({ noticeId, body, expiresAt = null }) {
  const { error } = await supabase.rpc('update_tournament_notice', {
    p_notice_id: noticeId,
    p_body: (body || '').trim(),
    p_expires_at: expiresAt,
  })
  if (error) throw new Error(missing(error) ? 'not_ready' : error.message)
}

export async function deleteNotice(noticeId) {
  const { error } = await supabase.rpc('delete_tournament_notice', { p_notice_id: noticeId })
  if (error) throw new Error(missing(error) ? 'not_ready' : error.message)
}
