// O calendário de uma categoria da liga (Liga entre Clubes, Fase 1 — spec
// 2026-10-16). Método do círculo: uma equipa fica parada e as outras rodam.
// Calcula-se aqui e o servidor (save_league_schedule) só VALIDA o que recebe:
// cada par joga uma vez (duas em casa e fora) e ninguém joga duas vezes na
// mesma jornada. Verificado de 2 a 14 equipas: a diferença casa/fora nunca
// passa de 1.

/** Jornadas: [[{ home, away }, …], …]. Com número ímpar, uma folga por jornada. */
export function roundRobin(teamIds, { homeAway = false } = {}) {
  const ids = [...teamIds]
  if (ids.length < 2) return []
  if (ids.length % 2 === 1) ids.push(null) // a folga
  const n = ids.length
  let arr = ids.slice()
  const rounds = []
  for (let r = 0; r < n - 1; r++) {
    const pairs = []
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i]
      const b = arr[n - 1 - i]
      if (a === null || b === null) continue
      // A equipa parada alterna casa e fora; as outras ficam equilibradas
      // pela própria rotação.
      const swap = i === 0 && r % 2 === 1
      pairs.push(swap ? { home: b, away: a } : { home: a, away: b })
    }
    rounds.push(pairs)
    arr = [arr[0], arr[n - 1], ...arr.slice(1, n - 1)]
  }
  if (!homeAway) return rounds
  return [...rounds, ...rounds.map((pairs) => pairs.map(({ home, away }) => ({ home: away, away: home })))]
}

const addDays = (dayKey, days) => {
  const d = new Date(`${dayKey}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** As janelas: a jornada N começa N-1 períodos depois da primeira. */
export function roundWindows(count, firstStart, days) {
  return Array.from({ length: count }, (_, i) => ({
    number: i + 1,
    start: addDays(firstStart, i * days),
    end: addDays(firstStart, (i + 1) * days - 1),
  }))
}
