// Procurar um evento na Home: no nome, no clube/grupo ou no sítio, sem acentos
// nem maiúsculas. À parte do HomeSearch.jsx para se testar sem a app inteira.
import { semAcentos } from '../../lib/semAcentos'

export const eventTitle = (e) => e.raw?.title || e.raw?.name || e.raw?.tournament_name || ''
export const eventPlace = (e) => e.raw?.location || e.courtName || ''

/** O evento tem a pesquisa no nome, no clube/grupo ou no sítio? */
export const eventMatches = (e, query) => {
  const q = semAcentos(query).trim()
  if (!q) return true
  return [eventTitle(e), e.orgName, eventPlace(e)].some((s) => semAcentos(s).includes(q))
}
