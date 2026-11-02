// O miolo do cartão dos vencedores de um jogo entre amigos, no cartão comum
// de todas as partilhas (#743, design-handoff/2026-10-30-partilha-cartoes-
// acerto, 30 out): quem ganhou em grande, com as rondas a lima e a 🏆; quem
// perdeu em pequeno; por baixo, em mono, «1 RONDA A 0 · SET 6-3». Empate: as
// duas duplas em pequeno, sem 🏆. Com vários pares de duplas, uma linha por par.
import { useTranslation } from 'react-i18next'
import { kindLabel } from './FriendRoundSheet'
import { kindOf, pointsToOf } from './roundKinds'
import { pairNames } from './friendResult'
import { Row, ScoreLine, TopRow } from '../tournament/TournamentShareCard'

export default function FriendWinnersBody({ match, games, pairs }) {
  const { t } = useTranslation()
  const played = [...(games || [])].filter((g) => g.score_a != null && g.score_b != null)
    .sort((a, b) => (a.round_number || a.n || 0) - (b.round_number || b.n || 0))
  const single = pairs.length === 1 ? pairs[0] : null
  if (!single) {
    return (
      <div>
        {pairs.map((p, i) => {
          const winA = p.winner !== 'b'
          const [w, l] = winA ? [p.rounds_a, p.rounds_b] : [p.rounds_b, p.rounds_a]
          return <Row key={i} lead={`${w}-${l}`} name={p.winner === 'draw' ? `${pairNames(p.team_a)} · ${pairNames(p.team_b)}` : pairNames(winA ? p.team_a : p.team_b)} />
        })}
      </div>
    )
  }
  const draw = single.winner === 'draw'
  const winA = single.winner !== 'b'
  const [wTeam, wRounds, lTeam, lRounds] = winA
    ? [single.team_a, single.rounds_a, single.team_b, single.rounds_b]
    : [single.team_b, single.rounds_b, single.team_a, single.rounds_a]
  // As rondas do lado de quem ganhou; com mais de três, só a conta.
  const rounds = played.length <= 3
    ? played.map((g) => `${kindLabel(t, kindOf(g, match), pointsToOf(g))} ${winA ? `${g.score_a}-${g.score_b}` : `${g.score_b}-${g.score_a}`}`)
    : []
  return (
    <div>
      {draw
        ? <><Row lead={single.rounds_a} name={pairNames(single.team_a)} /><Row lead={single.rounds_b} name={pairNames(single.team_b)} /></>
        : <><TopRow lead={wRounds} name={pairNames(wTeam)} /><Row lead={lRounds} name={pairNames(lTeam)} dim /></>}
      <ScoreLine>{[t('friends.list_rounds', { count: wRounds, b: lRounds }), ...rounds].join(' · ')}</ScoreLine>
    </div>
  )
}
