/* Mix recorrente: o DIA em que abrem as inscrições (desenho aprovado pelo
   Francisco a 25 set, design-handoff/2026-09-25-abrir-inscricoes-dia).

   Continua a guardar-se como «dias antes» + hora (mix_offset_seconds, o que o
   cron usa) — só muda a forma de escolher: em vez de escrever «6», toca-se no
   dia, com a data à vista. As contas vivem aqui para se poderem testar. */

// Quantos dias antes faz sentido abrir: nunca mais do que o intervalo entre
// dois mixes (só há um mix por abrir de cada vez). Mensais e anuais vão até
// 4 semanas, uma de cada vez com «Mais cedo».
export const MAX_DAYS_BEFORE = { daily: 1, weekly: 7, monthly: 28, yearly: 28 }
export const maxDaysFor = (frequency) => MAX_DAYS_BEFORE[frequency] || 7

/** Quantas «semanas» de pastilhas há (0 = só os 7 dias antes). */
export const lastPageFor = (frequency) => Math.max(0, Math.ceil(maxDaysFor(frequency) / 7) - 1)

/** Em que semana está um valor guardado (para vir escolhido ao editar). */
export const pageForDays = (days) => (days >= 1 ? Math.floor((days - 1) / 7) : 0)

/** As pastilhas de uma semana: do dia mais cedo ao mais perto do mix. */
export function dayOptions(mixDate, frequency, page = 0) {
  const max = maxDaysFor(frequency)
  const out = []
  for (let days = Math.min(max, page * 7 + 7); days >= page * 7 + 1; days -= 1) {
    const date = new Date(mixDate)
    date.setDate(date.getDate() - days)
    out.push({ days, date })
  }
  return out
}

/** O momento em que abre, a partir do mix, dos dias antes e da hora. */
export function launchDate(mixDate, days, time) {
  const d = new Date(mixDate)
  d.setDate(d.getDate() - days)
  const [hh, mm] = String(time || '00:00').split(':').map(Number)
  d.setHours(hh || 0, mm || 0, 0, 0)
  return d
}

/** «qui» — o dia da semana curto, sem ponto. */
export const weekdayShort = (d, lang) =>
  new Intl.DateTimeFormat(lang, { weekday: 'short' }).format(d).replace('.', '').slice(0, 3).toLowerCase()

/** «quinta» — o dia da semana por extenso, sem «-feira». */
export const weekdayLong = (d, lang) =>
  new Intl.DateTimeFormat(lang, { weekday: 'long' }).format(d).replace(/-feira$/, '').toLowerCase()

/** Sábado e domingo: «no sábado», «ao domingo» (os outros são «na», «à»). */
export const isMasculineWeekday = (d) => d.getDay() === 0 || d.getDay() === 6
