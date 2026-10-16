// Horários livres por clube na Home (Home do futuro, SPEC-4 — aprovado pelo
// Francisco a 9 out). Um jogo em aberto só aparece como cartão quando já tem
// alguém; os horários sem ninguém de um dia juntam-se numa linha só, à hora
// do primeiro, com as horas em pastilhas. Com vários clubes no mesmo dia, um
// cartão só, com uma pastilha por clube. «A Home não se enche de horários
// vazios.»
import { countPeople } from './mixLogic'

/** Jogo em aberto ainda sem ninguém, que não é meu nem acabou. */
function isEmptyOpenSlot(e) {
  if ((e.kind !== 'open' && e.kind !== 'free') || e.mine || e.finished) return false
  if (e.source === 'game') return e.raw?.origin === 'open_slot' && countPeople(e.raw?.participants || []) === 0
  if (e.source === 'explore') return e.raw?.origin === 'open_slot' && (e.explore?.peopleCount || 0) === 0
  return false
}

/** Um horário livre: vazio e ainda por acontecer. Um vazio cuja hora já
 *  passou não serve a ninguém e sai da Home (relatório do QA, 9 out). */
export function isFreeSlot(e, now = Date.now()) {
  return isEmptyOpenSlot(e) && !(e.startsAt instanceof Date && e.startsAt.getTime() <= now)
}

/** Os horários vazios passam a ser do tipo 'free' (a pastilha «Horários
 *  livres» da barra, Dev 4): com «Tudo» aparecem; só com «Jogos em aberto»
 *  ficam só os jogos com gente (o applyFilters tira os 'free'). Antes dos
 *  filtros. */
export const markFreeSlots = (events) =>
  events.map((e) => (e.kind === 'open' && isEmptyOpenSlot(e) ? { ...e, kind: 'free' } : e))

/** Os eventos de um dia com os horários livres juntos num evento só
 *  (source 'free'), por clube e pela hora do primeiro. `dayEvents` já vem
 *  pela ordem da hora. */
export function groupFreeSlots(allDayEvents, dayKey, now = Date.now(), { perClub = false } = {}) {
  // Os vazios cuja hora já passou saem do dia.
  const dayEvents = allDayEvents.filter((e) => !(isEmptyOpenSlot(e) && !isFreeSlot(e, now)))
  const free = dayEvents.filter((e) => isFreeSlot(e, now))
  if (free.length === 0) return dayEvents.length === allDayEvents.length ? allDayEvents : dayEvents
  const byOrg = new Map()
  for (const e of free) {
    const k = e.orgId || e.orgName || '?'
    if (!byOrg.has(k)) {
      byOrg.set(k, {
        orgId: e.orgId || null, orgName: e.orgName || '', orgSlug: e.orgSlug || null, orgLogo: e.orgLogo || null,
        outside: e.source === 'explore', slots: [],
      })
    }
    byOrg.get(k).slots.push(e)
  }
  const clubs = [...byOrg.values()]
  // Na folha de abrir, as horas do clube nesse dia: as livres e as já
  // ocupadas (riscadas).
  for (const c of clubs) {
    c.taken = dayEvents.filter((e) => (e.kind === 'open' || e.kind === 'free') && !isFreeSlot(e, now) && (e.orgId || e.orgName) === (c.orgId || c.orgName) && e.raw?.origin === 'open_slot')
    c.price = c.slots.find((s) => s.raw?.price_per_player != null)?.raw?.price_per_player ?? null
    c.location = c.slots[0]?.raw?.location || ''
  }
  const card = (cs, list, key) => ({
    key,
    source: 'free',
    kind: 'free',
    id: key.replace(':', '-'),
    startsAt: list[0].startsAt,
    hasTime: true,
    dayKey,
    mine: false,
    finished: false,
    clubs: cs,
    count: list.length,
  })
  // Só «Horários livres» escolhido: um cartão por clube, cada um à hora do
  // seu primeiro horário (SPEC-4, com a pastilha do Dev 4). Senão, um só.
  const merged = perClub
    ? clubs.map((c) => card([c], c.slots, `free:${dayKey}:${c.orgId || c.orgName}`))
    : [card(clubs, free, `free:${dayKey}`)]
  const rest = dayEvents.filter((e) => !isFreeSlot(e, now))
  const out = [...rest]
  for (const m of merged) {
    const at = out.findIndex((e) => e.hasTime && e.startsAt > m.startsAt)
    if (at === -1) out.push(m)
    else out.splice(at, 0, m)
  }
  return out
}
