// Separador «Quadro» da página do torneio (Trello #364, «Torneio 4/6»).
// Desenho: SPEC §4 (quadro de eliminatórias) e «Sorteio feito · M4».
//
// Abre sem conta. Enquanto não se sabe quem joga, mostra-se o TEXTO que o
// sorteio guardou («2.º do Grupo B») em vez de um espaço vazio — é o que
// deixa o jogador perceber o caminho dele até à final.
import { useTranslation } from 'react-i18next'
import { Trophy } from 'lucide-react'
import { EmptyState } from '../ui'
import { MonoLabel } from './TournamentBits'
import useCategoryBoard from './useCategoryBoard'
import { bracketRounds } from '../../lib/tournamentDraw'
import { matchTieBreak } from './tieBreak'

const hhmm = (iso) => (iso ? new Date(iso).toTimeString().slice(0, 5) : null)

/** Um lado do jogo: nome da dupla, ou o texto de onde ela vem. */
function Side({ entryId, source, entries, score, isWinner, t }) {
  const team = entryId ? entries[entryId] : null
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <span
        className={`truncate text-xs ${
          team ? (isWinner ? 'font-bold text-ink-900' : 'text-ink-900') : 'italic text-muted'
        }`}
      >
        {team?.name || source || t('tournament.draw.tbd')}
      </span>
      {score != null ? (
        <b className={`font-mono text-xs ${isWinner ? 'text-ink-900' : 'text-muted'}`}>{score}</b>
      ) : null}
    </div>
  )
}

function MatchCard({ match, entries, t }) {
  const done = ['terminado', 'falta', 'desistencia'].includes(match.status)
  const when = hhmm(match.scheduled_at)
  // O tie-break do jogo (Trello #561): «Tie-break 7-5» no pro set, os sets
  // (com o tie-break de cada 7-6) nos formatos por sets.
  const tb = done && match.status === 'terminado' ? matchTieBreak(match) : null
  const tbText = tb?.tb
    ? t(tb.super ? 'tournament.score.super_tiebreak_result' : 'tournament.score.tiebreak_result', { a: tb.tb.split('-')[0], b: tb.tb.split('-')[1] })
    : tb?.sets || null

  return (
    <div className="card mb-2 !px-4 !py-3">
      <Side
        entryId={match.entry_a_id}
        source={match.source_a}
        entries={entries}
        score={match.score_a}
        isWinner={done && match.winner_entry_id === match.entry_a_id}
        t={t}
      />
      <div className="h-px bg-ink-50" />
      <Side
        entryId={match.entry_b_id}
        source={match.source_b}
        entries={entries}
        score={match.score_b}
        isWinner={done && match.winner_entry_id === match.entry_b_id}
        t={t}
      />
      {(when || match.court_name || tbText || match.status === 'falta' || match.status === 'desistencia') && (
        <p className="mt-1 font-mono text-xs text-muted">
          {[
            tbText,
            match.court_name,
            when,
            match.status === 'falta' ? t('tournament.draw.walkover') : null,
            match.status === 'desistencia' ? t('tournament.draw.retired') : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
    </div>
  )
}

export default function DrawPanel({ category }) {
  const { t } = useTranslation()
  const { entries, matches, loading } = useCategoryBoard(category?.id)

  if (loading) {
    return <p className="py-6 text-center text-xs text-muted">{t('common.loading')}</p>
  }

  const main = bracketRounds(matches, 'principal')
  const secondary = bracketRounds(matches, 'secundario')

  if (!main.length && !secondary.length) {
    return (
      <EmptyState
        icon={Trophy}
        title={t('tournament.draw.bracket_empty_title')}
        subtitle={t('tournament.draw.bracket_empty_subtitle')}
      />
    )
  }

  const Bracket = ({ rounds, label }) => (
    <div className="mb-3">
      <MonoLabel className="mb-1">{label}</MonoLabel>
      {rounds.map(({ round, matches: list }) => (
        <section key={round} className="mb-2">
          <MonoLabel className="mb-1">
            {t(`tournament.draw.round_${round}`)}
          </MonoLabel>
          {list.map((m) => (
            <MatchCard key={m.id} match={m} entries={entries} t={t} />
          ))}
        </section>
      ))}
    </div>
  )

  return (
    <div>
      {main.length ? <Bracket rounds={main} label={t('tournament.draw.bracket_main')} /> : null}
      {secondary.length ? (
        <Bracket rounds={secondary} label={t('tournament.draw.bracket_secondary')} />
      ) : null}
    </div>
  )
}
