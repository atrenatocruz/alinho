// Às horas que cada clube escolhe (organizations.whatsapp_post_hours, até 3
// horas certas das 8h às 22h), o robô publica nos grupos do clube o cartão
// completo de cada mix aberto com vagas (#553). Aqui fica só a regra de
// «quem publica agora» — sem base de dados, para se poder testar.
//
// A verificação corre de 5 em 5 min e só publica nos primeiros 15 min da
// hora: se o robô reiniciar a meio da hora, não volta a publicar (o registo
// do que já saiu vive só em memória).
export const POST_WINDOW_MINUTES = 15

// Desde 27 set (design-handoff/2026-09-27-whatsapp-no-evento) cada mix tem as
// suas horas (games.whatsapp_post_times, 'HH:MM', de meia em meia hora, até
// 3). Sem horas escolhidas (null), valem as do clube, como antes; [] = sem
// lembretes (só o anúncio ao publicar).

const pad = (n) => String(n).padStart(2, '0')

/** A meia hora em que se está a publicar ('10:00', '18:30'), ou null fora da janela. */
export function slotFor(hour, minute) {
  if (minute < POST_WINDOW_MINUTES) return `${pad(hour)}:00`
  if (minute >= 30 && minute < 30 + POST_WINDOW_MINUTES) return `${pad(hour)}:30`
  return null
}

/** As horas de um mix: as dele ('HH:MM:SS' da base de dados → 'HH:MM') ou as do clube. */
export function mixPostTimes(mix, orgHours) {
  if (Array.isArray(mix.whatsapp_post_times)) return mix.whatsapp_post_times.map((h) => String(h).slice(0, 5))
  return (orgHours || []).map((h) => `${pad(h)}:00`)
}

export const postKey = (mixId, dayKey, slot) => `${mixId}|${dayKey}|${slot}`

/** Os mixes que têm de sair agora e ainda não saíram nesta meia hora hoje. */
export function dueMixes({ mixes, orgHours, slot, dayKey, sent }) {
  if (!slot) return []
  return mixes.filter((mix) => mixPostTimes(mix, orgHours).includes(slot) && !sent.has(postKey(mix.id, dayKey, slot)))
}
