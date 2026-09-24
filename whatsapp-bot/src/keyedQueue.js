// Fila por chave: o bot trata as mensagens de CADA grupo uma a uma (a ordem
// importa — perguntas Sim/Não pendentes, duas pessoas no mesmo mix), mas
// grupos diferentes deixam de esperar uns pelos outros.
export function createKeyedQueue() {
  const tails = new Map()
  return (key, task) => {
    const prev = tails.get(key) ?? Promise.resolve()
    const next = prev.then(task).catch((err) => console.error(`Queue task failed (${key}):`, err))
    tails.set(key, next)
    next.then(() => { if (tails.get(key) === next) tails.delete(key) })
    return next
  }
}
