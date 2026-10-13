// As datas do topo dos eventos (R3). Aceitam uma data só («2026-10-16») ou um
// instante com fuso («2026-10-16T00:00:00+00:00», como o draw_on, que é
// timestamptz). Uma data que não se lê dá null, e nunca rebenta a página:
// o draw_on com «T12:00:00» colado deitava abaixo todos os torneios com
// sorteio marcado (QA, 13 out).

const dayOnly = (value) => {
  const iso = String(value || '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null
}
const noon = (iso) => new Date(`${iso}T12:00:00`)
const valid = (d) => d instanceof Date && !Number.isNaN(d.getTime())

/** «sábado, 17 de outubro». */
export function longDate(value, locale) {
  const iso = dayOnly(value)
  return iso ? noon(iso).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' }) : null
}

/** «15 out», no fuso de Lisboa. Com um instante, conta o dia em Lisboa. */
export function shortDay(value, locale) {
  if (!value) return null
  const d = String(value).length > 10 ? new Date(value) : (dayOnly(value) ? noon(dayOnly(value)) : null)
  if (!valid(d)) return null
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'Europe/Lisbon' }).format(d).replace('.', '').replace(' de ', ' ')
}

/** Ao lado da hora grande: «sáb e dom», ou «sex a dom»; num dia só, nada. */
export function daysAside(start, end, locale, t) {
  const a = dayOnly(start)
  const b = dayOnly(end)
  if (!a || !b || a === b) return null
  const wd = (iso) => noon(iso).toLocaleDateString(locale, { weekday: 'short' }).replace('.', '')
  const days = Math.round((noon(b) - noon(a)) / 86400000) + 1
  return t(days === 2 ? 'tournament.hero_days_two' : 'tournament.hero_days_range', { a: wd(a), b: wd(b) })
}
