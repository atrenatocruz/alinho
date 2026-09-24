// Quanto demora cada passo de um comando ou repost — uma linha JSON por
// medição, para se ler no `docker logs` e comparar antes/depois
// (plano 2026-09-24-bot-velocidade-e-vagas).
export function startTimer(label) {
  const t0 = performance.now()
  let last = t0
  const steps = {}
  return {
    mark(step) {
      const now = performance.now()
      steps[step] = Math.round(now - last)
      last = now
    },
    end(extra = {}) {
      const total = Math.round(performance.now() - t0)
      console.log(JSON.stringify({ timing: label, total_ms: total, steps, ...extra }))
      return total
    },
  }
}
