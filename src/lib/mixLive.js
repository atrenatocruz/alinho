// «A decorrer» num mix (PO, 12 out — o Ruben: «isto diz que o nosso jogo já
// está a acontecer»): o mix passa a 'in_progress' quando as duplas ficam
// formadas (à mão, ou pelo robô horas antes), mas só está a decorrer depois
// de o admin carregar em «Começar ronda 1». Com as duplas formadas e a ronda
// por começar, continua como antes de começar.
//
// Os sinais: round_started_at (o «Começar ronda N» grava a hora; fica vazio
// entre rondas) ou já haver um resultado marcado (com vencedor ou empate:
// score_a preenchido — a mesma regra do list_live_events, Dev 3). Uma regra só para a Home,
// a página do mix e o Gerir.

/** `scored`: já há um jogo com resultado (passa-se de fora, ou vem em
 *  `game.scored`, a lista curta que a Home pede). */
export function isMixLive(game, { scored = null } = {}) {
  if (game?.status !== 'in_progress') return false
  const anyScored = scored ?? (Array.isArray(game.scored) && game.scored.length > 0)
  return Boolean(game.round_started_at) || Boolean(anyScored)
}

/** As duplas já estão formadas mas a ronda 1 ainda não começou. */
export const isFormedNotStarted = (game, opts) => game?.status === 'in_progress' && !isMixLive(game, opts)
