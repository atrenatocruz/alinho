// Às horas que cada clube escolhe (organizations.whatsapp_post_hours, até 3
// horas certas das 8h às 22h), o robô publica nos grupos do clube o cartão
// completo de cada mix aberto com vagas (#553). Aqui fica só a regra de
// «quem publica agora» — sem base de dados, para se poder testar.
//
// A verificação corre de 5 em 5 min e só publica nos primeiros 15 min da
// hora: se o robô reiniciar a meio da hora, não volta a publicar (o registo
// do que já saiu vive só em memória).
export const POST_WINDOW_MINUTES = 15

export const postKey = (orgId, dayKey, hour) => `${orgId}|${dayKey}|${hour}`

/** Os clubes que têm de publicar agora e ainda não publicaram esta hora hoje. */
export function dueOrgs({ hoursByOrg, hour, minute, dayKey, sent }) {
  if (minute >= POST_WINDOW_MINUTES) return []
  const due = []
  for (const [orgId, hours] of hoursByOrg) {
    if ((hours || []).includes(hour) && !sent.has(postKey(orgId, dayKey, hour))) due.push(orgId)
  }
  return due
}
