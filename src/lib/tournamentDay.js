/* Que dia é hoje, para quem está no torneio (Trello #460).

   O servidor decide o dia de um jogo em hora de Portugal:
   `(scheduled_at AT TIME ZONE 'Europe/Lisbon')::date`. O ecrã de marcar tem
   de perguntar pelo MESMO dia, senão um jogo da meia-noite e meia aparece
   num lado e não no outro.

   Não chega usar a hora do aparelho: quem marca pode ter o telemóvel noutro
   fuso (ou mal acertado) e via o dia trocado sem perceber porquê. E o dia
   tem de virar sozinho à meia-noite — num torneio atrasado é precisamente a
   hora em que ainda se está a marcar, e o ecrã fica aberto. */

export const TOURNAMENT_TZ = 'Europe/Lisbon'

/** 'AAAA-MM-DD' no fuso do torneio, venha o aparelho de onde vier. */
export function dayKeyInTz(date = new Date(), timeZone = TOURNAMENT_TZ) {
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return null
  // en-CA dá logo 'AAAA-MM-DD'; o fuso é aplicado pelo Intl, sem contas à mão.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
}

/** Milissegundos até à próxima meia-noite no fuso do torneio. */
export function msUntilNextDay(date = new Date(), timeZone = TOURNAMENT_TZ) {
  const d = date instanceof Date ? date : new Date(date)
  const hoje = dayKeyInTz(d, timeZone)
  // Procura o primeiro minuto em que a data muda. Começa por saltar para
  // daqui a 24h e recua: evita contas com horas de verão feitas à mão.
  let lo = d.getTime()
  let hi = lo + 25 * 3600 * 1000
  while (hi - lo > 30000) {
    const mid = Math.floor((lo + hi) / 2)
    if (dayKeyInTz(new Date(mid), timeZone) === hoje) lo = mid
    else hi = mid
  }
  return Math.max(1000, hi - d.getTime())
}

/** 'HH:MM' de um instante, em hora do torneio (Trello #487).

    Nunca se corta o texto que vem da base de dados — `scheduled_at` chega
    em UTC («2026-10-09T17:00:00+00:00»), e cortar a hora mostrava 17:00 em
    vez das 18:00 de Lisboa. É a regra que o Dev 1 aplicou ao prazo das
    inscrições (`tournaments.js`); aqui usa-se a hora de Portugal e não a do
    aparelho, porque o dia desta página também é o de Portugal (é o que o
    servidor conta) — hora e dia têm de vir do mesmo relógio. */
export function hhmmInTz(iso, timeZone = TOURNAMENT_TZ) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('pt-PT', {
    timeZone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d)
}
