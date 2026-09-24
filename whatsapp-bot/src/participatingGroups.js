// Em que grupos de WhatsApp esta conta está — pedido ao WhatsApp com cuidado.
//
// No arranque o bot pedia a lista duas vezes ao mesmo tempo (uma para a
// escrever no log, outra para saber que grupos serve) e às vezes ainda com a
// ligação fechada: dava «Connection Closed» e «rate-overlimit» (429) do
// WhatsApp. Aqui:
//   · com a ligação fechada não se pede nada (devolve o que houver);
//   · pedidos ao mesmo tempo juntam-se num só;
//   · depois de uma recusa, espera `retryMs` antes de voltar a pedir, e
//     entretanto usa a lista antiga (ou null = «não sei», e o groups.js não
//     filtra — fail-open, para uma reconexão nunca silenciar o bot).
export function createParticipatingGroups({ ttlMs = 5 * 60 * 1000, retryMs = 60_000, now = () => Date.now() } = {}) {
  let jids = null
  let at = 0
  let open = false
  let inflight = null
  let blockedUntil = 0

  /** Pede a lista já (partilhando um pedido em curso). Devolve o objeto do
   *  Baileys { jid: { id, subject, … } } — o arranque usa-o para o log —
   *  ou null com a ligação fechada. Lança o erro do WhatsApp. */
  function refresh(fetchGroups) {
    if (!open) return Promise.resolve(null)
    if (inflight) return inflight
    inflight = (async () => {
      try {
        const groups = await fetchGroups()
        jids = new Set(Object.keys(groups))
        at = now()
        return groups
      } catch (err) {
        blockedUntil = now() + retryMs
        throw err
      } finally {
        inflight = null
      }
    })()
    return inflight
  }

  return {
    setOpen(value) {
      open = value
    },
    refresh,
    /** O Set de JIDs (da cache se ainda estiver no prazo), ou null se ainda não se sabe. */
    async get(fetchGroups) {
      if (jids && now() - at < ttlMs) return jids
      if (!open || now() < blockedUntil) return jids
      try {
        await refresh(fetchGroups)
      } catch (err) {
        console.error(`Failed to list participating groups: ${err?.message || err}`)
      }
      return jids
    },
  }
}
