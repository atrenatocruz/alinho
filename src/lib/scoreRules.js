// A regra única dos resultados de padel — «#588 — Formatos: resultados
// validados e escritos da mesma forma em mixes, torneios e amigos».
// Contas puras (sem React, sem Supabase), usadas pelos três ecrãs (mix: Dev
// 2; torneio e amigos: Dev 1) e espelhadas no servidor, porque o ecrã não é
// segurança.
//
// Regras (FIP Rules of Padel 2026 · FPP RG 2026, estudo BA de 27 set):
//   · Set a 6: ganha com 6 e 2 de diferença (6-0 … 6-4), 7-5, ou 7-6 com
//     tie-break a 7.
//   · Set curto a 4: 4-0 … 4-2, 5-3, ou 5-4 com tie-break a 7.
//   · Tie-break: a 7, com 2 de diferença (7-5, 8-6, 12-10…).
//   · Super tie-break: a 10, com 2 de diferença (10-8, 11-9…).
//   · Pro set a 9: 9-0 … 9-7, ou 9-8 com o desempate escolhido (tie-break a
//     7 por defeito, ou super a 10).
//   · Pontos: números inteiros ≥ 0; o empate só onde o formato o deixa.
//
// Cada set chega como { score_a, score_b, tiebreak_a, tiebreak_b,
// is_super_tiebreak } — a forma dos sets do torneio. Um super tie-break
// que decide o jogo é um «set» com is_super_tiebreak e os pontos em
// score_a/score_b.
//
// As funções devolvem null quando está certo, ou um código de problema
// (o texto que o Francisco lê é dos ecrãs, a partir destes códigos).
// Guardar os pontos dos tie-breaks e a escrita «7-6(5)» ficam para um
// cartão à parte (PO, 28 set).
//   'empty' · 'negative' · 'set_invalid' · 'tiebreak_needed' ·
//   'tiebreak_invalid' · 'super_tiebreak_invalid' · 'proset_invalid' ·
//   'proset_short' · 'proset_breaker_needed' · 'match_open' · 'too_many_sets' · 'tie'

const isInt = (n) => Number.isInteger(n)
const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v))

/** Um desempate «a `target`, com 2 de diferença»: quem ganha chega pelo
 *  menos ao alvo; acima do alvo, a diferença é exatamente 2. */
export function tiebreakProblem(a, b, target = 7) {
  a = num(a)
  b = num(b)
  if (!isInt(a) || !isInt(b)) return 'empty'
  if (a < 0 || b < 0) return 'negative'
  const w = Math.max(a, b)
  const l = Math.min(a, b)
  if (w < target || w - l < 2) return target === 10 ? 'super_tiebreak_invalid' : 'tiebreak_invalid'
  if (w > target && w - l !== 2) return target === 10 ? 'super_tiebreak_invalid' : 'tiebreak_invalid'
  return null
}

/** Um set de jogos a `games` (6, ou 4 nos sets curtos). No 7-6 (ou 5-4),
 *  se vierem os pontos do tie-break, têm de estar certos e quem o ganha é
 *  quem ganha o set; com requireTiebreak, são obrigatórios. */
export function setProblem(set, games = 6, { requireTiebreak = false } = {}) {
  const a = num(set?.score_a)
  const b = num(set?.score_b)
  if (!isInt(a) || !isInt(b)) return 'empty'
  if (a < 0 || b < 0) return 'negative'
  const w = Math.max(a, b)
  const l = Math.min(a, b)
  if (w === games && l <= games - 2) return null
  if (w === games + 1 && l === games - 1) return null
  if (w === games + 1 && l === games) {
    const ta = num(set?.tiebreak_a)
    const tb = num(set?.tiebreak_b)
    // Os pontos do tie-break ainda não se guardam em todo o lado (cartão à
    // parte, depois de 13 out): sem eles o 7-6 aceita-se; com eles, validam-se.
    if (!isInt(ta) || !isInt(tb)) return requireTiebreak ? 'tiebreak_needed' : null
    const p = tiebreakProblem(ta, tb, 7)
    if (p) return p
    // quem ganha o tie-break é quem fica com o set
    if ((ta > tb) !== (a > b)) return 'tiebreak_invalid'
    return null
  }
  return 'set_invalid'
}

/** Pro set a 9. `breaker` = 'tiebreak' (a 7, por defeito) ou
 *  'super_tiebreak' (a 10). Aos 8-8 joga-se o desempate e grava-se 9-8,
 *  com os pontos do desempate em tiebreak_a/tiebreak_b. */
export function proSetProblem(set, breaker = 'tiebreak') {
  const a = num(set?.score_a)
  const b = num(set?.score_b)
  if (!isInt(a) || !isInt(b)) return 'empty'
  if (a < 0 || b < 0) return 'negative'
  const w = Math.max(a, b)
  const l = Math.min(a, b)
  if (w === 9 && l <= 7) return null
  if (a === 8 && b === 8) return 'proset_breaker_needed'
  if (w === 9 && l === 8) {
    const ta = num(set?.tiebreak_a)
    const tb = num(set?.tiebreak_b)
    if (!isInt(ta) || !isInt(tb)) return 'proset_breaker_needed'
    const p = tiebreakProblem(ta, tb, breaker === 'super_tiebreak' ? 10 : 7)
    if (p) return p
    if ((ta > tb) !== (a > b)) return 'tiebreak_invalid'
    return null
  }
  // O que está mal, como os avisos do torneio (Renato, 28 set, fa39e61):
  // empate, ninguém chegou aos 9, ou resultado impossível.
  if (a === b) return 'tie'
  if (w < 9) return 'proset_short'
  return 'proset_invalid'
}

/** Pontos: inteiros ≥ 0. Empate só com allowDraw (jogos entre amigos). */
export function pointsProblem(a, b, { allowDraw = false } = {}) {
  a = num(a)
  b = num(b)
  if (!isInt(a) || !isInt(b)) return 'empty'
  if (a < 0 || b < 0) return 'negative'
  if (a === b && !allowDraw) return 'tie'
  return null
}

/** Sets ganhos por cada lado (um set com problema não conta). */
export function setsWon(sets = []) {
  let a = 0
  let b = 0
  for (const s of sets) {
    if (num(s.score_a) > num(s.score_b)) a++
    else if (num(s.score_b) > num(s.score_a)) b++
  }
  return { setsA: a, setsB: b }
}

// ── Jogos entre amigos (Francisco, 28 set — design-handoff/2026-09-28-
// amigos-regras-francisco/REGRAS.md, ponto 2) ─────────────────────────────
// Um set pode ficar por acabar porque acabou o tempo (4-4, 4-3, 5-2…). O
// único limite é 7-6: cada lado de 0 a 7, nunca 7-7. O torneio e o mix
// ficam com as regras oficiais de cima. Espelhado no servidor
// (migration_amigos_sets_por_acabar.sql).

/** Um set entre amigos: 0 a 7 de cada lado, nunca 7-7 ('set_invalid' →
 *  «Um set vai no máximo até 7-6.»). */
export function friendSetProblem(set) {
  const a = num(set?.score_a)
  const b = num(set?.score_b)
  if (!isInt(a) || !isInt(b)) return 'empty'
  if (a < 0 || b < 0) return 'negative'
  if (a > 7 || b > 7 || (a === 7 && b === 7)) return 'set_invalid'
  return null
}

/** O resultado de um jogo entre amigos aos sets. Ganha quem ganhou mais
 *  sets; com os sets empatados, quem fez mais jogos; tudo igual é 'draw'
 *  (por agora não conta para o ranking — #591). Um set empatado (4-4) não
 *  é ganho por ninguém. `numSets` = 3 no «Melhor de 3»: pode fechar antes
 *  dos 2 sets, mas não continua depois de alguém chegar aos 2.
 *  Devolve { problem, setsA, setsB, gamesA, gamesB, winner }. */
export function friendMatchResult(sets = [], { numSets = null } = {}) {
  const list = Array.isArray(sets) ? sets : []
  let setsA = 0
  let setsB = 0
  let gamesA = 0
  let gamesB = 0
  const out = (problem) => ({ problem, setsA, setsB, gamesA, gamesB, winner: problem ? null : winnerOf() })
  const winnerOf = () => {
    if (setsA !== setsB) return setsA > setsB ? 'a' : 'b'
    if (gamesA !== gamesB) return gamesA > gamesB ? 'a' : 'b'
    return 'draw'
  }
  if (!list.length) return out('empty')
  if (list.length > (numSets || 9)) return out('too_many_sets')
  for (const s of list) {
    const p = friendSetProblem(s)
    if (p) return out(p)
    if (numSets === 3 && Math.max(setsA, setsB) >= 2) return out('too_many_sets')
    const a = num(s.score_a)
    const b = num(s.score_b)
    gamesA += a
    gamesB += b
    if (a > b) setsA++
    else if (b > a) setsB++
  }
  return out(null)
}

/** O jogo inteiro, por forma de contar:
 *   · 'melhor_3_sets' — sets a 6; 2-0 em 2 sets, ou 3.º set normal com 1-1.
 *   · 'melhor_2_sets' — sets a 6; com 1-1, super tie-break a 10.
 *   · 'sets_curtos'   — como o melhor de 3, com sets a 4 e super tie-break
 *                       com 1-1 (FPP).
 *   · 'sets_livres'   — sets a 6, quantos se jogarem (≥ 1); sem empate.
 *   · 'pro_set_9'     — um set a 9 (opts.breaker).
 *   · 'pontos_simples'— dois números (opts.allowDraw).
 *  input: { score_a, score_b, sets }. Devolve { problem, setsA, setsB }:
 *  problem null quando o jogo está certo e acabado. */
export function matchProblem(format, input = {}, opts = {}) {
  const sets = Array.isArray(input.sets) ? input.sets : []
  if (format === 'pontos_simples') {
    return { problem: pointsProblem(input.score_a, input.score_b, opts), setsA: null, setsB: null }
  }
  if (format === 'pro_set_9') {
    const set = sets[0] || input
    return { problem: proSetProblem(set, opts.breaker), setsA: null, setsB: null }
  }
  const games = format === 'sets_curtos' ? 4 : 6
  const superDecider = format === 'melhor_2_sets' || format === 'sets_curtos'
  if (!sets.length) return { problem: 'empty', setsA: 0, setsB: 0 }
  for (let i = 0; i < sets.length; i++) {
    const s = sets[i]
    const decider = i === 2 && superDecider
    const p = decider || s.is_super_tiebreak
      ? (superDecider && i === 2 ? tiebreakProblem(s.score_a, s.score_b, 10) : 'set_invalid')
      : setProblem(s, games, opts)
    if (p) return { problem: p, ...setsWon(sets) }
  }
  const { setsA, setsB } = setsWon(sets)
  if (format === 'sets_livres') {
    return { problem: setsA === setsB ? 'tie' : null, setsA, setsB }
  }
  // melhor de 3 (com 3.º set normal ou super tie-break): acaba aos 2
  const firstTwo = setsWon(sets.slice(0, 2))
  if (sets.length > 3) return { problem: 'too_many_sets', setsA, setsB }
  if (sets.length === 3 && firstTwo.setsA !== firstTwo.setsB) return { problem: 'too_many_sets', setsA, setsB }
  if (Math.max(setsA, setsB) < 2) return { problem: 'match_open', setsA, setsB }
  return { problem: null, setsA, setsB }
}
