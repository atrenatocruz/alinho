// Separador "Os meus jogos" da página do torneio (print 05, 1.º telemóvel):
// o caminho todo, do primeiro jogo à final possível. Os jogos futuros
// aparecem esbatidos até se saber o adversário; o jogo seguinte fica
// destacado; a hora antecipada mostra também a antiga ("era 17:00").
import { useTranslation } from 'react-i18next'
import { Trophy } from 'lucide-react'
import { EmptyState } from '../ui'
import { MonoLabel } from './TournamentBits'
import useCategoryBoard from './useCategoryBoard'
import { myMatchesFromBoard } from '../../lib/myTournamentMatches'

/** Sáb 10:00 — dia curto + hora, em mono, como no desenho. */
function When({ date, time, locale }) {
  if (!date) return <b className="font-mono text-[10.5px] font-bold text-ink-500">—</b>
  const d = new Date(`${date}T${time || '00:00'}`)
  const day = d.toLocaleDateString(locale, { weekday: 'short' }).replace('.', '')
  return (
    <b className="font-mono text-[10.5px] font-bold text-ink-900">
      {day.charAt(0).toUpperCase() + day.slice(1)} {time}
    </b>
  )
}

export default function MyGamesPanel({ category, myEntries = [], myMatches = [] }) {
  const { t, i18n } = useTranslation()
  // Os jogos vêm das vistas públicas da categoria (Trello #508): a base de
  // dados nunca mandou `my_matches`, por isso o separador ficava vazio.
  // `myMatches` fica só para o mock de localhost, que ainda o traz.
  const board = useCategoryBoard(category?.id)
  const myIds = myEntries.filter((e) => e.category_id === category?.id).map((e) => e.entry_id).filter(Boolean)
  const fromBoard = myMatchesFromBoard(board, myIds)
  const rows = fromBoard.length ? fromBoard : myMatches.filter((m) => !category || m.category_id === category.id)

  if (board.loading && !rows.length) {
    return <div className="flex justify-center py-10"><div className="animate-spin rounded-full h-8 w-8 border-[3px] border-ink-50 border-t-ink-700"></div></div>
  }

  if (!rows.length) {
    return (
      <EmptyState
        icon={Trophy}
        title={t('tournament.my_games_empty_title')}
        subtitle={t('tournament.my_games_empty_subtitle')}
      />
    )
  }

  // O jogo seguinte é o primeiro que ainda não acabou (falta e desistência
  // também acabam o jogo, mesmo sem resultado).
  const nextId = rows.find((m) => !(m.done ?? m.score))?.id

  return (
    <div>
      <MonoLabel className="mb-1">{t('tournament.my_games_label')}</MonoLabel>
      {rows.map((m) => {
        const phase = m.group_label
          ? `${m.group_label}${m.order_in_group ? ` · ${m.order_in_group}/${m.of_group}` : ''}`
          : m.round_label || (m.round ? t(`tournament.draw.round_${m.round}`) : '')
        const unknown = !m.opponent
        const isNext = m.id === nextId
        return (
          <div
            key={m.id}
            className={`grid grid-cols-[62px_minmax(0,1fr)_auto] items-center gap-2 border-t border-line px-0.5 py-2 text-[11.5px] ${
              isNext ? 'mt-0.5 rounded-ctrl border-t-0 bg-[#F0FDF4] px-1.5' : ''
            } ${unknown && !isNext ? 'opacity-55' : ''}`}
          >
            <When date={m.date} time={m.time} locale={i18n.language} />
            <span className="min-w-0 text-ink-900">
              {phase}{m.court ? ` · ${m.court}` : ''}
              <br />
              <em className="not-italic text-ink-500">
                {unknown ? t('tournament.my_games_if_you_win') : t('tournament.my_games_vs', { opponent: m.opponent })}
              </em>
            </span>
            {m.score || (m.done && m.status !== 'terminado') ? (
              <span className={`whitespace-nowrap text-[11px] font-bold ${m.won ? 'text-ok' : 'text-ink-500'}`}>
                {m.score || t(m.status === 'desistencia' ? 'tournament.score.desistencia_title' : 'tournament.score.walkover')} {m.won ? '✓' : ''}
              </span>
            ) : m.previous_time ? (
              <span className="whitespace-nowrap text-[11.5px] text-ink-500">
                {t('tournament.my_games_was_at', { time: m.previous_time })}
              </span>
            ) : <span />}
          </div>
        )
      })}
    </div>
  )
}
