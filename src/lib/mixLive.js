// «A decorrer» num mix (PO, 12 out — o Ruben: «isto diz que o nosso jogo já
// está a acontecer»): o mix passa a 'in_progress' quando as duplas ficam
// formadas (à mão, ou pelo robô horas antes), mas só está a decorrer depois
// de o admin carregar em «Começar ronda 1». Com as duplas formadas e a ronda
// por começar, continua como antes de começar.
//
// Os sinais: round_started_at (o «Começar ronda N» grava a hora; fica vazio
// entre rondas) ou já haver um resultado marcado (com vencedor ou empate:
// score_a preenchido — a mesma regra do list_live_events, Dev 3). Uma regra só para a Home,
// a página do mix e o Gerir. O aquecimento já conta (#768, Francisco, 8 nov).

/** `scored`: já há um jogo com resultado (passa-se de fora, ou vem em
 *  `game.scored`, a lista curta que a Home pede). */
export function isMixLive(game, { scored = null } = {}) {
  if (game?.status !== 'in_progress') return false
  const anyScored = scored ?? (Array.isArray(game.scored) && game.scored.length > 0)
  return Boolean(game.round_started_at) || game.round_phase === 'aquecimento' || Boolean(anyScored)
}

/** As duplas já estão formadas mas a ronda 1 ainda não começou. */
export const isFormedNotStarted = (game, opts) => game?.status === 'in_progress' && !isMixLive(game, opts)

// ── Aquecimento e troca entre rondas (#768) ───────────────────────────────
// SPEC design-handoff/2026-10-26-mix-aquecimento-e-troca; base do Dev 3 em
// migration_mix_aquecimento_e_troca.sql. O relógio da fase está em
// round_phase ('aquecimento' | 'troca'), phase_started_at e phase_minutes.
// Só quem organiza grava (a RLS de games); os outros fazem a mesma conta no
// telemóvel, por isso veem a ronda começar à hora certa mesmo antes de ela
// ficar gravada. Na troca, o round_started_at da ronda que acabou fica até
// a ronda seguinte ser sorteada: é ele que diz que ronda acabou.

const toMs = (v) => (v ? new Date(v).getTime() : NaN)
const iso = (t) => new Date(t).toISOString()

/** O mix tem as colunas da fase (antes da migração não vêm na linha). */
export const hasPhaseColumns = (game) => !!game && 'round_phase' in game

/** Limpar a fase, só se a base tiver as colunas. */
export const clearPhase = (game) => (hasPhaseColumns(game) ? { round_phase: null, phase_started_at: null, phase_minutes: null } : {})

/**
 * O relógio do mix num instante `now` (ms).
 *  - lastRound: a ronda a decorrer é a última (não há troca depois dela).
 * Devolve:
 *  - phase: 'aquecimento' | 'troca' | null, com phaseStartedAt e phaseEndsAt (ms);
 *  - roundStartedAt / roundDuration: os da ronda, já com o fim da fase contado
 *    (a ronda seguinte começa sozinha no fim do aquecimento ou da troca);
 *  - patch: o que quem organiza deve gravar agora (null = nada);
 *  - advanceAt: a troca acabou e a ronda que acabou ainda não deu lugar à
 *    seguinte: quem organiza sorteia-a e ela começa a esta hora (ms);
 *  - nextAt: o próximo instante em que alguma coisa muda (para a página se
 *    atualizar sozinha), ou null.
 */
export function mixClock(game, { now = Date.now(), lastRound = false } = {}) {
  const out = {
    phase: null, phaseStartedAt: null, phaseEndsAt: null,
    roundStartedAt: game?.round_started_at || null,
    roundDuration: game?.round_duration_minutes || null,
    patch: null, advanceAt: null, nextAt: null,
  }
  if (!game || game.status !== 'in_progress') return out
  const each = game.game_time_minutes || 20
  const startRoundAt = (t) => {
    out.roundStartedAt = iso(t)
    out.roundDuration = each
    out.patch = { ...clearPhase(game), round_started_at: iso(t), round_duration_minutes: each }
  }

  const phase = game.round_phase
  if (phase === 'aquecimento' || phase === 'troca') {
    const start = toMs(game.phase_started_at)
    const minutes = Number(game.phase_minutes) || Number(phase === 'aquecimento' ? game.warmup_minutes : game.changeover_minutes) || 0
    const end = start + minutes * 60000
    if (!Number.isFinite(end)) return out
    if (now < end) return { ...out, phase, phaseStartedAt: start, phaseEndsAt: end, nextAt: end }
    // A fase acabou. No aquecimento, ou na troca com a ronda seguinte já
    // sorteada (round_started_at vazio), essa ronda começa no fim da fase.
    if (phase === 'aquecimento' || !game.round_started_at) {
      startRoundAt(end)
      return out
    }
    // Na troca com a ronda que acabou ainda por fechar: sorteia-se e começa.
    out.advanceAt = end
    return out
  }

  // Sem fase gravada: a ronda a correr, e a troca que começa quando acaba.
  const started = toMs(game.round_started_at)
  // Grupos + Eliminatórias não tem troca (QA 7 nov).
  const changeover = game.format === 'grupos_eliminatorias' ? 0 : Number(game.changeover_minutes) || 0
  if (!Number.isFinite(started)) return out
  const roundEnd = started + (Number(game.round_duration_minutes) || each) * 60000
  if (now < roundEnd) {
    if (changeover && !lastRound) out.nextAt = roundEnd
    return out
  }
  if (!changeover || lastRound) return out
  const end = roundEnd + changeover * 60000
  if (now < end) {
    out.phase = 'troca'
    out.phaseStartedAt = roundEnd
    out.phaseEndsAt = end
    out.nextAt = end
    if (hasPhaseColumns(game)) out.patch = { round_phase: 'troca', phase_started_at: iso(roundEnd), phase_minutes: changeover }
    return out
  }
  out.advanceAt = end
  return out
}
