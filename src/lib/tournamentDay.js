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

/* ── Gravar e mostrar uma hora escrita num formulário (Trello #487, Dev 1) ──
   Vieram de `tournaments.js` para aqui a 24 set: um relógio só para o
   torneio, o mesmo `TOURNAMENT_TZ` dos dois lados. */

/* O prazo das inscrições (Trello #487). No ecrã escreve-se «5 out, 23:59» —
   hora de quem está a montar o torneio. Ia para a base de dados como
   "2026-10-05T23:59", SEM FUSO, e a base de dados guardava-o como UTC: em
   Lisboa ficava 00:59 do dia seguinte, e as inscrições fechavam uma hora
   depois do anunciado (duas no inverno não, uma — mas errada na mesma).

   E ao abrir para editar fazia-se o contrário do certo: cortavam-se os 16
   primeiros caracteres do valor guardado, que vem em UTC, e mostrava-se
   essa hora como se fosse de Lisboa. Por isso o ecrã de editar parecia
   certo enquanto a base de dados estava errada.

   Estas duas funções são as únicas portas entre um e outro. */

/** As peças de um instante, lidas no relógio do torneio. */
function partsInTz(date, tz = TOURNAMENT_TZ) {
  const out = {}
  for (const { type, value } of new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)) out[type] = value
  return out
}

/** Quantos minutos o relógio do torneio está à frente do UTC naquele
 *  instante (60 no verão, 0 no inverno, em Lisboa). */
function offsetMinutes(date, tz = TOURNAMENT_TZ) {
  const p = partsInTz(date, tz)
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute)
  return Math.round((asUtc - Math.floor(date.getTime() / 60000) * 60000) / 60000)
}

/** "2026-10-05T23:59" — hora de Lisboa, como o ecrã a mostra — → o instante
 *  exacto em ISO (UTC), pronto para a base de dados. Vazio fica vazio. */
export function localInputToIso(value, tz = TOURNAMENT_TZ) {
  if (!value) return null
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/)
  if (!m) return null
  const [, y, mo, d, h = '00', mi = '00'] = m
  const wall = Date.UTC(+y, +mo - 1, +d, +h, +mi)
  // Primeiro palpite com o desvio desse momento; depois acerta-se com o
  // desvio do instante encontrado, que é o que resolve a mudança de hora.
  let t = wall - offsetMinutes(new Date(wall), tz) * 60000
  t = wall - offsetMinutes(new Date(t), tz) * 60000
  return new Date(t).toISOString()
}

/** O inverso: um instante vindo da base de dados → "YYYY-MM-DDTHH:MM" no
 *  relógio do torneio, para o ecrã. */
export function isoToLocalInput(iso, tz = TOURNAMENT_TZ) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = partsInTz(d, tz)
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}

/* ── Dias que acabam de madrugada (Trello #797) ──
   Um dia das 09:00 à 01:00 acaba à 01:00 do dia seguinte: o fim antes do
   início quer dizer «na madrugada seguinte». Só até às 06:00, a mesma regra
   da base de dados; depois disso (21:00 a 20:00) continua a ser um engano.
   Os jogos dessa madrugada contam para o dia do torneio em que começaram. */

/** A hora mais tarde a que um dia pode acabar na madrugada seguinte. */
export const LATEST_NEXT_DAY_END = '06:00'

const hhmmMinutes = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || '')
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/** O dia acaba depois da meia-noite? Aceita { starts_at, ends_at } (como
 *  vem da base de dados) ou { start, end }, em 'HH:MM'. */
export function endsNextDay(day) {
  const from = hhmmMinutes(day?.starts_at ?? day?.start)
  const to = hhmmMinutes(day?.ends_at ?? day?.end)
  return from != null && to != null && to < from && to <= hhmmMinutes(LATEST_NEXT_DAY_END)
}

/** 'AAAA-MM-DD' do dia seguinte, sem passar pelo fuso do aparelho. */
export function nextDateKey(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date || '')
  if (!m) return null
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + 1)).toISOString().slice(0, 10)
}

/** O dia do torneio a que pertence um jogo ('AAAA-MM-DD'): a data do jogo
 *  em hora de Portugal, ou a da véspera quando o jogo cai na madrugada de
 *  um dia que acaba depois da meia-noite (sábado das 09:00 à 01:00: o jogo
 *  das 00:30 de domingo é de sábado). `days`: [{ date, starts_at, ends_at }].
 *  É a mesma conta do servidor (tournament_slot_problem). */
export function tournamentDayOf(when, days = [], tz = TOURNAMENT_TZ) {
  if (!when) return null
  const d = when instanceof Date ? when : new Date(when)
  if (Number.isNaN(d.getTime())) return null
  const p = partsInTz(d, tz)
  const key = `${p.year}-${p.month}-${p.day}`
  const at = Number(p.hour) * 60 + Number(p.minute)
  const eve = (days || []).find((x) => nextDateKey(x?.date) === key && endsNextDay(x))
  if (eve && at < hhmmMinutes(eve.ends_at ?? eve.end)) return String(eve.date).slice(0, 10)
  return key
}
