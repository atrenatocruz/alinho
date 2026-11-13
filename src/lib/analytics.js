// Contagem de visitas (Vercel Web Analytics, #814). Sem cookies; só conta que
// páginas se abrem. Antes de cada envio, o endereço passa por aqui e sai sem
// nada que diga quem é a pessoa:
//   • sem query string nem hash (?ref= de quem partilhou, #access_token da
//     reposição de password, ?slot=, ?redirect=…);
//   • códigos e ids no caminho trocados por [id]: convites (/convite/…,
//     /m/…), perfis (/jogador/…, /professor/…) e qualquer uuid ou número;
//   • o /admin não se conta.
// Os nomes de clubes, torneios e ligas (slugs) ficam: são públicos e é isso
// que se quer medir.

// Primeiro nível cujo segundo segmento é sempre um código ou um id.
const ID_AFTER = new Set([
  'convite', 'convite-amigos', 'convite-torneio', 'm',
  'jogador', 'professor', 'aula', 'jogo',
])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NUMBER = /^\d+$/

/** O endereço que se pode medir, ou null para não contar a visita. */
export function cleanAnalyticsUrl(href) {
  let url
  try {
    url = new URL(href)
  } catch {
    return null
  }
  const parts = url.pathname.split('/')
  if (parts[1] === 'admin') return null
  const path = parts
    .map((seg, i) => {
      if (!seg) return seg
      if (i === 2 && ID_AFTER.has(parts[1])) return '[id]'
      return UUID.test(seg) || NUMBER.test(seg) ? '[id]' : seg
    })
    .join('/')
  return `${url.origin}${path}`
}

/** beforeSend do <Analytics />. */
export function analyticsBeforeSend(event) {
  const url = cleanAnalyticsUrl(event?.url)
  return url ? { ...event, url } : null
}
