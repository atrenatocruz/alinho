// Torneios — peças puras usadas pelos ecrãs de criar e gerir (Trello #361).
// Sem React e sem Supabase, para poderem ser testadas.
//
// A lógica do FORMATO (quantos grupos, quem passa, quantos jogos, se cabe)
// é do Dev 3, em src/lib/tournamentFormat.js — não a repitas aqui. Quando
// esse ficheiro chegar ao `dev`, `availableCourtHours` passa a vir de lá e
// `courtHours` daqui desaparece (é a mesma conta, só que ainda não existe
// no ramo).
import { ratingBand } from './elo'

/** Os estados por onde um torneio passa, pela ordem do desenho (SPEC §3). */
export const TOURNAMENT_STATUS = ['rascunho', 'inscricoes', 'fechado', 'sorteado', 'a_decorrer', 'terminado']

/** O passo seguinte e o anterior, para os botões do Gerir. Do 'sorteado' em
 *  diante não se volta atrás pelo botão: desfazer um sorteio é outra coisa
 *  (refazer o sorteio, e só até ao primeiro resultado). */
export const nextStatus = (status) => {
  const i = TOURNAMENT_STATUS.indexOf(status)
  return i >= 0 && i < 2 ? TOURNAMENT_STATUS[i + 1] : null
}
export const previousStatus = (status) => (status === 'inscricoes' ? 'rascunho' : status === 'fechado' ? 'inscricoes' : null)

/** Horas de campo de um dia: (fim − início) × campos. Aceita "09:00". */
export function courtHours(day) {
  if (!day?.starts_at || !day?.ends_at) return 0
  const [h1, m1] = day.starts_at.split(':').map(Number)
  const [h2, m2] = day.ends_at.split(':').map(Number)
  const hours = (h2 * 60 + m2 - (h1 * 60 + m1)) / 60
  return hours > 0 ? hours * (Number(day.courts) || 0) : 0
}

/** O tempo de campo do torneio todo — o número grande do passo 2. */
export const totalCourtHours = (days = []) => days.reduce((sum, d) => sum + courtHours(d), 0)

/** Quantas duplas cabem, somando as vagas de todas as categorias. */
export const totalSlots = (categories = []) => categories.reduce((sum, c) => sum + (Number(c.slots) || 0), 0)

/** "M5", "F3", "MX4" — o código da categoria a partir do género e do nível,
 *  com as mesmas letras das etiquetas de nível da app (ver ratingBand). */
export function categoryCode(gender, level) {
  const prefix = gender === 'feminino' ? 'F' : gender === 'misto' ? 'MX' : 'M'
  return level ? `${prefix}${level}` : prefix
}

/** O nome por extenso, para quem não sabe o que é "MX4". */
export function categoryName(t, gender, level) {
  const key = gender === 'feminino' ? 'female' : gender === 'misto' ? 'mixed' : 'male'
  return t(`tournament.create.category_name_${key}`, { level: level || '' }).trim()
}

/** A banda de nível (1 a 6, 7 = Iniciante) que corresponde a uns pontos —
 *  usada para propor o nível da categoria a partir do ranking do clube. */
export const levelFromRating = (rating) => {
  const band = ratingBand(rating, null)
  return band?.label === 'INI' ? 7 : Number(band?.label?.slice(1)) || null
}

/** O que falta preencher em cada passo, para o botão "Seguinte" saber se
 *  pode avançar. Devolve a chave do texto a mostrar, ou null se estiver bem. */
export function stepProblem(step, draft) {
  // A ordem dos passos mudou a 23 set («#342»): 1 Pessoas · 2 Quando ·
  // 3 Onde joga · 4 Regras. As categorias passaram do 3.º para o 1.º, e o
  // dia/hora de cada uma para o 3.º, ao lado das horas de cada dia.
  if (step === 1) {
    // O nome vive no topo, fora dos passos, mas continua a ser obrigatório —
    // e o primeiro passo é o sítio mais cedo onde se pode travar.
    if (!draft.name?.trim()) return 'name'
    if (!draft.categories?.length) return 'categories'
    if (draft.categories.some((c) => !c.slots || Number(c.slots) < 2)) return 'slots'
    return null
  }
  if (step === 2) {
    if (!draft.days?.length) return 'days'
    if (!draft.entries_close_at) return 'deadline'
    // O prazo das inscrições e o sorteio têm de ser antes do primeiro dia.
    const first = [...draft.days].map((d) => d.date).sort()[0]
    if (first && draft.entries_close_at.slice(0, 10) > first) return 'deadline_after_start'
    if (draft.draw_at && first && draft.draw_at.slice(0, 10) > first) return 'draw_after_start'
    return null
  }
  if (step === 3) {
    if (!draft.days?.every((d) => d.starts_at && d.ends_at && Number(d.courts) > 0)) return 'hours'
    if (draft.days.some((d) => courtHours(d) <= 0)) return 'hours_order'
    // Uma categoria sem dia não joga em lado nenhum, e o horário não a
    // apanha: é aqui que se vê, porque é aqui que os dias existem.
    if (draft.categories?.some((c) => !c.day)) return 'category_without_day'
    return null
  }
  return null
}

/** Um torneio só se apaga enquanto ninguém se inscreveu; com inscrições,
 *  arquiva-se (regra do cartão #361). */
export const canDelete = (tournament) => (tournament?.entry_count || 0) === 0 && tournament?.status === 'rascunho'

/** Metade do preço da dupla, escrito como se escreve no idioma de quem lê
 *  («12,50 €» em português, «12.50» em inglês). Só leva casas decimais
 *  quando precisa — «25 €», não «25,00 €».
 *
 *  A unidade do torneio é a DUPLA e não muda (vagas em duplas, inscritos em
 *  duplas). Isto existe porque os cartazes anunciam por jogador: sem a conta
 *  feita, quem lê «25 €» no cartaz escreve 25 no campo «por dupla» e fica a
 *  cobrar metade. */
export function pricePerPlayer(euros, locale = 'pt-PT') {
  const value = Number(euros) / 2
  if (!Number.isFinite(value)) return ''
  return value.toLocaleString(locale, {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  })
}

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

/** O relógio do torneio. Os torneios da Alinho jogam-se em Portugal, e a
 *  hora de um torneio é a hora DO SÍTIO do torneio — não a do telemóvel de
 *  quem o está a montar. Com a hora do aparelho, um organizador com o
 *  telemóvel noutro fuso (ou mal acertado) escrevia «23:59» e gravava 23:59
 *  do fuso dele. É a mesma regra do /marcar do Dev 2 (`tournamentDay.js`):
 *  dia e hora vêm sempre do mesmo relógio, dos dois lados. */
export const TOURNAMENT_TZ = 'Europe/Lisbon'

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
