// Procurar um evento na Home: no nome, no clube/grupo ou no sítio, sem acentos
// nem maiúsculas. À parte do HomeSearch.jsx para se testar sem a app inteira.
import { semAcentos } from '../../lib/semAcentos'

export const eventTitle = (e) => e.raw?.title || e.raw?.name || e.raw?.tournament_name || ''
export const eventPlace = (e) => e.raw?.location || e.courtName || ''

// As palavras de cada tipo, para «mix» encontrar um mix chamado «Viva»
// (UX, 10 out): procura-se também pelo tipo, como aparece na app.
export const KIND_WORDS = {
  mix: ['mix', 'mixes'],
  open: ['jogo em aberto', 'jogos em aberto', 'em aberto'],
  tournament: ['torneio', 'torneios'],
  friends: ['amigos', 'jogo entre amigos', 'jogos entre amigos'],
  lesson: ['aula', 'aulas'],
}

/** O evento tem a pesquisa no nome, no clube/grupo, no sítio ou no tipo? */
export const eventMatches = (e, query) => {
  const q = semAcentos(query).trim()
  if (!q) return true
  if ([eventTitle(e), e.orgName, eventPlace(e)].some((s) => semAcentos(s).includes(q))) return true
  return (KIND_WORDS[e.kind] || []).some((w) => w.includes(q) || q.includes(w))
}
