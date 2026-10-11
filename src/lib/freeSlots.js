// Horários livres por clube na Home (Home do futuro, SPEC-4 — aprovado pelo
// Francisco a 9 out). Um jogo em aberto só aparece como cartão quando já tem
// alguém; os horários sem ninguém de um dia juntam-se numa linha só, à hora
// do primeiro, com as horas em pastilhas. Com vários clubes no mesmo dia, um
// cartão só, com uma pastilha por clube. «A Home não se enche de horários
// vazios.»
import { countPeople } from './mixLogic'

/** Um horário livre: jogo em aberto, ainda sem ninguém, que não é meu nem acabou. */
export function isFreeSlot(e) {
  if (e.kind !== 'open' || e.mine || e.finished) return false
  if (e.source === 'game') return e.raw?.origin === 'open_slot' && countPeople(e.raw?.participants || []) === 0
  if (e.source === 'explore') return e.raw?.origin === 'open_slot' && (e.explore?.peopleCount || 0) === 0
  return false
}

/** Os eventos de um dia com os horários livres juntos num evento só
 *  (source 'free'), por clube e pela hora do primeiro. `dayEvents` já vem
 *  pela ordem da hora. */
export function groupFreeSlots(dayEvents, dayKey) {
  const free = dayEvents.filter(isFreeSlot)
  if (free.length === 0) return dayEvents
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
    c.taken = dayEvents.filter((e) => e.kind === 'open' && !isFreeSlot(e) && (e.orgId || e.orgName) === (c.orgId || c.orgName) && e.raw?.origin === 'open_slot')
    c.price = c.slots.find((s) => s.raw?.price_per_player != null)?.raw?.price_per_player ?? null
    c.location = c.slots[0]?.raw?.location || ''
  }
  const first = free[0]
  const merged = {
    key: `free:${dayKey}`,
    source: 'free',
    kind: 'open',
    id: `free-${dayKey}`,
    startsAt: first.startsAt,
    hasTime: true,
    dayKey,
    mine: false,
    finished: false,
    clubs,
    count: free.length,
  }
  const rest = dayEvents.filter((e) => !isFreeSlot(e))
  const at = rest.findIndex((e) => e.hasTime && e.startsAt > first.startsAt)
  return at === -1 ? [...rest, merged] : [...rest.slice(0, at), merged, ...rest.slice(at)]
}
