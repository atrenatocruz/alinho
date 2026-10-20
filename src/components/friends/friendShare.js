import { whatsappShare } from '../../lib/partnerInvite'
import { shortPersonName } from '../../lib/mixLogic'
import { appOrigin } from '../../lib/native'

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

export const sessionLink = (matchId) => `${appOrigin()}/jogos-privados/sessao/${matchId}`

/** «Rita Figueira» → «Rita F.»; «Teste 1» → «Teste 1». É a peça comum
 *  (shortPersonName, mixLogic.js): o número do fim fica, senão duas contas
 *  de teste («Teste 1», «Teste 2») apareciam iguais (QA, 13 out). O que está
 *  entre parênteses não é apelido («Renato Cruz (dev)» → «Renato C.»). */
export const shortName = (name) => shortPersonName(name)
