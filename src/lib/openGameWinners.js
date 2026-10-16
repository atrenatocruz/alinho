// Os vencedores no fim do jogo em aberto (#622, design-handoff/2026-10-11-
// vencedores-em-todos-os-jogos, aprovado pelo Francisco a 11 out: «Sim
// segue»). «Ganharam»: a dupla que ganhou com «VENCERAM» e o resultado a
// lima, a outra apagada, os sets por baixo; a pastilha com as vitórias de
// quem partilha. O cartão é o do torneio (variante «result»), com a base
// comum do Dev 2 (org por baixo do logótipo). Só contas: nada de ecrã aqui.
import { shortName, shortDate, setsWords, bigScore } from '../components/tournament/shareData'

const pairOf = (team) => [team?.player1?.name, team?.player2?.name].filter(Boolean).map(shortName).join(' / ')
const hasPlayer = (team, id) => !!id && (team?.player1?.id === id || team?.player2?.id === id)
const partnerOf = (team, id) => {
  const other = team?.player1?.id === id ? team?.player2 : team?.player1
  return String(other?.name || '').split(/\s+/)[0] || ''
}

/** «3 de 4 vitórias» com menos de 5 jogos; daí para cima, «75% de vitórias». */
export function winsWords(record, t) {
  if (!record?.played) return null
  if (record.played < 5) return t('openwinners.record_count', { won: record.won, played: record.played })
  return t('openwinners.record_pct', { pct: Math.round((record.won / record.played) * 100) })
}

/** winner / other: as duas duplas ({ player1, player2 }); match: o jogo que
 *  decidiu (score_a/score_b/sets, com team_a_id); record: as vitórias gerais
 *  de quem vê, as do perfil ({ won, played }) — num jogo só, «4 de 4» não
 *  diz nada (UX, 11 out). */
export function openGameWinners({ winner, other, match, myId, record, game, org, t, lang }) {
  if (!winner) return null
  const winnerIsA = match ? match.team_a_id === winner.id : true
  const won = match ? bigScore(match, winnerIsA ? 'a' : 'b') : null
  const lost = match ? bigScore(match, winnerIsA ? 'b' : 'a') : null
  const score = won != null && lost != null ? `${won}-${lost}` : ''
  const iWon = hasPlayer(winner, myId)
  const iPlayed = iWon || hasPlayer(other, myId)
  const rows = [
    { place: null, top: true, name: pairOf(winner), short: won != null ? String(won) : '', mine: iWon },
    ...(other ? [{ place: null, top: false, name: pairOf(other), short: lost != null ? String(lost) : '', mine: hasPlayer(other, myId) }] : []),
  ]
  const v = { partner: partnerOf(iWon ? winner : other, myId), winners: pairOf(winner), score }
  return {
    winner: pairOf(winner),
    rows,
    note: score ? t('openwinners.note', { score }) : null,
    share: {
      variant: 'result',
      data: {
        kicker: t('openwinners.kicker'),
        date: shortDate(game.date, lang),
        heading: t('openwinners.heading'),
        wonBelow: t('openwinners.won_below'),
        mine: pairOf(winner),
        teamName: '',
        theirs: other ? pairOf(other) : '',
        myScore: won ?? '', theirScore: lost ?? '', won: true,
        sets: match && Array.isArray(match.sets) && match.sets.length > 1 ? setsWords(match, winnerIsA) : null,
        record: iPlayed ? winsWords(record, t) : null,
      },
      text: !iPlayed ? t('openwinners.text_org', v) : iWon ? t('openwinners.text_won', v) : t('openwinners.text_lost', v),
      filenameParts: [org?.name, t('gerirclube.event_label_open'), iWon ? 'vencemos' : 'vencedores'],
    },
  }
}
