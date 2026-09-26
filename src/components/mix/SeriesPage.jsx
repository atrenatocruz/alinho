// A página da série (ações do evento, assunto 2, aprovado pelo Francisco a
// 26 set — design-handoff/2026-09-26-acoes-do-evento/assunto-2-onde.png).
//
// Um mix que se repete aparece UMA vez no Gerir; tocar abre esta página:
//   · em cima, o CARTÃO DE CRIAÇÃO (contorno preto): as regras e dois
//     botões, «Editar as regras» e «Apagar» — só ele acaba a série;
//   · por baixo, UM CARTÃO POR DATA, do mais novo para o mais antigo: os
//     próximos na cor do mix, o de hoje com contorno preto e «· hoje», os já
//     jogados a cinzento, e «Ver os mais antigos (N)» no fim.
// Tocar numa data abre a mesma folha do «Mais ⋯» da página desse mix, só
// com o que mexe nesse dia.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import { ConfirmSheet } from '../ui'
import EventActionsSheet from '../EventActionsSheet'
import ChangeOneMixSheet from './ChangeOneMixSheet'
import { cancelMixDate } from '../../lib/mixCancel'
import { describeError } from '../../lib/errors'
import { formatDate, formatTime } from '../../lib/formatDate'
import { weekdayShort, weekdayLong, isMasculineWeekday } from '../../lib/launchDay'
import { FORMAT_LABEL_KEY, mixCapacity } from '../../lib/mixLogic'

const DONE = ['finished', 'completed', 'cancelled']
const NOT_STARTED = ['pending', 'open', 'closed']
// Quantos já jogados se veem antes do «Ver os mais antigos».
const PAST_SHOWN = 2

const people = (g) => (g.participants || [])
  .filter((p) => p.status === 'confirmed')
  .reduce((n, p) => n + 1 + (p.partner_id ? 1 : 0), 0)
const signedUp = (g) => (g.participants || []).some((p) => ['confirmed', 'waitlisted'].includes(p.status))

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

export default function SeriesPage({ games, onBack, onEditRules, onOpen, onChanged, onStopSeries, onDeleted, abreEm }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const [sheetGame, setSheetGame] = useState(null)
  const [changeGame, setChangeGame] = useState(null)
  const [cancelGame, setCancelGame] = useState(null)
  const [deleteAsk, setDeleteAsk] = useState(false)
  const [showOld, setShowOld] = useState(false)
  const [notice, setNotice] = useState('')
  useEffect(() => {
    if (!notice) return undefined
    const timer = setTimeout(() => setNotice(''), 3000)
    return () => clearTimeout(timer)
  }, [notice])

  const today = new Date()
  const sorted = [...games].sort((a, b) => new Date(b.date) - new Date(a.date))
  const isPast = (g) => DONE.includes(g.status) || (new Date(g.date) < today && !sameDay(new Date(g.date), today))
  const upcoming = sorted.filter((g) => !isPast(g))
  const past = sorted.filter(isPast)
  // O mix que dá as regras: o último que a série marcou (é esse que leva as
  // regras de agora; um de hoje pode ter sido mudado só para esse dia).
  const base = upcoming[0] || sorted[0]
  const rec = base?.recurrence || games.find((g) => g.recurrence)?.recurrence || null
  const active = !!rec?.is_active

  if (!base) return null

  const baseDate = new Date(base.date)
  const shortDay = (d) => `${weekdayShort(d, lang)} ${d.getDate()} ${formatDate(d, lang, { month: 'short' }).replace(/\./g, '').toLocaleLowerCase(lang)}`
  const time = (g) => formatTime(g.date, lang, { hour: '2-digit', minute: '2-digit' })

  // «todas as terças» / «todos os sábados» / «todos os dias»…
  const repeatLabel = (() => {
    if (rec?.frequency === 'weekly') {
      const day = weekdayLong(baseDate, lang)
      return t(isMasculineWeekday(baseDate) ? 'series.every_weekday_m' : 'series.every_weekday_f', { day })
    }
    return t(`series.every_${rec?.frequency || 'weekly'}`)
  })()
  // «Inscrições abrem à quinta, às 10:00» — a partir do intervalo da série.
  const opensLabel = (() => {
    if (!rec?.mix_offset_seconds) return null
    const d = new Date(baseDate.getTime() - rec.mix_offset_seconds * 1000)
    return t(isMasculineWeekday(d) ? 'series.opens_m' : 'series.opens_f', {
      day: weekdayLong(d, lang), time: formatTime(d, lang, { hour: '2-digit', minute: '2-digit' }),
    })
  })()
  const rules = [time(base), base.location, FORMAT_LABEL_KEY[base.format] ? t(FORMAT_LABEL_KEY[base.format]) : null, t('series.places', { count: mixCapacity(base) })]
    .filter(Boolean).join(' · ')

  const subline = (g) => {
    if (g.status === 'cancelled') return t('series.date_cancelled')
    if (DONE.includes(g.status)) return t('series.date_finished', { count: people(g) })
    if (g.status === 'pending') return abreEm(g) || t('series.date_not_open')
    if (g.status === 'in_progress') return `${time(g)} · ${t('gerirclube.status_in_progress')}`
    return `${time(g)} · ${t('series.date_signed', { count: people(g), max: mixCapacity(g) })}`
  }

  const dateTitle = (g) => `${g.title} · ${shortDay(new Date(g.date))}`
  const sheetActions = (g) => [
    { key: 'open', label: t('series.open_this'), hint: t('series.open_this_hint'), onClick: () => onOpen(g) },
    NOT_STARTED.includes(g.status) && { key: 'change', label: t('eventactions.change_one'), hint: t('eventactions.change_one_hint'), onClick: () => setChangeGame(g) },
    [...NOT_STARTED, 'in_progress'].includes(g.status) && { key: 'cancel', danger: true, label: t('eventactions.cancel_one'), hint: t('eventactions.cancel_one_hint_series'), onClick: () => setCancelGame(g) },
  ].filter(Boolean)

  const nextDates = upcoming.filter((g) => !DONE.includes(g.status))
  const card = (g) => {
    const d = new Date(g.date)
    const isToday = sameDay(d, today) && !DONE.includes(g.status)
    const grey = isPast(g) && !isToday
    return (
      <button
        key={g.id}
        type="button"
        onClick={() => setSheetGame(g)}
        className={`w-full flex items-center gap-3 rounded-ctrl p-3 text-left ${
          grey ? 'bg-surface border border-line' : isToday ? 'bg-blue-50 border-2 border-ink-900' : 'bg-blue-50 border border-blue-200'
        }`}
      >
        <span className={`flex w-11 shrink-0 flex-col items-center rounded-lg bg-white py-1 ${grey ? 'text-muted' : 'text-ink-900'}`}>
          <span className="text-base font-extrabold leading-none">{d.getDate()}</span>
          <span className="mt-0.5 text-[10px] font-extrabold uppercase">{formatDate(d, lang, { month: 'short' }).replace(/\./g, '')}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[15px] font-extrabold ${grey ? 'text-muted' : 'text-ink-900'}`}>
            {g.title}{isToday && ` · ${t('series.today')}`}
          </span>
          <span className="block truncate text-[13px] text-muted">{subline(g)}</span>
        </span>
        <ChevronRight size={16} className="shrink-0 text-muted" />
      </button>
    )
  }

  const pastShown = showOld ? past : past.slice(0, PAST_SHOWN)
  const older = past.length - pastShown.length

  return (
    <div className="space-y-3">
      <button type="button" onClick={onBack} className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-extrabold text-ink-900">
        <ArrowLeft size={18} /> {t('series.back')}
      </button>

      {/* O cartão de criação: as regras que fazem os mixes. */}
      <div className="rounded-card border-2 border-ink-900 bg-white p-4">
        <span className="inline-flex rounded-full bg-ink-900 px-2.5 py-1 text-[11px] font-extrabold text-white">
          {active ? t('series.creation_label', { repeat: repeatLabel }) : t('series.creation_ended')}
        </span>
        <p className="mt-2 font-display text-xl font-extrabold leading-tight text-ink-900">{base.title}</p>
        <p className="mt-1 text-[13px] text-ink-700">{rules}</p>
        {active && rec?.is_paused && <p className="mt-0.5 text-[13px] font-extrabold text-ink-900">{t('series.paused')}</p>}
        {active && !rec?.is_paused && opensLabel && <p className="mt-0.5 text-[13px] text-ink-700">{opensLabel}</p>}
        {active && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => onEditRules(base)}
              className="min-h-[44px] rounded-ctrl border border-line bg-white px-3 text-sm font-extrabold text-ink-900">
              {t('series.edit_rules')}
            </button>
            <button type="button" onClick={() => setDeleteAsk(true)}
              className="min-h-[44px] rounded-ctrl border-[1.5px] border-danger bg-white px-3 text-sm font-extrabold text-danger">
              {t('series.delete')}
            </button>
          </div>
        )}
      </div>

      {/* Um cartão por data: os próximos, o de hoje, os já jogados. */}
      {upcoming.map(card)}
      {pastShown.map(card)}
      {older > 0 && (
        <button type="button" onClick={() => setShowOld(true)} className="w-full min-h-[44px] text-sm font-extrabold text-ink-900">
          {t('series.see_older', { count: older })}
        </button>
      )}

      <EventActionsSheet
        open={!!sheetGame}
        title={sheetGame ? dateTitle(sheetGame) : ''}
        subtitle={sheetGame ? [time(sheetGame), sheetGame.location, sheetGame.status === 'pending' ? abreEm(sheetGame)?.toLocaleLowerCase(lang) : null].filter(Boolean).join(' · ') : ''}
        actions={sheetGame ? sheetActions(sheetGame) : []}
        onClose={() => setSheetGame(null)}
      />
      <ChangeOneMixSheet
        open={!!changeGame}
        game={changeGame}
        title={changeGame ? t('eventactions.change_one_title', { name: dateTitle(changeGame) }) : ''}
        onClose={() => setChangeGame(null)}
        onSaved={() => { setNotice(t('eventactions.change_one_done')); onChanged() }}
      />
      <ConfirmSheet
        open={!!cancelGame}
        danger
        title={cancelGame ? t('mixcancel.confirm_title', { name: dateTitle(cancelGame) }) : ''}
        message={cancelGame && !signedUp(cancelGame) ? t('eventactions.cancel_nobody_series') : t('eventactions.cancel_one_hint_series')}
        cancelLabel={t('mixcancel.keep')}
        confirmLabel={t('mixcancel.confirm')}
        onConfirm={async () => {
          await cancelMixDate(cancelGame)
          setNotice(t('eventactions.cancel_done_removed', { name: dateTitle(cancelGame) }))
          onChanged()
        }}
        onClose={() => setCancelGame(null)}
        errorOf={(error) => describeError(t, error, 'mixcancel.error')}
      />
      <ConfirmSheet
        open={deleteAsk}
        danger
        title={t('series.delete_title', { name: base.title })}
        message={nextDates.length > 0
          ? t('series.delete_message', { name: base.title, dates: nextDates.slice().reverse().map((g) => shortDay(new Date(g.date))).join(', ') })
          : t('series.delete_message_none', { name: base.title })}
        cancelLabel={t('series.delete_keep')}
        confirmLabel={t('series.delete_confirm')}
        onConfirm={async () => {
          // Acaba a série (e tira a data por abrir), depois cancela os
          // próximos: com inscritos ficam cancelados e são avisados, sem
          // ninguém desaparecem. Os já jogados ficam.
          await onStopSeries(rec.id)
          for (const g of nextDates.filter((x) => x.status !== 'pending')) await cancelMixDate(g)
          onDeleted(t('series.deleted', { name: base.title }))
        }}
        onClose={() => setDeleteAsk(false)}
        errorOf={(error) => describeError(t, error, 'series.delete_error')}
      />
      {notice && (
        <div role="status" className="fixed left-4 right-4 bottom-[104px] z-50 mx-auto max-w-md rounded-ctrl bg-ink-900 px-4 py-3 text-sm font-extrabold text-white animate-fade-up">
          {notice}
        </div>
      )}
    </div>
  )
}
