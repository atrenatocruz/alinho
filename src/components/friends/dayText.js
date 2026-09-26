/** «Sáb 3 out» — dia curto, sem pontos, como no desenho do jogo entre
 *  amigos (#342). `iso` = 'YYYY-MM-DD'. */
export function dayText(iso, locale) {
  if (!iso) return ''
  const d = new Date(`${iso}T12:00`)
  const part = (o) => d.toLocaleDateString(locale, o).replace(/\./g, '')
  const wd = part({ weekday: 'short' })
  return `${wd.charAt(0).toUpperCase()}${wd.slice(1)} ${part({ day: 'numeric' })} ${part({ month: 'short' })}`
}
