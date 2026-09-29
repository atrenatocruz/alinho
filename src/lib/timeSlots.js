// As horas do seletor de hora da app (TimeField, 29 set): em vez do relógio
// nativo do browser (mau no computador), uma grelha de 30 em 30 minutos.

/** «18:15» → 1095. Vazio ou inválido → null. */
export function toMin(hhmm) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ''))
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

const fmt = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

/** As horas de `from` a `to`, de `step` em `step` minutos. `include` junta
 *  uma hora fora da grelha (uma guardada antes, «18:15»), no sítio certo. */
export function timeOptions({ from = '07:00', to = '23:30', step = 30, include = null } = {}) {
  const out = []
  for (let m = toMin(from); m <= toMin(to); m += step) out.push(fmt(m))
  const extra = toMin(include)
  if (extra != null && !out.includes(fmt(extra))) {
    out.push(fmt(extra))
    out.sort((a, b) => toMin(a) - toMin(b))
  }
  return out
}
