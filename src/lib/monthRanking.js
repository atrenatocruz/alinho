/* Ranking do mês (design-handoff/2026-10-12-ranking-do-mes-podio, aprovado
   pelo Francisco a 12 out; regras em REGRAS-BA.md). Os números vêm todos da
   get_month_ranking do Dev 3 (#626): aqui só se arruma o que ela devolve para
   o ecrã — o pódio, a lista do 4.º em diante e a linha «Tu». */

export const MONTH_MIN_GAMES = 4

// A escala da página Rankings → o filtro da função.
export const monthGender = (scale) => (scale === 'masculino' || scale === 'feminino' ? scale : 'todos')

/** «Sofia Marques» → «Sofia M.» (o nome curto do pódio). */
export function shortName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length < 2) return parts[0] || '—'
  // A inicial é a primeira letra do último nome: «Admin (Dev)» → «Admin D.».
  const initial = parts[parts.length - 1].match(/\p{L}/u)?.[0]
  return initial ? `${parts[0]} ${initial.toUpperCase()}.` : parts[0]
}

/** «+86», «−12» (sinal de menos a sério) e «0». */
export function monthPoints(points) {
  const n = Math.round(Number(points) || 0)
  if (n > 0) return `+${n}`
  if (n < 0) return `−${Math.abs(n)}`
  return '0'
}

/** Positivos a preto (ou lima-escuro no pódio); zero e negativos a cinzento, nunca a vermelho. */
export const monthPointsMuted = (points) => !(Math.round(Number(points) || 0) > 0)

/**
 * Arruma o que a função devolve.
 * - podium: sempre 3 lugares, por ordem 1.º, 2.º, 3.º (null = «Lugar livre»).
 *   Com empates, os lugares do pódio são as 3 primeiras linhas; cada uma leva
 *   o seu `place` (dois 2.º aparecem os dois com 2).
 * - rest: do 4.º lugar da lista em diante.
 * - me: a linha da própria pessoa (entrou ou ainda fora), ou null se não jogou.
 * - qualifiedCount: quantos já têm 4 jogos.
 */
export function splitMonthRanking(rows) {
  const list = (rows || []).filter((r) => r.qualified)
    .sort((a, b) => (a.place ?? 9999) - (b.place ?? 9999))
  const podium = [0, 1, 2].map((i) => list[i] || null)
  return {
    podium,
    rest: list.slice(3),
    me: (rows || []).find((r) => r.is_me) || null,
    qualifiedCount: list.length,
  }
}

/** O mês como «2026-10-01» (o que a função recebe) a partir de uma data. */
export const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`

const monthDate = (key) => new Date(`${String(key).slice(0, 7)}-01T12:00:00`)

/** «Outubro 2026». */
export function monthTitle(key, lang = 'pt') {
  const txt = monthDate(key).toLocaleDateString(lang === 'en' ? 'en-GB' : 'pt-PT', { month: 'long', year: 'numeric' })
  const clean = txt.replace(' de ', ' ')
  return clean.charAt(0).toUpperCase() + clean.slice(1)
}

/** «outubro» / «October» — o nome do mês, sozinho. */
export function monthName(key, lang = 'pt') {
  return monthDate(key).toLocaleDateString(lang === 'en' ? 'en-GB' : 'pt-PT', { month: 'long' })
}

/** O mês a seguir (para «recomeça a 1 de novembro»). */
export function nextMonthKey(key) {
  const d = monthDate(key)
  return monthKey(new Date(d.getFullYear(), d.getMonth() + 1, 1, 12))
}
