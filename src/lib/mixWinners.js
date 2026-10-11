// Os vencedores no fim do mix e do americano (#622, design-handoff/2026-10-11-
// vencedores-em-todos-os-jogos, aprovado pelo Francisco a 11 out): o bloco
// «TERMINADO · VENCEDORES» da página e o cartão de partilha (o do torneio,
// com o clube ou grupo por baixo do logótipo). Só contas: nada de ecrã aqui.
import { shortName, shortDate } from '../components/tournament/shareData'

const SHORT_TITLES = ['mixwinners.short_1', 'mixwinners.short_2', 'mixwinners.short_3']
const TITLES = ['tshare.title_1', 'tshare.title_2', 'tshare.title_3']

const pairOf = (team) => [team?.player1?.name, team?.player2?.name].filter(Boolean).map(shortName).join(' / ')
const hasPlayer = (team, id) => !!id && (team?.player1?.id === id || team?.player2?.id === id)
const partnerOf = (team, id) => {
  const other = team?.player1?.id === id ? team?.player2 : team?.player1
  return String(other?.name || '').split(/\s+/)[0] || ''
}

/** O pódio que a página mostra e o cartão leva, com o lugar de quem vê.
 *  Mix de duplas fixas: `teams` já pela ordem final, o vencedor em 1.º. */
export function duplasWinners({ teams, myId, record, game, org, t, lang }) {
  if (!teams?.length) return null
  const rows = teams.slice(0, 3).map((team, i) => ({ place: i + 1, name: pairOf(team), short: t(SHORT_TITLES[i]), mine: hasPlayer(team, myId) }))
  const myIndex = teams.findIndex((team) => hasPlayer(team, myId))
  const place = myIndex >= 0 ? myIndex + 1 : null
  return {
    winner: rows[0].name,
    rows,
    share: {
      variant: 'podium',
      data: {
        kicker: t('mixwinners.kicker_mix'),
        date: shortDate(game.date, lang),
        place,
        title: !place ? t('mixwinners.winners_title') : place <= 3 ? t('tshare.place', { n: place }) : null,
        rows: !place || place <= 3 ? teams.slice(0, 3).map((team, i) => ({ place: i + 1, pair: pairOf(team), title: t(TITLES[i]), mine: hasPlayer(team, myId) })) : [],
        record: record && record.played > 0 ? t('mixwinners.record_mix', { won: record.won, played: record.played }) : null,
      },
      text: suggested(t, { place, partner: partnerOf(teams[myIndex], myId), mix: game.title, record, solo: false, winners: rows[0].name }),
      filenameParts: [org?.name, game.title, place ? `${place}o-lugar` : 'vencedores'],
    },
  }
}

/** Americano: ganha uma pessoa (o desempate pela diferença já vem em
 *  `standings`, com o lugar partilhado dos empatados). No cartão, quem
 *  partilha vai pelo nome inteiro e os outros com o apelido abreviado (UX,
 *  11 out); na página ficam os nomes inteiros. */
export function americanoWinners({ standings, firsts, myId, game, org, t, lang }) {
  if (!standings?.length) return null
  const placeOf = (r) => standings.findIndex((x) => x.points === r.points && x.diff === r.diff) + 1
  const rows = standings.slice(0, 3).map((r) => ({ place: placeOf(r), name: r.player.name, short: t(SHORT_TITLES[placeOf(r) - 1]), mine: r.player.id === myId }))
  const me = standings.find((r) => r.player.id === myId)
  const place = me ? placeOf(me) : null
  const record = me ? { won: me.wins || 0, played: me.played ?? null } : null
  return {
    winner: new Intl.ListFormat(lang === 'en' ? 'en' : 'pt-PT', { type: 'conjunction' }).format(firsts.map((r) => r.player.name)),
    rows,
    share: {
      variant: 'podium',
      data: {
        kicker: t('mixwinners.kicker_americano'),
        date: shortDate(game.date, lang),
        place,
        title: !place ? t('mixwinners.winners_title') : place <= 3 ? t('tshare.place', { n: place }) : null,
        rows: !place || place <= 3 ? standings.slice(0, 3).map((r) => ({ place: placeOf(r), pair: r.player.id === myId ? r.player.name : shortName(r.player.name), title: t(TITLES[placeOf(r) - 1]), score: r.points, mine: r.player.id === myId })) : [],
        record: record?.played ? t('mixwinners.record_americano', { won: record.won, played: record.played }) : null,
      },
      text: suggested(t, { place, mix: game.title, record, solo: true, winners: firsts.map((r) => r.player.name).join(' e ') }),
      filenameParts: [org?.name, game.title, place ? `${place}o-lugar` : 'vencedores'],
    },
  }
}

function suggested(t, { place, partner, mix, record, solo, winners }) {
  const v = { partner, mix, won: record?.won ?? 0, played: record?.played ?? 0, winners }
  // Quem organizou e não jogou: o texto dos vencedores.
  if (!place) return t('mixwinners.text_org', v)
  const who = solo ? 'solo' : 'pair'
  if (place >= 1 && place <= 3) return t(`mixwinners.text_${who}_${place}`, v)
  return t(`mixwinners.text_${who}_place`, { ...v, place })
}
