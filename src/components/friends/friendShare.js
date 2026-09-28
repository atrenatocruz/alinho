import { whatsappShare } from '../../lib/partnerInvite'

// «↗ Partilhar com quem falta» (amigos sem bloquear, 27 set): abre a folha de
// partilha do telemóvel — escolhe-se um grupo ou uma pessoa (Francisco). Sem
// ela (computador), abre o WhatsApp com o texto.
export async function shareWithMissing(text) {
  if (typeof navigator !== 'undefined' && navigator.share) {
    try { await navigator.share({ text }); return } catch (err) {
      if (err?.name === 'AbortError') return
    }
  }
  window.open(whatsappShare(text), '_blank', 'noopener')
}

export const sessionLink = (matchId) => `${window.location.origin}/jogos-privados/sessao/${matchId}`

/** «Rita Figueira» → «Rita F.» */
export const shortName = (name) => {
  // O que está entre parênteses não é apelido («Renato Cruz (dev)» → «Renato C.»).
  const parts = String(name || '').replace(/\([^)]*\)/g, ' ').trim().split(/\s+/)
  const initial = parts.length > 1 ? parts[parts.length - 1].match(/\p{L}/u)?.[0] : null
  return initial ? `${parts[0]} ${initial}.` : parts[0] || ''
}
