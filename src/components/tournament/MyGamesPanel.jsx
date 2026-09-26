// Separador "Os meus jogos" da página do torneio (print 05, 1.º telemóvel):
// o caminho todo, do primeiro jogo à final possível. Os jogos futuros
// aparecem esbatidos até se saber o adversário; o jogo seguinte fica
// destacado; a hora antecipada mostra também a antiga ("era 17:00").
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Trophy } from 'lucide-react'
import { EmptyState, PrimaryButton } from '../ui'
import { Sheet } from '../agenda/AgendaControls'
import { requestMatchCorrection } from '../../lib/tournamentApi'
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

/* Pedir a correção de um resultado (Trello #485). O lado do jogador vem
   primeiro — é assim que ele lê o jogo; manda-se na ordem do jogo (a × b).
   Uma nota opcional para quem organiza perceber o que aconteceu. */
function CorrectionSheet({ match, onClose, onSent }) {
  const { t } = useTranslation()
  const [mine, setMine] = useState('')
  const [theirs, setTheirs] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const a = match.mine_is_a === false ? theirs : mine
  const b = match.mine_is_a === false ? mine : theirs
  const ready = mine !== '' && theirs !== ''

  const send = async () => {
    const sa = parseInt(a, 10); const sb = parseInt(b, 10)
    if (!(sa >= 0) || !(sb >= 0)) { setError(t('tcorrection.error_invalid')); return }
    if (sa === sb) { setError(t('tcorrection.error_tie')); return }
    if (sa === match.score_a && sb === match.score_b) { setError(t('tcorrection.error_same')); return }
    setBusy(true); setError('')
    try {
      await requestMatchCorrection(match.id, { scoreA: sa, scoreB: sb, note: note.trim() || null })
      onSent(match.id)
    } catch (err) {
      console.error('Error requesting a result correction:', err)
      setError(t('tcorrection.error_generic'))
    } finally {
      setBusy(false)
    }
  }

  const box = (label, value, set) => (
    <label className="flex items-center justify-between gap-2 rounded-ctrl border border-line px-3 py-1.5">
      <span className="min-w-0 truncate text-sm text-ink-900">{label}</span>
      <input type="number" inputMode="numeric" min="0" max="99" value={value} onChange={(e) => set(e.target.value)}
        aria-label={label} className="h-11 w-[64px] rounded-md border border-line px-2 text-right font-display text-[20px] font-extrabold text-ink-900" />
    </label>
  )

  return (
    <Sheet title={t('tcorrection.title')} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-ink-700">
          {t('tcorrection.now', { score: match.score || t(match.status === 'desistencia' ? 'tournament.score.desistencia_title' : 'tournament.score.walkover') })}
        </p>
        <p className="text-sm font-medium text-gray-700">{t('tcorrection.right_result')}</p>
        {box(t('tcorrection.us'), mine, setMine)}
        {box(match.opponent || '?', theirs, setTheirs)}
        <label className="block">
          <span className="block text-sm font-medium text-gray-700 mb-2">{t('tcorrection.note_label')}</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={240}
            placeholder={t('tcorrection.note_placeholder')} className="input-field" />
        </label>
        <p className="text-xs text-muted">{t('tcorrection.hint')}</p>
        {error && <p className="text-sm font-extrabold text-danger">{error}</p>}
        <PrimaryButton className="w-full" disabled={!ready || busy} onClick={send}>
          {busy ? t('tcorrection.sending') : t('tcorrection.send')}
        </PrimaryButton>
      </div>
    </Sheet>
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
  // Pedido de correção (Trello #485): o jogo aberto na folha, e os que já
  // foram pedidos nesta visita — a vista pública diz os outros
  // (`correction_pending`), mas só depois de recarregar.
  const [asking, setAsking] = useState(null)
  const [requested, setRequested] = useState(() => new Set())

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
            {/* Só nos jogos acabados, e só com os jogos a sério (o mock
                antigo não traz o lado de cada um). */}
            {m.done && m.mine_is_a !== undefined && (
              <span className="col-span-3 -mt-1 text-right">
                {requested.has(m.id) || m.correction_pending ? (
                  <span className="text-[11.5px] font-semibold text-ink-500">{t('tcorrection.requested')}</span>
                ) : (
                  <button type="button" onClick={() => setAsking(m)} className="min-h-[44px] px-1 text-[12px] font-extrabold text-ink-900 underline underline-offset-2">
                    {t('tcorrection.ask')}
                  </button>
                )}
              </span>
            )}
          </div>
        )
      })}
      {asking && (
        <CorrectionSheet
          match={asking}
          onClose={() => setAsking(null)}
          onSent={(id) => { setRequested((s) => new Set(s).add(id)); setAsking(null) }}
        />
      )}
    </div>
  )
}
