// O que vai nos cartões de partilha do torneio (design-handoff/2026-09-25-
// cartoes-partilha/SPEC-torneio.md; textos do MARKETING.md). Só números
// reais do próprio jogo; os outros com o apelido abreviado.

/** «Rita Figueira» → «Rita F.»; um nome só fica como está. */
export function shortName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length < 2) return parts[0] || ''
  // A primeira letra do último nome («(Dev)» não conta como nome).
  const initialOf = (parts[parts.length - 1].match(/\p{L}/u) || [''])[0]
  return initialOf ? `${parts[0]} ${initialOf.toUpperCase()}.` : parts[0]
}

/** A dupla como no cartão: «Rita F. / Tiago L.». `entry` do board
 *  (players, name). Quem esconde os resultados (hides_results, Dev 3) não
 *  aparece pelo nome. */
export function pairShort(entry, hiddenLabel = '') {
  if (!entry) return ''
  if (entry.hides_results) return hiddenLabel
  const players = (entry.players || []).filter(Boolean)
  if (players.length) return players.map(shortName).join(' / ')
  return String(entry.name || '').split(/\s*\/\s*/).map(shortName).join(' / ')
}

/** O nome da dupla, só se for um nome a sério (não os dois nomes). */
export function teamName(entry) {
  if (!entry?.name) return ''
  const players = (entry.players || []).filter(Boolean)
  return players.length && entry.name !== players.join(' / ') ? entry.name : ''
}

/** O primeiro nome do parceiro, para o texto («Tiago e eu…»). */
export function partnerFirstName(entry, myName) {
  const players = (entry?.players || []).filter(Boolean)
  const other = players.find((p) => p !== myName) || players[1] || ''
  return String(other).trim().split(/\s+/)[0] || ''
}

/** Vitórias e jogos da dupla no torneio (jogos acabados com vencedor). */
export function recordOf(matches, entryId) {
  const mine = (matches || []).filter((m) => (m.entry_a_id === entryId || m.entry_b_id === entryId) && m.winner_entry_id != null)
  return { won: mine.filter((m) => m.winner_entry_id === entryId).length, played: mine.length }
}

/** «3 de 4 vitórias no torneio»; com 5 ou mais jogos, «75 % de vitórias». */
export function recordWords(record, t) {
  if (!record?.played) return ''
  if (record.played >= 5) return t('tshare.record_pct', { pct: Math.round((record.won / record.played) * 100) })
  return t('tshare.record', { won: record.won, played: record.played })
}

/** Os sets do jogo, do lado de quem partilha: «6-4 · 3-6 · 10-7». Sem
 *  sets (pro set), o resultado. */
export function setsWords(match, mineIsA) {
  const sets = Array.isArray(match?.sets) ? match.sets : []
  const pair = (a, b) => (mineIsA ? `${a}-${b}` : `${b}-${a}`)
  if (sets.length > 1) return sets.map((s) => pair(s.score_a, s.score_b)).join(' · ')
  if (match?.score_a != null && match?.score_b != null) return pair(match.score_a, match.score_b)
  return ''
}

/** O resultado grande de cada dupla: sets ganhos, ou os jogos no pro set. */
export function bigScore(match, side) {
  const sets = Array.isArray(match?.sets) ? match.sets : []
  if (sets.length > 1) return sets.filter((s) => (side === 'a' ? s.score_a > s.score_b : s.score_b > s.score_a)).length
  return side === 'a' ? match?.score_a : match?.score_b
}

// A fase com o artigo certo, para o texto (MARKETING.md, notas).
const PHASE_WON = { R32: 'tshare.phase_won_R32', R16: 'tshare.phase_won_R16', QF: 'tshare.phase_won_QF', SF: 'tshare.phase_won_SF' }
const PHASE_LOST = { R32: 'tshare.phase_lost_R32', R16: 'tshare.phase_lost_R16', QF: 'tshare.phase_lost_QF', SF: 'tshare.phase_lost_SF' }
const TITLES = ['tshare.title_1', 'tshare.title_2', 'tshare.title_3']

/** O título pelo lugar (só no pódio): Padelista Lendário, Master do Padel,
 *  Muralha de Bronze. Do 4.º para baixo, nenhum. */
export const placeTitleKey = (place) => TITLES[place - 1] || null

/** O texto sugerido (editável) — MARKETING.md, «Torneio — texto sugerido». */
export function suggestedText(kind, ctx, t) {
  const v = { partner: ctx.partner, partnerCap: ctx.partner, tournament: ctx.tournament, category: ctx.category, result: ctx.result, won: ctx.won, played: ctx.played, place: ctx.place }
  if (kind === 'result') {
    // Na final: o texto do 1.º (ganha) ou do 2.º (perdida).
    if (ctx.round === 'F') return suggestedText('podium', { ...ctx, place: ctx.didWin ? 1 : 2 }, t)
    if (ctx.round && PHASE_WON[ctx.round]) {
      return ctx.didWin
        ? t('tshare.text_won_knockout', { ...v, phase: t(PHASE_WON[ctx.round]) })
        : t('tshare.text_lost_knockout', { ...v, phase: t(PHASE_LOST[ctx.round]) })
    }
    return t(ctx.didWin ? 'tshare.text_won_group' : 'tshare.text_lost_group', v)
  }
  if (ctx.place >= 1 && ctx.place <= 3) return t(`tshare.text_podium_${ctx.place}`, v)
  return ctx.won ? t('tshare.text_place', v) : t('tshare.text_place_no_wins', v)
}

/** «SÁB 10 OUT» (o cartão põe em maiúsculas). */
export function shortDate(iso, lang) {
  if (!iso) return ''
  return new Intl.DateTimeFormat(lang, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Lisbon' })
    .format(new Date(iso)).replace(/\./g, '').replace(/ de /g, ' ').replace(',', '')
}

/** O cartão do resultado de um jogo. `board` = getCategoryBoard(). */
export function resultShare({ tournament, category, board, matchId, myEntryId, myName, t, lang }) {
  const m = (board?.matches || []).find((x) => x.id === matchId)
  if (!m) return null
  const meA = m.entry_a_id === myEntryId
  const mine = board.entries?.[myEntryId]
  const theirs = board.entries?.[meA ? m.entry_b_id : m.entry_a_id]
  // Quem esconde os resultados aparece só como «Dupla M4» (PO, 27 set).
  const hidden = [t('tshare.pair_hidden'), category?.code].filter(Boolean).join(' ')
  const group = m.group_id ? (board.groups || []).find((g) => g.id === m.group_id)?.name : null
  const phase = group || (m.round ? t(`tournament.draw.round_${m.round}`) : '')
  const record = recordOf(board.matches, myEntryId)
  const myScore = bigScore(m, meA ? 'a' : 'b')
  const theirScore = bigScore(m, meA ? 'b' : 'a')
  const didWin = m.winner_entry_id === myEntryId
  const data = {
    kicker: [tournament?.name, category?.code, phase].filter(Boolean).join(' · '),
    date: shortDate(m.scheduled_at, lang),
    mine: pairShort(mine, hidden),
    teamName: mine?.hides_results ? '' : teamName(mine),
    theirs: pairShort(theirs, hidden),
    myScore, theirScore, won: didWin,
    sets: setsWords(m, meA),
    record: recordWords(record, t),
  }
  const text = suggestedText('result', {
    partner: partnerFirstName(mine, myName), tournament: tournament?.name, category: category?.code,
    result: `${myScore}-${theirScore}`, won: record.won, played: record.played, round: m.round, didWin,
  }, t)
  return { data, text, filenameParts: [tournament?.name, category?.code, phase] }
}

/** O cartão do pódio da categoria (ou do lugar, do 4.º para baixo).
 *  `results` = getTournamentResults(); `my` = results.my. */
export function podiumShare({ tournament, results, myName, t, lang }) {
  const my = results?.my
  const c = (results?.categories || []).find((x) => x.code === my?.category_code)
  if (!my?.final_position || !c) return null
  const place = my.final_position
  const playersOf = (team) => (team?.players?.length ? team.players : String(team?.name || '').split(/\s*\/\s*/)).map((n) => String(n).trim())
  const hasMe = (team) => !!myName && playersOf(team).includes(myName)
  const teams = [c.champion, c.runner_up, c.third]
  const rows = place <= 3
    ? teams.map((team, i) => (team ? { place: i + 1, pair: pairShort(team, `${t('tshare.pair_hidden')} ${c.code}`), title: t(placeTitleKey(i + 1)), mine: i + 1 === place || hasMe(team) } : null)).filter(Boolean)
    : []
  const record = { won: my.matches_won || 0, played: my.matches || 0 }
  const myTeam = teams[place - 1]
  const partner = myTeam ? partnerFirstName({ players: playersOf(myTeam) }, myName) : ''
  const data = {
    kicker: [tournament?.name, c.code, t('tshare.podium')].filter(Boolean).join(' · '),
    date: shortDate(tournament?.ends_on ? `${tournament.ends_on}T12:00:00Z` : null, lang),
    place, rows, record: recordWords(record, t),
  }
  const text = suggestedText('podium', {
    partner, tournament: tournament?.name, category: c.code, won: record.won, played: record.played, place,
  }, t)
  return { data, text, filenameParts: [tournament?.name, c.code, `${place}o-lugar`] }
}
