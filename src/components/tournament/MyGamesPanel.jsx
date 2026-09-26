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
import { useScoreEntry, toMatchOrder } from './ScoreEntry'
import { proSetTieBreakTarget } from './tieBreak'
import useCategoryBoard from './useCategoryBoard'
import { myMatchesFromBoard } from '../../lib/myTournamentMatches'

/** Sáb 10:00 — dia curto + hora, em mono, como no desenho. */
function When({ date, time, locale }) {
  if (!date) return <b className="font-mono text-xs font-bold text-ink-500">—</b>
  const d = new Date(`${date}T${time || '00:00'}`)
  const day = d.toLocaleDateString(locale, { weekday: 'short' }).replace('.', '')
  return (
    <b className="font-mono text-xs font-bold text-ink-900">
      {day.charAt(0).toUpperCase() + day.slice(1)} {time}
    </b>
  )
}

/* Pedir a correção de um resultado (Trello #485). O lado do jogador vem
   primeiro — é assim que ele lê o jogo; manda-se na ordem do jogo (a × b).
   Com as regras do marcador (QA, 26 set): pergunta o tie-break num 8-8 ou
   9-8, os sets nos torneios por sets, e não deixa enviar um resultado que
   não fecha o jogo. Uma nota opcional para quem organiza. */
function CorrectionSheet({ match, scoring, tieTarget, onClose, onSent }) {
  const { t } = useTranslation()
  const score = useScoreEntry({ scoring, tieTarget })
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const send = async () => {
    const { input, problem } = score.build()
    if (problem) { setError(t(`tournament.score.problem_${problem}`)); return }
    const ordered = toMatchOrder(input, match.mine_is_a)
    if (!ordered.sets && ordered.score_a === match.score_a && ordered.score_b === match.score_b) {
      setError(t('tcorrection.error_same')); return
    }
    setBusy(true); setError('')
    try {
      await requestMatchCorrection(match.id, {
        scoreA: ordered.score_a, scoreB: ordered.score_b, note: note.trim() || null, sets: ordered.sets || null,
      })
      onSent(match.id)
    } catch (err) {
      console.error('Error requesting a result correction:', err)
      // A base de dados recusa um resultado impossível com a frase já
      // escrita (a mesma trava do marcador); o resto é a frase genérica.
      setError(err?.code === 'P0001' && err?.message ? err.message : t('tcorrection.error_generic'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title={t('tcorrection.title')} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-ink-700">
          {t('tcorrection.now', { score: match.score || t(match.status === 'desistencia' ? 'tournament.score.desistencia_title' : 'tournament.score.walkover') })}
        </p>
        <p className="text-sm font-medium text-gray-700">{t('tcorrection.right_result')}</p>
        {score.render({ teamA: t('tcorrection.us'), teamB: match.opponent || '?' })}
        <label className="block">
          <span className="block text-sm font-medium text-gray-700 mb-2">{t('tcorrection.note_label')}</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={240}
            placeholder={t('tcorrection.note_placeholder')} className="input-field" />
        </label>
        <p className="text-xs text-muted">{t('tcorrection.hint')}</p>
        {error && <p className="rounded-ctrl border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-extrabold text-danger">{error}</p>}
        <PrimaryButton className="w-full" disabled={busy} onClick={send}>
          {busy ? t('tcorrection.sending') : t('tcorrection.send')}
        </PrimaryButton>
      </div>
    </Sheet>
  )
}

export default function MyGamesPanel({ tournament, category, myEntries = [], myMatches = [] }) {
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
            className={`card mt-1.5 grid grid-cols-[62px_minmax(0,1fr)_auto] items-center gap-2 !py-2.5 text-xs ${
              isNext ? '!bg-[#F0FDF4] !border-[#BBF7D0]' : ''
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
              <span className={`whitespace-nowrap text-xs font-bold ${m.won ? 'text-ok' : 'text-ink-500'}`}>
                {m.score || t(m.status === 'desistencia' ? 'tournament.score.desistencia_title' : 'tournament.score.walkover')} {m.won ? '✓' : ''}
              </span>
            ) : m.previous_time ? (
              <span className="whitespace-nowrap text-xs text-ink-500">
                {t('tournament.my_games_was_at', { time: m.previous_time })}
              </span>
            ) : <span />}
            {/* Só nos jogos acabados, e só com os jogos a sério (o mock
                antigo não traz o lado de cada um). */}
            {m.done && m.mine_is_a !== undefined && (
              <span className="col-span-3 -mt-1 text-right">
                {requested.has(m.id) || m.correction_pending ? (
                  <span className="text-xs font-semibold text-ink-500">{t('tcorrection.requested')}</span>
                ) : (
                  <button type="button" onClick={() => setAsking(m)} className="min-h-[44px] px-1 text-xs font-extrabold text-ink-900 underline underline-offset-2">
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
          scoring={tournament?.rules?.scoring || 'pro_set_9'}
          tieTarget={proSetTieBreakTarget(tournament?.rules)}
          onClose={() => setAsking(null)}
          onSent={(id) => { setRequested((s) => new Set(s).add(id)); setAsking(null) }}
        />
      )}
    </div>
  )
}
