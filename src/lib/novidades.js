// As entradas da página «Novidades» (alinho.pt/novidades — design-handoff/
// 2026-10-10-site-como-funciona, aprovado pelo Francisco a 10 out).
//
// Um sítio só: para uma versão nova, junta-se uma entrada NO TOPO desta lista,
// sem mexer no desenho. A mais recente leva «Nova». O texto vem do Marketing
// (3 a 5 linhas, linguagem de jogador, sem nomes nem números de pessoas) e o
// Francisco aprova antes de entrar.
//
// date: 'AAAA-MM-DD' · key: «v» + a data sem traços · items: quantas linhas.
// O texto está no pt.json/en.json (e no es.json) como nov.<key>.title e
// nov.<key>.item_1, _2…: assim o teste das línguas apanha o que faltar
// numa língua (espanhol, passo 1, 21 out).

export const NOVIDADES = [
  { date: '2026-10-16', key: 'v20261016', items: 9 },
  { date: '2026-10-09', key: 'v20261009', items: 5 },
]

const LOCALE = { pt: 'pt-PT', en: 'en-GB', es: 'es-ES' }

/** «9 DE OUTUBRO DE 2026» (pt) · «9 OCTOBER 2026» (en) · «9 DE OCTUBRE DE 2026» (es). */
export function novidadeDate(date, lang) {
  const d = new Date(`${date}T12:00:00`)
  return d.toLocaleDateString(LOCALE[lang] || 'pt-PT', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase()
}
