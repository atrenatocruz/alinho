// O miolo do cartão dos vencedores de um jogo entre amigos, dentro do cartão
// comum de todos os jogos (#622, SPEC 2026-10-11-vencedores-em-todos-os-jogos,
// ponto 2; base do Dev 2: TournamentShareCard / TournamentShareFlow com
// `children`). «🏆 <dupla>», «3 rondas a 1» grande, «contra <outra>», e as
// rondas com o tipo e o resultado. Empate: «Empate · 2 rondas a 2», sem 🏆.
// Com vários pares de duplas, uma linha por par. `compact`: com foto.
import { useTranslation } from 'react-i18next'
import { kindLabel } from './FriendRoundSheet'
import { kindOf, pointsToOf } from './roundKinds'
import { pairNames, winnersLine, durationLine } from './friendResult'

const LIME = '#C5DD01'

export default function FriendWinnersBody({ match, games, pairs, compact }) {
  const { t } = useTranslation()
  const played = [...(games || [])].filter((g) => g.score_a != null && g.score_b != null)
    .sort((a, b) => (a.round_number || a.n || 0) - (b.round_number || b.n || 0))
  const single = pairs.length === 1 ? pairs[0] : null
  const draw = single?.winner === 'draw'
  const winA = single?.winner !== 'b'
  const big = compact ? 'text-[22px]' : 'text-[30px]'
  return (
    <div>
      <p className="font-mono text-[8.5px] font-bold uppercase tracking-[0.12em] text-[#9CA3AF]">
        {t(pairs.length && pairs.every((p) => p.winner === 'draw') ? 'friends.card_kicker_draw' : 'friends.card_kicker_winners')}
      </p>
      {single ? (
        <>
          <p className={`mt-1 font-extrabold leading-tight ${compact ? 'text-[16px]' : 'text-[19px]'}`} style={draw ? { color: '#FFFFFF' } : { color: LIME }}>
            {draw ? t('friends.card_draw') : `🏆 ${pairNames(winA ? single.team_a : single.team_b)}`}
          </p>
          {/* Numa linha só, do mesmo tamanho e a branco (UX, 11 out). */}
          <p className={`mt-1 font-display font-extrabold leading-tight text-white ${big}`}>
            {t('friends.list_rounds', { count: winA ? single.rounds_a : single.rounds_b, b: winA ? single.rounds_b : single.rounds_a })}
          </p>
          <p className={`mt-1 text-[#9CA3AF] ${compact ? 'text-[11px]' : 'text-[12.5px]'}`}>
            {draw ? `${pairNames(single.team_a)} · ${pairNames(single.team_b)}`
              : t('friends.card_against', { team: pairNames(winA ? single.team_b : single.team_a) })}
          </p>
        </>
      ) : (
        <div className={`mt-2 ${compact ? 'space-y-1' : 'space-y-1.5'}`}>
          {pairs.map((p, i) => (
            <p key={i} className={`font-extrabold leading-snug text-white ${compact ? 'text-[12px]' : 'text-[13.5px]'}`}>{winnersLine(t, p)}</p>
          ))}
        </div>
      )}
      {/* «⏱ 1h30 · 4 rondas»: por baixo de «contra …», por cima das rondas
          (acerto de 12 out). */}
      {durationLine(t, match, games) && (
        <p className={`mt-1.5 font-semibold text-[#9CA3AF] ${compact ? 'text-[10.5px]' : 'text-[11.5px]'}`}>{durationLine(t, match, games)}</p>
      )}
      {!compact && played.length > 0 && (
        <div className="mt-3 space-y-1 rounded-[10px] bg-[#1A1A1D] px-3 py-2.5">
          {played.map((g) => (
            <div key={g.id} className="flex items-center justify-between text-[11.5px]">
              <span className="text-[#9CA3AF]">{kindLabel(t, kindOf(g, match), pointsToOf(g))}</span>
              <b className="tabular-nums text-white">{g.score_a}–{g.score_b}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
